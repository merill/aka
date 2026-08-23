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

// The icon library behind getyako.com/ms/*. Its own manifest is the only place
// the full product list exists.
const ICONS_MANIFEST_URL =
  'https://raw.githubusercontent.com/DanielBradley1/msicons/main/msicons/src/data/icons.json';

/**
 * Icon groups that are UI glyph sets rather than product marks.
 *
 * These account for 1,662 of the library's 2,454 icons — "airplane filled",
 * "Settings Dark", "Arrow Circle Left (Dark Purple)". Fine as iconography,
 * meaningless as link categories.
 */
const UI_GLYPH_GROUPS = new Set([
  'fabric',
  'microsoft',
  'microsoft teams',
  'planner',
  'new icons',
]);

/** Search aliases, so the picker finds a category by what people call it. */
const ALIASES = {
  entra: 'aad azure ad active directory identity sso conditional access mfa',
  intune: 'mem endpoint manager mdm device management autopilot',
  defender: 'atp mdatp security antivirus edr threat',
  'xdr-sentinel': 'siem soar log analytics kql hunting',
  purview: 'compliance dlp information protection labels retention',
  'microsoft-365': 'm365 office 365 sharepoint teams onedrive exchange outlook',
  azure: 'arm subscription resource portal cloud',
  'power-platform': 'power apps automate bi pages virtual agents dataverse',
  'dynamics-365': 'crm erp business central',
  developer: 'api sdk graph rest github devops code',
  training: 'learn docs tutorial course mslearn',
  'health-status': 'outage incident uptime service health',
};
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

/** Collapse colour/BW/filled variants of one product to a single name. */
function baseProductName(name) {
  return name
    .replace(/\s*\((product family|dark purple|light|dark|gray)\)\s*$/i, '')
    .replace(/\s*(color|bw|filled|regular|scalable|old)\s*icon\s*$/i, '')
    .replace(/\s*(color|bw|filled|regular)\s*$/i, '')
    .trim();
}

/**
 * msicons path -> a URL that actually serves the image.
 *
 * Not getyako.com: it only hosts the ~291 icons its own portals reference, and
 * returns a 200 HTML SPA fallback for anything else — so a status-code check
 * passes while the browser fails to decode it. jsDelivr serves the whole repo
 * with a correct image/svg+xml content type.
 */
const ICON_CDN = 'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public';

