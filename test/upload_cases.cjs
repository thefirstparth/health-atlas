// Upload each fixture through the real UI and report what the user sees. node test/upload_cases.cjs
const { chromium } = require('playwright');
const F = 'test/fixtures/';
const cases = ['watch.zip', 'watch-stream.zip', 'watch.xml', 'iphone-only.zip', 'iphone-imperial.zip', 'one-day.zip', 'entity-bomb.zip', 'not-health.zip', 'not-a-zip.zip'];
(async () => {
  const b = await chromium.launch();
  for (const c of cases) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto('http://localhost:8123/'); await pg.waitForSelector('#landing:not([hidden])');
    await pg.setInputFiles('#file', F + c);
    await pg.waitForFunction(() => !document.getElementById('app').hidden || !document.getElementById('err').hidden, null, { timeout: 60000 });
    await pg.waitForTimeout(700);
    const res = await pg.evaluate(() => document.getElementById('app').hidden ? 'ERROR SHOWN: ' + document.getElementById('err').textContent : 'dashboard: ' + document.getElementById('brandSub').textContent + ' | ' + document.querySelector('#main .ch-head h1').textContent);
    console.log(c.padEnd(22), res, errs.length ? 'JS ERRORS ' + errs : '');
    await pg.screenshot({ path: `/tmp/case-${c}.png`, fullPage: false });
    await ctx.close();
  }
  await b.close();
})();
