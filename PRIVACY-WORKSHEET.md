# Baccarat Gladiator — App Privacy Worksheet (App Store Connect)

> **Purpose.** This is a one-to-one mapping from the live app's actual data
> flows to the questions Apple asks when you configure App Privacy in App
> Store Connect (Privacy → App Privacy → Data Types). Fill in every
> category Apple lists; for each, the row below answers:
>   - **Collected?** (Yes / No)
>   - **Linked to user identity?**
>   - **Used to track?** (per ATT definition)
>   - **Purposes** (App Functionality / Analytics / Product Personalization /
>     Developer Marketing / Third-Party Advertising / Other)
>
> **Last updated:** 2026-05-19 (matches `responsible-play.html` effective date)
> **Source of truth:** code grep of `localStorage`, `sessionStorage`,
> `fetch`, external `<script src>` references across the live web bundle.

---

## TL;DR — what Apple will hear

> Baccarat Gladiator collects an email address (for sign-in) and gameplay
> records (scores, cleared stages, tournament bet history) linked to a user
> ID. We do not track. We do not use third-party advertising SDKs (yet).
> We do not collect location, contacts, photos, microphone, camera, or
> health data. All data is used solely for app functionality.

---

## 1. CONTACT INFO

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Name | **No** | — | — | — | Sign-up flow does not request a display name; leaderboard uses an in-game handle, not a real name |
| **Email address** | **Yes** | **Yes** | No | App Functionality | AWS Cognito sign-up; `baccarat-game.html:3601` writes to `AUTH_PROFILE_KEY` locally, and Cognito stores it remotely |
| Phone number | No | — | — | — | Never requested |
| Physical address | No | — | — | — | Never requested |
| Other user contact info | No | — | — | — | — |

## 2. HEALTH & FITNESS

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Health | No | — | — | — | App does not access HealthKit |
| Fitness | No | — | — | — | App does not access HealthKit |

## 3. FINANCIAL INFO

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Payment info | No | — | — | — | IAP is handled by Apple; we never see card data. Stripe (web) is also out-of-band — we receive a charge confirmation only |
| Credit info | No | — | — | — | — |
| Other financial info | No | — | — | — | — |

## 4. LOCATION

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Precise location | No | — | — | — | App does not use CoreLocation |
| Coarse location | **No (with caveat)** | — | — | — | The web build calls `ipapi.co/json` from `baccarat-scoreboard.html:5707` and `bj/index.html:997` to detect country for compliance/region UI. **No data is stored by us.** ipapi.co receives the user's IP (necessary by network protocol) and returns the country code. Per Apple's App Privacy guidance, data we *don't store and don't transmit on behalf of analytics* is not "collected." **Confirm before submit:** is the iOS Capacitor build calling this endpoint? If yes, the call still does not "collect" location on our behalf, but you may want to disclose it as Coarse Location → App Functionality → Not Linked, just to be conservative. See §10 "Third parties" |

## 5. SENSITIVE INFO

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Sensitive info (race, sexual orientation, etc.) | No | — | — | — | — |

## 6. CONTACTS

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Contacts | No | — | — | — | App does not request the Contacts entitlement |

## 7. USER CONTENT

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Emails or text messages | No | — | — | — | — |
| Photos or videos | No | — | — | — | — |
| Audio | No | — | — | — | — |
| **Gameplay content** | **Yes** | **Yes** | No | App Functionality | High scores + cleared stages submitted to Lambda API (`apiBaseUrl: https://xr68waxn2h.execute-api.us-east-1.amazonaws.com` in `baccarat-game.html:3101`). Tournament bet history submitted on tournament entry. Also: Firebase RTDB on `baccarat-scoreboard.html` + `tournament/index.html` for leaderboard fan-out |
| Customer support | No | — | — | — | We use plain email (frankie@styleiq.co); not collected in-app |
| Other user content | No | — | — | — | — |

## 8. BROWSING HISTORY

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Browsing history | No | — | — | — | — |

## 9. SEARCH HISTORY

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Search history | No | — | — | — | — |

## 10. IDENTIFIERS

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| **User ID** | **Yes** | **Yes** | No | App Functionality | Cognito user sub (a UUID) is issued at sign-up and attached to every leaderboard / tournament submission |
| Device ID | No | — | — | — | We do not request IDFA. No `ATTrackingManager` calls. No Google Advertising ID equivalent |

## 11. PURCHASES

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| **Purchase history** | **Yes (when IAP ships)** | **Yes** | No | App Functionality | Once IAP is enabled, Apple delivers receipt validation; we will record which coin pack was purchased so we can grant the corresponding coin balance. Linked to user ID. **Update this row before submission once the IAP product IDs are configured.** |

## 12. USAGE DATA

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Product interaction | **No** | — | — | — | No analytics SDK in the bundle. We do not record taps, swipes, screen views, session length, or feature usage. The leaderboard captures *gameplay outcomes* only (see §7), not interaction telemetry |
| Advertising data | No | — | — | — | No ad SDK installed yet. **Update this row once rewarded video is added (e.g. AppLovin MAX) — rewarded ads typically introduce Advertising Data → Third-Party Advertising → Not Linked → Used for tracking unless you configure SKAdNetwork-only mode** |
| Other usage data | No | — | — | — | — |

