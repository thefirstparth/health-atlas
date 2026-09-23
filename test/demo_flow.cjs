// Sample-data demo: node test/demo_flow.cjs   (never stored, never mixed with real data)
const { chromium } = require('playwright'); const fs = require('fs'); const { openWith } = require('./dash_harness.cjs');
(async () => {
  const b = await chromium.launch(); const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8123/'); await p.waitForSelector('#landing:not([hidden])');
  await p.click('#demoTry'); await p.waitForSelector('#app:not([hidden]) .ch-head');
  ok(await p.isVisible('#demoBar'), 'demo banner shown'); ok(p.url().includes('?demo'), 'URL is shareable (?demo)');
  const keys = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('health-atlas', 1); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); }; }));
  ok(!keys.includes('data'), 'nothing stored in IndexedDB');
  await p.click('#menuBtn'); ok(await p.isHidden('#addExport'), 'data actions hidden in demo'); await p.keyboard.press('Escape');
  await p.click('#shareBtn'); await p.waitForTimeout(1200); ok(await p.evaluate(() => document.getElementById('posterImg').naturalWidth === 1080), 'poster works on sample data'); await p.click('#posterClose');
  await p.reload(); await p.waitForSelector('#app:not([hidden]) .ch-head'); ok(await p.isVisible('#demoBar'), 'reload keeps the demo');
  await p.click('#demoExit'); await p.waitForTimeout(300);
  // real data present: demo must never replace it
  const p2 = await b.newPage(); await openWith(p2, fs.readFileSync('/home/claude/work/ref/js11.json', 'utf8'));
  await p2.goto('http://localhost:8123/?demo'); await p2.waitForSelector('#app:not([hidden]) .ch-head'); ok(await p2.isVisible('#demoBar'), 'demo opens even with real data stored');
  await p2.click('#demoExit'); await p2.waitForTimeout(500); ok(await p2.isHidden('#demoBar') && (await p2.textContent('#brandSub')).includes('2022'), 'leaving the demo returns to your own data');
  const embed = await b.newPage(); await embed.goto('http://localhost:8123/?demo&embed'); await embed.waitForSelector('#app:not([hidden]) .ch-head');
  ok(await embed.isHidden('#menuBtn') && await embed.isHidden('#demoBar'), 'embed hides chrome');
  console.log('JS errors:', errs.length ? errs : 'none'); await b.close();
})();
