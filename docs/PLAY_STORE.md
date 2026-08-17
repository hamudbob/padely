# Shipping Padelier to Google Play

Written August 2026. Companion to `APP_STORE.md`. Play moves faster than Apple on policy —
re-check the two dated items below before you submit.

---

## The good news: Play doesn't mind that you're a web app

Apple's guideline 4.2 is the reason the iOS route needs native plugins and bundled assets. Play has
no equivalent. A **Trusted Web Activity** — Chrome rendering padelier.id full-screen, no browser
chrome, listed as a normal app — is an explicitly supported way to ship. That gives you two routes,
and they differ in a way that matters a lot given how you work.

| | **Capacitor** (same as iOS) | **TWA** (Bubblewrap / PWABuilder) |
|---|---|---|
| Codebase | one project, iOS + Android | Android only |
| Assets | bundled in the APK | served live from padelier.id |
| **Shipping a fix** | rebuild + resubmit + review | **deploy to Netlify, users have it immediately** |
| Native push | yes, APNs/FCM | web push only |
| Offline | works if you add caching | needs a service worker — you deliberately have none |
| Setup | ~half a day | ~an hour |
| Store update needed for | any change | native shell changes only |

That third row is the real decision. Your whole workflow this month has been "find it, fix it,
it's live in a minute". A TWA keeps that. Capacitor trades it for a review cycle on every fix.

**My recommendation:** if you're doing iOS anyway, use **Capacitor for both** — one project, one
release process, real push notifications, and consistency between the two stores is worth more than
the speed. If you're doing **Android only**, ship a **TWA** and keep your instant-fix loop.

Note the offline caveat either way: `index.html` says *"No service worker (kept off to avoid
stale-cache bugs)"*. Your offline score queue lives in localStorage and survives fine, but the app
shell won't load with no connection. On a padel court with bad signal that's the difference between
"scores queue up" and "blank screen". Worth adding a minimal shell-only service worker before you
ship to either store — cache the shell, never cache API calls.

---

## Two dated things, one of them urgent

### 1. Target API 36, from 31 August 2026

New apps and updates must target **Android 16 (API level 36)** from **31 August 2026**
([Play docs](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)). That's
days away, and it's not negotiable — the upload is rejected, not warned.

Capacitor pins the target SDK per major version and does **not** support overriding it:

| Capacitor | targetSdk |
|---|---|
| 8.x | **36** ✅ |
| 7.x | 35 ❌ after 31 Aug |
| 6.x | 34 ❌ |

So: **use Capacitor 8**. Check `android/variables.gradle` reads `targetSdkVersion = 36`. An
extension to 1 November 2026 can be requested from Play Console, but starting on 8 means you never
need it.

### 2. The 12-tester gauntlet — and how to skip it

A **personal** developer account created after 13 November 2023 must run a **closed test with at
least 12 testers opted in continuously for 14 days** before you can even apply for production
access ([Play docs](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)).
Testers who opt in and drop out don't count, and a gap resets the clock.

Two honest observations:

- **This requirement does not apply to organization accounts.** If you were already leaning toward
  registering Padelier as a company, that decision now saves you two weeks and a recruitment
  problem. Organization accounts need a D-U-N-S number and verification instead — the same one
  Apple wants, so you'd get both from one application.
- **If you stay personal, you have the perfect tester pool.** Twelve padel players who already use
  the app. Most developers hitting this rule are begging strangers in forums; you'd be asking your
  club. Start the closed track *first*, on day one, and let the 14 days run while you finish
  everything else — the clock is the long pole, not the work.

---

## What you already have, and the one Play-specific gap

| Requirement | Status |
|---|---|
| In-app account deletion | ✅ 0037 |
| **A web page where someone can request deletion without reinstalling** | ❌ **missing — Play requires both** |
| Privacy policy URL | ✅ `/privacy` |
| Data safety form | ⬜ to fill in, must match `/privacy` exactly |
| Report / block for user content | ❌ same gap as iOS |
| Payments | ✅ none, so Play Billing doesn't apply |

**The web deletion link is a real, specific requirement**, not a nice-to-have: Play wants a public
URL that names the app, explains what gets deleted, and lets someone request it *after* they've
uninstalled ([Play docs](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)).
You have the in-app half; the web half doesn't exist yet.

