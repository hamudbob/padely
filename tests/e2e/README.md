# E2E tests (Playwright)

Browser tests that drive the real app against the **real Supabase project**.

---

## The one hard constraint

**These tests write real data to the live Supabase project, and they must clean up
after themselves.**

There is no test database and no seeding. Creating a session inserts real rows into
`sessions`, `players`, `rounds` and `matches`; ending a session writes real
`rating_history` and moves real ratings on real accounts; a club session lands in a
real league table. So:

- Every spec that creates a session **must delete it** — `deleteSessionAsHost(page, id)`
  in a `finally` block or an `afterEach`, not at the happy-path end of the test.
  Deletion goes through `delete_session_and_unrate`, which also reverses the rating,
  so a cleaned-up test leaves the accounts where it found them.
- Name sessions uniquely, e.g. `` `e2e ${Date.now()} fixed position` ``. That name is
  how you find the session again in a list, and how a human tells leftover test data
  from real data.
- Never run with more than one worker and never add retries. Both are configured off
  in `playwright.config.ts` — the whole suite shares one Supabase project and one host
  account, so parallel runs collide and a retry replays half-finished writes on top of
  the previous attempt's leftovers.
- Deleting a **club's** last member deletes the club (a known open bug). Don't build
  club fixtures that end up empty.

---

## Prerequisites

Installed once:

```bash
npm install                 # picks up @playwright/test, dotenv, @types/node
npx playwright install chromium
```

The dev server must already be running — the harness deliberately does **not** start
vite. If nothing answers on the base URL, `global-setup.ts` fails with one clear
sentence rather than 30 timeouts:

```bash
npm run dev                 # in a second terminal
```

## `.env.test`

Create it in the **repo root** (it is gitignored — it holds two real accounts):

```dotenv
# Where the dev server is. Optional; defaults to http://localhost:5173
E2E_BASE_URL=http://localhost:5173

# Account H from docs/TEST_PLAN.md §0 — the host
E2E_HOST_EMAIL=you+host@example.com
E2E_HOST_PASSWORD=...

# Account P — a player. A SEPARATE real mailbox, not a +alias of the host:
# several bugs hinge on players.email matching, and an alias masks them.
E2E_PLAYER_EMAIL=you+player@example.com
E2E_PLAYER_PASSWORD=...
```

Both accounts must be:

1. **Confirmed** — the sign-up email link actually opened. An unconfirmed account
   makes `/login` offer "Resend email" instead of a password field, and the setup
   project fails saying so.
2. **Onboarded** — `/welcome` completed by hand (name, photo, side, gender). The tests
   refuse to do this for you, because those values become real profile data. If an
   account still needs it, the setup project fails and names the account.

The app itself needs its own `.env.local` with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, exactly as for normal development.

---

## Running

```bash
npm run e2e                          # the whole suite
npm run e2e -- smoke                 # one spec by filename substring
npm run e2e -- --grep "Fixed Position"
npm run e2e:ui                       # interactive UI mode
npm run e2e:report                   # open the last HTML report
```

Start with `npm run e2e -- smoke` — it proves the sign-in, the app shell and a
signed-out public page work before you go looking for feature bugs.

Type-check the harness (the root `tsconfig.json` only covers `src/`):

```bash
npx tsc --noEmit -p tests/e2e
```

---

## How it's wired

| File | What it does |
|---|---|
| `../../playwright.config.ts` | testDir, phone viewport (393×852), 1 worker, no retries, trace/screenshot on failure, the `setup` → `chromium` project chain |
| `global-setup.ts` | Checks `.env.test` is filled in and that the base URL answers. Fails fast, before any browser launches |
| `auth.setup.ts` | The `setup` project. Signs in as HOST and PLAYER through the email-first flow, saves `tests/.auth/host.json` and `tests/.auth/player.json` |
| `fixtures.ts` | `hostPage` / `playerPage` fixtures plus every helper below |
| `smoke.spec.ts` | Harness self-check. Not a feature test |

Feature specs follow the blocks in `docs/TEST_PLAN.md`.

### Fixtures

`hostPage` and `playerPage` are separate browser contexts, so one test can drive both
roles at once — which is the point of the whole exercise:

```ts
import { test, expect, createSession, endSession, readRating, deleteSessionAsHost } from "./fixtures";

test("a player's rating moves when the host ends a session", async ({ hostPage, playerPage }) => {
  const before = await readRating(playerPage);

  const id = await createSession(hostPage, {
    name: `e2e ${Date.now()} americano`,
    format: "americano",
    players: ["Ana", "Budi", "Citra", "Dedi"],
    courts: 1,
  });

  try {
    await scoreAllCourtsInCurrentRound(hostPage, { scoreA: 21, scoreB: 0 });
    await endSession(hostPage);
    // ...assert
  } finally {
    await deleteSessionAsHost(hostPage, id);      // always, even on failure
  }

  expect((await readRating(playerPage)).rating).toBe(before.rating);
});
```

### Helpers

| Helper | Notes |
|---|---|
| `createSession(page, opts)` | Drives all six wizard steps and returns the session id. Uses **Bulk Add** for the roster. For `side_americano` it sets the L/R chips (everyone defaults to Right; omitting `sides` alternates L,R,L,R…). `rounds` is only accepted for upfront-scheduled formats |
| `scoreRound(page, { court, scoreA, scoreB })` | One court in the round on screen. Fixed-total formats (21 / 4 games / 5 games) auto-fill the opponent, so `scoreA + scoreB` must equal the total; race formats take both numbers |
| `scoreAllCourtsInCurrentRound(page, score)` | Same, for every court. Pass one score or `(court) => score`. Returns the court count |
| `startNextRound(page)` | Taps the lit `›`. Only unlocks once every match this round is final |
| `endSession(page)` | ⋯ → End session → confirm. Asserts it reaches the podium |
| `deleteSessionAsHost(page, id)` | You tab → Host → Select → tick → Delete. Also reverses the rating |
| `readRating(page)` | `{ rating, games, tier }` off the You tab's rating strip |
| `gotoTab(page, "play" \| "club" \| "you")` | Uses the real tab bar when it's on screen, otherwise navigates |
| `captureFailures(page)` | See below. Applied automatically to `hostPage` / `playerPage` |

### `captureFailures` — read this before debugging anything

The app tells users the truth and tells testers nothing: a failed insert surfaces as
**"Could not start the session."** and the actual cause — an RLS denial, a missing
migration, a constraint violation — exists only in the PostgREST response body.

`captureFailures` attaches **every response with status ≥ 400, with its body and the
request body that caused it**, to the test report as `http-<status>-<n>.txt`. Console
errors and uncaught exceptions land in `console-errors.txt`. It is wired into the
`hostPage` and `playerPage` fixtures automatically; call it by hand for any context you
build yourself (`smoke.spec.ts` shows how).

So when a test fails with a vague on-screen string:

```bash
npm run e2e:report      # open the failing test → Attachments → http-4xx-1.txt
```

That file is the answer. The screenshot almost never is.

### Selectors

Everything targets the app's real strings via `getByRole` / `getByText` /
`getByPlaceholder`. There are **no test ids in the app**, and none were added. Where a
control has no accessible name of its own, the helper anchors on a nearby real string
and walks the DOM (e.g. the L/R chip is found from the player's own name button). If
you add a helper, do the same — and if UI copy changes, these helpers are where it
breaks.
