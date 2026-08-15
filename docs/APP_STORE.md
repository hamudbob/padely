# Shipping Padelier to the App Store

Written August 2026. Apple changes the details often — treat the guideline numbers as stable and
re-check the specifics before you submit.

---

## First, the honest question: do you need to?

Padelier is already installable. `index.html` ships a web manifest, an apple-touch-icon and
`apple-mobile-web-app-capable`, so "Add to Home Screen" on iOS gives a full-screen app with your
icon and no browser chrome. That costs nothing, ships instantly, and has no review.

What the App Store buys you, and it's the whole reason to bother:

- **Being findable.** Nobody discovers a URL. People search the App Store.
- **Credibility.** "Download it from the App Store" is a different sentence to "go to padelier.id".
- **Push notifications that work like everyone expects.** Home-screen web apps can do web push on
  modern iOS, but it's fragile and users have to install first.
- **A place for reviews and ratings** — the social proof a padel club will actually look at.

What it costs: **$99/year**, a rebuild-and-resubmit cycle for every change that touches native
code, and a review process that can say no. If your only goal is "my club can use it on their
phones", the home-screen install already does that and you can stop reading.

---

## The route: Capacitor

Your app is a Vite + React SPA. You do **not** rewrite it. [Capacitor](https://capacitorjs.com)
wraps the built `dist/` in a native iOS shell, bundling the assets **inside** the app rather than
loading your website in a webview. That distinction is the whole game — see guideline 4.2 below.

```bash
npm i @capacitor/core && npm i -D @capacitor/cli
npx cap init Padelier id.padelier.app --web-dir=dist
npm i @capacitor/ios
npm run build
npx cap add ios
npx cap sync
npx cap open ios          # opens Xcode
```

`capacitor.config.ts` — the important part is that there is **no `server.url`**. Pointing it at
padelier.id turns the app into a remote webview and is the single most common cause of rejection:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.padelier.app',
  appName: 'Padelier',
  webDir: 'dist',
  ios: { contentInset: 'always' },
  // NO server.url. Assets ship inside the binary.
};
export default config;
```

From then on the loop is `npm run build && npx cap sync && npx cap open ios`.

---

## What you already have that the store demands

Genuinely ahead here, mostly by accident of the last few weeks' work:

| Requirement | Status |
|---|---|
| **5.1.1(v) — delete your account from inside the app** | ✅ shipped in 0037. Mandatory since June 2022 and a common rejection |
| **Privacy policy URL** | ✅ `/privacy`, public, bilingual |
| **4.8 — Sign in with Apple** | ✅ not applicable: you only offer email + password. It's required only if you offer *other* third-party sign-ins (Google, Facebook). Don't add Google sign-in without adding Apple's too |
| **3.1.1 — in-app purchase** | ✅ not applicable: no payments anywhere |
| **Terms of use** | ✅ `/terms` |
| **Support contact** | ✅ info@padelier.id |

---

## What you'd have to build first

### 1. Report and block — guideline 1.2 (the real gap)

Padelier shows user-generated content: display names, profile photos, bios, club names. Apple's
1.2 requires apps with UGC to have **all** of:

- a method for filtering objectionable material
- **a mechanism for users to report offensive content**
- **the ability to block abusive users**
- published contact information

You have the last one. You need the middle two, and there's no way around them — an app where a
stranger's photo and free-text bio appear on a public profile, with no report button, is a
textbook 1.2 rejection.

Smallest honest implementation:

- a **Report** action on a public profile and on a player in a session — writes a `reports` row
  (reporter, subject, reason, context) and mails you
- a **Block** action — a `blocks` table; a blocked person's name and photo render as "Player" to
  the blocker, and they can't invite them to a club
- an admin view for you (even a Supabase table view) to action reports within 24 hours, which is
  the response time Apple expects

That's a migration, two RPCs and a small amount of UI. Call it a day's work, and it's worth having
whether or not you ship to the store.

### 2. Email links have to come back to the app

**This is the technical gotcha that will eat a day if it surprises you.** Sign-up confirmation and
password reset send a link to `padelier.id/...`. Tapped on a phone with the app installed, that
opens Safari, not Padelier — so a new user confirms their email in a browser and the app never
notices.

Two ways out:

- **Universal Links** — host `/.well-known/apple-app-site-association` on padelier.id (a JSON file,
  no extension, served as `application/json`), add the Associated Domains capability in Xcode, and
  set Supabase's redirect URLs to your https links. Then the app opens instead of Safari.
- **Or switch to OTP codes** for confirmation and reset — a six-digit code typed into the app
  sidesteps links entirely. Less elegant on desktop, bulletproof on mobile.

Either way, add your scheme/domain to Supabase → Authentication → URL Configuration → Redirect URLs.

### 3. Enough native to clear guideline 4.2

4.2 rejects apps that are "simply a repackaged website". You're not one — Padelier has real
offline-capable state, a scheduler, and live scoring — but the reviewer decides in ninety seconds,
so make it obvious:

- `@capacitor/splash-screen` and a proper launch screen, not a white flash
- `@capacitor/status-bar` so the bar matches your ivory background
- `@capacitor/keyboard` with `resize: 'body'`, so score entry doesn't fight the keyboard
- `@capacitor/share` behind your existing `navigator.share` calls — the recap card sharing then
  uses the real iOS share sheet
- `@capacitor/haptics` on score entry. Cheap, and it's the single thing that makes a webview feel
  native
- **push notifications** via `@capacitor/push-notifications` for "your session started" — this is
  the strongest possible signal that the app isn't a wrapper, and it's the feature your users
  actually want
- no visible scrollbars, no text selection on taps, no long-press callouts

Your safe-area and viewport fixes from `5e6c93f` already matter here: an app whose back button sits
under the Dynamic Island reads as a website.

### 4. Store metadata

- **Icon** 1024×1024, no transparency, no rounded corners (Apple rounds it)
- **Screenshots** for the current required device sizes — at minimum the largest iPhone. Generate
  them from a real device; the Play/App Store both reject obvious mockup frames with text overlays
  that oversell
- **Description, keywords, subtitle**, support URL (`padelier.id/about` works), marketing URL
- **Privacy nutrition label** — declare, honestly and matching `/privacy`: email address, name,
  photo, user content, usage data, and that none of it is used for tracking or advertising. The
  label and the policy disagreeing is its own rejection
- **Age rating** — content-wise Padelier is 4+. Note your terms say 18+ to *hold an account*; that
  is a contractual rule, not a content rating, and you don't need to set the store rating to 18+
- **Export compliance** — you use HTTPS only, which is the standard exemption. Add
  `ITSAppUsesNonExemptEncryption = false` to `Info.plist` so you stop being asked every build
- **A demo account for review.** Apple's reviewer must be able to sign in. Create a real account,
  confirm its email, and put the credentials in App Store Connect → App Review Information. Also
  give them a **join code for a live session**, or they'll see an empty app and may mark it 4.2

---

## Enrolling

Two ways in, and the choice shows up publicly as the seller name on your listing
([Apple's enrollment help](https://developer.apple.com/help/account/membership/program-enrollment/)):

**As an individual** — fastest. Your **personal legal name** appears as the seller. Needs an Apple
Account with 2FA and legal age of majority. Fine for Indonesia.

**As an organization** — needs a real legal entity (a PT, not a trade name), a
[D-U-N-S number](https://developer.apple.com/support/D-U-N-S/) (free, allow a few days), a work
email on your own domain, and a functional public website — padelier.id qualifies. The listing then
reads "Seller: <your company>".

Both are **$99 USD/year**. If Padelier might become a business, enrolling as an organization later
means transferring the app, which is doable but tedious — worth deciding now rather than after.

---

## The sequence

1. Enrol in the Apple Developer Program ($99). Individual is the fast path.
2. Build report + block (guideline 1.2).
3. Solve the email-link problem (Universal Links or OTP).
4. Add Capacitor, iOS platform, and the native plugins above.
5. Icons and launch screen via `@capacitor/assets`.
6. In Xcode: bundle id `id.padelier.app`, signing team, version 1.0, build 1.
7. Archive → upload to App Store Connect.
8. **TestFlight first.** Install on your own phone, run the whole of `docs/TEST_PLAN.md` on the
   real build. Everything you've fixed lately was found by using it as a second person — do that
   here too.
9. Fill in the metadata, privacy label, demo account and review notes.
10. Submit. Review is typically 24–48 hours; a first submission from a new account can be slower.

Realistic effort: **2–4 days of work**, plus enrolment waiting time, assuming report/block and the
deep links are the only gaps. Add a week if D-U-N-S verification is in the path.

---

## If a rejection comes back

Almost always one of three, in this order of likelihood for an app like this:

- **4.2 Minimum Functionality** — answer with what's native: offline scoring, push, the scheduler
  running on-device, haptics. Don't argue; add one more native capability and resubmit.
- **1.2 UGC** — they found the missing report/block. Build it, don't negotiate.
- **5.1.1 Data collection** — usually the privacy label not matching the policy, or asking for a
  permission you don't justify. Padelier only needs the photo library, and only when someone taps
  "add a photo"; make sure `NSPhotoLibraryUsageDescription` says exactly that in plain language.

Replies in App Store Connect are read by humans and a clear, specific answer usually resolves it in
one round.

---

## Android, while you're at it

Same Capacitor project, `npx cap add android`. Google Play is **$25 once**, not annual, but expects
a **Data safety** form (same content as Apple's label), a privacy policy URL (you have one), and —
for personal accounts created since 2023 — a period of closed testing with real testers before you
can go public. Plan for that being the slow part rather than the review.

---

## Before any of it

Two things from earlier work that matter more once you're on a store and can't hot-fix in a minute:

- **PSE registration with Komdigi** — flagged in `padelier-legal-reality-check.md`. Being listed on
  an app store raises your profile as a service operating in Indonesia.
- **The three known data bugs** in the "still open" section of `docs/TEST_PLAN.md` — particularly
  players who join by code never being linked to their account. On the web you fix that and
  everyone has it in seconds. Through the App Store, a fix is a resubmission.

---

**Sources:** [Apple Developer Program enrollment](https://developer.apple.com/help/account/membership/program-enrollment/) ·
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ·
[Account deletion requirement](https://developer.apple.com/news/upcoming-requirements/?id=06302022b) ·
[App privacy details](https://developer.apple.com/app-store/app-privacy-details/) ·
[Capacitor](https://capacitorjs.com)
