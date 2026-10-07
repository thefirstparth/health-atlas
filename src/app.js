// App shell: landing -> processing -> dashboard, settings, storage. No network calls anywhere.
import { mountDashboard, DEFAULT_TARGETS } from './dashboard.js';
import * as store from './store.js';
import { validateData } from './validate.js';
import { sampleData, samplePeople } from './sample.js';

const $ = id => document.getElementById(id);
const VIEWS = ['landing', 'processing', 'app'];
let DATA = null, DEMO = null, CMP = null, SET = { targets: { ...DEFAULT_TARGETS } }, dash = null, current = null, prevView = 'landing';
const Q = new URLSearchParams(location.search), EMBED = Q.has('embed');
if (EMBED) document.documentElement.classList.add('embed');

// The worker is created up front so every script is already loaded: after the page has loaded,
// reading a file works with the network switched off. (Not needed inside the home page's live demo.)
let worker = EMBED ? null : makeWorker();
function makeWorker() { return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }

function show(v) { current = v; VIEWS.forEach(k => { $(k).hidden = k !== v; }); window.scrollTo(0, 0); }
function toast(msg, ms = 3200) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB';
// CMP: a comparison of two or three people, { people: [{ name, data } | { name, own: true }], demo? }.
// "own" means your own stored data, so a newer export of yours flows into the comparison too.
const cmpPeople = () => CMP ? CMP.people.map(x => ({ name: x.name, data: x.own ? DATA : x.data })).filter(x => x.data) : [];
const shown = () => DEMO || (CMP && cmpPeople()[0] ? cmpPeople()[0].data : null) || DATA;
const units = () => SET.units || (shown() && shown().meta.unitsHint) || (/^en-(US|LR|MM)$/.test(navigator.language || '') ? 'imperial' : 'metric');
const listNames = a => a.length < 3 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

function openDashboard() {
  if (dash) { dash.destroy(); dash = null; }
  if (CMP && cmpPeople().length < 2) CMP = null;
  show('app');
  $('demoBar').hidden = !DEMO || EMBED;
  $('cmpBar').hidden = !CMP || EMBED;
  $('shareBtn').hidden = !!CMP;
  if (CMP) {
    const t = $('cmpBarTxt'); t.replaceChildren();
    const b = document.createElement('b'); b.textContent = CMP.demo ? 'Sample people.' : 'Comparing'; t.append(b, ' ' + (CMP.demo ? `${listNames(CMP.people.map(x => x.name))} are made up, so you can look around.` : listNames(CMP.people.map(x => x.name)) + '.'));
    $('cmpEdit').hidden = !!CMP.demo;
    dash = mountDashboard(null, { people: cmpPeople(), units: units(), targets: SET.targets, ephemeral: !!CMP.demo });
  } else dash = mountDashboard(DEMO || DATA, { units: units(), targets: SET.targets, ephemeral: !!DEMO });
}
// Sample data: a made-up person, never stored, never mixed with your own data.
function openDemo() { DEMO = sampleData(); CMP = null; openDashboard(); }
function closeDemo() {
  DEMO = null; try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (DATA) openDashboard(); else { if (dash) { dash.destroy(); dash = null; } show('landing'); }
}
$('demoExit').addEventListener('click', () => { if (DATA) closeDemo(); else { closeDemo(); mergeNext = false; $('file').click(); } });
$('demoTry').addEventListener('click', () => { try { history.replaceState(null, '', '?demo'); } catch (e) {} openDemo(); });

