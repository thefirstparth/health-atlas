import { ICON, iconSvg } from './icons.js';
// Health Atlas dashboard. Forked from the personal single-file dashboard; this file is now the source.
// mountDashboard(data, { units: 'metric'|'imperial', targets }) renders into the page chrome in index.html.
export const DEFAULT_TARGETS = { sleep: 420, sleepFloor: 360, steps: 8000, exercise: 30, daylight: 30 };
const MI = 0.621371192, FT = 3.28083990, LB = 2.20462262;
// Imperial: convert the data itself, so axes, trends and comparisons are computed in the units shown.
export function prepareData(D, OPT = {}) {
  if (OPT.units !== 'imperial') return D;
  const C = structuredClone(D), mul = (a, f) => a && a.forEach((v, i) => { if (v != null) a[i] = v * f; });
  const dk = { distance: MI, cycling: MI, walkSpeed: MI, runSpeed: MI, stepLen: 1 / 2.54, runVo: 1 / 2.54, runStride: FT, stairUp: FT, stairDown: FT };
  for (const k in dk) mul(C.daily[k], dk[k]);
  const pk = { weight: LB, height: 1 / 2.54, sixMin: FT };
  for (const k in pk) if (C.points[k]) C.points[k] = C.points[k].map(([d, v]) => [d, v * pk[k]]);
  C.workouts = C.workouts.map(w => w.km ? { ...w, km: w.km * MI } : w);
  return C;
}
export function mountDashboard(D, OPT = {}) {
D = prepareData(D, OPT);
const AC = new AbortController(), SIG = { signal: AC.signal };
const TG = { ...DEFAULT_TARGETS, ...(OPT.targets || {}) }, IMP = OPT.units === 'imperial';
const DAY = 864e5;
const T0 = Date.parse(D.meta.start + 'T00:00:00Z');
const N = D.meta.days, LAST = N - 1;
const dt = i => new Date(T0 + i * DAY);
const di = (y, m, d) => Math.round((Date.UTC(y, m, d) - T0) / DAY);
const isoIdx = s => di(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const get = (k, i) => { const a = D.daily[k]; if (!a || i < 0 || i > LAST) return null; const v = a[i]; return v == null ? null : v; };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const NS = 'http://www.w3.org/2000/svg';
const sv = (t, at, parent) => { const e = document.createElementNS(NS, t); for (const k in at) e.setAttribute(k, at[k]); if (parent) parent.appendChild(e); return e; };
const MC = document.createElement('canvas').getContext('2d');
let SANS = 'system-ui, sans-serif';
const tw = (t, font) => { MC.font = font; return MC.measureText(t).width; };

const PTS = {};
for (const k in D.points) PTS[k] = D.points[k].map(([d, v]) => ({ i: isoIdx(d), d, v }));
const WK = D.workouts.map(w => ({ ...w, i: isoIdx(w.d) }));
const TOPW = (() => { const c = {}; for (const w of D.workouts) c[w.type] = (c[w.type] || 0) + 1; return Object.entries(c).filter(([t]) => t !== 'Other').sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]); })();
const WTYPES = [...TOPW.map((t, k) => [t, '--w-' + (k + 1)]), ['Other', '--w-4']];
const wgroup = t => TOPW.includes(t) ? t : 'Other';

// ---------------- window statistics
const PS = {};
function ps(key) {
  if (PS[key]) return PS[key];
  const a = D.daily[key] || [], s = new Float64Array(N + 1), c = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) { const v = a[i]; s[i + 1] = s[i] + (v == null ? 0 : v); c[i + 1] = c[i] + (v == null ? 0 : 1); }
  return (PS[key] = { s, c });
}
function win(key, a, b) {
  a = Math.max(a, 0); b = Math.min(b, LAST);
  if (b < a) return { v: null, n: 0, sum: 0 };
  const P = ps(key), n = P.c[b + 1] - P.c[a], sum = P.s[b + 1] - P.s[a];
  return { v: n ? sum / n : null, n, sum };
}
function extremes(key, a, b) {
  let lo = Infinity, hi = -Infinity, loI = -1, hiI = -1;
  for (let i = Math.max(a, 0); i <= Math.min(b, LAST); i++) { const v = get(key, i); if (v == null) continue; if (v < lo) { lo = v; loI = i; } if (v > hi) { hi = v; hiI = i; } }
  return { lo, hi, loI, hiI };
}
function quantiles(key, a, b, qs) {
  const v = []; for (let i = Math.max(a, 0); i <= Math.min(b, LAST); i++) { const x = get(key, i); if (x != null) v.push(x); }
  if (v.length < 4) return null; v.sort((x, y) => x - y);
  return qs.map(q => { const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return v[lo] + (v[hi] - v[lo]) * (pos - lo); });
}
// Centred triangular-weighted trend (box filter applied twice). Weight tapers to zero at +/-2r days.
const TR = {};
function trend(key, r) {
  const id = key + '|' + r; if (TR[id]) return TR[id];
  const a = D.daily[key] || [], v = new Float64Array(N), m = new Float64Array(N);
  for (let i = 0; i < N; i++) if (a[i] != null) { v[i] = a[i]; m[i] = 1; }
  const box = x => { const p = new Float64Array(N + 1); for (let i = 0; i < N; i++) p[i + 1] = p[i] + x[i]; const o = new Float64Array(N); for (let i = 0; i < N; i++) { const lo = Math.max(0, i - r), hi = Math.min(N - 1, i + r); o[i] = p[hi + 1] - p[lo]; } return o; };
  const nv = box(box(v)), nm = box(box(m)), full = (2 * r + 1) ** 2, out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = nm[i] >= 0.3 * full ? nv[i] / nm[i] : null;
  return (TR[id] = out);
}

