//
// ═══════════════════════════════════════════════════════════════════
//   BOOK-PROMO.JS — "Road to Nine" cross-page promotion module
//
//   Single source of truth for the Amazon URL, dismissal/cooldown
//   logic, and the outbound deep-link handler.
//
//   Active triggers (per product direction "only advertise the book
//   when somebody reaches zero credit or has played 15min without
//   logging in"):
//     • Zero-credit modal — fires when balance hits 0 from a
//       winning state (covers all road-to-* variants + main game).
//     • Idle-anonymous modal — fires once after 15 min of session
//       time IF the user is not signed in.
//
//   Always-on content surfaces (NOT triggered ads — kept):
//     • baccarat-guide.html — permanent strategy block
//     • book.html             — book sales page
//
//   Removed in this revision (per "only advertise when X or Y"):
//     • Home banner on stage-select.html
//     • Post-win 5-streak modal in baccarat-game.html
//
//   Bonus: also overrides the buggy global `recordHiscore` defined
//   in add-hiscores.js — every road-to-* page already loads this
//   module, so the patch reaches everywhere without per-file edits.
//
//   Persistence (cross-page, persistent across launches):
//     localStorage   bg_book_promo_dismissed_until  → ISO date.
//                   While now < this, NO modal/banner renders.
//     sessionStorage bg_book_modal_shown            → flag.
//                   Prevents the post-win modal from firing twice
//                   in the same session.
//
//   Apple App Store note:
//     window.open(URL, '_blank') in a Capacitor WKWebView opens the
//     URL in iOS Safari because amazon.com is not in
//     WKAppBoundDomains. That's the policy-safe path for outbound
//     links to physical/Kindle books (reader app exception).
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const AMAZON_URL =
    'https://www.amazon.com/Road-Nine-Baccarat-Gladiator-Guide/dp/B0GZ9CQ41Y';

  const DISMISS_KEY  = 'bg_book_promo_dismissed_until';
  const SESSION_KEY  = 'bg_book_modal_shown';
  const COOLDOWN_MS  = 7 * 24 * 60 * 60 * 1000;   // 7 days

  // ── State helpers ────────────────────────────────────────────
  function readDismissedUntil() {
    try {
      const v = localStorage.getItem(DISMISS_KEY);
      return v ? new Date(v) : null;
    } catch (_) { return null; }
  }

  function dismiss() {
    try {
      const until = new Date(Date.now() + COOLDOWN_MS).toISOString();
      localStorage.setItem(DISMISS_KEY, until);
    } catch (_) { /* private mode or storage full — fail soft */ }
  }

  function canShow() {
    const until = readDismissedUntil();
    if (!until) return true;
    return Date.now() >= until.getTime();
  }

  function markModalShownThisSession() {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
  }

  function modalAlreadyShownThisSession() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; }
    catch (_) { return false; }
  }

  // ── Deep link to Amazon ──────────────────────────────────────
  // Uses _blank so iOS Safari (or the Android system browser) handles
  // the URL — keeps the app webview pinned to baccaratgladiator.com.
  function openAmazon(source) {
    try {
      localStorage.setItem('bg_book_clicked_at', new Date().toISOString());
      if (source) localStorage.setItem('bg_book_clicked_source', source);
    } catch (_) {}
    window.open(AMAZON_URL, '_blank', 'noopener,noreferrer');
  }

  // ── Auth check — is the user signed in via Cognito? ─────────
  // The game's Cognito auth flow persists tokens to localStorage
  // under bg_cognito_tokens_v1. If that key is absent or empty,
  // the player is browsing anonymously.
  function isLoggedIn() {
    try {
      const raw = localStorage.getItem('bg_cognito_tokens_v1');
      if (!raw) return false;
      const t = JSON.parse(raw);
      return !!(t && (t.idToken || t.accessToken));
    } catch (_) { return false; }
  }

  // ── Trigger #1 : Zero-credit modal ──────────────────────────
  // Fires the moment the player's balance hits zero from a
  // winning state. Covers all road-to-* variants AND the main
  // game — the credits display ID varies by file:
  //   • baccarat-game.html      → #hdr-balance + #bal-display
  //   • road-to-cat-cafe / macau / huff-puff / etc. → #bal-val
  function wireZeroCreditModal(opts) {
    const cfg = Object.assign({
      balanceSelector: '#hdr-balance, #bal-display, #bal-val',
      modalId:         'book-zero-credit-modal',
    }, opts || {});

    const balEl = document.querySelector(cfg.balanceSelector);
    if (!balEl) return;

    function parseDollars(text) {
      const m = String(text || '').match(/-?\d[\d,]*/);
      return m ? parseInt(m[0].replace(/,/g, ''), 10) : NaN;
    }

    let lastBalance = parseDollars(balEl.textContent);

    new MutationObserver(() => {
      const cur = parseDollars(balEl.textContent);
      if (isNaN(cur)) return;
      if (isNaN(lastBalance)) { lastBalance = cur; return; }

      // Fire only when balance just crossed to zero (or below) from
      // a positive state — not on initial load with $0, not on a
      // top-up that brings it back up.
      const wasPositive = lastBalance > 0;
      const nowZero     = cur <= 0;
      if (wasPositive && nowZero) maybeShow();
      lastBalance = cur;
    }).observe(balEl, { childList: true, characterData: true, subtree: true });

    function maybeShow() {
      if (!canShow()) return;
      if (modalAlreadyShownThisSession()) return;
      markModalShownThisSession();
      showModal({
        id: cfg.modalId,
        source: 'zero_credit_modal',
        pre: '⚔ EVERY PRO HAS BEEN HERE',
        title: 'Down to Zero. Time to Study.',
        body: 'Even the best players bust a roll. <strong>Road to Nine</strong> teaches bankroll discipline, ' +
              'when to walk away from a cold shoe, and the math behind every call at the felt.',
        cta:  '📖 Read the Book',
      });
    }
  }

  // ── Trigger #2 : Idle-anonymous timer modal ─────────────────
  // Single setTimeout fires after `minutes` of session time. If
  // the user has signed in by then, no-op. If still anonymous,
  // show the book pitch (subject to canShow + once-per-session).
  function wireIdleAnonymousModal(opts) {
    const cfg = Object.assign({
      minutes: 15,
      modalId: 'book-idle-modal',
    }, opts || {});

    setTimeout(function () {
      if (isLoggedIn())                    return;
      if (!canShow())                      return;
      if (modalAlreadyShownThisSession())  return;
      markModalShownThisSession();
      showModal({
        id: cfg.modalId,
        source: 'idle_anonymous_modal',
        pre: '★ ' + cfg.minutes + ' MINUTES IN ★',
        title: 'Want the Playbook?',
        body: "You've played long enough to spot the patterns. <strong>Road to Nine</strong> breaks down all five " +
              'road maps, the squeeze ritual, and the math behind every side-bet edge — the layer most players never see.',
        cta:  '📖 Get the Book',
      });
    }, cfg.minutes * 60 * 1000);
  }

  // ── Shared modal renderer ────────────────────────────────────
  // Both the post-win and low-bankroll modals use this. The opts
  // object carries the variant-specific copy so the visual chrome
  // and dismiss behavior stay consistent.
  function showModal(opts) {
    if (document.getElementById(opts.id)) return;
    const m = document.createElement('div');
    m.id = opts.id;
    m.className = 'bg-book-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `
      <div class="bg-book-modal-card">
        <button class="bg-book-modal-close" aria-label="Close" data-action="dismiss">×</button>
        <div class="bg-book-modal-pre">${opts.pre}</div>
        <div class="bg-book-modal-cover" aria-hidden="true">
          <img src="/bg-card.png" alt="">
        </div>
        <h2 class="bg-book-modal-title">${opts.title}</h2>
        <p class="bg-book-modal-body">${opts.body}</p>
        <button class="bg-book-modal-cta" data-action="buy">${opts.cta}</button>
        <div class="bg-book-modal-foot">Kindle <strong>FREE for a limited time</strong> · Paperback $19.99</div>
        <button class="bg-book-modal-later" data-action="dismiss">Maybe later</button>
      </div>`;
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('open'));

    m.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action && e.target !== m) return;
      if (action === 'buy') openAmazon(opts.source);
      // any dismiss action — and clicking the backdrop — applies the
      // 7-day cooldown so the user is never re-pitched immediately.
      dismiss();
      m.classList.remove('open');
      setTimeout(() => m.remove(), 300);
    });
  }

  // ── Hiscore patch ────────────────────────────────────────────
  // The legacy recordHiscore (defined inline in every road-to-*.html
  // and in add-hiscores.js) pushes EVERY winning hand to the top-10
  // list, then sorts and trims. Result: 10 wins of similar amounts
  // become 10 leaderboard entries — a "trail" of near-duplicates
  // instead of one entry per stage.
  //
  // Patch: keep one entry per stage; new wins only update if they
  // beat the player's prior best on that stage. We override the
  // global at runtime so all 60+ road-to files inherit the fix
  // through the existing book-promo.js script tag — no per-file
  // edit required.
  function patchRecordHiscore() {
    if (typeof window.recordHiscore !== 'function') return;
    if (window.recordHiscore.__bgPatched) return;          // idempotent
    const KEY = 'bg_hiscores';
    const LIMIT = 10;
    const variantSlug = (location.pathname.match(/road-to-([a-z0-9-]+)\.html/i) || [])[1] || 'unknown';
    const load = () => {
      try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
      catch (_) { return []; }
    };
    const save = (l) => {
      try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, LIMIT))); }
      catch (_) {}
    };
    const patched = function (amount, slug) {
      if (!Number.isFinite(amount) || amount <= 0) return;
      const stageSlug = slug || variantSlug;
      const list = load();
      const existingIdx = list.findIndex(e => e && e.slug === stageSlug);
      if (existingIdx >= 0) {
        if (amount <= list[existingIdx].amount) return;
        list[existingIdx] = { amount, slug: stageSlug, ts: Date.now() };
      } else {
        list.push({ amount, slug: stageSlug, ts: Date.now() });
      }
      list.sort((a, b) => b.amount - a.amount);
      save(list);
      if (typeof window.renderHiscores === 'function') window.renderHiscores();
    };
    patched.__bgPatched = true;
    window.recordHiscore = patched;

    // Heal any "trail" already accumulated in localStorage by
    // collapsing duplicate-slug entries down to the single highest.
    const list = load();
    const dedup = {};
    for (const e of list) {
      if (!e || !e.slug) continue;
      if (!dedup[e.slug] || e.amount > dedup[e.slug].amount) dedup[e.slug] = e;
    }
    const cleaned = Object.values(dedup).sort((a, b) => b.amount - a.amount);
    if (cleaned.length !== list.length) {
      save(cleaned);
      if (typeof window.renderHiscores === 'function') window.renderHiscores();
    }
  }

  // ── Public surface ───────────────────────────────────────────
  window.BookPromo = {
    AMAZON_URL,
    openAmazon,
    canShow,
    dismiss,
    isLoggedIn,
    wireZeroCreditModal,
    wireIdleAnonymousModal,
    patchRecordHiscore,
  };

  // ── Self-contained CSS injection ─────────────────────────────
  // Inline the modal styles inside the module so any page that
  // imports book-promo.js gets the rendering "for free" — no per-
  // page CSS dup. Critical for the 60+ bespoke road-to-*.html
  // game variants where we want one-line integration:
  //     <script src="/book-promo.js"></script>
  function injectStyles() {
    if (document.getElementById('bg-book-promo-styles')) return;
    const style = document.createElement('style');
    style.id = 'bg-book-promo-styles';
    style.textContent = `
      .bg-book-modal {
        position:fixed; inset:0; z-index:9500;
        display:flex; align-items:center; justify-content:center;
        padding:20px;
        background:radial-gradient(ellipse 80% 60% at 50% 30%, rgba(201,168,76,.18), transparent 55%),
                   rgba(2,6,3,.86);
        opacity:0; transition:opacity .28s ease;
        font-family:'Raleway',-apple-system,sans-serif;
      }
      .bg-book-modal.open { opacity:1; }
      .bg-book-modal-card {
        position:relative; width:min(420px, 92vw);
        background:linear-gradient(180deg,#0d1f10 0%,#06120a 60%,#040806 100%);
        border:1px solid rgba(201,168,76,.5);
        border-radius:16px; padding:24px 24px 20px;
        text-align:center; color:#fff7d6;
        box-shadow:0 16px 56px rgba(0,0,0,.7), 0 0 70px rgba(201,168,76,.25);
        transform:translateY(12px) scale(.96);
        transition:transform .35s cubic-bezier(.16,1,.3,1);
      }
      .bg-book-modal.open .bg-book-modal-card { transform:translateY(0) scale(1); }
      .bg-book-modal-close {
        position:absolute; top:8px; right:12px;
        background:none; border:none; color:rgba(255,247,214,.4);
        font-size:1.6rem; line-height:1; cursor:pointer; padding:6px 10px;
      }
      .bg-book-modal-close:hover { color:#fff7d6; }
      .bg-book-modal-pre {
        font-family:'Cinzel',serif; font-size:.62rem; letter-spacing:.36em;
        color:#f0d080; margin-bottom:14px;
        text-shadow:0 0 12px rgba(255,180,40,.55);
      }
      .bg-book-modal-cover { display:inline-block; margin-bottom:14px;
        filter:drop-shadow(0 6px 16px rgba(0,0,0,.6)); }
      .bg-book-modal-cover img { width:96px; height:auto; border-radius:5px; display:block; }
      .bg-book-modal-title {
        font-family:'Cinzel',serif; font-size:1.25rem; font-weight:900;
        letter-spacing:.05em; color:#f0d080; margin:0 0 10px;
      }
      .bg-book-modal-body {
        font-size:.86rem; line-height:1.55;
        color:rgba(255,247,214,.78); margin:0 0 18px;
      }
      .bg-book-modal-cta {
        display:block; width:100%;
        background:linear-gradient(135deg,#c9a84c 0%,#f0d080 50%,#c9a84c 100%);
        background-size:200% auto; color:#1a0e00; border:none;
        font-family:'Cinzel',serif; font-size:.86rem; font-weight:700;
        letter-spacing:.16em; text-transform:uppercase;
        padding:13px; border-radius:6px; cursor:pointer;
        transition:background-position .35s, transform .15s;
      }
      .bg-book-modal-cta:hover { background-position:right center; transform:translateY(-1px); }
      .bg-book-modal-foot {
        margin-top:12px; font-size:.7rem; letter-spacing:.04em;
        color:rgba(255,247,214,.55);
      }
      .bg-book-modal-later {
        margin-top:6px; background:none; border:none;
        font-family:'Raleway',sans-serif; font-size:.75rem;
        letter-spacing:.06em; color:rgba(255,247,214,.45);
        cursor:pointer; padding:8px;
      }
      .bg-book-modal-later:hover { color:rgba(255,247,214,.75); }
    `;
    document.head.appendChild(style);
  }

  // ── Auto-install on DOMContentLoaded ─────────────────────────
  // Per product direction "only advertise when somebody reaches
  // zero credit or has played 15min without login":
  //   • CSS injected (idempotent)
  //   • Hiscore "trail" patch applied (only takes effect if
  //     window.recordHiscore is defined on the page)
  //   • Zero-credit modal wired (no-op if no balance element)
  //   • Idle-anonymous timer started (15 min; no-op if user
  //     signs in before it fires)
  function autoInstall() {
    injectStyles();
    patchRecordHiscore();
    wireZeroCreditModal();
    wireIdleAnonymousModal();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInstall);
  } else {
    autoInstall();
  }
})();
