// Compare with friends, through the real UI: node test/compare_flow.cjs test/fixtures
// Needs tools/serve.mjs on :8123 and the synthetic fixtures (python3 test/make_fixtures.py test/fixtures).
// Covers: naming and reading two exports, the dashboard in compare mode, reload (kept in this browser),
// renaming without re-reading, a file that is not an export, the same export twice, ending the comparison,
// your own stored data as one of the people, and the sample-people demo (never stored).
const { chromium } = require('playwright');
const path = require('path');
const FX = process.argv[2] || 'test/fixtures', f = n => path.resolve(FX, n);
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }), p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/'); await p.waitForSelector('#landing:not([hidden])');
  await p.evaluate(async () => { await new Promise(r => { const q = indexedDB.deleteDatabase('health-atlas'); q.onsuccess = q.onerror = q.onblocked = r; }); localStorage.clear(); });
  await p.reload(); await p.waitForSelector('#landing:not([hidden])');

  // 1. two exports, named
  await p.click('#cmpTry'); await p.waitForSelector('#cmp[open]');
  ok(await p.$$eval('.cslot', x => x.length) === 2, 'dialog starts with two people');
  await p.setInputFiles('#cmpFile', [f('watch.zip'), f('iphone-only.zip')]);
  ok(await p.$$eval('.cfile b', x => x.map(e => e.textContent).join('|')) === 'watch.zip|iphone-only.zip', 'two files fill the two slots');
  await p.fill('.cslot:nth-child(1) input', 'Ava'); await p.fill('.cslot:nth-child(2) input', 'Ben');
  await p.click('#cmpGo');
  await p.waitForSelector('#app:not([hidden]) .cmpbar', { timeout: 60000 });
  ok(/Comparing Ava and Ben/.test(await p.textContent('#cmpBar')), 'compare bar names both people');
  ok(await p.$$eval('.pchip', x => x.length) === 2, 'two people chips');
  ok(await p.isHidden('#shareBtn'), 'poster button hidden in compare mode');
  ok(!(await p.$('#nav button[title="Body"]')), 'Body chapter is left out');
  // these two fixtures do not overlap in time: the coverage card says so
  ok(/do not overlap/.test(await p.textContent('.cov + .ct-note')), 'no-overlap note shown');
  for (const ch of ['Heart', 'Sleep', 'Activity', 'Workouts', 'Mobility']) { await p.click(`#nav button[title="${ch}"]`); await p.waitForTimeout(250); }
  for (const v of ['W', 'M', '6M', 'Y', 'All']) { await p.click(`#views button:text-is("${v}")`); await p.waitForTimeout(250); }

  // 2. reload: still comparing
  await p.reload(); await p.waitForSelector('#app:not([hidden]) .cmpbar');
  ok(/Ava and Ben/.test(await p.textContent('#cmpBar')), 'comparison survives a reload');

  // 3. rename without re-reading
  await p.click('#cmpEdit'); await p.waitForSelector('#cmp[open]');
  ok(/Already read/.test(await p.textContent('.cslot:nth-child(1) .cfile')), 'edit shows people as already read');
  await p.fill('.cslot:nth-child(2) input', 'Benji'); await p.click('#cmpGo');
  await p.waitForFunction(() => /Benji/.test(document.getElementById('cmpBar').textContent), null, { timeout: 10000 }).catch(() => {});
  ok(/Ava and Benji/.test(await p.textContent('#cmpBar')), 'rename applied without reading again');

  // 4. a file that is not an export: the dialog comes back with the person named in the error
  await p.click('#cmpEdit'); await p.waitForSelector('#cmp[open]');
  await p.click('#cmpAdd'); await p.fill('.cslot:nth-child(3) input', 'Cy');
  await p.$eval('.cslot:nth-child(3) .cfile', el => el.click()); await p.setInputFiles('#cmpFile', f('not-a-zip.zip'));
  await p.click('#cmpGo');
  await p.waitForSelector('#cmp[open] #cmpErr:not([hidden])', { timeout: 30000 });
  ok(/^Cy: /.test(await p.textContent('#cmpErr')), 'bad file reported against the right person: ' + await p.textContent('#cmpErr'));

  // 5. the same export twice
  await p.$eval('.cslot:nth-child(3) .cfile', el => el.click()); await p.setInputFiles('#cmpFile', f('watch-stream.zip'));
  await p.click('#cmpGo');
  await p.waitForSelector('#cmp[open] #cmpErr:not([hidden])', { timeout: 30000 });
  ok(/look like the same export/.test(await p.textContent('#cmpErr')), 'duplicate export caught: ' + await p.textContent('#cmpErr'));
  ok(await p.$$eval('.cslot', x => x.length) === 3, 'slots are kept after an error');
  // names must differ
  await p.fill('.cslot:nth-child(3) input', 'ava'); await p.$eval('.cslot:nth-child(3) .cx', el => el.click());
  ok(await p.$$eval('.cslot', x => x.length) === 2, 'remove a person');
  await p.fill('.cslot:nth-child(2) input', 'AVA'); await p.click('#cmpGo');
  ok(/different name/.test(await p.textContent('#cmpErr')), 'duplicate names refused');
  await p.click('#cmpClose');

  // 6. end comparison: no own data, so back to the landing page, and nothing kept
  await p.click('#cmpEnd'); await p.waitForSelector('#landing:not([hidden])');
  ok(!(await p.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('health-atlas', 1); q.onsuccess = () => r(q.result); }); return await new Promise(r => { const g = db.transaction('kv').objectStore('kv').get('compare'); g.onsuccess = () => r(g.result); }); })), 'comparison deleted from storage');

  // 7. your own data as one person
  await p.setInputFiles('#file', f('watch.zip')); await p.waitForSelector('#app:not([hidden]) .ch-head', { timeout: 60000 });
  await p.click('#menuBtn'); await p.click('#cmpFromSettings'); await p.waitForSelector('#cmp[open]');
  ok(/Your data in this browser/.test(await p.textContent('.cslot:nth-child(1)')), 'own data offered as the first person');
  await p.$eval('.cslot:nth-child(2) .cfile', el => el.click()); await p.setInputFiles('#cmpFile', f('iphone-only.zip'));
  await p.fill('.cslot:nth-child(2) input', 'Dee'); await p.click('#cmpGo');
  await p.waitForSelector('#app:not([hidden]) .cmpbar', { timeout: 60000 });
  ok(/You and Dee/.test(await p.textContent('#cmpBar')), 'compare with own data');
  await p.click('#cmpEnd'); await p.waitForSelector('#app:not([hidden]) .ch-head');
  ok(await p.isHidden('#cmpBar') && !(await p.$('.cmpbar')), 'ending returns to your own dashboard');

  // 8. sample people: never stored
  await p.goto('http://localhost:8123/?demo=compare'); await p.waitForSelector('#app:not([hidden]) .cmpbar');
  ok(await p.$$eval('.pchip', x => x.length) === 3, 'sample people: three');
  await p.goto('http://localhost:8123/'); await p.waitForSelector('#app:not([hidden]) .ch-head');
  ok(!(await p.$('.cmpbar')), 'sample people never replace stored data');

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
})();
