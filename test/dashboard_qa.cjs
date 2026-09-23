// Visual QA of the dashboard's newer pieces: node test/dashboard_qa.cjs <dataset.json> [outdir]
// Screenshots at 4 widths x 2 themes: overview (records), sleep (tapestry, calendar) in M/Y/All,
// heart vitals, activity calendar, a scrub in progress, the settings and poster dialogs.
const { chromium } = require('playwright'); const fs = require('fs'); const { openWith } = require('./dash_harness.cjs');
const DATA = fs.readFileSync(process.argv[2], 'utf8'), OUT = process.argv[3] || '/tmp/dqa'; fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) for (const theme of ['light', 'dark']) {
    const tag = `${w}-${theme}`, p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w < 500 });
    p.on('pageerror', e => errs.push(`${tag} ${e.message}`)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${tag} ${m.text()}`); });
    await openWith(p, DATA); await p.waitForTimeout(1200);
    const shot = async name => { await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${tag}-${name}.png` }); };
    const card = async (sel, name) => { const c = await p.$(sel); if (!c) return; await c.scrollIntoViewIfNeeded(); await p.waitForTimeout(700); await c.screenshot({ path: `${OUT}/${tag}-${name}.png` }); };
    const ch = async n => { await p.evaluate(() => scrollTo(0, 0)); await p.click(`#nav button[title="${n}"]`); await p.waitForTimeout(1300); };
    const view = async v => { await p.click(`#views button:text-is("${v}")`); await p.waitForTimeout(1300); };
    await shot('a-overview');
    await card('.records', 'b-records');
    await ch('Sleep'); await view('M'); await card('.card:has(h3:text-is("Every night, bed to wake"))', 'c-tap-M');
    await view('Y'); await card('.card:has(h3:text-is("Every night, bed to wake"))', 'd-tap-Y'); await card('.plain:has(h3:has-text("every day"))', 'e-cal-Y');
    await view('All'); await card('.card:has(h3:text-is("Every night, bed to wake"))', 'f-tap-All'); await card('.plain:has(h3:has-text("every day"))', 'g-cal-All');
    await view('Y'); await ch('Heart'); await shot('h-heart-top');
    // scrub the first chart: every other chart in the chapter should follow
    const hit = await p.$('.hit'); if (hit) { const bb = await hit.boundingBox(); if (w < 500) await p.touchscreen.tap(bb.x + bb.width * .55, bb.y + 60); else await p.mouse.move(bb.x + bb.width * .55, bb.y + 60); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${tag}-i-scrub.png`, fullPage: false }); }
    await ch('Activity'); await card('.plain:has(h3:has-text("every day"))', 'j-cal-activity');
    await p.evaluate(() => scrollTo(0, 0)); await p.click('#shareBtn'); await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/${tag}-k-poster.png` }); await p.click('#posterClose');
    await p.click('#menuBtn'); await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${tag}-l-settings.png` }); await p.keyboard.press('Escape');
    await p.close();
  }
  console.log('JS ERRORS', errs.length, errs.slice(0, 8)); await b.close();
})();
