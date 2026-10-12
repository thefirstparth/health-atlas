// Opens a health vault (a private repo filled by the health-vault GitHub Action): encrypted files with a
// Fitbit's days from the Google Health API, the weather and air around them, and optionally a frozen Health
// Atlas copy of an Apple Health export (apple-watch.vault). Everything happens on this device.
//
// The vault file format (shared with the vault's src/crypto.mjs):
//   { "v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": b64, "iv": b64, "data": b64 }
//   data = AES-256-GCM( gzip( UTF-8 JSON ) )
// A month file holds { v: 1, days: { "2026-10-01": { date, g: { <Google type>: value }, ctx: { weather, air } } } }.

// ---------------------------------------------------------------- decryption
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
async function key(pass, salt, iter, use) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, [use]);
}
export class VaultError extends Error {}

/** A vault file's text → its JSON value. */
export async function openSealed(text, pass) {
  let f; try { f = JSON.parse(text); } catch { throw new VaultError('One of the files is not a vault file.'); }
  if (!f || f.v !== 1 || f.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(f.iter) || f.iter < 100000 || f.iter > 1e7) throw new VaultError('One of the files is not a vault file.');
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, await key(pass, unb64(f.salt), f.iter, 'decrypt'), unb64(f.data)); }
  catch { throw new VaultError('That passphrase does not open this vault.'); }
  return JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(plain), new DecompressionStream('gzip'))));
}
/** For tests and tools: the inverse of openSealed, in the same format. */
export async function seal(value, pass, iter = 600000) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream('gzip'));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt, iter, 'encrypt'), plain));
  return JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), data: b64(data) }) + '\n';
}

// ---------------------------------------------------------------- reading the files
// What a person picks: the repo as GitHub's "Download ZIP", or the .vault files themselves.
const VAULT_NAME = /(^|\/)(\d{4}-\d{2}|apple-watch)\.vault$/;
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const bytes = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());

/** The entries of a small zip (a repo download): name, method, sizes, where the data starts. */
async function zipEntries(blob) {
  const tailLen = Math.min(blob.size, 65557), tail = await bytes(blob, blob.size - tailLen, blob.size);
  let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  const count = u16(tail, e + 10), size = u32(tail, e + 12), off = u32(tail, e + 16);
  if (size > 32 * 2 ** 20 || off + size > blob.size) return null;
  const cd = await bytes(blob, off, off + size), dec = new TextDecoder(), out = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
    out.push({ name: dec.decode(cd.subarray(p + 46, p + 46 + nl)), method: u16(cd, p + 10), csize: u32(cd, p + 20), usize: u32(cd, p + 24), lho: u32(cd, p + 42) });
    p += 46 + nl + xl + cl;
  }
  return out;
}
async function zipText(blob, en) {
  const lh = await bytes(blob, en.lho, en.lho + 30);
  if (u32(lh, 0) !== 0x04034b50) throw new VaultError('The zip file is damaged.');
  const start = en.lho + 30 + u16(lh, 26) + u16(lh, 28), raw = await bytes(blob, start, start + en.csize);
  if (en.method === 0) return new TextDecoder().decode(raw);
  if (en.method !== 8) throw new VaultError('The zip uses a compression this page cannot read.');
  return new TextDecoder().decode(await pipe(raw, new DecompressionStream('deflate-raw')));
}

/** Whether a picked file is (or contains) a health vault, without reading it all. */
export async function isVault(file) {
  if (/\.vault$/i.test(file.name || '')) return true;
  if (!/\.zip$/i.test(file.name || '') || file.size > 512 * 2 ** 20) return false;
  try { const es = await zipEntries(file); return !!es && es.some(x => VAULT_NAME.test(x.name) && !x.name.includes('__MACOSX')); } catch { return false; }
}

