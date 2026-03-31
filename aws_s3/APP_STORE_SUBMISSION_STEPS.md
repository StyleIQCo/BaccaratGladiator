# App Store Submission Steps (Baccarat Gladiator)

Last updated: March 31, 2026

## 1) Prepare Hosted Web Build
1. Upload these files to your production host (S3 + CloudFront or equivalent):
   - `baccarat-scoreboard.html`
   - `privacy.html`
   - `terms.html`
   - `support.html`
   - `splash-card-source.png`
   - `baccarat-link-preview.png`
2. Confirm URLs work publicly:
   - `https://<your-domain>/baccarat-scoreboard.html`
   - `https://<your-domain>/privacy.html`
   - `https://<your-domain>/terms.html`
   - `https://<your-domain>/support.html`

## 2) Wrap Web App As Native App (Capacitor)
1. In a new folder, initialize:
```bash
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "Baccarat Gladiator" "app.baccaratgladiator"
```
2. Set web entry URL in `capacitor.config.ts` using live URL:
```ts
server: {
  url: 'https://<your-domain>/baccarat-scoreboard.html',
  cleartext: false
}
```
3. Add platforms:
```bash
npx cap add ios
npx cap add android
```

## 3) iOS (Apple App Store)
1. Open iOS project:
```bash
npx cap open ios
```
2. In Xcode:
   - Set Bundle ID (must match Apple Developer App ID)
   - Set Version and Build Number
   - Set app icons and launch screen
   - Set deployment target
3. App Store Connect:
   - Create app record
   - Add Privacy Policy URL and Support URL
   - Fill App Privacy (data collection)
   - Set age rating and gambling/simulated-gambling content disclosures
4. Archive and upload from Xcode Organizer.
5. Submit for review.

## 4) Android (Google Play)
1. Open Android project:
```bash
npx cap open android
```
2. In Android Studio:
   - Set `applicationId` (package name)
   - Set versionCode/versionName
   - Add adaptive icons and feature graphic assets
3. Build signed AAB:
   - Build > Generate Signed Bundle / APK > Android App Bundle
4. Google Play Console:
   - Create app
   - Complete Data safety form
   - Add Privacy Policy URL
   - Complete Content rating questionnaire
   - Set store listing (screenshots, icon, descriptions)
   - Upload AAB to production or testing track
5. Submit for review.

## 5) Required Store Assets
- App icon (1024x1024)
- Splash/launch visuals
- Screenshots (phone sizes; tablet optional but recommended)
- Promo text / short description / full description
- Privacy Policy URL and Support URL

## 6) High-Risk Rejection Triggers To Avoid
- Any text implying real-money payouts or cashout
- Missing privacy policy/support URL
- Broken login flow or external links
- In-app purchases outside Apple IAP / Google Play Billing (if you monetize digitally)
- Misleading claims about guaranteed wins or prediction systems

## 7) Final Pre-Submit Test
1. Fresh install
2. Age gate appears and works
3. Login works
4. Leaderboard and score sync work
5. Privacy/Terms/Support links open correctly
6. No real-money wording in UI/store listing
7. App works on slow network and airplane mode fallback states
