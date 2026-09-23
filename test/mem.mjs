import fs from 'node:fs';
import { parseExport } from '../src/parser.js';
const blob = await fs.openAsBlob(process.argv[2]);
let peak = 0; const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 50);
await parseExport(blob, { generated: 'x', beforeAssemble: A => { gc(); console.log('retained heap before assemble', (process.memoryUsage().heapUsed / 2 ** 20).toFixed(0), 'MB; cum entries', A.cum.size); } });
clearInterval(iv); console.log('peak heap sampled', (peak / 2 ** 20).toFixed(0), 'MB');
