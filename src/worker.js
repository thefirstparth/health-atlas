// Runs the parser off the main thread. Messages in: {file, prev?}. Out: progress | done | error.
import { parseExport, mergeData } from './parser.js';
import { validateData } from './validate.js';

self.onmessage = async ({ data: msg }) => {
  const { file, prev } = msg;
  try {
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
    const merged = prev ? mergeData(validateData(prev), data) : data;
    self.postMessage({ type: 'done', data: merged, fresh: { start: data.meta.start, end: data.meta.end } });
  } catch (e) {
    self.postMessage({ type: 'error', message: friendly(e) });
  }
};

function friendly(e) {
  const m = (e && e.message) || String(e);
  if (/out of memory|allocation|RangeError: Invalid string length/i.test(m)) return 'Your device ran out of memory reading this export. Try on a computer, or close other tabs and try again.';
  if (/DecompressionStream|deflate/i.test(m)) return 'This browser cannot unzip the export. Unzip it first and choose export.xml, or use a current version of Safari, Chrome, Firefox or Edge.';
  return m;
}