// ---------------------------------------------------------------- reading a file
function readFile(file, { merge = false } = {}) {
  if (!file) return;
  prevView = current === 'processing' ? prevView : current || 'landing';
  $('err').hidden = true;
  $('procFile').textContent = `${file.name} · ${mb(file.size)}`;
  $('procTitle').textContent = /\.json$/i.test(file.name) ? 'Opening your saved copy' : merge ? 'Adding your newer export' : 'Reading your export';
  setProgress(0, 'Opening the file…');
  show('processing');
  const started = Date.now();
  worker.onmessage = async ({ data: m }) => {
    if (m.type === 'progress') {
      if (m.stage === 'assembling') setProgress(1, 'Putting the days together…');
      else setProgress(m.f, `${Math.floor(m.f * 100)}% read`);
    } else if (m.type === 'done') {
      DATA = m.data; DEMO = null; try { if (location.search) history.replaceState(null, '', location.pathname); } catch (e) {}
      try { await store.set('data', DATA); store.persist(); } catch (e) { toast('Could not save in this browser; the data will be gone when you close the tab.', 6000); }
      openDashboard();
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      toast(merge ? `Added data up to ${fmtDay(m.fresh.end)}.` : `Read ${DATA.meta.days.toLocaleString()} day${DATA.meta.days === 1 ? '' : 's'} in ${secs} s.`);
    } else if (m.type === 'error') {
      fail(m.message);
    }
  };
  worker.onerror = e => { e.preventDefault(); fail('Something went wrong while reading this file.'); };
  if (!worker) worker = makeWorker();
  worker.postMessage({ file, prev: merge && DATA ? DATA : null });
}
function setProgress(f, txt) {
  const p = Math.round(f * 100);
  $('procFill').style.width = p + '%'; $('procBar').setAttribute('aria-valuenow', p); $('procStat').textContent = txt;
}
function fail(msg) {
  resetWorker();
  if (prevView === 'app' && (DATA || DEMO)) { openDashboard(); toast(msg, 7000); return; }
  show('landing'); $('err').textContent = msg; $('err').hidden = false;
}
function resetWorker() { if (worker) worker.terminate(); worker = makeWorker(); }
const fmtDay = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

$('cancel').addEventListener('click', () => { if (cmpCancel) { cmpCancel(); return; } resetWorker(); if (prevView === 'app' && (DATA || DEMO)) openDashboard(); else show('landing'); });

// file input: one input, the "merge" flag decides what happens with the result
let mergeNext = false;
$('pick').addEventListener('click', () => { mergeNext = false; $('file').click(); });
$('file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; readFile(f, { merge: mergeNext && !!DATA && !DEMO }); });

// drag and drop, on the landing card or anywhere on the dashboard (which merges)
let dragDepth = 0;
addEventListener('dragenter', e => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; $('drop').classList.add('over'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('over'); } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('drop').classList.remove('over');
  if (current === 'processing') return;
  const fs = [...e.dataTransfer.files];
  if (fs.length > 1 || $('cmp').open || CMP) { openCmpDialog(fs); return; }
  const f = fs[0]; if (f) readFile(f, { merge: current === 'app' && !!DATA && !DEMO && !CMP });
});
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');

