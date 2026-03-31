# Baccarat Gladiator: App Store Readiness Checklist

## In-App Compliance Implemented
- 18+ age gate on first launch
- Simulated-play disclosure banner
- Explicit "virtual credits only / no real-money gambling" language
- Responsible-play footer messaging
- Privacy / Terms / Support link placeholders
- Reduced high-risk copy (removed aggressive all-in/death phrasing)

## Before Apple App Store Submission
- Provide a real `Privacy Policy` URL (currently `/privacy.html`)
- Provide a real `Terms of Use` URL (currently `/terms.html`)
- Set a live support email/URL (currently `support@baccaratgladiator.app` placeholder)
- Complete App Privacy details in App Store Connect (data collection + tracking)
- Set age rating and include "Simulated Gambling" where applicable
- Ensure no real-money gambling, cashout, or prize redemption flows exist
- Verify any in-app purchases are implemented with Apple IAP only

## Before Google Play Submission
- Publish real Privacy Policy and Terms URLs in Play Console
- Complete Data safety form accurately
- Confirm app is simulated gambling only (no real-money betting/cashout)
- Set appropriate content rating (includes gambling themes)
- Ensure billing uses Google Play Billing for digital purchases

## Recommended Store Listing Copy
- "Baccarat Gladiator is a simulated baccarat strategy and scoreboard experience."
- "Virtual credits only. No real-money gambling. No cash prizes or cashout."

## Optional Next Hardening (Recommended)
- Add self-exclusion timer (15m / 30m / 60m)
- Add optional session spend cap (virtual credits)
- Add local parental lock PIN for app entry
- Add moderation/rate-limit guardrails for leaderboard names