/** Picked files → { months: [text], apple: text | null }. */
export async function readVaultFiles(files) {
  const months = [], apple = [];
  const take = (name, text) => { if (/apple-watch\.vault$/.test(name)) apple.push(text); else if (VAULT_NAME.test(name)) months.push({ name, text }); };
  for (const f of files) {
    if (/\.vault$/i.test(f.name)) { take(f.name, await f.text()); continue; }
    const es = /\.zip$/i.test(f.name) ? await zipEntries(f) : null;
    if (!es) throw new VaultError(`${f.name} is not a vault file or a vault zip.`);
    for (const en of es) if (VAULT_NAME.test(en.name) && !en.name.includes('__MACOSX') && en.usize < 64 * 2 ** 20) take(en.name, await zipText(f, en));
  }
  if (!months.length && !apple.length) throw new VaultError('No vault files found. Choose the vault repo’s zip (Code → Download ZIP) or its .vault files.');
  months.sort((a, b) => a.name.split('/').pop() < b.name.split('/').pop() ? -1 : 1);
  return { months: months.map(m => m.text), apple: apple[0] || null };
}

// ---------------------------------------------------------------- vault days → a Health Atlas dataset
const num = v => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const r = (x, d = 1) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;
const secs = v => typeof v === 'string' && /^-?\d+(\.\d+)?s$/.test(v) ? Number(v.slice(0, -1)) : null;
const T = s => Date.parse(s + 'T00:00:00Z');
const addDays = (s, n) => new Date(T(s) + n * 864e5).toISOString().slice(0, 10);
const FITBIT = 'FITBIT', APPLE = 'HEALTH_KIT'; // Google's names for the band and for what it imported from Apple Health
const list = v => Array.isArray(v) ? v : v ? [v] : [];
/** The Fitbit's reading among a day's readings; Google's copies of Apple Health are never used. */
const fit = v => list(v).find(x => x && x._platform === FITBIT) || list(v).find(x => x && x._platform !== APPLE && x._platform != null && x._platform !== '') || null;
/** Local wall-clock ms of an instant, from Google's "19800s"-style offset. */
const local = (iso, off) => Date.parse(iso) + (secs(off) || 0) * 1000;
/** Local "YYYY-MM-DDTHH:MM" of an instant. */
const localStamp = (iso, off) => new Date(local(iso, off)).toISOString().slice(0, 16);

