/**
 * POST /api/submit  — submit a new aka.ms link
 * GET  /api/submit  — live "does this resolve?" preview for the /add form
 *
 * This endpoint exists so that submitting a link needs no GitHub account. The
 * credential lives here, not with the visitor.
 *
 * It also does the one check the browser cannot: aka.ms serves no CORS headers,
 * so a page script has no way to tell a real short link from a dead one — a
 * no-cors fetch returns an opaque response with no readable status. Server-side
 * that restriction doesn't apply.
 *
 * Accepted submissions become a labelled GitHub issue. A scheduled workflow
 * drains all outstanding issues into a single commit, so a burst of
 * submissions costs one Pages build rather than one per link.
 */

import {
  normalizeLinkName,
  validateLinkName,
  validateCategory,
  normalizeCategory,
  isNotFoundRedirect,
  extractTitle,
} from '../../src/lib/akaLink.mjs';
import { suggestCategory } from '../../src/lib/categorize.mjs';

const DEFAULT_REPO = 'merill/aka';
const LABEL = 'add-link';

// Per-IP ceiling. Backed by the edge cache, so it is a speed bump rather than a
// guarantee (each colo counts separately). The real quota defence is the WAF
// rate-limiting rule on /api/*, which rejects before the Function is invoked
// and therefore never spends a request from the daily allowance.
const PER_IP_DAILY_MAX = 10;

// Ceiling across all submitters, so even a full bypass of the above cannot turn
// into an unbounded number of issues (and therefore commits and builds).
const GLOBAL_DAILY_MAX = 200;

const FETCH_TIMEOUT_MS = 6000;
const RESOLVE_CACHE_SECONDS = 3600;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const name = normalizeLinkName(url.searchParams.get('link') || '');

  const errors = validateLinkName(name);
  if (errors.length) {
    return json({ ok: false, message: errors[0] }, 400);
  }

  const resolved = await resolveCached(name);

  // Suggest a category from the destination and page title, so Verify can fill
  // it in for the submitter. Only ever a suggestion — the form pre-selects it
  // and the user can change it.
  const suggestion = resolved.ok
    ? suggestCategory(resolved.url, resolved.title)
    : { category: '', confidence: 'none', reason: '' };

  return json({ ...resolved, suggestion }, 200, {
    'cache-control': `public, max-age=${RESOLVE_CACHE_SECONDS}`,
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Expected a JSON body.' }, 400);
  }

  const name = normalizeLinkName(body.link || '');
  // Stored canonical, so a label or a legacy slug lands as the right value.
  const category = normalizeCategory(body.category);
  const titleOverride = clamp(body.title, 200);
  const keywords = clamp(body.keywords, 300);
  const submittedBy = clamp(body.submittedBy, 100);

  const errors = [...validateLinkName(name), ...validateCategory(category)];
  if (errors.length) {
    return json({ ok: false, message: errors[0] }, 400);
  }

  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  if (!token) {
    return json(
      { ok: false, message: 'Submissions are not configured on this deployment.' },
      503
    );
  }

  // Rate limits before any outbound work, so a flood is as cheap as possible.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipKey = await sha256(ip);
  const perIp = await bumpIpCount(ipKey);
  if (perIp > PER_IP_DAILY_MAX) {
    return json(
      {
        ok: false,
        message:
          "You've submitted a lot of links today. Please try again tomorrow, or open a pull request.",
      },
      429
    );
  }

  const gh = githubClient(token, repo);

  const openCount = await gh.countTodaysSubmissions();
  if (openCount >= GLOBAL_DAILY_MAX) {
    return json(
      { ok: false, message: 'akams.fyi is at its submission limit for today. Please try again tomorrow.' },
      429
    );
  }

  // Duplicate check against the published index rather than the repo tree: it
  // is a single edge-cached fetch, and it is the same data the form validated
  // against, so the two tiers cannot disagree.
  const existing = await isExistingLink(new URL(request.url).origin, name);
  if (existing) {
    return json(
      { ok: false, message: `aka.ms/${name} is already listed on akams.fyi.`, existing: name },
      409
    );
  }

  const resolved = await resolveCached(name);
  if (!resolved.ok) {
    return json({ ok: false, message: resolved.message }, 422);
  }

  const record = {
    link: name,
    title: titleOverride,
    autoCrawledTitle: resolved.title || '',
    keywords,
    category,
    url: resolved.url,
    dateAdded: new Date().toISOString(),
  };

  let issue;
  try {
    issue = await gh.createIssue({
      title: `Add: ${name}`,
      body: issueBody(record, submittedBy),
      labels: [LABEL],
    });
  } catch (err) {
    return json(
      { ok: false, message: 'Could not file the submission. Please try again shortly.' },
      502
    );
  }

  return json({
    ok: true,
    message: "It'll appear on the site within the hour, once the next publish runs.",
    issueUrl: issue.html_url,
    link: name,
  });
}

