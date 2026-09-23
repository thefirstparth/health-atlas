// Home page only: 3D card stack, scroll choreography, reveals. No data, no network.
// Every number drawn here is made up (seeded), labelled as an illustration on the page.
const L = document.getElementById('landing');
const NS = 'http://www.w3.org/2000/svg';
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const sv = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
let seed = 11; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const smooth = (a, r) => a.map((_, i) => { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const v = a[i + k]; if (v != null) { const w = r + 1 - Math.abs(k); s += v * w; n += w; } } return s / n; });
const path = pts => pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
const ICON = {
  overview: '<rect x="2" y="2" width="5.5" height="5.5" rx="1.6"/><rect x="8.5" y="2" width="5.5" height="5.5" rx="1.6"/><rect x="2" y="8.5" width="5.5" height="5.5" rx="1.6"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.6"/>',
  heart: '<path d="M8 14s-5.5-3.3-5.5-7.3A3 3 0 0 1 8 5a3 3 0 0 1 5.5 1.7C13.5 10.7 8 14 8 14Z"/>',
  stress: '<path d="M1.5 8h2.5l1.5-4 2.5 8 2-6 1.2 2H14.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  sleep: '<path d="M10.8 11.8A5.2 5.2 0 0 1 6.2 2.2a5.8 5.8 0 1 0 7.6 7.6 5.2 5.2 0 0 1-3 2Z"/>',
  activity: '<path d="M8.6 1.5c.4 2.3 3.9 3.7 3.9 7.4A4.5 4.5 0 0 1 8 13.5a4.5 4.5 0 0 1-4.5-4.6c0-1.8 1-3 2-3.8 0 1.2.6 2.1 1.4 2.4C6.6 5 7.9 3.3 8.6 1.5Z"/>',
  workouts: '<circle cx="9.5" cy="2.8" r="1.6"/><path d="M5 6.3 8 5l2.4 2.4L13 8.2M8 5l-.9 4 2.5 2-.8 3.3M7.1 9 4.8 11.8 2.5 11.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  mobility: '<path d="M2 13.5h3.2v-3.2h3.2V7.1h3.2V3.9H14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  env: '<path d="M5 5.6a3.2 3.2 0 1 1 5.3 2.5c-.9.7-1.3 1.3-1.3 2.3a2 2 0 0 1-3.6 1.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12.7 3.2a6 6 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  body: '<path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 6.5a2.6 2.6 0 0 1 4 0L8.5 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

// ------------------------------------------------------------ 3D card stack
function card(k, x, y, z, r, w, title, color) {
  const c = el('div', 'lpc'); c.style.cssText = `--k:${k};--x:${x}px;--y:${y}px;--z:${z}px;--r:${r}deg;width:${w}px`;
  const h = el('h4'); const i = el('i'); i.style.background = `var(${color})`; h.append(i, document.createTextNode(title)); c.appendChild(h);
  return c;
}
function buildRig(rig) {
  rig.replaceChildren();
  // 1. Sleep, 14 nights of stages against a 7 hr target
  {
    const c = card(0, 150, 200, 80, -1, 330, 'Time asleep · last 14 nights', '--c-sleep');
    c.insertAdjacentHTML('beforeend', '<div class="v">7h 12m<small>avg a night</small></div>');
    const W = 298, H = 132, s = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, c);
    const y = m => H - 16 - m / 540 * (H - 22), bad = 'var(--bad)';
    sv('rect', { x: 0, y: y(360), width: W - 24, height: H - 16 - y(360), fill: bad, 'fill-opacity': .07 }, s);
    for (const [m, t] of [[0, '0'], [240, '4h'], [480, '8h']]) { sv('line', { class: 'gl', x1: 0, x2: W - 24, y1: y(m), y2: y(m) }, s); sv('text', { class: 'ax', x: W - 20, y: y(m) + 3 }, s).textContent = t; }
    const bw = 13, gap = (W - 24) / 14;
    for (let j = 0; j < 14; j++) {
      const tot = 355 + rnd() * 150, parts = [['--st-deep', .15 + rnd() * .05], ['--st-core', .55], ['--st-rem', .22]];
      let acc = 0; const cx = j * gap + gap / 2;
      parts.forEach(([col, f], q) => { const m = tot * f, y0 = y(acc), y1 = y(acc + m); acc += m;
        const r = sv('rect', { class: 'gr', x: cx - bw / 2, y: y1, width: bw, height: Math.max(0, y0 - y1 - (q ? 1 : 0)), rx: q === 2 ? 3.5 : 1.5, fill: `var(${col})` }, s); r.style.setProperty('--j', j); });
    }
    sv('line', { x1: 0, x2: W - 24, y1: y(420), y2: y(420), stroke: 'var(--ink-3)', 'stroke-width': 1.3, 'stroke-dasharray': '4 4' }, s);
    sv('text', { class: 'ax', x: 2, y: y(420) - 5, style: 'font-weight:650' }, s).textContent = 'Target 7h';
    rig.appendChild(c);
  }
  // 2. Resting heart rate: faint days + smooth trend + pill
  {
    const c = card(1, 0, 0, -60, 1.5, 280, 'Resting heart rate', '--c-heart');
    c.insertAdjacentHTML('beforeend', '<div class="v">56<small>bpm, 30-day avg</small></div>');
    const W = 258, H = 92, s = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, c);
    const raw = []; let b = 61; for (let i = 0; i < 60; i++) { b += (57 - b) * .04 + (rnd() - .5) * .6; raw.push(b + (rnd() - .5) * 4); }
    const tr = smooth(raw, 5), x = i => i / 59 * (W - 10) + 5, y = v => 8 + (64 - v) / 12 * (H - 20);
    raw.forEach((v, i) => { const d = sv('circle', { class: 'fd', cx: x(i), cy: y(v), r: 2.2, fill: 'var(--c-heart)', 'fill-opacity': .3 }, s); d.style.setProperty('--j', i); });
    const p = sv('path', { class: 'dr', d: path(tr.map((v, i) => [x(i), y(v)])), fill: 'none', stroke: 'var(--c-heart)', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s);
    p.style.setProperty('--len', 400);
    const lx = x(59), ly = y(tr[59]);
    sv('circle', { class: 'fd', cx: lx, cy: ly, r: 4.5, fill: 'var(--c-heart)', stroke: 'var(--card)', 'stroke-width': 2 }, s).style.setProperty('--j', 70);
    rig.appendChild(c);
  }
  // 3. Activity rings, one week
  {
    const c = card(2, 330, 40, -140, 2, 262, 'Activity rings · this week', '--c-activity');
    const s = sv('svg', { width: 230, height: 44, viewBox: '0 0 230 44' }, c);
    const R = [[14.5, '--ring-move'], [10, '--ring-ex'], [5.5, '--ring-stand']];
    for (let d = 0; d < 7; d++) { const g = sv('g', { transform: `translate(${d * 33 + 17} 22)` }, s);
      R.forEach(([r, col], q) => { const C = 2 * Math.PI * r, f = Math.min(1, .45 + rnd() * .75);
        sv('circle', { r, fill: 'none', stroke: `var(${col})`, 'stroke-opacity': .18, 'stroke-width': 3.8 }, g);
        const a = sv('circle', { class: 'sw', r, fill: 'none', stroke: `var(${col})`, 'stroke-width': 3.8, 'stroke-linecap': 'round', transform: 'rotate(-90)', 'stroke-dasharray': `0 ${C}` }, g);
        a.dataset.to = `${C * f} ${C}`; a.style.transitionDelay = `${1200 + d * 60 + q * 40}ms`; }); }
    c.insertAdjacentHTML('beforeend', '<div class="s">Move closed 5 of 7 days</div>');
    rig.appendChild(c);
  }
  // 4. Steps chain, 8 weeks
  {
    const c = card(3, 396, 400, 150, -2, 236, 'Steps chain · 8 weeks', '--c-workouts');
    c.insertAdjacentHTML('beforeend', '<div class="v">12<small>days in a row</small></div>');
    const s = sv('svg', { width: 204, height: 94, viewBox: '0 0 204 94' }, c);
    for (let col = 0; col < 8; col++) for (let r = 0; r < 7; r++) { const k = col * 7 + r, v = rnd(), hit = k > 43 ? true : v > .28, none = v < .06 && k < 40;
      const q = sv('rect', { class: 'fd', x: col * 26, y: r * 13.4, width: 22, height: 10.5, rx: 3, fill: none ? 'var(--heat-0)' : hit ? 'var(--good)' : 'var(--bad)', 'fill-opacity': none ? 1 : hit ? .88 : .55 }, s); q.style.setProperty('--j', k); }
    rig.appendChild(c);
  }
  // 5. Heart rate range capsules
  {
    const c = card(4, -10, 452, 10, .5, 290, 'Heart rate · low to high', '--c-heart');
    const W = 258, H = 90, s = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, c);
    const y = v => 6 + (170 - v) / 125 * (H - 12);
    for (let i = 0; i < 18; i++) { const lo = 48 + rnd() * 10, hi = 118 + rnd() * 45, cx = i * 14.4 + 6;
      const r = sv('rect', { class: 'gr', x: cx - 4, y: y(hi), width: 8, height: y(lo) - y(hi), rx: 4, fill: 'var(--c-heart)', 'fill-opacity': .55 }, s); r.style.setProperty('--j', i);
      sv('line', { class: 'fd', x1: cx - 5, x2: cx + 5, y1: y(72 + rnd() * 10), y2: y(72 + rnd() * 10), stroke: 'var(--card)', 'stroke-width': 2 }, s).style.setProperty('--j', i); }
    rig.appendChild(c);
  }
  // floating chips
  const chip = (k, x, y, z, cls, html) => { const c = el('div', 'lp-chip ' + cls, html); c.style.cssText = `--k:${k};--x:${x}px;--y:${y}px;--z:${z}px`; rig.appendChild(c); };
  chip(5, 430, 330, 230, 'good', '<svg viewBox="0 0 10 10"><path d="M5 1.5 9 7.5H1Z" fill="currentColor"/></svg>18 min more sleep vs last month');
  chip(6, 20, 250, 200, 'flat', '<span class="dot" style="color:var(--c-sleep)"></span>Midpoint 03:14');
  chip(7, 180, 606, 130, 'bad', '<svg viewBox="0 0 10 10"><path d="M5 8.5 1 2.5h8Z" fill="currentColor"/></svg>2,400 steps short this week');
}

