/**
 * @name links.mjs
 * @description Build-time loader for the link records in website/config.
 *
 * Replaces buildscript/build.js, which generated a src/tableHome/commands.table.js
 * module as a prebuild step. Reading the directory directly means there is no
 * generated file to fall out of date — the old one was checked in holding 200
 * records while config/ held 1451, and `npm start` never regenerated it because
 * only a `prebuild` hook existed.
 *
 * Pure filesystem read: no network, no secrets, nothing that can fail a build
 * for reasons outside the repo.
 */

import {
  linkNameFromFile,
  normalizeLinkName,
  RESERVED_NAMES,
} from './akaLink.mjs';

/**
 * Every record in website/config, loaded by the bundler at build time.
 *
 * import.meta.glob rather than fs.readdirSync: this module gets bundled into
 * .prerender/chunks during `astro build`, so any path derived from
 * import.meta.url points at the output directory instead of the source tree.
 * The glob is resolved by Vite at transform time and behaves the same in dev
 * and in the build.
 */
const CONFIG_MODULES = import.meta.glob('../../config/*.json', {
  eager: true,
  import: 'default',
});

/** Icons that actually exist in public/img. */
const ICONS = new Set([
  'azure',
  'azuread',
  'defender',
  'dynamics365',
  'general',
  'github',
  'graph',
  'intune',
  'm365',
  'microsoft',
  'mypages',
]);

/**
 * Categories whose name differs from their icon file.
 *
 * `microsoft365` is the reason this map exists: custom.css defined a
 * `.cat-microsoft365` rule pointing at m365.svg, but the old build only
 * accepted a category when a same-named SVG existed, so all 45 microsoft365
 * records fell through to the generic icon and that CSS rule was dead code.
 */
const ICON_ALIASES = {
  microsoft365: 'm365',
  learn: 'microsoft',
};

/**
 * Pick the icon for a record.
 *
 * Domain sniffing wins over the declared category, because the category field
 * is null on 966 of 1452 records. Order matters and is a straight port of the
 * original chain, with one bug fixed: the dynamics check used a bare `if`
 * rather than `else if`, so it silently overrode the azuread and intune
 * branches above it.
 */
function resolveIcon(url, category) {
  const u = url || '';

  if (u.includes('entra.microsoft.com') || u.includes('/azure/active-directory')) {
    return 'azuread';
  }
  if (u.includes('intune.microsoft.com') || u.includes('/mem/intune')) {
    return 'intune';
  }
  if (
    u.includes('dynamics.com') ||
    u.includes('/dynamics365/') ||
    u.includes('dynamicspartners.transform.microsoft.com')
  ) {
    return 'dynamics365';
  }
  if (u.includes('github.com')) return 'github';
  if (u.includes('/graph/')) return 'graph';

  if (category) {
    const alias = ICON_ALIASES[category] || category;
    if (ICONS.has(alias)) return alias;
  }

  if (u.includes('learn.microsoft.com') || u.includes('docs.microsoft.com')) {
    return 'microsoft';
  }
  return 'general';
}

let cache = null;

/** All live link records, sorted by name. Memoized for the life of the build. */
export function getLinks() {
  if (cache) return cache;

  const links = [];
  const seen = new Map();

  for (const [filePath, json] of Object.entries(CONFIG_MODULES)) {
    const file = filePath.split('/').pop();

    // The daily crawl marks a record dead when aka.ms stops resolving it, and
    // only on a definitive not-found response — never on a network error — so
    // an aka.ms outage can't mass-retire the directory. Dead records stay on
    // the site, clearly labelled: roughly 17% of the directory no longer
    // resolves, and silently deleting that much is worse than showing it with
    // an honest notice. Their pages are noindex'd and excluded from the
    // sitemap so search engines drop them.

    // The filename is authoritative for the route; the `link` field has drifted
    // from it before (one record carried another record's name verbatim).
    // Normalized rather than taken verbatim: the same canonicalization the
    // /add form and the Function apply, so routes can't diverge from what a
    // submitter would be told their link is called.
    const name =
      normalizeLinkName(json.link || '') || linkNameFromFile(file);

    if (seen.has(name)) {
      throw new Error(
        `Duplicate link "${name}" in config/${file} and config/${seen.get(name)}`
      );
    }
    seen.set(name, file);

    links.push({
      link: name,
      // Human title wins, then the crawled one, then the name itself.
      title: json.title || json.autoCrawledTitle || name,
      hasRealTitle: Boolean(json.title || json.autoCrawledTitle),
      keywords: json.keywords || '',
      category: json.category || '',
      url: json.url || '',
      dateAdded: json.dateAdded || '',
      dateChecked: json.dateChecked || '',
      isDead: json.status === 'dead',
      icon: resolveIcon(json.url, json.category),
    });
  }

  links.sort((a, b) => a.link.localeCompare(b.link));
  cache = links;
  return links;
}

