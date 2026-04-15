// ─────────────────────────────────────────────────────────────────────────
// BaccaratGladiator — Chip Store Frontend
// Paste this into baccarat-scoreboard.html and bj/index.html
// Replace CREATE_CHECKOUT_URL with the output from deploy.sh
// ─────────────────────────────────────────────────────────────────────────

const CHIP_STORE_CONFIG = {
  createCheckoutUrl: 'YOUR_CREATE_CHECKOUT_URL_FROM_DEPLOY',  // ← replace after deploy
  publishableKey:    'pk_live_51TMJpFBT3VjIWbLKKP07ydVqVv08dLixW9y17tO9OXZyDsJC0PcG9kKM1ma1KDJA6AA9ApLUza4h6wPrkQlrf6Qx00heIpXqsm',
  game:              'baccarat',  // or 'blackjack' — set per-page
};

const CHIP_PACKAGES = [
  { id: 'starter',     name: 'Starter Pack',  chips: 2500,   price: '$1.99', bonus: '',      popular: false },
  { id: 'popular',     name: 'Popular Pack',  chips: 7500,   price: '$4.99', bonus: '+20%',  popular: true  },
  { id: 'value',       name: 'Value Pack',    chips: 17500,  price: '$9.99', bonus: '+40%',  popular: false },
  { id: 'best_deal',   name: 'Best Deal',     chips: 40000,  price: '$19.99',bonus: '+60%',  popular: false },
  { id: 'high_roller', name: 'High Roller',   chips: 125000, price: '$49.99',bonus: '+100%', popular: false },
];

// ── Open chip store modal ──────────────────────────────────────────────────
function openChipStore() {
  // Remove existing modal if any
  const existing = document.getElementById('chip-store-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'chip-store-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  modal.innerHTML = `
    <div style="background:#1a1a2e;border:1px solid #c9a84c;border-radius:12px;
                max-width:520px;width:100%;padding:28px;position:relative;color:#fff;">
      <button onclick="document.getElementById('chip-store-modal').remove()"
        style="position:absolute;top:12px;right:16px;background:none;border:none;
               color:#888;font-size:22px;cursor:pointer;line-height:1;">✕</button>

      <h2 style="text-align:center;color:#c9a84c;margin:0 0 6px;">Chip Store</h2>
      <p style="text-align:center;color:#aaa;font-size:13px;margin:0 0 20px;">
        Chips are for entertainment only · No cash value · No payouts
      </p>

      <div id="chip-store-packages" style="display:flex;flex-direction:column;gap:10px;">
        ${CHIP_PACKAGES.map(pkg => `
          <button onclick="purchasePackage('${pkg.id}')"
            style="display:flex;align-items:center;justify-content:space-between;
                   background:${pkg.popular ? '#2a2040' : '#16213e'};
                   border:${pkg.popular ? '2px solid #c9a84c' : '1px solid #333'};
                   border-radius:8px;padding:14px 16px;cursor:pointer;color:#fff;
                   position:relative;transition:background 0.2s;">
            ${pkg.popular ? '<span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#c9a84c;color:#000;font-size:11px;font-weight:700;padding:2px 10px;border-radius:10px;">MOST POPULAR</span>' : ''}
            <div style="text-align:left;">
              <div style="font-weight:600;font-size:15px;">${pkg.name}</div>
              <div style="color:#c9a84c;font-size:18px;font-weight:700;">
                🪙 ${pkg.chips.toLocaleString()} chips
                ${pkg.bonus ? `<span style="font-size:12px;background:#2d5a27;color:#7eff7e;padding:2px 6px;border-radius:4px;margin-left:6px;">${pkg.bonus}</span>` : ''}
              </div>
            </div>
            <div style="font-size:20px;font-weight:700;color:#fff;white-space:nowrap;">
              ${pkg.price}
            </div>
          </button>
        `).join('')}
      </div>

      <p style="text-align:center;color:#555;font-size:11px;margin:16px 0 0;">
        Secured by Stripe · Purchases are final · 18+ only
      </p>
    </div>
  `;

  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// ── Initiate purchase ─────────────────────────────────────────────────────
async function purchasePackage(packageId) {
  const btn = event.currentTarget;
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.7';

  try {
    const res = await fetch(CHIP_STORE_CONFIG.createCheckoutUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        packageId,
        game:      CHIP_STORE_CONFIG.game,
        sessionId: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
      }),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const { url } = await res.json();
    window.location.href = url;  // redirect to Stripe checkout

  } catch (err) {
    console.error('Checkout error:', err);
    alert('Could not start checkout. Please try again.');
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// ── Handle return from Stripe ─────────────────────────────────────────────
// Called once on page load — checks URL params for purchase result
function handlePurchaseReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('purchase');
  const chips  = parseInt(params.get('chips') || '0', 10);

  if (!status) return;

  // Clean URL without reloading
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);

  if (status === 'success' && chips > 0) {
    // Credit chips — replace `balance` with your game's balance variable name
    if (typeof balance !== 'undefined') {
      balance += chips;
      updateBalanceDisplay?.();  // call your existing display update fn if present
    }

    // Show success message
    showPurchaseSuccess(chips);
  } else if (status === 'cancelled') {
    // User cancelled — optionally show a soft message
    console.log('Purchase cancelled by user');
  }
}

function showPurchaseSuccess(chips) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;top:24px;left:50%;transform:translateX(-50%);
    background:#1a3a1a;border:2px solid #4caf50;border-radius:10px;
    padding:16px 28px;color:#fff;font-size:16px;font-weight:600;
    z-index:10000;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5);
  `;
  toast.innerHTML = `🎉 ${chips.toLocaleString()} chips added to your balance!`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// Run on page load
handlePurchaseReturn();
