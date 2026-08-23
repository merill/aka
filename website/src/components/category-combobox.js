/**
 * Behaviour for CategoryCombobox.astro.
 *
 * Type to filter, arrow keys to move, Enter to choose, Escape to dismiss,
 * click-away to close. Selection is written to a hidden input and a 'change'
 * event is dispatched on it, so callers read the value exactly as they would
 * read a <select>.
 */

/** Wire every combobox on the page. Safe to call more than once. */
export function initCategoryComboboxes() {
  for (const combo of document.querySelectorAll('[data-category-combobox]')) {
    if (combo.dataset.wired === '1') continue;
    combo.dataset.wired = '1';
    wire(combo);
  }
}

function wire(combo) {
  const id = combo.id.replace(/-combo$/, '');
  const $ = (suffix) => document.getElementById(suffix ? `${id}-${suffix}` : id);

  const button = $('button');
  const menu = $('menu');
  const label = $('label');
  const icon = $('icon');
  const search = $('search');
  const list = $('list');
  const empty = $('empty');
  const hidden = $();
  if (!button || !menu || !list || !hidden) return;

  const dataEl = $('data');
  const data = dataEl ? JSON.parse(dataEl.textContent) : { options: [] };

  // The empty choice is option zero; everything else comes from the payload.
  const base = data.iconBase || '';
  const expand = (o) => ({
    v: o.v,
    l: o.l,
    i: o.i ? (/^https?:/.test(o.i) ? o.i : base + o.i) : '',
    c: o.c,
    k: o.k || '',
    g: o.g ? 1 : 0,
  });

  const ALL = [
    { v: '', l: data.emptyLabel, i: '', c: data.emptyCount, k: '', g: 1 },
    ...data.options.map(expand),
  ];

  // Cap what is put in the DOM. Filtering runs over the whole list; only the
  // top matches are rendered, which keeps ~700 options cheap.
  const RENDER_LIMIT = 60;

  const options = () => [...list.querySelectorAll('.aka-cat-option')];
  const visible = options;

  let active = -1;
  let matches = ALL;
  const isOpen = () => !menu.classList.contains('hidden');

  function open() {
    menu.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    search.value = '';
    filter('');
    const i = visible().findIndex((o) => o.dataset.value === hidden.value);
    if (i > -1) active = i;
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

    if (!term) {
      // Curated groups first when nothing is typed, so the common buckets
      // aren't buried under hundreds of niche products.
      matches = ALL.filter((o) => o.g === 1);
    } else {
      const scored = [];
      for (const o of ALL) {
        const label = o.l.toLowerCase();
        let score;
        if (label === term) score = 0;
        else if (label.startsWith(term)) score = 1;
        else if (label.includes(term)) score = 2;
        else if (o.k && o.k.includes(term)) score = 3; // alias, e.g. "aad"
        else continue;
        // Curated groups edge out products at the same relevance.
        scored.push([score * 2 + (o.g ? 0 : 1), o]);
      }
      scored.sort((a, b) => a[0] - b[0] || a[1].l.localeCompare(b[1].l));
      matches = scored.map((m) => m[1]);
    }

    render(matches.slice(0, RENDER_LIMIT));
    empty.classList.toggle('hidden', matches.length > 0);
    active = matches.length ? 0 : -1;
    highlight();
  }

  function render(items) {
    const selected = hidden.value;
    list.innerHTML = items
      .map((o) => {
        const on = o.v === selected;
        const icon = o.i
          ? `<span class="aka-icon" style="width:16px;height:16px;background-image:url('${esc(o.i)}')" aria-hidden="true"></span>`
          : '<span style="width:16px;" aria-hidden="true"></span>';
        const count =
          o.c === undefined
            ? ''
            : `<span class="ml-auto text-xs" style="color: var(--aka-muted);">${o.c}</span>`;
        return (
          '<li><button type="button" role="option"' +
          ` aria-selected="${on}" data-value="${esc(o.v)}" data-label="${esc(o.l)}" data-icon="${esc(o.i)}"` +
          ' class="aka-cat-option flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"' +
          ' style="background: transparent; color: var(--aka-fg); border: 0; cursor: pointer;">' +
          `<span class="aka-cat-check${on ? '' : ' invisible'}" aria-hidden="true" style="width:1rem;">✓</span>` +
          icon +
          `<span class="truncate">${esc(o.l)}</span>` +
          count +
          '</button></li>'
        );
      })
      .join('');
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlight() {
    visible().forEach((o, i) => {
      const on = i === active;
      o.style.background = on ? 'var(--aka-row-hover)' : 'transparent';
      if (on) o.scrollIntoView({ block: 'nearest' });
    });
  }

  /** Select an option. `silent` skips the change event, for programmatic set. */
  function choose(opt, silent) {
    hidden.value = opt.dataset.value;
    label.textContent = opt.dataset.label;

    if (icon) {
      const url = opt.dataset.icon;
      icon.style.backgroundImage = url ? `url('${url}')` : '';
      icon.classList.toggle('hidden', !url);
    }

    for (const o of options()) {
      const on = o === opt;
      o.setAttribute('aria-selected', String(on));
      o.querySelector('.aka-cat-check').classList.toggle('invisible', !on);
    }

    close();
    if (!silent) {
      button.focus();
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /** Set by value from outside — used by Verify to apply a suggestion. */
  combo.setValue = (value, silent) => {
    let opt = options().find((o) => o.dataset.value === value);
    if (!opt) {
      // Not currently rendered (the list is capped) — render just this one so
      // there is an element to select.
      const match = ALL.find((o) => o.v === value);
      if (!match) return;
      render([match]);
      opt = options()[0];
    }
    if (opt) choose(opt, silent);
  };

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