// ------------------------------------------------------------ chapters explode
const CH = [
  ['overview', 'Overview', '--c-overview', 'What needs you now, your chains, every measure at a glance'],
  ['heart', 'Heart', '--c-heart', 'Resting and walking heart rate, daily range, VO₂ max'],
  ['stress', 'Stress & Recovery', '--c-stress', 'Heart rate variability, resting rate, breathing'],
  ['sleep', 'Sleep', '--c-sleep', 'Hours, stages, schedule and midpoint'],
  ['activity', 'Activity', '--c-activity', 'Rings, steps, energy, distance, flights'],
  ['workouts', 'Workouts', '--c-workouts', 'Every session, by sport, with heart rate'],
  ['mobility', 'Mobility', '--c-mobility', 'Walking speed, steadiness, running form'],
  ['env', 'Environment & Hearing', '--c-env', 'Noise, headphone volume, daylight'],
  ['body', 'Body', '--c-body', 'Weight, height and blood pressure'],
];
const lum = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return .5; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0); };
function buildTiles(box) {
  box.querySelectorAll('.lp-tile').forEach(t => t.remove());
  CH.forEach(([id, name, col, desc], k) => {
    const t = el('div', 'lp-tile'); const h = el('div', 'th'); const g = el('span', 'gy');
    const c = css(col); g.style.background = c; g.style.color = lum(c) > .42 ? '#16181D' : '#FFFFFF';
    g.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor">${ICON[id]}</svg>`; h.append(g, el('span', null, name)); t.appendChild(h);
    t.appendChild(el('p', null, desc));
    const s = sv('svg', { class: 'sp', viewBox: '0 0 200 34', preserveAspectRatio: 'none' }, t);
    const raw = []; let b = .5; for (let i = 0; i < 40; i++) { b += (rnd() - .5) * .18; b = Math.max(.1, Math.min(.9, b)); raw.push(b); }
    const tr = smooth(raw, 4), pts = tr.map((v, i) => [i / 39 * 200, 30 - v * 26]);
    sv('path', { d: path(pts) + 'L200,34L0,34Z', fill: `var(${col})`, 'fill-opacity': .1 }, s);
    sv('path', { d: path(pts), fill: 'none', stroke: `var(${col})`, 'stroke-width': 2, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }, s);
    box.appendChild(t);
  });
}
let tileGeo = [];
function measureTiles(box) {
  const b = box.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  tileGeo = [...box.querySelectorAll('.lp-tile')].map(t => { const prev = t.style.transform; t.style.transform = 'none'; const r = t.getBoundingClientRect(); t.style.transform = prev; return { t, dx: cx - (r.left + r.width / 2), dy: cy - (r.top + r.height / 2) }; });
}
const clamp = v => Math.max(0, Math.min(1, v)), ease = t => 1 - Math.pow(1 - t, 3);
function paintTiles(p) {
  const zip = document.getElementById('lpZip');
  const zp = clamp(p / .22);
  if (zip) { zip.style.transform = `translateZ(${zp * 160}px) rotateX(${zp * 35}deg) scale(${1 + zp * .25})`; zip.style.opacity = String(1 - zp); zip.style.visibility = zp >= 1 ? 'hidden' : 'visible'; }
  tileGeo.forEach(({ t, dx, dy }, k) => {
    const e = ease(clamp((p - .08 - k * .045) / .5)), q = 1 - e;
    t.style.transform = `translate3d(${dx * q}px, ${dy * q}px, ${-260 * q + k * 2 * q}px) rotateX(${58 * q}deg) rotateZ(${(k - 4) * 7 * q}deg) scale(${.72 + .28 * e})`;
    t.style.opacity = String(clamp(e * 1.6));
  });
}

