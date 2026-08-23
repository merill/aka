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
    const opt = options().find((o) => o.dataset.value === value);
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
