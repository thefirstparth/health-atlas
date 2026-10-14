// Opening a health vault through the real UI: node test/vault_flow.cjs test/fixtures
// Needs tools/serve.mjs on :8123 and the fixtures: python3 test/make_fixtures.py <dir> && node test/make_vault.mjs <dir>
// Covers: the dialog from the home page, a wrong passphrase (the dialog comes back with the files kept), the vault
// laid after its Apple export, the new measures where they belong, the HRV note at the switch, Settings, reload,
// a vault zip picked as if it were an export, people without a vault never seeing its measures, and ?demo=vault.
const { chromium } = require('playwright');
const path = require('path');
const FX = process.argv[2] || 'test/fixtures', f = n => path.resolve(FX, n), PASS = 'correct horse battery staple';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
const ch = async (p, t) => { await p.click(`#nav button[title="${t}"]`); await p.waitForTimeout(300); };
const cardTitles = p => p.$$eval('.stack h3, .stack .band h3, .stack .ttl', x => x.map(e => e.textContent.trim()));
(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }), p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/'); await p.waitForSelector('#landing:not([hidden])');
  await p.evaluate(async () => { await new Promise(r => { const q = indexedDB.deleteDatabase('health-atlas'); q.onsuccess = q.onerror = q.onblocked = r; }); localStorage.clear(); });
  await p.reload(); await p.waitForSelector('#landing:not([hidden])');

  // 1. the dialog, a wrong passphrase
  await p.click('#vaultTry'); await p.waitForSelector('#vault[open]');
  await p.click('#vaultGo');
  ok(/Choose the vault zip/.test(await p.textContent('#vaultErr')), 'asks for files first');
  await p.setInputFiles('#vaultFile', f('vault-repo.zip'));
  ok(/vault-repo\.zip/.test(await p.textContent('#vaultFiles')), 'the chosen zip is named');
  await p.fill('#vaultPass', 'not the passphrase'); await p.click('#vaultGo');
  await p.waitForSelector('#vault[open] #vaultErr:not([hidden])', { timeout: 60000 });
  ok(/does not open this vault/.test(await p.textContent('#vaultErr')), 'wrong passphrase said plainly: ' + await p.textContent('#vaultErr'));
  ok(/vault-repo\.zip/.test(await p.textContent('#vaultFiles')) && await p.inputValue('#vaultPass') === '', 'files kept, passphrase cleared');

  // 2. the right one
  await p.fill('#vaultPass', PASS); await p.click('#vaultGo');
  await p.waitForSelector('#app:not([hidden]) .ch-head', { timeout: 60000 });
  ok(/Opened your health vault: days up to/.test(await p.textContent('.toast')), 'toast: ' + await p.textContent('.toast'));
  ok(!(await p.evaluate(pw => document.body.innerText.includes(pw) || [...document.querySelectorAll('input')].some(i => i.value === pw), PASS)), 'the passphrase is not left on the page');

  // 3. where the new measures appear
  await ch(p, 'Stress & Recovery');
  let t = await cardTitles(p);
  await p.click('#views button:text-is("M")'); await p.waitForTimeout(300);
  let txt = await p.textContent('.stack');
  ok(t.some(x => /^Heart rate variability/.test(x)) && t.some(x => /HRV against your normal/.test(x)), 'Stress: Heart rate variability and HRV against your normal: ' + t.join(' | '));
  ok(!t.some(x => /HRV \(Fitbit\)/.test(x)), 'Stress: no separate Fitbit HRV card');
  ok(t.some(x => /Skin temperature/.test(x)) && t.some(x => /Blood oxygen/.test(x)), 'Stress: skin temperature and blood oxygen');
  ok(!/Not recorded since you switched to Fitbit[^.]*Heart rate variability/.test(txt), 'HRV is not called missing');
  await p.click('#views button:text-is("Y")'); await p.waitForTimeout(300);
  ok(await p.$$eval('.swlab', x => x.some(e => /Fitbit from/.test(e.textContent))), 'the switch is marked on the charts');
  {
    // one HRV card: each device in its own colour, its own legend line, the summary from the current device only
    const card = await p.$('.card:has(h3:text-matches("^Heart rate variability"))');
    const lg = card && await card.$$eval('.legend, .lg, [class*=leg]', x => x.map(e => e.textContent).join(' '));
    ok(card && /Apple Watch \(SDNN\)/.test(lg) && /Fitbit \(RMSSD\)/.test(lg), 'HRV legend names both devices: ' + lg);
    const cols = card && await card.$$eval('svg path, svg polyline, svg circle', x => [...new Set(x.map(e => getComputedStyle(e).stroke).filter(c => c && c !== 'none'))]);
    ok(cols && cols.length >= 2, 'HRV drawn in two colours: ' + (cols || []).join(' '));
  }
  await ch(p, 'Activity');
  {
    // exercise minutes (Apple) and Active Zone Minutes (Fitbit): one card, each device in its own colour
    t = await cardTitles(p);
    ok(t.some(x => /^Exercise minutes/.test(x)) && !t.some(x => /Active Zone Minutes/.test(x)), 'Activity: one Exercise minutes card, no separate Active Zone Minutes card: ' + t.join(' | '));
    const card = await p.$('.card:has(h3:text-is("Exercise minutes"))');
    const lg = card && await card.$eval('.legend', e => e.textContent);
    ok(/Apple Watch \(exercise minutes\)/.test(lg) && /Fitbit \(Active Zone Minutes\)/.test(lg), 'its legend names both devices: ' + lg);
  }
  await p.click('#views button:text-is("M")'); await p.waitForTimeout(300);
  t = await cardTitles(p); txt = await p.textContent('.stack');
  ok(t.some(x => /^Active energy/.test(x)), 'Activity: active energy carries on in the Fitbit month');
  ok(t.some(x => /^Exercise minutes/.test(x)) && !/Not recorded[^.]*Exercise minutes/.test(txt), 'Activity: exercise minutes carry on in the Fitbit month');
  ok(t.some(x => /^Resting energy/.test(x)) && !/Not recorded[^.]*Resting energy/.test(txt), 'Activity: resting energy carries on in the Fitbit month');
  await ch(p, 'Heart');
  t = await cardTitles(p);
  ok(t.some(x => /^Heart rate$/.test(x)) && !/Not recorded[^.]*Heart rate[,.]/.test(await p.textContent('.stack')), 'Heart: the day’s heart-rate range carries on in the Fitbit month: ' + t.join(' | '));
  ok(/No irregular rhythm notifications in this period/.test(await p.textContent('.stack')), 'Heart: a month without AFib notifications says so plainly');
  await p.click('#views button:text-is("Y")'); await p.waitForTimeout(300);
  ok((await cardTitles(p)).some(x => /Irregular rhythm notifications/.test(x)), 'Heart: the year with one shows the AFib notification card');
  await ch(p, 'Environment & Hearing');
  txt = await p.textContent('.stack');
  ok(/Air and weather where you live/.test(txt) && (await cardTitles(p)).some(x => /Air while you slept/.test(x)), 'Environment: air and weather section');
  await p.click('#views button:text-is("All")'); await p.waitForTimeout(300);
  ok(!/Not recorded in this period:[^.]*(Air while you slept|Outdoor)/.test(await p.textContent('.stack')), 'All time: air not listed as missing for the years before the vault');
  await ch(p, 'Sleep'); await ch(p, 'Workouts'); await ch(p, 'Heart'); await ch(p, 'Overview');
  ok(await p.$$eval('.brow .bname span', x => x.some(e => /HRV \(Fitbit\)/.test(e.textContent))), 'Overview board lists the Fitbit HRV');

  ok(/Built from the Apple Health export dated \d{4}-\d{2}-\d{2} and a health vault with days up to/.test(await p.textContent('#genline')), 'footer: ' + await p.textContent('#genline'));
  // 4. settings, reload
  await p.click('#menuBtn'); await p.waitForSelector('#settings[open]');
  const di = await p.textContent('#dataInfo');
  ok(/Health vault opened .*: Fitbit days from .* up to .*on top of the Apple Health export/.test(di) && /Devices: Apple Watch until .*; Fitbit from/.test(di), 'Settings: ' + di);
  await p.click('#setCancel');
  await p.reload(); await p.waitForSelector('#app:not([hidden]) .ch-head');
  await ch(p, 'Stress & Recovery');
  ok((await cardTitles(p)).some(x => /^Heart rate variability/.test(x)), 'kept in this browser after a reload');

  // 5. a vault zip chosen with the main button opens the vault dialog, not the export reader
  await p.click('#menuBtn'); await p.click('#addExport');
  await p.setInputFiles('#file', f('vault-only.zip'));
  await p.waitForSelector('#vault[open]');
  ok(/vault-only\.zip/.test(await p.textContent('#vaultFiles')), 'a vault picked as an export goes to the vault dialog');
  await p.fill('#vaultPass', PASS); await p.click('#vaultGo');
  await p.waitForSelector('#app:not([hidden]) .ch-head', { timeout: 60000 });
  await p.click('#menuBtn'); const di2 = await p.textContent('#dataInfo'); await p.click('#setCancel');
  ok(/Devices: Apple Watch until/.test(di2) && !/on top of the Apple Health export/.test(di2), 'months only: added to what this browser holds, the Apple years kept');

  // 6. someone without a vault never sees its measures
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } }), q = await ctx2.newPage(); q.on('pageerror', e => errs.push(e.message));
  await q.goto('http://localhost:8123/'); await q.waitForSelector('#landing:not([hidden])');
  await q.setInputFiles('#file', f('watch.zip')); await q.waitForSelector('#app:not([hidden]) .ch-head', { timeout: 60000 });
  for (const c of ['Stress & Recovery', 'Activity', 'Environment & Hearing']) {
    await ch(q, c); const all = await q.textContent('.stack');
    ok(!/HRV \(Fitbit\)|HRV against your normal|Skin temperature|Blood oxygen|Active Zone Minutes|Air while you slept|Outdoor/.test(all), `${c}: nothing from a vault, not even as missing`);
  }

  // 7. the sample with a vault
  await q.goto('http://localhost:8123/?demo=vault'); await q.waitForSelector('#app:not([hidden]) .ch-head');
  ok(/keeps a health vault/.test(await q.textContent('#demoBar')), 'demo=vault says what it is');
  await ch(q, 'Stress & Recovery'); ok((await cardTitles(q)).some(x => /HRV against your normal/.test(x)), 'demo=vault shows HRV against your normal');

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
})();
