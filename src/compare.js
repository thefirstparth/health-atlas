// Compare mode: two or three people's exports, side by side, on one shared timeline.
// compareKit(K) receives the dashboard's own helpers (K) and returns the compare chapters.
//
// The rules, in one place:
// - Each person keeps one colour on every chart, and every line carries their name at its end.
// - Simple measures overlay in one chart (a trend line per person). Composite charts that would
//   tangle when overlaid (sleep schedule, every night, sleep stages) get one row or column per person.
// - Averages use only the days that person recorded. Days without data stay empty, never zero.
// - "Days everyone recorded" narrows every daily measure to the days all visible people have it.
// - When someone has nothing for a period, the reason is spelled out: export starts later,
//   export ends earlier, or simply not recorded.
export const PERSON_VARS = ['--p-1', '--p-2', '--p-3'];

export function compareKit(K) {
  const { PEOPLE, S, LAST, DEF, U, VC, CHMAP, el, sv, css, tw, nf, F1, fmt, fmtDur, fmtDurC, fmtClock, hTxt, dt, dShort, dLong, dYr, MON,
    buckets, bucketLabel, periodLabel, frame, mount, hoverLayer, showTip, hideTip, band, rows, legend, chartBox, plainCard, runs, poly, barPath,
    yDom, durDom, clockDom, axisFmt, deltaInfo, daysIn, dateShort, go, render, glyph, makeStats, STAGES, LEVERS, WORD, onColor, declutter } = K;
  const font = () => K.font();

  // ------------------------------------------------------------ people
  PEOPLE.forEach((P, k) => {
    P.cvar = PERSON_VARS[k]; P.raw = makeStats(P.D);
    // days on which this person has any reading at all (prefix sums, for coverage)
    const pres = new Int32Array(LAST + 2), any = new Uint8Array(LAST + 1);
    for (const a of Object.values(P.D.daily)) for (let i = 0; i <= LAST; i++) if (a[i] != null) any[i] = 1;
    for (let i = 0; i <= LAST; i++) pres[i + 1] = pres[i] + any[i];
    P.any = any; P.pres = pres;
  });
  // the shortest label that tells people apart (for the strip): initials, else 2-4 letters, else numbers
  { const nm = PEOPLE.map(P => P.name.trim()), len = [1, 2, 3, 4].find(n => new Set(nm.map(x => x.slice(0, n).toLowerCase())).size === nm.length);
    PEOPLE.forEach((P, k) => { const t = nm[k].slice(0, len || 0); P.short = len ? t[0].toUpperCase() + t.slice(1) : String(k + 1); });
    // line labels: the name, or its first word cut to 10 characters, unless that stops telling people apart
    const tag = n => n.length <= 10 ? n : (n.split(/\s+/)[0].slice(0, 10) + (n.split(/\s+/)[0].length > 10 ? '…' : ''));
    const tags = nm.map(tag), ok = new Set(tags).size === tags.length; PEOPLE.forEach((P, k) => { P.tag = ok ? tags[k] : P.short; }); }
  // workouts: someone whose export has none at all did not record them (an iPhone without a Watch, say)
  PEOPLE.forEach(P => { P.noWk = !P.D.workouts.length; });
  if (!S.hide) S.hide = new Set();
  const vis = () => PEOPLE.filter(P => !S.hide.has(P.k));
  const col = P => css(P.cvar);
  const presDays = (P, a, b) => { a = Math.max(a, 0); b = Math.min(b, LAST); return b < a ? 0 : P.pres[b + 1] - P.pres[a]; };

  // "Days everyone recorded": for each measure, keep a day only if every visible person who records
  // that measure at all has a value that day. A measure only one person records is left as it is.
  const SHC = {};
  function sharedStats(list) {
    const keys = new Set(list.flatMap(P => Object.keys(P.D.daily))), out = {};
    const masked = Object.fromEntries(list.map(P => [P.k, {}]));
    for (const k of keys) {
      const H = list.filter(P => (P.D.daily[k] || []).some(v => v != null));
      for (const P of list) {
        const a = P.D.daily[k]; if (!a) continue;
        if (H.length < 2 || !H.includes(P)) { masked[P.k][k] = a; continue; }
        masked[P.k][k] = a.map((v, i) => v == null || H.some(Q => Q.D.daily[k][i] == null) ? null : v);
      }
    }
    const allHere = i => list.every(P => P.any[i]);
    for (const P of list) out[P.k] = makeStats({ ...P.D, daily: masked[P.k], workouts: P.D.workouts.filter(w => { const i = K.isoIdx(w.d); return i >= 0 && i <= LAST && allHere(i); }) });
    return out;
  }
  function st(P) {
    if (!S.shared) return P.raw;
    const list = vis(); if (list.length < 2) return P.raw;
    const id = list.map(x => x.k).join('');
    return (SHC[id] || (SHC[id] = sharedStats(list)))[P.k] || P.raw;
  }
  // why a person has nothing to show for a window
  function why(P, a, e, short) {
    if (a > P.D.to) return short ? `Ends ${MON[dt(P.D.to).getUTCMonth()]} ${dYr(P.D.to)}` : `Export ends ${dShort(P.D.to)}, ${dYr(P.D.to)}`;
    if (e < P.D.from) return short ? `Starts ${MON[dt(P.D.from).getUTCMonth()]} ${dYr(P.D.from)}` : `Export starts ${dShort(P.D.from)}, ${dYr(P.D.from)}`;
    return S.shared ? 'No shared days' : 'Not recorded';
  }
  const dotName = (P, extra) => { const s = el('span', 'pname'); const i = el('i'); i.style.background = col(P); s.append(i, el('span', null, P.name)); if (extra) s.appendChild(extra); return s; };

  // ------------------------------------------------------------ text
  // One plain sentence: who is highest, by how much, against whom.
  function summary(def, list, isCount) {
    const have = list.filter(x => x.v != null);
    if (!have.length) return null;
    if (have.length === 1) return `Only ${have[0].P.name} has ${def.t.toLowerCase()} in this period.`;
    const hi = have.reduce((a, b) => b.v > a.v ? b : a), lo = have.reduce((a, b) => b.v < a.v ? b : a);
    const info = deltaInfo(def.u, 0, hi.v, lo.v), shown = v => F1(def.u, v).join(' ');
    if (!info || info.txt === 'No change' || hi === lo || shown(hi.v) === shown(lo.v)) return `About the same for ${have.length === 2 ? 'both' : 'everyone'}.`;
    const kind = U[def.u].d, verb = isCount ? 'totalled' : 'averaged';
    const word = kind === 'clock' ? '' : kind === 'pct' || kind === 'dur' ? ' more' : ' higher';
    return `${hi.P.name} ${verb} ${info.txt}${word} than ${lo.P.name}.`;
  }
  const covText = (n, total) => `${n} of ${total}`;
  const covNote = (rail, def, total) => rail.appendChild(el('div', 'meta', `Right column: ${def.night ? 'nights' : 'days'} with data, of the ${total} in this period. Each average uses only those.`));
  // ranked rows: best first where there is a better direction, else highest first
  function rankRows(rail, def, list, opts = {}) {
    const dir = def.dir || 1;
    const have = list.filter(x => x.v != null).sort((a, b) => (b.v - a.v) * dir), none = list.filter(x => x.v == null);
    const same = (a, b) => (opts.fmt || (v => F1(def.u, v)))(a.v).join('') === (opts.fmt || (v => F1(def.u, v)))(b.v).join('');
    const best = def.dir && have.length > 1 && !same(have[0], have[1]) ? have[0] : null;
    const g = rows(rail, [...have, ...none].map(x => {
      const lab = dotName(x.P, best === x ? el('span', 'best', 'best') : null);
      if (x.v == null) return { l: lab, v: '–', x: el('span', 'd why', x.why) };
      const low = opts.total && x.n / opts.total < .5;
      const cx = opts.cov ? el('span', 'd' + (low ? ' low' : ''), opts.cov(x)) : '';
      if (low) cx.title = 'Fewer than half of the days in this period have data, so this average leans on a few days.';
      return { l: lab, v: opts.fmt ? opts.fmt(x.v) : F1(def.u, x.v), x: cx };
    }));
    g.classList.add('crows');
    return g;
  }

  // ------------------------------------------------------------ chart pieces
  // name pills at the end of each line, pushed apart so they never overlap
  function endLabels(F, ends) {
    const h = 20, gap = 3, f = `700 11px ${font()}`;
    // narrow charts (phones) use the short label so the pills do not cover the last stretch of the lines
    const narrow = F.pw < 480, txt = x => narrow && x.P ? x.text.replace(x.P.tag, x.P.short) : x.text;
    const L = ends.filter(Boolean).map(x => ({ ...x, text: txt(x), w: tw(txt(x), f) + 16 })).sort((a, b) => a.y - b.y);
    L.forEach(l => { l.side = l.x + 12 + l.w <= F.pw ? 1 : -1; l.cy = l.y; });
    for (let k = 1; k < L.length; k++) if (L[k].cy - L[k - 1].cy < h + gap) L[k].cy = L[k - 1].cy + h + gap;
    const maxY = F.base - h / 2; for (let k = L.length - 1; k >= 0; k--) { if (L[k].cy > maxY) L[k].cy = maxY; if (k && L[k].cy - L[k - 1].cy < h + gap) L[k - 1].cy = L[k].cy - h - gap; }
    L.forEach(l => { if (l.cy < h / 2) l.cy = h / 2; });
    for (const l of L) {
      const px = l.side > 0 ? l.x + 10 : l.x - 10 - l.w, py = l.cy - h / 2;
      const g = sv('g', { class: 'draw pill' }, F.g);
      sv('rect', { x: px, y: py, width: l.w, height: h, rx: h / 2, fill: l.c }, g);
      const t = sv('text', { x: px + l.w / 2, y: py + 13.8, 'text-anchor': 'middle', fill: onColor(l.c), style: `font:${f};font-variant-numeric:tabular-nums` }, g); t.textContent = l.text;
    }
  }
  // who did better in each strip bucket (month in Year view, week in Month view ...)
  function leaderStrip(F, view, p, def, list, agg) {
    const bks = buckets(VC[view].strip, p.a, p.b), y0 = F.stripY, hh = 24, f = `650 10.5px ${font()}`;
    const cells = bks.map(bk => {
      const x0 = F.x(bk.s) - F.pxDay / 2, x1 = F.x(bk.e) + F.pxDay / 2;
      if (bk.s > LAST) return { x0, x1 };
      const v = list.map(P => ({ P, v: agg(P, bk.s, Math.min(bk.e, LAST)) })).filter(x => x.v != null);
      if (v.length < 2) return { x0, x1 };
      v.sort((a, b) => (b.v - a.v) * def.dir);
      const tie = U[def.u].c(v[0].v) === U[def.u].c(v[1].v);
      return { x0, x1, P: tie ? null : v[0].P, tie };
    });
    const minW = Math.min(...cells.map(c => c.x1 - c.x0));
    if (minW < 5 || !cells.some(c => c.P || c.tie)) { K.dropStrip(F); return false; }
    const withText = cells.every(c => !c.P || tw(c.P.short, f) <= c.x1 - c.x0 - 6);
    cells.forEach(c => {
      if (!c.P && !c.tie) return;
      const w = c.x1 - c.x0;
      sv('rect', { class: 'stripel', x: c.x0 + 1.5, y: y0, width: Math.max(0, w - 3), height: hh, rx: 7, fill: c.P ? col(c.P) : css('--ink-3'), 'fill-opacity': c.P ? .2 : .1 }, F.g);
      if (withText) { const t = sv('text', { class: 'stripel', x: (c.x0 + c.x1) / 2, y: y0 + hh / 2 + 3.8, 'text-anchor': 'middle', fill: css('--ink'), style: `font:${f}` }, F.g); t.textContent = c.P ? c.P.short : '='; }
    });
    const lt = sv('text', { x: F.W - 1, y: y0 + hh / 2 + 3.5, class: 'stripl stripel', 'text-anchor': 'end' }, F.g); lt.textContent = 'BEST';
    return true;
  }
  const CG = { W: 'day', M: 'week', '6M': 'month', Y: 'month', All: 'year' };
  const GNAME = { day: 'day', week: 'week', month: 'month', year: 'year' };
  function personLegend(list, extra = []) { return legend([...list.map(P => ({ t: P.name, c: col(P), cls: 'ln' })), ...extra]); }

  // ------------------------------------------------------------ the overlay chart
  // Week: grouped bars (or dots) per day. Month and longer: one trend line per person; Month also
  // shows each day faintly. Counts are always grouped bars of totals.
  function drawCmp(box, def, view, p, list) {
    const cfg = VC[view], e = Math.min(p.b, LAST), a0 = Math.max(p.a, 0), isCount = def.k === 'count', isBar = def.k === 'bar' || isCount;
    const mode = isCount || (view === 'W' && isBar) ? 'bars' : view === 'W' ? 'dots' : 'lines';
    const gran = mode === 'bars' ? CG[view] : mode === 'dots' ? 'day' : cfg.ctx, bks = buckets(gran, p.a, p.b);
    const agg = (P, a, b) => { const r = st(P).win(def.key, a, b); return isCount ? (r.n ? r.sum : null) : r.v; };
    const ser = list.map(P => ({ P, c: col(P), bv: bks.map(bk => bk.s > LAST ? null : agg(P, bk.s, Math.min(bk.e, LAST))), T: mode === 'lines' ? st(P).trend(def.key, cfg.r) : null }));
    const daily = mode === 'lines' && cfg.ctx === 'day';
    const vals = [];
    ser.forEach(s => { if (mode !== 'lines') vals.push(...s.bv); else for (let i = a0; i <= e; i++) { vals.push(s.T[i]); if (daily) vals.push(st(s.P).get(def.key, i)); } });
    const tgt = def.target != null ? def.target : null; if (tgt != null) vals.push(tgt);
    if (!vals.some(v => v != null)) return null;
    const dom = def.u === 'clock' ? clockDom(vals) : def.u === 'dur' ? durDom(vals) : yDom(vals, isBar, 3);
    const lead = !!def.dir && list.length > 1;
    const F = frame(box, view, p, dom, { yFmt: axisFmt(def.u), strip: lead, label: def.t });
    const surf = css('--card'), ends = [], targets = [];
    if (def.floor != null) { const fy = F.y(def.floor), bad = css('--bad'); sv('line', { x1: 0, x2: F.pw, y1: fy, y2: fy, stroke: bad, 'stroke-width': 1, 'stroke-opacity': .5, 'stroke-dasharray': '4 4' }, F.g); const t = sv('text', { class: 'reflab halo', x: 4, y: fy + 14 }, F.g); t.textContent = 'Floor ' + U[def.u].c(def.floor); t.style.fill = bad; t.dataset.ly = fy + 20; }
    if (tgt != null) { const gy = F.y(tgt); sv('line', { class: 'refline', x1: 0, x2: F.pw, y1: gy, y2: gy }, F.g); const t = sv('text', { class: 'reflab halo', x: 4, y: gy - 6 }, F.g); t.textContent = 'Target ' + U[def.u].c(tgt); t.dataset.ly = gy; }
    if (mode === 'bars') {
      bks.forEach((bk, j) => {
        const cx = F.x((bk.s + bk.e) / 2), gw = Math.max(4, F.pxDay * (bk.e - bk.s + 1) * .74), bw = Math.max(1.5, Math.min(16, gw / ser.length - 2));
        const x0 = cx - (bw * ser.length + 2 * (ser.length - 1)) / 2;
        ser.forEach((s, k) => { const v = s.bv[j]; if (v != null && v > 0) sv('path', { d: barPath(x0 + k * (bw + 2) + bw / 2, F.base, F.y(v), bw, Math.min(4, bw / 2)), fill: s.c, class: 'grow' }, F.g); });
        targets.push({ x: cx, bk, j, dots: [] });
      });
    } else if (mode === 'dots') {
      ser.forEach(s => {
        const pts = bks.map((bk, j) => s.bv[j] == null ? null : [F.x(bk.s), F.y(s.bv[j])]);
        runs(pts, 1).forEach(r => r.length > 1 && sv('path', { d: poly(r), fill: 'none', stroke: s.c, 'stroke-width': 2, 'stroke-linejoin': 'round', class: 'draw' }, F.g));
        pts.forEach(pt => pt && sv('circle', { cx: pt[0], cy: pt[1], r: 4.5, fill: s.c, stroke: surf, 'stroke-width': 2, class: 'draw' }, F.g));
        const lj = s.bv.map((v, j) => v == null ? -1 : j).filter(j => j >= 0).pop();
        if (lj != null) ends.push({ x: F.x(bks[lj].s), y: F.y(s.bv[lj]), c: s.c, P: s.P, text: `${s.P.tag} ${U[def.u].c(s.bv[lj])}` });
      });
      bks.forEach((bk, j) => targets.push({ x: F.x(bk.s), bk, j, dots: ser.map(s => s.bv[j] == null ? null : { y: F.y(s.bv[j]), c: s.c }).filter(Boolean) }));
    } else {
      if (daily) ser.forEach(s => { for (let i = a0; i <= e; i++) { const v = st(s.P).get(def.key, i); if (v != null) sv('circle', { cx: F.x(i), cy: F.y(v), r: 2.4, fill: s.c, 'fill-opacity': .32, class: 'draw' }, F.g); } });
      ser.forEach(s => {
        const pts = []; for (let i = a0; i <= e; i++) pts.push(s.T[i] == null ? null : [F.x(i), F.y(s.T[i])]);
        for (const r of runs(pts, 1)) {
          if (r.length < 2) continue;
          sv('path', { d: poly(r), fill: 'none', stroke: surf, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, F.g);
          const ln = sv('path', { d: poly(r), fill: 'none', stroke: s.c, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, F.g);
          requestAnimationFrame(() => { if (ln.closest('.zooming')) return; try { ln.style.setProperty('--len', ln.getTotalLength()); ln.classList.add('trace'); } catch (er) {} });
        }
        let li = -1; for (let i = e; i >= a0; i--) if (s.T[i] != null) { li = i; break; }
        if (li >= 0) { sv('circle', { cx: F.x(li), cy: F.y(s.T[li]), r: 4.5, fill: s.c, stroke: surf, 'stroke-width': 2 }, F.g); ends.push({ x: F.x(li), y: F.y(s.T[li]), c: s.c, P: s.P, text: `${s.P.tag} ${U[def.u].c(s.T[li])}` }); }
      });
      bks.forEach((bk, j) => { const m = Math.min(Math.round((bk.s + bk.e) / 2), e); targets.push({ x: F.x((bk.s + bk.e) / 2), bk, j, dots: ser.map(s => m >= a0 && s.T[m] != null ? { y: F.y(s.T[m]), c: s.c } : null).filter(Boolean) }); });
    }
    endLabels(F, ends);
    F.g.querySelectorAll('.reflab').forEach(t => F.g.appendChild(t)); declutter(F);
    if (lead) leaderStrip(F, view, p, def, list, agg);
    hoverLayer(F, targets, (t, cx, cy) => {
      const r = ser.map(s => ({ s, v: s.bv[t.j] })).sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
      showTip(cx, cy, bucketLabel(t.bk, gran), r.map(({ s, v }) => ({ v: v == null ? 'No data' : fmt(def.u, v), l: s.P.name, c: s.c })),
        isCount ? `Total for the ${GNAME[gran]}` : gran === 'day' ? null : `Average of the days each person recorded`);
    });
    return { mode, daily, lead, tgt: tgt != null, floor: def.floor != null, who: ser.filter(s => mode === 'lines' ? s.T.some((v, i) => v != null && i >= a0 && i <= e) : s.bv.some(v => v != null)).map(s => s.P) };
  }

  // ------------------------------------------------------------ bands
  const railLabel = def => def.k === 'count' ? 'Total' : def.night ? 'Average per night' : def.k === 'bar' ? 'Daily average' : 'Average';
  function cmpBand(defIn, view, p, chColor) {
    const def = typeof defIn === 'string' ? DEF[defIn] : { ...(DEF[defIn.key] || {}), ...defIn };
    if (def.k === 'points') return pointsBand(def, view, p);
    const e = Math.min(p.b, LAST), isCount = def.k === 'count', list = vis(), total = daysIn(p);
    const vals = list.map(P => { const r = st(P).win(def.key, p.a, e); return { P, v: isCount ? (r.n ? r.sum : null) : r.v, n: isCount ? presDays(P, p.a, e) : r.n, why: why(P, p.a, e, true) }; });
    if (!vals.some(x => x.v != null)) return { missing: def.t };
    const B = band(def, css('--ink-3'));
    const h = el('div', 'hero'); h.appendChild(el('div', 'lab', railLabel(def) + ' · ' + periodLabel(view, p))); B.rail.appendChild(h);
    rankRows(B.rail, def, vals, { total: isCount ? 0 : total, cov: x => covText(x.n, total) });
    const sm = summary(def, vals, isCount); if (sm) B.rail.appendChild(el('p', 'cmpsum', sm));
    if (isCount) B.rail.appendChild(el('div', 'meta', `Right column: days with any data, of the ${total} in this period.`)); else covNote(B.rail, def, total);
    const b = chartBox(), lg = el('div'); B.main.append(b, lg);
    mount(b, bx => {
      const info = drawCmp(bx, def, view, p, list); if (!info) { bx.replaceChildren(el('div', 'empty', 'Nothing recorded in this period.')); return; }
      const extra = [];
      if (info.mode === 'lines') extra.push({ t: `Trend, ${VC[view].tn}`, cls: 'ln', c: css('--ink-2') });
      if (info.daily) extra.push({ t: 'Each day', c: css('--ink-3'), op: .5 });
      if (info.mode === 'bars') extra.push({ t: isCount ? `Total each ${GNAME[CG[view]]}` : 'Each day', c: css('--ink-3') });
      if (info.tgt) extra.push({ t: 'Target', cls: 'hl' });
      if (info.lead) extra.push({ t: `Strip: better each ${GNAME[VC[view].strip]}`, c: css('--ink-3'), op: .3 });
      lg.replaceChildren(personLegend(info.who, extra));
    });
    return B.c;
  }
  // occasional readings (VO2 max, recovery ...): each reading as a dot, a trend per person when there are enough
  function pointTrend(PTS, r, a, b) {
    const H = 2 * r, out = [];
    for (let i = a; i <= b; i++) { let sw = 0, s2 = 0, n = 0; for (const q of PTS) { const d = Math.abs(q.i - i); if (d > H) continue; const w = H + 1 - d; sw += w; s2 += w * q.v; n++; } out.push(n >= 3 ? s2 / sw : null); }
    return out;
  }
  function pointsBand(def, view, p) {
    const e = Math.min(p.b, LAST), a0 = Math.max(p.a, 0), list = vis(), cfg = VC[view];
    const per = list.map(P => { const all = st(P).PTS[def.key] || [], inP = all.filter(q => q.i >= a0 && q.i <= e); return { P, all, inP, v: inP.length ? inP.reduce((s, q) => s + q.v, 0) / inP.length : null, n: inP.length, why: all.length ? (inP.length ? '' : 'None in period') : 'Not recorded' }; });
    if (!per.some(x => x.all.length)) return null;
    if (!per.some(x => x.n)) return { missing: def.t };
    const B = band(def, css('--ink-3'));
    const h = el('div', 'hero'); h.appendChild(el('div', 'lab', 'Average of readings · ' + periodLabel(view, p))); B.rail.appendChild(h);
    rankRows(B.rail, def, per, { cov: x => `${x.n} reading${x.n === 1 ? '' : 's'}` });
    const sm = summary(def, per, false); if (sm) B.rail.appendChild(el('p', 'cmpsum', sm));
    const b = chartBox(), lg = el('div'); B.main.append(b, lg);
    mount(b, bx => {
      const trendOn = !!cfg.r, ser = per.filter(x => x.n).map(x => ({ ...x, c: col(x.P), T: trendOn && x.n >= 6 ? pointTrend(x.all, cfg.r, a0, e) : null }));
      const vals = ser.flatMap(s => [...s.inP.map(q => q.v), ...(s.T || [])]);
      const F = frame(bx, view, p, yDom(vals, false, 3), { yFmt: axisFmt(def.u), label: def.t }), surf = css('--card'), ends = [];
      ser.forEach(s => {
        s.inP.forEach(q => sv('circle', { cx: F.x(q.i), cy: F.y(q.v), r: s.T ? 3 : 4, fill: s.c, 'fill-opacity': s.T ? .4 : 1, stroke: s.T ? 'none' : surf, 'stroke-width': 1.5, class: 'draw' }, F.g));
        if (s.T) {
          const pts = s.T.map((v, j) => v == null ? null : [F.x(a0 + j), F.y(v)]);
          runs(pts, 1).forEach(r => { if (r.length < 2) return; sv('path', { d: poly(r), fill: 'none', stroke: surf, 'stroke-width': 6, 'stroke-linecap': 'round' }, F.g); sv('path', { d: poly(r), fill: 'none', stroke: s.c, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, F.g); });
          const lj = s.T.map((v, j) => v == null ? -1 : j).filter(j => j >= 0).pop();
          if (lj != null) ends.push({ x: F.x(a0 + lj), y: F.y(s.T[lj]), c: s.c, P: s.P, text: `${s.P.tag} ${U[def.u].c(s.T[lj])}` });
        } else {
          if (s.inP.length > 1) sv('path', { d: poly(s.inP.map(q => [F.x(q.i), F.y(q.v)])), fill: 'none', stroke: s.c, 'stroke-width': 1.5, 'stroke-opacity': .55 }, F.g);
          const q = s.inP[s.inP.length - 1]; ends.push({ x: F.x(q.i), y: F.y(q.v), c: s.c, P: s.P, text: `${s.P.tag} ${U[def.u].c(q.v)}` });
        }
      });
      endLabels(F, ends);
      const days = [...new Set(ser.flatMap(s => s.inP.map(q => q.i)))].sort((x, y) => x - y);
      hoverLayer(F, days.map(i => ({ x: F.x(i), i, dots: ser.flatMap(s => s.inP.filter(q => q.i === i).map(q => ({ y: F.y(q.v), c: s.c }))) })), (t, cx, cy) => {
        const near = ser.map(s => { const q = s.inP.reduce((a, b) => Math.abs(b.i - t.i) < Math.abs(a.i - t.i) ? b : a); return { s, q, exact: q.i === t.i }; });
        showTip(cx, cy, dLong(t.i), near.map(({ s, q, exact }) => ({ v: fmt(def.u, q.v), l: s.P.name + (exact ? '' : ` · ${dShort(q.i)}`), c: s.c })), 'Nearest reading for each person');
      });
      lg.replaceChildren(personLegend(ser.map(s => s.P), [ser.some(s => s.T) ? { t: `Trend, ${cfg.tn}`, cls: 'ln', c: css('--ink-2') } : {}, { t: 'Each reading', c: css('--ink-3'), op: .5 }]));
    });
    return B.c;
  }
  function renderCmpBands(root, list, view, p, chColor) {
    const missing = []; let sec = null;
    for (const item of list) {
      if (item && item.sec) { sec = item.sec; continue; }
      const r = cmpBand(item, view, p, chColor);
      if (!r) continue;
      if (r.missing) { missing.push(r.missing); continue; }
      if (sec) { root.appendChild(el('div', 'section-label', sec)); sec = null; }
      root.appendChild(r);
    }
    return missing;
  }

  // ------------------------------------------------------------ sleep
  function sleepChapter(root, view, p) {
    const e = Math.min(p.b, LAST), list = vis();
    const haveSleep = list.filter(P => st(P).win('sl_asleep', p.a, e).n);
    const nb = cmpBand('sl_asleep', view, p); if (nb && !nb.missing) root.appendChild(nb);
    if (!haveSleep.length) { root.appendChild(el('div', 'missing', 'No sleep was recorded in this period by anyone shown.')); return; }
    root.appendChild(scheduleCard(view, p, haveSleep));
    { const t = nightsCard(view, p, haveSleep); if (t) root.appendChild(t); }
    root.appendChild(stagesCard(view, p, haveSleep));
    ['sl_deep', 'sl_rem', 'sl_awake'].forEach(k => { const r = cmpBand(k, view, p); if (r && !r.missing) root.appendChild(r); });
    const off = list.filter(P => !haveSleep.includes(P));
    if (off.length) root.appendChild(el('div', 'missing', `No sleep in this period for ${off.map(P => `${P.name} (${why(P, p.a, e).toLowerCase()})`).join(', ')}.`));
  }
  // one row per person: typical bedtime to wake time, with the middle half of bedtimes and wake times
  function scheduleCard(view, p, list) {
    const e = Math.min(p.b, LAST), total = daysIn(p);
    const def = { t: 'Sleep schedule', dir: 0, dirText: 'Regular is better', ex: 'One row per person: the average bedtime to the average wake time. The pale ends show where the middle half of bedtimes and wake times fell; shorter ends mean a steadier schedule.' };
    const B = band(def, css('--ink-3'));
    const rowsD = list.map(P => { const s = st(P); return { P, bed: s.win('sl_bed', p.a, e), wake: s.win('sl_wake', p.a, e), mid: s.win('sl_mid', p.a, e), qb: s.quantiles('sl_bed', p.a, e, [.25, .75]), qw: s.quantiles('sl_wake', p.a, e, [.25, .75]) }; }).filter(r => r.bed.n);
    const h = el('div', 'hero'); h.appendChild(el('div', 'lab', 'Average night · ' + periodLabel(view, p))); B.rail.appendChild(h);
    rows(B.rail, rowsD.map(r => ({ l: dotName(r.P), v: `${fmtClock(r.bed.v)} → ${fmtClock(r.wake.v)}`, x: el('span', 'd', covText(r.bed.n, total)) }))).classList.add('crows');
    if (rowsD.length > 1) {
      const late = rowsD.reduce((a, b) => b.bed.v > a.bed.v ? b : a), early = rowsD.reduce((a, b) => b.bed.v < a.bed.v ? b : a), d = late.bed.v - early.bed.v;
      B.rail.appendChild(el('p', 'cmpsum', d < 5 ? 'Everyone goes to sleep at about the same time.' : `${late.P.name} falls asleep ${fmtDur(d)} later than ${early.P.name}, on average.`));
    }
    covNote(B.rail, { night: true }, total);
    const b = chartBox(); B.main.appendChild(b);
    B.main.appendChild(legend([{ t: 'Average bedtime to wake time', c: css('--ink-3') }, { t: 'Middle half of bedtimes / wake times', c: css('--ink-3'), op: .3 }, { t: 'Midpoint', cls: 'hl' }]));
    mount(b, bx => {
      const W = Math.max(bx.clientWidth, 260), mr = 50, pw = W - mr, rh = 46, top = 8, H = top + rowsD.length * rh + 26;
      const all = rowsD.flatMap(r => [r.qb ? r.qb[0] : r.bed.v, r.qw ? r.qw[1] : r.wake.v]);
      let lo = Math.floor((Math.min(...all) - 30) / 60) * 60, hi = Math.ceil((Math.max(...all) + 30) / 60) * 60;
      if (hi - lo < 600) { const pad = (600 - (hi - lo)) / 2; lo = Math.floor((lo - pad) / 60) * 60; hi = lo + 600; }
      const x = m => (m - lo) / (hi - lo) * pw;
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Sleep schedule by person' }); bx.replaceChildren(svg);
      const ax = sv('g', { class: 'ax' }, svg), lw = tw('00:00', `500 11px ${font()}`) + 10;
      let step = 60; while ((hi - lo) / step * lw > pw) step += 60;
      let lastR = -1e9;
      for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) { const X = x(m); sv('line', { class: 'gl', x1: X, x2: X, y1: top, y2: top + rowsD.length * rh }, ax); const L = Math.max(0, Math.min(pw - lw + 10, X - (lw - 10) / 2)); if (L < lastR + 6) continue; const t = sv('text', { x: L, y: H - 8 }, ax); t.textContent = K.hhmm(m); lastR = L + lw - 10; }
      const targets = [];
      rowsD.forEach((r, k) => {
        const c = col(r.P), cy = top + k * rh + rh / 2, bh = 14;
        if (r.qb) sv('rect', { x: x(r.qb[0]), y: cy - bh / 2, width: Math.max(2, x(r.qb[1]) - x(r.qb[0])), height: bh, rx: 4, fill: c, 'fill-opacity': .22, class: 'draw' }, svg);
        if (r.qw) sv('rect', { x: x(r.qw[0]), y: cy - bh / 2, width: Math.max(2, x(r.qw[1]) - x(r.qw[0])), height: bh, rx: 4, fill: c, 'fill-opacity': .22, class: 'draw' }, svg);
        sv('rect', { x: x(r.bed.v), y: cy - 4, width: Math.max(2, x(r.wake.v) - x(r.bed.v)), height: 8, rx: 4, fill: c, class: 'draw tap' }, svg).style.setProperty('--k', k * 8);
        sv('line', { x1: x(r.mid.v), x2: x(r.mid.v), y1: cy - 9, y2: cy + 9, stroke: css('--ink'), 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
        const t = sv('text', { x: pw + 10, y: cy + 4, class: 'reflab' }, svg); t.textContent = r.P.short; t.style.fill = css('--ink-2');
        targets.push({ r, cy });
      });
      const hit = sv('rect', { class: 'hit', x: 0, y: top, width: pw, height: rowsD.length * rh, tabindex: 0 }, svg);
      const pick = ev => { const rc = svg.getBoundingClientRect(), sc = rc.width / W, k = Math.max(0, Math.min(rowsD.length - 1, Math.floor(((ev.clientY - rc.top) / sc - top) / rh))), r = rowsD[k];
        showTip(ev.clientX, rc.top + targets[k].cy * sc - 10, r.P.name, [{ v: fmtClock(r.bed.v), l: 'average bedtime', c: col(r.P) }, { v: fmtClock(r.mid.v), l: 'midpoint' }, { v: fmtClock(r.wake.v), l: 'average wake time' }, ...(r.qb ? [{ v: `${fmtClock(r.qb[0])}–${fmtClock(r.qb[1])}`, l: 'middle half of bedtimes' }] : [])], `${r.bed.n} nights recorded`); };
      hit.addEventListener('pointermove', pick); hit.addEventListener('pointerdown', pick); hit.addEventListener('pointerleave', hideTip);
    });
    return B.c;
  }
  // every night, one column per person, rows aligned by date so the same night sits side by side
  function nightsCard(view, p, list) {
    const e = Math.min(p.b, LAST), a0 = Math.max(p.a, 0), weekly = e - a0 > 400;
    const med = arr => { const v = arr.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
    const rowsIdx = weekly ? buckets('week', a0, e) : Array.from({ length: e - a0 + 1 }, (_, j) => ({ s: a0 + j, e: a0 + j }));
    const cols = list.map(P => { const s = st(P); return { P, r: rowsIdx.map(bk => { if (!weekly) return { bed: s.get('sl_bed', bk.s), wake: s.get('sl_wake', bk.s), asl: s.get('sl_asleep', bk.s) }; const ix = []; for (let i = bk.s; i <= bk.e; i++) ix.push(i); return { bed: med(ix.map(i => s.get('sl_bed', i))), wake: med(ix.map(i => s.get('sl_wake', i))), asl: s.win('sl_asleep', bk.s, bk.e).v }; }) }; })
      .filter(c => c.r.filter(x => x.bed != null).length >= 3);
    if (!cols.length) return null;
    const def = { t: 'Every night, side by side', dir: 0, dirText: 'Regular is better', ex: `Each line is ${weekly ? 'one week (the typical night of that week)' : 'one night'}, from falling asleep to waking, oldest at the top. Rows line up by date, so the same ${weekly ? 'week' : 'night'} sits at the same height for everyone. Gaps are ${weekly ? 'weeks' : 'nights'} with no sleep recorded.` };
    const B = band(def, css('--ink-3'));
    const h = el('div', 'hero'); h.appendChild(el('div', 'lab', 'Typical night · ' + periodLabel(view, p))); B.rail.appendChild(h);
    const FL = DEF.sl_asleep.floor;
    rows(B.rail, cols.map(c => { const w = c.r.filter(x => x.bed != null), under = weekly ? null : w.filter(x => x.asl != null && x.asl < FL).length; return { l: dotName(c.P), v: `${fmtClock(med(w.map(x => x.bed)))}–${fmtClock(med(w.map(x => x.wake)))}`, x: el('span', 'd', under == null ? `${w.length} weeks` : `${under} under ${hTxt(FL)}`) }; })).classList.add('crows');
    const b = chartBox(); B.main.appendChild(b);
    B.main.appendChild(personLegend(cols.map(c => c.P)));
    mount(b, bx => {
      const n = rowsIdx.length, W = Math.max(bx.clientWidth, 260), lab = n <= 14 ? 58 : 46, gapC = 14, top = 26, nc = cols.length;
      const cw = (W - lab - gapC * (nc - 1)) / nc, ph = Math.max(150, Math.min(360, n * 9)), rh = ph / n, H = top + ph + 24;
      const beds = cols.flatMap(c => c.r.map(x => x.bed)).filter(v => v != null).sort((x, y) => x - y), wakes = cols.flatMap(c => c.r.map(x => x.wake)).filter(v => v != null).sort((x, y) => x - y);
      const qv = (v, f) => v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))];
      let lo = Math.floor((qv(beds, .02) - 20) / 60) * 60, hi = Math.ceil((qv(wakes, .98) + 20) / 60) * 60;
      if (hi - lo < 540) { const mid = (hi + lo) / 2; lo = Math.floor((mid - 270) / 60) * 60; hi = lo + 540; }
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Every night, by person' }); bx.replaceChildren(svg);
      const ax = sv('g', { class: 'ax' }, svg), bad = css('--bad'), FLOOR = DEF.sl_asleep.floor, fl = `500 11px ${font()}`;
      const step = cw < 150 ? Math.max(240, Math.ceil((hi - lo) / 2 / 60) * 60) : cw < 260 ? 240 : 180;
      cols.forEach((c, k) => {
        const ox = k * (cw + gapC), x = m => ox + Math.max(0, Math.min(cw, (m - lo) / (hi - lo) * cw)), color = col(c.P);
        const t = sv('text', { x: ox, y: 14, style: `font:650 12px ${font()}` }, svg); t.textContent = c.P.name; t.style.fill = color;
        let lastR = -1e9;
        for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) { const X = x(m); sv('line', { class: 'gl', x1: X, x2: X, y1: top, y2: top + ph }, ax); const w = tw('00:00', fl), L = Math.max(ox, Math.min(ox + cw - w, X - w / 2)); if (L < lastR + 4) continue; const tt = sv('text', { x: L, y: top + ph + 16 }, ax); tt.textContent = K.hhmm(m); lastR = L + w; }
        const g = sv('g', {}, svg), gap = rh > 5 ? 1.2 : 0, hh = Math.max(.8, rh - gap);
        c.r.forEach((r, j) => { if (r.bed == null || r.wake == null) return; const X0 = x(r.bed), X1 = x(r.wake); sv('rect', { class: 'tap', x: X0, y: top + j * rh + gap / 2, width: Math.max(1, X1 - X0), height: hh, rx: Math.min(3, hh / 2), fill: color, 'fill-opacity': .88 }, g).style.setProperty('--k', j); });
      });
      let lastY = -99;
      rowsIdx.forEach((bk, j) => { const d = dt(bk.s), Y = top + j * rh + rh / 2; const first = weekly ? d.getUTCDate() <= 7 : n <= 14 || j === 0 || (n <= 62 ? d.getUTCDay() === 1 : d.getUTCDate() === 1); if (!first || Y - lastY < 14) return; const t = sv('text', { x: W - lab + 8, y: Y + 4 }, ax); t.textContent = n <= 14 ? `${K.WD[d.getUTCDay()]} ${d.getUTCDate()}` : weekly && d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : n <= 62 ? `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` : MON[d.getUTCMonth()]; lastY = Y; });
      const hl = sv('rect', { class: 'taphl', x: 0, y: -99, width: W - lab, height: Math.max(rh, 3), opacity: 0 }, svg);
      const hit = sv('rect', { class: 'hit', x: 0, y: top, width: W - lab, height: ph, tabindex: 0 }, svg);
      const at = j => { hl.setAttribute('y', top + j * rh + rh / 2 - Math.max(rh, 3) / 2); hl.setAttribute('opacity', 1); };
      const me = { show(day) { const j = rowsIdx.findIndex(r => day >= r.s - .5 && day <= r.e + .5); if (j < 0) return me.hide(); at(j); }, hide() { hl.setAttribute('opacity', 0); } };
      me.off = () => { me.hide(); hideTip(); K.syncOff(me); K.setActive(null, me); }; K.SYNC.push(me);
      const pick = ev => {
        const rc = svg.getBoundingClientRect(), sc = rc.width / W, j = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientY - rc.top) / sc - top) / rh))), bk = rowsIdx[j];
        at(j); K.setActive(me); K.syncTo(me, (bk.s + bk.e) / 2);
        showTip(ev.clientX, rc.top + (top + j * rh) * sc, weekly ? bucketLabel(bk, 'week') : dLong(bk.s), cols.map(c => { const r = c.r[j]; return r.bed == null ? { v: 'No sleep recorded', l: c.P.name, c: col(c.P) } : { v: `${fmtClock(r.bed)} → ${fmtClock(r.wake)}`, l: `${c.P.name} · ${fmtDurC(r.asl)}${!weekly && r.asl < FLOOR ? ' (under ' + hTxt(FLOOR) + ')' : ''}`, c: col(c.P) }; }));
      };
      hit.addEventListener('pointermove', pick); hit.addEventListener('pointerdown', pick);
      hit.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch') me.off(); }); hit.addEventListener('blur', () => me.off());
    });
    return B.c;
  }
  // stages: one 100% bar per person
  function stagesCard(view, p, list) {
    const e = Math.min(p.b, LAST), STG = STAGES.filter(([k]) => k !== 'unspec'), colors = Object.fromEntries(STG.map(s => [s[0], css(s[2])]));
    const def = { t: 'Sleep stages', dir: 0, dirText: 'No single target', ex: 'How an average night divides between stages, as a share of the sleep the Watch labelled with a stage. Typical adult ranges: deep about 10–20%, core 50–60%, REM 20–25%. Apple Watch estimates stages, so treat small differences as noise.' };
    const B = band(def, css('--ink-3'));
    const rowsD = list.map(P => { const v = STG.map(([k]) => st(P).win('sl_' + k, p.a, e).v || 0), T = v.reduce((a, b) => a + b, 0); return { P, v, T }; });
    const h = el('div', 'hero'); h.appendChild(el('div', 'lab', 'Share of the night · ' + periodLabel(view, p))); B.rail.appendChild(h);
    rows(B.rail, rowsD.map(r => ({ l: dotName(r.P), v: r.T ? `${nf(r.v[0] / r.T * 100)}% deep` : '–', x: el('span', 'd' + (r.T ? '' : ' why'), r.T ? `${nf(r.v[2] / r.T * 100)}% REM` : 'No stages recorded') }))).classList.add('crows');
    const box = el('div', 'stagebars');
    rowsD.forEach(r => {
      const row = el('div', 'sbrow'); row.appendChild(dotName(r.P));
      const bar = el('div', 'pbar');
      if (!r.T) bar.appendChild(el('div', 'none', 'No stages recorded'));
      else STG.forEach(([k, n], j) => { const f = r.v[j] / r.T; if (!f) return; const d = el('div'); d.style.flex = String(f); d.style.background = colors[k]; d.style.color = onColor(colors[k]); if (f > .1) d.textContent = nf(f * 100) + '%'; d.title = `${n}: ${fmtDur(r.v[j])} a night`; bar.appendChild(d); });
      row.appendChild(bar); box.appendChild(row);
    });
    B.main.append(box, legend(STG.map(([k, n]) => ({ t: n, c: colors[k] }))));
    return B.c;
  }

  // ------------------------------------------------------------ workouts
  function workoutsChapter(root, view, p) {
    const e = Math.min(p.b, LAST), a0 = Math.max(p.a, 0), list = vis(), total = daysIn(p);
    const ws = P => st(P).WK.filter(w => w.i >= a0 && w.i <= e);
    const per = list.map(P => { const w = ws(P); return { P, w, v: !P.noWk && (w.length || presDays(P, a0, e)) ? w.reduce((s, x) => s + x.min, 0) : null, n: w.length, why: P.noWk ? 'Not recorded' : why(P, a0, e, true) }; });
    const anyW = per.some(x => x.n);
    if (!anyW) { root.appendChild(el('div', 'missing', 'No workouts were recorded in this period by anyone shown.')); return; }
    const def = { key: '_workouts', t: 'Workout time', u: 'dur', dir: 1, ex: 'Minutes of recorded workouts. Common guidance is 150 minutes or more of moderate activity a week.' };
    {
      const B = band(def, css('--ink-3'));
      const h = el('div', 'hero'); h.appendChild(el('div', 'lab', 'Total time · ' + periodLabel(view, p))); B.rail.appendChild(h);
      rankRows(B.rail, def, per, { fmt: v => [fmtDurC(v), ''], cov: x => `${x.n} session${x.n === 1 ? '' : 's'}` });
      const sm = summary({ ...def, t: 'workouts' }, per, true); if (sm) B.rail.appendChild(el('p', 'cmpsum', sm));
      const b = chartBox(); B.main.appendChild(b);
      B.main.appendChild(personLegend(per.filter(x => x.v != null).map(x => x.P), [{ t: `Total each ${GNAME[CG[view]]}`, c: css('--ink-3') }]));
      mount(b, bx => {
        const gran = CG[view], bks = buckets(gran, p.a, p.b);
        const ser = list.filter(P => !P.noWk).map(P => { const w = st(P).WK; return { P, c: col(P), bv: bks.map(bk => { if (bk.s > LAST) return null; let m = 0, n = 0; w.forEach(x => { if (x.i >= bk.s && x.i <= bk.e) { m += x.min; n++; } }); return n ? m : (presDays(P, bk.s, bk.e) ? 0 : null); }) }; });
        const F = frame(bx, view, p, durDom(ser.flatMap(s => s.bv)), { yFmt: U.dur.ax, label: 'Workout time' }), targets = [];
        bks.forEach((bk, j) => {
          const cx = F.x((bk.s + bk.e) / 2), gw = Math.max(4, F.pxDay * (bk.e - bk.s + 1) * .74), bw = Math.max(1.5, Math.min(16, gw / ser.length - 2)), x0 = cx - (bw * ser.length + 2 * (ser.length - 1)) / 2;
          ser.forEach((s, k) => { const v = s.bv[j]; if (v) sv('path', { d: barPath(x0 + k * (bw + 2) + bw / 2, F.base, F.y(v), bw, Math.min(4, bw / 2)), fill: s.c, class: 'grow' }, F.g); });
          targets.push({ x: cx, bk, j });
        });
        hoverLayer(F, targets, (t, cx, cy) => showTip(cx, cy, bucketLabel(t.bk, gran), ser.map(s => ({ s, v: s.bv[t.j] })).sort((a, b) => (b.v ?? -1) - (a.v ?? -1)).map(({ s, v }) => ({ v: v == null ? 'No data' : v ? fmtDur(v) : 'No workouts', l: s.P.name, c: s.c }))));
      });
      root.appendChild(B.c);
    }
    {
      // by sport: who did what
      const c = plainCard('By sport', `${periodLabel(view, p)} · sessions and total time`);
      const who = per.filter(x => x.n).map(x => x.P);
      const byT = {}; per.forEach(x => x.w.forEach(w => { const o = byT[w.type] || (byT[w.type] = { min: 0 }); o.min += w.min; o[x.P.k] = o[x.P.k] || { n: 0, min: 0 }; o[x.P.k].n++; o[x.P.k].min += w.min; }));
      const sports = Object.entries(byT).sort((a, b) => b[1].min - a[1].min);
      const grid = el('div', 'cmptbl'); grid.style.setProperty('--n', who.length);
      const hd = el('div', 'ct-row ct-hd'); hd.appendChild(el('span', null, 'Sport')); who.forEach(P => hd.appendChild(dotName(P))); grid.appendChild(hd);
      sports.slice(0, 10).forEach(([t, o]) => {
        const r = el('div', 'ct-row'); r.appendChild(el('span', 'ct-m', t));
        const mx = Math.max(...who.map(P => o[P.k] ? o[P.k].min : 0));
        who.forEach(P => { const q = o[P.k], cell = el('span', 'ct-c'); if (q) { cell.append(el('b', null, fmtDurC(q.min)), el('small', null, `${q.n} session${q.n === 1 ? '' : 's'}`)); if (q.min === mx && who.filter(Q => o[Q.k]).length > 1) cell.classList.add('top'); } else cell.append(el('b', 'dim', '–')); cell.dataset.who = P.name; r.appendChild(cell); });
        grid.appendChild(r);
      });
      c.appendChild(grid);
      const left = per.filter(x => !x.n).map(x => x.P.name);
      c.appendChild(el('p', 'ct-note', [sports.length > 10 ? `${sports.length - 10} more sports not shown.` : '', left.length ? `No workouts in this period for ${left.join(' or ')}.` : '', 'A tinted cell is the most time in that sport.'].filter(Boolean).join(' ')));
      root.appendChild(c);
    }
  }

  // ------------------------------------------------------------ overview
  const H2H = [['steps', 'activity'], ['exercise', 'activity'], ['active', 'activity'], ['_workouts', 'workouts'], ['sl_asleep', 'sleep'], ['sl_bed', 'sleep'], ['sl_wake', 'sleep'],
    ['rhr', 'heart'], ['hrv', 'stress'], ['vo2max', 'heart'], ['walkSpeed', 'mobility'], ['daylight', 'env']];
  const H2HDEF = { _workouts: { key: '_workouts', t: 'Workout time, a week', u: 'dur', dir: 1 }, sl_bed: { key: 'sl_bed', t: 'Bedtime', u: 'clock', dir: 0, night: true }, sl_wake: { key: 'sl_wake', t: 'Wake-up', u: 'clock', dir: 0, night: true } };
  function h2hVal(P, k, a, e) {
    const s = st(P);
    if (k === '_workouts') { const d = presDays(P, a, e); if (P.noWk || d < 7) return { v: null, n: d, why: P.noWk ? 'No workouts in this export' : null }; return { v: s.WK.filter(w => w.i >= a && w.i <= e).reduce((t, w) => t + w.min, 0) * 7 / d, n: d }; }
    if (DEF[k] && DEF[k].k === 'points') { const q = (s.PTS[k] || []).filter(z => z.i >= a && z.i <= e); return { v: q.length ? q.reduce((t, z) => t + z.v, 0) / q.length : null, n: q.length, pts: true }; }
    return s.win(k, a, e);
  }
  function overview(root, view, p) {
    const e = Math.min(p.b, LAST), a0 = Math.max(p.a, 0), list = vis(), total = daysIn(p);
    coverageCard(root, p);
    // head to head
    { const sec = el('div', 'ovsec'); sec.append(el('h2', null, 'Head to head'), el('p', 'mono', `${periodLabel(view, p)} · averages over the days each person recorded${S.shared ? ', counting only days everyone recorded' : ''}`)); root.appendChild(sec); }
    const c = el('section', 'card cmpboard');
    const grid = el('div', 'cmptbl h2h'); grid.style.setProperty('--n', list.length);
    const hd = el('div', 'ct-row ct-hd'); hd.appendChild(el('span', null, 'Measure')); list.forEach(P => hd.appendChild(dotName(P))); grid.appendChild(hd);
    let shown = 0;
    for (const [k, ch] of H2H) {
      const def = H2HDEF[k] || DEF[k]; if (!def) continue;
      const vals = list.map(P => ({ P, ...h2hVal(P, k, a0, e) }));
      if (!vals.some(x => x.v != null)) continue;
      shown++;
      const have = vals.filter(x => x.v != null), dir = def.dir;
      const best = dir && have.length > 1 ? have.reduce((a, b) => (b.v - a.v) * dir > 0 ? b : a) : null;
      const tie = best && have.filter(x => U[def.u].c(x.v) === U[def.u].c(best.v)).length > 1;
      const r = el('button', 'ct-row'); r.type = 'button'; r.addEventListener('click', () => go(ch));
      const m = el('span', 'ct-m'); m.append(el('b', null, def.t), el('small', null, def.key === '_workouts' ? 'Higher is better' : K.dirText(def) || 'No single better direction')); r.appendChild(m);
      vals.forEach(x => {
        const cell = el('span', 'ct-c'); cell.dataset.who = x.P.name;
        if (x.v == null) { cell.append(el('b', 'dim', '–'), el('small', null, x.why || (k === '_workouts' && x.n ? 'Under a week of data' : why(x.P, a0, e)))); }
        else {
          const [a1, b1] = F1(def.u, x.v), v = el('b', null, a1); if (b1) v.appendChild(el('small', null, ' ' + b1)); cell.appendChild(v);
          const low = !x.pts && k !== '_workouts' && x.n / total < .5;
          cell.appendChild(el('small', low ? 'low' : '', x.pts ? `${x.n} reading${x.n === 1 ? '' : 's'}` : `${x.n} of ${total} ${def.night ? 'nights' : 'days'}`));
          if (best === x && !tie) cell.classList.add('top');
        }
        r.appendChild(cell);
      });
      grid.appendChild(r);
    }
    if (!shown) grid.appendChild(el('div', 'missing', 'Nobody shown has data in this period.'));
    c.appendChild(grid);
    c.appendChild(el('p', 'ct-note', 'A tinted cell is the better value where there is a generally better direction. Bedtime and wake-up have none. Grey day counts under half the period mean that average rests on few days.'));
    root.appendChild(c);
    targetsCmp(root, view, p);
  }
  // who has data when: one track per person across the whole shared timeline
  function coverageCard(root, p) {
    const c = plainCard('Who is in this comparison', 'Coloured where each export has data, month by month');
    const from = Math.max(...PEOPLE.map(P => P.D.from)), to = Math.min(...PEOPLE.map(P => P.D.to));
    const wrap = el('div', 'cov');
    PEOPLE.forEach(P => {
      const row = el('div', 'covrow' + (S.hide.has(P.k) ? ' off' : ''));
      const nm = dotName(P); nm.classList.add('covn');
      const rng = el('span', 'covr', `${MON[dt(P.D.from).getUTCMonth()]} ${dYr(P.D.from)} – ${dShort(P.D.to)}, ${dYr(P.D.to)} · ${nf(presDays(P, 0, LAST))} days`);
      const s = sv('svg', { class: 'covs', height: 18, 'aria-hidden': 'true' });
      row.append(nm, rng, s); wrap.appendChild(row);
      K.RENDER.push(() => {
        s.replaceChildren(); const W = Math.max(s.clientWidth || 300, 120), H = 18; s.setAttribute('viewBox', `0 0 ${W} ${H}`);
        const ms = buckets('month', 0, LAST), cw = W / ms.length, color = col(P);
        sv('rect', { x: 0, y: 7, width: W, height: 4, rx: 2, fill: css('--grid') }, s);
        ms.forEach((m, j) => { const f = presDays(P, m.s, m.e) / (m.e - m.s + 1); if (f > 0) sv('rect', { x: j * cw + .5, y: 2, width: Math.max(1, cw - 1), height: 14, rx: Math.min(3, cw / 3), fill: color, 'fill-opacity': (.25 + .75 * f).toFixed(2) }, s); });
        const pa = Math.max(p.a, 0), pb = Math.min(p.b, LAST);
        sv('rect', { x: pa / (LAST + 1) * W, y: 0, width: Math.max(2, (pb - pa + 1) / (LAST + 1) * W), height: H, rx: 4, fill: 'none', stroke: css('--ink'), 'stroke-width': 1.5 }, s);
      });
    });
    c.appendChild(wrap);
    c.appendChild(el('p', 'ct-note', from <= to ? `Everyone has data between ${dShort(from)}, ${dYr(from)} and ${dShort(to)}, ${dYr(to)}. The outlined box is the period on screen.` : 'These exports do not overlap in time, so no day has data from everyone. Charts still show each person where they have data.'));
    root.appendChild(c);
  }
  function targetsCmp(root, view, p) {
    const e = Math.min(p.b, LAST), a0 = Math.max(p.a, 0), list = vis();
    const lv = LEVERS.filter(L => L.id !== 'rhythm').map(L => ({ L, per: list.map(P => { let n = 0, h = 0; for (let i = a0; i <= e; i++) { const v = st(P).get(L.key, i); if (v == null) continue; n++; if (v >= L.target) h++; } return { P, n, h }; }) })).filter(x => x.per.some(y => y.n));
    if (!lv.length) return;
    const sec = el('div', 'ovsec'); sec.append(el('h2', null, 'Days on target'), el('p', 'mono', `${periodLabel(view, p)} · against the targets in Settings, as a share of the days each person recorded`)); root.appendChild(sec);
    const c = el('section', 'card cmptgt');
    lv.forEach(({ L, per }) => {
      const g = el('div', 'tg'); const hd = el('div', 'tgh'); hd.append(el('b', null, L.t), el('small', null, L.tl)); g.appendChild(hd);
      per.forEach(x => {
        const r = el('div', 'tgr'); r.appendChild(dotName(x.P));
        const tr = el('div', 'track'); const f = el('div', 'fill'); f.style.width = (x.n ? x.h / x.n * 100 : 0) + '%'; f.style.background = col(x.P); tr.appendChild(f); r.appendChild(tr);
        r.appendChild(el('span', 'm', x.n ? `${nf(x.h / x.n * 100)}% · ${x.h} of ${x.n} ${WORD(L)}` : why(x.P, a0, e)));
        g.appendChild(r);
      });
      c.appendChild(g);
    });
    root.appendChild(c);
  }

  // ------------------------------------------------------------ chapter head: people and the day rule
  function head(headEl) {
    const bar = el('div', 'cmpbar');
    const chips = el('div', 'pchips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'People shown');
    PEOPLE.forEach(P => {
      const b = el('button', 'pchip'); b.type = 'button'; b.setAttribute('aria-pressed', !S.hide.has(P.k)); b.title = S.hide.has(P.k) ? `Show ${P.name}` : `Hide ${P.name}`;
      b.style.setProperty('--pc', `var(${P.cvar})`); b.append(el('i'), el('span', null, P.name));
      b.addEventListener('click', () => { if (!S.hide.has(P.k) && vis().length <= 1) return; S.hide.has(P.k) ? S.hide.delete(P.k) : S.hide.add(P.k); render(); });
      chips.appendChild(b);
    });
    const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Which days count');
    [[false, 'All recorded days'], [true, 'Days everyone recorded']].forEach(([v, t]) => { const b = el('button', null, t); b.type = 'button'; b.setAttribute('aria-pressed', S.shared === v); b.addEventListener('click', () => { if (S.shared !== v) { S.shared = v; render(); } }); seg.appendChild(b); });
    bar.append(chips, seg);
    headEl.appendChild(bar);
  }

  const CARDS = {
    heart: [{ key: 'hrAvg', t: 'All-day heart rate', u: 'bpm', k: 'line', dir: 0, dirText: 'No single better direction', ex: 'The average of every heart rate reading through the day. It moves with how active the day was.' }, 'rhr', 'walkHr', 'vo2max', 'hrRecovery', 'highHr'],
    activity: ['steps', 'active', 'exercise', 'stand', 'distance', 'flights', 'cycling'],
  };
  function chapter(root, ch, view, p) {
    if (ch.id === 'overview') return overview(root, view, p);
    if (ch.id === 'sleep') return sleepChapter(root, view, p);
    if (ch.id === 'workouts') return workoutsChapter(root, view, p);
    const list = (CARDS[ch.id] || ch.cards || []).filter(x => !(x && x.range));
    const missing = renderCmpBands(root, list, view, p, ch.color);
    if (missing.length) root.appendChild(el('div', 'missing', 'Nobody shown recorded these in this period: ' + missing.join(', ') + '.'));
    if (!root.children.length) root.appendChild(el('div', 'missing', 'Nothing recorded in this period.'));
  }
  // the line under the chapter title says how this chapter's charts are drawn
  function ctxText(ch, view) {
    if (ch.id === 'overview') return S.shared ? 'Counting only days everyone recorded' : 'Each person counted over the days they recorded';
    if (ch.id === 'workouts') return `Bars: total workout time each ${GNAME[CG[view]]}, side by side`;
    if (view === 'W') return 'Each day, side by side';
    return `Lines: each person's trend, a weighted average of ${VC[view].tn} around each day`;
  }
  // the default period ends on the last day everyone has data, so the first view is a fair one
  const commonEnd = () => Math.max(0, Math.min(...PEOPLE.map(P => P.D.to)));
  return { head, chapter, ctxText, commonEnd, people: PEOPLE };
}
