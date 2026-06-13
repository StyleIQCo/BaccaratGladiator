# BaccaratGladiator — Project Instructions for Claude

## Release Policy

**Before any release or deployment, a full end-to-end (E2E) test run must be executed and pass. Do not initiate or approve a deployment step without confirming E2E tests are complete.**

This applies to every path that publishes content to a tester-facing surface,
including but not limited to:

- `aws s3 cp` / `aws s3 sync` to `s3://baccaratgladiator.com/`
- `aws cloudfront create-invalidation`
- Any invocation of `./deploy.sh` (any target)
- Direct uploads of HTML, JS, or asset files via any other tooling

We have live testers using this project. A broken release reaches them within
minutes of CloudFront invalidation, so the cost of skipping E2E is high.

### How to comply

1. Run the E2E tests relevant to the change and confirm they pass:
   - **Theme / stage changes** (any edit to `themes-extended.js`, the stage
     carousel in `stage-select.html`, or theme runtime in `baccarat-game.html`)
     — run `node test-theme-smoke.js <slug>` for the slug being changed,
     or `node test-theme-smoke.js --all` for sweeping changes. Reads expected
     palette from `themes-extended.js` so adding a new theme entry is enough
     — no test-script edits required.
   - **iOS / Capacitor bundle changes** (any edit to `cap-sync.sh`, files in
     `ios/`, or anything that ships in the `www/` bundle) — run
     `./cap-sync.sh` then `node test-ios-bundle.js`. Verifies the native
     bundle is internally consistent (no broken refs, no missing files,
     index loads cleanly).
   - **Tournament backend / Lambda changes** — `node test-tournament-e2e.js`
     and `node test-tournament-seed.js`. **Note:** `test-tournament-e2e.js`
     requires a SAM Python virtualenv at `/tmp/sam-test-venv/bin/python`.
     If that venv doesn't exist on the current machine, the test will fail
     with `ENOENT`. That's an *infrastructure* failure, not a code regression,
     and may be skipped — but the skip must be reported to the user
     explicitly, including which path the test couldn't find. Do not silently
     swallow the error.
   - **Scoreboard / leaderboard changes** — `node check-scoreboard.js`.
2. Report the test results to the user **before** running any deploy command.
   When a test is skipped under the SAM-venv exception above, list it as
   "skipped — infra unavailable" alongside the other test results.
3. Do not run `aws s3 cp`, `aws cloudfront create-invalidation`,
   `./deploy.sh`, or any App Store / TestFlight upload until the user has
   confirmed they want to proceed given the test results.

### When E2E does not cover the change

If a change touches a surface the existing E2E scripts don't exercise (e.g.
a CSS-only fix to a single stage page), say so explicitly to the user, list
what manual verification is reasonable, and ask the user to confirm the deploy
on that basis. Do not silently skip the policy.
