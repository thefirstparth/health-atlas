// Home page only: 3D card stack, scroll choreography, reveals. No data, no network.
// Every number drawn here is made up (seeded), labelled as an illustration on the page.
import { sampleData } from './sample.js';
import { iconSvg } from './icons.js';
const L = document.getElementById('landing');
const NS = 'http://www.w3.org/2000/svg';
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const sv = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
let seed = 11; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const smooth = (a, r) => a.map((_, i) => { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const v = a[i + k]; if (v != null) { const w = r + 1 - Math.abs(k); s += v * w; n += w; } } return s / n; });
const path = pts => pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
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
  // 4. Targets, last 8 weeks: one strip per target, misses in grey (as on the Overview)
  {
    const c = card(3, 396, 400, 150, -2, 236, 'Targets · last 8 weeks', '--c-workouts');
    const s = sv('svg', { width: 204, height: 96, viewBox: '0 0 204 96' }, c);
    [['Sleep', .62], ['Steps', .7], ['Daylight', .82]].forEach(([name, p], r) => {
      const y0 = r * 32;
      sv('text', { class: 'lb', x: 0, y: y0 + 9 }, s).textContent = name;
      const n = 56, cw = 2.4, gap = (204 - n * cw) / (n - 1);
      for (let k = 0; k < n; k++) { const hit = k > 49 ? true : rnd() < p, h = hit ? 14 : 8;
        const q = sv('rect', { class: 'fd', x: k * (cw + gap), y: y0 + 13 + (14 - h) / 2, width: cw, height: h, rx: 1, fill: hit ? 'var(--good)' : 'var(--ink-3)', 'fill-opacity': hit ? .9 : .35 }, s); q.style.setProperty('--j', r * 20 + k * .6); }
    });
    rig.appendChild(c);
  }
  // 5. The last 7 days against your usual: band = usual, hollow = week before, dot = this week
  {
    const c = card(4, -10, 452, 10, .5, 290, 'Last 7 days vs your usual', '--c-overview');
    const W = 258, H = 90, s = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, c);
    const x0 = 170;
    sv('line', { x1: x0, x2: x0, y1: 0, y2: H, stroke: 'var(--ink-3)', 'stroke-opacity': .5, 'stroke-dasharray': '2 3' }, s);
    [['Sleep', '--c-sleep', -34, 20, 14], ['Steps', '--c-activity', 30, -12, 18], ['Resting HR', '--c-heart', -22, 4, 12]].forEach(([name, col, cur, prev, bw], r) => {
      const y = 15 + r * 30;
      sv('text', { class: 'lb', x: 0, y: y + 4 }, s).textContent = name;
      sv('line', { x1: x0 - 62, x2: x0 + 62, y1: y, y2: y, stroke: 'var(--ink-3)', 'stroke-opacity': .45, 'stroke-width': 1.3, 'stroke-linecap': 'round' }, s);
      sv('rect', { class: 'fd', x: x0 - bw, y: y - 5, width: bw * 2, height: 10, rx: 5, fill: `var(${col})`, 'fill-opacity': .22 }, s).style.setProperty('--j', r * 6);
      sv('line', { class: 'fd', x1: x0 + prev, x2: x0 + cur, y1: y, y2: y, stroke: `var(${col})`, 'stroke-width': 2, 'stroke-opacity': .55 }, s).style.setProperty('--j', r * 6 + 10);
      sv('circle', { class: 'fd', cx: x0 + prev, cy: y, r: 3.4, fill: 'var(--card)', stroke: `var(${col})`, 'stroke-width': 1.5 }, s).style.setProperty('--j', r * 6 + 10);
      sv('circle', { class: 'fd', cx: x0 + cur, cy: y, r: 5.5, fill: `var(${col})`, stroke: 'var(--card)', 'stroke-width': 2 }, s).style.setProperty('--j', r * 6 + 16);
    });
    rig.appendChild(c);
  }
  // floating chips
  const chip = (k, x, y, z, cls, html) => { const c = el('div', 'lp-chip ' + cls, html); c.style.cssText = `--k:${k};--x:${x}px;--y:${y}px;--z:${z}px`; rig.appendChild(c); };
  chip(5, 430, 330, 230, 'good', '<svg viewBox="0 0 10 10"><path d="M5 1.5 9 7.5H1Z" fill="currentColor"/></svg>18 min more sleep vs last month');
  chip(6, 70, 250, 200, 'flat', '<span class="dot" style="color:var(--c-sleep)"></span>Midpoint 03:14');
  chip(7, 180, 606, 130, 'good', '<svg viewBox="0 0 10 10"><path d="M5 8.5 1 2.5h8Z" fill="currentColor"/></svg>Lowest resting HR week since January');
}

