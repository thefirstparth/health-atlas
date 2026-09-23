// node test/run-node.mjs <export.zip|export.xml> <out.json>
import fs from 'node:fs';
import { parseExport } from '../src/parser.js';
const [,, src, out] = process.argv;
const blob = await fs.openAsBlob(src);
const t = Date.now();
const data = await parseExport(blob, { generated: 'test', onProgress: (f) => process.stderr.write(`\r${(f * 100).toFixed(0)}%`) });
process.stderr.write('\n');
fs.writeFileSync(out, JSON.stringify(data));
console.log(`${((Date.now() - t) / 1000).toFixed(1)}s days ${data.meta.days} keys ${Object.keys(data.daily).length} workouts ${data.workouts.length} rss ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)}MB`);
