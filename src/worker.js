// Runs the parser off the main thread. Messages in: {file, prev?} or {vault: {files, pass}, prev?}.
// Out: progress | done | error.
import { parseExport, mergeData } from './parser.js';
import { validateData, trimTimeline } from './validate.js';
import { readVaultFiles, openSealed, vaultDataset, combine, VaultError } from './vault.js';

// A health vault: decrypt every file here, then lay its days onto the Apple export it carries (or onto what
// this browser already holds). The passphrase never leaves this worker and is not kept.
async function openVault({ files, pass }, prev) {
  const got = await readVaultFiles(files), total = got.months.length + (got.apple ? 1 : 0);
  let n = 0; const step = () => self.postMessage({ type: 'progress', f: ++n / (total + 1), stage: 'decrypting' });
  const apple = got.apple ? await openSealed(got.apple, pass) : null; if (apple) step();
  const months = []; for (const t of got.months) { months.push(await openSealed(t, pass)); step(); }
  let base = apple && apple.data ? validateData(apple.data) : prev ? validateData(prev) : null;
  if (base) { delete base.meta.dob; delete base.meta.sex; base = trimTimeline(base); }
  const data = combine(base, vaultDataset(months), { merge: mergeData, vaultMonths: months.length, hasApple: !!apple });
  return trimTimeline(validateData(data));
}

self.onmessage = async ({ data: msg }) => {
  const { file, prev } = msg;
  try {
    if (msg.vault) {
      const data = await openVault(msg.vault, prev);
      self.postMessage({ type: 'done', data, fresh: { start: data.meta.start, end: data.meta.end }, vault: data.meta.vault });
      return;
    }
    let data;
    if (/\.json$/i.test(file.name || '')) {
      data = validateData(JSON.parse(await file.text()));
    } else {
      const isZip = /\.zip$/i.test(file.name || '') ? true : /\.xml$/i.test(file.name || '') ? false : undefined;
      let last = 0;
      data = await parseExport(file, { isZip, onProgress: (f, stage) => { const t = Date.now(); if (t - last > 120 || f === 1) { last = t; self.postMessage({ type: 'progress', f, stage }); } } });
      if (!data) throw new Error('This export has no health data we can chart yet.');
    }
    // Keep only what the charts use: date of birth and sex are read by the parser but never stored.
    delete data.meta.dob; delete data.meta.sex;
    data = trimTimeline(data);
    const merged = prev ? trimTimeline(mergeData(validateData(prev), data)) : data;
    self.postMessage({ type: 'done', data: merged, fresh: { start: data.meta.start, end: data.meta.end } });
  } catch (e) {
    self.postMessage({ type: 'error', message: friendly(e), vault: e instanceof VaultError });
  }
};

function friendly(e) {
  const m = (e && e.message) || String(e);
  if (/out of memory|allocation|RangeError: Invalid string length/i.test(m)) return 'Your device ran out of memory reading this export. Try on a computer, or close other tabs and try again.';
  if (/DecompressionStream|deflate/i.test(m)) return 'This browser cannot unzip the export. Unzip it first and choose export.xml, or use a current version of Safari, Chrome, Firefox or Edge.';
  return m;
}
