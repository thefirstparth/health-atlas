// Changing wearable (Apple Watch -> Fitbit through Google Health): node test/device_switch.cjs test/fixtures
// Needs tools/serve.mjs on :8123 and the fixtures (python3 test/make_fixtures.py test/fixtures).
// 1. The parser keeps every night, takes active energy from readings after the switch, leaves Exercise and
//    Stand empty without a Watch, and finds the switch date (a 3-day borrowed Watch is not a switch).
// 2. The dashboard marks the switch, never compares across it, and says what stopped and why.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const FX = process.argv[2] || 'test/fixtures';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-switch-')), 'switch.json');
  execFileSync('node', ['test/run-node.mjs', path.join(FX, 'switch.zip'), out], { stdio: 'ignore' });
  const d = JSON.parse(fs.readFileSync(out, 'utf8')), D = d.daily, W = 200, n = d.meta.days;
  const cnt = (k, a, b) => (D[k] || []).slice(a, b).filter(v => v != null).length;
  // ---- parser
  ok(JSON.stringify(d.meta.devices) === JSON.stringify([{ name: 'Apple Watch', from: '2025-03-01', to: '2025-09-16' }, { name: 'Fitbit', from: '2025-09-17', to: '2025-11-15' }]), 'switch found on Sep 17; borrowed Watch days folded in: ' + JSON.stringify(d.meta.devices));
  ok(cnt('sl_asleep', W, n) === n - W, `every night after the switch kept (${cnt('sl_asleep', W, n)} of ${n - W})`);
  ok(cnt('sl_asleep', 0, W) === W, 'every night before the switch kept');
  ok(D.sl_asleep[5] === 320, `a Watch night stays the Watch's even when a sleep app overlaps (${D.sl_asleep[5]})`);
  ok(D.sl_asleep[17] === 425, `a night the Watch missed is filled by the sleep app (${D.sl_asleep[17]})`);
  ok(d.meta.sleepSource === 'mixed', 'sleep source is mixed');
  ok(cnt('active', W, n) === n - W && D.active[W + 1] > 300 && D.active[W + 1] < 700, `active energy continues after the switch (${D.active[W + 1]} kcal)`);
  ok(cnt('exercise', W, n) === 3 && cnt('stand', W, n) === 3, 'Exercise and Stand only on the 3 borrowed-Watch days');
  ok(cnt('hrv', W, n) === 3, 'HRV only on the borrowed-Watch days (Fitbit does not send it)');
  ok(!('activeRaw' in D), 'raw energy readings are not stored as their own column');
  // ---- dashboard
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/'); await p.waitForSelector('#landing:not([hidden]), #app:not([hidden])');
  await p.evaluate(async d => { const db = await new Promise(r => { const q = indexedDB.open('health-atlas', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => r(q.result); });
    await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.objectStore('kv').put(d, 'data'); t.oncomplete = r; }); localStorage.setItem('ha-state', JSON.stringify({ view: 'Y' })); }, d);
  await p.reload(); await p.waitForSelector('#app:not([hidden]) .ch-head');
  const go = async (ch, v) => { await p.evaluate(() => scrollTo(0, 0)); if (v) await p.click(`#views button:text-is("${v}")`); await p.click(`#nav button[title="${ch}"]`); await p.waitForTimeout(700); };
  await go('Heart', 'Y');
  const rhr = '.band:has(h3:text-is("Resting heart rate"))';
  ok(await p.$eval(rhr, c => [...c.querySelectorAll('.swlab')].map(t => t.textContent).join()) === 'Fitbit from Sep 17', 'resting heart rate chart marks "Fitbit from Sep 17"');
  ok(/Not compared/.test(await p.$eval(rhr, c => c.querySelector('.hero').textContent)), 'year across the switch is not compared with the year before');
  ok(await p.$$eval('.band:has(h3:text-is("Walking speed")) .swlab', x => x.length) === 0, 'iPhone measures carry on without a marker');
  await go('Stress & Recovery', 'M');
  ok(/Not recorded since you switched to Fitbit on Sep 17, 2025: Heart rate variability/.test(await p.textContent('#main')), 'HRV: says it stopped at the switch');
  await go('Activity', 'M');
  ok(/Exercise minutes/.test(await p.textContent('.missing')) && /switched to Fitbit/.test(await p.textContent('.missing')), 'Exercise minutes: says it stopped at the switch');
  ok(!!(await p.$('.band:has(h3:text-is("Active energy"))')), 'active energy still charted after the switch');
  await go('Sleep', 'M'); ok(/Average per night/.test(await p.textContent('#main')) && !(await p.$('.missing:has-text("No sleep")')), 'sleep still charted after the switch');
  await p.click('#menuBtn'); const info = await p.textContent('#dataInfo'); await p.keyboard.press('Escape');
  ok(/Devices: Apple Watch until .*Fitbit from/.test(info), 'Settings lists the devices: ' + info.split('Devices:')[1]);
  // the sample person who switched
  await p.goto('http://localhost:8123/?demo=switch'); await p.waitForSelector('#app:not([hidden]) .ch-head');
  ok(/moved from an Apple Watch to a Fitbit/.test(await p.textContent('#demoBar')), 'switch demo opens');
  await go('Heart', 'Y'); ok(await p.$$eval('.swlab', x => x.length) > 0, 'switch demo marks the switch');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
})();
