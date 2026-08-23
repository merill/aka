/**
 * @name migrate-categories.mjs
 * @description One-off: move existing records onto yako's shared taxonomy.
 *
 * akams.fyi used ad-hoc lowercase slugs (azuread, microsoft365) that predate
 * the shared vocabulary. This maps them onto the categories in
 * website/src/data/categories.json so both sites group links the same way.
 *
 * Usage: node build/scripts/migrate-categories.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configDir = path.join(repoRoot, 'website/config');
const dryRun = process.argv.includes('--dry-run');

const { CATEGORIES } = await import(
  path.join(repoRoot, 'website/src/data/categories.mjs')
);
const valid = new Set(CATEGORIES.map((c) => c.value));

/** Old slug -> new category value. */
const MAP = {
  azuread: 'entra',
  azure: 'azure',
  intune: 'intune',
  defender: 'defender',
  security: 'defender',
  dynamics365: 'dynamics-365',
  microsoft365: 'microsoft-365',
  exchange: 'exchange',
  powertoys: 'powertoys',
  powerplatform: 'power-platform',
  windows365: 'windows-365',
  sqlserver: 'sql-server',
  graph: 'developer',
  learn: 'training',
};

const files = fs.readdirSync(configDir).filter((f) => f.toLowerCase().endsWith('.json'));
const counts = {};
const unmapped = new Set();
let changed = 0;

for (const file of files) {
  const full = path.join(configDir, file);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  const old = json.category;
  if (!old) continue;

  const next = MAP[old] ?? (valid.has(old) ? old : null);
  if (!next) {
    unmapped.add(old);
    continue;
  }
  if (next === old) continue;

  json.category = next;
  counts[`${old} → ${next}`] = (counts[`${old} → ${next}`] || 0) + 1;
  changed++;
  if (!dryRun) fs.writeFileSync(full, JSON.stringify(json, null, 2) + '\n');
}

console.log(`${dryRun ? '[dry-run] ' : ''}records remapped: ${changed}`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
if (unmapped.size) console.log('UNMAPPED (left alone):', [...unmapped].join(', '));
