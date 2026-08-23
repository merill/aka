// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/**
 * Links the daily crawl has marked dead.
 *
 * Read with fs rather than through src/lib/links.mjs: that module uses
 * import.meta.glob, which only Vite resolves, and this config file runs in
 * plain Node before Vite exists.
 *
 * Their pages are still built and still reachable — the record is worth
 * keeping and the page says plainly that the link is retired — but they are
 * noindex'd, so listing them in the sitemap would ask search engines to crawl
 * pages we have just told them to ignore.
 */
function retiredPaths() {
  const dir = path.resolve('./config');
  const dead = new Set();
  for (const file of fs.readdirSync(dir)) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (json.status === 'dead' && json.link) {
        dead.add(`/${json.link.toLowerCase()}/`);
      }
    } catch {
      // A malformed record shouldn't break the sitemap.
    }
  }
  return dead;
}

const RETIRED = retiredPaths();

export default defineConfig({
  site: 'https://akams.fyi',

  // Matches the URL shape the Docusaurus site served (/about/), so existing
  // inbound links and search-engine records keep resolving.
  trailingSlash: 'ignore',
  build: { format: 'directory' },

  integrations: [
    sitemap({
      filter: (url) => !RETIRED.has(new URL(url).pathname),
      serialize(item) {
        // Link pages are the long tail; the homepage is the entry point.
        if (item.url === 'https://akams.fyi/') {
          item.changefreq = 'daily';
          item.priority = 1.0;
        } else if (/\/(about)\/?$/.test(item.url)) {
          item.changefreq = 'monthly';
          item.priority = 0.5;
        } else {
          item.changefreq = 'weekly';
          item.priority = 0.6;
        }
        return item;
      },
    }),
  ],

  vite: { plugins: [tailwindcss()] },
});
