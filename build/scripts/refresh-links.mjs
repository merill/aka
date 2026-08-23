/**
 * @name refresh-links.mjs
 * @description Re-resolve every link and refresh its destination and title.
 *
 * The README has always promised "a daily job will crawl the aka.ms links",
 * but no scheduled workflow ever existed — Update-AkaUrls and Update-AkaTitle
 * in AkaUtils.ps1 only ever ran by hand. This is that job.
 *
 * Records whose aka.ms link stops resolving are marked `"status": "dead"`
 * rather than deleted, so a transient aka.ms outage can't quietly empty the
 * directory; a link that comes back is un-marked on the next run.
 *
 * Usage:
 *   node build/scripts/refresh-links.mjs [--dry-run] [--limit N] [--concurrency N]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isNotFoundRedirect, extractTitle } from '../../website/src/lib/akaLink.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configDir = path.join(repoRoot, 'website/config');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const numArg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i > -1 ? Number(argv[i + 1]) : fallback;
};
const LIMIT = numArg('--limit', Infinity);
const CONCURRENCY = numArg('--concurrency', 8);
const TIMEOUT_MS = 15000;

function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function refresh(file) {
  const full = path.join(configDir, file);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  const name = json.link;
  const before = JSON.stringify(json);

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
    return { file, state: 'unreachable' };
  }

  const location = res.headers.get('location');
  if (isNotFoundRedirect(location)) {
    json.status = 'dead';
    json.dateChecked = new Date().toISOString();
    return finish(full, json, before, { file, state: 'dead' });
  }

  if (json.status === 'dead') delete json.status;
  json.url = location;
  json.dateChecked = new Date().toISOString();

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
      const title = extractTitle((await page.text()).slice(0, 20000));
      if (title) json.autoCrawledTitle = title;
    }
  } catch {
    // Keep whatever title we already had.
  }

  return finish(full, json, before, { file, state: 'ok' });
}

function finish(full, json, before, result) {
  // dateChecked alone shouldn't produce a diff — otherwise every run rewrites
  // all 1452 files and the commit is unreadable.
  const compare = { ...json };
  delete compare.dateChecked;
  const beforeCompare = { ...JSON.parse(before) };
  delete beforeCompare.dateChecked;

  result.changed = JSON.stringify(compare) !== JSON.stringify(beforeCompare);
  if (result.changed && !dryRun) {
    fs.writeFileSync(full, JSON.stringify(json, null, 2) + '\n');
  }
  return result;
}

async function pool(items, size, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const files = fs
    .readdirSync(configDir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .slice(0, LIMIT);

  console.log(`Checking ${files.length} link(s) at concurrency ${CONCURRENCY}…`);
  const results = await pool(files, CONCURRENCY, refresh);

  const counts = results.reduce((acc, r) => {
    acc[r.state] = (acc[r.state] || 0) + 1;
    return acc;
  }, {});
  const changed = results.filter((r) => r.changed);

  console.log('States :', JSON.stringify(counts));
  console.log(`Changed: ${changed.length}${dryRun ? ' (dry run, nothing written)' : ''}`);
  for (const r of results.filter((r) => r.state === 'dead')) {
    console.log(`  dead: ${r.file}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
