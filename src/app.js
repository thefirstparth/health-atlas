// App shell: landing -> processing -> dashboard, settings, storage. No network calls anywhere.
import { mountDashboard, DEFAULT_TARGETS } from './dashboard.js';
import * as store from './store.js';
import { validateData } from './validate.js';

const $ = id => document.getElementById(id);
const VIEWS = ['landing', 'processing', 'app'];
let DATA = null, SET = { targets: { ...DEFAULT_TARGETS } }, dash = null, current = null, prevView = 'landing';

// The worker is created up front so every script is already loaded: after the page has loaded,
// reading a file works with the network switched off.
let worker = makeWorker();
function makeWorker() { return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }

function show(v) { current = v; VIEWS.forEach(k => { $(k).hidden = k !== v; }); window.scrollTo(0, 0); }
function toast(msg, ms = 3200) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB';
const units = () => SET.units || (DATA && DATA.meta.unitsHint) || (/^en-(US|LR|MM)$/.test(navigator.language || '') ? 'imperial' : 'metric');

function openDashboard() {
  if (dash) { dash.destroy(); dash = null; }
  show('app');
  dash = mountDashboard(DATA, { units: units(), targets: SET.targets });
}

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
      DATA = m.data;
      try { await store.set('data', DATA); store.persist(); } catch (e) { toast('Could not save in this browser; the data will be gone when you close the tab.', 6000); }
      openDashboard();
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      toast(merge ? `Added data up to ${fmtDay(m.fresh.end)}.` : `Read ${DATA.meta.days.toLocaleString()} day${DATA.meta.days === 1 ? '' : 's'} in ${secs} s.`);
    } else if (m.type === 'error') {
      fail(m.message);
    }
  };
  worker.onerror = e => { e.preventDefault(); fail('Something went wrong while reading this file.'); };
  worker.postMessage({ file, prev: merge ? DATA : null });
}
function setProgress(f, txt) {
  const p = Math.round(f * 100);
  $('procFill').style.width = p + '%'; $('procBar').setAttribute('aria-valuenow', p); $('procStat').textContent = txt;
}
function fail(msg) {
  resetWorker();
  if (prevView === 'app' && DATA) { openDashboard(); toast(msg, 7000); return; }
  show('landing'); $('err').textContent = msg; $('err').hidden = false;
}
function resetWorker() { worker.terminate(); worker = makeWorker(); }
const fmtDay = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

$('cancel').addEventListener('click', () => { resetWorker(); if (prevView === 'app' && DATA) openDashboard(); else show('landing'); });

// file input: one input, the "merge" flag decides what happens with the result
let mergeNext = false;
$('pick').addEventListener('click', () => { mergeNext = false; $('file').click(); });
$('file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; readFile(f, { merge: mergeNext && !!DATA }); });

// drag and drop, on the landing card or anywhere on the dashboard (which merges)
let dragDepth = 0;
addEventListener('dragenter', e => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; $('drop').classList.add('over'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('over'); } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('drop').classList.remove('over');
  if (current === 'processing') return;
  const f = e.dataTransfer.files[0]; if (f) readFile(f, { merge: current === 'app' && !!DATA });
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
  const m = DATA.meta, src = Object.keys(m.sources || {}).length;
  $('dataInfo').textContent = `${fmtDay(m.start)} – ${fmtDay(m.end)} · ${m.days.toLocaleString()} days${m.exportDate ? ` · export dated ${fmtDay(m.exportDate.slice(0, 10))}` : ''}${src ? ` · ${src} source${src > 1 ? 's' : ''}` : ''}. Stored only in this browser.`;
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
  try { await store.set('settings', SET); } catch (err) {}
  dlg.close(); openDashboard(); toast('Settings saved.');
});
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
  DATA = null; SET = { targets: { ...DEFAULT_TARGETS } };
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  show('landing'); toast('Deleted from this browser.');
});

// ---------------------------------------------------------------- boot
(async () => {
  const [d, s] = await Promise.all([store.get('data'), store.get('settings')]);
  if (s && s.targets) SET = { units: s.units, targets: { ...DEFAULT_TARGETS, ...s.targets } };
  if (d) { try { DATA = validateData(d); } catch (e) { DATA = null; } }
  if (DATA) openDashboard(); else show('landing');
})();
