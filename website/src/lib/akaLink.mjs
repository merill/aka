/**
 * @name akaLink.mjs
 * @description Shared validation and normalization for aka.ms link names.
 *
 * Deliberately dependency-free and framework-free: this exact file is imported
 * by the browser (the /add form), by the Cloudflare Pages Function, and by the
 * GitHub Action that drains submissions. Three consumers, one implementation —
 * which is the point. The previous PowerShell intake normalized link names one
 * way when checking for duplicates and a different way when writing the file,
 * so `AD/CA` never matched the existing `ad~ca.json` and silently created a
 * duplicate record.
 */

// Shared taxonomy, generated from getyako.com by build/scripts/sync-yako.mjs.
// akams.fyi and yako use one vocabulary so links group the same way on both.
export { CATEGORIES } from '../data/categories.mjs';
import { CATEGORIES } from '../data/categories.mjs';

const CATEGORY_VALUES = new Set(CATEGORIES.map((c) => c.value));

/** Route names that must never be claimed by a link page. */
export const RESERVED_NAMES = new Set([
  'about',
  'add',
  '404',
  'index',
  'sitemap',
  'sitemap-index',
  'robots',
  'opensearch',
  'commands',
  'img',
  'assets',
  '_astro',
  'api',
]);

/**
 * Reduce user input to a canonical link name.
 *
 * Accepts anything a person is likely to paste: a full URL, a bare name, with
 * or without scheme, with stray whitespace or slashes.
 *   'https://aka.ms/AD/CA'  -> 'ad/ca'
 *   '  aka.ms/Intune/  '    -> 'intune'
 */
export function normalizeLinkName(raw) {
  if (typeof raw !== 'string') return '';
  let name = raw.trim();

  // Strip the aka.ms prefix in any of the forms people paste it.
  name = name.replace(/^https?:\/\//i, '');
  name = name.replace(/^(www\.)?aka\.ms\//i, '');

  // Drop a query string or fragment picked up from a copied URL.
  name = name.replace(/[?#].*$/, '');

  // Collapse repeated slashes and trim them from both ends.
  name = name.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');

  return name.trim().toLowerCase();
}

/**
 * Config filename for a normalized name.
 * Nested links store the slash as `~`, e.g. 'ad/ca' -> 'ad~ca.json'.
 */
export function configFileName(name) {
  return `${name.replace(/\//g, '~')}.json`;
}

/** Inverse of configFileName: 'ad~ca.json' -> 'ad/ca'. */
export function linkNameFromFile(filename) {
  return filename.replace(/\.json$/i, '').replace(/~/g, '/').toLowerCase();
}

/**
 * Validate a normalized link name.
 * Returns an array of human-readable problems; empty means valid.
 */
export function validateLinkName(name) {
  const errors = [];

  if (!name) {
    errors.push('Enter an aka.ms link name.');
    return errors;
  }
  if (/\s/.test(name)) {
    errors.push('Link names cannot contain spaces.');
  }
  if (name.length > 100) {
    errors.push('Link names cannot be longer than 100 characters.');
  }
  // Letters, digits and - . _ / — the set the existing records actually use.
  // '#' is deliberately excluded: it only ever delimits a page fragment, and
  // one record had a fragment captured into its name (hierarchysettings).
  if (!/^[a-z0-9._/-]+$/.test(name)) {
    // Whitespace is already reported above; don't list it again as a bad char.
    const bad = [...new Set(name.replace(/[a-z0-9._/-]|\s/g, '').split(''))];
    if (bad.length) {
      errors.push(`Link names cannot contain: ${bad.join(' ')}`);
    }
  }
  if (RESERVED_NAMES.has(name)) {
    errors.push(`"${name}" is reserved by the site and cannot be used.`);
  }

  return errors;
}

/**
 * Resolve a category from either its value or its display label.
 *
 * The issue form shows friendly labels ("Microsoft 365") while records store
 * values ("microsoft-365"), and older submissions may still carry pre-migration
 * slugs. Accepting all three keeps a hand-filed issue from being rejected over
 * a formatting difference. Returns '' when there is no match.
 */
export function normalizeCategory(raw) {
  if (!raw) return '';
  const input = String(raw).trim();
  if (!input || /^(none|n\/a)$/i.test(input)) return '';

  if (CATEGORY_VALUES.has(input)) return input;

  const lower = input.toLowerCase();
  for (const c of CATEGORIES) {
    if (c.value === lower || c.label.toLowerCase() === lower) return c.value;
  }

  // Pre-migration slugs, so an old bookmark or a stale form still resolves.
  const LEGACY = {
    azuread: 'entra',
    microsoft365: 'microsoft-365',
    dynamics365: 'dynamics-365',
    powerplatform: 'power-platform',
    windows365: 'windows-365',
    sqlserver: 'sql-server',
    graph: 'developer',
    learn: 'training',
    security: 'defender',
  };
  return LEGACY[lower] || '';
}

/** True for anything meaning "no category" — blank, or the form's sentinel. */
function isNoCategory(raw) {
  return !raw || /^(none|n\/a)$/i.test(String(raw).trim());
}

/** Validate an optional category. Empty, and the "None" sentinel, are allowed. */
export function validateCategory(category) {
  if (isNoCategory(category)) return [];
  return normalizeCategory(category)
    ? []
    : [`"${category}" is not a known category.`];
}

/**
 * Find an existing record matching `name`.
 *
 * Compares normalized names rather than filenames, which is what the old
 * intake got wrong. `links` may be an array of records or of bare names.
 */
export function findDuplicate(name, links) {
  if (!name || !links) return null;
  const target = normalizeLinkName(name);
  for (const entry of links) {
    const candidate = typeof entry === 'string' ? entry : entry?.link;
    if (candidate && normalizeLinkName(candidate) === target) return entry;
  }
  return null;
}

/**
 * True when an aka.ms redirect target means "this short link does not exist".
 *
 * aka.ms answers unknown names with a Bing search rather than a 404, and the
 * Location header it sends has no path segment — `https://www.bing.com?ref=aka&
 * shorturl=x`, not `.../?ref=aka`. String-matching the latter (which is what
 * the previous PowerShell intake did) therefore never matched, so links that
 * do not exist passed validation. Parse the URL instead of pattern-matching it.
 */
export function isNotFoundRedirect(location) {
  if (!location) return true;

  let url;
  try {
    url = new URL(location);
  } catch {
    return true;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'bing.com') return false;

  // aka.ms tags its fallback with ref=aka; a link that genuinely points at Bing
  // would not carry that marker.
  return url.searchParams.get('ref') === 'aka' || /(^|[?&])ref=aka(&|$)/.test(url.search);
}

/** Page titles that carry no information and should not be stored. */
const USELESS_TITLES = new Set([
  'sign in to your account',
  'microsoft forms',
  'redirecting',
  '',
]);

/** Extract a usable <title>, or '' when there isn't one worth keeping. */
export function extractTitle(html) {
  if (typeof html !== 'string') return '';
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  const title = match[1]
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  return USELESS_TITLES.has(title.toLowerCase()) ? '' : title;
}
