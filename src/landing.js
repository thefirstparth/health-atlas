// Home page only: the recorder, scroll choreography, reveals. No data, no network.
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
// ------------------------------------------------------------ the recorder: four years of nights, drawn in
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const dur = m => { m = Math.round(m); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
function makeRecorder(canvas, D, tip, dateEl) {
  const N = D.meta.days, T0 = Date.parse(D.meta.start + 'T00:00:00Z'), bed = D.daily.sl_bed, wake = D.daily.sl_wake, asl = D.daily.sl_asleep;
  const day = i => new Date(T0 + i * 864e5), Y0 = -150, Y1 = 660;
  // the midpoint of sleep, averaged over 31 nights around each night
  const mid = bed.map((b, i) => b == null || wake[i] == null ? null : (b + wake[i]) / 2), trend = smooth(mid.map(v => v), 28);
  // one bar per week: median bedtime to median wake-up; weeks with 3+ short nights are marked
  const med = a => { const v = a.filter(x => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  const WKS = []; for (let a = 0; a < N; a += 7) { const b = Math.min(N - 1, a + 6), ix = []; for (let i = a; i <= b; i++) ix.push(i); const bd = med(ix.map(i => bed[i])), wk = med(ix.map(i => wake[i])); WKS.push({ a, b, bd, wk, short: ix.filter(i => asl[i] != null && asl[i] < 360).length }); }
  // two plain facts about the figure, computed from it
  let worst = { n: -1, a: 0 };
  for (let a = 0; a + 60 <= N; a += 5) { let n = 0; for (let i = a; i < a + 60; i++) if (asl[i] != null && asl[i] < 360) n++; if (n > worst.n) worst = { n, a }; }
  const avg = (a, b) => { let s = 0, n = 0; for (let i = a; i <= b; i++) if (asl[i] != null) { s += asl[i]; n++; } return n ? s / n : null; };
  const yNow = avg(N - 365, N - 1), yPrev = avg(N - 730, N - 366);
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace';
  let W = 0, H = 0, dpr = 1, prog = 0, notes = 0, hover = -1;
  const PR = 44, PB = 24, PT = 12;
  const size = () => { dpr = Math.min(2, devicePixelRatio || 1); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); };
  const X = i => (i + .5) / N * (W - PR), Y = m => PT + (m - Y0) / (Y1 - Y0) * (H - PT - PB);
  const draw = () => {
    if (!W) size(); if (!W) return;
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const ink = css('--ink'), ink3 = css('--ink-3'), grid = css('--grid'), c = css('--c-sleep'), bad = css('--bad'), card = css('--card'), pw = W - PR;
    g.font = `400 10.5px ${mono}`; g.textBaseline = 'middle';
    for (let m = -120; m <= 660; m += 120) { const y = Math.round(Y(m)) + .5; g.strokeStyle = grid; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke(); g.fillStyle = ink3; g.fillText(hhmm(m), pw + 8, y); }
    g.textBaseline = 'alphabetic';
    for (let yr = day(0).getUTCFullYear() + 1; yr <= day(N - 1).getUTCFullYear(); yr++) { const i = Math.round((Date.UTC(yr, 0, 1) - T0) / 864e5); if (i <= 0 || i >= N) continue; const x = Math.round(X(i)) + .5; g.strokeStyle = ink3; g.globalAlpha = .45; g.beginPath(); g.moveTo(x, PT); g.lineTo(x, H - PB + 6); g.stroke(); g.globalAlpha = 1; g.fillStyle = ink3; g.fillText(String(yr), x + 5, H - 6); }
    const upto = Math.min(N, Math.floor(prog * N)), bw = Math.max(1.2, pw / WKS.length * .62);
    for (const w of WKS) {
      if (w.a >= upto || w.bd == null || w.wk == null) continue;
      const on = hover >= w.a && hover <= w.b, short = w.short >= 3, x = X((w.a + w.b) / 2);
      g.fillStyle = short ? bad : c; g.globalAlpha = (short ? .8 : .5) * (hover >= 0 && !on ? .5 : 1);
      const y0 = Y(w.bd), y1 = Y(w.wk); g.beginPath(); if (g.roundRect) g.roundRect(x - bw / 2, y0, bw, y1 - y0, Math.min(bw / 2, 2)); else g.rect(x - bw / 2, y0, bw, y1 - y0); g.fill();
    }
    g.globalAlpha = 1;
    // trend of the midpoint
    g.strokeStyle = ink; g.lineWidth = 1.6; g.lineJoin = 'round'; g.beginPath(); let on = false;
    for (let i = 0; i < upto; i++) { const v = trend[i]; if (v == null || isNaN(v)) { on = false; continue; } if (!on) { g.moveTo(X(i), Y(v)); on = true; } else g.lineTo(X(i), Y(v)); }
    g.stroke();
    if (prog < 1) { const px = X(upto); g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.moveTo(px, PT); g.lineTo(px, H - PB); g.stroke(); const v = trend[Math.max(0, upto - 1)]; if (v != null) { g.fillStyle = ink; g.beginPath(); g.arc(px, Y(v), 3.5, 0, 7); g.fill(); } }
    // annotations, once the drawing is done
    if (notes > 0) {
      g.globalAlpha = notes; g.font = `400 11px ${mono}`; g.textBaseline = 'alphabetic';
      const label = (x, y, lines, align) => { const w = Math.max(...lines.map(t => g.measureText(t).width)) + 14, h = lines.length * 15 + 8; let lx = align === 'right' ? x - w : x; lx = Math.max(2, Math.min(lx, pw - w - 2)); g.fillStyle = card; g.globalAlpha = notes * .92; g.fillRect(lx, y - h + 4, w, h); g.globalAlpha = notes; g.strokeStyle = ink3; g.lineWidth = 1; g.strokeRect(lx + .5, y - h + 4.5, w - 1, h - 1); g.fillStyle = ink; lines.forEach((t, k) => g.fillText(t, lx + 7, y - h + 20 + k * 15)); };
      if (worst.n >= 8) {
        const a = worst.a, b = worst.a + 59, x0 = X(a), x1 = X(b), yb = Y(Y1) - 58;
        g.strokeStyle = bad; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x0, yb - 6); g.lineTo(x0, yb); g.lineTo(x1, yb); g.lineTo(x1, yb - 6); g.stroke();
        const d0 = day(a), d1 = day(b);
        label(x0, yb + 44, [`${MONS[d0.getUTCMonth()]} ${d0.getUTCFullYear()} – ${MONS[d1.getUTCMonth()]} ${d1.getUTCFullYear()}`, `${worst.n} of 60 nights under 6 hours`], x0 > pw * .6 ? 'right' : 'left');
      }
      if (W >= 560 && yNow != null && yPrev != null && Math.abs(yNow - yPrev) >= 5) {
        const x = X(N - 1), yb = Y(Y0 + 10) + 44;
        label(x, yb, [`Last 12 months: ${dur(yNow)} a night,`, `${Math.round(Math.abs(yNow - yPrev))} min ${yNow > yPrev ? 'more' : 'less'} than the 12 before`], 'right');
      }
      g.globalAlpha = 1;
    }
    if (hover >= 0) { const w = WKS[Math.floor(hover / 7)]; if (w && w.bd != null) { const x = X((w.a + w.b) / 2); g.strokeStyle = ink; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, PT); g.lineTo(x, H - PB); g.stroke(); g.setLineDash([]); [w.bd, w.wk].forEach(v => { g.fillStyle = ink; g.beginPath(); g.arc(x, Y(v), 3.5, 0, 7); g.fill(); }); } }
  };
    const setDate = () => { const i = Math.max(0, Math.min(N - 1, Math.floor(prog * N) - 1)), d = day(i); dateEl.textContent = prog < 1 ? `${MONS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${MONS[day(0).getUTCMonth()]} ${day(0).getUTCFullYear()} – ${MONS[day(N - 1).getUTCMonth()]} ${day(N - 1).getUTCFullYear()} · ${N.toLocaleString('en-US')} nights`; };
  canvas.addEventListener('pointermove', e => {
    if (prog < 1) return; const r = canvas.getBoundingClientRect(), px = e.clientX - r.left; if (px > W - PR) { canvas.dispatchEvent(new Event('pointerleave')); return; }
    const k = Math.max(0, Math.min(WKS.length - 1, Math.floor(px / (W - PR) * N / 7))), w = WKS[k];
    if (w.bd == null) return; hover = w.a; draw();
    const d0 = day(w.a), d1 = day(w.b), ws = [w.a, w.b].map(i => asl[i]);
    tip.textContent = `Week of ${d0.getUTCDate()} ${MONS[d0.getUTCMonth()]} ${d0.getUTCFullYear()}  ${hhmm(w.bd)} → ${hhmm(w.wk)}  ${w.short} short night${w.short === 1 ? '' : 's'}`;
    tip.classList.add('on'); const tw = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(X(w.a + 3) - tw / 2, W - tw)) + 'px';
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; tip.classList.remove('on'); draw(); });
  return {
    resize() { size(); draw(); },
    play(ms) {
      if (RM || !ms) { prog = 1; notes = 1; setDate(); size(); draw(); return; }
      const t0 = performance.now(); size();
      const step = t => { const f = Math.min(1, (t - t0) / ms); prog = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; setDate(); draw(); if (f < 1) requestAnimationFrame(step); else { const t1 = performance.now(); const fade = t2 => { notes = Math.min(1, (t2 - t1) / 600); draw(); if (notes < 1) requestAnimationFrame(fade); }; requestAnimationFrame(fade); } };
      requestAnimationFrame(step);
    },
    redraw: () => draw(),
  };
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
  const tiles = document.getElementById('lpTiles');
  buildTiles(tiles);
  L.querySelectorAll('.lp-h1 .w > span').forEach((s, i) => s.style.setProperty('--i', i));
  L.querySelectorAll('.lp-hero .rv').forEach((s, i) => s.style.setProperty('--d', `${420 + i * 110}ms`));
  L.querySelectorAll('.lp-steps .rv').forEach((s, i) => s.style.setProperty('--d', `${i * 90}ms`));
  const SD = sampleData();
  const recorder = makeRecorder(document.getElementById('lpRec'), SD, document.getElementById('lpRecTip'), document.getElementById('lpRecDate'));
  let rw = innerWidth; addEventListener('resize', () => { measureTiles(tiles); if (Math.abs(innerWidth - rw) > 1 && !L.hidden) { rw = innerWidth; recorder.resize(); } });

  const start = () => { L.classList.add('on'); setTimeout(() => document.getElementById('drop').classList.add('settled'), 1800); setTimeout(() => recorder.play(3200), 550); };
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(start));
  // the landing starts hidden until the app knows there is no stored data; animate when it appears
  let started = false;
  const reveal = () => { measureTiles(tiles); if (started) { recorder.resize(); return; } started = true; if (document.fonts && document.fonts.ready) document.fonts.ready.then(ready); else ready(); };
  if (!L.hidden) reveal();
  new MutationObserver(() => { if (!L.hidden) reveal(); }).observe(L, { attributes: true, attributeFilter: ['hidden'] });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!L.hidden) recorder.redraw(); });
  new MutationObserver(() => { if (!L.hidden) recorder.redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // reveals below the fold
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .2 });
  L.querySelectorAll('.lp-steps .rv, .lp-finalcard').forEach(n => io.observe(n));

  // buttons elsewhere on the page open the same file picker
  L.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => document.getElementById('pick').click()));

  // zoom story + live demo
  const zc = document.getElementById('lpZoom'), draw = makeZoom(zc, SD), zs = document.getElementById('zoom');
  const caps = [...L.querySelectorAll('.lp-zcap')], dots = [...L.querySelectorAll('.lp-zsteps i')];
  let zp = RM ? 1 : 0, zStage = -1;
  const paintZoom = () => { draw(zp); const st = stageOf(zp); if (st !== zStage) { zStage = st; caps.forEach((c, k) => c.classList.toggle('on', k === st)); dots.forEach((d, k) => d.classList.toggle('on', k === st)); } };
  addEventListener('resize', () => { if (!L.hidden) paintZoom(); });
  new MutationObserver(() => { if (!L.hidden) requestAnimationFrame(() => { paintZoom(); fitLive(); }); }).observe(L, { attributes: true, attributeFilter: ['hidden'] });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!L.hidden) paintZoom(); });
  const live = document.getElementById('lpLive'), fwrap = document.getElementById('lpFwrap'), frame = document.getElementById('lpFrame');
  const fitLive = () => { const w = fwrap.clientWidth; if (!w) return; const sc = w / 1280; live.style.transform = `scale(${sc})`; fwrap.style.height = Math.round(820 * sc) + 'px'; };
  addEventListener('resize', fitLive);
  new IntersectionObserver((es, ob) => es.forEach(e => { if (e.isIntersecting && getComputedStyle(frame).display !== 'none') { live.src = 'index.html?demo&embed'; fitLive(); ob.disconnect(); } }), { rootMargin: '700px 0px' }).observe(frame);
  L.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => document.getElementById('demoTry').click()));
  if (!L.hidden) requestAnimationFrame(() => { paintZoom(); fitLive(); });

  if (RM) { paintTiles(1); return; }

  let explodeTop = 0, explodeH = 1;
  const measure = () => { const s = document.getElementById('chapters'); const r = s.getBoundingClientRect(); explodeTop = r.top + scrollY; explodeH = Math.max(1, s.offsetHeight - innerHeight); };
  measure(); addEventListener('resize', () => { measure(); measureTiles(tiles); });
  let lastP = -1;
  const loop = t => {
    requestAnimationFrame(loop);
    if (L.hidden) return;
    const p = clamp((scrollY - explodeTop + innerHeight * .15) / explodeH);
    if (Math.abs(p - lastP) > .0005) { lastP = p; paintTiles(p); }
    const zr = zs.getBoundingClientRect(), np = clamp(-zr.top / Math.max(1, zs.offsetHeight - innerHeight));
    if (Math.abs(np - zp) > .0004) { zp = np; paintZoom(); }
    const fr = frame.getBoundingClientRect(), fp = clamp(1 - (fr.top - innerHeight * .12) / (innerHeight * .75));
    frame.style.transform = `perspective(1600px) rotateX(${(1 - fp) * 22}deg) scale(${.9 + fp * .1})`;
  };
  requestAnimationFrame(loop);
  // the dashboard may reveal the landing later (after "Forget my data")
  new MutationObserver(() => { if (!L.hidden) { measure(); measureTiles(tiles); lastP = -1; } }).observe(L, { attributes: true, attributeFilter: ['hidden'] });
}
if (L && !new URLSearchParams(location.search).has('embed')) init();
