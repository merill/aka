/**
 * @name sync-yako.mjs
 * @description Pull the shared category taxonomy and icon map from yako.
 *
 * yako (getyako.com) publishes a prebuilt manifest combining cmd.ms commands
 * and msportals.io portals, with icons already resolved. Reusing it means
 * akams.fyi and yako speak one vocabulary instead of drifting apart.
 *
 * The output is committed rather than fetched at build time: a site build
 * should never fail because another site is down. Re-run this when yako's
 * taxonomy changes.
 *
 * Usage:
 *   node build/scripts/sync-yako.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_URL = 'https://getyako.com/data/portals.json';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(repoRoot, 'website/src/data');
const dryRun = process.argv.includes('--dry-run');

/**
 * msportals group names collapsed into category buckets, mirroring
 * MSPORTALS_CATEGORY_MAP in yako's catalog browser so both sites agree.
 */
const MSPORTALS_MAP = {
  'Microsoft 365 Admin Portals': 'Microsoft 365',
  'End User Portals - Microsoft 365 Apps': 'Microsoft 365',
  'End User Portals - Other Microsoft Apps': 'Microsoft 365',
  'End User Portals - General': 'Microsoft 365',
  'Azure Admin Portals': 'Azure',
  'Azure IT Admin Portals - Sub Portal Links': 'Azure',
  'Admin - Entra Portals': 'Entra',
  'Admin - AI Portals': 'AI',
  'Admin - Microsoft Licensing/Support Portals': 'Licensing',
  'Admin - Microsoft Defender / Security Portals': 'Defender',
  'Admin - Developer Portals': 'Developer',
  'Admin - Health / Status Portals': 'Health & Status',
  'Admin - Microsoft Partner / MSP Portals': 'Partner',
  'Admin - Microsoft Trials': 'Trials',
  'Admin - Other Useful Microsoft Portals': 'Other',
};

/** Prefix rules for the long-tail msportals group names. */
const PREFIX_RULES = [
  [/^US Gov/i, 'US Government'],
  [/^Consumer/i, 'Consumer'],
  [/Education|Student|Learning\/Training/i, 'Education'],
  [/^Main Training|^Other Training/i, 'Training'],
  [/Certification|Microsoft Certified/i, 'Certification'],
  [/Licensing/i, 'Licensing'],
  [/^Security/i, 'Defender'],
  [/China/i, 'Regional'],
  [/3rd Party|Non-Microsoft/i, 'Third party'],
  [/^Xbox/i, 'Consumer'],
  [/Accessability|Accessibility/i, 'Accessibility'],
];

/** Categories akams.fyi needs that yako has no equivalent for. */
const AKAMS_EXTRA = ['Dynamics 365', 'PowerToys', 'Windows 365', 'SQL Server', 'Exchange'];

/** Display order — the buckets people actually reach for come first. */
const ORDER = [
  'Entra', 'Intune', 'Defender', 'XDR Sentinel', 'Purview', 'Microsoft 365',
  'Azure', 'Power Platform', 'Dynamics 365', 'Exchange', 'Windows 365',
  'SQL Server', 'PowerToys', 'AI', 'Developer', 'Licensing', 'Partner',
  'Trials', 'Health & Status', 'My Pages', 'Training', 'Certification',
  'Education', 'Consumer', 'US Government', 'Regional', 'Accessibility',
  'Third party', 'Other', 'General',
];

function normalizeCategory(raw) {
  if (!raw) return null;
  if (MSPORTALS_MAP[raw]) return MSPORTALS_MAP[raw];
  for (const [re, bucket] of PREFIX_RULES) {
    if (re.test(raw)) return bucket;
  }
  return raw;
}

function hostAndPath(url) {
  try {
    const u = new URL(url);
    return [u.hostname.toLowerCase().replace(/^www\./, ''), u.pathname.replace(/\/$/, '').toLowerCase()];
  } catch {
    return ['', ''];
  }
}

async function main() {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`${MANIFEST_URL} -> HTTP ${res.status}`);
  const entries = await res.json();
  console.log(`Fetched ${entries.length} yako entries.`);

  // --- Categories -------------------------------------------------------
  const seen = new Set();
  for (const e of entries) {
    const c = normalizeCategory(e.category);
    if (c) seen.add(c);
  }
  for (const c of AKAMS_EXTRA) seen.add(c);

  const ordered = [
    ...ORDER.filter((c) => seen.has(c)),
    ...[...seen].filter((c) => !ORDER.includes(c)).sort(),
  ];
  const categories = ordered.map((label) => ({
    value: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    label,
  }));

  // --- Icons ------------------------------------------------------------
  // Exact host+path wins. Otherwise the plurality icon for a host, and only
  // when it is a clear winner — hosts like github.com and aka.ms serve many
  // unrelated products, and taking the first entry there produces confidently
  // wrong icons (a Learn glyph on every GitHub link).
  const exact = {};
  const hostTally = {};
  for (const e of entries) {
    if (!e.iconUrl) continue;
    const [host, pth] = hostAndPath(e.url);
    if (!host) continue;
    const key = host + pth;
    if (!(key in exact)) exact[key] = e.iconUrl;
    hostTally[host] = hostTally[host] || {};
    hostTally[host][e.iconUrl] = (hostTally[host][e.iconUrl] || 0) + 1;
  }

  const hosts = {};
  for (const [host, tally] of Object.entries(hostTally)) {
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((n, [, c]) => n + c, 0);
    if (sorted[0][1] / total >= 0.5) hosts[host] = sorted[0][0];
  }

  const out = {
    categories: path.join(dataDir, 'categories.mjs'),
    icons: path.join(dataDir, 'yako-icons.json'),
  };

  console.log(`Categories : ${categories.length}`);
  console.log(`  ${categories.map((c) => c.label).join(', ')}`);
  console.log(`Icons      : ${Object.keys(exact).length} exact, ${Object.keys(hosts).length} host-level`);

  if (dryRun) {
    console.log('[dry-run] nothing written.');
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });

  // Emitted as ESM rather than JSON because akaLink.mjs imports it from three
  // very different runtimes — the browser (Vite), the Cloudflare Function
  // (esbuild) and plain Node (the workflows). A .mjs module needs no import
  // attributes and behaves identically in all three.
  fs.writeFileSync(
    out.categories,
    '// Generated by build/scripts/sync-yako.mjs — do not edit by hand.\n' +
      '// Shared taxonomy, kept in step with getyako.com.\n' +
      'export const CATEGORIES = ' +
      JSON.stringify(categories, null, 2) +
      ';\n'
  );
  fs.writeFileSync(out.icons, JSON.stringify({ exact, hosts }, null, 2) + '\n');

  // Keep the issue form's dropdown in step with the taxonomy. It drifted once
  // already: the form still offered pre-migration slugs that validateCategory
  // had started rejecting, so a hand-filed issue picking "azuread" would fail.
  const templatePath = path.join(repoRoot, '.github/ISSUE_TEMPLATE/add-link.yaml');
  const template = fs.readFileSync(templatePath, 'utf8');
  const optionLines = ['        - None', ...categories.map((c) => `        - ${c.label}`)].join('\n');
  const updated = template.replace(
    /(    id: category[\s\S]*?      options:\n)(?:        - .*\n)+/,
    `$1${optionLines}\n`
  );
  if (updated !== template) {
    fs.writeFileSync(templatePath, updated);
    console.log('Issue template dropdown updated.');
  }

  console.log('Written to website/src/data/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