const WORKOUT = { RUNNING: 'Running', WALKING: 'Walking', BIKING: 'Cycling', CYCLING: 'Cycling', SWIMMING: 'Swimming', HIKING: 'Hiking', YOGA: 'Yoga', ELLIPTICAL: 'Elliptical', ROWING: 'Rowing', WEIGHTLIFTING: 'Strength training', STRENGTH_TRAINING: 'Strength training', HIIT: 'HIIT', HIGH_INTENSITY_INTERVAL_TRAINING: 'HIIT', TENNIS: 'Tennis', BADMINTON: 'Badminton', CRICKET: 'Cricket', FOOTBALL: 'Soccer', SOCCER: 'Soccer', BASKETBALL: 'Basketball', PILATES: 'Pilates', DANCING: 'Dance', DANCE: 'Dance', MARTIAL_ARTS: 'Martial arts', TREADMILL: 'Running', SPINNING: 'Cycling' };
const workoutName = t => WORKOUT[t] || (t ? t.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Other');

/** One Fitbit night (all sessions that ended on wake day `day`) → Health Atlas sleep fields. */
function night(day, sessions) {
  const S = list(sessions).filter(s => s && s._platform === FITBIT && s.interval);
  if (!S.length) return null;
  const mins = (a, b) => (Date.parse(b) - Date.parse(a)) / 6e4;
  const o = { asleep: 0, awake: 0, core: 0, deep: 0, rem: 0, unspec: 0 };
  const STAGE = { LIGHT: 'core', DEEP: 'deep', REM: 'rem', AWAKE: 'awake', ASLEEP: 'unspec', SLEEPING: 'unspec' };
  const asleepOf = new Map();
  for (const s of S) {
    let asl = 0;
    const st = list(s.stages);
    if (st.length) for (const x of st) { const k = STAGE[x.type] || 'unspec', m = mins(x.startTime, x.endTime); if (!(m > 0)) continue; o[k] += m; if (k !== 'awake') asl += m; }
    else { const m = mins(s.interval.startTime, s.interval.endTime); o.unspec += m; asl = m; }
    o.asleep += asl; asleepOf.set(s, asl);
  }
  if (o.asleep < 20) return null;
  // the main sleep is the one Google marks as such, else the longest; naps add to the night's totals
  const marked = S.filter(s => s.metadata && s.metadata.mainSleep), pool = marked.length ? marked : S;
  const main = pool.reduce((a, b) => asleepOf.get(b) > asleepOf.get(a) ? b : a);
  // bed and wake: first and last asleep moments of the main session, in minutes from the wake day's midnight
  const ast = list(main.stages).filter(x => x.type !== 'AWAKE');
  const a = ast.length ? ast.reduce((m, x) => Math.min(m, local(x.startTime, x.startUtcOffset)), Infinity) : local(main.interval.startTime, main.interval.startUtcOffset);
  const b = ast.length ? ast.reduce((m, x) => Math.max(m, local(x.endTime, x.endUtcOffset)), -Infinity) : local(main.interval.endTime, main.interval.endUtcOffset);
  const bed = (a - T(day)) / 6e4, wake = (b - T(day)) / 6e4;
  return { sl_asleep: r(o.asleep), sl_awake: r(o.awake), sl_core: r(o.core), sl_deep: r(o.deep), sl_rem: r(o.rem), sl_unspec: r(o.unspec), sl_bed: r(bed), sl_wake: r(wake), sl_mid: r((bed + wake) / 2), sl_sessions: S.length };
}

// the measures only a vault brings; the dashboard shows them only when a dataset has them
export const VAULT_KEYS = ['hrvRmssd', 'hrvRel', 'skinTemp', 'spo2', 'azm', 'pm25Night', 'pm25', 'aqiMax', 'tMax', 'nightT'];

/** The first day the Fitbit recorded its own readings (not VO₂ max, which Google estimates from older data too). */
function fitbitStart(days) {
  const own = ['daily-heart-rate-variability', 'daily-resting-heart-rate', 'daily-respiratory-rate', 'daily-oxygen-saturation', 'daily-sleep-temperature-derivations', 'sleep', 'exercise'];
  for (const d of Object.keys(days).sort()) if (own.some(t => list(days[d].g && days[d].g[t]).some(x => x && x._platform === FITBIT))) return d;
  return null;
}

/** Decrypted month files → { dataset, fitbitFrom }. Fitbit measures start on its first day; weather and air cover every day. */
export function vaultDataset(monthValues) {
  const days = {};
  for (const m of monthValues) if (m && m.days) Object.assign(days, m.days);
  const dates = Object.keys(days).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!dates.length) return null;
  const from = fitbitStart(days), rows = new Map(), points = { vo2max: [] }, workouts = [];
  for (const d of dates) {
    const rec = days[d], g = rec.g || {}, o = {};
    const air = rec.ctx && rec.ctx.air, w = rec.ctx && rec.ctx.weather;
    if (air) { o.pm25Night = r(num(air.nightPm25)); o.pm25 = r(num(air.pm25)); o.aqiMax = num(air.aqiMax); }
    if (w) { o.tMax = r(num(w.tMax)); o.nightT = r(num(w.nightT)); }
    if (from && d >= from) {
      const hrv = fit(g['daily-heart-rate-variability']); if (hrv) o.hrvRmssd = r(num(hrv.averageHeartRateVariabilityMilliseconds));
      const rhr = fit(g['daily-resting-heart-rate']); if (rhr) o.rhr = r(num(rhr.beatsPerMinute));
      const resp = fit(g['daily-respiratory-rate']); if (resp) o.resp = r(num(resp.breathsPerMinute), 2);
      const sp = fit(g['daily-oxygen-saturation']); if (sp) o.spo2 = r(num(sp.averagePercentage));
      const t = fit(g['daily-sleep-temperature-derivations']);
      if (t && num(t.nightlyTemperatureCelsius) != null && num(t.baselineTemperatureCelsius) != null) o.skinTemp = r(t.nightlyTemperatureCelsius - t.baselineTemperatureCelsius, 2);
      // Google repeats its VO₂ max estimate daily; keep it when it changes, or weekly, like the Watch's occasional readings
      const v = fit(g['daily-vo2-max']), pv = points.vo2max[points.vo2max.length - 1];
      if (v && num(v.vo2Max) != null && (!pv || pv[1] !== r(num(v.vo2Max)) || T(d) - T(pv[0].slice(0, 10)) >= 7 * 864e5)) points.vo2max.push([d + 'T12:00', r(num(v.vo2Max))]);
      if (g.steps) o.steps = num(g.steps.countSum);
      // the day's heart-rate range and active energy: Google's daily roll-ups (the Heart range chart, Active energy)
      const hr = g['heart-rate'];
      if (hr) { o.hrMin = num(hr.beatsPerMinuteMin); o.hrMax = num(hr.beatsPerMinuteMax); o.hrAvg = r(num(hr.beatsPerMinuteAvg)); }
      if (g['active-energy-burned'] && num(g['active-energy-burned'].kcalSum) != null) o.active = r(num(g['active-energy-burned'].kcalSum));
      // irregular rhythm (AFib) notifications from the band, counted on the day they started
      const irn = list(g['irregular-rhythm-notification']).filter(x => x && x._platform === FITBIT);
      if (irn.length) o.irregular = irn.length;
      if (g.distance && num(g.distance.millimetersSum) != null) o.distance = r(num(g.distance.millimetersSum) / 1e6, 2);
      const az = g['active-zone-minutes'];
      if (az) { const p = ['sumInFatBurnHeartZone', 'sumInCardioHeartZone', 'sumInPeakHeartZone'].map(k => num(az[k])).filter(x => x != null); if (p.length) o.azm = p.reduce((a, b) => a + b, 0); }
      Object.assign(o, night(d, g.sleep) || {});
      for (const x of list(g.exercise)) {
        if (!x || x._platform !== FITBIT || !x.interval) continue;
        const m = x.metricsSummary || {}, dur = secs(x.activeDuration) ?? (Date.parse(x.interval.endTime) - Date.parse(x.interval.startTime)) / 1000;
        const wo = { d: localStamp(x.interval.startTime, x.interval.startUtcOffset), type: workoutName(x.exerciseType), min: r(dur / 60), src: 'Fitbit' };
        if (num(m.caloriesKcal) != null) wo.kcal = r(num(m.caloriesKcal), 0);
        if (num(m.averageHeartRateBeatsPerMinute) != null) wo.hr = num(m.averageHeartRateBeatsPerMinute);
        if (num(m.distanceMillimeters) != null && num(m.distanceMillimeters) > 0) wo.km = r(num(m.distanceMillimeters) / 1e6, 2);
        if (wo.min > 0) workouts.push(wo);
      }
    }
    for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
    if (Object.keys(o).length) rows.set(d, o);
  }
  if (!rows.size) return null;
  const ks = [...rows.keys()], start = ks[0], end = ks[ks.length - 1], n = Math.round((T(end) - T(start)) / 864e5) + 1;
  const daily = {};
  for (const [d, o] of rows) { const i = Math.round((T(d) - T(start)) / 864e5); for (const k in o) (daily[k] ||= new Array(n).fill(null))[i] = o[k]; }
  if (!points.vo2max.length) delete points.vo2max;
  return { fitbitFrom: from, dataset: { meta: { start, end, days: n, sources: from ? { Fitbit: 1 } : {}, exportDate: null }, daily, points, workouts: workouts.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0) } };
}

