// End-to-end: node test/e2e.cjs <export.zip>  (server from tools/serve.mjs on :8123)
const { chromium } = require('playwright');
const fs = require('fs');
const ZIP = process.argv[2], OUT = process.argv[3] || '/tmp/e2e';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const problems = [], requests = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('request', r => requests.push(r.url()));
  await page.goto('http://localhost:8123/');
  await page.waitForSelector('#landing:not([hidden])');
  await page.screenshot({ path: OUT + '/1-landing.png', fullPage: true });
  const nBefore = requests.length;
  // go "offline" before choosing the file: proves nothing needs the network from here on
  await ctx.setOffline(true);
  const t0 = Date.now();
  await page.setInputFiles('#file', ZIP);
  await page.waitForSelector('#processing:not([hidden])');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/2-processing.png' });
  await page.waitForSelector('#app:not([hidden]) .ch-head', { timeout: 180000 });
  console.log('parse+render seconds', ((Date.now() - t0) / 1000).toFixed(1));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/3-overview.png', fullPage: false });
  console.log('requests after going offline:', requests.slice(nBefore).filter(u => !u.startsWith('blob:') && !u.startsWith('data:')));
  await ctx.setOffline(false);
  // chapters render without errors
  for (const ch of ['heart', 'stress', 'sleep', 'activity', 'workouts', 'mobility', 'env', 'body']) {
    await page.evaluate(id => { location.hash = id; }, ch);
    await page.click(`#nav button:has-text("${{ heart: 'Heart', stress: 'Stress', sleep: 'Sleep', activity: 'Activity', workouts: 'Workouts', mobility: 'Mobility', env: 'Environment', body: 'Body' }[ch]}")`);
    await page.waitForTimeout(250);
  }
  // settings: imperial + a new steps target
  await page.click('#menuBtn');
  await page.screenshot({ path: OUT + '/4-settings.png' });
  await page.click('#unitSeg button[data-u="imperial"]');
  await page.fill('input[name="steps"]', '10000');
  await page.click('#setSave');
  await page.waitForTimeout(600);
  await page.click('#nav button:has-text("Overview")');
  await page.waitForTimeout(600);
  const txt = await page.evaluate(() => document.getElementById('main').innerText);
  console.log('imperial shows mi:', /[0-9]\s*mi\b/.test(txt), '| 10,000 target shown:', txt.includes('10,000'));
  await page.click('#nav button:has-text("Activity")'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/5-activity-imperial.png' });
  // persistence
  await page.reload();
  await page.waitForSelector('#app:not([hidden]) .ch-head');
  console.log('restored after reload:', true);
  // forget
  await page.click('#menuBtn'); await page.click('#forget'); await page.click('#forget');
  await page.waitForSelector('#landing:not([hidden])');
  await page.reload(); await page.waitForTimeout(500);
  console.log('landing after forget+reload:', await page.isVisible('#landing'));
  console.log('problems:', problems.length ? problems : 'none');
  await browser.close();
})();
