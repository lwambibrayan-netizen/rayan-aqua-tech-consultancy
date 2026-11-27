import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const html = readFileSync('dist/index.html', 'utf8');
const match = html.match(/<script[^>]+src=["']([^"']+\\.js)["']/);
if (!match) throw new Error('Could not locate the initial JavaScript entry in dist/index.html.');

const assetPath = join('dist', match[1].replace(/^\\//, ''));
const rawBytes = statSync(assetPath).size;
const gzipBytes = gzipSync(readFileSync(assetPath), { level: 9 }).length;
const rawKiB = rawBytes / 1024;
const gzipKiB = gzipBytes / 1024;

console.log(`Initial JavaScript: ${rawKiB.toFixed(1)} KiB raw / ${gzipKiB.toFixed(1)} KiB gzip`);
console.log('Budget: 900 KiB raw / 300 KiB gzip');
if (rawBytes > 900 * 1024 || gzipBytes > 300 * 1024) {
  throw new Error('Initial JavaScript exceeds the agreed performance budget. Move specialist modules behind dynamic imports.');
}
