"""Generate src/dashboard.js and assets/dashboard.css from tools/dashboard.template.html
(the standalone dashboard, which reads embedded data). Usage: python3 tools/make_dashboard.py [template.html]
Every replacement must match exactly once, so template drift fails loudly instead of silently."""
import re, sys, pathlib
HERE = pathlib.Path(__file__).resolve().parent.parent
tpl = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / 'tools' / 'dashboard.template.html').read_text()
s = tpl.split('<script>\n(() => {\n"use strict";\n', 1)[1].rsplit('})();', 1)[0]

def R(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'expected {count} match(es), found {n}: {old[:90]!r}')
    s = s.replace(old, new)

# data comes in as an argument
R("const D = JSON.parse(document.getElementById('health-data').textContent);\n",
  "D = prepareData(D, OPT);\nconst AC = new AbortController(), SIG = { signal: AC.signal };\n"
  "const TG = { ...DEFAULT_TARGETS, ...(OPT.targets || {}) }, IMP = OPT.units === 'imperial';\n")
# helpers for target text (after fmtDurC exists)
R("const clockN = m =>", "const hTxt = m => m % 60 ? fmtDurS(m) : `${m / 60} hr`, hS = m => m % 60 ? fmtDurC(m) : `${m / 60}h`;\nconst clockN = m =>")
# imperial units
R("  dur: { f: v => [fmtDur(v), '']",
  "  mi: { f: v => [nf(v, v < 10 ? 2 : 1), 'mi'], c: v => nf(v, 1), t: v => nf(v), d: 'pct' },\n"
  "  mph: { f: v => [nf(v, 2), 'mph'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'mph' },\n"
  "  in1: { f: v => [nf(v, 1), 'in'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: 'in' },\n"
  "  ft: { f: v => [nf(v), 'ft'], c: v => nf(v), d: 'abs', dp: 0, du: 'ft' },\n"
  "  ft2: { f: v => [nf(v, 2), 'ft'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'ft' },\n"
  "  ftps: { f: v => [nf(v, 2), 'ft/s'], c: v => nf(v, 2), t: v => nf(v, 1), d: 'abs', dp: 2, du: 'ft/s' },\n"
  "  lb: { f: v => [nf(v, 1), 'lb'], c: v => nf(v, 1), t: v => nf(v), d: 'abs', dp: 1, du: 'lb' },\n"
  "  dur: { f: v => [fmtDur(v), '']")
# targets
R("target: 8000, ex:", "target: TG.steps, ex:")
R("dir: 1, target: 30, ex: 'Minutes at brisk-walk", "dir: 1, target: TG.exercise, ex: 'Minutes at brisk-walk")
R("dir: 1, target: 30, color: '--c-daylight'", "dir: 1, target: TG.daylight, color: '--c-daylight'")
R("target: 420, floor: 360, ex: 'Total sleep per night. Your target is 7 hours, and never under 6.' }",
  "target: TG.sleep, floor: TG.sleepFloor, ex: `Total sleep per night. Your target is ${hTxt(TG.sleep)}, and never under ${hTxt(TG.sleepFloor)}.` }")
R("for (const k in DEF) DEF[k].key = k;",
  "for (const k in DEF) DEF[k].key = k;\n"
  "const IMPU = { km: 'mi', kmh: 'mph', cm: 'in1', cm1: 'in1', m: 'ft', m2: 'ft2', mps: 'ftps', kg: 'lb' };\n"
  "if (IMP) for (const k in DEF) DEF[k].u = IMPU[DEF[k].u] || DEF[k].u;\n"
  "const DU = IMP ? 'mi' : 'km', HU = IMP ? 'in1' : 'cm', WU = IMP ? 'lb' : 'kg';")
R("['km', 'min', 'floors'].includes(def.u)", "['km', 'mi', 'min', 'floors'].includes(def.u)")
# workout colours: the three most frequent sports in this export get their own colour
R("const WTYPES = [['Pickleball', '--w-1'], ['Walking', '--w-2'], ['Running', '--w-3'], ['Other', '--w-4']];\n"
  "const wgroup = t => (t === 'Pickleball' || t === 'Walking' || t === 'Running') ? t : 'Other';",
  "const TOPW = (() => { const c = {}; for (const w of D.workouts) c[w.type] = (c[w.type] || 0) + 1; return Object.entries(c).filter(([t]) => t !== 'Other').sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]); })();\n"
  "const WTYPES = [...TOPW.map((t, k) => [t, '--w-' + (k + 1)]), ['Other', '--w-4']];\n"
  "const wgroup = t => TOPW.includes(t) ? t : 'Other';")
