// Home page QA: node test/homepage_qa.cjs [outdir]   (server from tools/serve.mjs on :8123)
// 1. Automated checks at 4 widths x 2 themes: sideways scroll, clipped/wrapped text, text escaping its
//    card or the viewport, SVG text overlapping other SVG text or crossing a drawn box edge, 3D card
//    titles and chips hidden behind other cards, final positions of the chapter tiles.
// 2. Section screenshots (settled, and mid-animation) for a human look.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2] || '/tmp/hpqa'; fs.mkdirSync(OUT, { recursive: true });
const CHECK = () => {
  const out = [], vw = document.documentElement.clientWidth, L = document.getElementById('landing');
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
  if (document.documentElement.scrollWidth > vw + 1) out.push(`sideways scroll ${document.documentElement.scrollWidth}>${vw}`);
  // HTML text: clipped, outside viewport, escaping its card
  L.querySelectorAll('h1,h2,p,b,span,a,button,li > div,.lp-eyebrow').forEach(e => {
    if (!vis(e) || e.closest('.lp-rig') || e.closest('svg')) return;
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) out.push(`outside viewport: "${e.textContent.trim().slice(0, 40)}"`);
    const cs = getComputedStyle(e);
    if (cs.overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1) out.push(`clipped: "${e.textContent.trim().slice(0, 40)}"`);
    const card = e.parentElement && e.parentElement.closest('.lp-drop,.lp-tile,.lp-steps li,.lp-finalcard,.lp-zip,.lp-pscene');
    if (card) { const c = card.getBoundingClientRect(); if (r.right > c.right + 1 || r.left < c.left - 1 || r.bottom > c.bottom + 1) out.push(`escapes card: "${e.textContent.trim().slice(0, 40)}"`); }
  });
  // single-line elements must not wrap
  L.querySelectorAll('.lp-eyebrow,.lp-mini,.lp-btn span,.lp-light,.lp-chip,.lp-proof b,.lp-nav a,.lpc h4,.lpc .v,.lp-droptext b,.lp-kicker').forEach(e => {
    if (!vis(e)) return; const h = e.getBoundingClientRect().height, o = e.style.whiteSpace; e.style.whiteSpace = 'nowrap'; const h1 = e.getBoundingClientRect().height; e.style.whiteSpace = o;
    if (h > h1 + 2) out.push(`wraps: "${e.textContent.trim().slice(0, 40)}"`);
  });
  // SVG text: overlaps, and crossing the edge of a drawn box (.dev / .pcard / .addr)
  L.querySelectorAll('svg').forEach(svg => {
    if (!vis(svg)) return;
    const T = [...svg.querySelectorAll('text')].filter(vis).map(t => ({ t, r: t.getBoundingClientRect() }));
    const sr = svg.getBoundingClientRect();
    T.forEach(a => { if (a.r.left < sr.left - 2 || a.r.right > sr.right + 2) out.push(`svg text outside svg: "${a.t.textContent}"`); });
    for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) { const a = T[i].r, b = T[j].r; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) out.push(`svg text overlap: "${T[i].t.textContent}" x "${T[j].t.textContent}"`); }
    svg.querySelectorAll('.dev,.pcard,.addr').forEach(box => { const b = box.getBoundingClientRect(); T.forEach(({ t, r }) => {
      const inside = r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;
      const outside = r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom;
      if (!inside && !outside) out.push(`svg text crosses box edge: "${t.textContent}"`); }); });
  });
  // 3D stack: every card title, headline value and chip must be the top-most thing at its centre
  L.querySelectorAll('.lpc h4, .lpc .v, .lp-chip').forEach(e => {
    const r = e.getBoundingClientRect(); if (!r.width || r.top < 0 || r.bottom > innerHeight) return;
    for (const [fx, fy] of [[.15, .5], [.5, .5], [.85, .5]]) {
      const top = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      const own = e.closest('.lpc, .lp-chip');
      if (top && !own.contains(top) && !(top.closest && top.closest('.lp-chip, .lpc') === own)) { out.push(`hidden behind another card: "${e.textContent.trim().slice(0, 30)}"`); break; }
    }
  });
  return out;
};
const TILES_DONE = () => { const t = [...document.querySelectorAll('.lp-tile')]; return t.every(x => +getComputedStyle(x).opacity > .98) ? 'ok' : 'tiles not settled'; };
(async () => {
  const b = await chromium.launch(); const all = {}; const errs = [];
  for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) for (const theme of ['light', 'dark']) {
    const tag = `${w}-${theme}`;
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
    p.on('pageerror', e => errs.push(`${tag} ${e.message}`)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${tag} ${m.text()}`); });
    await p.goto('http://localhost:8123/'); await p.waitForSelector('#landing:not([hidden])');
    await p.waitForTimeout(450); await p.screenshot({ path: `${OUT}/${tag}-a-hero-mid.png` });
    await p.waitForTimeout(3400);
    const add = (where, list) => list.forEach(s => (all[s.replace(/\d+/g, '#')] = all[s.replace(/\d+/g, '#')] || []).push(`${tag}/${where}: ${s}`));
    add('hero', await p.evaluate(CHECK)); await p.screenshot({ path: `${OUT}/${tag}-b-hero.png` });
    const sec = async (sel, name, frac = 0) => { await p.evaluate(([s, f]) => { const e = document.querySelector(s); const top = e.getBoundingClientRect().top + scrollY; scrollTo(0, top + (e.offsetHeight - innerHeight) * f); }, [sel, frac]); await p.waitForTimeout(1100); add(name, await p.evaluate(CHECK)); await p.screenshot({ path: `${OUT}/${tag}-${name}.png` }); };
    await sec('#chapters', 'c-chapters-start', 0.02);
    await sec('#chapters', 'd-chapters-mid', 0.32);
    await sec('#chapters', 'e-chapters-end', 0.98);
    const td = await p.evaluate(TILES_DONE); if (td !== 'ok') add('chapters', [td]);
    await sec('#private', 'f-private', 0);
    await p.evaluate(() => { const e = document.querySelector('#private'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 20); }); await p.waitForTimeout(700);
    await p.locator('.lp-pscene').screenshot({ path: `${OUT}/${tag}-g-privacy-scene.png` });
    await sec('#how', 'h-how', 0);
    await sec('.lp-final', 'i-final', 0);
    await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(700); add('bottom', await p.evaluate(CHECK)); await p.screenshot({ path: `${OUT}/${tag}-j-bottom.png` });
    await p.close();
  }
  console.log('JS ERRORS', errs.length, errs.slice(0, 5));
  const k = Object.keys(all); console.log('ISSUE TYPES', k.length, 'TOTAL', k.reduce((s, x) => s + all[x].length, 0));
  k.sort((a, c) => all[c].length - all[a].length).forEach(x => console.log(all[x].length + 'x', all[x][0]));
  await b.close();
})();