## 13. DIAGNOSTICS

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Crash data | No | — | — | — | No Sentry, no Crashlytics. **Recommend adding crash reporting before public launch** — if added, declare as Diagnostics → Crash Data → Not Linked → App Functionality (Sentry can run in non-PII mode) |
| Performance data | No | — | — | — | — |
| Other diagnostic data | No | — | — | — | — |

## 14. OTHER DATA

| Data type | Collected? | Linked? | Tracking? | Purpose | Evidence |
|-----------|-----------|---------|-----------|---------|----------|
| Other data types | No | — | — | — | — |

---

## On-device-only data (NOT reportable to Apple — for your reference)

Apple's "App Privacy" framework asks about data that *leaves the device*.
The items below stay on the device and do not need to be declared, but are
listed here so you have a complete record.

### localStorage keys

| Key | Where | Purpose |
|-----|-------|---------|
| `bg_age_confirmed`, `age_gate_passed`, `responsible_gaming_ack` | Age gate (`check-scoreboard.js`, `test-theme-smoke.js`) | Records that user passed the age gate |
| `bg_cleared_tiers`, `bg_visited_slugs` | `stage-select.html`, `index.html` | Saved progression — which tiers the user has cleared |
| `AUTH_PROFILE_KEY`, `AUTH_TOK_KEY` | `baccarat-game.html` | Locally-cached copy of the Cognito session for offline reads (the *server* copy is the source of truth) |
| `bg_pkce_verifier` | `baccarat-game.html` | OAuth PKCE flow temporary verifier — deleted after the auth redirect resolves |
| `ECONOMY_KEY` (coin balance) | `baccarat-game.html` | Local virtual-currency balance |
| `HISCORE_KEY` | `add-hiscores.js` | Local-only high-score cache used by road-to-* variants |
| `bg_book_promo_dismissed_until` | `book-promo.js` | Dismissal cooldown for the book promo |
| `bg_reader_email` | `guide-download.html` | Email entered into the book download form — only used to pre-fill the same form on return |
| `bgCasinoXP`, `bgSelectedCasino` | `baccarat-game.html` | Local progression stats |
| `rtn_sfx`, `rtn_haptics`, `rtn_squeeze`, `rtn_theme`, `tut-lang`, `bjg_21_v1` | Various pages | Audio/haptic preferences and tutorial language |

### sessionStorage keys

| Key | Purpose |
|-----|---------|
| `bg_auth_redirect_pending`, `bg_skip_splash_once` | OAuth round-trip state machine |
| `bg_book_modal_shown` | Per-session de-dup for book promo modal |
| `tourn-dismissed` | Per-session tournament prompt dismissal |
| `bjg_21_v1` | BJ variant tutorial-seen flag |

---

## Third parties the app talks to

These are services that may receive data; some are first-party Apple-required
disclosures, others are Apple-style "third-party SDK" disclosures that Apple
*does not* surface in the App Privacy questionnaire but that you should be
aware of for the Privacy Manifest (Required Reasons API + SDK SDKs list).

| Service | What it receives | First-party / Third-party | Used by | Privacy-manifest impact |
|---------|------------------|---------------------------|---------|-------------------------|
| **AWS Cognito** (cognito-idp.us-east-1.amazonaws.com) | Email, password hash, session tokens | First-party — our backend | Sign-in, account management | None — covered by §1 + §10 above |
| **AWS API Gateway → Lambda** (`xr68waxn2h.execute-api.us-east-1.amazonaws.com`) | User ID, score submissions, tournament bets | First-party — our backend | Leaderboard, tournament, profile | None — covered by §7 + §10 above |
| **Firebase Realtime Database** (`gstatic.com/firebasejs/10.7.1/*`) | User ID, leaderboard entries, tournament writes | Third-party JavaScript loaded at runtime from CDN | `baccarat-scoreboard.html`, `tournament/index.html`, `bj/index.html` (10.12.0) | **No native iOS Firebase SDK is bundled** — verified: `ios/App/Podfile` lists only Capacitor pods (no `pod 'Firebase*'`), and Firebase is loaded via `<script src="https://www.gstatic.com/firebasejs/...">` running inside WKWebView. Apple's "commonly used SDK" Privacy Manifest requirement (effective 2024-05-01) applies to **native binary SDKs in the `.app` bundle**, not to JavaScript fetched at runtime by a web view, so Firebase does *not* need to ship a `PrivacyInfo.xcprivacy` in our build. The data Firebase receives (User ID, gameplay entries) is already declared in §7 + §10 of this worksheet. Separate concern — **CSP**: per memory `reference_csp_self_host.md`, CloudFront sends `script-src 'self'`; check that the `gstatic.com` Firebase scripts either have a CSP exception or that you have self-hosted them. If they're silently failing in production, leaderboard writes are blocked. |
| **ipapi.co** (`https://ipapi.co/json/`) | User IP address (by network protocol) | Third-party | `baccarat-scoreboard.html:5707`, `bj/index.html:997` | Decide: keep for region UX, or replace with a server-side region lookup. If you keep it, mention in §4 above conservatively |
| **Google Fonts** (`fonts.googleapis.com`) | User IP, User-Agent | Third-party | Multiple pages | Standard web request — does not require declaration. For maximum compliance, self-host the fonts (per memory `reference_csp_self_host.md` — relevant) |
| **api.qrserver.com / chart.googleapis.com** | Just renders QR images for fixed URLs; receives only the URL + the requesting IP | Third-party | `baccarat-guide.html`, `print-manuscript.html` | Used only in print pages and the guide — does not affect the App Privacy answers |
| **Apple Service** (StoreKit) | Purchase receipts | First-party Apple | IAP once enabled | Apple handles its own disclosure |

