// Impossible dates: node test/trim_timeline.mjs
// A stray record from 1939 (or after the export date, or a tiny cluster years away from the rest)
// must not stretch the timeline. Checks trimTimeline directly, then through the real UI with stored data.
import { trimTimeline, validateData } from '../src/validate.js';
import { sampleData } from '../src/sample.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const DAY = 864e5, T = s => Date.parse(s + 'T00:00:00Z');
// lay `d` onto a wider timeline starting at `start`, with extra single-day values at `extra` dates
function widen(d, start, extra, end) {
  end = end || d.meta.end;
  const n = Math.round((T(end) - T(start)) / DAY) + 1, off = Math.round((T(d.meta.start) - T(start)) / DAY), daily = {};
  for (const [k, a] of Object.entries(d.daily)) { const b = new Array(n).fill(null); a.forEach((v, i) => { if (v != null) b[i + off] = v; }); daily[k] = b; }
  for (const x of extra) daily.steps[Math.round((T(x) - T(start)) / DAY)] = 1234;
  return { ...d, meta: { ...d.meta, start, end, days: n }, daily };
}
const base = sampleData('2026-10-07');
// 1. one record in 1939
{ const d = widen(base, '1939-01-01', ['1939-01-01']), t = trimTimeline(validateData(d));
  ok(t.meta.start === base.meta.start && t.meta.end === base.meta.end, `1939 record dropped: ${t.meta.start} – ${t.meta.end}`);
  ok(t.meta.trimmed && t.meta.trimmed.days === 1 && t.meta.trimmed.from === '1939-01-01', 'trimmed note records 1 day from 1939');
  ok(t.daily.steps.length === t.meta.days && validateData(t) === t, 'result is a valid dataset'); }
// 2. a few stray days in 2009, years before the real data (after 2000, so only the gap rule catches them)
{ const d = widen(base, '2009-03-01', ['2009-03-01', '2009-03-02', '2009-05-10']), t = trimTimeline(d);
  ok(t.meta.start === base.meta.start && t.meta.trimmed.days === 3, `stray 2009 cluster dropped (${t.meta.trimmed && t.meta.trimmed.days} days)`); }
// 3. a record dated after the export
{ const d = widen(base, base.meta.start, ['2031-01-01'], '2031-01-01'), t = trimTimeline(d);
  ok(t.meta.end === base.meta.end, `future record dropped: end ${t.meta.end}`); }
// 4. clean data is returned untouched (same object)
ok(trimTimeline(base) === base, 'clean data untouched');
// 5. a real gap is kept: two years of data, a two-year break, then two more years
{ const a = sampleData('2020-12-31', { days: 730 }), d = widen(a, a.meta.start, [], '2024-12-31');
  for (let i = d.meta.days - 730; i < d.meta.days; i++) d.daily.steps[i] = 5000;
  const t = trimTimeline({ ...d, meta: { ...d.meta, exportDate: '2024-12-31 09:00:00 +0000' } });
  ok(t.meta.start === a.meta.start && t.meta.end === '2024-12-31', 'a long real break is kept'); }
// 6. points and workouts outside the kept window go too
{ const d = widen(base, '1939-01-01', ['1939-01-01']); d.points = { ...d.points, weight: [['1939-01-01T08:00', 70], ...d.points.weight] }; d.workouts = [{ d: '1939-01-01T08:00', type: 'Running', min: 30, src: 'x' }, ...d.workouts];
  const t = trimTimeline(d); ok(t.points.weight.length === base.points.weight.length && t.workouts.length === base.workouts.length && t.meta.trimmed.readings === 2, 'stray reading and workout dropped'); }

// 7. through the UI: data stored before this fix is trimmed on load, and Settings says so
const { chromium } = (await import('node:module')).createRequire(import.meta.url)('playwright');
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8123/'); await p.waitForSelector('#landing:not([hidden]), #app:not([hidden])');
await p.evaluate(async d => { const db = await new Promise(r => { const q = indexedDB.open('health-atlas', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => r(q.result); });
  await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.objectStore('kv').put(d, 'data'); t.oncomplete = r; }); try { localStorage.clear(); } catch (e) {} }, widen(base, '1939-01-01', ['1939-01-01']));
await p.reload(); await p.waitForSelector('#app:not([hidden]) .ch-head');
const sub = await p.textContent('#brandSub'), years = await p.$$eval('#years button', x => x.length);
ok(!/1939/.test(sub), `header no longer starts in 1939: "${sub}"`);
ok(years === 5, `year buttons: ${years}`);
await p.click('#menuBtn'); const info = await p.textContent('#dataInfo');
ok(/Left out 1 entry dated far outside/.test(info) && /1939/.test(info), 'Settings explains what was left out');
await p.keyboard.press('Escape'); await p.reload(); await p.waitForSelector('#app:not([hidden]) .ch-head');
const stored = await p.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('health-atlas', 1); q.onsuccess = () => r(q.result); }); return await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('data'); g.onsuccess = () => r(g.result.meta.start); }); });
ok(stored === base.meta.start, `trimmed data saved back: starts ${stored}`);
ok(!errs.length, 'no page errors ' + errs.join(' | '));
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
