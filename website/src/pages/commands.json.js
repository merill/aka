/**
 * The client-side search index, emitted as a static file at build time.
 *
 * Kept out of the JS bundle deliberately: the old build compiled all 1451
 * records into commands.table.js, which webpack then inlined into main.js —
 * so every visitor downloaded and parsed the whole dataset before the page
 * could render, on all three routes that showed the table.
 */
import { getSearchIndex } from '../lib/links.mjs';

export function GET() {
  return new Response(JSON.stringify(getSearchIndex()), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
