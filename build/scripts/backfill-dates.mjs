/**
 * @name backfill-dates.mjs
 * @description One-time backfill of `dateAdded` onto every link record in
 * website/config, derived from the commit that first added each file.
 *
 * Git is asked for the whole history in a single pass rather than once per
 * file: `git log --diff-filter=A --name-only` walks newest-first, so the LAST
 * time a path appears is the earliest commit that added it (a file that was
 * deleted and re-added shows up more than once, and we want the original).
 *
 * Usage:
 *   node build/scripts/backfill-dates.mjs --dry-run
 *   node build/scripts/backfill-dates.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configDir = path.join(repoRoot, 'website/config');
const dryRun = process.argv.includes('--dry-run');

/**
 * Map of normalized link key -> earliest ISO date that key was ever added.
 *
 * Keys are normalized rather than raw filenames because the separator for
 * nested links has changed over the repo's life: `aka.ms/ad/ca` was stored as
 * `ad:ca.json` until commit e208188 deleted all 233 colon-named files and
 * cf975e3 re-added them as `ad~ca.json`. Git records that as delete + add, so a
 * raw-filename lookup dates every nested link to April 2025 instead of its real
 * origin. Normalizing both spellings to the same key and keeping the earliest
 * date recovers the true provenance.
 */
function firstAddedDates() {
  const out = execFileSync(
    'git',
    ['log', '--diff-filter=A', '--format=C|%aI', '--name-only', '--', 'website/config', 'config'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );

  const dates = new Map();
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('C|')) {
      current = line.slice(2).trim();
    } else if (line.trim() && current) {
      const key = linkKey(path.basename(line.trim()));
      const seen = dates.get(key);
      // Walking newest-first, so the last write wins — but compare explicitly
      // so that dates merged from a differently-spelled predecessor also win.
      if (!seen || current < seen) dates.set(key, current);
    }
  }
  return dates;
}

/** Collapse every historical spelling of a link onto one key. */
function linkKey(filename) {
  return filename
    .replace(/\.json$/i, '')
    .replace(/[:~]/g, '/')
    .trim()
    .toLowerCase();
}

/** Exact first-add date for one path, following renames. Null if not found. */
function followedFirstAdd(relPath) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--follow', '--diff-filter=A', '--format=%aI', '--', relPath],
      { cwd: repoRoot, encoding: 'utf8' }
    ).trim();
    if (!out) return null;
    const lines = out.split('\n').filter(Boolean);
    return lines[lines.length - 1]; // oldest
  } catch {
    return null;
  }
}

function main() {
  const dates = firstAddedDates();
  const files = fs.readdirSync(configDir).filter((f) => !f.startsWith('.'));

  const fallback = execFileSync('git', ['log', '-1', '--format=%aI'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();

  let written = 0;
  let already = 0;
  const noHistory = [];
  const followed = [];
  const unparseable = [];

  for (const file of files) {
    const full = path.join(configDir, file);
    if (!fs.statSync(full).isFile()) continue;

    let json;
    try {
      json = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      unparseable.push(`${file}: ${err.message}`);
      continue;
    }

    if (json.dateAdded) {
      already++;
      continue;
    }

    let dateAdded = dates.get(linkKey(file));
    if (!dateAdded) {
      // The bulk pass misses files that were renamed (e.g. a case change), since
      // git records those as a delete + add of a different path. --follow gets
      // the true origin, but only works one path at a time, so it is used just
      // for the handful that fall through.
      dateAdded = followedFirstAdd(path.relative(repoRoot, full));
      if (dateAdded) {
        followed.push(file);
      } else {
        noHistory.push(file);
        dateAdded = fallback;
      }
    }

    json.dateAdded = dateAdded;
    if (!dryRun) {
      fs.writeFileSync(full, JSON.stringify(json, null, 2) + '\n');
    }
    written++;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}config files scanned : ${files.length}`);
  console.log(`${dryRun ? '[dry-run] ' : ''}dateAdded written    : ${written}`);
  console.log(`${dryRun ? '[dry-run] ' : ''}already had a date   : ${already}`);
  console.log(`${dryRun ? '[dry-run] ' : ''}git dates available  : ${dates.size}`);

  if (followed.length) {
    console.log(`\nResolved via --follow (renamed at some point), ${followed.length}:`);
    for (const f of followed) console.log(`  - ${f}`);
  }
  if (noHistory.length) {
    console.log(`\nNo add-commit found (fell back to ${fallback}) for ${noHistory.length}:`);
    for (const f of noHistory) console.log(`  - ${f}`);
  }
  if (unparseable.length) {
    console.log(`\nUnparseable, skipped (${unparseable.length}):`);
    for (const f of unparseable) console.log(`  - ${f}`);
  }
}

main();
