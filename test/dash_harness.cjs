// Shared helpers: open the app with a dataset already stored, so tests skip the upload.
async function openWith(page, dataJson, settings) {
  await page.goto('http://localhost:8123/');
  await page.waitForSelector('#landing:not([hidden]), #app:not([hidden])');
  await page.evaluate(async ([d, st]) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('health-atlas', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = rej; });
    await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(JSON.parse(d), 'data'); t.objectStore('kv').put(st, 'settings'); t.oncomplete = res; });
    try { localStorage.clear(); } catch (e) {}
  }, [dataJson, settings || { units: 'metric', targets: { sleep: 420, sleepFloor: 360, steps: 8000, exercise: 30, daylight: 30 } }]);
  await page.reload(); await page.waitForSelector('#app:not([hidden]) .ch-head');
}
module.exports = { openWith };