// ---------------------------------------------------------------- settings
const dlg = $('settings'), form = $('setForm');
let pendingUnits = null;
$('menuBtn').addEventListener('click', () => {
  pendingUnits = units();
  const t = { ...DEFAULT_TARGETS, ...SET.targets };
  form.sleep.value = t.sleep / 60; form.sleepFloor.value = t.sleepFloor / 60;
  form.steps.value = t.steps; form.exercise.value = t.exercise; form.daylight.value = t.daylight;
  syncUnitSeg();
  const demo = !!DEMO || !!(CMP && CMP.demo);
  $('setForm').classList.toggle('demo', demo);
  $('setForm').classList.toggle('cmp', !!CMP);
  if (demo) $('dataInfo').textContent = 'You are looking at sample data from made-up people. Settings you change here are not saved.';
  else if (CMP) $('dataInfo').textContent = `Comparing ${listNames(CMP.people.map(x => x.name))}. Their exports are kept only in this browser until you end the comparison.`;
  const m = DATA && DATA.meta, src = m ? Object.keys(m.sources || {}).length : 0;
  if (!demo && !CMP && m) $('dataInfo').textContent = `${fmtDay(m.start)} – ${fmtDay(m.end)} · ${m.days.toLocaleString()} days${m.exportDate ? ` · export dated ${fmtDay(m.exportDate.slice(0, 10))}` : ''}${src ? ` · ${src} source${src > 1 ? 's' : ''}` : ''}. Stored only in this browser.`;
  disarm();
  dlg.showModal();
});
function syncUnitSeg() { $('unitSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.u === pendingUnits)); }
$('unitSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { pendingUnits = b.dataset.u; syncUnitSeg(); } });
$('resetTargets').addEventListener('click', () => {
  const t = DEFAULT_TARGETS; form.sleep.value = t.sleep / 60; form.sleepFloor.value = t.sleepFloor / 60;
  form.steps.value = t.steps; form.exercise.value = t.exercise; form.daylight.value = t.daylight;
});
$('setCancel').addEventListener('click', () => dlg.close());
form.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.submitter && e.submitter.value === 'cancel') { dlg.close(); return; }
  if (!form.reportValidity()) return;
  const sleep = Math.round(+form.sleep.value * 60), floor = Math.round(+form.sleepFloor.value * 60);
  if (floor > sleep) { form.sleepFloor.setCustomValidity('Must not be above the sleep target'); form.reportValidity(); form.sleepFloor.setCustomValidity(''); return; }
  SET = { units: pendingUnits, targets: { sleep, sleepFloor: floor, steps: +form.steps.value, exercise: +form.exercise.value, daylight: +form.daylight.value } };
  if (!DEMO && !(CMP && CMP.demo)) { try { await store.set('settings', SET); } catch (err) {} }
  dlg.close(); openDashboard(); toast('Settings saved.');
});
// ---------------------------------------------------------------- poster
const pdlg = $('poster'); let pYear = null, pTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', pBlob = null, pUrl = null;
async function drawPoster() {
  if (!dash) return;
  if (document.fonts && document.fonts.load) { try { await document.fonts.load('750 40px Figtree'); } catch (e) {} }
  const cv = dash.renderPoster(pYear, pTheme);
  pBlob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (pUrl) URL.revokeObjectURL(pUrl); pUrl = URL.createObjectURL(pBlob); $('posterImg').src = pUrl;
  $('posterYears').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.y === pYear));
  $('posterTheme').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === pTheme));
  const file = new File([pBlob], `health-atlas-${pYear}.png`, { type: 'image/png' });
  $('posterShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
}
$('shareBtn').addEventListener('click', () => {
  const ys = dash ? dash.posterYears() : []; if (!ys.length) { toast('Not enough data for a poster yet.'); return; }
  if (!ys.includes(pYear)) pYear = ys[ys.length - 1];
  const box = $('posterYears'); box.replaceChildren();
  ys.slice(-4).forEach(y => { const b = document.createElement('button'); b.type = 'button'; b.dataset.y = y; b.textContent = y; b.addEventListener('click', () => { pYear = y; drawPoster(); }); box.appendChild(b); });
  pdlg.showModal(); drawPoster();
});
$('posterTheme').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { pTheme = b.dataset.t; drawPoster(); } });
$('posterClose').addEventListener('click', () => pdlg.close());
pdlg.addEventListener('click', e => { if (e.target === pdlg) pdlg.close(); });
$('posterSave').addEventListener('click', () => { if (!pUrl) return; const a = document.createElement('a'); a.href = pUrl; a.download = `health-atlas-${pYear}.png`; document.body.appendChild(a); a.click(); a.remove(); });
$('posterShare').addEventListener('click', async () => { try { await navigator.share({ files: [new File([pBlob], `health-atlas-${pYear}.png`, { type: 'image/png' })], title: `My ${pYear} in health` }); } catch (e) {} });