// ------------------------------------------------------------ run
function init() {
  const rig = document.getElementById('lpRig'), tiles = document.getElementById('lpTiles'), scene = L.querySelector('.lp-scene'), stage = L.querySelector('.lp-stage');
  buildRig(rig); buildTiles(tiles);
  L.querySelectorAll('.lp-h1 .w > span').forEach((s, i) => s.style.setProperty('--i', i));
  L.querySelectorAll('.lp-hero .rv').forEach((s, i) => s.style.setProperty('--d', `${380 + i * 110}ms`));
  L.querySelectorAll('.lp-steps .rv').forEach((s, i) => s.style.setProperty('--d', `${i * 90}ms`));

  // fit the 600x580 scene into the stage width
  const fit = () => { const w = stage.clientWidth; const s = Math.min(1.12, w / 640); scene.style.setProperty('--lp-s', s.toFixed(3)); stage.style.height = w < 640 ? `${Math.round(680 * s)}px` : ''; measureTiles(tiles); };
  addEventListener('resize', fit);

  const start = () => { L.classList.add('on'); requestAnimationFrame(() => { rig.classList.add('in'); rig.querySelectorAll('.sw').forEach(a => a.setAttribute('stroke-dasharray', a.dataset.to)); }); };
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(start));
  // the landing starts hidden until the app knows there is no stored data; animate when it appears
  let started = false;
  const reveal = () => { fit(); if (started) return; started = true; if (document.fonts && document.fonts.ready) document.fonts.ready.then(ready); else ready(); };
  if (!L.hidden) reveal();
  new MutationObserver(() => { if (!L.hidden) reveal(); }).observe(L, { attributes: true, attributeFilter: ['hidden'] });

  // reveals below the fold
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .2 });
  L.querySelectorAll('.lp-steps .rv, .lp-finalcard').forEach(n => io.observe(n));

  // counters
  L.querySelectorAll('[data-count]').forEach(b => { const to = +b.dataset.count; if (!to || RM) return; b.textContent = '0'; setTimeout(() => { const t0 = performance.now(); const step = t => { const f = Math.min(1, (t - t0) / 900); b.textContent = String(Math.round(ease(f) * to)); if (f < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }, 900); });

  // buttons elsewhere on the page open the same file picker
  L.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => document.getElementById('pick').click()));

  if (RM) { paintTiles(1); return; }

  // pointer tilt for the rig and the drop card, gentle drift when idle
  let tx = 0, ty = 0, cx = 0, cy = 0, last = 0;
  addEventListener('pointermove', e => { if (L.hidden || e.pointerType === 'touch') return; tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; last = performance.now(); }, { passive: true });
  const drop = document.getElementById('drop');
  drop.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; const r = drop.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5; drop.style.transform = `perspective(900px) rotateX(${-py * 4}deg) rotateY(${px * 5}deg)`; });
  drop.addEventListener('pointerleave', () => { drop.style.transform = ''; });

  let explodeTop = 0, explodeH = 1;
  const measure = () => { const s = document.getElementById('chapters'); const r = s.getBoundingClientRect(); explodeTop = r.top + scrollY; explodeH = Math.max(1, s.offsetHeight - innerHeight); };
  measure(); addEventListener('resize', () => { measure(); measureTiles(tiles); });
  let lastP = -1;
  const loop = t => {
    requestAnimationFrame(loop);
    if (L.hidden) return;
    const idle = t - last > 2500, drift = idle ? Math.sin(t / 2600) * .22 : 0, drift2 = idle ? Math.cos(t / 3100) * .14 : 0;
    cx += ((idle ? drift : tx) - cx) * .06; cy += ((idle ? drift2 : ty) - cy) * .06;
    const sc = Math.min(1, scrollY / 700);
    rig.style.transform = `rotateX(${14 - cy * 12 + sc * 10}deg) rotateY(${-20 + cx * 22}deg) rotateZ(2deg) translateZ(${-sc * 120}px)`;
    const p = clamp((scrollY - explodeTop + innerHeight * .15) / explodeH);
    if (Math.abs(p - lastP) > .0005) { lastP = p; paintTiles(p); }
  };
  requestAnimationFrame(loop);
  // the dashboard may reveal the landing later (after "Forget my data")
  new MutationObserver(() => { if (!L.hidden) { measure(); measureTiles(tiles); lastP = -1; } }).observe(L, { attributes: true, attributeFilter: ['hidden'] });
}
if (L) init();