It's a small page — `/delete-account`, public, in both languages, stating: the in-app route for
people who still have it, an email request route for people who don't, what's erased immediately,
what stays as anonymised match records, and how long a request takes. Most of that text already
exists in the retention section of your privacy policy, so it's largely assembly.

Play's user-generated-content policy wants the same report-and-block tooling Apple's 1.2 does, so
that work counts twice.

---

## The Capacitor route, concretely

Assuming Capacitor 8 is already set up for iOS:

```bash
npm i @capacitor/android
npx cap add android
npm run build && npx cap sync
npx cap open android          # Android Studio
```

Then:

1. **Check `android/variables.gradle`** → `targetSdkVersion = 36`, `minSdkVersion = 23` or higher.
2. **App id** `id.padelier.app`, matching iOS. Set `versionCode = 1`, `versionName = "1.0"` in
   `android/app/build.gradle`. Every upload needs a higher `versionCode` — Play rejects duplicates,
   and it's the single most common self-inflicted upload failure.
3. **Signing.** Generate an upload keystore, and let **Play App Signing** hold the real release key
   (the default, and the right choice — if you lose your own key without it, you can never update
   the app again). Back up the keystore and its passwords somewhere you won't lose them.
4. **Build → Generate Signed Bundle → AAB.** Play requires an Android App Bundle, not an APK.
5. **Adaptive icon** — Android masks icons to whatever shape the launcher wants, so a square logo
   gets cropped. `@capacitor/assets` generates the foreground/background layers properly.
6. **Android back button.** The hardware/gesture back must behave. Wire `@capacitor/app`'s
   `backButton` listener to your router history and exit only at a tab root — otherwise back closes
   the app mid-session, which is the most-reported complaint for wrapped web apps on Android.
7. **`@capacitor/status-bar`** for the ivory bar, **`@capacitor/keyboard`** with `resize: 'body'`,
   **`@capacitor/haptics`** on score entry. Not required by policy here, just the difference between
   feeling like an app and feeling like a tab.

### Or the TWA route

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://padelier.id/manifest.webmanifest
bubblewrap build
```

The one thing that must be right: **Digital Asset Links**. Bubblewrap prints an `assetlinks.json`
that has to be served at `https://padelier.id/.well-known/assetlinks.json`. Get it wrong and the app
opens with a Chrome address bar visible — which looks exactly like the "repackaged website" Apple
rejects, and users notice. Verify with Google's Statement List Tester before you submit.

---

## The sequence

1. **Decide personal vs organization** — this is the fork that costs two weeks. $25 one-time either way.
2. Register at [play.google.com/console](https://play.google.com/console), complete identity
   verification (and D-U-N-S for an organization).
3. Build the **web deletion page** and **report/block**.
4. Add the Android platform (or Bubblewrap), sign, produce an AAB.
5. **Create the closed test and get 12 club members in on day one** — if you're on a personal
   account, this clock runs in parallel with everything else.
6. Fill in the store listing: icon 512×512, feature graphic 1024×500, screenshots, short and full
   description, privacy policy URL, **Data safety form**, content rating questionnaire, target
   audience, and news/ads declarations.
7. Run `docs/TEST_PLAN.md` against the real build on a real Android phone.
8. Apply for production access once the 14 days are done. Review is typically a few days, and
   slower for a first release from a new account.

---

## Play versus App Store, side by side

| | Google Play | App Store |
|---|---|---|
| Fee | **$25 once** | **$99/year** |
| Web-based apps | fine (TWA supported) | must not be a remote webview (4.2) |
| Gate before launch | 12 testers × 14 days (personal accounts) | none |
| Review time | days | 24–48h typical |
| Account deletion | in-app **and** a web URL | in-app |
| Target SDK churn | annual, enforced by upload rejection | no equivalent |
| Fixing a bug | instant, if you ship a TWA | always a resubmission |

Play is cheaper and more permissive but makes you wait at the start; Apple charges more, is stricter
about what counts as an app, and then lets you ship immediately. If you only ever do one, Play plus
a TWA is by far the lowest-friction way to be "on a store" — and it keeps the fast fix loop you've
been relying on all month.

---

**Sources:** [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) ·
[Testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) ·
[Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) ·
[Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) ·
[Capacitor: setting target SDK](https://capacitorjs.com/docs/android/setting-target-sdk) ·
[Capacitor 8 upgrade guide](https://capacitorjs.com/docs/updating/8-0)
