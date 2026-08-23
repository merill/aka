/**
 * /add form behaviour.
 *
 * Two tiers of validation, and the split is deliberate:
 *
 *  - Here in the browser: normalization, format, and duplicate detection
 *    against the search index the site already publishes. Instant, and it
 *    catches the case the old PowerShell intake got wrong — `AD/CA` compared
 *    against the raw filename never matched the existing `ad~ca.json`.
 *
 *  - In the Pages Function: whether aka.ms/<name> actually resolves. The
 *    browser cannot check this. aka.ms sends no CORS headers, and a no-cors
 *    fetch yields an opaque response with no readable status, so there is no
 *    way to tell a real link from a dead one client-side.
 *
 * If the Function is unreachable the form stays usable: validation degrades to
 * the client-side tier and submission falls back to a prefilled GitHub issue.
 */

import {
  normalizeLinkName,
  validateLinkName,
  findDuplicate,
} from '../lib/akaLink.mjs';
import { initCategoryComboboxes } from './category-combobox.js';

const REPO = 'merill/aka';
const DEBOUNCE_MS = 400;

initCategoryComboboxes();

const form = document.getElementById('add-form');
if (form) init();

function init() {
  const linkEl = document.getElementById('f-link');
  const statusEl = document.getElementById('f-link-status');
  const submitEl = document.getElementById('f-submit');
  const verifyEl = document.getElementById('f-verify');
  const categoryEl = document.getElementById('f-category');
  const categoryCombo = document.getElementById('f-category-combo');
  const categoryNote = document.getElementById('f-category-note');
  const resultEl = document.getElementById('f-result');
  const githubEl = document.getElementById('f-github');

  /** null = unknown/unchecked. */
  let resolveState = null;
  /** True when the category was filled in by Verify rather than by the user. */
  let categoryAuto = false;
  let index = null;
  let apiAvailable = true;

  // Prefilled by the 404 page's "Add aka.ms/<term>" link.
  const preset = new URLSearchParams(location.search).get('link');
  if (preset && !linkEl.value) linkEl.value = preset;

  loadIndex().then(() => validate());

  linkEl.addEventListener('input', () => {
    // Editing the name invalidates any previous verification.
    resolveState = null;
    categoryAuto = false;
    validate();
  });

  verifyEl.addEventListener('click', verify);
  linkEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!verifyEl.disabled) verify();
    }
  });
  form.addEventListener('submit', onSubmit);
  ['f-title', 'f-keywords', 'f-by'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateGithubFallback);
  });

  categoryEl.addEventListener('change', () => {
    categoryAuto = false;
    categoryNote.textContent = '';
    updateGithubFallback();
  });

  async function loadIndex() {
    try {
      // Same versioned-URL rule as the search island: a fixed URL plus
      // force-cache would let a returning visitor validate against a stale
      // index and be told a link is missing when it isn't.
      const version = form.dataset.indexVersion || '';
      const res = await fetch(
        '/commands.json' + (version ? '?v=' + encodeURIComponent(version) : '')
      );
      if (res.ok) index = await res.json();
    } catch (err) {
      // Duplicate detection is then left to the server; not fatal.
    }
  }

  function currentName() {
    return normalizeLinkName(linkEl.value);
  }

  /** Client-side checks only. Returns {ok, message, kind}. */
  function clientCheck() {
    const raw = linkEl.value.trim();
    const name = currentName();

    if (!raw) return { ok: false, kind: 'empty', message: '' };

    const errors = validateLinkName(name);
    if (errors.length) return { ok: false, kind: 'invalid', message: errors[0] };

    if (index) {
      const dupe = findDuplicate(name, index.map((r) => r[0]));
      if (dupe) {
        return {
          ok: false,
          kind: 'duplicate',
          message: `aka.ms/${dupe} is already listed.`,
          existing: dupe,
        };
      }
    }

    const changed = name !== raw;
    return {
      ok: true,
      kind: 'ok',
      message: changed ? `Will be added as aka.ms/${name}` : '',
    };
  }

  function validate() {
    const check = clientCheck();
    updateGithubFallback();

    verifyEl.disabled = !check.ok || resolveState === 'checking' || !apiAvailable;

    if (check.kind === 'empty') {
      statusEl.textContent = '';
      statusEl.removeAttribute('style');
      submitEl.disabled = true;
      return check;
    }

    if (!check.ok) {
      if (check.kind === 'duplicate') {
        statusEl.innerHTML =
          escapeHtml(check.message) +
          ` <a href="/${encodeURIComponent(check.existing)}">View it</a>`;
      } else {
        statusEl.textContent = check.message;
      }
      statusEl.style.color = '#dc2626';
      submitEl.disabled = true;
      return check;
    }

    // Client checks pass. Reflect whatever verification has told us.
    if (resolveState === 'checking') {
      statusEl.textContent = 'Checking that this link resolves…';
      statusEl.style.color = 'var(--aka-muted)';
    } else if (resolveState && resolveState.ok) {
      statusEl.innerHTML =
        '<div class="rounded border p-3" style="border-color: var(--aka-border); background: var(--aka-surface);">' +
        '<div style="color: var(--aka-fg);">✓ Resolves</div>' +
        '<div class="mt-1 text-xs" style="color: var(--aka-muted); overflow-wrap: anywhere;">' +
        escapeHtml(resolveState.url) +
        '</div>' +
        (resolveState.title
          ? '<div class="mt-1" style="color: var(--aka-fg);">' +
            escapeHtml(resolveState.title) +
            '</div>'
          : '') +
        '</div>';
      statusEl.style.color = '';
    } else if (resolveState && !resolveState.ok) {
      statusEl.textContent =
        resolveState.message || "That aka.ms link doesn't seem to exist.";
      statusEl.style.color = '#dc2626';
    } else {
      statusEl.textContent = check.message;
      statusEl.style.color = 'var(--aka-muted)';
    }

    // A failed resolve blocks submission; an unreachable API does not.
    submitEl.disabled = Boolean(resolveState && !resolveState.ok);
    return check;
  }

  /**
   * Ask the Function to resolve the link and suggest a category.
   *
   * Explicit rather than debounced-as-you-type: it is one network call per
   * click instead of one per typing pause, which is both clearer for the user
   * and far cheaper against the daily Functions allowance.
   */
  async function verify() {
    const check = clientCheck();
    if (!check.ok) return;

    const name = currentName();
    resolveState = 'checking';
    verifyEl.disabled = true;
    verifyEl.textContent = 'Verifying…';
    validate();

    try {
      const res = await fetch('/api/submit?link=' + encodeURIComponent(name), {
        headers: { accept: 'application/json' },
      });
      if (res.status === 404 || res.status === 405) {
        // No Function deployed here (e.g. `astro dev`).
        apiAvailable = false;
        resolveState = null;
        return;
      }
      const data = await res.json();
      if (currentName() !== name) return; // input moved on while we waited
      resolveState = data;

      // Fill the category in, unless the user has already chosen one.
      const suggested = data.ok && data.suggestion && data.suggestion.category;
      if (suggested && (!categoryEl.value || categoryAuto)) {
        categoryCombo.setValue(suggested, true);
        categoryAuto = true;
        const reason = data.suggestion.reason
          ? ` — ${data.suggestion.reason}`
          : '';
        categoryNote.textContent = `Suggested${reason}. Change it if that's wrong.`;
        updateGithubFallback();
      }
    } catch (err) {
      apiAvailable = false;
      resolveState = null;
    } finally {
      verifyEl.textContent = 'Verify link';
      verifyEl.disabled = false;
      validate();
    }
  }

  function payload() {
    return {
      link: currentName(),
      category: document.getElementById('f-category').value,
      title: document.getElementById('f-title').value.trim(),
      keywords: document.getElementById('f-keywords').value.trim(),
      submittedBy: document.getElementById('f-by').value.trim(),
    };
  }

  /** Keep the GitHub escape hatch prefilled with whatever has been typed. */
  function updateGithubFallback() {
    const p = payload();
    const params = new URLSearchParams({
      template: 'add-link.yaml',
      labels: 'add-link',
      title: p.link ? `Add: ${p.link}` : 'Add an aka.ms link',
    });
    if (p.link) params.set('link', p.link);
    if (p.category) params.set('category', p.category);
    if (p.title) params.set('link_title', p.title);
    if (p.keywords) params.set('keywords', p.keywords);
    if (p.submittedBy) params.set('submitted_by', p.submittedBy);
    githubEl.href = `https://github.com/${REPO}/issues/new?${params}`;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const check = validate();
    if (!check.ok) return;

    submitEl.disabled = true;
    submitEl.textContent = 'Submitting…';
    resultEl.innerHTML = '';

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      });

      if (res.status === 404 || res.status === 405) throw new Error('no-api');

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        track('add_submitted', payload().link);
        showSuccess(data);
        return;
      }
      if (res.status === 429) {
        showError(
          data.message ||
            "You've submitted a few links already — please try again later."
        );
      } else {
        showError(data.message || 'That submission was rejected.');
      }
    } catch (err) {
      // The Function is unavailable; hand off to GitHub rather than dead-ending.
      updateGithubFallback();
      resultEl.innerHTML =
        '<div class="rounded border p-4 text-sm" style="border-color: var(--aka-border);">' +
        "Couldn't reach the submission service. " +
        '<a href="' +
        escapeHtml(githubEl.href) +
        '" rel="noopener">File it on GitHub instead</a> — the form is already filled in.' +
        '</div>';
    } finally {
      submitEl.disabled = false;
      submitEl.textContent = 'Submit link';
    }
  }

  function showSuccess(data) {
    form.querySelectorAll('input, select, button').forEach((el) => {
      el.disabled = true;
    });
    resultEl.innerHTML =
      '<div class="rounded border p-4" style="border-color: var(--aka-border); background: var(--aka-surface);">' +
      '<p class="mt-0 mb-2 font-medium">✅ Thanks — that\'s queued.</p>' +
      '<p class="mt-0 mb-0 text-sm" style="color: var(--aka-muted);">' +
      escapeHtml(
        data.message ||
          "It'll appear on the site within the hour, once the next publish runs."
      ) +
      (data.issueUrl
        ? ' <a href="' + escapeHtml(data.issueUrl) + '" rel="noopener">Track it here</a>.'
        : '') +
      '</p></div>';
  }

  function showError(message) {
    resultEl.innerHTML =
      '<div class="rounded border p-4 text-sm" style="border-color:#dc2626;">' +
      escapeHtml(message) +
      '</div>';
  }
}

function track(event, link) {
  try {
    if (typeof window.clarity !== 'function') return;
    window.clarity('event', event);
    if (link) window.clarity('set', 'aka_link', link);
  } catch (err) {
    /* analytics must never break the form */
  }
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