function iconUrlFor(iconPath) {
  if (!iconPath) return '';
  const encoded = iconPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${ICON_CDN}${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

/**
 * Product-level categories derived from the icon library.
 *
 * `taken` holds the curated values already claimed; a curated group always
 * wins a name collision, since those are the coarse buckets existing records
 * use.
 */
async function productCategories(taken) {
  const res = await fetch(ICONS_MANIFEST_URL);
  if (!res.ok) throw new Error(`${ICONS_MANIFEST_URL} -> HTTP ${res.status}`);
  const icons = await res.json();

  const best = new Map();
  for (const icon of icons) {
    if (UI_GLYPH_GROUPS.has(icon.category)) continue;
    const label = baseProductName(icon.name);
    if (!label || label.length < 2) continue;

    const lower = icon.name.toLowerCase();
    const rank =
      (lower.includes('color') ? 0 : 100) +
      (/\b(bw|filled|old)\b/.test(lower) ? 10 : 0) +
      Math.min(icon.name.length, 9);
    const prev = best.get(label);
    if (!prev || rank < prev.rank) best.set(label, { rank, icon });
  }

  const out = [];
  for (const [label, { icon }] of [...best].sort((a, b) => a[0].localeCompare(b[0]))) {
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!value || taken.has(value)) continue;
    taken.add(value);
    out.push({ value, label, iconUrl: iconUrlFor(icon.path), group: icon.category });
  }
  return out;
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
  // Icon per category, chosen by hand rather than by plurality.
  //
  // Deriving it from "which icon do most links in this category use" produced
  // confidently wrong results — Defender got a generic report glyph, Microsoft
  // 365 an Azure power icon — and picked the black-and-white Entra product
  // family mark over the full-colour Entra ID one. Colour variants are
  // preferred throughout; every URL here was verified to resolve.
  //
  // Categories absent from this map get no icon at all. A missing icon is
  // better than a misleading one: plurality was giving "Other" and "Third
  // party" the Azure logo.
  const CATEGORY_ICONS = {
    'entra':            'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/entra/Microsoft%20Entra%20ID%20color%20icon.svg',
    'intune':           'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/intune/Microsoft-intune.svg',
    'defender':         'https://getyako.com/ms/logos/defender/defender-512.png',
    'xdr-sentinel':     'https://getyako.com/ms/logos/microsoft-sentinel/10248-icon-service-azure-sentinel.svg',
    'purview':          'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/fabric/purview_color.svg',
    'microsoft-365':    'https://getyako.com/ms/logos/microsoft-365/microsoft-365-620x620-(white-background).png',
    'azure':            'https://getyako.com/ms/logos/azure/azure-256x256-padded.png',
    'power-platform':   'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/power-platform/03335-icon-service-Power-Platform.svg',
    'dynamics-365':     'https://getyako.com/ms/logos/dynamics-365/dynamics365-scalable.svg',
    'exchange':         'https://getyako.com/ms/logos/exchange/2019-current-full-color/exchange-256x256.png',
    'windows-365':      'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/other/00327-icon-service-Azure-Virtual-Desktop.svg',
    'sql-server':       'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/databases/10132-icon-service-SQL-Server.svg',
    'developer':        'https://getyako.com/ms/logos/azure-devops/10261-icon-service-azure-devops.svg',
    'licensing':        'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/general/10002-icon-service-Subscriptions.svg',
    'partner':          'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/integration/02265-icon-service-Partner-Registration.svg',
    'trials':           'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/general/10016-icon-service-Free-Services.svg',
    'health-status':    'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/general/10004-icon-service-Service-Health.svg',
    'my-pages':         'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/management-governance/00014-icon-service-My-Customers.svg',
    'training':         'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/general/10816-icon-service-Learn.svg',
    'certification':    'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/management-governance/00026-icon-service-Education.svg',
    'education':        'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/management-governance/00026-icon-service-Education.svg',
    'consumer':         'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/intune/10332-icon-service-Devices.svg',
    'regional':         'https://cdn.jsdelivr.net/gh/DanielBradley1/msicons@main/msicons/public/icons/general/10116-icon-service-Region-Management.svg',
  };
  const iconForCategory = (label) => {
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return CATEGORY_ICONS[value] || '';
  };

  const curated = ordered.map((label) => {
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const iconUrl = iconForCategory(label);
    const entry = { value, label, common: true };
    if (iconUrl) entry.iconUrl = iconUrl;
    if (ALIASES[value]) entry.keywords = ALIASES[value];
    return entry;
  });

  // Curated groups first — they are what most links belong to and what the
  // homepage filter shows. The full product list follows, so a submitter can
  // pick something precise without the common cases being buried.
  const taken = new Set(curated.map((c) => c.value));
  const products = await productCategories(taken);
  const categories = [...curated, ...products];

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

  // --- URL -> category, for suggesting one on the /add form ---------------
  const catExact = {};
  const catHostTally = {};
  for (const e of entries) {
    const c = normalizeCategory(e.category);
    if (!c) continue;
    const [host, pth] = hostAndPath(e.url);
    if (!host) continue;
    const value = c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const key = host + pth;
    if (!(key in catExact)) catExact[key] = value;
    catHostTally[host] = catHostTally[host] || {};
    catHostTally[host][value] = (catHostTally[host][value] || 0) + 1;
  }
  const catHosts = {};
  for (const [host, tally] of Object.entries(catHostTally)) {
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((n, [, c]) => n + c, 0);
    // Same caution as icons: only trust a host when one category clearly wins.
    if (sorted[0][1] / total >= 0.6) catHosts[host] = sorted[0][0];
  }

  const out = {
    categories: path.join(dataDir, 'categories.mjs'),
    icons: path.join(dataDir, 'yako-icons.json'),
  };

  console.log(`Categories : ${categories.length} (${curated.length} curated + ${products.length} products)`);
  console.log(`  curated: ${curated.map((c) => c.label).join(', ')}`);
  console.log(`Icons      : ${Object.keys(exact).length} exact, ${Object.keys(hosts).length} host-level`);
  console.log(`Cat map    : ${Object.keys(catExact).length} exact, ${Object.keys(catHosts).length} host-level`);
  console.log(`Cat icons  : ${categories.filter((c) => c.iconUrl).length}/${categories.length} categories have one`);

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
  // ESM, not JSON, for the same reason as categories.mjs: categorize.mjs is
  // imported by the Cloudflare Function and by plain Node, and a bare JSON
  // import needs an import attribute in Node but not in Vite/esbuild.
  fs.writeFileSync(
    path.join(dataDir, 'yako-categories.mjs'),
    '// Generated by build/scripts/sync-yako.mjs — do not edit by hand.\n' +
      'export const CATEGORY_MAP = ' +
      JSON.stringify({ exact: catExact, hosts: catHosts }, null, 2) +
      ';\n'
  );

  // Keep the issue form's dropdown in step with the taxonomy. It drifted once
  // already: the form still offered pre-migration slugs that validateCategory
  // had started rejecting, so a hand-filed issue picking "azuread" would fail.
  const templatePath = path.join(repoRoot, '.github/ISSUE_TEMPLATE/add-link.yaml');
  const template = fs.readFileSync(templatePath, 'utf8');
  // Curated groups only. GitHub renders a dropdown, and 697 options is not a
  // usable one — the in-browser picker at /add is where the full product list
  // belongs, because it can filter as you type.
  const optionLines = [
    '        - None',
    ...curated.map((c) => `        - ${c.label}`),
  ].join('\n');
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
