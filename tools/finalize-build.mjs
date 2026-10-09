import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const index = await readFile(new URL('../dist/index.html', import.meta.url));
const workerPath = new URL('../dist/sw.js', import.meta.url);
const source = await readFile(workerPath, 'utf8');
const version = createHash('sha256').update(index).update(source).digest('hex').slice(0, 16);
if (!source.includes('operation-shell-v1')) throw new Error('Service worker cache marker is missing');
await writeFile(workerPath, source.replace('operation-shell-v1', `operation-shell-${version}`));
console.log(`Offline shell cache: ${version}`);