/**
 * HRV against your own normal: each night as a % above or below the median of the 60 days before it,
 * from the same device only (Apple Watch SDNN before the switch, Fitbit RMSSD after). Needs 14 nights of
 * baseline, so it starts two weeks after each device does. Both eras then read on one scale.
 */
export function hrvAgainstNormal(daily, startIso, switchIso) {
  const sw = switchIso ? Math.round((T(switchIso) - T(startIso)) / 864e5) : Infinity;
  const A = daily.hrv || [], B = daily.hrvRmssd || [], n = Math.max(A.length, B.length), out = new Array(n).fill(null);
  const val = i => i >= sw ? B[i] : A[i];
  for (let i = 0; i < n; i++) {
    const v = val(i); if (v == null) continue;
    const lo = Math.max(i >= sw ? sw : 0, i - 60), base = [];
    for (let j = lo; j < i; j++) { const x = val(j); if (x != null) base.push(x); }
    if (base.length < 14) continue;
    base.sort((x, y) => x - y);
    const m = base.length % 2 ? base[(base.length - 1) / 2] : (base[base.length / 2 - 1] + base[base.length / 2]) / 2;
    if (m > 0) out[i] = Math.round((v / m - 1) * 1000) / 10;
  }
  return out;
}

/**
 * The person's earlier data (an Apple Health export, or what this browser holds) plus the vault's days.
 * `merge` is the parser's mergeData: the vault wins on days both have; older days are kept.
 */
