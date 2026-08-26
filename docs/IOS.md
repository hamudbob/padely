# Padelier on iOS — the actual steps

The decision: wrap the existing web app with Capacitor rather than rewrite it
natively. One codebase, days not months, and every fix ships to web and phone
at once. The cost is one real risk, stated up front so it shapes the order of
work rather than ambushing you at submission.

## The risk worth knowing before you spend $99

App Store guideline **4.2 (Minimum Functionality)** rejects apps that are
"simply a website bundled as an app". A wrapper is exactly the shape that rule
was written for, and reviewers do reject them.

Padelier is not a brochure — it runs live sessions, keeps ratings, works
offline — but that has to be *visible to a reviewer in ninety seconds*. The
defence is the native-only capability list in Phase 6, and **push notifications
are the strongest single item on it**. That is why they sit before submission
in this plan rather than in a nice-to-have pile afterwards. Google Play has no
equivalent rule; a wrapper passes there routinely.

If you would rather find out cheaply: Play Store first. Same wrapper, same
codebase, no developer-account cost beyond Google's one-off $25, and a real
store listing to point people at while the iOS side is prepared properly.

---

## Phase 0 — before any code

1. **Apple Developer Program**, $99/year, at developer.apple.com. Enrolment can
   take a couple of days, so start it now; nothing below needs it until Phase 7,
   but Apple sign-in and TestFlight both stop dead without it.
2. **Xcode** from the Mac App Store. It is enormous; start the download and
   leave it.
3. **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`).
   Capacitor uses it to wire the native plugins in.

## Phase 1 — a branch, and a database that isn't yours to break

    git checkout -b ios
    git push -u origin ios

`main` keeps deploying to padelier.id. The club never sees any of this.

Then point the branch at `padelier-v2`:

    export TARGET_DB_URL='postgresql://postgres.<v2-ref>:<pw>@<host>:5432/postgres'
    ./scripts/apply-migrations.sh

Put v2's URL and anon key in `.env.local` **while you work on this branch**, and
remember they must go back to production before you ship anything real. Sign up
two accounts on v2, make a club, run a short session — an empty database passes
tests a populated one fails.

## Phase 2 — the shell exists

    npm install
    npx cap add ios
    npm run ios

`npm run ios` builds the web app, copies it into the native project, and opens
Xcode. Pick a simulator, press play. You should see Padelier.

What you are looking for at this point is not polish. It is: does it launch,
can you sign in with email and password, can you score a match. Everything
after this is fixing what that reveals.

Commit `ios/` once it builds. It is generated, but it is also hand-edited from
here on (entitlements, Info.plist), and regenerating it later would silently
drop that.

## Phase 3 — sign-in, which is the part that actually breaks

Google refuses OAuth inside an embedded webview — `disallowed_useragent` — and
Capacitor's webview is exactly that. Email and password will work on the first
run; Google will not.

The fix is to hand the sign-in to the system browser and catch the return:

1. `supabase.auth.signInWithOAuth({ provider, options: { skipBrowserRedirect: true, redirectTo: 'id.padelier.app://auth' } })` — it returns a URL instead of navigating.
2. Open that URL with `Browser.open()` from `@capacitor/browser` (a real
   SFSafariViewController, which Google accepts).
3. Register `id.padelier.app` as a URL scheme in `Info.plist`.
4. Listen for `App.addListener('appUrlOpen', …)`, pull the code out of the URL,
   call `supabase.auth.exchangeCodeForSession(code)`, then `Browser.close()`.
5. Add `id.padelier.app://auth` to Supabase → Authentication → **URL
   Configuration → Redirect URLs**, on BOTH projects.

Web is untouched: the existing `signInWithGoogle` stays exactly as it is, and
the native path is chosen at runtime by `Capacitor.isNativePlatform()`.

## Phase 4 — shared links open the app

Half of how Padelier spreads is somebody pasting an `/e/<id>` link into
WhatsApp. On a phone with the app installed, that should open the app.

Universal Links: an `apple-app-site-association` file served from
padelier.id (no extension, `application/json`, at `/.well-known/`), the
Associated Domains entitlement in Xcode, and an `appUrlOpen` listener that
routes the path through react-router. Do this after Phase 3 — it reuses the
same listener.

## Phase 5 — stop it feeling like a web page in a box

- Status bar style and background (`@capacitor/status-bar`) so the top of the
  screen matches the app rather than flashing white.
- Splash screen: the P. mark on graphite, already configured in
  `capacitor.config.ts`; generate the assets with `@capacitor/assets`.
- App icon from the existing 512px mark.
- Check every screen against a notch AND a home indicator. The CSS already uses
  `env(safe-area-inset-*)`, which is why `contentInset: "never"` is set — with
  Capacitor's own inset on top you would get doubled padding.
- Haptics on score entry. Small, and it is the single cheapest thing that makes
  a wrapped app feel native.

## Phase 6 — what the stores require

These are not iOS extras; they are the entry fee, and two of them are already
on the backlog.

- **Sign in with Apple.** Guideline 4.8: mandatory once Google sign-in exists
  on iOS. Needs the developer account, a Services ID, a key, and domain
  verification. Enable it in Supabase alongside Google.
- **Report and block.** Guideline 1.2, triggered by `/u/<id>` showing a
  stranger's photo and free-text bio. The semantics are already agreed in
  BACKLOG.md — block is content and contact, not presence. Needs a migration
  (additive).
- **A public /delete-account page.** Play requires a URL reachable *after*
  uninstalling. `delete_my_account` has worked since 0037; this is a web page,
  and most of the text already exists in the privacy policy.
- **Push notifications.** The 4.2 defence, and independently the thing that
  would change how the club uses the app: an hour before a session, and when one
  starts. Service worker, subscriptions table, VAPID keys, an Edge Function on
  pg_cron. Two to three days, and native push on iOS needs the paid account.

## Phase 7 — TestFlight

Archive in Xcode, upload, invite yourself and two club members. Play a whole
real Monday on it before you even think about submitting. Every wrapper bug
worth finding — a keyboard covering an input, a back gesture doing the wrong
thing, the session going stale when the phone locks — shows up in a real
session and in no other way.

## Phase 8 — submit

Screenshots, description, the privacy questionnaire (you collect email, name,
photo — declare all three), the support URL, and a **demo account for the
reviewer**, which is the single most common reason for a first-round rejection.

Expect a rejection or two. It is a process, not a verdict.

---

## Order

Phases 1 and 2 in one sitting. Phase 3 next, because a broken sign-in makes
everything else untestable. Then Phase 6 — the required work is the long pole,
not the wrapper — with Phases 4 and 5 slotted in while you wait on Apple.
