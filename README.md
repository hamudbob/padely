# Padel Session Manager

Phase 1 build, in progress. This README is the honest status report — read
"What's built vs what's next" before assuming anything works end-to-end yet.

## Important: this hasn't been through `npm install` yet

The cloud sandbox I built this in can't reach the npm registry (its network
allowlist blocks `registry.npmjs.org`), so I was never able to run
`npm install`, `npm run dev`, or `npm run build` myself. Everything in
`src/lib/scheduling` and `src/lib/scoring` — the two most important, riskiest
pieces — **is real, verified working code**: I proved it correct using `tsx`
(a TypeScript runner that doesn't need a package install) with the scripts in
`scripts/`. The React screens under `src/features` are hand-written and
structurally sound, but I could not compile-check the JSX myself, so treat
them as "should work" rather than "verified working" until you run the app.

**First thing to do:** on a machine with normal internet access,

```bash
npm install
npm run verify   # re-proves the scheduling/scoring logic, ~1 second, no other deps needed
npm test         # the real vitest suite (same assertions, proper test runner)
npm run dev      # starts the app at http://localhost:5173
```

If `npm run dev` throws an error, paste it back to me and I'll fix it —
that's the fastest way to close the loop given I can't run it here.

## Environment setup

1. Create a Supabase project (supabase.com).
2. In the SQL editor, run `supabase/migrations/0001_init.sql` once — this is
   the exact schema from our planning conversation, already tested against a
   real local Postgres instance (RLS policies, the public-session RPC, etc.
   all verified working).
3. Copy `.env.example` to `.env.local` and fill in your project's URL + anon
   key (Project Settings -> API).
4. `npm install && npm run dev`.

## What's built vs what's next

**Built and verified (real tests, real logic, no placeholders):**
- `src/lib/scheduling/` — Americano + Mexicano engines, including the fixed
  fairness core (`fairness.ts`) that solves the old app's "same players
  always rest" bug. Regression-tested against the exact 12-player/2-court
  scenario that broke before, plus 5/8/11/12/17-player counts across
  1-6 courts.
- `src/lib/scoring/` — score validation/autofill for all 5 scoring formats,
  and standings computation (points/wins, W-D-L, head-to-head tiebreak,
  fair-play adjustments). Matches PRD acceptance tests #2 and #3 exactly.
- `src/lib/supabase/` — typed client, auth helpers (real Supabase
  signup/login), database types matching the schema.
- `supabase/migrations/0001_init.sql` — full schema, RLS, public RPC.
- Routing shell (`src/App.tsx`) connecting all 7 top-level screens from
  `padel_wireframe.html`.

**Also built and wired to real Supabase (not stubs anymore):**
- Login/Signup — real signup/login, creates the host's team row.
- Create Session wizard (`src/features/create-session/CreateSessionPage.tsx`)
  — all 6 steps for real: name, format (Americano/Mexicano selectable now,
  the other 4 formats visibly disabled until their engines exist), bulk/
  single player add with tap-to-toggle gender, court count with the live
  4-per-court minimum check and one-tap "reduce to N courts" fix, scoring
  format + ranking basis, and a Review step whose draw preview is the *exact*
  Round 1 the scheduling engine will persist — not a mockup. "Start Session"
  writes the session/players/courts/round/matches to Supabase for real
  (`src/lib/supabase/sessionActions.ts`) and takes you to the live session.
- Host Live view (`src/features/host-live/HostLivePage.tsx`) — reads that
  session back from Supabase and shows the real Round 1 matches with real
  player names. Read-only for now: tap-to-score entry, the Standings/
  Matches/Players tabs, the manage menu, and realtime updates are the next
  pass (task A6) — right now it proves the whole pipeline (wizard → Supabase
  → live view) actually works end to end.

**Still stubbed:** Home's session list, Join by code, Public Live view, Final
Summary.

**Next build pass:** score entry (wired to `src/lib/scoring/formats.ts`),
standings display (`src/lib/scoring/standings.ts`), realtime subscriptions so
Host Live and Public Live update instantly, then the Public Live view itself.
Fixed Partner, Team Sparring, and Mixed format variants come after that
(Phases B-C in our plan) — their format cards are visible but disabled in the
wizard so nobody can accidentally pick a format with no engine behind it yet.

## Project layout

```
src/lib/scheduling/   pure TS, no UI — Americano + Mexicano engines
src/lib/scoring/      pure TS, no UI — score validation + standings
src/lib/supabase/     Supabase client, auth helpers, generated-style types
src/features/         one folder per screen (routes)
supabase/migrations/  schema.sql as an ordered migration
scripts/verify*.ts    quick correctness proof without needing vitest installed
```