export function combine(base, vds, { merge, opened = new Date().toISOString().slice(0, 10), vaultMonths = 0, hasApple = false } = {}) {
  if (!vds && !base) throw new VaultError('The vault has no days in it yet.');
  if (!vds) return base;
  const { dataset: V, fitbitFrom } = vds;
  let D = base ? merge(base, V) : V;
  // keep the earlier data's description; only the range and the device list change
  if (base) D.meta = { ...base.meta, start: D.meta.start, end: D.meta.end, days: D.meta.days, sleepGoal: D.meta.sleepGoal, sources: { ...(base.meta.sources || {}), ...(fitbitFrom ? { Fitbit: 1 } : {}) } };
  const end = D.meta.end, devices = [];
  if (fitbitFrom) {
    const before = (base && base.meta.devices || []).filter(x => x.from < fitbitFrom).map(x => ({ ...x, to: x.to < fitbitFrom ? x.to : addDays(fitbitFrom, -1) }));
    const hadWearable = base && ['hrv', 'rhr', 'sl_asleep'].some(k => (base.daily[k] || []).some((v, i) => v != null && addDays(base.meta.start, i) < fitbitFrom));
    if (!before.length && hadWearable) before.push({ name: Object.keys(base.meta.sources || {}).some(s => /watch/i.test(s)) ? 'Apple Watch' : 'Previous device', from: base.meta.start, to: addDays(fitbitFrom, -1) });
    devices.push(...before, { name: 'Fitbit', from: fitbitFrom, to: end });
    // two runs in a row on the same device are one era
    for (let k = devices.length - 1; k > 0; k--) if (devices[k].name === devices[k - 1].name) { devices[k - 1] = { ...devices[k - 1], to: devices[k].to }; devices.splice(k, 1); }
  } else if (base && base.meta.devices) devices.push(...base.meta.devices);
  D.meta.devices = devices;
  const rel = hrvAgainstNormal(D.daily, D.meta.start, devices.length > 1 ? fitbitFrom : null);
  if (rel.some(v => v != null)) D.daily.hrvRel = rel.concat(new Array(Math.max(0, D.meta.days - rel.length)).fill(null)).slice(0, D.meta.days); else delete D.daily.hrvRel;
  // the export date marks where an export's days stop; with a vault the days carry on past it
  D.meta.vault = { opened, through: vds.dataset.meta.end, fitbitFrom, months: vaultMonths, apple: hasApple, appleExport: (base && base.meta.exportDate) || null };
  D.meta.exportDate = null;
  return D;
}