// ------------------------------------------------------------ chapters explode
const CH = [
  ['overview', 'Overview', '--c-overview', 'Your week against your usual, what stands out, targets, records'],
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
    g.style.setProperty('--gc', `var(${col})`); g.innerHTML = iconSvg(id); h.append(g, el('span', null, name)); t.appendChild(h);
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
    t.classList.toggle('landed', e > .97);
  });
}

// ------------------------------------------------------------ zoom story: one night to four years
const KEYS = [[0, 0], [.16, 0], [.3, Math.log(7)], [.44, Math.log(7)], [.6, Math.log(365)], [.74, Math.log(365)], [.9, Math.log(1461)], [1, Math.log(1461)]];
const smoothstep = t => t * t * (3 - 2 * t);
function logSpan(p) { for (let k = 1; k < KEYS.length; k++) { const [p0, v0] = KEYS[k - 1], [p1, v1] = KEYS[k]; if (p <= p1) return v0 + (v1 - v0) * smoothstep((p - p0) / Math.max(1e-6, p1 - p0)); } return KEYS[KEYS.length - 1][1]; }
const stageOf = p => p < .23 ? 0 : p < .52 ? 1 : p < .82 ? 2 : 3;
function makeZoom(canvas, D) {
  const A = D.daily.sl_asleep, DE = D.daily.sl_deep, RE = D.daily.sl_rem, N = A.length, LASTI = N - 1, T0 = Date.parse(D.meta.start + 'T00:00:00Z');
  const pre = new Float64Array(N + 1), cnt = new Int32Array(N + 1); for (let i = 0; i < N; i++) { pre[i + 1] = pre[i] + (A[i] ?? 0); cnt[i + 1] = cnt[i] + (A[i] == null ? 0 : 1); }
  const avg = (a, b) => { a = Math.max(0, a); b = Math.min(LASTI, b); const n = cnt[b + 1] - cnt[a]; return n ? (pre[b + 1] - pre[a]) / n : null; };
  const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], WDS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dt = i => new Date(T0 + i * 864e5), dur = m => `${Math.floor(Math.round(m) / 60)}h ${String(Math.round(m) % 60).padStart(2, '0')}m`;
  const rangeEl = document.getElementById('lpZRange'), legSt = [...document.querySelectorAll('.lp-zleg.st')], legN = document.querySelector('.lp-zleg.nn'), legT = document.querySelector('.lp-zleg.tt');
  return function draw(p) {
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    const dpr = Math.min(2, devicePixelRatio || 1), W = canvas.clientWidth, H = canvas.clientHeight; if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const sans = v('--sans') || 'system-ui', ink = v('--ink'), ink2 = v('--ink-2'), ink3 = v('--ink-3'), grid = v('--grid'), card = v('--card');
    const span = Math.exp(logSpan(p)), mr = 46, pw = W - mr, top = 18, bot = 26, ph = H - top - bot, s0 = LASTI - span + 1;
    const zy = Math.max(0, Math.min(1, (Math.log(span) - Math.log(30)) / (Math.log(300) - Math.log(30)))), lo = 270 * smoothstep(zy), hi = 600 - 90 * smoothstep(zy);
    const x = i => (i - s0 + .5) / span * pw, y = m => top + ph - (m - lo) / (hi - lo) * ph;
    g.font = `500 11px ${sans}`; g.textBaseline = 'middle';
    for (const m of (zy > .5 ? [300, 360, 420, 480] : [0, 240, 480])) { g.strokeStyle = grid; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(y(m)) + .5); g.lineTo(pw, Math.round(y(m)) + .5); g.stroke(); g.fillStyle = ink3; g.textAlign = 'left'; g.fillText(m ? `${m / 60}h` : '0', pw + 10, y(m)); }
    const baseY = y(lo);
    // nights
    const bw = Math.max(1, Math.min(150, pw * .32, pw / span * .62)), barA = span < 30 ? 1 : Math.max(0, 1 - (Math.log(span) - Math.log(30)) / (Math.log(160) - Math.log(30))), dotA = Math.max(0, Math.min(.42, (Math.log(span) - Math.log(50)) / (Math.log(200) - Math.log(50)) * .42));
    const cols = [v('--st-deep'), v('--st-core'), v('--st-rem')];
    g.save(); g.beginPath(); g.rect(0, 0, pw, H); g.clip();
    for (let i = Math.max(0, Math.floor(s0) - 1); i <= LASTI; i++) {
      const a = A[i]; if (a == null) continue; const cx = x(i); if (cx < -bw || cx > pw + bw) continue;
      if (dotA > 0) { g.globalAlpha = dotA; g.fillStyle = v('--c-sleep'); g.beginPath(); g.arc(cx, y(a), span > 700 ? 1.4 : 1.9, 0, Math.PI * 2); g.fill(); }
      if (barA <= 0) continue;
      const parts = [DE[i] || 0, a - (DE[i] || 0) - (RE[i] || 0), RE[i] || 0]; let acc = 0; g.globalAlpha = barA;
      parts.forEach((m, k) => { const y0 = Math.min(baseY, y(acc)), y1 = y(acc + m); acc += m; if (y1 >= baseY) return; g.fillStyle = cols[k]; const r = Math.min(bw / 2, 6, (y0 - y1) / 2); if (k === 2 && bw > 3) { g.beginPath(); g.moveTo(cx - bw / 2, y0); g.lineTo(cx - bw / 2, y1 + r); g.arcTo(cx - bw / 2, y1, cx, y1, r); g.arcTo(cx + bw / 2, y1, cx + bw / 2, y1 + r, r); g.lineTo(cx + bw / 2, y0); g.closePath(); g.fill(); } else g.fillRect(cx - bw / 2, y1, bw, Math.max(0, y0 - y1 - (bw > 6 ? 1 : 0))); });
    }
    g.globalAlpha = 1;
    // target
    g.setLineDash([4, 4]); g.strokeStyle = ink3; g.lineWidth = 1.25; g.beginPath(); g.moveTo(0, Math.round(y(420)) + .5); g.lineTo(pw, Math.round(y(420)) + .5); g.stroke(); g.setLineDash([]);
    // trend, fading in as nights blur together
    const tA = Math.max(0, Math.min(1, (Math.log(span) - Math.log(25)) / (Math.log(140) - Math.log(25))));
    if (tA > 0) {
      const r = Math.max(3, Math.round(span / 10)), pts = []; const stepI = Math.max(1, Math.floor(span / pw * 2));
      const js = Math.max(1, Math.round(r / 8)), tri = i => { let t = 0, n = 0; for (let j = i - r; j <= i + r; j += js) { const m = avg(j - r, j + r); if (m != null) { const w = r + 1 - Math.abs(j - i); t += m * w; n += w; } } return n ? t / n : null; };
      for (let i = Math.max(0, Math.floor(s0)); i <= LASTI; i += stepI) { const m = tri(i); if (m != null) pts.push([x(i), y(m)]); }
      const lm = tri(LASTI); if (lm != null) pts.push([x(LASTI), y(lm)]);
      g.globalAlpha = tA; g.lineJoin = 'round'; g.lineCap = 'round';
      [[card, 7], [ink, 3]].forEach(([c, w]) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); pts.forEach((q, k) => k ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.stroke(); });
      g.globalAlpha = 1;
    }
    g.restore();
    g.font = `600 10.5px ${sans}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineWidth = 4; g.lineJoin = 'round'; g.strokeStyle = card; g.strokeText('Target 7h', 4, y(420) - 9); g.fillStyle = ink2; g.fillText('Target 7h', 4, y(420) - 9);
    // one night: label the stages
    if (span < 1.6) {
      const i = LASTI, a = A[i], parts = [['Deep', DE[i]], ['Core', a - DE[i] - RE[i]], ['REM', RE[i]]], cx = x(i), fade = Math.max(0, Math.min(1, (1.6 - span) / .5));
      let acc = 0; g.globalAlpha = fade; g.textAlign = 'left';
      parts.forEach(([n, m], k) => { const ym = y(acc + m / 2); acc += m; g.fillStyle = cols[k]; g.fillRect(cx + bw / 2 + 14, ym - 5, 10, 10); g.font = `650 13px ${sans}`; g.fillStyle = ink; g.fillText(dur(m), cx + bw / 2 + 32, ym); const w = g.measureText(dur(m)).width; g.font = `500 13px ${sans}`; g.fillStyle = ink2; g.fillText(n, cx + bw / 2 + 38 + w, ym); });
      g.font = `700 22px ${sans}`; const tw0 = g.measureText(dur(a)).width;
      if (cx - bw / 2 - 16 - tw0 >= 2) { g.fillStyle = ink; g.textAlign = 'right'; g.fillText(dur(a), cx - bw / 2 - 16, y(a) + 4); g.font = `500 12px ${sans}`; g.fillStyle = ink3; g.fillText('asleep', cx - bw / 2 - 16, y(a) + 22); }
      else { g.textAlign = 'center'; g.lineWidth = 5; g.strokeStyle = card; g.strokeText(dur(a) + ' asleep', cx, y(a) - 18); g.fillStyle = ink; g.font = `700 16px ${sans}`; g.strokeText(dur(a) + ' asleep', cx, y(a) - 18); g.fillText(dur(a) + ' asleep', cx, y(a) - 18); }
      g.globalAlpha = 1;
    }
    // x labels
    g.font = `500 11px ${sans}`; g.fillStyle = ink3; g.textBaseline = 'alphabetic';
    const lab = [], d0 = Math.max(0, Math.ceil(s0));
    if (span < 1.6) lab.push([LASTI, (d => `${WDS[d.getUTCDay()]}, ${MONS[d.getUTCMonth()]} ${d.getUTCDate()}`)(dt(LASTI))]);
    else if (span < 12) for (let i = d0; i <= LASTI; i++) lab.push([i, `${WDS[dt(i).getUTCDay()]} ${dt(i).getUTCDate()}`]);
    else if (span < 80) for (let i = d0; i <= LASTI; i++) { if (dt(i).getUTCDay() === 1) lab.push([i, `${MONS[dt(i).getUTCMonth()]} ${dt(i).getUTCDate()}`]); }
    else if (span < 700) for (let i = d0; i <= LASTI; i++) { if (dt(i).getUTCDate() === 1) lab.push([i, MONS[dt(i).getUTCMonth()]]); }
    else for (let i = d0; i <= LASTI; i++) { const d = dt(i); if (d.getUTCDate() === 1 && d.getUTCMonth() === 0) lab.push([i, String(d.getUTCFullYear())]); }
    let lastR = -1e9;
    lab.forEach(([i, t]) => { const w = g.measureText(t).width; let L2 = Math.max(0, Math.min(pw - w, x(i) - w / 2)); if (L2 < lastR + 10) return; g.textAlign = 'left'; g.fillText(t, L2, H - 6); lastR = L2 + w; });
    legSt.forEach(e => { e.style.display = barA > .05 ? '' : 'none'; }); legN.style.display = dotA > .05 ? '' : 'none'; legT.style.display = tA > .05 ? '' : 'none';
    // header range
    const a0 = Math.max(0, Math.round(s0)), fmt = i => `${MONS[dt(i).getUTCMonth()]} ${dt(i).getUTCDate()}`;
    rangeEl.textContent = span < 1.6 ? `Night of ${fmt(LASTI)}` : span < 80 ? `${fmt(a0)} – ${fmt(LASTI)}` : `${MONS[dt(a0).getUTCMonth()]} ${dt(a0).getUTCFullYear()} – ${MONS[dt(LASTI).getUTCMonth()]} ${dt(LASTI).getUTCFullYear()}`;
  };
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

  const start = () => { L.classList.add('on'); setTimeout(() => document.getElementById('drop').classList.add('settled'), 1800); setTimeout(() => rig.classList.add('settled'), 2600); requestAnimationFrame(() => { rig.classList.add('in'); rig.querySelectorAll('.sw').forEach(a => a.setAttribute('stroke-dasharray', a.dataset.to)); }); };
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

  // zoom story
  const SD = sampleData(), zc = document.getElementById('lpZoom'), draw = makeZoom(zc, SD), zs = document.getElementById('zoom');
  const caps = [...L.querySelectorAll('.lp-zcap')], dots = [...L.querySelectorAll('.lp-zsteps i')];
  let zp = 0, zStage = -1;
  const paintZoom = () => { draw(zp); const st = stageOf(zp); if (st !== zStage) { zStage = st; caps.forEach((c, k) => c.classList.toggle('on', k === st)); dots.forEach((d, k) => d.classList.toggle('on', k === st)); } };
  addEventListener('resize', () => { if (!L.hidden) paintZoom(); });
  new MutationObserver(() => { if (!L.hidden) requestAnimationFrame(() => paintZoom()); }).observe(L, { attributes: true, attributeFilter: ['hidden'] });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!L.hidden) paintZoom(); });
  if (!L.hidden) requestAnimationFrame(() => paintZoom());

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
    const idle = !RM && t - last > 2500, drift = idle ? Math.sin(t / 2600) * .22 : 0, drift2 = idle ? Math.cos(t / 3100) * .14 : 0;
    cx += ((idle ? drift : tx) - cx) * .06; cy += ((idle ? drift2 : ty) - cy) * .06;
    const sc = Math.min(1, scrollY / 700);
    rig.style.transform = `rotateX(${14 - cy * 12 + sc * 10}deg) rotateY(${-20 + cx * 22}deg) rotateZ(2deg) translateZ(${-sc * 120}px)`;
    const p = clamp((scrollY - explodeTop + innerHeight * .15) / explodeH);
    if (Math.abs(p - lastP) > .0005) { lastP = p; paintTiles(p); }
    const zr = zs.getBoundingClientRect(), np = clamp(-zr.top / Math.max(1, zs.offsetHeight - innerHeight));
    if (Math.abs(np - zp) > .0004) { zp = np; paintZoom(); }
  };
  requestAnimationFrame(loop);
  // the dashboard may reveal the landing later (after "Forget my data")
  new MutationObserver(() => { if (!L.hidden) { measure(); measureTiles(tiles); lastP = -1; } }).observe(L, { attributes: true, attributeFilter: ['hidden'] });
}
if (L && !new URLSearchParams(location.search).has('embed')) init();
