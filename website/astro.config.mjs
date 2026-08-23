// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://akasearch.net',

  // Matches the URL shape the Docusaurus site served (/about/), so existing
  // inbound links and search-engine records keep resolving.
  trailingSlash: 'ignore',
  build: { format: 'directory' },

  integrations: [
    sitemap({
      serialize(item) {
        // Link pages are the long tail; the homepage is the entry point.
        if (item.url === 'https://akasearch.net/') {
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
