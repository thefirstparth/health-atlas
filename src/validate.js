// Structural check for a dataset loaded from a saved .json or from storage. Rejects anything
// that is not the shape the parser produces, so a hand-edited or foreign file cannot break the page.
const ISO_D = /^\d{4}-\d{2}-\d{2}$/, ISO_M = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const num = v => typeof v === 'number' && isFinite(v);
const str = (v, max = 200) => typeof v === 'string' && v.length <= max;
export function validateData(d) {
  const bad = why => { throw new Error('This file is not a Health Atlas dataset (' + why + ').'); };
  if (!d || typeof d !== 'object') bad('not an object');
  const m = d.meta;
  if (!m || !ISO_D.test(m.start) || !ISO_D.test(m.end) || !Number.isInteger(m.days)) bad('meta');
  const days = Math.round((Date.parse(m.end + 'T00:00:00Z') - Date.parse(m.start + 'T00:00:00Z')) / 864e5) + 1;
  if (days !== m.days || days < 1 || days > 60000) bad('date range');
  if (!d.daily || typeof d.daily !== 'object') bad('daily');
  for (const [k, a] of Object.entries(d.daily)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k) || !Array.isArray(a) || a.length !== days) bad('daily ' + k);
    for (const v of a) if (v !== null && !num(v)) bad('daily value');
  }
  if (!d.points || typeof d.points !== 'object') bad('points');
  for (const [k, a] of Object.entries(d.points)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k) || !Array.isArray(a)) bad('points ' + k);
    for (const p of a) if (!Array.isArray(p) || !ISO_M.test(p[0]) || !num(p[1])) bad('reading');
  }
  if (!Array.isArray(d.workouts)) bad('workouts');
  for (const w of d.workouts) {
    if (!w || !ISO_M.test(w.d) || !str(w.type, 80) || !num(w.min) || !str(w.src ?? '', 200)) bad('workout');
    for (const k of ['kcal', 'hr', 'hrMax', 'km']) if (w[k] != null && !num(w[k])) bad('workout ' + k);
  }
  if (m.sources && typeof m.sources !== 'object') bad('sources');
  if (m.sleepGoal && !Array.isArray(m.sleepGoal)) bad('sleep goal');
  if (m.devices != null && (!Array.isArray(m.devices) || m.devices.some(x => !x || !str(x.name, 80) || !ISO_D.test(x.from) || !ISO_D.test(x.to)))) bad('devices');
  return d;
}

// Readings with impossible dates (a device clock or an importing app writing a bad timestamp) would
// stretch the whole timeline: one record from 1939 gives 88 years of empty charts. This keeps the days
// that can be real and records what was left out, so Settings can say so. Runs after the parser (which
// stays value-for-value with the reference) and on data already stored. Days left out:
//  - after the export was made, or before 2000 (HealthKit began in 2014; earlier dates are clock errors);
//  - a small cluster (under 60 days and under 5% of all days with data) cut off from the rest by a gap
//    of a year or more, at either end.
const DAYMS = 864e5, FLOOR = '2000-01-01', GAP = 365, STRAY_DAYS = 60, STRAY_SHARE = .05;
export function trimTimeline(d) {
  const T0 = Date.parse(d.meta.start + 'T00:00:00Z'), iso = i => new Date(T0 + i * DAYMS).toISOString().slice(0, 10);
  const idx = s => Math.round((Date.parse(s.slice(0, 10) + 'T00:00:00Z') - T0) / DAYMS);
  const has = new Uint8Array(d.meta.days);
  for (const a of Object.values(d.daily)) for (let i = 0; i < a.length; i++) if (a[i] != null) has[i] = 1;
  let lo = Math.max(0, idx(FLOOR)), hi = d.meta.days - 1;
  const ex = /^\d{4}-\d{2}-\d{2}/.test(d.meta.exportDate || '') ? idx(d.meta.exportDate) : null;
  if (ex != null && ex >= 0) hi = Math.min(hi, ex);
  const days = []; for (let i = lo; i <= hi; i++) if (has[i]) days.push(i);
  if (!days.length) return d; // nothing plausible at all: leave it as it was rather than show nothing
  const small = n => n < STRAY_DAYS && n < STRAY_SHARE * days.length;
  let a = 0, b = days.length - 1;
  for (let k = 0; k < b; k++) if (days[k + 1] - days[k] >= GAP && small(k + 1 - a)) a = k + 1;
  for (let k = b; k > a; k--) if (days[k] - days[k - 1] >= GAP && small(b - k + 1)) b = k - 1;
  const s = days[a], e = days[b];
  if (s === 0 && e === d.meta.days - 1) return d;
  let dropped = 0; for (let i = 0; i < d.meta.days; i++) if (has[i] && (i < s || i > e)) dropped++;
  const start = iso(s), end = iso(e), inside = x => { const day = x.slice(0, 10); return day >= start && day <= end; };
  const daily = {}; for (const [k, a2] of Object.entries(d.daily)) daily[k] = a2.slice(s, e + 1);
  const points = {}; let droppedPts = 0;
  for (const [k, a2] of Object.entries(d.points)) { points[k] = a2.filter(p => inside(p[0])); droppedPts += a2.length - points[k].length; }
  const workouts = d.workouts.filter(w => inside(w.d));
  const prev = d.meta.trimmed;
  const trimmed = { days: dropped + (prev ? prev.days : 0), readings: droppedPts + (d.workouts.length - workouts.length) + (prev ? prev.readings : 0),
    from: prev ? prev.from : d.meta.start, to: prev ? prev.to : d.meta.end };
  const devices = (d.meta.devices || []).filter(x => x.to >= start && x.from <= end).map(x => ({ ...x, from: x.from < start ? start : x.from, to: x.to > end ? end : x.to }));
  return { ...d, meta: { ...d.meta, start, end, days: e - s + 1, trimmed, ...(d.meta.devices ? { devices } : {}) }, daily, points, workouts };
}
