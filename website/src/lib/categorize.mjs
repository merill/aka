/**
 * @name categorize.mjs
 * @description Suggest a category for a link from its destination and title.
 *
 * Used by the Verify button on /add: once the Function has resolved an aka.ms
 * link, it already knows the destination URL and the page title, which is
 * enough to make a good guess and save the submitter a decision.
 *
 * The guess is only ever a suggestion — the form pre-selects it and the user
 * can override. Confidence is returned so the UI can say how sure it is.
 */

import { CATEGORY_MAP } from '../data/yako-categories.mjs';
import { CATEGORIES } from '../data/categories.mjs';

const VALID = new Set(CATEGORIES.map((c) => c.value));

/**
 * Keyword rules, checked against the destination URL and the page title.
 *
 * Ordered most-specific first: "defender for cloud apps" must not be caught by
 * a looser Azure rule, and Entra beats a bare "azure" because the product was
 * renamed out of Azure AD.
 */
const RULES = [
  [/\bpurview\b|compliance\.microsoft\.com/, 'purview'],
  [/security\.microsoft\.com|\bdefender\b|\bmdatp\b|\bsentinel\b.*\bxdr\b/, 'defender'],
  [/\bsentinel\b|\bxdr\b/, 'xdr-sentinel'],
  [/entra\.microsoft\.com|\bentra\b|azure\/active-directory|\bazure ad\b|\baad\b/, 'entra'],
  [/intune\.microsoft\.com|\bintune\b|\/mem\/|endpoint\.microsoft\.com/, 'intune'],
  [/\bpowertoys\b/, 'powertoys'],
  [/\bwindows 365\b|windows365|\bcloud pc\b/, 'windows-365'],
  [/\bpower (bi|apps|automate|platform|pages)\b|powerplatform|make\.powerapps/, 'power-platform'],
  [/dynamics\.com|\/dynamics365\/|\bbusiness central\b|\bdynamics 365\b/, 'dynamics-365'],
  [/\bexchange\b|outlook\.office/, 'exchange'],
  [/\bsql server\b|\bsql database\b|\bazure sql\b/, 'sql-server'],
  [/admin\.microsoft\.com|\bmicrosoft 365\b|\bm365\b|\boffice 365\b|\bsharepoint\b|\bteams\b|\bonedrive\b/, 'microsoft-365'],
  [/portal\.azure\.com|azure\.microsoft\.com|\bazure\b/, 'azure'],
  [/\bgithub\b|\bapi\b|\bsdk\b|\bdeveloper\b|\bgraph\b|\brest\b/, 'developer'],
  [/\blicens|\bpricing\b|\bcost\b/, 'licensing'],
  [/\bstatus\b|\bhealth\b|\boutage\b|\bincident\b/, 'health-status'],
  [/\bpartner\b|\bmsp\b|\bcsp\b/, 'partner'],
  [/\btrial\b|\bfree trial\b/, 'trials'],
  [/\bcertification\b|\bcertified\b|\bexam\b/, 'certification'],
  [/\btraining\b|\blearn\b|\bcourse\b|\btutorial\b|learn\.microsoft\.com/, 'training'],
  [/\beducation\b|\bstudent\b|\bschool\b|\bteacher\b/, 'education'],
];

/**
 * Hosts that serve many unrelated products, where "what host is this?" says
 * nothing useful about the category. learn.microsoft.com skews to whatever
 * yako happens to catalogue most (certification), and github.com to training —
 * both actively misleading. For these, only an exact URL match or the keyword
 * rules are trusted.
 */
const GENERIC_HOSTS = new Set([
  'learn.microsoft.com',
  'docs.microsoft.com',
  'github.com',
  'microsoft.github.io',
  'microsoft.com',
  'aka.ms',
  'go.microsoft.com',
  'techcommunity.microsoft.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'support.microsoft.com',
  'azure.microsoft.com',
]);

function hostAndPath(url) {
  try {
    const u = new URL(url);
    return [
      u.hostname.toLowerCase().replace(/^www\./, ''),
      u.pathname.replace(/\/$/, '').toLowerCase(),
    ];
  } catch {
    return ['', ''];
  }
}

/**
 * Best-guess category for a resolved link.
 * Returns { category, confidence, reason } — category is '' when unsure.
 */
export function suggestCategory(url, title = '') {
  const [host, pathname] = hostAndPath(url);
  if (!host) return { category: '', confidence: 'none', reason: '' };

  // 1. This exact URL is already catalogued by yako — but only trust it when
  //    the match includes a real path. An "exact" match on a bare host root is
  //    just a host match wearing a disguise, and inherits its unreliability:
  //    yako catalogues portal.azure.com under Entra because of a deep blade
  //    link, which would mis-suggest Entra for the Azure portal itself.
  const exact = CATEGORY_MAP.exact[host + pathname];
  if (exact && VALID.has(exact) && pathname) {
    return { category: exact, confidence: 'high', reason: 'this exact link is catalogued' };
  }

  // 2. Read the URL path and the page title. Deliberately ahead of the
  //    host lookup: the path is far more specific than the host, and a bare
  //    host match on a broad domain is usually wrong.
  const haystack = `${url} ${title}`.toLowerCase();
  for (const [re, category] of RULES) {
    if (VALID.has(category) && re.test(haystack)) {
      return {
        category,
        confidence: 'medium',
        reason: 'based on the destination and page title',
      };
    }
  }

  // 3. A root-URL match from step 1, now that the keyword rules have had a go.
  if (exact && VALID.has(exact)) {
    return { category: exact, confidence: 'low', reason: `links to ${host}` };
  }

  // 4. Last resort: the host is overwhelmingly one category, and isn't one of
  //    the broad ones where that signal means nothing.
  const byHost = CATEGORY_MAP.hosts[host];
  if (byHost && VALID.has(byHost) && !GENERIC_HOSTS.has(host)) {
    return { category: byHost, confidence: 'low', reason: `links to ${host}` };
  }

  return { category: '', confidence: 'none', reason: '' };
}