// ---------------- formatting
const nf = (v, d = 0) => v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDur = m => { if (m == null) return '–'; m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} hr ${r} min` : `${r} min`; };
const fmtDurS = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r} min`; };
const fmtDurC = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${String(r).padStart(2, '0')}` : `${r}m`; };
const hTxt = m => m % 60 ? fmtDurS(m) : `${m / 60} hr`, hS = m => m % 60 ? fmtDurC(m) : `${m / 60}h`;
const clockN = m => ((Math.round(m) % 1440) + 1440) % 1440;
// All times are shown in 24-hour format, matching the workout log and reading tables.
const hhmm = m => { m = clockN(m); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const fmtClock = m => m == null ? '–' : hhmm(m);
const fmtClockC = hhmm;
const fmtClockAxis = m => hhmm(m);
const dLong = i => { const d = dt(i); return `${WD[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const dShort = i => { const d = dt(i); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const dYr = i => dt(i).getUTCFullYear();

// f: full [number, unit] · c: compact · t: tighter compact · d: delta style
const U = {
  steps: { f: v => [nf(v), 'steps'], c: v => v >= 1000 ? nf(v / 1000, 1) + 'k' : nf(v), t: v => v >= 1000 ? nf(v / 1000) + 'k' : nf(v), d: 'pct' },
  kcal: { f: v => [nf(v), 'kcal'], c: v => v >= 1000 ? nf(v / 1000, 1) + 'k' : nf(v), d: 'pct' },
  min: { f: v => [nf(v), 'min'], c: v => nf(v), d: 'pct' },
  km: { f: v => [nf(v, v < 10 ? 2 : 1), 'km'], c: v => nf(v, 1), t: v => nf(v), d: 'pct' },
  floors: { f: v => [nf(v), Math.round(v) === 1 ? 'floor' : 'floors'], c: v => nf(v), d: 'pct' },
  hours: { f: v => [nf(v, 1), 'hr'], c: v => nf(v, 1), t: v => nf(v), d: 'pct' },
  bpm: { f: v => [nf(v), 'bpm'], c: v => nf(v), d: 'abs', dp: 0, du: 'bpm' },
  ms: { f: v => [nf(v), 'ms'], c: v => nf(v), d: 'abs', dp: 0, du: 'ms' },
  br: { f: v => [nf(v, 1), 'br/min'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: 'br/min' },
  kmh: { f: v => [nf(v, 2), 'km/h'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'km/h' },
  cm: { f: v => [nf(v), 'cm'], c: v => nf(v), d: 'abs', dp: 0, du: 'cm' },
  cm1: { f: v => [nf(v, 1), 'cm'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: 'cm' },
  pct: { f: v => [nf(v * 100, 1), '%'], c: v => nf(v * 100, 1), t: v => nf(v * 100), d: 'abs', dp: 1, du: 'pts', mul: 100, ax: v => nf(v * 100) + '%' },
  pct0: { f: v => [nf(v * 100), '%'], c: v => nf(v * 100), d: 'abs', dp: 0, du: 'pts', mul: 100, ax: v => nf(v * 100) + '%' },
  mps: { f: v => [nf(v, 2), 'm/s'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'm/s' },
  w: { f: v => [nf(v), 'W'], c: v => nf(v), d: 'abs', dp: 0, du: 'W' },
  m2: { f: v => [nf(v, 2), 'm'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'm' },
  m: { f: v => [nf(v), 'm'], c: v => nf(v), d: 'abs', dp: 0, du: 'm' },
  db: { f: v => [nf(v), 'dB'], c: v => nf(v), d: 'abs', dp: 0, du: 'dB' },
  vo2: { f: v => [nf(v, 1), 'mL/kg·min'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: '' },
  kg: { f: v => [nf(v, 1), 'kg'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: 'kg' },
  mmhg: { f: v => [nf(v), 'mmHg'], c: v => nf(v), d: 'abs', dp: 0, du: 'mmHg' },
  num: { f: v => [nf(v), ''], c: v => nf(v), d: 'abs', dp: 0, du: '' },
  times: { f: v => [nf(v), Math.round(v) === 1 ? 'time' : 'times'], c: v => nf(v), d: 'abs', dp: 0, du: '' },
  mi: { f: v => [nf(v, v < 10 ? 2 : 1), 'mi'], c: v => nf(v, 1), t: v => nf(v), d: 'pct' },
  mph: { f: v => [nf(v, 2), 'mph'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'mph' },
  in1: { f: v => [nf(v, 1), 'in'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: 'in' },
  ft: { f: v => [nf(v), 'ft'], c: v => nf(v), d: 'abs', dp: 0, du: 'ft' },
  ft2: { f: v => [nf(v, 2), 'ft'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'ft' },
  ftps: { f: v => [nf(v, 2), 'ft/s'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'ft/s' },
  lb: { f: v => [nf(v, 1), 'lb'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: 'lb' },
  dur: { f: v => [fmtDur(v), ''], c: fmtDurC, t: v => nf(v / 60, 1) + 'h', d: 'dur', ax: v => v % 60 === 0 ? (v / 60) + 'h' : nf(v) + 'm' },
  clock: { f: v => [fmtClock(v), ''], c: fmtClockC, d: 'clock', ax: fmtClockAxis },
};
const F1 = (u, v) => U[u].f(v);
const fmt = (u, v) => { const [a, b] = F1(u, v); return b ? `${a} ${b}` : a; };
const axisFmt = u => U[u].ax || (v => nf(v, Math.abs(v - Math.round(v)) > 1e-6 ? (Math.abs(v * 10 - Math.round(v * 10)) > 1e-6 ? 2 : 1) : 0));

// ---------------- metric registry  (dir: +1 higher better, -1 lower better, 0 no single better direction)
const DEF = {
  steps: { t: 'Steps', u: 'steps', k: 'bar', dir: 1, target: TG.steps, ex: 'Every step your iPhone or Watch counted in a day.' },
  active: { t: 'Active energy', u: 'kcal', k: 'bar', dir: 1, goal: 'moveGoal', ex: 'Calories burned through movement, on top of what your body uses at rest. Your Move ring.' },
  exercise: { t: 'Exercise minutes', u: 'min', k: 'bar', dir: 1, target: TG.exercise, ex: 'Minutes at brisk-walk intensity or harder. Common guidance is 150 a week, about 22 a day.' },
  stand: { t: 'Stand hours', u: 'hours', k: 'bar', dir: 1, goal: 'standGoal', ex: 'Hours in which you stood and moved for at least a minute.' },
  distance: { t: 'Walking + running distance', u: 'km', k: 'bar', dir: 1, ex: 'Distance covered on foot in a day.' },
  flights: { t: 'Flights climbed', u: 'floors', k: 'bar', dir: 1, ex: 'One flight is roughly 3 m (10 ft) of climb.' },
  basal: { t: 'Resting energy', u: 'kcal', k: 'bar', dir: 0, ex: 'Calories your body burns just to keep running. Mostly set by body size, so it moves slowly.' },
  cycling: { t: 'Cycling distance', u: 'km', k: 'bar', dir: 1, ex: 'Distance ridden on days you cycled.' },
  rhr: { t: 'Resting heart rate', u: 'bpm', k: 'line', dir: -1, ex: 'Heart rate while fully at rest. Adults typically sit between 60 and 100; lower within that range usually means a fitter heart.' },
  walkHr: { t: 'Walking heart rate', u: 'bpm', k: 'line', dir: -1, ex: 'Average heart rate during everyday walking. Lower at the same pace usually means better fitness.' },
  hrv: { t: 'Heart rate variability', u: 'ms', k: 'line', dir: 1, ex: 'Tiny variation in the time between heartbeats (SDNN). Higher usually means better recovered. Very personal: compare with your own trend.' },
  resp: { t: 'Respiratory rate', u: 'br', k: 'line', dir: 0, ex: 'Breaths per minute while you sleep. 12 to 20 is the typical adult range; a steady number is normal.' },
  mindful: { t: 'Mindful minutes', u: 'min', k: 'count', dir: 1, ex: 'Minutes logged in breathing or mindfulness sessions.' },
  highHr: { t: 'High heart rate alerts', u: 'times', k: 'count', dir: -1, ex: 'Alerts when heart rate stayed above your limit for 10 minutes while you seemed inactive.' },
  walkSpeed: { t: 'Walking speed', u: 'kmh', k: 'line', dir: 1, ex: 'How fast you walk on flat ground. A widely used marker of overall mobility.' },
  stepLen: { t: 'Step length', u: 'cm', k: 'line', dir: 1, ex: 'Distance between heel strikes of consecutive steps. Longer usually goes with stronger walking.' },
  doubleSupport: { t: 'Double support time', u: 'pct', k: 'line', dir: -1, ex: 'Share of each stride with both feet on the ground. Typical is 20 to 40%; lower means more confident walking.' },
  asymmetry: { t: 'Walking asymmetry', u: 'pct', k: 'line', dir: -1, ex: 'How often one step’s timing differs from the other side. Closer to 0% is better.' },
  stairUp: { t: 'Stair speed, up', u: 'mps', k: 'line', dir: 1, ex: 'Vertical speed climbing stairs. Faster reflects leg strength.' },
  stairDown: { t: 'Stair speed, down', u: 'mps', k: 'line', dir: 1, ex: 'Vertical speed going down stairs. Faster reflects balance and control.' },
  runSpeed: { t: 'Running speed', u: 'kmh', k: 'line', dir: 1, ex: 'Average speed while running.' },
  runPower: { t: 'Running power', u: 'w', k: 'line', dir: 0, ex: 'Work you produce while running, in watts.' },
  runGct: { t: 'Ground contact time', u: 'ms', k: 'line', dir: -1, ex: 'Time each foot stays on the ground per step. Shorter usually means more efficient running.' },
  runVo: { t: 'Vertical oscillation', u: 'cm1', k: 'line', dir: -1, ex: 'How much you bounce up and down per step. Less is usually more efficient.' },
  runStride: { t: 'Stride length', u: 'm2', k: 'line', dir: 0, ex: 'Distance covered in one running stride.' },
  envDb: { t: 'Environmental sound', u: 'db', k: 'line', dir: -1, ex: 'Average loudness around you. Up to 80 dB is considered safe for about 40 hours a week.' },
  phoneDb: { t: 'Headphone volume', u: 'db', k: 'line', dir: -1, ex: 'Average headphone level. The same 80 dB for 40 hours a week guide applies.' },
  daylight: { t: 'Time in daylight', u: 'min', k: 'bar', dir: 1, target: TG.daylight, color: '--c-daylight', ex: 'Minutes outdoors in daylight, measured by the Watch light sensor. More generally helps sleep and mood.' },
  envEvent: { t: 'Loud environment alerts', u: 'times', k: 'count', dir: -1, ex: 'Alerts when surrounding noise stayed loud long enough to affect hearing.' },
  sl_asleep: { t: 'Time asleep', u: 'dur', k: 'bar', dir: 1, night: true, target: TG.sleep, floor: TG.sleepFloor, ex: `Total sleep per night. Your target is ${hTxt(TG.sleep)}, and never under ${hTxt(TG.sleepFloor)}.` },
  sl_awake: { t: 'Awake during the night', u: 'dur', k: 'bar', dir: -1, night: true, color: '--st-awake', ex: 'Time awake between first falling asleep and finally waking. A few short wake-ups are normal.' },
  sl_deep: { t: 'Deep sleep', u: 'dur', k: 'bar', dir: 0, night: true, color: '--st-deep', ex: 'The most physically restorative stage. Usually 10 to 25% of the night; it declines naturally with age.' },
  sl_rem: { t: 'REM sleep', u: 'dur', k: 'bar', dir: 0, night: true, color: '--st-rem', ex: 'The stage linked with memory and dreaming. Usually 20 to 25% of the night.' },
  sl_mid: { t: 'Midpoint of sleep', u: 'clock', k: 'line', dir: 0, night: true, ex: 'Halfway between falling asleep and waking up.' },
  vo2max: { t: 'Cardio fitness (VO₂ max)', u: 'vo2', k: 'points', dir: 1, ex: 'Estimated maximum oxygen your body can use during exercise. Higher means better aerobic fitness.' },
  hrRecovery: { t: 'Heart rate recovery', u: 'bpm', k: 'points', dir: 1, ex: 'How far heart rate drops in the first minute after a workout ends. A bigger drop is better.' },
  steadiness: { t: 'Walking steadiness', u: 'pct0', k: 'points', dir: 1, ex: 'Apple’s estimate of how stable your walking is. Higher means lower risk of a fall.' },
  sixMin: { t: 'Six-minute walk', u: 'm', k: 'points', dir: 1, ex: 'Estimated distance you could walk in six minutes on flat ground.' },
  weight: { t: 'Weight', u: 'kg', k: 'points', dir: 0, ex: 'Body weight entries.' },
  effortEst: { t: 'Workout effort', u: 'num', k: 'points', dir: 0, ex: 'Apple’s 1 to 10 estimate of how hard each workout was.' },
};
for (const k in DEF) DEF[k].key = k;
const IMPU = { km: 'mi', kmh: 'mph', cm: 'in1', cm1: 'in1', m: 'ft', m2: 'ft2', mps: 'ftps', kg: 'lb' };
if (IMP) for (const k in DEF) DEF[k].u = IMPU[DEF[k].u] || DEF[k].u;
const DU = IMP ? 'mi' : 'km', HU = IMP ? 'in1' : 'cm', WU = IMP ? 'lb' : 'kg';
const DIRTXT = { 1: 'Higher is better', '-1': 'Lower is better', 0: '' };
const SPECIAL_DIR = { resp: 'Steady is normal', sl_mid: 'Regular is better', basal: 'Set by body size', sl_deep: 'No single target', sl_rem: 'No single target' };
const dirText = def => def.key in SPECIAL_DIR ? SPECIAL_DIR[def.key] : (DIRTXT[def.dir] || '');

// ---------------- chapters
const CH = [
  { id: 'overview', name: 'Overview', color: '--c-overview' },
  { id: 'heart', name: 'Heart', color: '--c-heart', desc: 'Heart rate through the day, at rest and while walking, with cardio fitness and recovery readings.',
    cards: [{ range: true }, 'rhr', 'walkHr', 'vo2max', 'hrRecovery', 'highHr'] },
  { id: 'stress', name: 'Stress & Recovery', color: '--c-stress', desc: 'The signals that reflect how rested your body is: heart rate variability, resting heart rate and breathing during sleep.',
    cards: ['hrv', 'rhr', 'resp', 'mindful'] },
  { id: 'sleep', name: 'Sleep', color: '--c-sleep', desc: 'How long you slept, how that sleep was made up, and when it happened. Each night is dated by the morning you woke up.', custom: 'sleep' },
  { id: 'activity', name: 'Activity', color: '--c-activity', desc: 'Rings, steps, energy and distance.', custom: 'activity',
    cards: ['steps', 'active', 'exercise', 'stand', 'distance', 'flights', 'basal', 'cycling'] },
  { id: 'workouts', name: 'Workouts', color: '--c-workouts', desc: 'Every recorded workout, by sport.', custom: 'workouts' },
  { id: 'mobility', name: 'Mobility', color: '--c-mobility', desc: 'How you walk, climb stairs and run, measured in the background by iPhone and Apple Watch.',
    cards: ['walkSpeed', 'stepLen', 'doubleSupport', 'asymmetry', 'steadiness', 'sixMin', 'stairUp', 'stairDown', { sec: 'Running form' }, 'runSpeed', 'runPower', 'runGct', 'runVo', 'runStride'] },
  { id: 'env', name: 'Environment & Hearing', color: '--c-env', desc: 'The sound around you, headphone volume and time spent in daylight.',
    cards: ['daylight', 'envDb', 'phoneDb', 'envEvent'] },
  { id: 'body', name: 'Body', color: '--c-body', desc: 'Weight, height and blood pressure, as logged.', custom: 'body' },
];
const CHMAP = Object.fromEntries(CH.map(c => [c.id, c]));

// ---------------- views & periods
const VIEWS = ['W', 'M', '6M', 'Y', 'All'];
const VNAME = { W: 'Week', M: 'Month', '6M': '6 months', Y: 'Year', All: 'All time' };
const VC = {
  W: { ctx: 'day', r: 0, strip: 'day' },
  M: { ctx: 'day', r: 3, strip: 'week', tn: 'about a week' },
  '6M': { ctx: 'week', r: 11, strip: 'month', tn: 'about a month' },
  Y: { ctx: 'week', r: 11, strip: 'month', tn: 'about a month' },
  All: { ctx: 'month', r: 32, strip: 'year', tn: 'about three months' },
};
const CTXNAME = { day: 'Each day', week: 'Weekly average', month: 'Monthly average' };
const STRIPNAME = { day: 'DAY', week: 'WK AVG', month: 'MO AVG', year: 'YR AVG' };
const S = { view: 'Y', ref: LAST, ch: 'overview' };
try { S.stageMode = localStorage.getItem('ha-stage') === 'all' ? 'all' : 'labelled'; } catch (e) { S.stageMode = 'labelled'; }
try { const s = JSON.parse(localStorage.getItem('ha-state') || 'null'); if (s && VIEWS.includes(s.view)) S.view = s.view; } catch (e) {}
{ const h = (location.hash || '').slice(1); if (CHMAP[h]) S.ch = h; }
const save = () => { if (OPT.ephemeral) return; try { localStorage.setItem('ha-state', JSON.stringify({ view: S.view })); } catch (e) {} };

function period(view, ref) {
  const r = dt(ref), y = r.getUTCFullYear(), m = r.getUTCMonth();
  switch (view) {
    case 'W': return { a: ref - 6, b: ref };
    case 'M': return { a: di(y, m, 1), b: di(y, m + 1, 0) };
    case '6M': return { a: di(y, m - 5, 1), b: di(y, m + 1, 0) };
    case 'Y': return { a: di(y, 0, 1), b: di(y, 11, 31) };
    default: { const s = dt(0), e = dt(LAST); return { a: di(s.getUTCFullYear(), s.getUTCMonth(), 1), b: di(e.getUTCFullYear(), e.getUTCMonth() + 1, 0) }; }
  }
}
function shiftRef(view, ref, dir) {
  const r = dt(ref), y = r.getUTCFullYear(), m = r.getUTCMonth();
  let n;
  if (view === 'W') n = ref + 7 * dir;
  else if (view === 'M') n = di(y, m + dir + 1, 0);
  else if (view === '6M') n = di(y, m + 6 * dir + 1, 0);
  else if (view === 'Y') n = di(y + dir, 11, 31);
  else return ref;
  return Math.min(n, LAST);
}
function periodLabel(view, p) {
  const a = dt(p.a), b = dt(Math.min(p.b, LAST));
  if (view === 'W') return `${dShort(p.a)} – ${dShort(p.b)}, ${dYr(p.b)}`;
  if (view === 'M') return `${MONL[a.getUTCMonth()]} ${a.getUTCFullYear()}${p.b > LAST ? ' so far' : ''}`;
  if (view === '6M') return `${MON[a.getUTCMonth()]} ${a.getUTCFullYear() !== dt(p.b).getUTCFullYear() ? a.getUTCFullYear() + ' ' : ''}– ${MON[dt(p.b).getUTCMonth()]} ${dt(p.b).getUTCFullYear()}`;
  if (view === 'Y') return p.b > LAST ? `${a.getUTCFullYear()} so far` : `${a.getUTCFullYear()}`;
  return `${MON[dt(0).getUTCMonth()]} ${dYr(0)} – ${MON[b.getUTCMonth()]} ${dYr(LAST)}`;
}
function prevPeriod(view, p) {
  const e = Math.min(p.b, LAST), len = e - p.a;
  if (view === 'All' || len < 0) return null;
  if (view === 'W') return { a: p.a - 7, b: e - 7, label: 'vs the week before' };
  const q = period(view, p.a - 1), b = Math.min(q.a + len, q.b), full = b === q.b;
  if (view === 'M') return { a: q.a, b, label: full ? `vs ${MONL[dt(q.a).getUTCMonth()]}` : `vs ${MON[dt(q.a).getUTCMonth()]} 1–${dt(b).getUTCDate()}` };
  if (view === '6M') return { a: q.a, b, label: 'vs the 6 months before' };
  return { a: q.a, b, label: full ? `vs ${dYr(q.a)}` : `vs same dates in ${dYr(q.a)}` };
}
function buckets(g, a, b) {
  const out = [];
  if (g === 'day') for (let i = a; i <= b; i++) out.push({ s: i, e: i });
  else if (g === 'week') { let s = a; while (s <= b) { const wd = (dt(s).getUTCDay() + 6) % 7; const e = Math.min(b, s + 6 - wd); out.push({ s, e }); s = e + 1; } }
  else if (g === 'month') { let s = a; while (s <= b) { const d = dt(s); const e = Math.min(b, di(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); out.push({ s, e }); s = e + 1; } }
  else { let s = a; while (s <= b) { const e = Math.min(b, di(dYr(s), 11, 31)); out.push({ s, e }); s = e + 1; } }
  return out;
}
function bucketLabel(bk, g) {
  if (g === 'day') return dLong(bk.s);
  if (g === 'week') { const same = dt(bk.s).getUTCMonth() === dt(bk.e).getUTCMonth(); return `Week of ${dShort(bk.s)} – ${same ? dt(bk.e).getUTCDate() : dShort(bk.e)}, ${dYr(bk.e)}`; }
  if (g === 'month') return `${MONL[dt(bk.s).getUTCMonth()]} ${dYr(bk.s)}`;
  return String(dYr(bk.s));
}

// ---------------- delta chips
const ARROW_UP = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9 7.5H1Z" fill="currentColor"/></svg>';
const ARROW_DN = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5 1 2.5h8Z" fill="currentColor"/></svg>';
function deltaInfo(u, dir, v, pv) {
  if (v == null || pv == null) return null;
  const spec = U[u], d = v - pv;
  let txt, zero;
  if (spec.d === 'pct') {
    if (!pv) return null;
    const ap = Math.abs(d / Math.abs(pv) * 100);
    zero = ap < 0.5; txt = (ap < 10 ? nf(ap, 1) : nf(ap)) + '%';
  } else if (spec.d === 'dur') { zero = Math.abs(d) < 1; txt = fmtDurS(Math.abs(d)); }
  else if (spec.d === 'clock') { zero = Math.abs(d) < 1; txt = `${fmtDurS(Math.abs(d))} ${d > 0 ? 'later' : 'earlier'}`; }
  else { const m = spec.mul || 1, dp = spec.dp || 0, ad = Math.abs(d * m); zero = ad < 0.5 * Math.pow(10, -dp); txt = nf(ad, dp) + (spec.du ? ' ' + spec.du : ''); }
  if (zero) return { cls: 'flat', txt: 'No change', arrow: '' };
  const up = d > 0, cls = dir === 0 || spec.d === 'clock' ? 'flat' : ((up ? 1 : -1) * dir > 0 ? 'good' : 'bad');
  return { cls, txt, arrow: spec.d === 'clock' ? '' : (up ? ARROW_UP : ARROW_DN) };
}
function chipEl(info, title) {
  const c = el('span', 'chip ' + info.cls);
  if (info.arrow) c.insertAdjacentHTML('beforeend', info.arrow);
  c.appendChild(document.createTextNode(info.txt));
  if (title) c.title = title;
  return c;
}

// ---------------- tooltip
const TIP = document.getElementById('tip');
function showTip(x, y, title, rows, sub) {
  TIP.replaceChildren();
  TIP.appendChild(el('div', 't', title));
  for (const r of rows) {
    const row = el('div', 'r');
    if (r.c) { const i = el('i', r.faint ? 'faint' : ''); i.style.background = r.c; row.appendChild(i); }
    row.appendChild(el('b', null, r.v));
    if (r.l) row.appendChild(el('span', null, r.l));
    TIP.appendChild(row);
  }
  if (sub) TIP.appendChild(el('div', 's', sub));
  TIP.classList.add('on');
  const w = TIP.offsetWidth, hh = TIP.offsetHeight;
  let lx = x + 14, ly = y - hh - 12;
  if (lx + w > innerWidth - 8) lx = x - w - 14;
  if (ly < 8) ly = y + 16;
  TIP.style.left = Math.max(8, lx) + 'px'; TIP.style.top = ly + 'px';
}
const hideTip = () => TIP.classList.remove('on');

// ---------------- chart frame
function niceStep(range, count) {
  const raw = range / Math.max(count, 1), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function yDom(vals, zero, ticks = 3) {
  vals = vals.filter(v => v != null && isFinite(v));
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (zero) lo = Math.min(0, lo);
  if (hi === lo) { hi += Math.abs(hi) * .1 || 1; if (!zero) lo -= Math.abs(lo) * .1 || 1; }
  const pad = zero ? 0 : (hi - lo) * .15;
  const st = niceStep((hi - lo) + 2 * pad, ticks);
  const a = zero ? 0 : Math.floor((lo - pad) / st) * st, b = Math.ceil((hi + (zero ? hi * .04 : pad)) / st) * st;
  const t = []; for (let v = a; v <= b + st / 2; v += st) t.push(+v.toFixed(6));
  return { a, b: t[t.length - 1], t };
}
function clockDom(vals) {
  vals = vals.filter(v => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals), st = (hi - lo) > 600 ? 240 : (hi - lo) > 240 ? 120 : 60;
  const a = Math.floor((lo - 15) / st) * st, b = Math.ceil((hi + 15) / st) * st, t = [];
  for (let v = a; v <= b; v += st) t.push(v);
  return { a, b, t };
}
function durDom(vals) {
  vals = vals.filter(v => v != null);
  const hi = Math.max(...vals, 1);
  if (hi > 150) { const d = yDom([0, hi / 60], true, 3); return { a: 0, b: d.b * 60, t: d.t.map(v => v * 60) }; }
  return yDom([0, hi], true, 3);
}
function xTicks(view, p, narrow) {
  const t = [];
  if (view === 'W') for (let i = p.a; i <= p.b; i++) t.push({ i, l: narrow ? WD[dt(i).getUTCDay()][0] : `${WD[dt(i).getUTCDay()]} ${dt(i).getUTCDate()}` });
  else if (view === 'M') for (let i = p.a; i <= p.b; i++) { const d = dt(i).getUTCDate(); if (d === 1 || (d % 7 === 1 && d < 29)) t.push({ i, l: `${MON[dt(i).getUTCMonth()]} ${d}` }); }
  else if (view === '6M' || view === 'Y') { let d = dt(p.a); while (true) { const i = di(d.getUTCFullYear(), d.getUTCMonth(), 1); if (i > p.b) break; if (i >= p.a) t.push({ i, l: narrow && view === 'Y' ? MON[d.getUTCMonth()][0] : MON[d.getUTCMonth()], edge: true }); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); } }
  else { for (let y = dYr(p.a); y <= dYr(p.b); y++) { const i = di(y, 0, 1); if (i >= p.a) t.push({ i, l: String(y), edge: true }); } }
  return t;
}
const STRIP_H = 30;
function frame(box, view, p, dom, opts = {}) {
  const W = Math.max(box.clientWidth, 260), ph = opts.h || 190, mr = 50, mt = 12;
  const stripH = opts.strip ? STRIP_H : 0, H = mt + ph + 24 + stripH, pw = W - mr;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' });
  if (opts.label) svg.setAttribute('aria-label', opts.label);
  const x = i => ((i - p.a + .5) / (p.b - p.a + 1)) * pw;
  const pxDay = pw / (p.b - p.a + 1), inv = !!opts.invert;
  const y = v => mt + (inv ? (v - dom.a) / (dom.b - dom.a) : 1 - (v - dom.a) / (dom.b - dom.a)) * ph;
  const ax = sv('g', { class: 'ax' }, svg);
  for (const tv of dom.t) {
    sv('line', { class: 'gl', x1: 0, x2: pw, y1: y(tv), y2: y(tv) }, ax);
    const tx = sv('text', { x: pw + 10, y: y(tv) + 4 }, ax); tx.textContent = (opts.yFmt || (v => nf(v)))(tv);
  }
  const base = mt + ph, narrow = pw < 520;
  const xt = xTicks(view, p, narrow), font = `500 11px ${SANS}`;
  let lastRight = -1e9;
  xt.forEach(t => {
    const X = t.edge ? x(t.i) - pxDay / 2 : x(t.i);
    if (t.edge) sv('line', { class: 'gl', x1: X, x2: X, y1: base, y2: base + 5 }, ax);
    const w = tw(t.l, font);
    let left = t.edge ? X + 3 : X - w / 2;
    left = Math.max(0, Math.min(left, pw - w));             // keep inside the plot
    if (left < lastRight + 8) return;                         // never collide
    const tx = sv('text', { x: left, y: base + 16, 'text-anchor': 'start' }, ax);
    tx.textContent = t.l; lastRight = left + w;
  });
  const cid = 'cp' + (++gid), defs = sv('defs', {}, svg), cp = sv('clipPath', { id: cid }, defs);
  sv('rect', { x: -8, y: -40, width: pw + 16, height: base + 42 }, cp);
  const pg = sv('g', { 'clip-path': `url(#${cid})` }, svg);
  const g = sv('g', { class: 'marks' }, pg), fg = sv('g', { class: 'fore' }, svg);
  box.replaceChildren(svg);
  const F = { svg, g, fg, x, y, W, H, pw, ph, mt, pxDay, base, stripY: base + 25, narrow, p, zoom: opts.zoom !== false };
  box.__F = F;
  return F;
}
// After a chart is drawn: labels, pills and the strip move to the foreground layer (they never stretch),
// then, on a period change, the marks zoom or slide from where the previous period sat.
function finalize(F) {
  if (!F || F.done) return; F.done = true;
  F.g.querySelectorAll('text, g.pill, .stripel').forEach(n => { if (n.tagName === 'text' && n.closest('g.pill')) return; F.fg.appendChild(n); });
  if (!ZOOM && ANIM && F.g.animate && 'IntersectionObserver' in window) {
    // first time a chapter opens, each chart is drawn left to right as it scrolls into view
    const g = F.g; g.style.clipPath = 'inset(-40px 100% -40px 0)';
    const io = new IntersectionObserver(en => { if (!en.some(x => x.isIntersecting)) return; io.disconnect(); g.style.clipPath = ''; g.animate([{ clipPath: 'inset(-40px 100% -40px 0)' }, { clipPath: 'inset(-40px 0% -40px 0)' }], { duration: 950, easing: 'cubic-bezier(.45,.05,.25,1)' }); }, { threshold: .25 });
    io.observe(F.svg); SIG.signal.addEventListener('abort', () => io.disconnect());
    return;
  }
  if (!ZOOM || !F.zoom || !F.g.animate) return;
  const n0 = ZOOM.b0 - ZOOM.a0 + 1, n = F.p.b - F.p.a + 1, sc = n / n0, tx = (F.p.a - ZOOM.a0) / n0 * F.pw;
  if (Math.abs(sc - 1) < 1e-3 && Math.abs(tx) < .5) return;
  F.svg.classList.add('zooming');
  F.g.animate([{ transform: `translate(${tx}px,0px) scale(${sc},1)` }, { transform: 'translate(0px,0px) scale(1,1)' }], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' });
  F.fg.animate([{ opacity: 0 }, { opacity: 0, offset: .4 }, { opacity: 1 }], { duration: 620, easing: 'ease-out' });
}
// ---------------- linked scrubbing: every chart in a chapter follows the day under the pointer
const SYNC = []; let ACTIVE = null, ZOOM = null, LASTR = null;
const syncTo = (src, day) => SYNC.forEach(s => { if (s !== src) s.show(day); });
const syncOff = src => SYNC.forEach(s => { if (s !== src) s.hide(); });
const rangeOf = t => t.c ? [t.c.s, t.c.e] : t.s && t.s.s != null ? [t.s.s, t.s.e] : t.bk ? [t.bk.s, t.bk.e] : t.d && t.d.i != null ? [t.d.i, t.d.i] : t.q ? [t.q.i, t.q.i] : t.i != null ? [t.i, t.i] : null;
const dayOf = t => { const r = rangeOf(t); return r ? (r[0] + r[1]) / 2 : null; };
function hoverLayer(F, targets, onTip) {
  const line = sv('line', { class: 'xh', y1: F.mt, y2: F.base, x1: -10, x2: -10, opacity: 0 }, F.svg);
  const dot = sv('circle', { class: 'xdot', r: 4.5, cx: -20, cy: -20, opacity: 0 }, F.svg);
  const hit = sv('rect', { class: 'hit', x: 0, y: 0, width: F.pw, height: F.H, tabindex: 0 }, F.svg);
  hit.style.touchAction = 'pan-y';
  let cur = -1;
  const place = (t, withDot) => {
    line.setAttribute('x1', t.x); line.setAttribute('x2', t.x); line.setAttribute('opacity', 1);
    if (withDot && t.ty != null) { dot.setAttribute('cx', t.x); dot.setAttribute('cy', t.ty); dot.setAttribute('opacity', 1); } else dot.setAttribute('opacity', 0);
  };
  const me = {
    show(day) {
      if (day == null) return me.hide();
      let k = targets.findIndex(t => { const r = rangeOf(t); return r && day >= r[0] - .5 && day <= r[1] + .5; });
      if (k < 0 && targets.length && targets[0].q) { let bd = 4; targets.forEach((t, j) => { const d = Math.abs(t.q.i - day); if (d < bd) { bd = d; k = j; } }); }
      if (k < 0) return me.hide();
      place(targets[k], true);
    },
    hide() { line.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); },
  };
  SYNC.push(me);
  const pick = k => {
    if (k < 0 || !targets.length) return;
    cur = k; const t = targets[k];
    place(t, false);
    const r = F.svg.getBoundingClientRect(), sc = r.width / F.W;
    onTip(t, r.left + t.x * sc, r.top + (t.ty != null ? t.ty : F.mt + 20) * sc);
    syncTo(me, dayOf(t)); ACTIVE = me;
  };
  const near = ev => {
    const r = F.svg.getBoundingClientRect(), mx = (ev.clientX - r.left) * F.W / r.width;
    let best = -1, bd = Infinity;
    targets.forEach((t, k) => { const d = Math.abs(t.x - mx); if (d < bd) { bd = d; best = k; } });
    return best;
  };
  hit.addEventListener('pointermove', ev => pick(near(ev)));
  hit.addEventListener('pointerdown', ev => pick(near(ev)));
  const off = () => { me.hide(); hideTip(); syncOff(me); if (ACTIVE === me) ACTIVE = null; };
  me.off = off;
  // on touch the reading stays until you tap elsewhere or scroll
  hit.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch') off(); }); hit.addEventListener('blur', off);
  hit.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowRight') { pick(Math.min(targets.length - 1, cur + 1)); ev.preventDefault(); }
    if (ev.key === 'ArrowLeft') { pick(Math.max(0, cur < 0 ? targets.length - 1 : cur - 1)); ev.preventDefault(); }
  });
  hit.addEventListener('focus', () => pick(targets.length - 1));
}
function smooth(pts) {
  const n = pts.length; if (n < 2) return '';
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = (m[i - 1] * m[i] <= 0) ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) { const h3 = dx[i] / 3; d += `C${pts[i][0] + h3},${pts[i][1] + t[i] * h3} ${pts[i + 1][0] - h3},${pts[i + 1][1] - t[i + 1] * h3} ${pts[i + 1][0]},${pts[i + 1][1]}`; }
  return d;
}
const poly = pts => pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
function runs(arr, maxGap = 1) {
  const out = []; let cur = [], lastK = -99;
  arr.forEach((p, k) => { if (p == null) return; if (cur.length && k - lastK > maxGap) { out.push(cur); cur = []; } cur.push(p); lastK = k; });
  if (cur.length) out.push(cur);
  return out;
}
let gid = 0;
function areaGrad(svg, color, top = .2) {
  const id = 'g' + (++gid);
  const defs = sv('defs', {}, svg); const lg = sv('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  sv('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': top }, lg); sv('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }, lg);
  return `url(#${id})`;
}
function barPath(x, y0, y1, w, r = 4) {
  const hgt = y0 - y1; r = Math.min(r, w / 2, hgt);
  if (hgt <= 0.5) return '';
  return `M${x - w / 2},${y0}V${y1 + r}Q${x - w / 2},${y1} ${x - w / 2 + r},${y1}H${x + w / 2 - r}Q${x + w / 2},${y1} ${x + w / 2},${y1 + r}V${y0}Z`;
}
const capsule = (g, x, y1, y2, w, fill, op = 1) => { const hh = Math.max(Math.abs(y2 - y1), w); const top = Math.min(y1, y2) - (hh - Math.abs(y2 - y1)) / 2; return sv('rect', { x: x - w / 2, y: top, width: w, height: hh, rx: w / 2, fill, 'fill-opacity': op, class: 'draw' }, g); };
function lum(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return .5; const n = parseInt(m[1], 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
const onColor = c => lum(c) > .42 ? '#16181D' : '#FFFFFF';

// trend line: surface-coloured casing under a solid stroke, end dot, measured value pill kept inside the plot
// belowY: optional pixel y of a target; the line turns the "below target" colour wherever it sits under it
function trendLine(F, pts, color, pillText, belowY, invert) {
  const surf = css('--card'), bad = css('--bad');
  const isBelow = pt => belowY != null && (invert ? pt[1] < belowY : pt[1] > belowY);
  for (const r of runs(pts, 1)) {
    if (r.length < 2) continue;
    sv('path', { d: poly(r), fill: 'none', stroke: surf, 'stroke-width': 6.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, F.g);
    // split into same-colour segments, sharing the boundary point so the line stays continuous
    let seg = [r[0]], state = isBelow(r[0]);
    const flush = st => { if (seg.length < 2) return; const p = sv('path', { d: poly(seg), fill: 'none', stroke: st ? bad : color, 'stroke-width': 2.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, F.g); requestAnimationFrame(() => { if (p.closest('.zooming')) return; try { const L = p.getTotalLength(); p.style.setProperty('--len', L); p.classList.add('trace'); } catch (e) {} }); };
    for (let k = 1; k < r.length; k++) { const st = isBelow(r[k]); seg.push(r[k]); if (st !== state) { flush(state); seg = [r[k]]; state = st; } }
    flush(state);
  }
  const last = [...pts].reverse().find(Boolean);
  if (!last) return;
  if (isBelow(last)) color = bad;
  sv('circle', { cx: last[0], cy: last[1], r: 5, fill: color, stroke: surf, 'stroke-width': 2.5 }, F.g);
  if (pillText) {
    const w = tw(pillText, `700 11px ${SANS}`) + 16, h = 20;
    const px = Math.max(0, Math.min(last[0] - w / 2, F.pw - w));
    let py = last[1] - h - 10;
    if (py < 0) py = last[1] + 10;
    const g = sv('g', { class: 'draw pill' }, F.g);
    sv('rect', { x: px, y: py, width: w, height: h, rx: h / 2, fill: color }, g);
    const t = sv('text', { x: px + w / 2, y: py + 13.8, 'text-anchor': 'middle', fill: onColor(color), style: `font:700 11px ${SANS};font-variant-numeric:tabular-nums` }, g);
    t.textContent = pillText;
  }
}

// Move reference labels (Target, Floor, 30-day avg, Goal) to a free corner if they collide with the value pill or each other.
function declutter(F) {
  const labs = [...F.g.querySelectorAll('text.reflab')]; if (!labs.length) return;
  const pills = [...F.g.querySelectorAll('g.pill rect')].map(r => r.getBBox());
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const placed = [...pills];
  labs.forEach(t => {
    const lineY = +t.dataset.ly; if (isNaN(lineY)) { placed.push(t.getBBox()); return; }
    const opts = [[4, lineY - 6, 'start'], [F.pw - 4, lineY - 6, 'end'], [4, lineY + 14, 'start'], [F.pw - 4, lineY + 14, 'end']];
    for (const [x, y, a] of opts) { t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('text-anchor', a); const bb = t.getBBox(); if (!placed.some(p => hit(bb, p))) break; }
    placed.push(t.getBBox());
  });
}
// strip of bucket values aligned to the axis. Text is measured: one size for the whole strip,
// falling back to a tighter format, so every value fits its cell and nothing is clipped.
function strip(F, view, p, valFn, fmts, color, label) {
  const bks = buckets(VC[view].strip, p.a, p.b);
  const cells = bks.map(bk => ({ x0: F.x(bk.s) - F.pxDay / 2, x1: F.x(bk.e) + F.pxDay / 2, v: bk.s > LAST ? null : valFn(bk.s, Math.min(bk.e, LAST)) }));
  const nn = cells.filter(c => c.v != null); if (!nn.length) return;
  const lo = Math.min(...nn.map(c => c.v)), hi = Math.max(...nn.map(c => c.v)), y0 = F.stripY, hh = STRIP_H - 6;
  let pick = null;
  outer: for (const f of fmts) for (const fs of [11, 10.5, 10, 9.5]) {
    const font = `650 ${fs}px ${SANS}`;
    if (nn.every(c => tw(f(c.v), font) <= (c.x1 - c.x0) - 7)) { pick = { f, font, fs }; break outer; }
  }
  if (!pick) { // a strip that cannot show its numbers is noise: leave it out and give the space back
    const H2 = F.H - STRIP_H; F.svg.setAttribute('viewBox', `0 0 ${F.W} ${H2}`); F.svg.setAttribute('height', H2); F.H = H2;
    const hit = F.svg.querySelector('.hit'); if (hit) hit.setAttribute('height', H2);
    return;
  }
  cells.forEach(c => {
    if (c.v == null) return;
    const t = hi > lo ? (c.v - lo) / (hi - lo) : .5, w = c.x1 - c.x0;
    sv('rect', { class: 'stripel', x: c.x0 + 1.5, y: y0, width: Math.max(0, w - 3), height: hh, rx: 7, fill: color, 'fill-opacity': (0.07 + 0.2 * t).toFixed(3) }, F.g);
    if (pick) { const tx = sv('text', { x: (c.x0 + c.x1) / 2, y: y0 + hh / 2 + pick.fs * .36, 'text-anchor': 'middle', fill: css('--ink'), style: `font:${pick.font};font-variant-numeric:tabular-nums` }, F.g); tx.textContent = pick.f(c.v); }
  });
  const lt = sv('text', { x: F.W - 1, y: y0 + hh / 2 + 3.5, class: 'stripl', 'text-anchor': 'end' }, F.g); lt.textContent = label || STRIPNAME[VC[view].strip];
}
const fmtsFor = u => [U[u].c, U[u].t].filter(Boolean);
function clockFmts() { return [fmtClockC]; }
function legend(items) {
  const lg = el('div', 'legend');
  for (const it of items) { if (!it.t) continue; const s = el('span'); const i = el('i', it.cls || ''); if (it.c) i.style.background = it.c; if (it.op) i.style.opacity = it.op; s.append(i, it.t); lg.appendChild(s); }
  return lg;
}

// ---------------- generic chart for bar / line / count metrics
function drawTrend(box, def, view, p, color) {
  const cfg = VC[view], e = Math.min(p.b, LAST), isCount = def.k === 'count', isBar = def.k === 'bar' || isCount;
  const agg = (s, b) => { const r = win(def.key, s, b); return isCount ? (r.n ? r.sum : null) : r.v; };
  const ctx = buckets(cfg.ctx, p.a, p.b).map(bk => ({ ...bk, v: bk.s > LAST ? null : agg(bk.s, Math.min(bk.e, LAST)), n: win(def.key, bk.s, bk.e).n }));
  const r = isCount ? 0 : cfg.r, T = r ? trend(def.key, r) : null;
  const tl = []; if (T) for (let i = Math.max(p.a, 0); i <= e; i++) tl.push({ i, v: T[i] });
  const base30 = !r && !isCount ? win(def.key, e - 29, e).v : null;
  let goal = null; if (def.goal) for (let i = Math.max(p.a, 0); i <= e; i++) { const g = get(def.goal, i); if (g != null) goal = g; }
  const tgt = def.target != null ? def.target : null, bad = css('--bad');
  const vals = [...ctx.map(c => c.v), ...tl.map(t => t.v), base30, goal, tgt, def.floor];
  const dom = def.u === 'clock' ? clockDom(vals) : def.u === 'dur' ? durDom(vals) : yDom(vals, isBar, 3);
  const F = frame(box, view, p, dom, { yFmt: axisFmt(def.u), strip: true, label: def.t });
  const faint = r ? (cfg.ctx === 'day' ? .3 : .2) : 1, targets = [];
  if (isBar) {
    ctx.forEach(c => {
      const cx = F.x((c.s + c.e) / 2), bw = Math.max(2, Math.min(22, F.pxDay * (c.e - c.s + 1) * .62));
      if (c.v != null && c.v > 0) sv('path', { d: barPath(cx, F.base, F.y(c.v), bw), fill: tgt != null && c.v < tgt ? bad : color, 'fill-opacity': faint, class: 'grow' }, F.g);
      targets.push({ x: cx, c, ty: c.v != null ? F.y(c.v) : F.base });
    });
  } else {
    const pts = ctx.map(c => c.v == null ? null : [F.x((c.s + c.e) / 2), F.y(c.v)]);
    if (!r) runs(pts, 2).forEach(rr => rr.length > 1 && sv('path', { d: smooth(rr), fill: 'none', stroke: color, 'stroke-width': 1.75, 'stroke-opacity': .5, class: 'draw' }, F.g));
    const surf = css('--card');
    pts.forEach(pt => pt && sv('circle', { cx: pt[0], cy: pt[1], r: r ? (cfg.ctx === 'day' ? 2.6 : 3) : 4.5, fill: color, 'fill-opacity': r ? .32 : 1, stroke: r ? 'none' : surf, 'stroke-width': 2, class: 'draw' }, F.g));
    ctx.forEach(c => targets.push({ x: F.x((c.s + c.e) / 2), c, ty: c.v != null ? F.y(c.v) : null }));
  }
  const refs = [];
  if (goal != null) refs.push([goal, 'Goal ' + U[def.u].c(goal)]);
  if (tgt != null) refs.unshift([tgt, 'Target ' + U[def.u].c(tgt)]);
  if (base30 != null) refs.push([base30, '30-day avg ' + U[def.u].c(base30)]);
  refs.forEach(([v, txt], k) => { const gy = F.y(v); sv('line', { class: 'refline', x1: 0, x2: F.pw, y1: gy, y2: gy }, F.g); const t = sv('text', { class: 'reflab halo', x: k ? F.pw - 4 : 4, y: gy - 6, 'text-anchor': k ? 'end' : 'start' }, F.g); t.textContent = txt; t.dataset.ly = gy; });
  if (T) { const lr = [...tl].reverse().find(t => t.v != null); trendLine(F, tl.map(t => t.v == null ? null : [F.x(t.i), F.y(t.v)]), color, lr ? U[def.u].c(lr.v) : null, tgt != null ? F.y(tgt) : null); }
  F.g.querySelectorAll('.reflab').forEach(t => F.g.appendChild(t)); declutter(F);
  const stripVals = buckets(cfg.strip, p.a, p.b).map(bk => bk.s > LAST ? null : agg(bk.s, Math.min(bk.e, LAST)));
  strip(F, view, p, agg, def.u === 'clock' ? clockFmts(stripVals) : fmtsFor(def.u), color, isCount ? 'TOTAL' : null);
  hoverLayer(F, targets, (t, cx, cy) => {
    const c = t.c, rw = [];
    const lab = isCount ? 'total' : (cfg.ctx === 'day' ? (def.night ? 'that night' : 'that day') : (cfg.ctx === 'week' ? 'weekly avg' : 'monthly avg'));
    rw.push(c.v == null ? { v: 'No data' } : { v: fmt(def.u, c.v), l: lab, c: color, faint: !!r });
    if (T && c.s <= LAST) { const tv = T[Math.min(Math.round((c.s + c.e) / 2), e)]; if (tv != null) rw.push({ v: fmt(def.u, tv), l: 'trend', c: color }); }
    showTip(cx, cy, bucketLabel(c, cfg.ctx), rw, c.v != null && cfg.ctx !== 'day' && !isCount ? `${c.n} ${def.night ? 'night' : 'day'}${c.n === 1 ? '' : 's'} with data` : null);
  });
  return { r, base30: base30 != null, goal: goal != null, ctx: cfg.ctx, target: tgt != null };
}
function trendLegend(info, color, def, view) {
  const items = [];
  if (info.r) items.push({ t: `Trend, ${VC[view].tn}`, c: color, cls: 'ln' });
  if (def.k !== 'count') items.push({ t: CTXNAME[info.ctx], c: color, op: info.r ? .35 : 1 });
  else items.push({ t: info.ctx === 'day' ? 'Each day' : info.ctx === 'week' ? 'Weekly total' : 'Monthly total', c: color });
  if (info.base30) items.push({ t: 'Average of the last 30 days', cls: 'hl' });
  if (info.goal) items.push({ t: 'Ring goal', cls: 'hl' });
  if (info.target) items.push({ t: 'Target', cls: 'hl' }, { t: 'Below target', c: css('--bad') });
  return legend(items);
}

// ---------------- band anatomy
function band(def, color) {
  const c = el('section', 'card band'), rail = el('div', 'rail'), main = el('div', 'main');
  rail.appendChild(el('h3', null, def.t));
  const dtx = def.dirText != null ? def.dirText : dirText(def);
  if (dtx) {
    const tag = el('div', 'tag');
    if (def.dir) tag.insertAdjacentHTML('beforeend', def.dir > 0 ? ARROW_UP : ARROW_DN);
    else { const i = el('i'); i.style.background = color; tag.appendChild(i); }
    tag.appendChild(document.createTextNode(dtx)); rail.appendChild(tag);
  }
  if (def.ex) rail.appendChild(el('p', 'ex', def.ex));
  c.append(rail, main);
  return { c, rail, main };
}
function hero(rail, label, parts, info, cap) {
  const h = el('div', 'hero');
  h.appendChild(el('div', 'lab', label));
  const v = el('div', 'val', parts[0]); if (parts[1]) v.appendChild(el('small', null, parts[1])); h.appendChild(v);
  if (info) { const d = el('div', 'delta'); d.append(chipEl(info), el('span', 'cap', cap)); h.appendChild(d); }
  rail.appendChild(h);
}
// rows: [{l, v:[num,unit]|string, x: chip element | string}]
function rows(rail, list) {
  const g = el('div', 'rows');
  for (const r of list) {
    const l = el('div', 'l'); if (r.l instanceof Node) l.appendChild(r.l); else l.textContent = r.l; l.title = typeof r.l === 'string' ? r.l : ''; g.appendChild(l);
    const v = el('div', 'v'); if (Array.isArray(r.v)) { v.appendChild(document.createTextNode(r.v[0])); if (r.v[1]) v.appendChild(el('small', null, r.v[1])); } else v.textContent = r.v; g.appendChild(v);
    const x = el('div', 'x'); if (r.x instanceof Node) x.appendChild(r.x); else if (r.x) x.appendChild(el('span', 'd', r.x)); g.appendChild(x);
  }
  rail.appendChild(g);
  return g;
}
const chartBox = () => el('div', 'chart');
const RENDER = [];
function mount(box, fn) { RENDER.push(() => { box.__F = null; fn(box); finalize(box.__F); }); }
function daysIn(p) { return Math.max(0, Math.min(p.b, LAST) - Math.max(p.a, 0) + 1); }
const dateShort = (i, view) => dShort(i) + (view === 'All' || view === '6M' ? ', ' + dYr(i) : '');
function windowRows(def, e, isCount) {
  const out = [], f = (a, b) => { const r = win(def.key, a, b); return isCount ? r.sum : r.v; };
  for (const n of [30, 90]) {
    const cur = win(def.key, e - n + 1, e); if (!cur.n && !isCount) continue;
    const v = f(e - n + 1, e), prevN = win(def.key, e - 2 * n + 1, e - n).n, pv = prevN || isCount ? f(e - 2 * n + 1, e - n) : null;
    const info = deltaInfo(def.u, def.dir, v, pv);
    out.push({ l: `Last ${n} ${def.night ? 'nights' : 'days'}${isCount ? ', total' : ''}`, v: F1(def.u, v), x: info ? chipEl(info, `vs the ${n} ${def.night ? 'nights' : 'days'} before: ${fmt(def.u, pv)}`) : '' });
  }
  return out;
}

function metricBand(defIn, view, p, chColor) {
  const def = typeof defIn === 'string' ? DEF[defIn] : { ...DEF[defIn.key], ...defIn };
  const color = css(def.color || chColor);
  if (def.k === 'points') return pointsBand(def, view, p, color);
  const e = Math.min(p.b, LAST), isCount = def.k === 'count', cur = win(def.key, p.a, e);
  if (!cur.n) return { missing: def.t };
  const B = band(def, color);
  const pp = prevPeriod(view, p), v = isCount ? cur.sum : cur.v;
  let pv = null; if (pp) { const r = win(def.key, pp.a, pp.b); pv = isCount ? r.sum : r.v; }
  const lab = isCount ? 'Total' : def.night ? 'Average per night' : def.k === 'bar' ? 'Daily average' : 'Average';
  hero(B.rail, lab, F1(def.u, v), pp ? deltaInfo(def.u, def.dir, v, pv) : null, pp ? pp.label : '');
  const list = windowRows(def, e, isCount);
  if (!def.night && def.k === 'bar' && ['km', 'mi', 'min', 'floors'].includes(def.u) && view !== 'W') list.push({ l: 'Total in period', v: F1(def.u, cur.sum), x: '' });
  if (!isCount && cur.n > 1) {
    const x = extremes(def.key, p.a, e), clk = def.u === 'clock';
    list.push({ l: clk ? 'Earliest' : def.night ? 'Lowest night' : 'Lowest day', v: F1(def.u, x.lo), x: dateShort(x.loI, view) });
    list.push({ l: clk ? 'Latest' : def.night ? 'Highest night' : 'Highest day', v: F1(def.u, x.hi), x: dateShort(x.hiI, view) });
  }
  rows(B.rail, list);
  if (!isCount) B.rail.appendChild(el('div', 'meta', `Recorded on ${cur.n} of ${daysIn(p)} ${def.night ? 'nights' : 'days'}`));
  const b = chartBox(), lg = el('div'); B.main.append(b, lg);
  mount(b, bx => { const info = drawTrend(bx, def, view, p, color); lg.replaceChildren(trendLegend(info, color, def, view)); });
  return B.c;
}
function pointsIn(key, a, b) { return (PTS[key] || []).filter(q => q.i >= a && q.i <= b); }
function pointsBand(def, view, p, color, extraRows) {
  const all = PTS[def.key] || []; if (!all.length) return null;
  const e = Math.min(p.b, LAST), pts = pointsIn(def.key, p.a, e);
  const before = all.filter(q => q.i <= e), last = before[before.length - 1] || all[0], prevR = before.filter(q => q.i < last.i).pop();
  const B = band(def, color);
  hero(B.rail, (pts.length ? 'Latest · ' : 'Most recent · ') + dShort(last.i) + ', ' + dYr(last.i), F1(def.u, last.v), prevR ? deltaInfo(def.u, def.dir, last.v, prevR.v) : null, prevR ? `vs ${dShort(prevR.i)}, ${dYr(prevR.i)} reading` : '');
  const list = [{ l: 'Readings in period', v: String(pts.length), x: '' }];
  if (pts.length > 1) {
    const lo = pts.reduce((a, b) => b.v < a.v ? b : a), hi = pts.reduce((a, b) => b.v > a.v ? b : a);
    list.push({ l: 'First in period', v: F1(def.u, pts[0].v), x: dateShort(pts[0].i, view) }, { l: 'Lowest', v: F1(def.u, lo.v), x: dateShort(lo.i, view) }, { l: 'Highest', v: F1(def.u, hi.v), x: dateShort(hi.i, view) });
  }
  if (extraRows) list.push(...extraRows);
  rows(B.rail, list);
  if (!pts.length) { B.main.appendChild(el('div', 'empty', `No readings in this period. The most recent was on ${dLong(last.i)}.`)); return B.c; }
  const b = chartBox(); B.main.appendChild(b);
  mount(b, bx => drawPoints(bx, def, view, p, color));
  B.main.appendChild(pointsTrendOn(def, view, p) ? legend([{ t: `Trend, ${VC[view].tn}`, c: color, cls: 'ln' }, { t: 'Each reading', c: color, op: .35 }]) : legend([{ t: 'Each reading', c: color }]));
  return B.c;
}
// Trend for occasional readings: the same tapering weights as daily metrics (weight falls to zero
// at +/-2r days), averaged over the readings that fall in the window. Needs at least 3 readings.
function pointTrend(key, r, a, b) {
  const all = PTS[key] || [], H = 2 * r, out = [];
  for (let i = a; i <= b; i++) {
    let sw = 0, sv2 = 0, n = 0;
    for (const q of all) { const d = Math.abs(q.i - i); if (d > H) continue; const w = H + 1 - d; sw += w; sv2 += w * q.v; n++; }
    out.push({ i, v: n >= 3 ? sv2 / sw : null });
  }
  return out;
}
function pointsTrendOn(def, view, p) { const cfg = VC[view]; return !!cfg.r && pointsIn(def.key, p.a, Math.min(p.b, LAST)).length >= 6; }
function drawPoints(box, def, view, p, color, key2, color2) {
  const e = Math.min(p.b, LAST), pts = pointsIn(def.key, p.a, e), pts2 = key2 ? pointsIn(key2, p.a, e) : [];
  const withTrend = !key2 && pointsTrendOn(def, view, p);
  const tl = withTrend ? pointTrend(def.key, VC[view].r, Math.max(p.a, 0), e) : [];
  const F = frame(box, view, p, yDom([...pts, ...pts2].map(q => q.v).concat(tl.map(t => t.v)), false, 3), { yFmt: axisFmt(def.u), label: def.t });
  const surf = css('--card');
  const plot = (arr, c) => {
    const xy = dedupeX(arr.map(q => [F.x(q.i), F.y(q.v)]));
    if (!withTrend && xy.length > 1) sv('path', { d: smooth(xy), fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-opacity': .5, class: 'draw' }, F.g);
    arr.forEach(q => sv('circle', { cx: F.x(q.i), cy: F.y(q.v), r: withTrend ? 3.2 : 4.5, fill: c, 'fill-opacity': withTrend ? .35 : 1, stroke: withTrend ? 'none' : surf, 'stroke-width': 2, class: 'draw' }, F.g));
  };
  plot(pts, color); if (key2) plot(pts2, color2);
  if (withTrend) { const lr = [...tl].reverse().find(t => t.v != null); trendLine(F, tl.map(t => t.v == null ? null : [F.x(t.i), F.y(t.v)]), color, lr ? U[def.u].c(lr.v) : null); }
  hoverLayer(F, pts.map((q, k) => ({ x: F.x(q.i), q, q2: pts2[k], ty: F.y(q.v) })), (t, cx, cy) => {
    const rw = [{ v: fmt(def.u, t.q.v), c: color, l: key2 ? 'systolic' : 'reading', faint: withTrend }];
    if (t.q2) rw.push({ v: fmt(def.u, t.q2.v), c: color2, l: 'diastolic' });
    if (withTrend) { const tv = tl.find(z => z.i === t.q.i); if (tv && tv.v != null) rw.push({ v: fmt(def.u, tv.v), l: 'trend', c: color }); }
    showTip(cx, cy, `${dLong(t.q.i)} · ${t.q.d.slice(11)}`, rw);
  });
}
function dedupeX(xy) { const out = []; for (const p of xy) { if (out.length && Math.abs(out[out.length - 1][0] - p[0]) < .5) out[out.length - 1][1] = (out[out.length - 1][1] + p[1]) / 2; else out.push(p.slice()); } return out; }

// ---------------- heart rate range
function rangeBand(view, p, chColor) {
  const color = css(chColor), e = Math.min(p.b, LAST);
  const lo = win('hrMin', p.a, e), hi = win('hrMax', p.a, e), mid = win('hrAvg', p.a, e);
  if (!lo.n) return { missing: 'Heart rate' };
  const def = { key: 'hrAvg', t: 'Heart rate', u: 'bpm', dir: 0, dirText: 'Daily low to high', ex: 'Your lowest and highest heart rate each day, and the all-day average. A wide range is normal on active days.' };
  const B = band(def, color), pp = prevPeriod(view, p);
  hero(B.rail, 'All-day average', F1('bpm', mid.v), pp ? deltaInfo('bpm', 0, mid.v, win('hrAvg', pp.a, pp.b).v) : null, pp ? pp.label : '');
  const xl = extremes('hrMin', p.a, e), xh = extremes('hrMax', p.a, e);
  rows(B.rail, [{ l: 'Average daily low', v: F1('bpm', lo.v), x: '' }, { l: 'Average daily high', v: F1('bpm', hi.v), x: '' }, { l: 'Lowest reading', v: F1('bpm', xl.lo), x: dateShort(xl.loI, view) }, { l: 'Highest reading', v: F1('bpm', xh.hi), x: dateShort(xh.hiI, view) }]);
  B.rail.appendChild(el('div', 'meta', `Recorded on ${lo.n} of ${daysIn(p)} days`));
  const cfg = VC[view], b = chartBox(); B.main.appendChild(b);
  B.main.appendChild(cfg.r ? legend([{ t: `Average, trend ${cfg.tn}`, c: color, cls: 'ln' }, { t: 'Low to high, trend', c: color, op: .22 }, { t: cfg.ctx === 'day' ? 'Each day, low to high' : '', c: color, op: .45 }]) : legend([{ t: 'Each day, low to high', c: color }, { t: 'All-day average', cls: 'hl' }]));
  mount(b, bx => {
    const ctx = buckets(cfg.ctx, p.a, p.b).map(bk => ({ ...bk, lo: win('hrMin', bk.s, bk.e).v, hi: win('hrMax', bk.s, bk.e).v, mid: win('hrAvg', bk.s, bk.e).v }));
    const r = cfg.r, TL = r ? trend('hrMin', r) : null, TH = r ? trend('hrMax', r) : null, TM = r ? trend('hrAvg', r) : null, idx = [];
    if (r) for (let i = Math.max(p.a, 0); i <= e; i++) idx.push(i);
    const vals = cfg.ctx === 'day' ? ctx.flatMap(c => [c.lo, c.hi]) : idx.flatMap(i => [TL[i], TH[i]]);
    const F = frame(bx, view, p, yDom(vals, false, 4), { yFmt: v => nf(v), strip: true, label: 'Heart rate' });
    const targets = [];
    if (cfg.ctx === 'day') ctx.forEach(c => { const cx = F.x(c.s), cw = Math.max(3, Math.min(10, F.pxDay * .5)); if (c.lo != null) capsule(F.g, cx, F.y(c.lo), F.y(c.hi), cw, color, r ? .35 : 1); if (!r && c.mid != null) sv('line', { x1: cx - cw, x2: cx + cw, y1: F.y(c.mid), y2: F.y(c.mid), stroke: css('--card'), 'stroke-width': 2 }, F.g); targets.push({ x: cx, c, ty: c.hi != null ? F.y(c.hi) : null }); });
    else ctx.forEach(c => targets.push({ x: F.x((c.s + c.e) / 2), c, ty: c.hi != null ? F.y(c.hi) : null }));
    if (r) {
      const up = idx.map(i => TH[i] == null ? null : [F.x(i), F.y(TH[i])]), dn = idx.map(i => TL[i] == null ? null : [F.x(i), F.y(TL[i])]), rd = runs(dn);
      runs(up).forEach((u, k) => { const l2 = rd[k]; if (!l2 || u.length < 2) return; sv('path', { d: poly(u) + poly([...l2].reverse()).replace(/^M/, 'L') + 'Z', fill: color, 'fill-opacity': cfg.ctx === 'day' ? .1 : .16, class: 'draw' }, F.g); });
      const li = [...idx].reverse().find(i => TM[i] != null);
      trendLine(F, idx.map(i => TM[i] == null ? null : [F.x(i), F.y(TM[i])]), color, li != null ? nf(TM[li]) : null);
    }
    strip(F, view, p, (s, b2) => win('hrAvg', s, b2).v, fmtsFor('bpm'), color);
    hoverLayer(F, targets, (t, cx, cy) => {
      const c = t.c; if (c.lo == null) return showTip(cx, cy, bucketLabel(c, cfg.ctx), [{ v: 'No data' }]);
      const rw = [{ v: `${nf(c.lo)}–${nf(c.hi)} bpm`, l: cfg.ctx === 'day' ? 'low–high' : 'avg daily low–high', c: color, faint: true }, { v: `${nf(c.mid)} bpm`, l: 'all-day average' }];
      if (r) { const tv = TM[Math.min(Math.round((c.s + c.e) / 2), e)]; if (tv != null) rw.push({ v: `${nf(tv)} bpm`, l: 'trend', c: color }); }
      showTip(cx, cy, bucketLabel(c, cfg.ctx), rw);
    });
  });
  return B.c;
}

function renderBands(root, list, view, p, chColor) {
  const missing = []; let pendingSec = null;
  for (const item of list) {
    if (item && item.sec) { pendingSec = item.sec; continue; }
    const r = item && item.range ? rangeBand(view, p, chColor) : metricBand(item, view, p, chColor);
    if (!r) continue;
    if (r.missing) { missing.push(r.missing); continue; }
    if (pendingSec) { root.appendChild(el('div', 'section-label', pendingSec)); pendingSec = null; }
    root.appendChild(r);
  }
  return missing;
}

// ---------------- Sleep
const STAGES = [['deep', 'Deep', '--st-deep'], ['core', 'Core', '--st-core'], ['rem', 'REM', '--st-rem'], ['unspec', 'Asleep, no stage', '--st-unspec']];
function sleepChapter(root, view, p, chColor) {
  const e = Math.min(p.b, LAST), asl = win('sl_asleep', p.a, e);
  if (!asl.n) { root.appendChild(el('div', 'missing', 'No sleep was recorded in this period.')); return; }
  const cfg = VC[view], color = css(chColor), ink = css('--ink');
  const goalList = D.meta.sleepGoal || [];
  const TGT = DEF.sl_asleep.target, FLOOR = DEF.sl_asleep.floor, bad = css('--bad');
  const colors = Object.fromEntries(STAGES.map(s => [s[0], css(s[2])]));
  const pp = prevPeriod(view, p);
  // 1. time asleep
  {
    const def = DEF.sl_asleep, B = band(def, color);
    hero(B.rail, 'Average per night', F1('dur', asl.v), pp ? deltaInfo('dur', 1, asl.v, win('sl_asleep', pp.a, pp.b).v) : null, pp ? pp.label : '');
    const x = extremes('sl_asleep', p.a, e);
    let under = 0, hitN = 0; for (let i = Math.max(p.a, 0); i <= e; i++) { const v = get('sl_asleep', i); if (v == null) continue; if (v < FLOOR) under++; if (v >= TGT) hitN++; }
    rows(B.rail, [...windowRows(def, e, false), { l: `Nights at ${hTxt(TGT)} or more`, v: `${hitN} of ${asl.n}`, x: '' }, { l: `Nights under ${hTxt(FLOOR)}`, v: String(under), x: under ? el('span', 'chip bad', 'below floor') : '' }, { l: 'Shortest night', v: fmtDur(x.lo), x: dateShort(x.loI, view) }]);
    B.rail.appendChild(el('div', 'meta', `Recorded on ${asl.n} of ${daysIn(p)} nights`));
    const stacked = cfg.ctx === 'day', b = chartBox(); B.main.appendChild(b);
    const items = [];
    if (cfg.r) items.push({ t: `Trend, ${cfg.tn}`, c: stacked ? ink : color, cls: 'ln' });
    if (stacked) STAGES.forEach(([k, n]) => { if (win('sl_' + k, p.a, e).sum > 0) items.push({ t: n, c: colors[k] }); });
    else items.push({ t: CTXNAME[cfg.ctx], c: color, op: .35 });
    items.push({ t: 'Below target', c: bad, cls: 'ln' }, { t: `Target ${hTxt(TGT)}`, cls: 'hl' }, { t: `Under ${hTxt(FLOOR)}`, c: bad, op: .25 });
    B.main.appendChild(legend(items));
    mount(b, bx => {
      const ctx = buckets(cfg.ctx, p.a, p.b).map(bk => { const w = win('sl_asleep', bk.s, bk.e), o = { ...bk, n: w.n, tot: w.v }; STAGES.forEach(([k]) => o[k] = win('sl_' + k, bk.s, bk.e).v || 0); return o; });
      const r = cfg.r, T = r ? trend('sl_asleep', r) : null, idx = []; if (r) for (let i = Math.max(p.a, 0); i <= e; i++) idx.push(i);
      const F = frame(bx, view, p, durDom([...ctx.map(c => c.tot), ...idx.map(i => T[i]), TGT]), { yFmt: U.dur.ax, strip: true, label: 'Time asleep' });
      const targets = [];
      ctx.forEach(s => {
        const cx = F.x((s.s + s.e) / 2), bw = Math.max(2, Math.min(22, F.pxDay * (s.e - s.s + 1) * .62));
        if (s.n) {
          if (stacked) {
            let acc = 0; const parts = STAGES.filter(([k]) => s[k] > 0);
            parts.forEach(([k], j) => { const y0 = F.y(acc), y1 = F.y(acc + s[k]); acc += s[k]; const gap = j > 0 ? 1 : 0; if (j === parts.length - 1) sv('path', { d: barPath(cx, y0 - gap, y1, bw), fill: colors[k], 'fill-opacity': r ? .7 : 1, class: 'grow' }, F.g); else sv('rect', { x: cx - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1 - gap), fill: colors[k], 'fill-opacity': r ? .7 : 1, class: 'grow' }, F.g); });
          } else sv('path', { d: barPath(cx, F.base, F.y(s.tot), bw), fill: s.tot < TGT ? bad : color, 'fill-opacity': .2, class: 'grow' }, F.g);
        }
        targets.push({ x: cx, s, ty: s.n ? F.y(s.tot) : null });
      });
      { const gy = F.y(TGT); sv('line', { class: 'refline', x1: 0, x2: F.pw, y1: gy, y2: gy }, F.g); const t = sv('text', { class: 'reflab halo', x: 4, y: gy - 6 }, F.g); t.textContent = 'Target ' + hS(TGT); t.dataset.ly = gy; }
      { const fy = F.y(FLOOR); sv('rect', { x: 0, y: fy, width: F.pw, height: Math.max(0, F.base - fy), fill: bad, 'fill-opacity': .06 }, F.g.firstChild ? F.g : F.g); F.g.insertBefore(F.g.lastChild, F.g.firstChild); sv('line', { x1: 0, x2: F.pw, y1: fy, y2: fy, stroke: bad, 'stroke-width': 1, 'stroke-opacity': .45 }, F.g); const t = sv('text', { class: 'reflab halo', x: 4, y: fy + 14, fill: bad }, F.g); t.textContent = 'Floor ' + hS(FLOOR); t.dataset.ly = fy + 20; t.style.fill = bad; }
      if (r) { const li = [...idx].reverse().find(i => T[i] != null); trendLine(F, idx.map(i => T[i] == null ? null : [F.x(i), F.y(T[i])]), stacked ? ink : color, li != null ? fmtDurC(T[li]) : null, F.y(TGT)); }
      F.g.querySelectorAll('.reflab').forEach(t => F.g.appendChild(t)); declutter(F);
      strip(F, view, p, (s, b2) => win('sl_asleep', s, b2).v, fmtsFor('dur'), color);
      hoverLayer(F, targets, (t, cx, cy) => {
        const s = t.s; if (!s.n) return showTip(cx, cy, bucketLabel(s, cfg.ctx), [{ v: 'No sleep recorded' }]);
        const rw = [{ v: fmtDur(s.tot), l: cfg.ctx === 'day' ? 'asleep' : 'avg asleep' }];
        if (stacked) [...STAGES].reverse().forEach(([k, n]) => s[k] > 0 && rw.push({ v: fmtDurC(s[k]), l: n, c: colors[k] }));
        if (r) { const tv = T[Math.min(Math.round((s.s + s.e) / 2), e)]; if (tv != null) rw.push({ v: fmtDur(tv), l: 'trend', c: stacked ? ink : color }); }
        showTip(cx, cy, bucketLabel(s, cfg.ctx), rw, cfg.ctx !== 'day' ? `${s.n} night${s.n > 1 ? 's' : ''} recorded` : null);
      });
    });
    root.appendChild(B.c);
  }
  // 2. schedule
  {
    const bed = win('sl_bed', p.a, e), wake = win('sl_wake', p.a, e), mid = win('sl_mid', p.a, e), q = quantiles('sl_mid', p.a, e, [.25, .75]);
    const def = { key: 'sl_mid', t: 'Sleep schedule', u: 'clock', dir: 0, night: true, dirText: 'Regular is better', ex: 'When sleep began and ended. The line is the midpoint, halfway between. A narrower, flatter band means a steadier schedule. Rows below are averages; "middle half" is where half of your nights’ midpoints fell.' };
    const B = band(def, color);
    hero(B.rail, 'Average midpoint', F1('clock', mid.v), pp ? deltaInfo('clock', 0, mid.v, win('sl_mid', pp.a, pp.b).v) : null, pp ? pp.label : '');
    const list = [{ l: 'Bedtime', v: fmtClock(bed.v), x: '' }, { l: 'Wake time', v: fmtClock(wake.v), x: '' }];
    if (q) list.push({ l: 'Middle half', v: `${fmtClockC(q[0])}–${fmtClockC(q[1])}`, x: '' });
    list.push(...windowRows(def, e, false));
    rows(B.rail, list);
    B.rail.appendChild(el('div', 'meta', `Recorded on ${mid.n} of ${daysIn(p)} nights`));
    const b = chartBox(); B.main.appendChild(b);
    B.main.appendChild(legend(cfg.r ? [{ t: `Midpoint, trend ${cfg.tn}`, c: color, cls: 'ln' }, { t: 'Bedtime to wake time, trend', c: color, op: .25 }, { t: cfg.ctx === 'day' ? 'Each night' : '', c: color, op: .4 }] : [{ t: 'Asleep, first to last minute', c: color, op: .45 }, { t: 'Midpoint', c: color, cls: 'ln' }]));
    mount(b, bx => {
      const ctx = buckets(cfg.ctx, p.a, p.b).map(bk => ({ ...bk, bed: win('sl_bed', bk.s, bk.e), wake: win('sl_wake', bk.s, bk.e), mid: win('sl_mid', bk.s, bk.e) }));
      const r = cfg.r, TB = r ? trend('sl_bed', r) : null, TW = r ? trend('sl_wake', r) : null, TM = r ? trend('sl_mid', r) : null, idx = [];
      if (r) for (let i = Math.max(p.a, 0); i <= e; i++) idx.push(i);
      const vals = cfg.ctx === 'day' ? ctx.flatMap(s => [s.bed.v, s.wake.v]) : idx.flatMap(i => [TB[i], TW[i]]);
      const nn = vals.filter(v => v != null); if (!nn.length) return;
      const lo = Math.min(...nn), hi = Math.max(...nn), stepH = (hi - lo) > 900 ? 360 : (hi - lo) > 420 ? 240 : 120;
      const a0 = Math.floor(lo / stepH) * stepH, b0 = Math.ceil(hi / stepH) * stepH, t = [];
      for (let v = a0; v <= b0; v += stepH) t.push(v);
      const F = frame(bx, view, p, { a: a0, b: b0, t }, { yFmt: fmtClockAxis, invert: true, strip: true, label: 'Sleep schedule' });
      const targets = [];
      if (cfg.ctx === 'day') ctx.forEach(s => {
        const cx = F.x(s.s), cw = Math.max(4, Math.min(12, F.pxDay * .55));
        if (s.bed.n) { capsule(F.g, cx, F.y(s.bed.v), F.y(s.wake.v), cw, color, r ? .28 : .45); if (!r) sv('line', { x1: cx - cw / 2 - 2, x2: cx + cw / 2 + 2, y1: F.y(s.mid.v), y2: F.y(s.mid.v), stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round' }, F.g); }
        targets.push({ x: cx, s, ty: s.bed.n ? F.y(s.bed.v) : null });
      }); else ctx.forEach(s => targets.push({ x: F.x((s.s + s.e) / 2), s, ty: s.bed.n ? F.y(s.bed.v) : null }));
      if (r) {
        const up = idx.map(i => TB[i] == null ? null : [F.x(i), F.y(TB[i])]), dn = idx.map(i => TW[i] == null ? null : [F.x(i), F.y(TW[i])]), rd = runs(dn);
        runs(up).forEach((u, k) => { const l2 = rd[k]; if (!l2 || u.length < 2) return; sv('path', { d: poly(u) + poly([...l2].reverse()).replace(/^M/, 'L') + 'Z', fill: color, 'fill-opacity': cfg.ctx === 'day' ? .1 : .16, class: 'draw' }, F.g); });
        const li = [...idx].reverse().find(i => TM[i] != null);
        trendLine(F, idx.map(i => TM[i] == null ? null : [F.x(i), F.y(TM[i])]), color, li != null ? fmtClockC(TM[li]) : null);
      }
      const sv2 = buckets(cfg.strip, p.a, p.b).map(bk => bk.s > LAST ? null : win('sl_mid', bk.s, Math.min(bk.e, LAST)).v);
      strip(F, view, p, (s, b2) => win('sl_mid', s, b2).v, clockFmts(), color, 'MID');
      hoverLayer(F, targets, (tg, cx, cy) => {
        const s = tg.s; if (!s.bed.n) return showTip(cx, cy, bucketLabel(s, cfg.ctx), [{ v: 'No sleep recorded' }]);
        const pre = cfg.ctx === 'day' ? '' : 'avg ';
        const rw = [{ v: fmtClock(s.bed.v), l: pre + 'bedtime' }, { v: fmtClock(s.mid.v), l: pre + 'midpoint', c: color, faint: !!r }, { v: fmtClock(s.wake.v), l: pre + 'wake time' }];
        if (r) { const tv = TM[Math.min(Math.round((s.s + s.e) / 2), e)]; if (tv != null) rw.push({ v: fmtClock(tv), l: 'midpoint trend', c: color }); }
        showTip(cx, cy, bucketLabel(s, cfg.ctx), rw, cfg.ctx !== 'day' ? `${s.bed.n} night${s.bed.n > 1 ? 's' : ''} recorded` : null);
      });
    });
    root.appendChild(B.c);
  }
  { const t = tapestryCard(view, p, chColor); if (t) root.appendChild(t); }
  // 3. stages
  {
    const mode = S.stageMode, STG = mode === 'labelled' ? STAGES.filter(([k]) => k !== 'unspec') : STAGES;
    const TYPICAL = { deep: 'about 10–20%', core: 'about 50–60%', rem: 'about 20–25%' };
    const def = { t: 'Sleep stages', dir: 0, dirText: 'No single target', ex: 'How each night divides between stages. Typical adult ranges are shown under each stage; they come from sleep-lab studies, and Apple Watch estimates stages, so treat them as a rough guide.' };
    const B = band(def, color);
    const seg = el('div', 'seg'); seg.style.cssText = 'margin-top:16px;align-self:flex-start';
    [['labelled', 'Labelled stages only'], ['all', 'All sleep']].forEach(([m, t]) => { const bt = el('button', null, t); bt.type = 'button'; bt.setAttribute('aria-pressed', mode === m); bt.addEventListener('click', () => { if (S.stageMode !== m) { S.stageMode = m; if (!OPT.ephemeral) try { localStorage.setItem('ha-stage', m); } catch (e) {} render(); } }); seg.appendChild(bt); });
    B.rail.appendChild(seg);
    const av = STG.map(([k, n]) => [k, n, win('sl_' + k, p.a, e).v || 0]).filter(x => x[2] > 0), tot = av.reduce((t, x) => t + x[2], 0);
    const hh = el('div', 'hero'); hh.style.marginTop = '16px'; hh.appendChild(el('div', 'lab', 'Average per night')); B.rail.appendChild(hh);
    const g = rows(B.rail, av.map(([k, n, v]) => {
      const s2 = el('span'); s2.style.cssText = 'display:flex;flex-direction:column;gap:1px';
      const top = el('span', 'srow'); const i = el('i'); i.style.background = colors[k]; top.append(i, n); s2.appendChild(top);
      if (TYPICAL[k]) { const t = el('small', null, 'typical ' + TYPICAL[k]); t.style.cssText = 'font-size:11.5px;color:var(--ink-3);padding-left:16px'; s2.appendChild(t); }
      return { l: s2, v: fmtDur(v), x: nf(v / tot * 100) + '%' };
    }));
    g.style.marginTop = '10px';
    const un = win('sl_unspec', p.a, e).v || 0, allT = tot + (mode === 'labelled' ? un : 0);
    if (mode === 'labelled' && un > 0) B.rail.appendChild(el('div', 'meta', `Leaves out ${fmtDur(un)} a night (${nf(un / allT * 100)}% of sleep) that the Watch did not label with a stage.`));
    if (cfg.ctx === 'day') {
      const bar = el('div', 'pbar');
      av.forEach(([k, n, v]) => { const d = el('div'); const f = v / tot; d.style.flex = String(f); d.style.background = colors[k]; d.style.color = onColor(colors[k]); if (f > .08) d.textContent = nf(f * 100) + '%'; d.title = `${n}: ${fmtDur(v)}`; bar.appendChild(d); });
      B.main.appendChild(bar);
      B.main.appendChild(legend(av.map(([k, n]) => ({ t: n, c: colors[k] }))));
    } else {
      const b = chartBox(); B.main.appendChild(b);
      mount(b, bx => {
        const bks = buckets(cfg.strip, p.a, p.b).filter(bk => bk.s <= LAST);
        const F = frame(bx, view, p, { a: 0, b: 1, t: [0, .25, .5, .75, 1] }, { yFmt: v => nf(v * 100) + '%', h: 170, label: 'Sleep stage share' });
        const targets = [], lab = `650 10.5px ${SANS}`, labels = [];
        bks.forEach(bk => {
          const vals = STG.map(([k]) => win('sl_' + k, bk.s, bk.e).v || 0), T = vals.reduce((a2, b2) => a2 + b2, 0);
          const x0 = F.x(bk.s) - F.pxDay / 2, x1 = F.x(Math.min(bk.e, p.b)) + F.pxDay / 2, cw = Math.min(x1 - x0 - 6, 72), cx = (x0 + x1) / 2;
          if (!T) return;
          let acc = 0;
          STG.forEach(([k], j) => { const f = vals[j] / T; if (!f) return; const y1 = F.y(acc + f), y0 = F.y(acc); acc += f; sv('rect', { x: cx - cw / 2, y: y1, width: cw, height: Math.max(0, y0 - y1 - 1.5), rx: 3, fill: colors[k], class: 'grow' }, F.g); const txt = nf(f * 100) + '%'; if (y0 - y1 > 15 && tw(txt, lab) < cw - 6) labels.push({ x: cx, y: (y0 + y1) / 2 + 3.8, txt, fill: onColor(colors[k]) }); });
          targets.push({ x: cx, bk, vals, T });
        });
        // labels go in their own layer, after every bar, so no segment can cover them
        const lg = sv('g', {}, F.g);
        labels.forEach(l => { const tx = sv('text', { x: l.x, y: l.y, 'text-anchor': 'middle', fill: l.fill, style: `font:${lab};font-variant-numeric:tabular-nums` }, lg); tx.textContent = l.txt; });
        hoverLayer(F, targets, (t, cx2, cy) => showTip(cx2, cy, bucketLabel(t.bk, cfg.strip), STG.map(([k, n], j) => ({ v: `${nf(t.vals[j] / t.T * 100)}% · ${fmtDurC(t.vals[j])}`, l: n, c: colors[k], f: t.vals[j] })).filter(x => x.f > 0).reverse()));
      });
      B.main.appendChild(legend(av.map(([k, n]) => ({ t: n, c: colors[k] }))));
    }
    root.appendChild(B.c);
  }
  ['sl_deep', 'sl_rem', 'sl_awake'].forEach(k => { const r = metricBand(k, view, p, chColor); if (r && !r.missing) root.appendChild(r); });
}

// ---------------- Activity extras
function ringSvg(vals, size) {
  const s = sv('svg', { viewBox: '0 0 44 44', width: size, height: size });
  [[19, '--ring-move'], [13.5, '--ring-ex'], [8, '--ring-stand']].forEach(([r, c], k) => {
    const col = css(c), f = vals[k];
    sv('circle', { cx: 22, cy: 22, r, fill: 'none', stroke: col, 'stroke-opacity': .2, 'stroke-width': 5 }, s);
    if (f != null && f > 0) { const C = 2 * Math.PI * r; sv('circle', { cx: 22, cy: 22, r, fill: 'none', stroke: col, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': `${C * Math.min(f, 1)} ${C}`, transform: 'rotate(-90 22 22)' }, s); }
  });
  return s;
}
function plainCard(title, sub) { const c = el('section', 'card plain'); const h = el('div', 'ph'); h.appendChild(el('h3', null, title)); if (sub) h.appendChild(el('div', 'meta', sub)); c.appendChild(h); return c; }
function ringsCard(view, p) {
  const c = plainCard('Activity rings', 'Move, Exercise and Stand against the goals you had set');
  const closed = [0, 0, 0]; let days = 0;
  const wrap = el('div', 'rings');
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(d => wrap.appendChild(el('div', 'wd', d)));
  const lead = (dt(p.a).getUTCDay() + 6) % 7;
  for (let k = 0; k < lead; k++) wrap.appendChild(el('div'));
  for (let i = p.a; i <= p.b; i++) {
    const cell = el('div', 'day'); cell.tabIndex = 0;
    const mv = get('active', i), mg = get('moveGoal', i), ex = get('exercise', i), eg = get('exerciseGoal', i), st = get('stand', i), sg = get('standGoal', i);
    const f = [mv != null && mg ? mv / mg : null, ex != null && eg ? ex / eg : null, st != null && sg ? st / sg : null];
    if (mv != null) { days++; f.forEach((x, k) => { if (x != null && x >= 1) closed[k]++; }); }
    cell.appendChild(ringSvg(f, 40)); cell.appendChild(el('span', null, String(dt(i).getUTCDate())));
    const show = () => { const r = cell.getBoundingClientRect(); if (mv == null) return showTip(r.left + r.width / 2, r.top, dLong(i), [{ v: i > LAST ? 'Not yet' : 'No data' }]); showTip(r.left + r.width / 2, r.top, dLong(i), [{ v: `${nf(mv)} / ${nf(mg)} kcal`, l: 'Move', c: css('--ring-move') }, { v: `${nf(ex)} / ${nf(eg)} min`, l: 'Exercise', c: css('--ring-ex') }, { v: `${nf(st)} / ${nf(sg)} hr`, l: 'Stand', c: css('--ring-stand') }]); };
    cell.addEventListener('pointerenter', show); cell.addEventListener('focus', show); cell.addEventListener('pointerleave', hideTip); cell.addEventListener('blur', hideTip);
    wrap.appendChild(cell);
  }
  const k = el('div', 'ringstats');
  [['Move closed', closed[0]], ['Exercise closed', closed[1]], ['Stand closed', closed[2]]].forEach(([l, v]) => { const d = el('div'); d.appendChild(el('div', 'lab', l)); const vv = el('div', 'v', String(v)); vv.appendChild(el('small', null, `of ${days} days`)); d.appendChild(vv); k.appendChild(d); });
  c.append(k, wrap);
  return c;
}
// ---------------- Calendar grid: every day of a year (Year view) or every year stacked (All time)
const CAL = { activity: 'steps', sleep: 'sl_asleep', stress: 'hrv', env: 'daylight', heart: 'rhr' };
function mixHex(a, b, t) { const P = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0x888888; return [n >> 16, (n >> 8) & 255, n & 255]; }; const A = P(a), B = P(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function calendarCard(key, view, p, chColor) {
  const def = DEF[key]; if (!def) return null;
  const vals = (D.daily[key] || []).filter(v => v != null).sort((x, y) => x - y); if (vals.length < 14) return null;
  const q = f => vals[Math.min(vals.length - 1, Math.floor(f * (vals.length - 1)))];
  const th = [q(.2), q(.4), q(.6), q(.8)], color = css(def.color || chColor), card = css('--card'), none = css('--heat-0');
  const shades = [.3, .48, .66, .84, 1].map(t => mixHex(card, color, t));
  const lvl = v => v == null ? -1 : v < th[0] ? 0 : v < th[1] ? 1 : v < th[2] ? 2 : v < th[3] ? 3 : 4;
  const years = []; if (view === 'All') for (let y = dYr(0); y <= dYr(LAST); y++) years.push(y); else years.push(dYr(p.a));
  const word = key === 'rhr' ? 'higher' : key === 'sl_asleep' ? 'longer' : 'more';
  const c = plainCard(view === 'All' ? `${def.t}, every day` : `${def.t}, every day of ${years[0]}`, `Each square is one day; darker means ${word}. Shades split your own days into fifths.`);
  const b = chartBox(); b.style.marginTop = '16px'; c.appendChild(b);
  const cf = U[def.u].c;
  c.appendChild(legend([{ t: 'No data', c: none }, { t: `Under ${cf(th[0])}`, c: shades[0] }, { t: `${cf(th[0])}–${cf(th[1])}`, c: shades[1] }, { t: `${cf(th[1])}–${cf(th[2])}`, c: shades[2] }, { t: `${cf(th[2])}–${cf(th[3])}`, c: shades[3] }, { t: `${cf(th[3])}+`, c: shades[4] }]));
  mount(b, bx => {
    const multi = years.length > 1, BW = bx.clientWidth, phone = BW < 560, cells = new Map();
    let svg, W, H, cs;
    const mk = (w, h) => { svg = sv('svg', { viewBox: `0 0 ${w} ${h}`, height: h, width: w, role: 'img', 'aria-label': c.querySelector('h3').textContent }); svg.style.width = w + 'px'; bx.replaceChildren(svg); bx.style.overflowX = w > BW + 1 ? 'auto' : ''; bx.scrollLeft = w; return sv('g', { class: 'ax' }, svg); };
    const cell = (i, x, y, w, h, fill, key2) => { const r = sv('rect', { x, y, width: w, height: h, rx: Math.min(3.5, Math.min(w, h) / 3), fill }, svg); r.dataset.i = i; if (key2) r.dataset.w = key2; return r; };
    if (!multi && phone) {
      // phone, one year: twelve small month calendars, three across
      const yr = years[0], gapM = 14, mw = (BW - gapM * 2) / 3, g2 = 2; cs = Math.floor((mw - 6 * g2) / 7);
      const mh = 16 + 6 * (cs + g2); W = BW; H = 4 * mh + 3 * gapM;
      const ax = mk(W, H);
      for (let m = 0; m < 12; m++) {
        const ox = (m % 3) * (mw + gapM), oy = Math.floor(m / 3) * (mh + gapM), a = di(yr, m, 1), z = di(yr, m + 1, 0), lead = (dt(a).getUTCDay() + 6) % 7;
        const t = sv('text', { x: ox, y: oy + 10 }, ax); t.textContent = MON[m];
        for (let i = a; i <= z; i++) { const k = i - a + lead, x = ox + (k % 7) * (cs + g2), y = oy + 16 + Math.floor(k / 7) * (cs + g2); if (i < 0 || i > LAST) { sv('rect', { x, y, width: cs, height: cs, rx: Math.min(3.5, cs / 3), fill: none, 'fill-opacity': .45 }, svg); continue; } const v = get(key, i), l = lvl(v); cells.set(i, cell(i, x, y, cs, cs, l < 0 ? none : shades[l])); }
      }
    } else if (multi && phone) {
      // phone, all years: one strip per year, each cell one week (average)
      const left = 40, cw = (BW - left) / 53, ch = 16, gapY = 8; cs = ch; W = BW; H = years.length * (ch + gapY) + 16;
      const ax = mk(W, H);
      ['Jan', 'Apr', 'Jul', 'Oct'].forEach((mn, q) => { const t = sv('text', { x: left + q * 13 * cw, y: 10 }, ax); t.textContent = mn; });
      years.forEach((yr, yk) => {
        const oy = 16 + yk * (ch + gapY), a = di(yr, 0, 1), z = di(yr, 11, 31);
        const t = sv('text', { x: 0, y: oy + 12, style: 'font-weight:650' }, ax); t.textContent = String(yr);
        for (let w0 = a, k = 0; w0 <= z; w0 += 7, k++) {
          const w1 = Math.min(z, w0 + 6); if (w1 < 0 || w0 > LAST) continue;
          const r0 = win(key, w0, w1), l = r0.n ? lvl(r0.v) : -1, r = cell(Math.max(w0, 0), left + k * cw + .5, oy, Math.max(1, cw - 1), ch, l < 0 ? none : shades[l], `${w0}:${w1}`);
          for (let i = w0; i <= w1; i++) cells.set(i, r);
        }
      });
    } else {
      // wide: GitHub-style year strips, stacked for all time
      const left = multi ? 46 : 26, cols = 54, gap = 3;
      cs = Math.max(7, Math.min(16, Math.floor((BW - left) / cols) - gap));
      const blockH = 16 + 7 * (cs + gap); W = left + cols * (cs + gap); H = years.length * blockH + (years.length - 1) * 12;
      const ax = mk(W, H);
      years.forEach((yr, yk) => {
        const oy = yk * (blockH + 12), a = di(yr, 0, 1), z = di(yr, 11, 31), lead = (dt(a).getUTCDay() + 6) % 7;
        if (multi) { const t = sv('text', { x: 0, y: oy + 16 + 3 * (cs + gap) + cs * .8, style: 'font-weight:650' }, ax); t.textContent = String(yr); }
        else ['M', '', 'W', '', 'F', '', ''].forEach((d, k) => { if (d) { const t = sv('text', { x: 0, y: oy + 16 + k * (cs + gap) + cs * .78 }, ax); t.textContent = d; } });
        let lastX = -99;
        for (let m = 0; m < 12; m++) { const i = di(yr, m, 1), col = Math.floor((i - a + lead) / 7), x = left + col * (cs + gap); if (x - lastX < 26) continue; const t = sv('text', { x, y: oy + 10 }, ax); t.textContent = MON[m]; lastX = x; }
        for (let i = a; i <= z; i++) {
          if (i < 0 || i > LAST) continue;
          const k = i - a + lead, x = left + Math.floor(k / 7) * (cs + gap), y = oy + 16 + (k % 7) * (cs + gap), v = get(key, i), l = lvl(v);
          cells.set(i, cell(i, x, y, cs, cs, l < 0 ? none : shades[l]));
        }
      });
    }
    const hl = sv('rect', { class: 'calhl', x: -99, y: -99, width: 0, height: 0, rx: 4, opacity: 0 }, svg);
    const me = { show(day) { const r = cells.get(Math.round(day)); if (!r) return me.hide(); hl.setAttribute('x', +r.getAttribute('x') - 2); hl.setAttribute('y', +r.getAttribute('y') - 2); hl.setAttribute('width', +r.getAttribute('width') + 4); hl.setAttribute('height', +r.getAttribute('height') + 4); hl.setAttribute('opacity', 1); }, hide() { hl.setAttribute('opacity', 0); } };
    me.off = () => { me.hide(); hideTip(); syncOff(me); if (ACTIVE === me) ACTIVE = null; };
    SYNC.push(me);
    const pickCell = r => {
      const bb = r.getBoundingClientRect();
      if (r.dataset.w) { const [w0, w1] = r.dataset.w.split(':').map(Number), rr = win(key, w0, w1); me.show(Math.max(w0, 0)); showTip(bb.left + bb.width / 2, bb.top, bucketLabel({ s: Math.max(w0, 0), e: Math.min(w1, LAST) }, 'week'), [{ v: rr.n ? fmt(def.u, rr.v) : 'No data', l: rr.n ? 'weekly avg' : '', c: rr.n ? shades[lvl(rr.v)] : null }]); syncTo(me, (w0 + w1) / 2); ACTIVE = me; return; }
      const i = +r.dataset.i, v = get(key, i); me.show(i); showTip(bb.left + bb.width / 2, bb.top, dLong(i), [{ v: v == null ? 'No data' : fmt(def.u, v), c: v == null ? null : shades[lvl(v)] }]); syncTo(me, i); ACTIVE = me;
    };
    svg.addEventListener('pointerover', ev => { const r = ev.target.closest && ev.target.closest('rect[data-i]'); if (r) pickCell(r); });
    svg.addEventListener('pointerdown', ev => { const r = ev.target.closest && ev.target.closest('rect[data-i]'); if (r) pickCell(r); });
    svg.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch') me.off(); });
  });
  return c;
}

// ---------------- Sleep tapestry: every night as a line from falling asleep to waking
function tapestryCard(view, p, chColor) {
  const e = Math.min(p.b, LAST), a0 = Math.max(p.a, 0), color = css(chColor), bad = css('--bad'), FLOOR = DEF.sl_asleep.floor;
  const days = []; for (let i = a0; i <= e; i++) days.push(i);
  const med = arr => { const v = arr.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  let rws;
  if (e - a0 > 400) rws = buckets('week', a0, e).map(bk => { const idx = []; for (let i = bk.s; i <= bk.e; i++) idx.push(i); const bed = med(idx.map(i => get('sl_bed', i))), wake = med(idx.map(i => get('sl_wake', i))); return { s: bk.s, e: bk.e, bed, wake, asl: win('sl_asleep', bk.s, bk.e).v, n: win('sl_asleep', bk.s, bk.e).n }; });
  else rws = days.map(i => ({ s: i, e: i, bed: get('sl_bed', i), wake: get('sl_wake', i), asl: get('sl_asleep', i), n: get('sl_asleep', i) == null ? 0 : 1 }));
  const withData = rws.filter(r => r.bed != null && r.wake != null);
  if (withData.length < 3) return null;
  const weekly = e - a0 > 400;
  const def = { t: 'Every night, bed to wake', dir: 0, dirText: 'Regular is better', ex: `Each line is ${weekly ? 'one week (the typical night of that week)' : 'one night'}, from falling asleep to waking up, oldest at the top. Straight edges mean a steady schedule; ragged edges show late nights and lie-ins.` };
  const B = band(def, color);
  const beds = withData.map(r => r.bed), wakes = withData.map(r => r.wake), mb = med(beds), mw = med(wakes);
  hero(B.rail, 'Typical night', [`${fmtClock(mb)}–${fmtClock(mw)}`, ''], null, '');
  const lateI = withData.reduce((x, r) => r.bed > x.bed ? r : x), earlyW = withData.reduce((x, r) => r.wake < x.wake ? r : x);
  const nd = r => weekly ? `wk of ${dShort(r.s)}` : dateShort(r.s, view);
  const under = weekly ? null : withData.filter(r => r.asl != null && r.asl < FLOOR).length;
  const list = [{ l: weekly ? 'Weeks shown' : 'Nights shown', v: String(withData.length), x: '' }, { l: 'Latest to sleep', v: fmtClock(lateI.bed), x: nd(lateI) }, { l: 'Earliest up', v: fmtClock(earlyW.wake), x: nd(earlyW) }];
  if (under != null) list.push({ l: `Nights under ${hTxt(FLOOR)}`, v: String(under), x: under ? el('span', 'chip bad', 'below floor') : '' });
  rows(B.rail, list);
  const b = chartBox(); B.main.appendChild(b);
  B.main.appendChild(legend([{ t: weekly ? 'Typical night of the week' : 'Asleep', c: color }, weekly ? {} : { t: `Night under ${hTxt(FLOOR)}`, c: bad }, { t: 'Your usual bed and wake time', cls: 'hl' }]));
  mount(b, bx => {
    const W = Math.max(bx.clientWidth, 260), mr = 50, pw = W - mr, top = 24, n = rws.length;
    const ph = Math.max(150, Math.min(330, n * 9)), rh = ph / n, H = top + ph + 26;
    const qv = (arr, f) => { const v = arr.slice().sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))]; };
    let lo = Math.floor((qv(beds, .02) - 20) / 60) * 60, hi = Math.ceil((qv(wakes, .98) + 20) / 60) * 60;
    if (hi - lo < 540) { const mid = (hi + lo) / 2; lo = Math.floor((mid - 270) / 60) * 60; hi = lo + 540; }
    const x = m => Math.max(0, Math.min(pw, (m - lo) / (hi - lo) * pw)), y = k => top + k * rh;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Sleep tapestry' }); bx.replaceChildren(svg);
    const ax = sv('g', { class: 'ax' }, svg), lf = `500 11px ${SANS}`, lw = tw('00:00', lf) + 10;
    let step = 60; while ((hi - lo) / step * lw > pw) step += 60; if (step === 300) step = 360; if (step > 360) step = 480;
    let lastR = -1e9;
    for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) { const X = x(m); sv('line', { class: 'gl', x1: X, x2: X, y1: top, y2: top + ph }, ax); let L = Math.max(0, Math.min(pw - lw + 10, X - (lw - 10) / 2)); if (L < lastR + 6) continue; const t = sv('text', { x: L, y: top + ph + 16 }, ax); t.textContent = hhmm(m); lastR = L + lw - 10; }
    // right-hand labels: months (long views) or dates (short views)
    let lastY = -99;
    rws.forEach((r, k) => { const d = dt(r.s), Y = y(k) + rh / 2; const first = weekly ? d.getUTCDate() <= 7 : n <= 14 || k === 0 || (n <= 62 ? d.getUTCDay() === 1 : d.getUTCDate() === 1); if (!first || Y - lastY < 14) return; const t = sv('text', { x: pw + 10, y: Y + 4 }, ax); t.textContent = n <= 14 ? `${WD[d.getUTCDay()]} ${d.getUTCDate()}` : weekly && d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : weekly ? MON[d.getUTCMonth()] : (k === 0 || d.getUTCMonth() === 0) && n > 40 ? `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` : `${MON[d.getUTCMonth()]}${n <= 40 ? ' ' + d.getUTCDate() : ''}`; lastY = Y; });
    const g = sv('g', {}, svg), gap = rh > 5 ? 1.5 : 0, h = Math.max(.8, rh - gap);
    rws.forEach((r, k) => { if (r.bed == null || r.wake == null) return; const X0 = x(r.bed), X1 = x(r.wake); sv('rect', { class: 'tap', x: X0, y: y(k) + gap / 2, width: Math.max(1, X1 - X0), height: h, rx: Math.min(3, h / 2), fill: !weekly && r.asl != null && r.asl < FLOOR ? bad : color, 'fill-opacity': .88 }, g).style.setProperty('--k', k); });
    const rf = `600 10.5px ${SANS}`, xb = x(mb), xw = x(mw);
    let lb = 'Usual bedtime ' + fmtClock(mb), lw2 = 'Usual wake ' + fmtClock(mw);
    if (xb - 5 - tw(lb, rf) < 0 || xw + 5 + tw(lw2, rf) > W || xw - xb < 12) { lb = 'Bed ' + fmtClock(mb); lw2 = 'Wake ' + fmtClock(mw); }
    const ref = (X, txt, anchor) => { sv('line', { class: 'refline', x1: X, x2: X, y1: top - 4, y2: top + ph, 'stroke-dasharray': '4 4' }, svg); const w = tw(txt, rf); const tx0 = anchor === 'end' ? Math.max(w, X - 5) : Math.min(W - w, X + 5); const t = sv('text', { class: 'reflab halo', x: tx0, y: top - 8, 'text-anchor': anchor }, svg); t.textContent = txt; };
    ref(xb, lb, 'end'); ref(xw, lw2, 'start');
    const hl = sv('rect', { class: 'taphl', x: 0, y: -99, width: pw, height: Math.max(rh, 3), opacity: 0 }, svg);
    const hit = sv('rect', { class: 'hit', x: 0, y: top, width: pw, height: ph, tabindex: 0 }, svg); hit.style.touchAction = 'pan-y';
    const at = k => { const Y = y(k) + rh / 2 - Math.max(rh, 3) / 2; hl.setAttribute('y', Y); hl.setAttribute('opacity', 1); };
    const me = { show(day) { const k = rws.findIndex(r => day >= r.s - .5 && day <= r.e + .5); if (k < 0) return me.hide(); at(k); }, hide() { hl.setAttribute('opacity', 0); } };
    me.off = () => { me.hide(); hideTip(); syncOff(me); if (ACTIVE === me) ACTIVE = null; };
    SYNC.push(me);
    const pick = ev => {
      const rc = svg.getBoundingClientRect(), sc = rc.width / W, k = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientY - rc.top) / sc - top) / rh))), r = rws[k];
      at(k); ACTIVE = me; syncTo(me, (r.s + r.e) / 2);
      const title = weekly ? bucketLabel(r, 'week') : dLong(r.s);
      if (r.bed == null) return showTip(ev.clientX, rc.top + (y(k)) * sc, title, [{ v: 'No sleep recorded' }]);
      showTip(ev.clientX, rc.top + y(k) * sc, title, [{ v: `${fmtClock(r.bed)} → ${fmtClock(r.wake)}`, l: weekly ? 'typical' : 'asleep to awake', c: !weekly && r.asl < FLOOR ? bad : color }, { v: fmtDur(r.asl), l: weekly ? 'avg asleep' : 'asleep' }]);
    };
    hit.addEventListener('pointermove', pick); hit.addEventListener('pointerdown', pick);
    hit.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch') me.off(); }); hit.addEventListener('blur', () => me.off());
  });
  return B.c;
}

// ---------------- Workouts
function workoutsChapter(root, view, p, chColor) {
  const e = Math.min(p.b, LAST), ws = WK.filter(w => w.i >= p.a && w.i <= e);
  if (!ws.length) { root.appendChild(el('div', 'missing', 'No workouts were recorded in this period.')); return; }
  const cfg = VC[view], color = css(chColor), tcol = Object.fromEntries(WTYPES.map(([t, c]) => [t, css(c)]));
  const tot = (a, b) => { let m = 0, n = 0, k = 0, km = 0; WK.forEach(w => { if (w.i >= a && w.i <= b) { m += w.min; n++; k += w.kcal || 0; km += w.km || 0; } }); return { m, n, k, km }; };
  const cur = tot(p.a, e), pp = prevPeriod(view, p), pv = pp ? tot(pp.a, pp.b) : null;
  {
    const B = band({ t: 'Workout time', dir: 1, ex: 'Minutes of recorded workouts, stacked by sport. Common guidance is 150 minutes or more of moderate activity a week.' }, color);
    hero(B.rail, 'Total time', [fmtDur(cur.m), ''], pv ? deltaInfo('min', 1, cur.m, pv.m) : null, pp ? pp.label : '');
    const list = [{ l: 'Sessions', v: nf(cur.n), x: '' }, { l: 'Active energy', v: F1('kcal', cur.k), x: '' }];
    if (cur.km) list.push({ l: 'Distance', v: [nf(cur.km, 1), DU], x: '' });
    for (const n of [30, 90]) { const a = tot(e - n + 1, e), b2 = tot(e - 2 * n + 1, e - n), info = deltaInfo('min', 1, a.m, b2.m); list.push({ l: `Last ${n} days`, v: fmtDur(a.m), x: info ? chipEl(info, `vs the ${n} days before: ${fmtDur(b2.m)}`) : '' }); }
    rows(B.rail, list);
    const b = chartBox(); B.main.appendChild(b);
    B.main.appendChild(legend(WTYPES.filter(([t]) => ws.some(w => wgroup(w.type) === t)).map(([t]) => ({ t: t === 'Other' ? 'Other sports' : t, c: tcol[t] }))));
    mount(b, bx => {
      const ser = buckets(cfg.ctx, p.a, p.b).map(bk => { const o = { ...bk, n: 0, list: [] }; WTYPES.forEach(([t]) => o[t] = 0); ws.forEach(w => { if (w.i >= bk.s && w.i <= bk.e) { o[wgroup(w.type)] += w.min; o.n++; o.list.push(w); } }); o.tot = WTYPES.reduce((t, [k2]) => t + o[k2], 0); return o; });
      const F = frame(bx, view, p, durDom(ser.map(s => s.tot)), { yFmt: U.dur.ax, strip: true, label: 'Workout time' });
      const targets = [];
      ser.forEach(s => {
        const cx = F.x((s.s + s.e) / 2), bw = Math.max(2, Math.min(22, F.pxDay * (s.e - s.s + 1) * .62));
        let acc = 0; const parts = WTYPES.filter(([k2]) => s[k2] > 0);
        parts.forEach(([k2], j) => { const y0 = F.y(acc), y1 = F.y(acc + s[k2]); acc += s[k2]; const gap = j > 0 ? 1 : 0; if (j === parts.length - 1) sv('path', { d: barPath(cx, y0 - gap, y1, bw), fill: tcol[k2], class: 'grow' }, F.g); else sv('rect', { x: cx - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1 - gap), fill: tcol[k2], class: 'grow' }, F.g); });
        targets.push({ x: cx, s, ty: s.tot ? F.y(s.tot) : null });
      });
      strip(F, view, p, (a, b2) => { const t = tot(a, b2); return t.n ? t.m : null; }, [fmtDurC, v => nf(v / 60) + 'h'], color, 'TOTAL');
      hoverLayer(F, targets, (t, cx, cy) => {
        const s = t.s; if (!s.n) return showTip(cx, cy, bucketLabel(s, cfg.ctx), [{ v: 'No workouts' }]);
        const rw = [{ v: fmtDur(s.tot), l: `${s.n} workout${s.n > 1 ? 's' : ''}` }];
        WTYPES.forEach(([k2]) => s[k2] > 0 && rw.push({ v: fmtDurC(s[k2]), l: k2 === 'Other' ? [...new Set(s.list.filter(w => wgroup(w.type) === 'Other').map(w => w.type))].join(', ') : k2, c: tcol[k2] }));
        showTip(cx, cy, bucketLabel(s, cfg.ctx), rw);
      });
    });
    root.appendChild(B.c);
  }
  {
    const c = plainCard('By sport', periodLabel(view, p));
    const byT = {}; ws.forEach(w => { const o = byT[w.type] || (byT[w.type] = { n: 0, min: 0, hr: [] }); o.n++; o.min += w.min; if (w.hr) o.hr.push(w.hr); });
    const list = Object.entries(byT).sort((a, b) => b[1].min - a[1].min), mx = list[0][1].min, hb = el('div', 'hbars');
    list.forEach(([t, o]) => {
      const nm = el('div', 'nm'); const i = el('i'); i.style.background = tcol[wgroup(t)]; nm.append(i, el('span', null, t));
      const tr = el('div', 'track'); const f = el('div', 'fill'); f.style.width = Math.max(1.5, o.min / mx * 100) + '%'; f.style.background = tcol[wgroup(t)]; tr.appendChild(f);
      const avgHr = o.hr.length ? ` · avg ${nf(o.hr.reduce((a, b) => a + b, 0) / o.hr.length)} bpm` : '';
      hb.append(nm, tr, el('div', 'm', `${o.n}× · ${fmtDur(o.min)}${avgHr}`));
    });
    c.appendChild(hb); root.appendChild(c);
  }
  {
    const c = plainCard('Workout log', `${ws.length} workouts`);
    const wrap = el('div', 'tbl-wrap'); const tb = el('table');
    const hd = el('tr'); [['Date', ''], ['Sport', ''], ['Duration', 'r'], ['Distance', 'r'], ['Active energy', 'r'], ['Avg heart rate', 'r'], ['Max heart rate', 'r']].forEach(([t, k]) => hd.appendChild(el('th', k, t)));
    const th = el('thead'); th.appendChild(hd); tb.appendChild(th);
    const body = el('tbody');
    [...ws].reverse().forEach(w => {
      const tr = el('tr'); const s = el('td'); const sw = el('span', 'sw'); sw.style.background = tcol[wgroup(w.type)]; s.append(sw, w.type + (w.indoor ? ' (indoor)' : ''));
      tr.append(el('td', null, `${dShort(w.i)}, ${dYr(w.i)} · ${w.d.slice(11)}`), s, el('td', 'r', fmtDur(w.min)), el('td', 'r', w.km ? nf(w.km, 2) + ' ' + DU : '–'), el('td', 'r', w.kcal != null ? nf(w.kcal) + ' kcal' : '–'), el('td', 'r', w.hr ? w.hr + ' bpm' : '–'), el('td', 'r', w.hrMax ? w.hrMax + ' bpm' : '–'));
      body.appendChild(tr);
    });
    tb.appendChild(body); wrap.appendChild(tb); c.appendChild(wrap); root.appendChild(c);
  }
  const e2 = metricBand('effortEst', view, p, chColor); if (e2 && !e2.missing) root.appendChild(e2);
}

// ---------------- Body
function bodyChapter(root, view, p, chColor) {
  const col = css(chColor), e = Math.min(p.b, LAST), ht = PTS.height || [];
  const w = pointsBand(DEF.weight, view, p, col, ht.length ? [{ l: 'Height', v: F1(HU, ht[ht.length - 1].v), x: dShort(ht[ht.length - 1].i) + ', ' + dYr(ht[ht.length - 1].i) }] : null); if (w) root.appendChild(w);
  const sys = PTS.bpSys || [], dia = PTS.bpDia || [];
  if (sys.length) {
    const inP = sys.filter(q => q.i >= p.a && q.i <= e);
    const B = band({ t: 'Blood pressure', dir: -1, ex: 'Systolic over diastolic. Below 120/80 mmHg is considered normal.' }, col);
    const src = inP.length ? inP : sys, l = src[src.length - 1], ld = dia.find(q => q.d === l.d);
    hero(B.rail, (inP.length ? 'Latest · ' : 'Most recent · ') + dShort(l.i) + ', ' + dYr(l.i), [`${nf(l.v)}/${ld ? nf(ld.v) : '–'}`, 'mmHg'], null, '');
    rows(B.rail, [{ l: 'Readings in period', v: String(inP.length), x: '' }, { l: 'Readings, all time', v: String(sys.length), x: '' }]);
    if (!inP.length) B.main.appendChild(el('div', 'empty', `No readings in this period. The most recent was on ${dLong(l.i)}.`));
    else { const b = chartBox(); B.main.appendChild(b); mount(b, bx => drawPoints(bx, { key: 'bpSys', u: 'mmhg', t: 'Blood pressure' }, view, p, col, 'bpDia', css('--c-heart'))); B.main.appendChild(legend([{ t: 'Systolic', c: col }, { t: 'Diastolic', c: css('--c-heart') }])); }
    root.appendChild(B.c);
  }
  const all = [...(PTS.weight || []).map(q => [q.d, 'Weight', fmt(WU, q.v)]), ...ht.map(q => [q.d, 'Height', fmt(HU, q.v)]), ...sys.map(q => { const d2 = dia.find(x => x.d === q.d); return [q.d, 'Blood pressure', `${nf(q.v)}/${d2 ? nf(d2.v) : '–'} mmHg`]; })].sort((a, b) => b[0] < a[0] ? -1 : 1);
  if (all.length) {
    const c = plainCard('Every logged reading', `${all.length} entries, all time`);
    const wrap = el('div', 'tbl-wrap'); const tb = el('table'); const hr = el('tr'); ['Date', 'Measurement', 'Value'].forEach((t, k) => hr.appendChild(el('th', k === 2 ? 'r' : '', t)));
    const th = el('thead'); th.appendChild(hr); tb.appendChild(th); const body = el('tbody');
    all.forEach(([d, t, v]) => { const tr = el('tr'); tr.append(el('td', null, dLong(isoIdx(d)) + ' · ' + d.slice(11)), el('td', null, t), el('td', 'r', v)); body.appendChild(tr); });
    tb.appendChild(body); wrap.appendChild(tb); c.appendChild(wrap); root.appendChild(c);
  }
}


// ---------------- Nudge layer: targets, debt, chains
// Targets: sleep 7 hr (floor 6 hr), steps 8,000, exercise 30 min, daylight 30 min,
// sleep timing within 1 hour of your usual midpoint (median of the previous 90 nights).
const LEVERS = [
  { id: 'sleep', key: 'sl_asleep', t: 'Sleep', u: 'dur', target: TG.sleep, floor: TG.sleepFloor, ch: 'sleep', night: true, tl: `${hTxt(TG.sleep)} a night, never under ${hTxt(TG.sleepFloor)}` },
  { id: 'steps', key: 'steps', t: 'Steps', u: 'steps', target: TG.steps, ch: 'activity', tl: `${nf(TG.steps)} a day` },
  { id: 'exercise', key: 'exercise', t: 'Exercise', u: 'min', target: TG.exercise, ch: 'activity', tl: `${TG.exercise} min a day` },
  { id: 'daylight', key: 'daylight', t: 'Daylight', u: 'min', target: TG.daylight, ch: 'env', color: '--c-daylight', tl: `${TG.daylight} min outside a day` },
  { id: 'rhythm', key: 'sl_mid', t: 'Sleep timing', u: 'clock', ch: 'sleep', night: true, band: 60, tl: 'within 1 hr of your usual' },
];
const WORD = L => L.night ? 'nights' : 'days';
function leverMed(L, e) { if (L.id !== 'rhythm') return null; const q = quantiles('sl_mid', e - 89, e, [.5]); return q ? q[0] : null; }
function hitAt(L, i, med) {
  const v = get(L.key, i); if (v == null) return null;
  if (L.id === 'rhythm') return med == null ? null : Math.abs(v - med) <= L.band;
  return v >= L.target;
}
function leverStats(L, e) {
  const med = leverMed(L, e); let n = 0, h = 0, short = 0, under = 0, sumV = 0;
  for (let i = e - 13; i <= e; i++) {
    const v = get(L.key, i), hit = hitAt(L, i, med); if (hit == null) continue;
    n++; sumV += v; if (hit) h++;
    else if (L.id !== 'rhythm') short += L.target - v;
    if (L.floor != null && v < L.floor) under++;
  }
  return { n, h, short, under, med, miss: n ? 1 - h / n : 0, avg: n ? sumV / n : null };
}
// Runs: consecutive days on target. One missed day per 7 is forgiven as a rest day;
// days with no data neither count nor break a run, unless 4 or more in a row.
function leverRuns(L, e) {
  let run = 0, forgiven = null, gap = 0, best = 0, bestEnd = -1;
  for (let i = 0; i <= e; i++) {
    const med = L.id === 'rhythm' ? leverMedCache(L, i) : null, hit = hitAt(L, i, med);
    if (hit == null) { if (++gap >= 4) { run = 0; forgiven = null; } continue; }
    gap = 0;
    if (hit) run++;
    else if (run > 0 && (forgiven == null || i - forgiven >= 7)) forgiven = i;
    else { run = 0; forgiven = null; }
    if (run > best) { best = run; bestEnd = i; }
  }
  return { cur: run, best, bestEnd };
}
const MEDC = {};
function leverMedCache(L, i) { const k = Math.floor(i / 7); if (!(k in MEDC)) { const q = quantiles('sl_mid', k * 7 - 89, k * 7, [.5]); MEDC[k] = q ? q[0] : null; } return MEDC[k]; }

const ARROW_ACT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4 12.5 8l-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function debtText(L, st, e) {
  if (L.id === 'sleep') return { v: fmtDur(st.short), u: 'short', sub: `of sleep across the last 14 nights, against ${hTxt(L.target)} a night` };
  if (L.id === 'steps') { const d = win('distance', e - 13, e).sum, k = win('steps', e - 13, e).sum; const km = k ? st.short * d / k : null; return { v: nf(Math.round(st.short / 100) * 100), u: 'steps short', sub: `in the last 14 days, against ${nf(L.target)} a day${km ? ` · about ${nf(km, 1)} ${DU} not walked` : ''}` }; }
  if (L.id === 'exercise') return { v: fmtDur(st.short), u: 'short', sub: `of exercise in the last 14 days, against ${L.target} minutes a day` };
  if (L.id === 'daylight') return { v: fmtDur(st.short), u: 'short', sub: `of daylight in the last 14 days, against ${L.target} minutes a day` };
  return { v: String(st.n - st.h), u: `of ${st.n} nights`, sub: `slept more than an hour off your usual rhythm (middle of sleep near ${fmtClock(st.med)})` };
}
function actionText(L, st, e) {
  if (L.id === 'sleep') { const q = quantiles('sl_wake', e - 29, e, [.5]); if (q) return `Lights out by ${fmtClock(q[0] - L.target)} to fit ${hTxt(L.target)} before your usual ${fmtClock(q[0])} wake-up.`; return `Protect a ${hTxt(L.target)} window tonight.`; }
  const per = st.n ? st.short / st.n : 0;
  if (L.id === 'steps') return `About ${nf(Math.max(100, Math.round(per / 100) * 100))} more steps a day closes the gap. That is roughly ${nf(Math.max(5, Math.round(per / 100)))} minutes of walking.`;
  if (L.id === 'exercise') return `About ${nf(Math.max(5, Math.round(per / 5) * 5))} more minutes of brisk movement a day closes the gap.`;
  if (L.id === 'daylight') return `About ${nf(Math.max(5, Math.round(per / 5) * 5))} more minutes outside a day closes the gap.`;
  return `Keep the middle of your sleep near ${fmtClock(st.med)}: same lights-out, same wake-up.`;
}
function targetChart(box, L, e, med, color) {
  const p = { a: e - 13, b: e }, bad = css('--bad'), good = css('--good'), rhythm = L.id === 'rhythm';
  const days = []; for (let i = p.a; i <= p.b; i++) days.push({ i, v: get(L.key, i), hit: hitAt(L, i, med) });
  const vals = days.map(d => d.v).filter(v => v != null);
  const T = rhythm ? med : L.target;
  const dom = rhythm ? clockDom([...vals, T - 75, T + 75]) : (L.u === 'dur' ? (() => { const d = yDom([...vals, T, L.floor].map(v => v / 60), false, 4); return { a: d.a * 60, b: d.b * 60, t: d.t.map(v => v * 60) }; })() : yDom([...vals, T, L.floor], false, 4));
  if (!rhythm && dom.a < 0) { dom.t = dom.t.filter(v => v >= 0); dom.a = 0; }
  const F = frame(box, 'W', p, dom, { yFmt: axisFmt(L.u), h: 190, invert: false, label: L.t + ', last 14 days' });
  const targets = [];
  if (rhythm) {
    const y1 = F.y(T - L.band), y2 = F.y(T + L.band);
    sv('rect', { x: 0, y: Math.min(y1, y2), width: F.pw, height: Math.abs(y2 - y1), fill: css('--good'), 'fill-opacity': .08 }, F.g);
  }
  const ty = F.y(T), bw = Math.max(6, Math.min(22, F.pxDay * .6));
  days.forEach(d => {
    const cx = F.x(d.i);
    if (d.v != null) {
      if (rhythm) sv('circle', { cx, cy: F.y(d.v), r: 6, fill: d.hit ? good : bad, stroke: css('--card'), 'stroke-width': 2, class: 'draw' }, F.g);
      else { const vy = F.y(d.v), top = Math.min(vy, ty), h = Math.max(2, Math.abs(vy - ty)); sv('rect', { x: cx - bw / 2, y: top, width: bw, height: h, rx: Math.min(4, bw / 2, h / 2), fill: d.hit ? good : bad, 'fill-opacity': d.hit ? .9 : .85, class: 'draw' }, F.g); }
    }
    targets.push({ x: cx, d, ty: d.v != null ? F.y(d.v) : null });
  });
  sv('line', { class: 'refline', x1: 0, x2: F.pw, y1: ty, y2: ty, 'stroke-width': 1.5 }, F.g);
  const tl = sv('text', { class: 'reflab halo', x: 4, y: ty - 6 }, F.g); tl.textContent = rhythm ? 'Your usual ' + fmtClock(T) : 'Target ' + U[L.u].c(T);
  if (L.floor != null) { const fy = F.y(L.floor); const z = sv('rect', { x: 0, y: fy, width: F.pw, height: Math.max(0, F.base - fy), fill: bad, 'fill-opacity': .06 }, F.g); F.g.insertBefore(z, F.g.firstChild); sv('line', { x1: 0, x2: F.pw, y1: fy, y2: fy, stroke: bad, 'stroke-width': 1, 'stroke-opacity': .45 }, F.g); const t = sv('text', { class: 'reflab halo', x: 4, y: fy + 14 }, F.g); t.textContent = 'Floor ' + U[L.u].c(L.floor); t.dataset.ly = fy + 20; t.style.fill = bad; }
  declutter(F);
  hoverLayer(F, targets, (t, cx, cy) => {
    const d = t.d; if (d.v == null) return showTip(cx, cy, dLong(d.i), [{ v: 'No data' }]);
    const diff = rhythm ? `${fmtDurS(Math.abs(d.v - T))} ${d.v > T ? 'later' : 'earlier'} than usual` : (d.hit ? `${fmt(L.u, d.v - T)} over target` : `${fmt(L.u, T - d.v)} short`);
    showTip(cx, cy, dLong(d.i), [{ v: fmt(L.u, d.v), c: d.hit ? good : bad }, { v: diff }]);
  });
}
function chainSvg(svgEl, L, e, color) {
  svgEl.replaceChildren();
  const s0 = e - 55 - ((dt(e - 55).getUTCDay() + 6) % 7), weeks = Math.ceil((e - s0 + 1) / 7);
  const W = Math.max(svgEl.clientWidth || 220, 200), gap = 3, left = 14, cs = Math.min(18, Math.floor((W - left) / weeks) - gap), H = 7 * (cs + gap);
  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`); svgEl.setAttribute('height', H);
  ['M', '', 'W', '', 'F', '', 'S'].forEach((d, k) => { if (d) { const t = sv('text', { x: 0, y: k * (cs + gap) + cs * .75, class: 'reflab' }, svgEl); t.textContent = d; t.style.fill = css('--ink-3'); } });
  const bad = css('--bad'), none = css('--heat-0'); color = css('--good');
  for (let i = s0; i <= e; i++) {
    const k = i - s0, col = Math.floor(k / 7), row = k % 7, med = L.id === 'rhythm' ? leverMedCache(L, i) : null, hit = hitAt(L, i, med), v = get(L.key, i);
    const r = sv('rect', { x: left + col * (cs + gap), y: row * (cs + gap), width: cs, height: cs, rx: 4, fill: hit == null ? none : hit ? color : bad, 'fill-opacity': hit == null ? 1 : hit ? .9 : .55 }, svgEl);
    r.addEventListener('pointerenter', () => { const bb = r.getBoundingClientRect(); showTip(bb.left + bb.width / 2, bb.top, dLong(i), [{ v: v == null ? 'No data' : fmt(L.u, v), c: hit == null ? null : hit ? color : bad, l: hit == null ? '' : hit ? 'on target' : 'below target' }]); });
    r.addEventListener('pointerleave', hideTip);
  }
}
function nudgeLayer(root, e) {
  const all = LEVERS.map(L => ({ L, st: leverStats(L, e), rn: leverRuns(L, e), color: css(L.color || CHMAP[L.ch].color) })).filter(x => x.st.n >= 5);
  if (!all.length) return;
  const ranked = [...all].sort((a, b) => (b.st.miss - a.st.miss) || (b.st.short / (b.L.target || 1) - a.st.short / (a.L.target || 1)));
  const focus = ranked[0].st.miss >= .3 ? ranked[0] : null;
  // 1. focus card
  if (focus) {
    const { L, st, rn, color } = focus;
    const c = el('section', 'card band'), rail = el('div', 'rail'), main = el('div', 'main');
    const tag = el('div', 'tag alert'); tag.append(el('i'), document.createTextNode('Needs attention')); rail.appendChild(tag);
    const h = el('h3', null, L.t); h.style.cssText = 'margin-top:10px;font-size:26px;letter-spacing:-.03em'; rail.appendChild(h);
    const dtx = debtText(L, st, e), db = el('div', 'debt');
    db.appendChild(el('div', 'lab', 'Last 14 ' + WORD(L)));
    const v = el('div', 'val', dtx.v); v.appendChild(el('small', null, dtx.u)); db.appendChild(v); db.appendChild(el('div', 'sub', dtx.sub)); rail.appendChild(db);
    const list = [{ l: `${WORD(L)[0].toUpperCase() + WORD(L).slice(1)} on target`, v: `${st.h} of ${st.n}`, x: '' }];
    if (L.floor != null) list.push({ l: `Under ${hTxt(L.floor)}`, v: `${st.under} of ${st.n}`, x: st.under ? el('span', 'chip bad', 'below floor') : '' });
    if (L.id !== 'rhythm') list.push({ l: 'Average', v: F1(L.u, st.avg), x: `target ${U[L.u].c(L.target)}` });
    list.push({ l: 'Current run', v: `${rn.cur} ${rn.cur === 1 ? WORD(L).slice(0, -1) : WORD(L)}`, x: rn.best ? `best ${rn.best}` : '' });
    rows(rail, list);
    const act = el('div', 'act'); act.insertAdjacentHTML('beforeend', ARROW_ACT); act.appendChild(el('span', null, actionText(L, st, e))); rail.appendChild(act);
    const b = chartBox(); main.appendChild(b);
    mount(b, bx => targetChart(bx, L, e, st.med, color));
    main.appendChild(legend(L.id === 'rhythm' ? [{ t: 'Within an hour of usual', c: css('--good') }, { t: 'More than an hour off', c: css('--bad') }] : [{ t: 'On target', c: css('--good') }, { t: 'Below target', c: css('--bad') }, { t: 'Target', cls: 'hl' }]));
    c.append(rail, main);
    const open = el('button', 'meta', `Open ${CHMAP[L.ch].name} →`); open.type = 'button'; open.style.cssText = 'text-align:left;margin-top:14px;color:var(--ink-2);font-weight:600'; open.addEventListener('click', () => go(L.ch)); rail.appendChild(open);
    root.appendChild(c);
  }
}

// ---------------- Records: plain facts from all of your data (no scores, no interpretation)
function recordsCard(root) {
  const out = [], dy = i => `${dShort(i)}, ${dYr(i)}`;
  const maxOf = (k, lowest) => { const a = D.daily[k]; if (!a) return null; let bi = -1; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) continue; if (bi < 0 || (lowest ? v < a[bi] : v > a[bi])) bi = i; } return bi < 0 ? null : { i: bi, v: a[bi] }; };
  const add = (ch, label, val, sub) => out.push({ ch, label, val, sub });
  let r;
  if ((r = maxOf('steps'))) add('activity', 'Most steps in a day', F1('steps', r.v), dy(r.i));
  if ((r = maxOf('distance'))) add('activity', 'Farthest on foot in a day', F1(DEF.distance.u, r.v), dy(r.i));
  if ((r = maxOf('exercise'))) add('activity', 'Most exercise in a day', F1('min', r.v), dy(r.i));
  const runs = LEVERS.map(L => ({ L, rn: leverRuns(L, LAST) })).filter(x => x.rn.best >= 3);
  runs.filter(x => x.L.id === 'sleep' || x.L.id === 'steps').forEach(({ L, rn }) => add(L.ch, `Longest ${L.t.toLowerCase()} chain`, [String(rn.best), WORD(L)], `on target, ending ${dy(rn.bestEnd)}`));
  if ((r = maxOf('rhr', true))) add('heart', 'Lowest resting heart rate', F1('bpm', r.v), dy(r.i));
  { const v = PTS.vo2max || []; if (v.length) { const b = v.reduce((x, q) => q.v > x.v ? q : x); add('heart', 'Highest cardio fitness', F1('vo2', b.v), dy(b.i)); } }
  if (WK.length) { const w = WK.reduce((x, q) => q.min > x.min ? q : x); add('workouts', 'Longest workout', [fmtDur(w.min), ''], `${w.type}, ${dy(w.i)}`); }
  if ((r = maxOf('daylight'))) add('env', 'Most time in daylight', F1('min', r.v), dy(r.i));
  if (out.length < 3) return;
  { const sec = el('div', 'ovsec'); sec.append(el('h2', null, 'Records'), el('p', 'mono', `Best single days and runs, across all your data since ${monYr(0)}`)); root.appendChild(sec); }
  const g = el('div', 'records');
  out.slice(0, 8).forEach(x => {
    const c = el('button', 'card rec'); c.type = 'button'; c.addEventListener('click', () => go(x.ch));
    const t = el('div', 'rt'); const i = el('i'); i.style.background = css(CHMAP[x.ch].color); t.append(i, el('span', null, x.label)); c.appendChild(t);
    const v = el('div', 'rv2'); v.appendChild(document.createTextNode(x.val[0])); if (x.val[1]) v.appendChild(el('small', null, x.val[1])); c.appendChild(v);
    c.appendChild(el('div', 'rs', x.sub)); g.appendChild(c);
  });
  root.appendChild(g);
}

// ---------------- Chapter vital signs: last 30 days, with the last 90 days as a small trend
const VITALS = { heart: ['rhr', 'walkHr', 'vo2max'], stress: ['hrv', 'rhr', 'resp'], sleep: ['sl_asleep', 'sl_mid', 'sl_deep'], activity: ['steps', 'active', 'exercise'], workouts: ['_workouts'], mobility: ['walkSpeed', 'stepLen', 'steadiness'], env: ['daylight', 'envDb', 'phoneDb'], body: ['weight'] };
function vitalsRow(chId, e, color) {
  const keys = (VITALS[chId] || []).filter(k => k === '_workouts' ? WK.length : k in DEF && ((DEF[k].k === 'points' ? (PTS[k] || []).length : win(k, 0, LAST).n)));
  if (!keys.length) return null;
  const row = el('div', 'vitals'), SHORTN = { vo2max: 'VO₂ max', envDb: 'Surrounding sound' };
  keys.forEach(k => {
    const def = k === '_workouts' ? WDEF : DEF[k], S2 = boardSeries(def), v = S2.cur(e);
    if (v == null) return;
    const c = el('button', 'vt'); c.type = 'button';
    c.addEventListener('click', () => { const h = [...document.querySelectorAll('#main .rail h3')].find(x => x.textContent === def.t); if (h) h.closest('.card').scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' }); });
    c.appendChild(el('span', 'vn', SHORTN[k] || def.t));
    const vv = el('span', 'vv'); const [a1, b1] = F1(def.u, v); vv.appendChild(document.createTextNode(a1)); if (b1) vv.appendChild(el('small', null, b1)); c.appendChild(vv);
    const sp = sv('svg', { class: 'vs', height: 26, 'aria-hidden': 'true', preserveAspectRatio: 'none' }); c.appendChild(sp);
    const series = []; for (let i = e - 89; i <= e; i++) series.push(i);
    const vals = def.k === 'points' ? series.map(i => { const q = (PTS[k] || []).filter(z => z.i <= i); return q.length ? q[q.length - 1].v : null; }) : k === '_workouts' ? series.map(i => S2.bucket(i - 6, i)) : (() => { const T = trend(k, 4); return series.map(i => i < 0 || i > LAST ? null : T[i]); })();
    RENDER.push(() => { sp.replaceChildren(); const W = Math.max(sp.clientWidth || 120, 60), H = 26; sp.setAttribute('viewBox', `0 0 ${W} ${H}`); const nn = vals.filter(x => x != null); if (nn.length < 2) return; const lo = Math.min(...nn), hi = Math.max(...nn), pad = (hi - lo) * .15 || 1; const pts = vals.map((x, j) => x == null ? null : [2 + j / 89 * (W - 4), H - 3 - (x - lo + pad) / (hi - lo + 2 * pad) * (H - 6)]); runs(pts, 3).forEach(r2 => r2.length > 1 && traceIn(sv('path', { d: poly(r2), fill: 'none', stroke: css(def.color || color), 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, sp))); const last = [...pts].reverse().find(Boolean); if (last) sv('circle', { cx: last[0], cy: last[1], r: 2.6, fill: css(def.color || color) }, sp); });
    row.appendChild(c);
  });
  row.style.setProperty('--n', Math.min(4, row.children.length));
  return row.children.length ? row : null;
}

// ---------------- Share poster: a year on one image, drawn on this device only when asked for
const POSTER_THEMES = {
  light: { bg: '#F2F2F4', card: '#FFFFFF', ink: '#16181D', ink2: '#5C616B', ink3: '#9499A3', grid: 'rgba(22,24,29,.08)', none: '#E9E9EC', c: { sleep: '#2F5BBF', activity: '#E4691A', heart: '#D23F3F', workouts: '#3A8F3A', stress: '#0E8A8A', env: '#C99700' } },
  dark: { bg: '#0E0F12', card: '#17191D', ink: '#F2F3F5', ink2: '#A2A7B1', ink3: '#6B707A', grid: 'rgba(255,255,255,.08)', none: '#23252B', c: { sleep: '#5B8CEB', activity: '#F58537', heart: '#F0605A', workouts: '#4CB85A', stress: '#2EB3B0', env: '#E8BC2E' } },
};
function posterYears() { const ys = []; for (let y = dYr(0); y <= dYr(LAST); y++) if (win('steps', di(y, 0, 1), di(y, 11, 31)).n + win('sl_asleep', di(y, 0, 1), di(y, 11, 31)).n > 20) ys.push(y); return ys; }
function renderPoster(year, themeName) {
  const T = POSTER_THEMES[themeName] || POSTER_THEMES.light, W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), F = 'Figtree, -apple-system, system-ui, sans-serif';
  const a = di(year, 0, 1), z = Math.min(di(year, 11, 31), LAST), partial = di(year, 11, 31) > LAST;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const txt = (s2, x, y, font, color, align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(s2, x, y); return g.measureText(s2).width; };
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
  // header
  rr(72, 70, 44, 44, 11); g.fillStyle = T.ink; g.fill();
  g.strokeStyle = T.bg; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(82, 101); g.bezierCurveTo(90, 101, 91, 90, 98, 90); g.bezierCurveTo(104, 90, 104, 99, 110, 84); g.stroke();
  txt('Health Atlas', 130, 101, `700 28px ${F}`, T.ink);
  txt(`My ${year}`, 72, 238, `750 112px ${F}`, T.ink);
  txt('in health.', 72, 350, `750 112px ${F}`, T.ink2);
  txt(`${dShort(a)} – ${dShort(z)}, ${year}${partial ? ' · so far' : ''}`, 72, 408, `500 30px ${F}`, T.ink3);
  // stats
  const months = []; for (let m = 0; m < 12; m++) { const s0 = di(year, m, 1), e0 = Math.min(di(year, m + 1, 0), LAST); if (s0 <= LAST) months.push([s0, e0]); }
  const stat = [];
  const avg = k => win(k, a, z);
  let w0;
  if ((w0 = avg('sl_asleep')).n >= 10) stat.push({ l: 'Sleep a night', v: fmtDur(w0.v).replace(' hr ', 'h ').replace(' min', 'm'), c: T.c.sleep, k: 'sl_asleep' });
  if ((w0 = avg('steps')).n >= 10) stat.push({ l: 'Steps a day', v: nf(w0.v), u: 'steps', c: T.c.activity, k: 'steps' });
  if ((w0 = avg('rhr')).n >= 10) stat.push({ l: 'Resting heart rate', v: nf(w0.v), u: 'bpm', c: T.c.heart, k: 'rhr' });
  { const ws = WK.filter(w => w.i >= a && w.i <= z); if (ws.length >= 3) stat.push({ l: 'Workouts', v: String(ws.length), u: `sessions · ${nf(ws.reduce((t, w) => t + w.min, 0) / 60)} hr`, c: T.c.workouts, wk: true }); }
  if ((w0 = avg('hrv')).n >= 10) stat.push({ l: 'Heart rate variability', v: nf(w0.v), u: 'ms', c: T.c.stress, k: 'hrv' });
  if ((w0 = avg('daylight')).n >= 10) stat.push({ l: 'Daylight a day', v: nf(w0.v), u: 'min', c: T.c.env, k: 'daylight' });
  const cw = (W - 144 - 24) / 2, ch = 170;
  stat.slice(0, 6).forEach((st, k) => {
    const x = 72 + (k % 2) * (cw + 24), y = 460 + Math.floor(k / 2) * (ch + 20);
    rr(x, y, cw, ch, 28); g.fillStyle = T.card; g.fill();
    g.beginPath(); g.arc(x + 34, y + 44, 7, 0, Math.PI * 2); g.fillStyle = st.c; g.fill();
    txt(st.l, x + 52, y + 53, `600 26px ${F}`, T.ink2);
    const vw = txt(st.v, x + 28, y + 114, `700 56px ${F}`, T.ink); if (st.u) txt(st.u, x + 28 + vw + 10, y + 114, `500 26px ${F}`, T.ink3);
    const vals = months.map(([s0, e0]) => st.wk ? WK.filter(w => w.i >= s0 && w.i <= e0).reduce((t, w) => t + w.min, 0) : win(st.k, s0, e0).v);
    const nn = vals.filter(v => v != null && v > 0);
    if (nn.length > 1) { const lo = Math.min(...nn), hi = Math.max(...nn), sx = x + 28, sw = cw - 56, sy = y + 128, sh = 20;
      g.strokeStyle = st.c; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); let started = false;
      vals.forEach((v, j) => { if (v == null || v <= 0) { started = false; return; } const px = sx + (vals.length > 1 ? j / (vals.length - 1) : 0) * sw, py = sy + sh - (hi > lo ? (v - lo) / (hi - lo) : .5) * sh; if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py); });
      g.stroke(); }
  });
  // year of steps (or sleep), one square per day
  const ck = win('steps', a, z).n >= 20 ? 'steps' : 'sl_asleep', ccol = ck === 'steps' ? T.c.activity : T.c.sleep;
  const vals = []; for (let i = a; i <= z; i++) { const v = get(ck, i); if (v != null) vals.push(v); } vals.sort((x, y) => x - y);
  const q = f => vals[Math.min(vals.length - 1, Math.floor(f * (vals.length - 1)))], th = [q(.2), q(.4), q(.6), q(.8)];
  const shade = v => v == null ? T.none : mixHex(T.card, ccol, v < th[0] ? .3 : v < th[1] ? .48 : v < th[2] ? .66 : v < th[3] ? .84 : 1);
  const gy = 460 + 3 * (ch + 20) + 12, lead = (dt(a).getUTCDay() + 6) % 7, cell = 14, gap = 3.5;
  txt(ck === 'steps' ? 'Every day of steps' : 'Every night of sleep', 72, gy + 24, `600 26px ${F}`, T.ink2);
  for (let i = a; i <= di(year, 11, 31); i++) { const k = i - a + lead, x = 72 + Math.floor(k / 7) * (cell + gap), y = gy + 48 + (k % 7) * (cell + gap); rr(x, y, cell, cell, 3.5); g.fillStyle = i > LAST || i < 0 ? T.none : shade(get(ck, i)); g.globalAlpha = i > LAST || i < 0 ? .5 : 1; g.fill(); g.globalAlpha = 1; }
  txt('Read on my device from my Apple Health export. Nothing was uploaded.', 72, H - 56, `500 22px ${F}`, T.ink3);
  return cv;
}

// ---------------- Overview board
const BOARD = [
  ['activity', ['steps', 'active', 'exercise', 'distance']],
  ['workouts', ['_workouts']],
  ['heart', ['rhr', 'walkHr', 'vo2max']],
  ['stress', ['hrv', 'resp']],
  ['sleep', ['sl_asleep', 'sl_mid', 'sl_deep']],
  ['mobility', ['walkSpeed', 'stepLen']],
  ['env', ['daylight', 'envDb']],
];
const WDEF = { key: '_workouts', t: 'Workout time', u: 'dur', dir: 1 };
function boardSeries(def) {
  if (def.key === '_workouts') { const t = (a, b) => { let m = 0; WK.forEach(w => { if (w.i >= a && w.i <= b) m += w.min; }); return m; }; return { cur: e => t(e - 29, e), prev: e => t(e - 59, e - 30), bucket: (a, b) => t(a, b) }; }
  if (def.k === 'points') { const all = PTS[def.key] || []; const latest = e => { const q = all.filter(z => z.i <= e); return q.length ? q[q.length - 1].v : null; }; return { cur: latest, prev: e => latest(e - 30), bucket: (a, b) => { const q = all.filter(z => z.i >= a && z.i <= b); return q.length ? q.reduce((s, z) => s + z.v, 0) / q.length : null; } }; }
  return { cur: e => win(def.key, e - 29, e).v, prev: e => win(def.key, e - 59, e - 30).v, bucket: (a, b) => { const r = win(def.key, a, b); return r.n >= 5 ? r.v : null; } };
}
// ---------------- Overview: fixed rules over your own data. Every sentence below is a count, an average or a comparison; nothing is inferred.
const WWDEF = { key: '_workouts', t: 'Workout time', u: 'dur', dir: 1 };
const BEDDEF = { key: 'sl_bed', t: 'Bedtime', u: 'clock', k: 'line', dir: 0, night: true };
const WAKEDEF = { key: 'sl_wake', t: 'Wake-up', u: 'clock', k: 'line', dir: 0, night: true };
const PULSE = [['steps', 'activity'], ['exercise', 'activity'], ['active', 'activity'], ['_workouts', 'workouts'], ['sl_asleep', 'sleep'], ['sl_bed', 'sleep'], ['sl_wake', 'sleep'],
  ['rhr', 'heart'], ['walkHr', 'heart'], ['hrv', 'stress'], ['resp', 'stress'], ['daylight', 'env'], ['walkSpeed', 'mobility']];
const pdef = k => k === '_workouts' ? WWDEF : k === 'sl_bed' ? BEDDEF : k === 'sl_wake' ? WAKEDEF : DEF[k];
const PNAME = { rhr: 'Resting HR', walkHr: 'Walking HR', sl_asleep: 'Sleep', _workouts: 'Workouts', walkSpeed: 'Walking speed', hrv: 'HRV', resp: 'Breathing rate', active: 'Active energy', exercise: 'Exercise', daylight: 'Daylight' };
const pname = k => PNAME[k] || pdef(k).t;
const PER = { steps: 'a day', exercise: 'a day', active: 'a day', daylight: 'a day', sl_asleep: 'a night', _workouts: 'in total', sl_bed: 'on average', sl_wake: 'on average' };
// smallest change worth separating from noise, per unit (used only to keep flat measures from looking dramatic)
const MINSTEP = { steps: 150, kcal: 10, min: 2, dur: 6, clock: 8, bpm: .7, ms: 1.5, br: .15, kmh: .05, mph: .03 };
const WKMIN = (() => { const a = new Float64Array(N + 1); WK.forEach(w => { if (w.i >= 0 && w.i <= LAST) a[w.i + 1] += w.min; }); for (let i = 1; i <= N; i++) a[i] += a[i - 1]; return a; })();
const worn = (a, b) => Math.max(win('steps', a, b).n, win('rhr', a, b).n, win('hrAvg', a, b).n);
function wkVal(k, a, b) {
  if (a < 0) return null;
  if (k === '_workouts') return worn(a, b) >= 4 ? WKMIN[Math.min(b, LAST) + 1] - WKMIN[a] : null;
  const r = win(k, a, b); return r.n >= 4 ? r.v : null;
}
const wkRange = (e, j) => [e - 7 * j - 6, e - 7 * j];
const rangeTxt = (a, b) => dt(a).getUTCMonth() === dt(b).getUTCMonth() ? `${dShort(a)}–${dt(b).getUTCDate()}, ${dYr(b)}` : `${dShort(a)} – ${dShort(b)}, ${dYr(b)}`;
const monYr = i => `${MON[dt(i).getUTCMonth()]} ${dYr(i)}`;
let ANIM = false;
const ease = 'cubic-bezier(.2,.8,.2,1)';
const anim = (node, frames, o) => { if (ANIM && node.animate) node.animate(frames, { duration: 700, easing: ease, fill: 'backwards', ...o }); };

function pulseRows(e) {
  const out = [];
  for (const [k, ch] of PULSE) {
    const def = pdef(k); if (!def) continue;
    const cur = wkVal(k, e - 6, e); if (cur == null) continue;
    const base = []; for (let j = 1; j <= 26; j++) { const v = wkVal(k, ...wkRange(e, j)); if (v != null) base.push(v); }
    if (base.length < 8) continue;
    const prev = wkVal(k, ...wkRange(e, 1));
    const s = [...base].sort((a, b) => a - b), q = f => { const pos = (s.length - 1) * f, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
    const q25 = q(.25), med = q(.5), q75 = q(.75), mn = s[0], mx = s[s.length - 1];
    const sc = Math.max((q75 - q25) / 1.349, MINSTEP[def.u] || Math.abs(med) * .02 || 1), z = v => (v - med) / sc;
    const clock = def.u === 'clock', span = base.length >= 26 ? '6 mo' : `${base.length + 1} wk`;
    let tag, side = 0;
    if (cur > mx) { tag = `${clock ? 'Latest' : 'Highest'} in ${span}`; side = 2; }
    else if (cur < mn) { tag = `${clock ? 'Earliest' : 'Lowest'} in ${span}`; side = -2; }
    else if (cur > q75) { tag = clock ? 'Later than usual' : 'Above usual'; side = 1; }
    else if (cur < q25) { tag = clock ? 'Earlier than usual' : 'Below usual'; side = -1; }
    else tag = 'Usual';
    const cls = !side || !def.dir ? 'flat' : side * def.dir > 0 ? 'good' : 'bad';
    out.push({ k, ch, def, cur, prev, med, q25, q75, mn, mx, n: base.length, z: z(cur), zp: prev == null ? null : z(prev), zlo: z(mn), zhi: z(mx), z25: z(q25), z75: z(q75), tag, cls, side });
  }
  return out.sort((a, b) => Math.abs(b.side) - Math.abs(a.side) || Math.abs(b.z) - Math.abs(a.z));
}
const vTxt = (u, v) => fmt(u, v);
function pulseCard(root, e) {
  const rowsD = pulseRows(e); if (rowsD.length < 3) return;
  const c = el('section', 'card pulse');
  const hd = el('div', 'ovh');
  hd.append(el('h2', null, 'The last 7 days, against your usual'), el('p', 'mono', `${rangeTxt(e - 6, e)} · usual is the middle half of your previous ${Math.max(...rowsD.map(r => r.n))} weeks`));
  c.appendChild(hd);
  const lg = el('div', 'plg mono'); lg.innerHTML = `<span><svg viewBox="0 0 22 10"><rect x="1" y="1" width="20" height="8" rx="4"/></svg>Usual</span><span><svg viewBox="0 0 22 10"><line x1="1" y1="5" x2="21" y2="5"/></svg>Lowest to highest week</span><span><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.3"/></svg>The 7 days before</span><span><svg viewBox="0 0 10 10"><circle class="f" cx="5" cy="5" r="4"/></svg>Last 7 days</span>`;
  c.appendChild(lg);
  const g = el('div', 'pgrid');
  const hr = el('div', 'prow phd'); hr.append(el('span', null, ''), el('span', null, ''), (() => { const t = el('span', 'pax mono'); const lo = el('i', null, 'lower'), hi = el('i', null, 'higher'); if (clockAware(rowsD)) { lo.appendChild(el('span', 'xl', ' · earlier')); hi.appendChild(el('span', 'xl', ' · later')); } t.append(lo, el('b', null, 'usual'), hi); return t; })(), el('span', null, '')); g.appendChild(hr);
  rowsD.forEach((r, idx) => {
    const color = css(r.def.color || CHMAP[r.ch].color);
    const row = el('button', 'prow'); row.type = 'button'; row.addEventListener('click', () => go(r.ch));
    const nm = el('span', 'pn'); const dot = el('i'); dot.style.background = color; nm.append(dot, el('span', null, pname(r.k)));
    const vv = el('span', 'pv'); const [a1, b1] = F1(r.def.u, r.cur); vv.appendChild(document.createTextNode(a1)); if (b1) vv.appendChild(el('small', null, b1));
    vv.appendChild(el('em', 'mono', 'usual ' + (r.def.u === 'dur' ? fmtDurC(r.med) : U[r.def.u].c(r.med))));
    const tr = el('span', 'pt'); const s = sv('svg', { 'aria-hidden': 'true' }); tr.appendChild(s);
    const tg = el('span', 'pc'); tg.appendChild(el('span', 'chip ' + r.cls, r.tag));
    row.append(nm, vv, tr, tg); g.appendChild(row);
    row.addEventListener('pointerenter', ev => { const bb = row.getBoundingClientRect(); showTip(ev.clientX || bb.left + bb.width / 2, bb.top + 8, pname(r.k), [{ v: vTxt(r.def.u, r.cur), l: 'last 7 days' + (PER[r.k] && r.k !== '_workouts' ? ', ' + PER[r.k] : ''), c: color }, ...(r.prev != null ? [{ v: vTxt(r.def.u, r.prev), l: 'the 7 days before', c: color, faint: true }] : []), { v: `${vTxt(r.def.u, r.q25)} – ${vTxt(r.def.u, r.q75)}`, l: 'usual (middle half)' }, { v: `${vTxt(r.def.u, r.mn)} – ${vTxt(r.def.u, r.mx)}`, l: `lowest to highest of ${r.n} weeks` }], 'Opens ' + CHMAP[r.ch].name); });
    row.addEventListener('pointerleave', hideTip);
    RENDER.push(() => pulseTrack(s, r, color, idx));
  });
  c.appendChild(g); root.appendChild(c);
}
function clockAware(rs) { return rs.some(r => r.def.u === 'clock'); }
function pulseTrack(s, r, color, idx) {
  s.replaceChildren();
  const W = Math.max(s.clientWidth || 200, 120), H = Math.max(s.clientHeight || 40, 28), cy = H / 2, pad = 10, Z = 4;
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const X = z => pad + (Math.max(-Z, Math.min(Z, z)) + Z) / (2 * Z) * (W - 2 * pad), x0 = X(0);
  sv('line', { x1: x0, x2: x0, y1: 0, y2: H, stroke: css('--ink-3'), 'stroke-opacity': .45, 'stroke-dasharray': '2 3' }, s);
  sv('line', { x1: X(r.zlo), x2: X(r.zhi), y1: cy, y2: cy, stroke: css('--ink-3'), 'stroke-opacity': .5, 'stroke-width': 1.5, 'stroke-linecap': 'round' }, s);
  const b = sv('rect', { x: X(r.z25), y: cy - 6, width: Math.max(4, X(r.z75) - X(r.z25)), height: 12, rx: 6, fill: color, 'fill-opacity': .2 }, s);
  const d = idx * 45;
  anim(b, [{ transform: `translate(${x0}px,0) scale(.001,1) translate(${-x0}px,0)` }, { transform: 'none' }], { duration: 600, delay: d });
  const xc = X(r.z);
  if (r.zp != null) {
    const xp = X(r.zp);
    const ln = sv('line', { x1: xp, x2: xc, y1: cy, y2: cy, stroke: color, 'stroke-width': 2, 'stroke-opacity': .55, 'stroke-linecap': 'round' }, s);
    const len = Math.abs(xc - xp); ln.style.strokeDasharray = `${len + 1}`; ln.style.strokeDashoffset = '0';
    anim(ln, [{ strokeDashoffset: `${len + 1}` }, { strokeDashoffset: '0' }], { duration: 650, delay: d + 350 });
    const pc = sv('circle', { cx: xp, cy, r: 3.6, fill: css('--card'), stroke: color, 'stroke-width': 1.6 }, s);
    anim(pc, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: d + 250 });
  }
  const cc = sv('circle', { cx: xc, cy, r: 6.5, fill: color, stroke: css('--card'), 'stroke-width': 2.5 }, s);
  anim(cc, [{ transform: `translate(${x0 - xc}px,0)`, opacity: 0 }, { transform: `translate(${x0 - xc}px,0)`, opacity: 1, offset: .15 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: d + 150 });
  if (Math.abs(r.z) > Z) { const dir = r.z > 0 ? 1 : -1, ex = dir > 0 ? W - 2 : 2; sv('path', { d: `M${ex - dir * 6},${cy - 5}L${ex},${cy}L${ex - dir * 6},${cy + 5}`, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s); }
}

// ----- facts: each rule produces a sentence and a small chart, scored by how uncommon it is
const HILO = {
  steps: ['Highest step week', 'Lowest step week'], exercise: ['Most exercise in a week', 'Least exercise in a week'], active: ['Most active energy in a week', 'Least active energy in a week'],
  _workouts: ['Most workout time in a week', 'Least workout time in a week'], sl_asleep: ['Most sleep in a week', 'Least sleep in a week'], sl_bed: ['Latest bedtimes in a week', 'Earliest bedtimes in a week'],
  sl_wake: ['Latest wake-ups in a week', 'Earliest wake-ups in a week'], rhr: ['Highest resting heart rate week', 'Lowest resting heart rate week'], walkHr: ['Highest walking heart rate week', 'Lowest walking heart rate week'],
  hrv: ['Highest HRV week', 'Lowest HRV week'], resp: ['Highest breathing rate week', 'Lowest breathing rate week'], daylight: ['Most daylight in a week', 'Least daylight in a week'], walkSpeed: ['Fastest walking week', 'Slowest walking week'],
};
function factList(e) {
  const out = [];
  // 1. a 7-day average further out than any week for a long stretch
  for (const [k, ch] of PULSE) {
    const def = pdef(k); if (!def) continue;
    const J = Math.floor((e - 6) / 7), vals = []; for (let j = 0; j <= J; j++) vals.push(wkVal(k, ...wkRange(e, j)));
    const cur = vals[0]; if (cur == null) continue;
    for (const hi of [true, false]) {
      let cnt = 0, since = -1;
      for (let j = 1; j <= J; j++) { const v = vals[j]; if (v == null) continue; if (hi ? v >= cur : v <= cur) { since = j; break; } cnt++; }
      if (cnt < 12) continue;
      const [a0, b0] = since > 0 ? wkRange(e, since) : [0, 0], clock = def.u === 'clock';
      const firstJ = (() => { for (let j = J; j > 0; j--) if (vals[j] != null) return j; return 0; })();
      const title = `${HILO[k][hi ? 0 : 1]} ${since > 0 ? 'since ' + monYr(b0) : 'in your data'}`;
      const cmp = clock ? (hi ? 'later' : 'earlier') : (hi ? 'higher' : 'lower');
      const body = `${vTxt(def.u, cur)} ${PER[k] || 'on average'} over the last 7 days. ` + (since > 0 ? `The last week ${cmp} was ${rangeTxt(a0, b0)} (${vTxt(def.u, vals[since])}).` : `No earlier week was ${cmp}, back to ${monYr(wkRange(e, firstJ)[0])}.`);
      const show = Math.min(J, Math.max(cnt + 8, 26), 156);
      out.push({ kind: 'week', ch, k, score: 20 + Math.min(cnt, 104) / 2 + (since < 0 ? 12 : 0), title, body, cls: def.dir ? ((hi ? 1 : -1) * def.dir > 0 ? 'good' : 'bad') : 'flat', when: `${dShort(e - 6)} – ${dShort(e)}`,
        viz: s => factWeeks(s, vals.slice(0, show + 1).reverse(), since > 0 && since <= show ? show - since : -1, css(def.color || CHMAP[ch].color), def.u) });
    }
  }
  // 2. an all-time daily record set in the last 7 days
  const REC = [['steps', 'Most steps in a day', 1], ['distance', 'Farthest on foot in a day', 1], ['exercise', 'Most exercise in a day', 1], ['active', 'Most active energy in a day', 1], ['daylight', 'Most daylight in a day', 1], ['flights', 'Most flights climbed in a day', 1], ['rhr', 'Lowest resting heart rate', -1], ['hrv', 'Highest HRV', 1]];
  for (const [k, lab, sgn] of REC) {
    const a = D.daily[k]; if (!a || !DEF[k]) continue;
    const argb = (lo, hi) => { let b = -1; for (let i = lo; i <= hi; i++) { const v = a[i]; if (v != null && (b < 0 || (v - a[b]) * sgn > 0)) b = i; } return b; };
    const bi = argb(e - 6, e), pi = argb(0, e - 7);
    if (bi < 0 || pi < 0 || (a[bi] - a[pi]) * sgn <= 0) continue;
    if (win(k, 0, e - 7).n < 180) continue;
    const ch = k === 'rhr' ? 'heart' : k === 'hrv' ? 'stress' : k === 'daylight' ? 'env' : 'activity';
    out.push({ kind: 'rec', ch, k, score: 78, title: `New record: ${lab.charAt(0).toLowerCase() + lab.slice(1)}`, body: `${vTxt(DEF[k].u, a[bi])} on ${dLong(bi)}. The previous best was ${vTxt(DEF[k].u, a[pi])}, on ${dShort(pi)}, ${dYr(pi)}.`, cls: 'good', when: dShort(bi),
      viz: s => factDays(s, k, e, bi, pi, css(DEF[k].color || CHMAP[ch].color)) });
  }
  { const v = (PTS.vo2max || []).filter(q => q.i <= e); if (v.length >= 6) { const last = v[v.length - 1], prior = v.slice(0, -1), best = prior.reduce((x, q) => q.v > x.v ? q : x); if (last.i >= e - 6 && last.v > best.v) out.push({ kind: 'rec', ch: 'heart', k: 'vo2max', score: 74, title: 'Highest cardio fitness reading yet', body: `${vTxt(DEF.vo2max.u, last.v)} on ${dLong(last.i)}, above the previous best of ${vTxt(DEF.vo2max.u, best.v)} (${dShort(best.i)}, ${dYr(best.i)}).`, cls: 'good', when: dShort(last.i), viz: s => factPoints(s, v.slice(-40), best, css(CHMAP.heart.color)) }); } }
  // 3. a run of days on target
  for (const L of LEVERS) {
    const rn = leverRuns(L, e); if (rn.cur < 7) continue;
    const best = rn.cur >= rn.best;
    if (!best && rn.cur < 14) continue;
    out.push({ kind: 'run', ch: L.ch, k: L.id, score: best ? 48 + Math.min(rn.cur, 60) / 2 : 26 + rn.cur / 3, title: `${L.t} target: ${rn.cur} ${WORD(L)} in a row`, body: best ? `Your longest run in the data. Target: ${L.tl}.` : `Your best run is ${rn.best} ${WORD(L)}, ending ${dShort(rn.bestEnd)}, ${dYr(rn.bestEnd)}. Target: ${L.tl}.`, cls: 'good', when: 'to ' + dShort(e),
      viz: s => factRun(s, L, e, rn.cur) });
  }
  // 4. the last 30 days against the same 30 days a year earlier
  for (const [k, ch] of [['rhr', 'heart'], ['hrv', 'stress'], ['steps', 'activity'], ['sl_asleep', 'sleep'], ['exercise', 'activity'], ['walkSpeed', 'mobility'], ['daylight', 'env']]) {
    const def = DEF[k]; if (!def || e - 394 < 0) continue;
    const a = win(k, e - 29, e), b = win(k, e - 394, e - 365); if (a.n < 15 || b.n < 15) continue;
    const blocks = []; for (let j = 0; e - 30 * j - 29 >= 0 && j < 36; j++) { const r = win(k, e - 30 * j - 29, e - 30 * j); if (r.n >= 15) blocks.push(r.v); }
    if (blocks.length < 8) continue;
    const mu = blocks.reduce((x, y) => x + y, 0) / blocks.length, sd = Math.sqrt(blocks.reduce((x, y) => x + (y - mu) ** 2, 0) / (blocks.length - 1));
    const d = a.v - b.v; if (!(sd > 0) || Math.abs(d) < 1.2 * sd || Math.abs(d) < 2 * (MINSTEP[def.u] || 0)) continue;
    const info = deltaInfo(def.u, def.dir, a.v, b.v); if (!info || info.cls === 'flat' && def.dir) continue;
    const word = def.u === 'dur' ? (d > 0 ? 'more' : 'less') : (d > 0 ? 'higher' : 'lower');
    const series = []; for (let j = 12; j >= 0; j--) { const r = win(k, e - 30 * j - 29, e - 30 * j); series.push(r.n >= 15 ? r.v : null); }
    out.push({ kind: 'yoy', ch, k, score: 22 + 10 * Math.min(Math.abs(d) / sd, 4), title: `${k === "rhr" ? DEF[k].t : pname(k)}: ${info.txt} ${word} than a year ago`, body: `${vTxt(def.u, a.v)} ${PER[k] || 'on average'} over the last 30 days, against ${vTxt(def.u, b.v)} for ${dShort(e - 394)} – ${dShort(e - 365)}, ${dYr(e - 365)}.`, cls: info.cls, when: 'last 30 days',
      viz: s => factYoY(s, series, css(def.color || CHMAP[ch].color), def.u) });
  }
  // 5. a workout type back after a long gap, or for the first time
  { const seen = new Set();
    WK.filter(w => w.i >= e - 6 && w.i <= e).sort((x, y) => x.i - y.i).forEach(w => {
      if (seen.has(w.type)) return; seen.add(w.type);
      const before = WK.filter(q => q.type === w.type && q.i < e - 6); const prev = before.length ? before.reduce((x, q) => q.i > x.i ? q : x) : null;
      if (prev ? w.i - prev.i < 60 : w.i < 180) return;
      const gap = prev ? w.i - prev.i : null, gtxt = gap == null ? '' : gap >= 365 ? `${nf(gap / 365, 1)} years` : gap >= 60 ? `${Math.round(gap / 30.4)} months` : `${gap} days`;
      out.push({ kind: 'wk', ch: 'workouts', k: w.type, score: prev ? 30 + Math.min(gap, 365) / 12 : 46, title: prev ? `First ${w.type.toLowerCase()} workout in ${gtxt}` : `First ${w.type.toLowerCase()} workout in your data`, body: `${dLong(w.i)}, ${fmtDur(w.min)}${w.km ? `, ${nf(w.km, 1)} ${DU}` : ''}.` + (prev ? ` The one before was on ${dShort(prev.i)}, ${dYr(prev.i)}.` : ''), cls: 'flat', when: dShort(w.i),
        viz: s => factTimeline(s, WK.filter(q => q.type === w.type && q.i > e - 365 && q.i <= e), e, w.i, css(CHMAP.workouts.color)) });
    }); }
  // 6. gaps in the data this week, so the averages above are read correctly
  { const miss = []; for (let i = e - 6; i <= e; i++) if (get('steps', i) == null && get('rhr', i) == null && get('hrAvg', i) == null && get('sl_asleep', i) == null) miss.push(i);
    if (miss.length >= 2 && miss.length < 7) out.push({ kind: 'gap', ch: 'overview', k: 'gap', score: 60, title: `No data on ${miss.length} of the last 7 days`, body: `${miss.map(dShort).join(', ')}. The 7-day figures on this page use the days that were recorded.`, cls: 'flat', when: `${dShort(e - 6)} – ${dShort(e)}`, viz: s => factGap(s, e, miss) }); }
  // pick: strongest first, at most 2 per chapter and 3 of one kind
  out.sort((a, b) => b.score - a.score);
  const pick = [], byCh = {}, byKind = {}, byKey = new Set();
  for (const f of out) { if (pick.length >= 6) break; if ((byCh[f.ch] || 0) >= 2 || (byKind[f.kind] || 0) >= 3 || byKey.has(f.k + f.kind)) continue; byCh[f.ch] = (byCh[f.ch] || 0) + 1; byKind[f.kind] = (byKind[f.kind] || 0) + 1; byKey.add(f.k + f.kind); pick.push(f); }
  return pick;
}
function factsCard(root, e) {
  const fs = factList(e);
  const sec = el('div', 'ovsec'); sec.append(el('h2', null, 'Worth knowing'), el('p', 'mono', 'Found by fixed rules: records, streaks, weeks unlike any in months, year-on-year shifts'));
  root.appendChild(sec);
  if (!fs.length) { const c = el('section', 'card fact none'); c.appendChild(el('p', null, 'Nothing crossed a rule this week: no records, no 12-week highs or lows, no long runs on target, and no year-on-year shifts larger than usual.')); root.appendChild(c); return; }
  const g = el('div', 'ofacts');
  fs.forEach((f, k) => {
    const chd = CHMAP[f.ch], color = f.ch === 'overview' ? css('--ink-2') : css(chd.color);
    const c = el('button', 'card fact'); c.type = 'button'; if (f.ch !== 'overview') c.addEventListener('click', () => go(f.ch)); else c.disabled = true;
    const top = el('div', 'ofm mono'); const i = el('i'); i.style.background = color; top.append(i, el('span', null, f.ch === 'overview' ? 'Data' : (f.ch === 'stress' ? 'Recovery' : chd.name)), el('span', 'ofw', f.when));
    const t = el('h3', 'oft ' + f.cls, f.title);
    const s = sv('svg', { class: 'ofv', 'aria-hidden': 'true' });
    c.append(top, t, el('p', 'ofb', f.body), s); g.appendChild(c);
    c.style.setProperty('--k', k);
    RENDER.push(() => { s.replaceChildren(); f.viz(s); });
  });
  root.appendChild(g);
}
// small charts for facts (48px tall, full card width)
function vbox(s, H = 48) { const W = Math.max(s.clientWidth || 260, 160); s.setAttribute('viewBox', `0 0 ${W} ${H}`); return [W, H]; }
function factWeeks(s, vals, sinceK, color, u) {
  const [W, H] = vbox(s), nn = vals.filter(v => v != null); if (nn.length < 2) return;
  const lo = Math.min(...nn), hi = Math.max(...nn), n = vals.length, x = k => 4 + k / (n - 1) * (W - 8), y = v => H - 6 - (hi > lo ? (v - lo) / (hi - lo) : .5) * (H - 12);
  const cur = vals[n - 1], cy = y(cur);
  if (sinceK >= 0) { sv('line', { x1: x(sinceK), x2: x(n - 1), y1: cy, y2: cy, stroke: css('--ink-3'), 'stroke-dasharray': '2 3' }, s); }
  else sv('line', { x1: 4, x2: x(n - 1), y1: cy, y2: cy, stroke: css('--ink-3'), 'stroke-dasharray': '2 3', 'stroke-opacity': .7 }, s);
  const pts = vals.map((v, k) => v == null ? null : [x(k), y(v)]);
  runs(pts, 2).forEach(r => { if (r.length < 2) return; const p = sv('path', { d: poly(r), fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s); traceIn(p); });
  if (sinceK >= 0 && vals[sinceK] != null) sv('circle', { cx: x(sinceK), cy: y(vals[sinceK]), r: 3.5, fill: css('--card'), stroke: color, 'stroke-width': 1.6 }, s);
  const d = sv('circle', { cx: x(n - 1), cy, r: 4.5, fill: color, stroke: css('--card'), 'stroke-width': 2 }, s); anim(d, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'none' }], { delay: 700, duration: 400 }); d.style.transformOrigin = `${x(n - 1)}px ${cy}px`;
}
function traceIn(p) { if (!ANIM || !p.getTotalLength) return; const L = p.getTotalLength(); p.style.strokeDasharray = L; anim(p, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 1000 }); requestAnimationFrame(() => setTimeout(() => { p.style.strokeDasharray = ''; }, 1100)); }
function factDays(s, k, e, bi, pi, color) {
  const [W, H] = vbox(s), a = Math.max(0, e - 364), n = e - a + 1, bw = (W - 4) / n;
  let hi = 0; for (let i = a; i <= e; i++) { const v = get(k, i); if (v != null) hi = Math.max(hi, v); }
  const low = k === 'rhr', ex = extremes(k, a, e), lo = low ? ex.lo - (ex.hi - ex.lo) * .15 : 0; if (low) hi = ex.hi;
  for (let i = a; i <= e; i++) { const v = get(k, i); if (v == null) continue; const f = low ? (hi - v) / (hi - lo) : v / hi, h = Math.max(1, f * (H - 4)); const on = i === bi, pv = i === pi; const r = sv('rect', { x: 2 + (i - a) * bw, y: H - h, width: Math.max(1, bw * (on ? 2.4 : .8)), height: h, fill: on ? color : pv ? css('--ink-2') : css('--ink-3'), 'fill-opacity': on ? 1 : pv ? .7 : .28 }, s); if (on) { r.setAttribute('x', 2 + (i - a) * bw - bw * .8); anim(r, [{ transform: 'scaleY(.001)' }, { transform: 'none' }], { delay: 300 }); r.style.transformOrigin = `0 ${H}px`; } }
}
function factPoints(s, v, best, color) {
  const [W, H] = vbox(s), lo = Math.min(...v.map(q => q.v)), hi = Math.max(...v.map(q => q.v)), a = v[0].i, b = v[v.length - 1].i;
  const x = i => 4 + (b > a ? (i - a) / (b - a) : .5) * (W - 8), y = q => H - 6 - (hi > lo ? (q - lo) / (hi - lo) : .5) * (H - 12);
  sv('line', { x1: 4, x2: W - 4, y1: y(best.v), y2: y(best.v), stroke: css('--ink-3'), 'stroke-dasharray': '2 3' }, s);
  v.forEach((q, k) => sv('circle', { cx: x(q.i), cy: y(q.v), r: k === v.length - 1 ? 4.5 : 2.2, fill: k === v.length - 1 ? color : css('--ink-3'), 'fill-opacity': k === v.length - 1 ? 1 : .6 }, s));
}
function factRun(s, L, e, cur) {
  const [W, H] = vbox(s, 30), n = Math.min(Math.max(cur + 10, 28), 84), a = e - n + 1, gap = 2, cw = (W - (n - 1) * gap) / n;
  const good = css('--good');
  for (let i = a; i <= e; i++) { const med = L.id === 'rhythm' ? leverMedCache(L, i) : null, hit = hitAt(L, i, med), inRun = i > e - cur;
    const r = sv('rect', { x: (i - a) * (cw + gap), y: 4, width: Math.max(1, cw), height: H - 8, rx: Math.min(3, cw / 2), fill: hit == null ? css('--grid') : hit ? good : css('--ink-3'), 'fill-opacity': hit == null ? 1 : hit ? (inRun ? .95 : .45) : .3 }, s);
    anim(r, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: (i - a) * 12 }); }
}
function factYoY(s, series, color, u) {
  const [W, H] = vbox(s), nn = series.filter(v => v != null); if (nn.length < 2) return;
  const lo = Math.min(...nn), hi = Math.max(...nn), n = series.length, x = k => 6 + k / (n - 1) * (W - 12), y = v => H - 7 - (hi > lo ? (v - lo) / (hi - lo) : .5) * (H - 14);
  const pts = series.map((v, k) => v == null ? null : [x(k), y(v)]);
  runs(pts, 2).forEach(r => { if (r.length > 1) traceIn(sv('path', { d: smooth(r), fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-opacity': .55 }, s)); });
  [0, n - 1].forEach(k => { if (series[k] == null) return; sv('circle', { cx: x(k), cy: y(series[k]), r: k ? 4.5 : 3.5, fill: k ? color : css('--card'), stroke: k ? css('--card') : color, 'stroke-width': k ? 2 : 1.6 }, s); });
}
function factTimeline(s, ws, e, cur, color) {
  const [W, H] = vbox(s, 30), a = e - 364, x = i => 4 + (i - a) / 364 * (W - 8);
  sv('line', { x1: 4, x2: W - 4, y1: H / 2, y2: H / 2, stroke: css('--grid'), 'stroke-width': 2, 'stroke-linecap': 'round' }, s);
  for (let m = 0; m <= 12; m++) { const i = di(dYr(a), dt(a).getUTCMonth() + m, 1); if (i > a && i < e) sv('line', { x1: x(i), x2: x(i), y1: H / 2 - 4, y2: H / 2 + 4, stroke: css('--ink-3'), 'stroke-opacity': .4 }, s); }
  ws.forEach(w => sv('circle', { cx: x(w.i), cy: H / 2, r: w.i === cur ? 5 : 3, fill: w.i === cur ? color : css('--ink-3'), 'fill-opacity': w.i === cur ? 1 : .55, stroke: w.i === cur ? css('--card') : 'none', 'stroke-width': 2 }, s));
}
function factGap(s, e, miss) {
  const [W, H] = vbox(s, 30), gap = 6, cw = (W - 6 * gap) / 7;
  for (let i = e - 6; i <= e; i++) { const k = i - e + 6, m = miss.includes(i); sv('rect', { x: k * (cw + gap), y: 4, width: cw, height: H - 8, rx: 5, fill: m ? 'none' : css('--ink-3'), 'fill-opacity': .35, stroke: m ? css('--ink-3') : 'none', 'stroke-dasharray': '3 3' }, s); }
}

// ----- targets: one row per target, last 8 weeks
function targetsCard(root, e) {
  const all = LEVERS.map(L => ({ L, rn: leverRuns(L, e) })).filter(x => { let n = 0; for (let i = e - 55; i <= e; i++) if (get(x.L.key, i) != null) n++; return n >= 10; });
  if (!all.length) return;
  const c = el('section', 'card targets');
  const hd = el('div', 'ovh'); hd.append(el('h2', null, 'Targets, last 8 weeks'), el('p', 'mono', 'Each mark is a day. A run allows one missed day in any 7.')); c.appendChild(hd);
  const g = el('div', 'tgrid');
  all.forEach(({ L, rn }, idx) => {
    const color = css(L.color || CHMAP[L.ch].color);
    let h = 0, n = 0; for (let i = e - 55; i <= e; i++) { const med = L.id === 'rhythm' ? leverMedCache(L, i) : null, hit = hitAt(L, i, med); if (hit == null) continue; n++; if (hit) h++; }
    const row = el('button', 'trow'); row.type = 'button'; row.addEventListener('click', () => go(L.ch));
    const nm = el('span', 'otn'); const i = el('i'); i.style.background = color; nm.append(i, el('b', null, L.t), el('small', null, L.tl));
    const s = sv('svg', { class: 'ots', 'aria-label': `${L.t}, last 8 weeks` });
    const hv = el('span', 'oth'); hv.append(el('b', null, `${h}`), el('small', null, ` of ${n} ${WORD(L)}`));
    const rv = el('span', 'otr'); const r1 = el('span'); r1.append(el('b', null, String(rn.cur)), el('small', null, ' in a row')); rv.append(r1, el('em', 'mono', rn.best ? `best ${rn.best}, ${dShort(rn.bestEnd)} ${dYr(rn.bestEnd)}` : 'no run yet'));
    row.append(nm, s, hv, rv); g.appendChild(row);
    RENDER.push(() => targetStrip(s, L, e, idx));
  });
  c.appendChild(g); root.appendChild(c);
}
function targetStrip(s, L, e, idx) {
  s.replaceChildren();
  const W = Math.max(s.clientWidth || 300, 180), H = 26, n = 56, wg = 5, gap = 2, cw = (W - 7 * wg - (n - 8) * gap) / n;
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const good = css('--good'), miss = css('--ink-3');
  let x = 0;
  for (let k = 0; k < n; k++) {
    const i = e - 55 + k, med = L.id === 'rhythm' ? leverMedCache(L, i) : null, hit = hitAt(L, i, med), v = get(L.key, i);
    const hh = hit == null ? 4 : hit ? H - 4 : H - 12;
    const r = sv('rect', { x, y: (H - hh) / 2, width: Math.max(1, cw), height: hh, rx: Math.min(2.5, cw / 2), fill: hit == null ? css('--grid') : hit ? good : miss, 'fill-opacity': hit == null ? 1 : hit ? .9 : .35 }, s);
    anim(r, [{ opacity: 0, transform: 'scaleY(.2)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: idx * 60 + k * 9 }); r.style.transformOrigin = `${x + cw / 2}px ${H / 2}px`;
    r.addEventListener('pointerenter', () => { const bb = r.getBoundingClientRect(); showTip(bb.left + bb.width / 2, bb.top, dLong(i), [{ v: v == null ? 'No data' : fmt(L.u, v), c: hit == null ? null : hit ? good : miss, l: hit == null ? '' : hit ? 'on target' : 'below target' }]); });
    r.addEventListener('pointerleave', hideTip);
    x += cw + ((k + 1) % 7 === 0 ? wg : gap);
  }
}

// ----- the shape of a usual week, by weekday (last 12 weeks)
function weekdayCard(root, e) {
  const a = e - 83, ORDER = [1, 2, 3, 4, 5, 6, 0], WDL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const panels = [['steps', 'Steps', 'activity'], ['exercise', 'Exercise', 'activity'], ['sl_asleep', 'Sleep, by the morning you woke', 'sleep'], ['sl_bed', 'Bedtime, by the morning you woke', 'sleep']].filter(([k]) => win(k, a, e).n >= 40);
  if (panels.length < 2) return;
  const c = el('section', 'card wkday');
  const hd = el('div', 'ovh'); hd.append(el('h2', null, 'Your week, by weekday'), el('p', 'mono', `Average for each weekday, ${dShort(a)} – ${dShort(e)} (12 weeks)`)); c.appendChild(hd);
  const g = el('div', 'wgrid');
  panels.forEach(([k, name, ch], pi) => {
    const def = pdef(k), color = css(def.color || CHMAP[ch].color);
    const by = ORDER.map(wd => { const v = []; for (let i = a; i <= e; i++) if (dt(i).getUTCDay() === wd) { const x = get(k, i); if (x != null) v.push(x); } return v.length >= 4 ? v.reduce((x, y) => x + y, 0) / v.length : null; });
    const nn = by.map((v, j) => [v, j]).filter(x => x[0] != null); if (nn.length < 5) return;
    const hiJ = nn.reduce((x, y) => y[0] > x[0] ? y : x)[1], loJ = nn.reduce((x, y) => y[0] < x[0] ? y : x)[1], clock = def.u === 'clock';
    const p = el('div', 'wp');
    p.appendChild(el('div', 'wt', name));
    p.appendChild(el('div', 'wc', clock ? `Latest on ${WDL[ORDER[hiJ]]} (${fmtClock(by[hiJ])}), earliest on ${WDL[ORDER[loJ]]} (${fmtClock(by[loJ])})` : `Most on ${WDL[ORDER[hiJ]]} (${U[def.u].c(by[hiJ])}), least on ${WDL[ORDER[loJ]]} (${U[def.u].c(by[loJ])})`));
    const s = sv('svg', { class: 'wsvg', 'aria-label': name + ' by weekday' }); p.appendChild(s); g.appendChild(p);
    RENDER.push(() => weekdayBars(s, by, def, color, hiJ, loJ, pi));
  });
  if (!g.children.length) return;
  c.appendChild(g); root.appendChild(c);
}
function weekdayBars(s, by, def, color, hiJ, loJ, pi) {
  s.replaceChildren();
  const W = Math.max(s.clientWidth || 220, 160), H = 118, top = 18, base = H - 18, clock = def.u === 'clock';
  s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const nn = by.filter(v => v != null), lo = clock ? Math.min(...nn) - 40 : 0, hi = Math.max(...nn) * (clock ? 1 : 1.0) + (clock ? 20 : 0);
  const cw = W / 7, bw = Math.min(26, cw * .56), y = v => base - (hi > lo ? (v - lo) / (hi - lo) : .5) * (base - top);
  const mean = nn.reduce((x, y2) => x + y2, 0) / nn.length;
  const LET = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  by.forEach((v, j) => {
    const cx = cw * j + cw / 2, isHi = j === hiJ, isLo = j === loJ;
    const t = sv('text', { x: cx, y: H - 3, 'text-anchor': 'middle', class: 'reflab' }, s); t.textContent = LET[j]; if (j >= 5) t.style.fill = css('--ink'); else t.style.fill = css('--ink-3');
    if (v == null) return;
    const op = isHi || isLo ? 1 : .42;
    if (clock) {
      const c = sv('circle', { cx, cy: y(v), r: 5.5, fill: color, 'fill-opacity': op, stroke: css('--card'), 'stroke-width': 2 }, s);
      sv('line', { x1: cx, x2: cx, y1: y(v) + 7, y2: base, stroke: color, 'stroke-opacity': .18, 'stroke-width': 2 }, s);
      anim(c, [{ transform: `translate(0px,${base - y(v)}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, delay: pi * 90 + j * 45 });
    } else {
      const r = sv('path', { d: barPath(cx, base, y(v), bw, 5), fill: color, 'fill-opacity': op }, s);
      anim(r, [{ transform: 'scaleY(.001)' }, { transform: 'none' }], { duration: 650, delay: pi * 90 + j * 45 }); r.style.transformOrigin = `${cx}px ${base}px`;
    }
    if (isHi || isLo) { const lt = sv('text', { x: j === 6 ? W : j === 0 ? 0 : cx, y: y(v) - (clock ? 10 : 6), 'text-anchor': j === 6 ? 'end' : j === 0 ? 'start' : 'middle', class: 'reflab' }, s); lt.textContent = clock ? fmtClock(v) : U[def.u].c(v); anim(lt, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: pi * 90 + 500 }); }
  });
  if (!clock) { const my = y(mean); sv('line', { x1: 0, x2: W, y1: my, y2: my, stroke: css('--ink-3'), 'stroke-dasharray': '2 3', 'stroke-opacity': .8 }, s); }
  sv('line', { x1: 0, x2: W, y1: base, y2: base, stroke: css('--grid') }, s);
}

function overviewChapter(root, view, p) {
  const e = Math.min(p.b, LAST);
  pulseCard(root, e);
  factsCard(root, e);
  const sec = el('div', 'ovsec'); sec.append(el('h2', null, 'Targets'), el('p', 'mono', 'Sleep, steps, exercise, daylight and sleep timing, against the targets in Settings')); root.appendChild(sec);
  nudgeLayer(root, e);
  targetsCard(root, e);
  weekdayCard(root, e);
  recordsCard(root);
  const sec2 = el('div', 'ovsec'); sec2.append(el('h2', null, 'Every measure'), el('p', 'mono', `Last 30 days (${dShort(e - 29)} – ${dShort(e)}) against the 30 before`)); root.appendChild(sec2);
  const k = el('div', 'ctx k'); k.append(chipEl({ cls: 'good', arrow: ARROW_UP, txt: 'Better direction' }), chipEl({ cls: 'bad', arrow: ARROW_DN, txt: 'Other direction' }), chipEl({ cls: 'flat', arrow: '', txt: 'No clear better' })); k.style.margin = '-4px 6px 2px'; root.appendChild(k);
  const board = el('section', 'card board');
  const hd = el('div', 'brow hd');
  ['Measure', 'Last 30 days', 'Change', 'Last 12 months', 'Where it sits in your range'].forEach((t, k2) => hd.appendChild(el('div', k2 === 4 ? 'brange' : '', t)));
  board.appendChild(hd);
  const ed = dt(e), m12 = []; for (let k2 = 11; k2 >= 0; k2--) { const a = di(ed.getUTCFullYear(), ed.getUTCMonth() - k2, 1), b = Math.min(di(ed.getUTCFullYear(), ed.getUTCMonth() - k2 + 1, 0), e); m12.push({ a, b }); }
  const allMonths = buckets('month', 0, LAST);
  for (const [ch, keys] of BOARD) {
    const chd = CHMAP[ch];
    const g = el('div', 'bgroup'); g.append(glyph(ch), el('span', null, chd.name)); board.appendChild(g);
    for (const key of keys) {
      const def = key === '_workouts' ? WDEF : DEF[key], c2 = css(def.color || chd.color), S2 = boardSeries(def);
      if (def.key === '_workouts' && !WK.length) continue;
      const v = S2.cur(e); if (v == null) continue;
      const pv = S2.prev(e);
      const row = el('button', 'brow'); row.type = 'button'; row.addEventListener('click', () => go(ch));
      const nm = el('div', 'bname'); nm.appendChild(el('span', null, def.t)); nm.appendChild(el('small', null, def.key === '_workouts' ? 'Higher is better' : (dirText(def) || 'No single better direction'))); row.appendChild(nm);
      const vwrap = el('div'); vwrap.appendChild(el('div', 'bl', def.k === 'points' ? 'Latest' : def.key === '_workouts' ? 'Last 30 days, total' : def.k === 'bar' ? 'Last 30 days, daily avg' : 'Last 30 days, avg'));
      const vv = el('div', 'bval'); const [a1, b1] = F1(def.u, v); vv.appendChild(document.createTextNode(a1)); if (b1) vv.appendChild(el('small', null, b1)); vwrap.appendChild(vv); row.appendChild(vwrap);
      const vs = el('div', 'bvs'); const info = deltaInfo(def.u, def.dir, v, pv); if (info) { vs.appendChild(chipEl(info)); if (pv != null) vs.appendChild(el('span', 'cap', `from ${U[def.u].c(pv)}`)); } row.appendChild(vs);
      const sp = el('div', 'bspark'); sp.appendChild(el('div', 'bl', 'Last 12 months'));
      const mv = m12.map(m => S2.bucket(m.a, m.b)); const s = sv('svg', { height: 40, 'aria-hidden': 'true' }); sp.appendChild(s); row.appendChild(sp);
      RENDER.push(() => sparkMonths(s, mv, c2));
      const rg = el('div', 'brange'); rg.appendChild(el('div', 'bl', 'Where it sits in your range'));
      const mvals = allMonths.map(m => S2.bucket(m.s, m.e)).filter(x => x != null);
      const gsv = sv('svg', { height: 36, 'aria-hidden': 'true' }); rg.appendChild(gsv); row.appendChild(rg);
      RENDER.push(() => gauge(gsv, mvals, v, c2, def.u));
      board.appendChild(row);
    }
  }
  root.appendChild(board);
}

function sparkMonths(s, vals, color) {
  s.replaceChildren();
  const W = Math.max(s.clientWidth || 160, 120), H = 40; s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const nn = vals.filter(v => v != null); if (!nn.length) return;
  const lo = Math.min(...nn), hi = Math.max(...nn), pad = (hi - lo) * .2 || Math.abs(hi) * .05 || 1;
  const x = k => 5 + k / 11 * (W - 10), y = v => H - 6 - (v - lo + pad) / (hi - lo + 2 * pad) * (H - 12);
  const pts = vals.map((v, k) => v == null ? null : [x(k), y(v)]);
  runs(pts, 1).forEach(r => { if (r.length > 1) { const d = smooth(r); sv('path', { d: d + `L${r[r.length - 1][0]},${H}L${r[0][0]},${H}Z`, fill: areaGrad(s, color, .16) }, s); sv('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }, s); } });
  pts.forEach((pt, k) => pt && sv('circle', { cx: pt[0], cy: pt[1], r: k === pts.length - 1 ? 3.5 : 1.8, fill: color, stroke: k === pts.length - 1 ? css('--card') : 'none', 'stroke-width': 2 }, s));
}
function gauge(s, mvals, cur, color, u) {
  s.replaceChildren(); if (!mvals.length) return;
  const W = Math.max(s.clientWidth || 160, 140), H = 36; s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const mn = Math.min(...mvals), mx = Math.max(...mvals), lo = Math.min(mn, cur), hi = Math.max(mx, cur), avg = mvals.reduce((a, b) => a + b, 0) / mvals.length;
  const x = v => 7 + (hi > lo ? (v - lo) / (hi - lo) : .5) * (W - 14);
  sv('line', { x1: 7, x2: W - 7, y1: 11, y2: 11, stroke: css('--grid'), 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
  sv('line', { x1: x(mn), x2: x(mx), y1: 11, y2: 11, stroke: color, 'stroke-opacity': .25, 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
  sv('line', { x1: x(avg), x2: x(avg), y1: 5, y2: 17, stroke: css('--ink-3'), 'stroke-width': 1.5 }, s);
  sv('circle', { cx: x(cur), cy: 11, r: 6, fill: color, stroke: css('--card'), 'stroke-width': 2.5 }, s);
  const f = `600 10.5px ${SANS}`, ltxt = 'low ' + U[u].c(mn), rtxt = 'high ' + U[u].c(mx), lw = tw(ltxt, f), rw = tw(rtxt, f);
  const t1 = sv('text', { x: 7, y: 31, class: 'reflab' }, s); t1.textContent = ltxt;
  const t2 = sv('text', { x: W - 7, y: 31, class: 'reflab', 'text-anchor': 'end' }, s); t2.textContent = rtxt;
  const aw = tw('avg', f), ax = x(avg);
  if (ax - aw / 2 > 7 + lw + 8 && ax + aw / 2 < W - 7 - rw - 8) { const t3 = sv('text', { x: ax, y: 31, class: 'reflab', 'text-anchor': 'middle' }, s); t3.textContent = 'avg'; }
}

// ---------------- chrome
function glyph(id) { const g = el('span', 'glyph'); g.style.setProperty('--gc', `var(${CHMAP[id].color})`); g.innerHTML = iconSvg(id); return g; }
let NAVPOS = null;
function renderNav() {
  const nav = document.getElementById('nav'); nav.replaceChildren();
  const SHORT = { stress: 'Recovery', env: 'Sound & light' };
  CH.forEach(c => { const b = el('button'); b.type = 'button'; b.title = c.name; b.append(glyph(c.id), el('span', 'nl', c.name), el('span', 'ns', SHORT[c.id] || c.name)); if (c.id === S.ch) b.setAttribute('aria-current', 'true'); b.addEventListener('click', () => go(c.id)); nav.appendChild(b); });
  const cur = nav.querySelector('[aria-current]'); if (cur && getComputedStyle(nav).position === 'fixed') requestAnimationFrame(() => { const r = cur.getBoundingClientRect(), nr = nav.getBoundingClientRect(); if (r.left < nr.left || r.right > nr.right) nav.scrollLeft += r.left - nr.left - (nr.width - r.width) / 2; });
  // a single indicator slides from the previous chapter to the new one
  if (cur) {
    const ind = el('span', 'nav-ind'); ind.setAttribute('aria-hidden', 'true'); nav.appendChild(ind);
    const pos = { l: cur.offsetLeft, t: cur.offsetTop, w: cur.offsetWidth, h: cur.offsetHeight }, place = q => { ind.style.cssText = `left:${q.l}px;top:${q.t}px;width:${q.w}px;height:${q.h}px`; };
    const from = NAVPOS && !RM && NAVPOS.id !== S.ch ? NAVPOS : null;
    place(from || pos);
    if (from) { void ind.offsetWidth; ind.classList.add('mv'); place(pos); }
    NAVPOS = { ...pos, id: S.ch };
  }
}
function renderBar() {
  const v = document.getElementById('views'); v.replaceChildren();
  VIEWS.forEach(k => { const b = el('button', null, k); b.type = 'button'; b.title = VNAME[k]; b.setAttribute('aria-pressed', S.view === k); b.addEventListener('click', () => { S.view = k; save(); render(); }); v.appendChild(b); });
  const p = period(S.view, S.ref);
  document.getElementById('plabel').textContent = periodLabel(S.view, p);
  document.getElementById('prev').disabled = S.view === 'All' || p.a <= 0;
  document.getElementById('next').disabled = S.view === 'All' || p.b >= LAST;
  const yr = document.getElementById('years'); yr.replaceChildren(); yr.hidden = S.view !== 'Y';
  for (let y = dYr(0); y <= dYr(LAST); y++) {
    const b = el('button', null, String(y)); b.type = 'button';
    if (y === dYr(LAST)) b.appendChild(el('small', null, 'YTD'));
    b.setAttribute('aria-pressed', dYr(S.ref) === y);
    b.addEventListener('click', () => { S.ref = Math.min(di(y, 11, 31), LAST); render(); });
    yr.appendChild(b);
  }
  const on = yr.querySelector('[aria-pressed="true"]'); if (on) requestAnimationFrame(() => { if (yr.scrollWidth > yr.clientWidth) yr.scrollLeft = on.offsetLeft - yr.clientWidth + on.offsetWidth + 8; });
}
function go(id) { S.ch = id; try { history.replaceState(null, '', '#' + id); } catch (e) {} render(); scrollTo({ top: 0, behavior: 'smooth' }); }
function render() {
  SANS = css('--sans') || SANS;
  hideTip(); RENDER.length = 0;
  renderBar(); renderNav();
  const view = S.view, p = period(view, S.ref), ch = CHMAP[S.ch], e = Math.min(p.b, LAST);
  const main = document.getElementById('main'); main.replaceChildren();
  const head = el('div', 'ch-head'), tl = el('div', 'ch-title');
  tl.append(glyph(ch.id), el('h1', null, ch.name)); head.appendChild(tl);
  const ctx = el('div', 'ctx');
  if (ch.id === 'overview') {
    head.appendChild(el('p', null, 'Your last 7 days against your own usual, what stands out, your targets, and every measure. Everything here is counted from your export; nothing is estimated.'));
    const a = el('span'); a.append(el('b', null, `Week to ${dLong(e)}`)); ctx.appendChild(a);
  } else {
    head.appendChild(el('p', null, ch.desc));
    const cfg = VC[view];
    ctx.append(el('b', null, periodLabel(view, p)), el('span', null, cfg.r ? `Trend line: weighted average of ${cfg.tn} around each day` : 'Each day shown, with your 30-day average for reference'));
  }
  head.appendChild(ctx);
  if (ch.id !== 'overview') { const vr = vitalsRow(ch.id, e, ch.color); if (vr) { const cap = el('div', 'vcap', `Last 30 days to ${dShort(e)}, ${dYr(e)} · line shows the last 90`); head.append(cap, vr); } }
  main.appendChild(head);
  const stack = el('div', 'stack'); main.appendChild(stack);
  if (ch.id === 'overview') overviewChapter(stack, view, p);
  else {
    let missing = [];
    if (ch.custom === 'sleep') sleepChapter(stack, view, p, ch.color);
    else if (ch.custom === 'workouts') workoutsChapter(stack, view, p, ch.color);
    else if (ch.custom === 'body') bodyChapter(stack, view, p, ch.color);
    else {
      if (ch.custom === 'activity' && (view === 'W' || view === 'M') && win('active', p.a, p.b).n) stack.appendChild(ringsCard(view, p));
      missing = renderBands(stack, ch.cards, view, p, ch.color);
    }
    if ((view === 'Y' || view === 'All') && CAL[ch.id] && win(CAL[ch.id], p.a, p.b).n) { const cc = calendarCard(CAL[ch.id], view, p, ch.color); if (cc) stack.appendChild(cc); }
    if (missing.length) stack.appendChild(el('div', 'missing', 'Not recorded in this period: ' + missing.join(', ') + '.'));
    if (!stack.children.length) stack.appendChild(el('div', 'missing', 'Nothing recorded in this period.'));
  }
  const prevR = LASTR; LASTR = { ch: S.ch, a: p.a, b: p.b };
  ZOOM = !RM && prevR && prevR.ch === S.ch && ch.id !== 'overview' && (prevR.a !== p.a || prevR.b !== p.b) ? { a0: prevR.a, b0: prevR.b } : null;
  if (!prevR || prevR.ch !== S.ch) stack.classList.add('enter');
  stack.querySelectorAll(':scope > *').forEach((c, k) => c.style.setProperty('--k', Math.min(k, 8)));
  requestAnimationFrame(() => { ANIM = !RM; runRender(); ZOOM = null; ANIM = false; });
  if (!RM && !SEEN.has(S.ch)) { SEEN.add(S.ch); countUp(main); }
}
// headline numbers count up the first time a chapter is opened, then stay still
const SEEN = new Set();
function countUp(root) {
  root.querySelectorAll('.hero .val, .debt .val, .vt .vv, .rec .rv2').forEach(n => {
    const t = n.firstChild; if (!t || t.nodeType !== 3) return;
    const m = /^([\d,]+)(\.\d+)?$/.exec(t.textContent.trim()); if (!m) return;
    const target = +t.textContent.replace(/,/g, ''), dp = m[2] ? m[2].length - 1 : 0, t0 = performance.now(), dur = 900;
    if (!(target > 0)) return;
    const stepF = now => { const f = Math.min(1, (now - t0) / dur), e2 = 1 - Math.pow(1 - f, 3); t.textContent = nf(target * e2, dp); if (f < 1 && t.isConnected) requestAnimationFrame(stepF); else t.textContent = nf(target, dp); };
    t.textContent = nf(0, dp); requestAnimationFrame(stepF);
  });
}
function runRender() { SYNC.length = 0; ACTIVE = null; RENDER.forEach(f => f()); }
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

document.getElementById('prev').addEventListener('click', () => { S.ref = shiftRef(S.view, S.ref, -1); render(); }, SIG);
document.getElementById('next').addEventListener('click', () => { S.ref = shiftRef(S.view, S.ref, 1); render(); }, SIG);
document.addEventListener('keydown', e => { if (e.target.closest && e.target.closest('input,textarea')) return; if (e.key === '[') document.getElementById('prev').click(); if (e.key === ']') document.getElementById('next').click(); }, SIG);
let rt, lastW = innerWidth; addEventListener('resize', () => { if (Math.abs(innerWidth - lastW) < 2) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(runRender, 150); }, SIG);
if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', render, SIG); }
const MO = new MutationObserver(render); MO.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!AC.signal.aborted) runRender(); });
document.addEventListener('pointerdown', e => { if (ACTIVE && !(e.target.closest && e.target.closest('.hit'))) ACTIVE.off(); }, SIG);
{ let sx = 0, sy = 0, ok = false; const mainEl = document.getElementById('main');
  mainEl.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; const tg = e.target; const wide = tg.closest && tg.closest('.chart'); ok = e.touches.length === 1 && !(tg.closest && tg.closest('.hit, .tbl-wrap, button, .seg, rect[data-i]')) && !(wide && wide.scrollWidth > wide.clientWidth + 1); }, { passive: true, signal: AC.signal });
  mainEl.addEventListener('touchend', e => { if (!ok || S.view === 'All' || S.ch === 'overview') return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) document.getElementById(dx < 0 ? 'next' : 'prev').click(); }, { passive: true, signal: AC.signal }); }
addEventListener('scroll', () => { if (ACTIVE) ACTIVE.off(); }, { passive: true, signal: AC.signal });

const m = D.meta;
document.getElementById('brandSub').textContent = `${MON[dt(0).getUTCMonth()]} ${dYr(0)} – ${dShort(LAST)}, ${dYr(LAST)}`;
document.getElementById('genline').textContent = `Built from the Apple Health export dated ${(m.exportDate || '').slice(0, 10)}. Sources: ${Object.keys(m.sources).join(', ')}.`;
document.getElementById('tgtli').textContent = `Sleep ${hTxt(TG.sleep)} a night (floor ${hTxt(TG.sleepFloor)}), steps ${nf(TG.steps)}, exercise ${TG.exercise} minutes, daylight ${TG.daylight} minutes, sleep timing within an hour of your usual midpoint (the median of the previous 90 nights). "Needs attention" is the target you missed on the most days in the last 14. A chain counts days on target in a row; one missed day in any 7 is forgiven as a rest day, and days with no data neither count nor break it unless 4 or more in a row.`;
render();
return { renderPoster, posterYears, destroy() { AC.abort(); MO.disconnect(); hideTip(); document.getElementById('main').replaceChildren(); }, go };
}