---

## Privacy Manifest (PrivacyInfo.xcprivacy) — required for iOS submission

Apple requires a Privacy Manifest for any app submitted after May 1, 2024.
Confirm the following are in `ios/App/App/PrivacyInfo.xcprivacy` (or your
Capacitor wrapper's equivalent):

1. **`NSPrivacyTracking`** → `false` (we do not track per ATT definition)
2. **`NSPrivacyTrackingDomains`** → empty array
3. **`NSPrivacyCollectedDataTypes`** — entries that match this worksheet:
    - `NSPrivacyCollectedDataTypeEmailAddress` — purposes: `AppFunctionality`; linked: `true`; tracking: `false`
    - `NSPrivacyCollectedDataTypeUserID` — purposes: `AppFunctionality`; linked: `true`; tracking: `false`
    - `NSPrivacyCollectedDataTypeGameplayContent` — purposes: `AppFunctionality`; linked: `true`; tracking: `false`
    - (Add `NSPrivacyCollectedDataTypePurchaseHistory` once IAP is wired)
4. **`NSPrivacyAccessedAPITypes`** — Required Reasons API declarations:
    - `NSPrivacyAccessedAPICategoryUserDefaults` — reason `CA92.1` (access info available only to the app) — required because we read/write `UserDefaults`-equivalent storage
    - `NSPrivacyAccessedAPICategoryFileTimestamp`, `NSPrivacyAccessedAPICategorySystemBootTime`, `NSPrivacyAccessedAPICategoryDiskSpace` — declare only if any bundled SDK touches them. Capacitor itself triggers some — check the Capacitor + Firebase manifests
5. **SDK list** — Capacitor + WebKit + Firebase. Each should ship its own
   `PrivacyInfo.xcprivacy` inside its xcframework. Verify by building the app
   and checking the bundle.

---

## Pre-submission checklist

- [ ] All §1–§14 rows above match App Store Connect → App Privacy answers
- [ ] `PrivacyInfo.xcprivacy` exists in the iOS bundle
- [ ] Privacy Policy URL on App Store Connect → `https://baccaratgladiator.com/privacy.html`
- [ ] Support URL → `https://baccaratgladiator.com/support.html`
- [ ] Marketing URL → `https://baccaratgladiator.com/` (which is `stage-select.html`)
- [ ] Age rating questionnaire — see report §4.B for the "Infrequent/Mild Simulated Gambling" argument that yields 12+ vs 17+
- [x] Account deletion path — Apple Guideline 5.1.1(v) compliance shipped:
    - Frontend: "Delete" button in the header (visible only when signed in) → confirmation modal requiring user to type "DELETE" → calls `DELETE /account` → clears localStorage + sessionStorage + Cognito hosted-UI logout. See `baccarat-game.html`: header button at `#hdr-delete-btn`, modal at `#delete-acct-overlay`, JS functions `openDeleteAccountModal` / `performAccountDelete`.
    - Backend: `aws_s3/backend/lambda/delete_account.py` deletes the LeaderboardTable row, scans + deletes all TournamentScoresTable rows for the user's sub, and calls `cognito-idp:AdminDeleteUser`. The handler operates on the verified JWT sub only — clients cannot delete other users.
    - SAM template: `DeleteAccountFunction` resource added with both DynamoDB tables (Crud) + scoped Cognito `AdminDeleteUser` permission. CORS `AllowMethods` extended to include `DELETE`.
    - **Still requires:** deploying the updated SAM stack (`sam build && sam deploy` from `aws_s3/backend/`) and shipping `baccarat-game.html` to S3/CloudFront before submission.
- [ ] If IAP ships before submission, update §11 above and add to Privacy Manifest

---

## Re-run this checklist whenever you add an SDK

Any new third-party SDK (rewarded ads, crash reporting, analytics,
attribution) almost always adds new entries here. Re-grep the codebase and
update before each App Store submission:

```sh
grep -rn 'localStorage\|sessionStorage\|fetch(.*http\|XMLHttpRequest' \
  --include='*.html' --include='*.js' . \
  | grep -v 'node_modules\|.aws-sam\|/build/'
```
