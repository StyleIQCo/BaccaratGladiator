/* ──────────────────────────────────────────────────────────────────────────
   feedback-widget.js — global in-game feedback / bug reporter
   ----------------------------------------------------------------------------
   Self-contained, framework-free. Injects a subtle floating action button at
   the screen edge; clicking it opens a modal (category + message) that POSTs
   to /api/feedback with auto-captured game-state context attached.

   Load it like the other page helpers, as the LAST script before </body>:
       <script src="/feedback-widget.js" defer></script>

   Must be a CLASSIC script (not type="module") and self-hosted — CloudFront
   sends `script-src 'self'`, and only classic scripts can read the game's
   top-level `let` bindings (balance / phase / currentUsername …) out of the
   shared global-lexical scope.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Guard against double-injection (e.g. hot reload / accidental double include).
  if (window.__bgFeedbackWidget) return;
  window.__bgFeedbackWidget = true;

  var QUEUE_KEY = 'bg_feedback_queue_v1'; // offline fallback when the POST fails

  // Resolve the POST target lazily (the game's CLOUD_CONFIG is defined by the
  // main script, which loads before this deferred one, but resolving at submit
  // time is robust regardless of order). Precedence:
  //   1. window.FEEDBACK_ENDPOINT  — explicit override / tests
  //   2. CLOUD_CONFIG.apiBaseUrl + '/feedback'  — real API Gateway in prod
  //   3. '/api/feedback'  — local/mock fallback
  function resolveEndpoint() {
    if (window.FEEDBACK_ENDPOINT) return window.FEEDBACK_ENDPOINT;
    try {
      var base = CLOUD_CONFIG && CLOUD_CONFIG.apiBaseUrl;
      if (base) return base.replace(/\/+$/, '') + '/feedback';
    } catch (e) { /* CLOUD_CONFIG not on this page */ }
    return '/api/feedback';
  }
  var SUCCESS_CLOSE_MS = 2200;            // auto-dismiss delay after "Thanks!"

  var CATEGORIES = [
    { value: 'bug',     label: '🐞 Bug Report' },
    { value: 'feature', label: '💡 Feature Suggestion' },
    { value: 'general', label: '💬 General Feedback' }
  ];

  // ── Form state ──────────────────────────────────────────────────────────
  // Plain object instead of a framework store; the small render helpers below
  // read straight off it so there's a single source of truth.
  var state = {
    open: false,
    category: 'bug',
    message: '',
    submitting: false,
    done: false
  };

  // ── Auto-captured context ───────────────────────────────────────────────
  // Reads the game's live globals defensively — every access is wrapped so the
  // widget still works if loaded on a page that doesn't define a given global
  // (guide, scoreboard, etc.). Replace/extend the placeholders as new state
  // becomes worth capturing.
  function safe(fn, fallback) {
    try { var v = fn(); return (v === undefined || v === null) ? fallback : v; }
    catch (e) { return fallback; }
  }

  // Map the game's internal phase to a human-readable table state for triage.
  function tableState() {
    var p = safe(function () { return phase; }, '');
    switch (p) {
      case 'betting':   return 'waiting for bets';
      case 'revealing': return 'dealing';
      case 'dealt':     return 'hand resolved';
      default:          return p || 'unknown';
    }
  }

  function captureContext() {
    return {
      // Prefer the authenticated username; fall back to email, then a guest tag.
      user_id:             safe(function () { return currentUsername; }, '') ||
                           safe(function () { return currentUserEmail; }, '') ||
                           'guest',
      user_email:          safe(function () { return currentUserEmail; }, ''),
      current_balance:     safe(function () { return balance; }, null),
      current_table_state: tableState(),
      current_venue:       safe(function () { return currentVenue; }, ''),
      browser_info:        safe(function () { return navigator.userAgent; }, ''),
      // Light environment fingerprint — handy for layout / viewport bug repros.
      page:                safe(function () { return location.pathname; }, ''),
      viewport:            safe(function () { return window.innerWidth + 'x' + window.innerHeight; }, ''),
      app_version:         safe(function () { return window.APP_VERSION; }, 'web'),
      captured_at:         new Date().toISOString()
    };
  }

  // ── Submission ──────────────────────────────────────────────────────────
  async function submitFeedback() {
    if (state.submitting) return;
    var msg = state.message.trim();
    if (!msg) { flashError('Please add a short message first.'); return; }

    state.submitting = true;
    state.done = false;
    render();

    var payload = {
      category: state.category,
      message:  msg,
      context:  captureContext()   // hidden metadata travels with every report
    };

    try {
      var res = await fetch(resolveEndpoint(), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      onSuccess();
    } catch (err) {
      // Static hosting has no /api route and testers may be offline — don't
      // make them lose what they typed. Queue locally and still thank them;
      // the queue can be flushed to the real endpoint on a later session.
      queueOffline(payload);
      console.warn('[feedback] POST failed, queued locally:', err);
      onSuccess();
    }
  }

  function onSuccess() {
    state.submitting = false;
    state.done = true;
    render();
    setTimeout(function () {
      close();
      // Reset for the next report once the modal has closed.
      state.message = '';
      state.category = 'bug';
      state.done = false;
    }, SUCCESS_CLOSE_MS);
  }

  function queueOffline(payload) {
    try {
      var q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      q.push(payload);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50))); // cap growth
    } catch (e) { /* storage full / disabled — best effort only */ }
  }

  function flashError(text) {
    var el = document.getElementById('bgfb-error');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
  }

  // ── DOM construction ────────────────────────────────────────────────────
  function injectStyles() {
    var css = '' +
      '#bgfb-fab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483000;' +
        'display:flex;align-items:center;gap:6px;padding:9px 11px 9px 13px;cursor:pointer;' +
        'background:rgba(13,31,16,0.92);color:var(--gold,#c9a84c);border:1px solid rgba(201,168,76,0.45);' +
        'border-right:none;border-radius:8px 0 0 8px;font-family:"Cinzel",Georgia,serif;font-size:0.62rem;' +
        'letter-spacing:1.5px;text-transform:uppercase;writing-mode:vertical-rl;text-orientation:mixed;' +
        'box-shadow:0 4px 18px rgba(0,0,0,0.45);transition:background .2s,padding .2s;user-select:none}' +
      '#bgfb-fab:hover{background:rgba(201,168,76,0.16);padding-right:15px}' +
      '#bgfb-fab .bgfb-ico{writing-mode:horizontal-tb;font-size:0.95rem;line-height:1}' +

      '#bgfb-overlay{position:fixed;inset:0;z-index:2147483100;display:none;' +
        'background:rgba(0,0,0,0.86);backdrop-filter:blur(2px);' +
        'align-items:center;justify-content:center;padding:20px}' +
      '#bgfb-overlay.show{display:flex}' +

      '.bgfb-modal{width:100%;max-width:430px;background:linear-gradient(180deg,#13230f,#0b1a0c);' +
        'border:1px solid rgba(201,168,76,0.4);border-radius:12px;padding:22px 22px 20px;' +
        'box-shadow:0 24px 60px rgba(0,0,0,0.6);color:#f0e6c8;' +
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.bgfb-modal h2{font-family:"Cinzel",Georgia,serif;color:var(--gold,#c9a84c);font-size:1.1rem;' +
        'letter-spacing:2px;margin:0 0 4px;text-align:center}' +
      '.bgfb-modal .bgfb-sub{color:rgba(240,230,200,0.5);font-size:0.74rem;text-align:center;margin:0 0 16px}' +
      '.bgfb-modal label{display:block;font-size:0.68rem;letter-spacing:1px;text-transform:uppercase;' +
        'color:rgba(240,230,200,0.6);margin:0 0 6px}' +
      '.bgfb-field{margin-bottom:14px}' +
      '.bgfb-modal select,.bgfb-modal textarea{width:100%;box-sizing:border-box;background:rgba(0,0,0,0.35);' +
        'border:1px solid rgba(201,168,76,0.35);border-radius:6px;color:#f0e6c8;font-size:0.9rem;' +
        'padding:10px 11px;font-family:inherit}' +
      '.bgfb-modal textarea{resize:vertical;min-height:96px}' +
      '.bgfb-modal select:focus,.bgfb-modal textarea:focus{outline:none;border-color:var(--gold,#c9a84c)}' +

      '#bgfb-error{display:none;color:#e7a; font-size:0.74rem;margin:-6px 0 12px}' +

      '.bgfb-actions{display:flex;gap:10px;margin-top:4px}' +
      '.bgfb-btn{flex:1;padding:11px 12px;border-radius:6px;font-family:"Cinzel",Georgia,serif;' +
        'font-size:0.72rem;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;border:1px solid}' +
      '.bgfb-cancel{background:transparent;border-color:rgba(240,230,200,0.25);color:rgba(240,230,200,0.7)}' +
      '.bgfb-cancel:hover{background:rgba(255,255,255,0.05)}' +
      '.bgfb-submit{background:var(--gold,#c9a84c);border-color:var(--gold,#c9a84c);color:#1a1206;font-weight:700}' +
      '.bgfb-submit:hover{filter:brightness(1.08)}' +
      '.bgfb-submit:disabled{opacity:0.55;cursor:not-allowed;filter:none}' +

      '.bgfb-success{text-align:center;padding:18px 4px 10px}' +
      '.bgfb-success .bgfb-check{font-size:2.4rem;line-height:1}' +
      '.bgfb-success p{font-family:"Cinzel",Georgia,serif;color:var(--gold,#c9a84c);' +
        'letter-spacing:1.5px;margin:10px 0 0;font-size:0.95rem}' +
      '@media (max-width:480px){#bgfb-fab{font-size:0.56rem;padding:8px 9px}}';

    var tag = document.createElement('style');
    tag.id = 'bgfb-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function buildDom() {
    // Floating action button (trigger).
    var fab = document.createElement('button');
    fab.id = 'bgfb-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Send feedback or report a bug');
    fab.innerHTML = '<span class="bgfb-ico">🐞</span><span>Feedback</span>';
    fab.addEventListener('click', open);

    // Overlay + modal.
    var overlay = document.createElement('div');
    overlay.id = 'bgfb-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Feedback');
    // Click on the dimmed backdrop (not the modal itself) closes.
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    overlay.innerHTML =
      '<div class="bgfb-modal" id="bgfb-modal">' +
        '<div id="bgfb-form-view">' +
          '<h2>Tell Us Anything</h2>' +
          '<p class="bgfb-sub">Spotted a bug or have an idea? We read every note.</p>' +
          '<div class="bgfb-field">' +
            '<label for="bgfb-cat">Category</label>' +
            '<select id="bgfb-cat">' +
              CATEGORIES.map(function (c) {
                return '<option value="' + c.value + '">' + c.label + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="bgfb-field">' +
            '<label for="bgfb-msg">Your message</label>' +
            '<textarea id="bgfb-msg" placeholder="What happened, or what would you change?"></textarea>' +
          '</div>' +
          '<div id="bgfb-error"></div>' +
          '<div class="bgfb-actions">' +
            '<button type="button" class="bgfb-btn bgfb-cancel" id="bgfb-cancel">Cancel</button>' +
            '<button type="button" class="bgfb-btn bgfb-submit" id="bgfb-submit">Send</button>' +
          '</div>' +
        '</div>' +
        '<div class="bgfb-success" id="bgfb-success-view" style="display:none">' +
          '<div class="bgfb-check">✅</div>' +
          '<p>Thanks for your feedback!</p>' +
        '</div>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(overlay);

    // Wire inputs to state.
    var cat = overlay.querySelector('#bgfb-cat');
    var msg = overlay.querySelector('#bgfb-msg');
    cat.addEventListener('change', function () { state.category = cat.value; });
    msg.addEventListener('input', function () {
      state.message = msg.value;
      var err = document.getElementById('bgfb-error');
      if (err) err.style.display = 'none';
    });
    overlay.querySelector('#bgfb-cancel').addEventListener('click', close);
    overlay.querySelector('#bgfb-submit').addEventListener('click', submitFeedback);

    // Esc closes the modal.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) close();
    });
  }

  // ── Render (sync DOM to state) ──────────────────────────────────────────
  function render() {
    var overlay = document.getElementById('bgfb-overlay');
    if (!overlay) return;
    overlay.classList.toggle('show', state.open);

    var formView = document.getElementById('bgfb-form-view');
    var successView = document.getElementById('bgfb-success-view');
    formView.style.display = state.done ? 'none' : 'block';
    successView.style.display = state.done ? 'block' : 'none';

    var cat = document.getElementById('bgfb-cat');
    var msg = document.getElementById('bgfb-msg');
    if (cat) cat.value = state.category;
    if (msg) msg.value = state.message;

    var submit = document.getElementById('bgfb-submit');
    if (submit) {
      submit.disabled = state.submitting;
      submit.textContent = state.submitting ? 'Sending…' : 'Send';
    }
  }

  function open() {
    state.open = true;
    state.done = false;
    var err = document.getElementById('bgfb-error');
    if (err) err.style.display = 'none';
    render();
    var msg = document.getElementById('bgfb-msg');
    if (msg) setTimeout(function () { msg.focus(); }, 30);
  }

  function close() {
    state.open = false;
    render();
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    buildDom();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose a tiny API so a settings-menu item can also open it, and so tests
  // can drive it without simulating clicks.
  window.bgFeedback = { open: open, close: close, capture: captureContext };
})();