# sleep chapter
R("'No Apple Watch sleep was recorded in this period.'", "'No sleep was recorded in this period.'")
R("{ l: 'Nights at 7 hr or more',", "{ l: `Nights at ${hTxt(TGT)} or more`,")
R("{ l: 'Nights under 6 hr',", "{ l: `Nights under ${hTxt(FLOOR)}`,")
R("{ t: 'Target 7 hr', cls: 'hl' }, { t: 'Under 6 hr', c: bad, op: .25 }", "{ t: `Target ${hTxt(TGT)}`, cls: 'hl' }, { t: `Under ${hTxt(FLOOR)}`, c: bad, op: .25 }")
R("t.textContent = 'Target 7h';", "t.textContent = 'Target ' + hS(TGT);")
R("t.textContent = 'Floor 6h';", "t.textContent = 'Floor ' + hS(FLOOR);")
# workouts + body units
R("v: [nf(cur.km, 1), 'km']", "v: [nf(cur.km, 1), DU]")
R("nf(w.km, 2) + ' km'", "nf(w.km, 2) + ' ' + DU")
R("F1('cm', ht[ht.length - 1].v)", "F1(HU, ht[ht.length - 1].v)")
R("fmt('kg', q.v)", "fmt(WU, q.v)")
R("fmt('cm', q.v)", "fmt(HU, q.v)")
# levers
R("target: 420, floor: 360, ch: 'sleep', night: true, tl: '7 hr a night, never under 6' }",
  "target: TG.sleep, floor: TG.sleepFloor, ch: 'sleep', night: true, tl: `${hTxt(TG.sleep)} a night, never under ${hTxt(TG.sleepFloor)}` }")
R("target: 8000, ch: 'activity', tl: '8,000 a day' }", "target: TG.steps, ch: 'activity', tl: `${nf(TG.steps)} a day` }")
R("target: 30, ch: 'activity', tl: '30 min a day' }", "target: TG.exercise, ch: 'activity', tl: `${TG.exercise} min a day` }")
R("target: 30, ch: 'env', color: '--c-daylight', tl: '30 min outside a day' }", "target: TG.daylight, ch: 'env', color: '--c-daylight', tl: `${TG.daylight} min outside a day` }")
R("sub: `of sleep across the last 14 nights, against 7 hours a night` }", "sub: `of sleep across the last 14 nights, against ${hTxt(L.target)} a night` }")
R("against 8,000 a day${km ? ` · about ${nf(km, 1)} km not walked` : ''}", "against ${nf(L.target)} a day${km ? ` · about ${nf(km, 1)} ${DU} not walked` : ''}")
R("'of exercise in the last 14 days, against 30 minutes a day'", "`of exercise in the last 14 days, against ${L.target} minutes a day`")
R("'of daylight in the last 14 days, against 30 minutes a day'", "`of daylight in the last 14 days, against ${L.target} minutes a day`")
R("fmtClock(q[0] - 420)} to fit 7 hours before", "fmtClock(q[0] - L.target)} to fit ${hTxt(L.target)} before")
R("'Protect a 7-hour window tonight.'", "`Protect a ${hTxt(L.target)} window tonight.`")
R("{ l: 'Under 6 hours',", "{ l: `Under ${hTxt(L.floor)}`,")
# exports without any workouts: no "0 min" workout row on the overview board
R("const v = S2.cur(e); if (v == null) continue;", "if (def.key === '_workouts' && !WK.length) continue;\n      const v = S2.cur(e); if (v == null) continue;")
# global listeners are removable, so the dashboard can be re-mounted
R("document.getElementById('prev').addEventListener('click', () => { S.ref = shiftRef(S.view, S.ref, -1); render(); });",
  "document.getElementById('prev').addEventListener('click', () => { S.ref = shiftRef(S.view, S.ref, -1); render(); }, SIG);")
R("document.getElementById('next').addEventListener('click', () => { S.ref = shiftRef(S.view, S.ref, 1); render(); });",
  "document.getElementById('next').addEventListener('click', () => { S.ref = shiftRef(S.view, S.ref, 1); render(); }, SIG);")
R("document.getElementById('next').click(); });", "document.getElementById('next').click(); }, SIG);")
R("rt = setTimeout(() => RENDER.forEach(f => f()), 150); });", "rt = setTimeout(() => RENDER.forEach(f => f()), 150); }, SIG);")
R("mq.addEventListener('change', render); }", "mq.addEventListener('change', render, SIG); }")
R("new MutationObserver(render).observe(", "const MO = new MutationObserver(render); MO.observe(")
R("document.fonts.ready.then(() => RENDER.forEach(f => f()));", "document.fonts.ready.then(() => { if (!AC.signal.aborted) RENDER.forEach(f => f()); });")
R("render();\n", "document.getElementById('tgtli').textContent = `Sleep ${hTxt(TG.sleep)} a night (floor ${hTxt(TG.sleepFloor)}), steps ${nf(TG.steps)}, exercise ${TG.exercise} minutes, daylight ${TG.daylight} minutes, sleep timing within an hour of your usual midpoint (the median of the previous 90 nights). \"Needs attention\" is the target you missed on the most days in the last 14. A chain counts days on target in a row; one missed day in any 7 is forgiven as a rest day, and days with no data neither count nor break it unless 4 or more in a row.`;\n"
  "render();\nreturn { destroy() { AC.abort(); MO.disconnect(); hideTip(); document.getElementById('main').replaceChildren(); }, go };\n")

head = '''// GENERATED by tools/make_dashboard.py from the personal dashboard template. Edit the generator, not this file.
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
'''
out = head + s + '}\n'
(HERE / 'src' / 'dashboard.js').write_text(out)
css = tpl.split('<style>\n', 1)[1].split('</style>', 1)[0]
font = '@font-face{font-family:"Figtree";src:url("fonts/figtree-latin.woff2") format("woff2");font-weight:300 900;font-style:normal;font-display:swap}\n'
(HERE / 'assets' / 'dashboard.css').write_text('/* GENERATED by tools/make_dashboard.py from the dashboard template. */\n' + font + css)
print('dashboard.js', len(out), 'dashboard.css', len(css))