/** Records eligible for their own page (reserved route names excluded). */
export function getRoutableLinks() {
  return getLinks().filter((l) => {
    const first = l.link.split('/')[0];
    return !RESERVED_NAMES.has(l.link) && !RESERVED_NAMES.has(first);
  });
}

/** Newest-first by date added. */
export function getRecentLinks(count = 8) {
  return [...getLinks()]
    .filter((l) => l.dateAdded && !l.isDead)
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))
    .slice(0, count);
}

/** Destination hostname, or '' when the URL is unusable. */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Destination path split into segments, for similarity ranking. */
function pathSegments(url) {
  try {
    return new URL(url).pathname.toLowerCase().split('/').filter(Boolean);
  } catch {
    return [];
  }
}

/** How many leading path segments two URLs share. */
function sharedDepth(a, b) {
  const x = pathSegments(a);
  const y = pathSegments(b);
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
}

/**
 * Up to `count` related links, for internal linking between pages.
 *
 * Category first, but 966 of the 1452 records have no category at all, which
 * would leave two-thirds of the link pages with no outbound internal links —
 * and the internal linking is most of what makes a page of this size rank. So
 * fall back to links sharing a destination host, then to the same icon bucket.
 */
export function getRelatedLinks(link, count = 8) {
  const all = getLinks();
  const picked = [];
  const seen = new Set([link.link]);

  const add = (candidates) => {
    // Never recommend a retired link as a related one.
    for (const c of candidates.filter((c) => !c.isDead)) {
      if (picked.length >= count) return;
      if (seen.has(c.link)) continue;
      seen.add(c.link);
      picked.push(c);
    }
  };

  if (link.category) {
    add(all.filter((l) => l.category === link.category));
  }

  const host = hostOf(link.url);
  if (picked.length < count && host) {
    // Ranked by shared URL path rather than taken alphabetically: on a host as
    // broad as learn.microsoft.com, "same host" alone is barely a relationship,
    // whereas a shared /azure/active-directory/ prefix genuinely is.
    const sameHost = all
      .filter((l) => hostOf(l.url) === host)
      .map((l) => ({ l, depth: sharedDepth(link.url, l.url) }))
      .sort((a, b) => b.depth - a.depth || a.l.link.localeCompare(b.l.link))
      .map((x) => x.l);
    add(sameHost);
  }

  if (picked.length < count) {
    add(all.filter((l) => l.icon === link.icon));
  }

  return picked;
}

/** How `related` was derived, so the heading can describe it honestly. */
export function getRelatedLabel(link) {
  if (link.category) return `More ${link.category} links`;
  const host = hostOf(link.url);
  if (host) return `More links to ${host}`;
  return 'Related links';
}

/** Distinct categories present in the data. */
export function getUsedCategories() {
  return [...new Set(getLinks().map((l) => l.category).filter(Boolean))].sort();
}

/**
 * Compact search index shipped to the browser.
 *
 * Array-of-arrays rather than array-of-objects: repeating six keys across 1452
 * records is roughly 40% of the payload for no benefit.
 * Field order: [link, title, keywords, category, url, icon, dateAdded, dead]
 */
export function getSearchIndex() {
  return getLinks().map((l) => [
    l.link,
    l.title,
    l.keywords,
    l.category,
    l.url,
    l.icon,
    l.dateAdded ? l.dateAdded.slice(0, 10) : '',
    l.isDead ? 1 : 0,
  ]);
}

/**
 * Short token identifying this exact index, for cache-busting.
 *
 * /commands.json lives at a fixed URL, so a client fetching it with
 * force-cache would keep a stale copy indefinitely — new links would never
 * appear for a returning visitor, and a change to the row shape (as when the
 * retired flag was added) would silently degrade instead of failing loudly.
 * Appending this to the URL means the cache entry changes whenever the data
 * does, and never otherwise.
 */
export function getIndexVersion() {
  const rows = getSearchIndex();
  let h = 5381;
  const material = rows.length + '|' + JSON.stringify(rows);
  for (let i = 0; i < material.length; i++) {
    h = ((h << 5) + h + material.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Records that still resolve. */
export function getLiveLinks() {
  return getLinks().filter((l) => !l.isDead);
}
