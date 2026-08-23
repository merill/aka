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

const REPO = 'merill/aka';
const DEBOUNCE_MS = 400;

const form = document.getElementById('add-form');
if (form) init();

function init() {
  const linkEl = document.getElementById('f-link');
  const statusEl = document.getElementById('f-link-status');
  const submitEl = document.getElementById('f-submit');
  const resultEl = document.getElementById('f-result');
  const githubEl = document.getElementById('f-github');

  /** null = unknown/unchecked. */
  let resolveState = null;
  let index = null;
  let apiAvailable = true;

  // Prefilled by the 404 page's "Add aka.ms/<term>" link.
  const preset = new URLSearchParams(location.search).get('link');
  if (preset && !linkEl.value) linkEl.value = preset;

  loadIndex().then(() => validate());

  linkEl.addEventListener('input', () => {
    resolveState = null;
    validate();
    scheduleResolve();
  });
  form.addEventListener('submit', onSubmit);
  ['f-category', 'f-title', 'f-keywords', 'f-by'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateGithubFallback);
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

    // Client checks pass. Reflect whatever the resolve check has told us.
    if (resolveState === 'checking') {
      statusEl.textContent = 'Checking that this link resolves…';
      statusEl.style.color = 'var(--aka-muted)';
    } else if (resolveState && resolveState.ok) {
      statusEl.innerHTML =
        '✓ resolves → <a href="' +
        escapeHtml(resolveState.url) +
        '" target="_blank" rel="noopener nofollow">' +
        escapeHtml(resolveState.url) +
        '</a>' +
        (resolveState.title
          ? '<br><span style="color:var(--aka-muted)">' +
            escapeHtml(resolveState.title) +
            '</span>'
          : '');
      statusEl.style.color = 'var(--aka-fg)';
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

  const scheduleResolve = debounce(async () => {
    if (!apiAvailable) return;
    const check = clientCheck();
    if (!check.ok) return;

    const name = currentName();
    resolveState = 'checking';
    validate();

    try {
      const res = await fetch(
        '/api/submit?link=' + encodeURIComponent(name),
        { headers: { accept: 'application/json' } }
      );
      if (res.status === 404 || res.status === 405) {
        // No Function deployed here (e.g. `astro dev`). Stay quiet.
        apiAvailable = false;
        resolveState = null;
        validate();
        return;
      }
      const data = await res.json();
      if (currentName() !== name) return; // input moved on while we waited
      resolveState = data;
    } catch (err) {
      apiAvailable = false;
      resolveState = null;
    }
    validate();
  }, DEBOUNCE_MS);

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
