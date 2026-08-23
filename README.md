# akams.fyi

🚀 → [akams.fyi](https://akams.fyi) = Search aka.ms links!

This repository hosts the source for [akams.fyi](https://akams.fyi), a crowd-sourced directory of Microsoft's aka.ms links.

![image](/website/public/OpenGraphImage.png)

## Contributing

### Adding a new aka.ms link

#### From the site (recommended)

Use **[akams.fyi/add](https://akams.fyi/add)** — no GitHub account required. The form checks the link resolves and shows you where it goes before you submit.

Submissions are published in an hourly batch, so allow a little time for a new link to appear.

#### By opening an issue

If you'd rather use GitHub, the [Add a new aka.ms link](https://github.com/merill/aka/issues/new?template=add-link.yaml) template feeds into the same queue.

#### By pull request (advanced)

Best for editing existing links, deleting links, or adding many at once.

Each link is one `.json` file in [website/config](https://github.com/merill/aka/tree/main/website/config):

* The filename is the aka.ms short name — `aka.ms/intune` → `intune.json`.
* Use lowercase.
* A `/` in the link becomes `~` — `aka.ms/ad/ca` → `ad~ca.json`.

Fields:

| Field | Meaning |
| --- | --- |
| `link` | The short name, without the `aka.ms/` prefix. |
| `title` | Human-written title. Use when the destination's own title isn't meaningful, or the page is not public. Takes precedence over `autoCrawledTitle`. |
| `keywords` | Comma-separated search aliases. Useful for former product names. |
| `category` | Product family, used for grouping and the icon. See `CATEGORIES` in [akaLink.mjs](website/src/lib/akaLink.mjs) for the list; add an icon at [website/public/img](website/public/img) to give a category its own glyph. |
| `autoCrawledTitle` † | Destination page title. |
| `url` † | Final destination URL. |
| `dateAdded` | ISO 8601 timestamp, used for "recently added" and sorting. |
| `status` † | Set to `dead` when aka.ms stops resolving the link. Dead records stay in the repo but are hidden from the site. |

† Maintained automatically by the daily crawl ([refresh-links.yaml](.github/workflows/refresh-links.yaml)); you don't need to fill these in.

### Reporting issues

Open a [new bug](https://github.com/merill/aka/issues/new?template=add-bug.yaml), or use the "Report a problem with this link" link at the bottom of any link page.

## How it works

Astro static site, deployed to Cloudflare Pages. `website/config` is the source of truth — there is no database.

```
visitor → /add → POST /api/submit (Pages Function)
                   ├─ validates + confirms aka.ms resolves
                   └─ files a labelled GitHub issue
                            ↓
        hourly: drain-issues.mjs → ONE commit per batch → one Pages build
```

Submissions are batched rather than committed individually because every commit triggers a Pages build, and the free plan allows 500 a month.

| Path | Purpose |
| --- | --- |
| `website/config/` | The link records. Source of truth. |
| `website/src/lib/akaLink.mjs` | Validation and normalization. Shared by the browser, the Function and the workflows — one implementation, so the tiers can't disagree. |
| `website/src/lib/links.mjs` | Build-time loader. Vite-only (`import.meta.glob`). |
| `website/functions/api/submit.js` | The no-signin submission endpoint. |
| `build/scripts/drain-issues.mjs` | Turns open submission issues into one commit. |
| `build/scripts/refresh-links.mjs` | Daily re-crawl of destinations and titles. |
| `build/scripts/backfill-dates.mjs` | One-off; already run. |

### Local development

```bash
cd website
npm ci
npm run dev            # http://localhost:4321
npm run build          # → dist/
npx wrangler pages dev dist   # includes /api/submit
```
