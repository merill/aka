/**
 * @name drain-issues.mjs
 * @description Turn open `add-link` issues into config records, in one batch.
 *
 * Replaces New-AkaLinkFromIssue / Update-AllOpenGitHubIssues in AkaUtils.ps1.
 * Three things are different, all of them deliberate:
 *
 *  1. The issue body is parsed by heading, not by line index. The PowerShell
 *     read $lines[2] and $lines[6], so one extra blank line in a submission
 *     silently mis-parsed it.
 *  2. Duplicate detection normalizes the name before comparing, so `AD/CA`
 *     matches the existing ad~ca.json instead of creating a second record.
 *  3. Every outstanding issue is written and committed together, as a single
 *     commit. One commit per submission would be one Cloudflare Pages build per
 *     submission, against a ceiling of 500 builds a month.
 *
 * Usage:
 *   GITHUB_TOKEN=… node build/scripts/drain-issues.mjs [--dry-run] [--fixture <file>]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeLinkName,
  validateLinkName,
  validateCategory,
  normalizeCategory,
  configFileName,
  isNotFoundRedirect,
  extractTitle,
} from '../../website/src/lib/akaLink.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'merill/aka';
const TOKEN = process.env.GITHUB_TOKEN;
const LABEL = 'add-link';
const FETCH_TIMEOUT_MS = 15000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configDir = path.join(repoRoot, 'website/config');

const dryRun = process.argv.includes('--dry-run');
const fixtureIdx = process.argv.indexOf('--fixture');
const fixture = fixtureIdx > -1 ? process.argv[fixtureIdx + 1] : null;

/* ---------------------------------------------------------------- parsing */

/** Body text under a `### Heading`, up to the next heading. */
function section(body, heading) {
  const re = new RegExp(`^###\\s+${heading}\\s*$`, 'mi');
  const m = body.match(re);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const next = rest.match(/^###\s+/m);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** GitHub renders an empty issue-form field as this literal. */
function clean(value) {
  if (!value) return '';
  const v = value.trim();
  if (v === '_No response_' || v === 'None') return '';
  return v;
}

/**
 * Parse either issue shape.
 *
 * The /api/submit Function embeds a fenced JSON record, which is exact.
 * A hand-filed issue form has one `### Heading` per field and is untrusted —
 * both are re-validated downstream regardless.
 */
export function parseIssue(issue) {
  const body = issue.body || '';

  const fenced = section(body, 'Record');
  if (fenced) {
    const match = fenced.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (match) {
      try {
        const record = JSON.parse(match[1]);
        return { source: 'form', record };
      } catch (err) {
        return { error: `The record block isn't valid JSON: ${err.message}` };
      }
    }
  }

  const link = clean(section(body, 'Aka\\.ms link name'));
  if (!link) {
    return {
      error:
        "Couldn't find a link name in this issue. Please use the form at https://akams.fyi/add.",
    };
  }

  return {
    source: 'issue',
    record: {
      link,
      title: clean(section(body, 'Title')),
      keywords: clean(section(body, 'Search keywords')),
      category: clean(section(body, 'Category')),
      submittedBy: clean(section(body, 'Your name or handle')),
    },
  };
}

/* ------------------------------------------------------------- validation */

/** Existing records, keyed by normalized name. Built once per run. */
function existingLinks() {
  const map = new Map();
  for (const file of fs.readdirSync(configDir)) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    try {
      const json = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'));
      const name = normalizeLinkName(json.link || file.replace(/\.json$/i, '').replace(/~/g, '/'));
      if (name) map.set(name, file);
    } catch {
      // A malformed file shouldn't stop the whole batch.
    }
  }
  return map;
}

async function withTimeout(promise, ms = FETCH_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Resolve aka.ms/<name> and read the destination title. */
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
    return { ok: false, message: "Couldn't reach aka.ms. This will be retried on the next run." };
  }

  const location = res.headers.get('location');
  if (isNotFoundRedirect(location)) {
    return { ok: false, message: `aka.ms/${name} doesn't resolve, so it wasn't added.` };
  }

  let title = '';
  try {
    const page = await withTimeout(
      fetch(location, {
        redirect: 'follow',
        headers: {
          'user-agent': 'akams.fyi-bot (+https://akams.fyi)',
          accept: 'text/html',
        },
      })
    );
    if (page.ok && (page.headers.get('content-type') || '').includes('text/html')) {
      title = extractTitle((await page.text()).slice(0, 20000));
    }
  } catch {
    // A missing title is fine; the crawler will fill it in later.
  }

  return { ok: true, url: location, title };
}

/* ----------------------------------------------------------------- github */

