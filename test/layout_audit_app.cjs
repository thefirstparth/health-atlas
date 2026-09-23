// Layout audit for the web app: node test/layout_audit_app.cjs <dataset.json> [metric|imperial]
// Needs tools/serve.mjs on :8123. Seeds IndexedDB with the dataset, then walks every view, year and chapter
// at four widths/themes, plus the landing page and settings sheet. Must report 0 issues before deploying.
const { chromium } = require('playwright');
const fs = require('fs');
const DATA = fs.readFileSync(process.argv[2], 'utf8'), UNITS = process.argv[3] || 'metric';
const AUDIT = () => {
  const issues = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
  // 1. clipped / overflowing text in HTML
  const sel = '.pn span, .ofm span, .oft, .ofb, .otn b, .oth, .otr, .wt, .wc, .ovh h2, .ovsec h2, .vt .vn, .vt .vv, .rec .rt span, .rec .rv2, .rec .rs, .demobar span, nav.chapters .ns, .rows .l, .rows .v, .rows .d, .chip, .hero .val, .hero .lab, .tag, .bname span, .bname small, .bval, .bvs .cap, .legend span, .plain h3, .rail h3, .plabel, .brand b, .delta .cap, .meta, .ctx span, .ctx b, .years button, .seg button, nav.chapters button span, .hbars .m, .hbars .nm span, .ringstats .v, .pbar div, th, td';
  document.querySelectorAll(sel).forEach(e => {
    const r = e.getBoundingClientRect(); if (!r.width) return;
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && !e.closest('.tbl-wrap')) issues.push(`clipped: "${e.textContent.trim().slice(0,40)}" (${e.className}) ${e.scrollWidth}>${e.clientWidth}`);
    // escapes its card
    const card = e.closest('.card, .ch-head, .bar-in');
    if (card && !e.closest('.tbl-wrap')) { const c = card.getBoundingClientRect(); if (r.right > c.right + 1 || r.left < c.left - 1) issues.push(`escapes container: "${e.textContent.trim().slice(0,40)}" (${e.className})`); }
  });
  // 2. chips must hug their content
  document.querySelectorAll('.chip').forEach(c => { const r = c.getBoundingClientRect(); let w = 0; c.childNodes.forEach(n => { const rg = document.createRange(); rg.selectNodeContents(n); w += rg.getBoundingClientRect().width; }); if (r.width > w + 30) issues.push(`chip stretched: "${c.textContent}" ${Math.round(r.width)} vs ${Math.round(w)}`); });
  // 3. multi-line where it must be single line
  // wrapped = taller than the same element forced onto one line
  const wraps = e => { const h = e.getBoundingClientRect().height; const old = e.style.whiteSpace; e.style.whiteSpace = 'nowrap'; const h1 = e.getBoundingClientRect().height; e.style.whiteSpace = old; return h > h1 + 2; };
  const lineCount = e => { const old = e.style.whiteSpace; e.style.whiteSpace = 'nowrap'; const h1 = e.getBoundingClientRect().height; e.style.whiteSpace = old; return Math.round(e.getBoundingClientRect().height / Math.max(h1, 1)); };
  document.querySelectorAll('.vt .vv, .rec .rv2, nav.chapters .ns, .chip, .hero .val, .tag, .rows .v, .rows .d, .legend span, .bval, .plabel, .delta .cap, .bvs .cap, .years button, .seg button, .hero .lab').forEach(e => { if (e.getBoundingClientRect().width && wraps(e)) issues.push(`wrapped: "${e.textContent.trim().slice(0,40)}" (${e.className})`); });
  document.querySelectorAll('.rows .l, .rail h3, .win .ws, .chain .cb, .debt .sub, .act span').forEach(e => { if (lineCount(e) > 3 || (e.matches('.rows .l, .rail h3') && lineCount(e) > 2)) issues.push(`3+ lines: "${e.textContent.trim().slice(0,40)}" (${e.className})`); });
  // 3b. inside comparison rows: cells in one row must not touch, and dividers must line up
  document.querySelectorAll('.rows').forEach(g => { const cells = [...g.children]; for (let i = 0; i + 2 < cells.length; i += 3) { const [a, b, c] = cells.slice(i, i + 3).map(e => e.getBoundingClientRect());
    const vText = cells[i+1], xCell = cells[i+2]; const rg = document.createRange(); rg.selectNodeContents(vText); const vr = rg.getBoundingClientRect(); const xc = xCell.firstElementChild ? xCell.firstElementChild.getBoundingClientRect() : null;
    if (xc && xc.width && vr.right > xc.left - 6) issues.push(`row cells crowd: "${vText.textContent}" vs "${xCell.textContent}"`);
    if (Math.abs(a.top - b.top) > 1 || Math.abs(b.top - c.top) > 1) issues.push(`row divider misaligned: "${cells[i].textContent}"`); } });
  // 3c. row dividers must be continuous (no gaps between cells)
  document.querySelectorAll('.rows').forEach(g => { const c = [...g.children]; if (c.length >= 3) { const a = c[0].getBoundingClientRect(), b = c[1].getBoundingClientRect(); if (b.left - a.right > 1) issues.push('row divider has gaps'); } });
  // 4. SVG text: overlaps and out of bounds
  document.querySelectorAll('.chart svg, .brow svg, .wsvg').forEach(svg => {
    const sr = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll('text')].map(t => ({ t, r: t.getBoundingClientRect() })).filter(o => o.r.width > 0);
    texts.forEach(o => { if (!svg.closest('.chart')?.style.overflowX && (o.r.right > sr.right + 2 || o.r.left < sr.left - 2)) issues.push(`svg text outside chart: "${o.t.textContent}"`); });
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].r, b = texts[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 2) issues.push(`svg text overlap: "${texts[i].t.textContent}" × "${texts[j].t.textContent}"`);
    }
  });
  return issues;
};
const SHELL = () => {
  const issues = [], vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
  document.querySelectorAll('h1, h2, .lede, .lp-lede, .lp-tile .th span, .lp-steps b, .lp-checks li, .lp-nav a, .facts b, .facts span, .steps li, .primary, .ghost, .danger, .hint, .fields label, .brandmark b, .pstat, .pfile, .lnk').forEach(e => {
    const r = e.getBoundingClientRect(); if (!r.width) return;
    if (r.right > vw + 1 || r.left < -1) issues.push(`outside viewport: "${e.textContent.trim().slice(0, 40)}"`);
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && !e.matches('.pfile')) issues.push(`clipped: "${e.textContent.trim().slice(0, 40)}"`);
  });
  document.querySelectorAll('.primary, .ghost, .danger, .lp-mini, .lp-light, .lp-eyebrow, .lp-chip, .lp-proof b, .lp-droptext b').forEach(e => { if (!e.getBoundingClientRect().width) return; const h = e.getBoundingClientRect().height, old = e.style.whiteSpace; e.style.whiteSpace = 'nowrap'; const h1 = e.getBoundingClientRect().height; e.style.whiteSpace = old; if (h > h1 + 2) issues.push(`wraps: "${e.textContent.trim()}"`); });
  return issues;
};
(async () => {
  const b = await chromium.launch();
  const errs = [], all = {};
  const add = (tag, iss) => iss.forEach(s => { const key = s.replace(/\d+(\.\d+)?/g, '#'); (all[key] = all[key] || []).push(`${tag}: ${s}`); });
  const chs = ['overview','heart','stress','sleep','activity','workouts','mobility','env','body'];
  for (const [w, theme] of [[1440,'light'],[1180,'dark'],[900,'light'],[390,'dark']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(`${w} PAGEERR ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('CONSOLE ' + m.text()); });
    await pg.goto('http://localhost:8123/'); await pg.waitForSelector('#landing:not([hidden])'); await pg.waitForTimeout(300);
    add(`${w}/${theme}/landing`, await pg.evaluate(SHELL));
    await pg.evaluate(async ([d, u]) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('health-atlas', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(JSON.parse(d), 'data'); t.objectStore('kv').put({ units: u, targets: { sleep: 420, sleepFloor: 360, steps: 8000, exercise: 30, daylight: 30 } }, 'settings'); t.oncomplete = res; });
    }, [DATA, UNITS]);
    await pg.reload(); await pg.waitForSelector('#app:not([hidden]) .ch-head'); await pg.waitForTimeout(400);
    const combos = [];
    for (const v of ['W','M','6M','Y','All']) combos.push([v, null]);
    const years = await pg.$$eval('#years button', bs => bs.map(x => x.firstChild.textContent));
    await pg.click('#views button:text-is("Y")');
    for (const y of (await pg.$$eval('#years button', bs => bs.map(x => x.firstChild.textContent))).slice(0, -1).reverse().slice(0, 3)) combos.push(['Y', y]);
    for (const [v, y] of combos) {
      await pg.click(`#views button:text-is("${v}")`);
      if (y) await pg.click(`#years button:has-text("${y}")`);
      for (let k = 0; k < chs.length; k++) {
        await pg.click(`#nav button:nth-child(${k+1})`); await pg.waitForTimeout(260);
        add(`${w}/${theme}/${v}${y||''}/${chs[k]}`, await pg.evaluate(AUDIT));
      }
    }
    await pg.click('#menuBtn'); await pg.waitForTimeout(250);
    add(`${w}/${theme}/settings`, await pg.evaluate(SHELL));
    await pg.screenshot({ path: `/tmp/audit-settings-${w}.png` });
    await ctx.close();
  }
  console.log('JS ERRORS', errs.length, errs.slice(0,5));
  const keys = Object.keys(all);
  console.log('ISSUE TYPES', keys.length, 'TOTAL', keys.reduce((s,k)=>s+all[k].length,0));
  keys.sort((a,b)=>all[b].length-all[a].length).slice(0,40).forEach(k => console.log(all[k].length+'x', all[k][0]));
  await b.close();
})();