/** Anything other than GET/POST. */
export async function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'POST') return;
  return json({ ok: false, message: 'Method not allowed.' }, 405);
}

/* ------------------------------------------------------------------ */

/**
 * Follow aka.ms/<name> one hop and read the destination.
 * Unknown names redirect to a Bing search rather than returning 404.
 */
async function resolveAka(name) {
  let res;
  try {
    res = await withTimeout(
      fetch(`https://aka.ms/${encodeURI(name)}`, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'user-agent': 'akams.fyi-bot (+https://akams.fyi)' },
      })
    );
  } catch {
    return { ok: false, message: "Couldn't reach aka.ms just now. Try again in a moment." };
  }

  const location = res.headers.get('location');
  if (isNotFoundRedirect(location)) {
    return {
      ok: false,
      message: `aka.ms/${name} doesn't resolve — double-check the spelling.`,
    };
  }

  return { ok: true, url: location, title: await crawlTitle(location) };
}

/** Best-effort <title> of the destination. Never fails the submission. */
async function crawlTitle(url) {
  try {
    const res = await withTimeout(
      fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': 'akams.fyi-bot (+https://akams.fyi)',
          accept: 'text/html',
        },
      })
    );
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('text/html')) return '';
    // Only the head is needed; avoid pulling whole pages.
    return extractTitle((await res.text()).slice(0, 20000));
  } catch {
    return '';
  }
}

/** resolveAka behind the edge cache, so repeated keystrokes are nearly free. */
async function resolveCached(name) {
  const key = new Request(`https://aka-resolve.internal/${encodeURIComponent(name)}`);
  const cache = caches.default;

  const hit = await cache.match(key);
  if (hit) return hit.json();

  const result = await resolveAka(name);
  // Negative results are cached briefly so a typo storm doesn't hammer aka.ms,
  // but not for long — a link may legitimately start working.
  const ttl = result.ok ? RESOLVE_CACHE_SECONDS : 60;
  await cache.put(
    key,
    new Response(JSON.stringify(result), {
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${ttl}`,
      },
    })
  );
  return result;
}

/** Is this link already published? Reads the site's own search index. */
async function isExistingLink(origin, name) {
  try {
    const res = await withTimeout(fetch(`${origin}/commands.json`));
    if (!res.ok) return false;
    const index = await res.json();
    return index.some((row) => row[0] === name);
  } catch {
    // Never block a submission because the index was unreachable; the drain
    // workflow re-checks against the repo before writing anything.
    return false;
  }
}

/** Per-IP counter in the edge cache, reset at UTC midnight. */
async function bumpIpCount(ipKey) {
  const today = new Date().toISOString().slice(0, 10);
  const key = new Request(`https://aka-ratelimit.internal/${today}/${ipKey}`);
  const cache = caches.default;

  let count = 0;
  const hit = await cache.match(key);
  if (hit) {
    const data = await hit.json().catch(() => ({ count: 0 }));
    count = data.count || 0;
  }
  count += 1;

  const secondsLeftToday = Math.max(
    60,
    Math.floor((Date.parse(`${today}T23:59:59Z`) - Date.now()) / 1000)
  );
  await cache.put(
    key,
    new Response(JSON.stringify({ count }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${secondsLeftToday}`,
      },
    })
  );
  return count;
}

function githubClient(token, repo) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'akams.fyi-submit (+https://akams.fyi)',
    'content-type': 'application/json',
  };

  return {
    async createIssue({ title, body, labels }) {
      const res = await withTimeout(
        fetch(`https://api.github.com/repos/${repo}/issues`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title, body, labels }),
        })
      );
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /** Today's submission count, used for the global cap. No storage needed. */
    async countTodaysSubmissions() {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const q = `repo:${repo}+label:${LABEL}+created:>=${today}`;
        const res = await withTimeout(
          fetch(`https://api.github.com/search/issues?q=${q}&per_page=1`, { headers })
        );
        if (!res.ok) return 0;
        const data = await res.json();
        return data.total_count || 0;
      } catch {
        return 0;
      }
    },
  };
}

/**
 * The issue body. Machine-readable JSON in a fenced block so the drain workflow
 * parses one structure, plus a human summary for anyone reading the thread.
 */
function issueBody(record, submittedBy) {
  return [
    `Submitted from [akams.fyi/add](https://akams.fyi/add)${
      submittedBy ? ` by ${submittedBy.replace(/[<>@]/g, '')}` : ''
    }.`,
    '',
    `- **Link:** https://aka.ms/${record.link}`,
    `- **Resolves to:** ${record.url}`,
    `- **Title:** ${record.title || record.autoCrawledTitle || '(none)'}`,
    `- **Category:** ${record.category || '(none)'}`,
    '',
    '### Record',
    '',
    '```json',
    JSON.stringify(record, null, 2),
    '```',
  ].join('\n');
}

function clamp(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function withTimeout(promise, ms = FETCH_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function sha256(input) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}
