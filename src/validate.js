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
  return d;
}
