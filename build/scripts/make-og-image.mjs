/**
 * @name make-og-image.mjs
 * @description Render the Open Graph card for akams.fyi.
 *
 * Kept as a script rather than a hand-made asset so the card can be
 * regenerated when the branding or the link count changes. Uses sharp, which
 * Astro already depends on, so there is no new dependency.
 *
 * Usage: node build/scripts/make-og-image.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// sharp is a dependency of the site, not of this script's directory, so resolve
// it from website/ rather than relying on Node walking up from build/scripts.
const require = createRequire(path.join(repoRoot, 'website/package.json'));
const sharp = require('sharp');
const configDir = path.join(repoRoot, 'website/config');
const outFile = path.join(repoRoot, 'website/public/OpenGraphImage.png');

const W = 1200;
const H = 630;

/** Live count, rounded down to a round number so the card ages gracefully. */
function linkCount() {
  const n = fs.readdirSync(configDir).filter((f) => f.toLowerCase().endsWith('.json')).length;
  return Math.floor(n / 50) * 50;
}

const count = linkCount();

// Example links along the bottom — concrete beats abstract on a share card.
const samples = ['aka.ms/intune', 'aka.ms/entra', 'aka.ms/mfa', 'aka.ms/ad/ca'];

const pillWidth = (text) => text.length * 15 + 44;
let x = 90;
const pills = samples
  .map((text) => {
    const w = pillWidth(text);
    const el = `
      <g>
        <rect x="${x}" y="470" width="${w}" height="56" rx="28"
              fill="none" stroke="#3a4358" stroke-width="1.5"/>
        <text x="${x + 22}" y="506" font-family="Menlo, Consolas, monospace"
              font-size="24" fill="#9fb3d1">${text}</text>
      </g>`;
    x += w + 18;
    return el;
  })
  .join('');

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#16213a"/>
    </linearGradient>
    <linearGradient id="wordmark" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ff4ecd"/>
      <stop offset="70%" stop-color="#4f9bff"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#wordmark)"/>

  <text x="90" y="248" font-family="Helvetica, Arial, sans-serif"
        font-size="128" font-weight="bold" fill="url(#wordmark)">akams.fyi</text>

  <text x="94" y="322" font-family="Helvetica, Arial, sans-serif"
        font-size="40" fill="#e6ecf5">Search ${count}+ Microsoft aka.ms links</text>

  <text x="94" y="386" font-family="Helvetica, Arial, sans-serif"
        font-size="27" fill="#8fa3bf">Community-maintained · free · no sign-in to contribute</text>

  ${pills}
</svg>`;

const before = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;

await sharp(Buffer.from(svg))
  .png({ palette: true, quality: 90, effort: 10 })
  .toFile(outFile);

const after = fs.statSync(outFile).size;
const meta = await sharp(outFile).metadata();
console.log(`Wrote ${path.relative(repoRoot, outFile)}`);
console.log(`  ${meta.width}x${meta.height}, ${after} bytes (was ${before})`);
console.log(`  link count on card: ${count}+`);
