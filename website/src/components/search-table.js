/**
 * Search table island — plain DOM, no framework.
 *
 * The whole interactive surface of the site is one filter box, one category
 * select, one sort select and a row cap. react-table v7 (unmaintained) plus
 * React was ~114 KB gzipped to do that; this is a few KB.
 *
 * The server renders the first page of rows; this takes over once the full
 * index has loaded, and degrades to "the SSR rows are what you get" if the
 * fetch fails.
 */

const MAX_ROWS = 200;
const DEBOUNCE_MS = 150;

// Index field order, mirroring getSearchIndex() in src/lib/links.mjs.
const LINK = 0;
const TITLE = 1;
const KEYWORDS = 2;
const CATEGORY = 3;
const URL_ = 4;
const ICON = 5;
const DATE = 6;
const DEAD = 7;
const ICON_URL = 8;

const root = document.getElementById('aka-search');
if (root) init(root);

function init(root) {
  const queryEl = document.getElementById('aka-query');
  const categoryEl = document.getElementById('aka-category'); // hidden input
  const sortEl = document.getElementById('aka-sort');
  const rowsEl = document.getElementById('aka-rows');
  const statusEl = document.getElementById('aka-status');
  const moreEl = document.getElementById('aka-more');

  let index = null;
  let showAll = false;

  // Copy and outbound-click handling is delegated from the document in
  // Base.astro, so it already covers rows this island re-renders.

  const rerender = () => {
    showAll = false;
    render();
  };

  queryEl.addEventListener('input', debounce(rerender, DEBOUNCE_MS));
  // The hidden input is written by the combobox, which dispatches 'change'.
  categoryEl.addEventListener('change', rerender);
  setupCategoryCombobox(rerender);
  sortEl.addEventListener('change', rerender);

  moreEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-show-all]');
    if (!btn) return;
    showAll = true;
    render();
  });

  loadIndex();

  async function loadIndex() {
    try {
      // Versioned URL, so force-cache is safe: the query changes whenever the
      // data does, and a stale entry can never be served.
      const version = root.dataset.indexVersion || '';
      const res = await fetch(
        '/commands.json' + (version ? '?v=' + encodeURIComponent(version) : ''),
        { cache: 'force-cache' }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      index = await res.json();
    } catch (err) {
      // Leave the server-rendered rows in place; the page is still usable.
      statusEl.textContent =
        'Search is unavailable right now. Showing the most recently added links.';
      return;
    }
    // An initial query (from the 404 route) only takes effect once the index
    // exists, so render unconditionally here.
    render();
  }

  function currentFilter() {
    return {
      q: queryEl.value.trim().toLowerCase(),
      category: categoryEl.value,
      sort: sortEl.value,
    };
  }

  function render() {
    if (!index) return;
    const { q, category, sort } = currentFilter();

    let rows = index;
    if (category) rows = rows.filter((r) => r[CATEGORY] === category);

    if (q) {
      // Every term must appear somewhere in the record, so "intune policy"
      // narrows rather than widening.
      const terms = q.split(/\s+/).filter(Boolean);
      rows = rows.filter((r) => {
        const hay = (
          r[LINK] + ' ' + r[TITLE] + ' ' + r[KEYWORDS] + ' ' + r[URL_]
        ).toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    rows = sortRows(rows, sort, q);

    const total = rows.length;
    const shown = showAll ? rows : rows.slice(0, MAX_ROWS);

    rowsEl.innerHTML = shown.map(rowHtml).join('');

    if (total === 0) {
      statusEl.textContent = q
        ? `No links match "${queryEl.value.trim()}".`
        : 'No links match those filters.';
      moreEl.innerHTML = q
        ? `<a href="/add?link=${encodeURIComponent(queryEl.value.trim())}">Add aka.ms/${escapeHtml(queryEl.value.trim())} to akams.fyi →</a>`
        : '';
      return;
    }

    statusEl.textContent =
      total === index.length
        ? `${total} links.`
        : `${total} of ${index.length} links.`;

    moreEl.innerHTML =
      total > shown.length
        ? `<button type="button" data-show-all class="cursor-pointer underline" style="background:none;border:0;color:var(--aka-accent);padding:0;">Show all ${total} results</button>`
        : '';
  }

  function sortRows(rows, sort, q) {
    const copy = rows.slice();
    if (sort === 'link') {
      copy.sort((a, b) => a[LINK].localeCompare(b[LINK]));
    } else if (sort === 'title') {
      copy.sort((a, b) => a[TITLE].localeCompare(b[TITLE]));
    } else {
      copy.sort((a, b) => (b[DATE] || '').localeCompare(a[DATE] || ''));
    }

    // With an active query, exact and prefix matches on the short name are
    // almost always what was meant, so lift them above the chosen sort.
    if (q) {
      copy.sort((a, b) => rank(a[LINK], q) - rank(b[LINK], q));
    }

    // Retired links stay searchable but never outrank a working one.
    copy.sort((a, b) => (a[DEAD] || 0) - (b[DEAD] || 0));
    return copy;
  }

  function rank(link, q) {
    if (link === q) return 0;
    if (link.startsWith(q)) return 1;
    if (link.includes(q)) return 2;
    return 3;
  }

  function rowHtml(r) {
    const link = escapeHtml(r[LINK]);
    const title = escapeHtml(r[TITLE]);
    const url = escapeHtml(r[URL_]);
    const icon = escapeHtml(r[ICON]);
    const date = escapeHtml(r[DATE] || '');
    const dead = r[DEAD] === 1;
    const iconUrl = r[ICON_URL] || '';
    const iconCell = iconUrl
      ? `<span class="aka-icon" style="background-image:url('${escapeHtml(iconUrl)}')" aria-hidden="true"></span>`
      : `<span class="aka-icon aka-icon-${icon}" aria-hidden="true"></span>`;
    const badge = dead
      ? '<span class="ml-1 rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide" style="border:1px solid var(--aka-border);color:var(--aka-muted);" title="This aka.ms link no longer resolves">retired</span>'
      : '';
    return (
      '<tr class="border-t align-top" style="border-color: var(--aka-border);">' +
      `<td class="px-2 py-2">${iconCell}</td>` +
      '<td class="px-2 py-2"><span class="whitespace-nowrap">' +
      `<a href="/${link}"${dead ? ' style="color:var(--aka-muted);"' : ''}>aka.ms/<b>${link}</b></a>` + badge +
      `<button type="button" class="aka-copy ml-1 cursor-pointer border-0 bg-transparent p-0 align-middle" data-link="${link}" aria-label="Copy aka.ms/${link}">` +
      '<span class="aka-icon aka-icon-copy" aria-hidden="true"></span></button></span>' +
      // Mirrors the stacked-title markup the server renders below the sm breakpoint.
      `<span class="mt-0.5 block text-xs sm:hidden" style="color: var(--aka-muted); overflow-wrap: anywhere;">${title}</span>` +
      '</td>' +
      `<td class="hidden px-2 py-2 sm:table-cell" style="overflow-wrap: anywhere;"><a href="${url}" target="_blank" rel="noopener nofollow" data-aka-out="${link}">${title}</a></td>` +
      `<td class="hidden max-w-xs truncate px-2 py-2 lg:table-cell" style="color: var(--aka-muted);"><a href="${url}" target="_blank" rel="noopener nofollow" data-aka-out="${link}" style="color: var(--aka-muted);">${url}</a></td>` +
      `<td class="hidden px-2 py-2 whitespace-nowrap md:table-cell" style="color: var(--aka-muted);">${date}</td>` +
      '</tr>'
    );
  }

}

/**
 * Searchable category combobox.
 *
 * A plain <select> was adequate for 14 categories; the shared taxonomy has 29,
 * so it needs filtering. Behaviour mirrors yako's catalog browser: type to
 * filter, arrow keys to move, Enter to choose, Escape to dismiss, click-away
 * to close. Selection is written to a hidden input so the rest of the table
 * reads it exactly as it read the old select.
 */
function setupCategoryCombobox(onChange) {
  const combo = document.getElementById('aka-category-combo');
  const button = document.getElementById('aka-category-button');
  const menu = document.getElementById('aka-category-menu');
  const label = document.getElementById('aka-category-label');
  const search = document.getElementById('aka-category-search');
  const list = document.getElementById('aka-category-list');
  const empty = document.getElementById('aka-category-empty');
  const hidden = document.getElementById('aka-category');
  if (!combo || !button || !menu || !list || !hidden) return;

  const options = () => [...list.querySelectorAll('.aka-cat-option')];
  const visible = () =>
    options().filter((o) => !o.parentElement.classList.contains('hidden'));

  let active = -1;

  const isOpen = () => !menu.classList.contains('hidden');

  function open() {
    menu.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    search.value = '';
    filter('');
    active = visible().findIndex((o) => o.dataset.value === hidden.value);
    highlight();
    search.focus();
  }

  function close() {
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function filter(q) {
    const term = q.trim().toLowerCase();
    let shown = 0;
    for (const opt of options()) {
      const match = !term || opt.dataset.label.toLowerCase().includes(term);
      opt.parentElement.classList.toggle('hidden', !match);
      if (match) shown++;
    }
    empty.classList.toggle('hidden', shown > 0);
    active = shown ? 0 : -1;
    highlight();
  }

  function highlight() {
    const vis = visible();
    vis.forEach((o, i) => {
      const on = i === active;
      o.style.background = on ? 'var(--aka-row-hover)' : 'transparent';
      if (on) o.scrollIntoView({ block: 'nearest' });
    });
  }

  function choose(opt) {
    hidden.value = opt.dataset.value;
    label.textContent = opt.dataset.label;
    for (const o of options()) {
      const on = o === opt;
      o.setAttribute('aria-selected', String(on));
      o.querySelector('.aka-cat-check').classList.toggle('invisible', !on);
    }
    close();
    button.focus();
    onChange();
  }

  button.addEventListener('click', () => (isOpen() ? close() : open()));

  search.addEventListener('input', () => filter(search.value));

  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.aka-cat-option');
    if (opt) choose(opt);
  });

  list.addEventListener('mousemove', (e) => {
    const opt = e.target.closest('.aka-cat-option');
    if (!opt) return;
    const i = visible().indexOf(opt);
    if (i > -1 && i !== active) {
      active = i;
      highlight();
    }
  });

  menu.addEventListener('keydown', (e) => {
    const vis = visible();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, vis.length - 1);
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (vis[active]) choose(vis[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === 'Tab') {
      close();
    }
  });

  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  document.addEventListener('click', (e) => {
    if (isOpen() && !combo.contains(e.target)) close();
  });
}

function debounce(fn, ms) {
  let t;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