$('addExport').addEventListener('click', () => { dlg.close(); mergeNext = true; $('file').click(); });
$('saveJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(DATA)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `health-atlas-${DATA.meta.end}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
let armT = null;
function disarm() { clearTimeout(armT); const b = $('forget'); b.classList.remove('armed'); b.textContent = 'Forget my data'; }
$('forget').addEventListener('click', async () => {
  const b = $('forget');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again to delete'; armT = setTimeout(disarm, 4000); return; }
  disarm(); dlg.close();
  await store.forget();
  if (dash) { dash.destroy(); dash = null; }
  DATA = null; CMP = null; SET = { targets: { ...DEFAULT_TARGETS } };
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  show('landing'); toast('Deleted from this browser.');
});

// ---------------------------------------------------------------- compare with friends
// Two or three exports, each named. Files are read one after another by the same worker as your own.
const MAXP = 3, cdlg = $('cmp');
let SLOTS = [], pickAt = 0, cmpCancel = null;
function validateCompare(c) {
  if (!c || !Array.isArray(c.people) || c.people.length < 2 || c.people.length > MAXP) throw new Error('compare');
  return { people: c.people.map(x => { if (!x || typeof x.name !== 'string' || !x.name.trim() || x.name.length > 40) throw new Error('name'); return x.own ? { name: x.name, own: true } : { name: x.name, data: validateData(x.data) }; }) };
}
function openCmpDemo() { DEMO = null; CMP = { demo: true, people: samplePeople() }; openDashboard(); }
function endCompare() {
  const wasDemo = CMP && CMP.demo; CMP = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (!wasDemo) store.del('compare');
  if (DATA) openDashboard(); else { if (dash) { dash.destroy(); dash = null; } show('landing'); }
}
// a name from the file, unless it is the generic "export.zip" every iPhone produces
const nameFromFile = f => { const n = f.name.replace(/\.(zip|xml|json)$/i, '').replace(/[_-]+/g, ' ').trim(); return !n || /export|health|atlas|^\d/i.test(n) ? '' : n.slice(0, 24); };
function openCmpDialog(files = [], keep = false) {
  if (!cdlg.open && !keep) {
    $('cmpErr').hidden = true;
    SLOTS = CMP && !CMP.demo ? CMP.people.map(x => ({ name: x.name, own: !!x.own, data: x.own ? null : x.data }))
      : DATA ? [{ name: 'You', own: true }, { name: '' }] : [{ name: '' }, { name: '' }];
  }
  addFiles(files, SLOTS.findIndex(x => !x.own && !x.file && !x.data));
  renderSlots();
  if (!cdlg.open) cdlg.showModal();
}
function addFiles(files, at) {
  for (const f of files) {
    if (at < 0 || at >= SLOTS.length) { if (SLOTS.length >= MAXP) { cmpError(`Up to ${MAXP} people at a time. ${f.name} was left out.`); break; } SLOTS.push({ name: '' }); at = SLOTS.length - 1; }
    const sl = SLOTS[at]; sl.file = f; sl.own = false; sl.data = null; if (!sl.name) sl.name = nameFromFile(f);
    at = SLOTS.findIndex((x, k) => k > at && !x.own && !x.file && !x.data);
  }
}
function cmpError(msg) { $('cmpErr').textContent = msg; $('cmpErr').hidden = !msg; }
function renderSlots() {
  const ol = $('cslots'); ol.replaceChildren();
  SLOTS.forEach((sl, k) => {
    const li = document.createElement('li'); li.className = 'cslot'; li.style.setProperty('--pc', `var(--p-${k + 1})`);
    const sw = document.createElement('i'); sw.className = 'sw'; sw.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('input'); nm.type = 'text'; nm.maxLength = 24; nm.placeholder = k === 0 && sl.own ? 'You' : `Person ${k + 1}`; nm.value = sl.name; nm.setAttribute('aria-label', `Name for person ${k + 1}`); nm.autocomplete = 'off';
    nm.addEventListener('input', () => { sl.name = nm.value; });
    const fb = document.createElement('button'); fb.type = 'button'; fb.className = 'cfile' + (sl.own || sl.file || sl.data ? ' set' : '');
    const big = document.createElement('b'), small = document.createElement('small');
    if (sl.own) { big.textContent = 'Your data in this browser'; small.textContent = DATA ? `${DATA.meta.days.toLocaleString()} days · tap to use a file instead` : ''; }
    else if (sl.file) { big.textContent = sl.file.name; small.textContent = `${mb(sl.file.size)} · tap to change`; }
    else if (sl.data) { big.textContent = 'Already read'; small.textContent = `${sl.data.meta.days.toLocaleString()} days · tap to replace`; }
    else { big.textContent = 'Choose export'; small.textContent = '.zip, .xml or saved .json'; }
    fb.append(big, small);
    fb.addEventListener('click', () => { pickAt = k; $('cmpFile').click(); });
    const x = document.createElement('button'); x.type = 'button'; x.className = 'cx'; x.setAttribute('aria-label', `Remove person ${k + 1}`); x.title = 'Remove';
    x.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    x.addEventListener('click', () => { if (SLOTS.length > 2) SLOTS.splice(k, 1); else SLOTS[k] = { name: '' }; renderSlots(); });
    li.append(sw, nm, fb, x); ol.appendChild(li);
  });
  $('cmpAdd').hidden = SLOTS.length >= MAXP;
}
$('cmpTry').addEventListener('click', () => openCmpDialog());
$('cmpFromSettings').addEventListener('click', () => { dlg.close(); openCmpDialog(); });
$('cmpEdit').addEventListener('click', () => openCmpDialog());
$('cmpEnd').addEventListener('click', endCompare);
$('cmpClose').addEventListener('click', () => cdlg.close());
cdlg.addEventListener('click', e => { if (e.target === cdlg) cdlg.close(); });
$('cmpAdd').addEventListener('click', () => { if (SLOTS.length < MAXP) { SLOTS.push({ name: '' }); renderSlots(); } });
$('cmpDemo').addEventListener('click', () => { cdlg.close(); try { history.replaceState(null, '', '?demo=compare'); } catch (e) {} openCmpDemo(); });
$('cmpFile').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; cmpError(''); addFiles(fs, pickAt); renderSlots(); });
$('cmpForm').addEventListener('submit', async e => {
  e.preventDefault();
  const ready = SLOTS.filter(x => x.own || x.file || x.data);
  if (ready.length < 2) return cmpError('Choose at least two exports to compare.');
  ready.forEach(x => { x.name = (x.name || '').trim() || (x.own ? 'You' : `Person ${SLOTS.indexOf(x) + 1}`); });
  const lower = ready.map(x => x.name.toLowerCase());
  if (new Set(lower).size < lower.length) return cmpError('Give each person a different name, so the charts can tell them apart.');
  cdlg.close();
  runCompare(ready);
});
// read the new files one by one, then check nobody was added twice
function parseOne(file, label, k, n) {
  return new Promise((res, rej) => {
    $('procFile').textContent = `${file.name} · ${mb(file.size)}`;
    $('procTitle').textContent = `Reading ${label}’s export` + (n > 1 ? ` (${k} of ${n})` : '');
    setProgress(0, 'Opening the file…'); show('processing');
    cmpCancel = () => rej(new Error('cancelled'));
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') setProgress(m.f, m.stage === 'assembling' ? 'Putting the days together…' : `${Math.floor(m.f * 100)}% read`);
      else if (m.type === 'done') res(m.data); else if (m.type === 'error') rej(new Error(m.message));
    };
    worker.onerror = ev => { ev.preventDefault(); rej(new Error('Something went wrong while reading this file.')); };
    worker.postMessage({ file, prev: null });
  });
}
const fingerprint = d => { const st = (d.daily.steps || []).reduce((t, v) => t + (v || 0), 0); return `${d.meta.start}|${d.meta.end}|${d.meta.days}|${Math.round(st)}|${d.workouts.length}`; };
async function runCompare(slots) {
  const back = current === 'processing' ? prevView : current || 'landing', todo = slots.filter(x => x.file);
  let k = 0;
  try {
    for (const sl of todo) { k++; sl.data = await parseOne(sl.file, sl.name, k, todo.length); sl.file = null; }
  } catch (err) {
    cmpCancel = null; resetWorker();
    if (back === 'app' && dash) show('app'); else if (back === 'app') openDashboard(); else show('landing');
    if (err.message === 'cancelled') return;
    openCmpDialog([], true); cmpError(`${slots.find(x => x.file) ? slots.find(x => x.file).name : 'One export'}: ${err.message}`); return;
  }
  cmpCancel = null;
  const prints = slots.map(x => fingerprint(x.own ? DATA : x.data));
  for (let a = 0; a < prints.length; a++) for (let b = a + 1; b < prints.length; b++) if (prints[a] === prints[b]) {
    if (back === 'app' && dash) show('app'); else show('landing');
    openCmpDialog([], true); cmpError(`${slots[a].name} and ${slots[b].name} look like the same export. Choose a different file for one of them.`); return;
  }
  CMP = { people: slots.map(x => x.own ? { name: x.name, own: true } : { name: x.name, data: x.data }) };
  DEMO = null; try { if (location.search) history.replaceState(null, '', location.pathname); } catch (e) {}
  try { await store.set('compare', CMP); store.persist(); } catch (e) { toast('Could not save in this browser; the comparison will be gone when you close the tab.', 6000); }
  openDashboard(); toast(`Comparing ${listNames(CMP.people.map(x => x.name))}.`);
}

// ---------------------------------------------------------------- boot
(async () => {
  const [d, s, c] = EMBED ? [null, null, null] : await Promise.all([store.get('data'), store.get('settings'), store.get('compare')]);
  if (s && s.targets) SET = { units: s.units, targets: { ...DEFAULT_TARGETS, ...s.targets } };
  if (d) { try { DATA = validateData(d); } catch (e) { DATA = null; } }
  if (c) { try { CMP = validateCompare(c); } catch (e) { CMP = null; } }
  if (EMBED || Q.has('demo')) Q.get('demo') === 'compare' && !EMBED ? openCmpDemo() : openDemo();
  else if (DATA || (CMP && cmpPeople().length > 1)) openDashboard(); else show('landing');
})();