async function gh(pathname, options = {}) {
  const res = await withTimeout(
    fetch(`https://api.github.com${pathname}`, {
      ...options,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'akams.fyi-drain (+https://akams.fyi)',
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    })
  );
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${pathname}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function listOpenSubmissions() {
  const issues = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(
      `/repos/${REPO}/issues?state=open&labels=${LABEL}&per_page=100&page=${page}`
    );
    // The issues endpoint also returns pull requests; skip them.
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return issues;
}

/* ------------------------------------------------------------------- main */

async function processIssue(issue, existing, claimed) {
  const parsed = parseIssue(issue);
  if (parsed.error) return { state: 'invalid', message: parsed.error };

  const name = normalizeLinkName(parsed.record.link || '');
  const errors = [
    ...validateLinkName(name),
    ...validateCategory(parsed.record.category || ''),
  ];
  if (errors.length) return { state: 'invalid', message: errors[0] };

  if (existing.has(name)) {
    return {
      state: 'exists',
      link: name,
      message: `aka.ms/${name} is already on akams.fyi.`,
    };
  }
  if (claimed.has(name)) {
    return {
      state: 'exists',
      link: name,
      message: `aka.ms/${name} was submitted twice; the earlier issue covers it.`,
    };
  }

  const resolved = await resolveAka(name);
  if (!resolved.ok) {
    // A transient network failure must not close the issue — leave it for the
    // next hourly run rather than telling the submitter their link is dead.
    const transient = resolved.message.includes("Couldn't reach");
    return { state: transient ? 'retry' : 'invalid', link: name, message: resolved.message };
  }

  return {
    state: 'added',
    link: name,
    record: {
      link: name,
      title: parsed.record.title || '',
      autoCrawledTitle: resolved.title || '',
      keywords: parsed.record.keywords || '',
      category: normalizeCategory(parsed.record.category),
      url: resolved.url,
      dateAdded: new Date().toISOString(),
    },
  };
}

function writeRecord(record) {
  const file = configFileName(record.link);
  fs.writeFileSync(
    path.join(configDir, file),
    JSON.stringify(record, null, 2) + '\n'
  );
  return file;
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

async function main() {
  let issues;
  if (fixture) {
    issues = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    console.log(`Loaded ${issues.length} fixture issue(s) from ${fixture}`);
  } else {
    if (!TOKEN) throw new Error('GITHUB_TOKEN is required (or pass --fixture).');
    issues = await listOpenSubmissions();
  }

  if (!issues.length) {
    console.log('No open submissions. Nothing to publish, no build triggered.');
    return;
  }
  console.log(`Processing ${issues.length} open submission(s).`);

  const existing = existingLinks();
  const claimed = new Set();
  const results = [];

  for (const issue of issues) {
    const result = await processIssue(issue, existing, claimed);
    result.issue = issue.number;
    result.title = issue.title;
    if (result.state === 'added') claimed.add(result.link);
    results.push(result);
    console.log(
      `  #${issue.number} ${result.state.padEnd(7)} ${result.link || ''} ${
        result.message || ''
      }`
    );
  }

  const added = results.filter((r) => r.state === 'added');

  if (added.length && !dryRun) {
    const files = added.map((r) => writeRecord(r.record));
    git('config', 'user.name', 'akasearch-bot');
    git('config', 'user.email', 'akasearch-bot@users.noreply.github.com');
    git('add', ...files.map((f) => path.join('website/config', f)));

    const staged = git('diff', '--cached', '--name-only').trim();
    if (staged) {
      const summary =
        added.length === 1
          ? `add: ${added[0].link}`
          : `add: ${added.length} links`;
      const detail = added
        .map((r) => `- aka.ms/${r.link} (#${r.issue})`)
        .join('\n');
      git('commit', '-m', `${summary}\n\n${detail}`);
      git('push');
      console.log(`Committed ${added.length} link(s) in one commit.`);
    } else {
      console.log('Nothing staged; skipping commit.');
    }
  } else if (added.length) {
    console.log(`[dry-run] would write and commit ${added.length} record(s).`);
  }

  if (!dryRun && TOKEN) {
    for (const r of results) {
      if (r.state === 'retry') continue; // leave open for the next run
      await comment(r);
      await close(r);
    }
  }

  const counts = results.reduce((acc, r) => {
    acc[r.state] = (acc[r.state] || 0) + 1;
    return acc;
  }, {});
  console.log('Summary:', JSON.stringify(counts));
}

function commentBody(r) {
  if (r.state === 'added') {
    return [
      `### ✅ Added`,
      '',
      `\`aka.ms/${r.link}\` → ${r.record.url}`,
      '',
      `It'll be live at https://akams.fyi/${r.link} once this build finishes — usually a couple of minutes.`,
      '',
      'Thanks for contributing!',
    ].join('\n');
  }
  if (r.state === 'exists') {
    return [
      `### ℹ️ Already listed`,
      '',
      `${r.message} You can see it at https://akams.fyi/${r.link}.`,
      '',
      'Thanks all the same!',
    ].join('\n');
  }
  return [
    `### ❌ Not added`,
    '',
    r.message,
    '',
    'If you think this is wrong, reopen the issue with more detail, or submit again at https://akams.fyi/add.',
  ].join('\n');
}

async function comment(r) {
  await gh(`/repos/${REPO}/issues/${r.issue}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: commentBody(r) }),
  });
}

async function close(r) {
  const label = { added: 'Added', exists: 'Existing', invalid: 'Invalid aka.ms link' }[r.state];
  try {
    await gh(`/repos/${REPO}/issues/${r.issue}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: [label] }),
    });
  } catch {
    // Labels are cosmetic; never fail a run over one.
  }
  await gh(`/repos/${REPO}/issues/${r.issue}`, {
    method: 'PATCH',
    body: JSON.stringify({
      state: 'closed',
      state_reason: r.state === 'added' ? 'completed' : 'not_planned',
    }),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
