import type { Locator, Page } from "@playwright/test";
import {
  captureFailures,
  createSession,
  deleteSessionAsHost,
  endSession,
  expect,
  gotoTab,
  readRating,
  scoreAllCourtsInCurrentRound,
  sessionIdFromUrl,
  test,
} from "./fixtures";

/**
 * docs/TEST_PLAN.md blocks 5, 4 and 3 — the three things that were only ever
 * broken when you looked at them from the OTHER account. Every test here drives
 * the host and the player at the same time, in their own browser contexts,
 * because that is the only way any of these bugs is visible.
 *
 * Block 5 — one podium for an ended session. FinalSummaryPage used to load
 * getSessionStandings + getRoundHistory + getHostLiveSnapshot, all of which read
 * `players` / `matches` / `rounds` directly. Every policy on those tables is
 * `host_all_*`, and RLS answers an unauthorised read with an EMPTY RESULT rather
 * than an error — so the host saw a podium and a full board on
 * /session/:id/final while a player who had actually played in it saw the same
 * URL render one name and no standings. It now loads get_public_session_by_id
 * (0039), which delegates to get_public_session, so both accounts are fed the
 * same rows through the same `assembleStandings`. Fixed Partner is the format
 * that catches a half-fix: the ranked subject there is a PAIR, so six players
 * must produce three rows labelled "A & B" — never six.
 *
 * Block 4 — a player's record and counters. Same RLS split seen from the You
 * tab: the rating strip reads `profiles` (world-readable, written by the host's
 * apply_session_ratings) while the record reads the caller's own player rows —
 * which a player could not read at all. The symptom was "Play a session and your
 * record shows up here" sitting directly under a real rating, with Played and
 * Games both 0. get_my_participation (0039) is the door in.
 *
 * Block 3 — the club league board from a member's account. leagueQueries reads
 * `session_results` (members may) but needed `sessions.counts_for_league` to
 * know which of them qualify, and 0021 had dropped the members' SELECT policy on
 * `sessions`. A non-host member therefore matched zero qualifying sessions and
 * got an empty board forever. 0038 added counts_for_league to the
 * get_club_sessions RPC, which is the door members are allowed through.
 *
 * ── The linking constraint (read this before changing any test here) ─────────
 * A player row is tied to an account by exactly ONE path in this app today:
 * "Claim your spot" on the live view, accepted by the host (0029). Joining by
 * code and being confirmed inserts an UNLINKED row — documented as still-open in
 * TEST_PLAN.md's "Known, still open" list — which contributes nothing to a
 * rating, a record or a league. So every test below plays the same opening:
 * the host starts the session with a placeholder row, the player enters the
 * join code, claims that placeholder, and the host accepts. Only then is
 * anything the player does their own.
 *
 * Local helpers only — fixtures.ts is deliberately not extended. The wizard
 * driver below duplicates a lot of fixtures' createSession() because the shared
 * helper cannot express the two things these blocks need: attaching a session to
 * a club (with "Count for the league" on) and the Players-step Fixed Partner
 * toggle.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Naming
   ══════════════════════════════════════════════════════════════════════════ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Unique per run, so nothing this suite reads back can be a leftover from a
 *  previous run and nothing it creates can collide with real data. */
const RUN_TAG = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
let nameCounter = 0;
function uniqueName(label: string): string {
  nameCounter += 1;
  return `e2e ${label} ${RUN_TAG}-${nameCounter}`;
}

/**
 * The placeholder the PLAYER account claims. One name, reused across sessions
 * (names only have to be unique within a session) and deliberately not a name
 * anyone would type by accident.
 */
const CLAIM_TARGET = "Zola Spot";

/**
 * Fixed Partner roster: six players in three pairs. Two-word names on purpose —
 * the standings table shows the pair's FULL label ("Anisa Rai & Bagus Adi") while
 * the podium column shows `firstNameOf(...)` of it, so the two surfaces can be
 * told apart in an assertion.
 */
const FP_PLAYERS = ["Anisa Rai", "Bagus Adi", "Cahya Dwi", "Damar Eko", "Eka Fitri", CLAIM_TARGET];
/** Tap order matters: the first tapped becomes the pair's player A, which is the
 *  side the "A & B" label is built from. */
const FP_PAIRS: [string, string][] = [
  ["Anisa Rai", "Bagus Adi"],
  ["Cahya Dwi", "Damar Eko"],
  ["Eka Fitri", CLAIM_TARGET],
];

const FOUR_PLAYERS = ["Gilang Aji", "Hanif Budi", "Intan Citra", CLAIM_TARGET];

/* ══════════════════════════════════════════════════════════════════════════
   The create wizard — the parts fixtures.createSession() can't reach
   ══════════════════════════════════════════════════════════════════════════ */

/** The wizard's steppers use U+2212 MINUS SIGN, not a hyphen. */
const MINUS = "−";

/** A stepper row's current value: the `<b>` immediately after the − button. */
function stepperValue(row: Locator): Locator {
  return row.getByRole("button", { name: MINUS, exact: true }).locator("xpath=following-sibling::b[1]");
}

interface StartSessionOptions {
  name: string;
  players: string[];
  /** Attach the session to this club, by the name its chip carries on the Name
   *  step. The chip only exists if the signed-in host is a member of it. */
  clubName?: string;
  /** Turn on the Players-step Fixed Partner toggle and pair manually, in this
   *  order. Omit for a plain Americano. */
  fixedPartnerPairs?: [string, string][];
  /** Asserted on the Courts step, never set — the app auto-sizes both, and what
   *  it picks is part of what these tests are checking. */
  expectCourts?: number;
  expectRounds?: number;
}

/**
 * Drives /create end to end as the host and returns the new session's id.
 *
 * Deliberately a near-copy of fixtures' createSession(): same steps, same
 * anchors. It exists because that helper has no way to attach a club (which
 * block 3 needs, along with the "Count for the league" switch that only appears
 * once one is attached) or to turn on Fixed Partner (block 5) — and fixtures.ts
 * is not this agent's file to extend.
 */
async function startSessionAsHost(page: Page, opts: StartSessionOptions): Promise<string> {
  const next = page.getByRole("button", { name: "Next", exact: true });

  // ── Step 1 of 6: Name (+ the optional club picker) ───────────────────────
  await page.goto("/create");
  const nameInput = page.getByPlaceholder("Tuesday Night Padel");
  await expect(nameInput, "the /create wizard never reached the Name step").toBeVisible();
  await nameInput.fill(opts.name);

  if (opts.clubName !== undefined) {
    const chip = page.getByRole("button", { name: opts.clubName, exact: true });
    await expect(
      chip,
      `no "${opts.clubName}" chip under "Play for a team" — the picker only lists clubs this account is a member of, ` +
        `and it is loaded once when the wizard mounts`,
    ).toBeVisible();
    await chip.click();
    // The league switch only renders once a club is attached, and `countsForLeague`
    // defaults to true — so its mere presence is what "count for league is on"
    // looks like from the outside. It is a plain <button> with a decorative
    // <span> track: no role="switch", no aria-checked, no accessible state at
    // all, so a test cannot read whether it is on. We therefore never tap it.
    await expect(
      page.getByRole("button", { name: /^Count for the league/ }),
      'attaching a club should reveal the "Count for the league" switch',
    ).toBeVisible();
  }
  await next.click();

  // ── Step 2 of 6: Format ──────────────────────────────────────────────────
  // Americano is the wizard's default, but tapping it makes the test say so, and
  // Fixed Partner is only offered on top of Americano or Mexicano.
  const formatCard = page.getByRole("button").filter({ has: page.getByText("Americano", { exact: true }) });
  await expect(formatCard, 'no format card labelled exactly "Americano"').toBeVisible();
  await formatCard.click();
  await expect(formatCard, 'tapping "Americano" did not select it').toContainText("✓");
  await next.click();

  // ── Step 3 of 6: Players (the lobby) ─────────────────────────────────────
  await page.getByRole("button", { name: "Bulk Add", exact: true }).click();
  const bulk = page.getByPlaceholder("One name per line");
  await expect(bulk).toBeVisible();
  await bulk.fill(opts.players.join("\n"));
  await page.getByRole("button", { name: "Add all lines as players", exact: true }).click();
  await expect(
    page.getByText(`Players (${opts.players.length})`),
    "the roster count did not match the names pasted into Bulk Add",
  ).toBeVisible();

  if (opts.fixedPartnerPairs !== undefined) {
    // The toggle's accessible name is its title plus its explanation line.
    const toggle = page.getByRole("button", { name: /^Fixed Partner/ });
    await expect(
      toggle,
      "no Fixed Partner toggle on the Players step — it is only offered under Americano or Mexicano",
    ).toBeVisible();
    await toggle.click();
    // Manual pairing rather than either auto mode: the test needs to KNOW which
    // two players share a pair, because the pair's label is what the podium is
    // asserted on.
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    for (const [a, b] of opts.fixedPartnerPairs) {
      // These chips' accessible name is exactly the player's name. The roster row
      // above spells its name button "M Anisa Rai" (gender letter first), so an
      // exact match can only be the pairing chip.
      await page.getByRole("button", { name: a, exact: true }).click();
      await page.getByRole("button", { name: b, exact: true }).click();
      await expect(page.getByText(`${a} & ${b}`, { exact: true }), `"${a}" and "${b}" were not paired`).toBeVisible();
    }
    await expect(page.getByText(`Pairs (${opts.fixedPartnerPairs.length})`)).toBeVisible();
    await expect(
      page.getByText(/not yet paired/),
      "an unpaired player is never scheduled — every player must be in a pair",
    ).toHaveCount(0);
  }
  await next.click();

  // ── Step 4 of 6: Courts (and the round count) ────────────────────────────
  const courtRow = page.getByText("Court count", { exact: true }).locator("xpath=..");
  await expect(courtRow, "the Courts step never rendered").toBeVisible();
  if (opts.expectCourts !== undefined) {
    await expect(
      stepperValue(courtRow),
      `${opts.players.length} players should auto-size to ${opts.expectCourts} court(s)`,
    ).toHaveText(String(opts.expectCourts));
  }
  if (opts.expectRounds !== undefined) {
    // "Rounds" sits in a div beside the stepper's div, both inside the row.
    const roundsRow = page.getByText("Rounds", { exact: true }).locator("xpath=../..");
    await expect(
      stepperValue(roundsRow),
      `this roster should auto-calculate to ${opts.expectRounds} rounds`,
    ).toHaveText(String(opts.expectRounds));
  }
  await expect(next, "Next is disabled on the Courts step — the roster does not fill the courts").toBeEnabled();
  await next.click();

  // ── Step 5 of 6: Points — keep the default (Fixed 21 points) ─────────────
  await next.click();

  // ── Step 6 of 6: Review → Start ──────────────────────────────────────────
  const start = page.getByRole("button", { name: "Start Session", exact: true });
  await expect(start, "the Review step never rendered its Start Session button").toBeVisible();
  await expect(start, "Start Session is disabled — not enough players for the court count").toBeEnabled();
  await start.click();
  try {
    await page.waitForURL(/\/session\/[^/]+\/host/, { timeout: 45_000 });
  } catch (err) {
    const inlineError = page
      .getByRole("button", { name: /^(Start Session|Starting…)$/ })
      .locator("xpath=preceding-sibling::p[1]");
    const shown = (await inlineError.count()) > 0 ? (await inlineError.innerText()).trim() : "(no inline error)";
    throw new Error(
      `Start Session never navigated to the live session.\nOn screen: ${shown}\n` +
        `The real cause is in this test's http-4xx/5xx attachments.\n` +
        `Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const id = sessionIdFromUrl(page.url());
  await expect(page.getByRole("heading", { name: opts.name })).toBeVisible();
  return id;
}

/* ══════════════════════════════════════════════════════════════════════════
   Claim your spot — the only path that links a player to their account
   ══════════════════════════════════════════════════════════════════════════ */

/** The 6-digit join code, read off the host live page's subtitle line. */
async function readJoinCode(page: Page): Promise<string> {
  const line = page.locator("p").filter({ hasText: /Code\s*\d{6}/ });
  await expect(line, "the host live page never showed this session's join code").toHaveCount(1);
  const match = /(\d{6})/.exec((await line.innerText()).replace(/\s+/g, " "));
  if (!match) throw new Error("Could not read a 6-digit join code off the host live page.");
  return match[1];
}

/** The public token out of a /live/:token URL. */
function tokenFromUrl(url: string): string {
  const match = /\/live\/([^/?#]+)/.exec(url);
  if (!match) throw new Error(`No public token in URL: ${url}`);
  return match[1];
}

/**
 * The player half of the linking flow: /watch → the host's code → the live view
 * → "Claim your spot" → the placeholder that represents them.
 *
 * Goes through /watch rather than straight to /live/:token because that is how a
 * player actually arrives (and it carries the code on as ?j=, which the panel
 * needs for its other button). Returns the session's public token, which the
 * live URL is the only place a non-host can read it from.
 *
 * The session must be LIVE: request_player_claim refuses on an ended session,
 * and the panel itself only renders while the session is live.
 */
async function claimSpotAsPlayer(page: Page, joinCode: string, placeholder: string): Promise<string> {
  await page.goto("/watch");
  const code = page.getByLabel("6-digit code");
  await expect(code, "the /watch code screen never rendered its input").toBeVisible();
  await code.fill(joinCode);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  try {
    await page.waitForURL(/\/live\/[^/?#]+/, { timeout: 30_000 });
  } catch (err) {
    const shown = await page.getByText(/No open session matches that code|Couldn't check that code/).count();
    throw new Error(
      `Code ${joinCode} did not resolve to a live session (an error was ${shown > 0 ? "" : "not "}shown).\n` +
        `Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const claim = page.getByRole("button", { name: "Claim your spot", exact: true });
  await expect(
    claim,
    'the live view never offered "Claim your spot" — that panel renders only while the session is live',
  ).toBeVisible();
  await claim.click();
  await expect(page.getByText("Which one are you?"), "the claim picker never opened").toBeVisible();

  const chip = page.getByRole("button", { name: placeholder, exact: true });
  await expect(
    chip,
    `"${placeholder}" is not offered as a claimable spot — get_claimable_players only returns ACTIVE, ` +
      `still-unlinked names, so it is taken, left, or misspelled`,
  ).toBeVisible();
  await chip.click();

  await expect(
    page.getByText(new RegExp(`Claim sent for\\s+${escapeRegExp(placeholder)}`)),
    "the claim was not filed — see this test's http-*.txt attachments for the RPC error",
  ).toBeVisible();
  return tokenFromUrl(page.url());
}

/**
 * The host half: accept the pending claim, which sets players.linked_user_id AND
 * renames that row to the claimant's profile name (0029). From here on the
 * placeholder no longer exists by that name anywhere — which is why every
 * assertion after this point uses the PLAYER's display name instead.
 *
 * The host page polls claims every 10 seconds; reloading asks immediately.
 */
async function acceptClaimAsHost(page: Page, sessionId: string, placeholder: string): Promise<void> {
  await page.goto(`/session/${sessionId}/host`);
  const heading = page.getByText(/^Claim requests?$/);
  await expect(
    heading,
    "no claim request ever reached the host — getPendingClaims is host-gated, so check the attachments",
  ).toBeVisible({ timeout: 30_000 });
  const card = heading.locator("xpath=..");
  await expect(card, `the claim card does not mention "${placeholder}"`).toContainText(placeholder);
  await card.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    page.getByText(/^Claim requests?$/),
    "the claim card stayed on screen — respond_player_claim failed (see the attachments)",
  ).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Host creates → player claims → host accepts, in one call, ending with the
 * host back on the live page and the player's own confirmation on screen.
 * Returns the public token and the player's display name (the placeholder's new
 * name).
 */
async function linkPlayerToSession(
  hostPage: Page,
  playerPage: Page,
  sessionId: string,
  playerName: string,
): Promise<string> {
  const joinCode = await readJoinCode(hostPage);
  const token = await claimSpotAsPlayer(playerPage, joinCode, CLAIM_TARGET);
  await acceptClaimAsHost(hostPage, sessionId, CLAIM_TARGET);

  // The panel polls every 8s while a claim is pending; reload rather than wait.
  await playerPage.reload();
  await expect(
    playerPage.getByText(new RegExp(`in as\\s+${escapeRegExp(playerName)}`)),
    `the player's live view still doesn't say they're in as "${playerName}" — the accept did not link the account`,
  ).toBeVisible({ timeout: 30_000 });
  return token;
}

/* ══════════════════════════════════════════════════════════════════════════
   Scoring a pre-generated schedule
   ══════════════════════════════════════════════════════════════════════════ */

/** The round pager's centre label, `<b>Round <span>{sequence}</span></b>`. */
function roundLabel(page: Page): Locator {
  return page.locator("b").filter({ hasText: /^Round \d+$/ });
}

async function viewedRound(page: Page): Promise<number> {
  await expect(roundLabel(page), "the round pager never rendered").toBeVisible();
  const text = (await roundLabel(page).innerText()).trim();
  const match = /^Round\s+(\d+)$/.exec(text);
  if (!match) throw new Error(`Could not read a round number out of the pager (got "${text}").`);
  return Number.parseInt(match[1], 10);
}

/** How many rounds the schedule has, from the pager's "Round N of M" sub-line —
 *  which only a fully pre-generated format renders. */
async function scheduleLength(page: Page): Promise<number> {
  const subline = page.getByText(/^Round \d+ of \d+/);
  await expect(
    subline,
    'the pager never showed "Round N of M" — this session did not pre-generate its whole schedule',
  ).toBeVisible();
  const match = /of\s+(\d+)/.exec((await subline.innerText()).trim());
  if (!match) throw new Error("Could not read the schedule length out of the round pager.");
  return Number.parseInt(match[1], 10);
}

async function gotoRound(page: Page, sequence: number): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const current = await viewedRound(page);
    if (current === sequence) return;
    const label = current < sequence ? "Next round" : "Previous round";
    const step = page.getByRole("button", { name: label, exact: true });
    await expect(step, `no enabled "${label}" control between round ${current} and round ${sequence}`).toBeEnabled();
    await step.click();
    await expect(roundLabel(page)).not.toHaveText(`Round ${current}`);
  }
  throw new Error(`Gave up walking the round pager to round ${sequence}.`);
}

/**
 * Wait until the offline score queue has drained, i.e. every score really
 * reached Supabase. Until this is clear, HostLivePage overlays queued values on
 * its own rounds, so a podium built afterwards could be built from less.
 */
async function expectScoresSynced(page: Page): Promise<void> {
  await expect(
    page.getByText(/waiting to sync|Syncing \d+ score|^Offline · /),
    "scores never finished uploading — see this test's http-*.txt attachments",
  ).toHaveCount(0, { timeout: 45_000 });
}

/** Score every round of a fully pre-generated schedule, oldest first. Returns
 *  the round count. */
async function scoreWholeSchedule(
  page: Page,
  score: (round: number) => { scoreA: number; scoreB: number },
): Promise<number> {
  const rounds = await scheduleLength(page);
  for (let sequence = 1; sequence <= rounds; sequence += 1) {
    await gotoRound(page, sequence);
    await scoreAllCourtsInCurrentRound(page, score(sequence));
  }
  await expectScoresSynced(page);
  return rounds;
}

/** Three different margins, so the subjects don't all finish level. */
const MARGINS = [
  { scoreA: 21, scoreB: 0 },
  { scoreA: 19, scoreB: 2 },
  { scoreA: 15, scoreB: 6 },
];
function marginFor(round: number): { scoreA: number; scoreB: number } {
  return MARGINS[(round - 1) % MARGINS.length];
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading the podium page (/session/:id/final)
   ══════════════════════════════════════════════════════════════════════════ */

interface PodiumRow {
  rank: number;
  /** The ranked SUBJECT — a player for individual formats, "A & B" for a pair. */
  subject: string;
  points: number;
}

/**
 * The rows of the table under the podium.
 *
 * The table has no test id and its container is identified only by Tailwind
 * classes, so this anchors on the row's SHAPE instead: a div with exactly two
 * element children, where the first is the name span (which itself wraps the
 * rank span) and the second is the points span. Nothing else on this page or in
 * the shell has that shape — the stat tiles are `b` + `span`, the podium columns
 * are four divs, and the header is button + link + spacer.
 */
function podiumTableRows(page: Page): Locator {
  return page.locator("xpath=//div[count(*)=2 and span[1]/span and span[2]]");
}

async function readPodiumTable(page: Page): Promise<PodiumRow[]> {
  await expect(
    podiumTableRows(page).first(),
    "the podium page never rendered a standings row — for a player that is the 0039 bug (an empty read, not an error)",
  ).toBeVisible();
  const texts = await podiumTableRows(page).allInnerTexts();
  return texts.map((raw) => {
    const text = raw.replace(/\s+/g, " ").trim();
    // No \\s+ after the rank: the rank <span> and the name sit flush in
    // innerText, so a real row reads "1Cahya Dwi & Damar Eko 27".
    const match = /^(\d+)\s*(.+?)\s+(\d+)$/.exec(text);
    if (!match) throw new Error(`Could not read "rank subject points" out of a standings row (got "${text}").`);
    return {
      rank: Number.parseInt(match[1], 10),
      subject: match[2],
      points: Number.parseInt(match[3], 10),
    };
  });
}

/** One of the podium page's stat tiles (Rounds · Matches · Players). */
async function readStatTile(page: Page, label: string): Promise<number> {
  const value = page.locator(`xpath=//span[normalize-space()="${label}"]/preceding-sibling::b[1]`);
  await expect(value, `the podium page has no "${label}" stat tile`).toHaveCount(1);
  const text = (await value.innerText()).trim();
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) throw new Error(`The "${label}" tile does not hold a number (got "${text}").`);
  return parsed;
}

/** The "Well played, <name>." headline, normalised. */
async function readPodiumHeadline(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading, "the podium never rendered its headline").toBeVisible();
  return (await heading.innerText()).replace(/\s+/g, " ").trim();
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading the You tab
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Reload /profile.
 *
 * Every number on that page is fetched on mount, and clicking the "You" tab
 * while already on /profile re-renders nothing — so a test that wants fresh
 * numbers has to actually navigate.
 */
async function reloadProfile(page: Page): Promise<void> {
  if (/\/profile(\?|#|$)/.test(page.url())) await page.reload();
  else await page.goto("/profile");
}

/**
 * Wait until the profile request has landed.
 *
 * This matters more than it looks: RatingStrip renders `profile?.rating ?? 1500`
 * and `games ?? 0`, so before the fetch resolves the You tab shows a plausible
 * 1500 / 0 that is not anybody's rating. "Playing since <month year>" is the one
 * line that only exists once `profile` is set, so it is the load marker.
 */
async function waitForProfileLoaded(page: Page): Promise<void> {
  await expect(
    page.getByText(/^Playing since /),
    'the You tab never rendered "Playing since" — until the profile request lands, the rating strip shows a placeholder 1500 / 0',
  ).toBeVisible();
}

/** The account's own display name, which is also what accepting a claim renames
 *  the claimed player row to. */
async function readDisplayName(page: Page): Promise<string> {
  await gotoTab(page, "you");
  await waitForProfileLoaded(page);
  const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  if (name.length === 0) throw new Error("The You tab's heading is empty — could not read the account's name.");
  return name;
}

interface RecordNumbers {
  wins: number;
  losses: number;
  draws: number;
}

/**
 * The Record card's W · L · D, or null when the card is in its empty state.
 *
 * Null is exactly the bug block 4 is about ("Play a session and your record
 * shows up here"), so the caller distinguishes it rather than getting zeros.
 * Anchored on the "W · L · D" label because the three numbers are separate
 * spans inside one `p` and nothing else names them.
 */
async function readRecord(page: Page): Promise<RecordNumbers | null> {
  const label = page.getByText("W · L · D", { exact: true });
  if ((await label.count()) === 0) return null;
  const text = (await label.locator("xpath=following-sibling::p[1]").innerText()).replace(/\s+/g, " ").trim();
  const match = /^(\d+)\s*·\s*(\d+)\s*·\s*(\d+)$/.exec(text);
  if (!match) throw new Error(`Could not read W · L · D out of "${text}".`);
  return {
    wins: Number.parseInt(match[1], 10),
    losses: Number.parseInt(match[2], 10),
    draws: Number.parseInt(match[3], 10),
  };
}

/** The three Sessions tiles (Played · Hosted · Games) under the record. */
async function readSessionTiles(page: Page): Promise<{ played: number; hosted: number; games: number }> {
  const tile = async (label: string): Promise<number> => {
    // The tile is `<b>{value}</b><span>{label}</span>`. The rating strip's own
    // "Games" label is a `p`, so a span-scoped match can't pick it up.
    const value = page.locator(`xpath=//span[normalize-space()="${label}"]/preceding-sibling::b[1]`);
    await expect(value, `the You tab has no Sessions "${label}" tile`).toHaveCount(1);
    const text = (await value.innerText()).trim();
    const parsed = Number.parseInt(text, 10);
    if (Number.isNaN(parsed)) throw new Error(`The "${label}" tile does not hold a number (got "${text}").`);
    return parsed;
  };
  return { played: await tile("Played"), hosted: await tile("Hosted"), games: await tile("Games") };
}

interface YouNumbers {
  rating: number;
  ratingGames: number;
  record: RecordNumbers | null;
  played: number;
  games: number;
}

async function readYouNumbersFromDom(page: Page): Promise<YouNumbers> {
  const strip = await readRating(page);
  const tiles = await readSessionTiles(page);
  return {
    rating: strip.rating,
    ratingGames: strip.games,
    record: await readRecord(page),
    played: tiles.played,
    games: tiles.games,
  };
}

function sameYouNumbers(a: YouNumbers, b: YouNumbers): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Read every number on the You tab once it has stopped moving.
 *
 * The page fills in from four independent requests (profile, insights, rating
 * history, sessions) and each one renders a zero until it answers, so a single
 * read taken mid-flight can bake a loading zero into a baseline. Waiting for
 * "Playing since" only proves the PROFILE landed; the record and the Sessions
 * tiles come from getPlayerInsights, which has no load marker of its own — the
 * empty record card is indistinguishable from a loading one. Hence: read twice
 * and require the same answer. (The async thing this suite really has to wait
 * for — the rating write at session end — is polled by the caller, not here.)
 */
async function readSettledYouNumbers(page: Page): Promise<YouNumbers> {
  await reloadProfile(page);
  await waitForProfileLoaded(page);
  let previous: YouNumbers | null = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await readYouNumbersFromDom(page);
    if (previous !== null && sameYouNumbers(previous, current)) return current;
    previous = current;
    await page.waitForTimeout(500);
  }
  throw new Error("The You tab's numbers never stopped changing — something on it is refetching in a loop.");
}

/* ══════════════════════════════════════════════════════════════════════════
   Clubs
   ══════════════════════════════════════════════════════════════════════════ */

function clubIdFromUrl(url: string): string {
  const match = /\/teams\/([0-9a-fA-F-]{36})/.exec(url);
  if (!match) throw new Error(`No club id in URL: ${url}`);
  return match[1];
}

/** Create a club as its owner and read its join code out of the invite sheet. */
async function createClubAsHost(page: Page, name: string): Promise<{ id: string; code: string }> {
  await gotoTab(page, "club");
  await page.getByRole("button", { name: "Or create your own club", exact: true }).click();
  // exact: the club SEARCH field reads "Club name or code", which a substring
  // match also hits — two elements, strict-mode violation, and a failure that
  // looks like the form never opened.
  const input = page.getByPlaceholder("Club name", { exact: true });
  await expect(input, "the create-a-club form never opened").toBeVisible();
  await input.fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/teams\/[0-9a-fA-F-]{36}/, { timeout: 30_000 });
  const id = clubIdFromUrl(page.url());

  // The code is only rendered inside the invite sheet.
  await page.getByRole("button", { name: "Invite players", exact: true }).click();
  const codeValue = page.getByText("Team code", { exact: true }).locator("xpath=following-sibling::p[1]");
  await expect(codeValue, "the invite sheet never showed the club code").toBeVisible();
  const code = (await codeValue.innerText()).trim();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  if (!/^[A-Za-z0-9]{4,6}$/.test(code)) {
    throw new Error(`"${code}" doesn't look like a club code, so the join-by-code path can't be driven with it.`);
  }
  return { id, code };
}

/**
 * Join a club by code as the player. This files a REQUEST (join_club_by_code
 * never joins outright) which an admin then has to accept.
 */
async function requestClubJoinAsPlayer(page: Page, code: string, clubName: string): Promise<void> {
  await gotoTab(page, "club");
  const search = page.getByLabel("Search for a club by name, or enter a club code");
  await expect(search, "the Club tab never rendered its search field").toBeVisible();
  await search.fill(code);
  const join = page.getByRole("button", { name: /^Join with code/ });
  await expect(
    join,
    `no "Join with code" action for "${code}" — the field only offers it for a 4-6 character code-shaped query`,
  ).toBeVisible();
  await join.click();
  await expect(
    page.getByText(new RegExp(`Request sent to\\s+${escapeRegExp(clubName)}`)),
    "the join request was not filed — see this test's http-*.txt attachments",
  ).toBeVisible({ timeout: 30_000 });
}

/** Accept a pending club join request as an admin of that club. */
async function acceptClubJoinAsHost(page: Page, clubId: string, who: string): Promise<void> {
  await page.goto(`/teams/${clubId}`);
  // The row's own text starts with the avatar's initial, so anchor on the <b>
  // that carries "<name> wants to join" and walk up to the row.
  const request = page.locator("b").filter({ hasText: new RegExp(`^${escapeRegExp(who)} wants to join$`) });
  await expect(request, `no pending join request from "${who}" on the club page`).toBeVisible({ timeout: 30_000 });
  await request.locator("xpath=..").getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    request,
    "the join request stayed on screen — respond_join_request failed (see the attachments)",
  ).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Leave a club if this account is still in it.
 *
 * This is the whole of club cleanup, because the app has NO delete-a-club: the
 * only way one goes away is club_member_owner_succession (0021), which drops a
 * club whose last member leaves. Call it for the PLAYER first — if the owner
 * left while the player was still a member, the player would be promoted to
 * owner and the club would survive with nobody in this suite able to remove it
 * (and create_club caps an account at 5 owned clubs, so leftovers eventually
 * break the suite outright).
 */
async function leaveClubIfMember(page: Page, clubId: string): Promise<void> {
  await page.goto(`/teams/${clubId}`);
  const leave = page.getByRole("button", { name: "Leave team", exact: true });
  await expect(
    leave
      .or(page.getByText("You're not a member of this team."))
      .or(page.getByText("This team isn't available.")),
    "the club page never settled into either the member or the non-member view",
  ).toBeVisible({ timeout: 30_000 });
  if ((await leave.count()) === 0) return;
  // leave_club is behind window.confirm — see the dialog handler in beforeEach.
  await leave.click();
  await page.waitForURL(/\/teams(\?|#|$)/, { timeout: 30_000 });
}

/** Every row of the league board. Only the board's rows link to /u/:userId on
 *  this page, so the href is the anchor. */
async function readLeagueRows(page: Page): Promise<string[]> {
  const rows = page.locator('a[href^="/u/"]');
  await expect(
    rows.first(),
    'the league board has no rows — with a qualifying session played this is the 0038 bug (a member reads zero rows from `sessions`, silently)',
  ).toBeVisible({ timeout: 30_000 });
  return (await rows.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
}

/** Open a club's league board through the UI, the way a member reaches it. */
async function openClubLeague(page: Page, clubName: string): Promise<void> {
  await gotoTab(page, "club");
  const club = page.getByRole("link", { name: new RegExp(escapeRegExp(clubName)) });
  await expect(club, `"${clubName}" is not in this account's club list`).toBeVisible({ timeout: 30_000 });
  await club.click();
  await page.waitForURL(/\/teams\/[0-9a-fA-F-]{36}/, { timeout: 30_000 });
  await page.getByRole("link", { name: /^League table/ }).click();
  await page.waitForURL(/\/teams\/[0-9a-fA-F-]{36}\/league/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "League", exact: true })).toBeVisible();
}

/* ══════════════════════════════════════════════════════════════════════════
   Setup and cleanup
   ══════════════════════════════════════════════════════════════════════════ */

const createdSessions: string[] = [];
const createdClubs: string[] = [];

function trackSession(id: string): string {
  createdSessions.push(id);
  return id;
}

// Native confirms are accepted by the page fixtures themselves (see
// fixtures.ts: acceptNativeConfirms). Registering a SECOND listener here would
// not double the safety — the first accept() resolves the dialog and the second
// throws "Cannot accept dialog which is already handled", failing the test after
// the click has already gone through. That mistake cost this suite five
// cascading failures, so the handler lives in exactly one place.

test.afterEach(async ({ hostPage, playerPage }) => {
  // Sessions first. Deleting one goes through delete_session_and_unrate, which
  // is also what puts the PLAYER account's rating back where this test found it.
  // sessions.club_id is ON DELETE SET NULL, so removing the club first would
  // leave these behind rather than take them with it.
  while (createdSessions.length > 0) {
    const id = createdSessions.pop() as string;
    await deleteSessionAsHost(hostPage, id);
  }
  while (createdClubs.length > 0) {
    const clubId = createdClubs.pop() as string;
    await leaveClubIfMember(playerPage, clubId);
    await leaveClubIfMember(hostPage, clubId);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════════ */

test.describe("two accounts, one session", () => {
  // Block 5, steps 1-9. Guards the whole of 0039's first half: the podium page
  // used to be assembled from host-only reads, so /session/:id/final rendered
  // one thing for the host and a near-empty page for the player who played in
  // it. The host's table is captured as the expected value and the player's is
  // asserted to match it exactly — step 6 differing from step 5 in ANY way is
  // the bug this block exists for. Fixed Partner is the format because its
  // ranked subject is a PAIR: six players must come out as three "A & B" rows.
  test("the host and a claimed player see the identical Fixed Partner podium", async ({
    hostPage,
    playerPage,
    browser,
    baseURL,
    viewport,
  }) => {
    // Six players through the wizard, a claim round trip, three scored rounds,
    // an end-session, and four different renders of the result.
    test.setTimeout(420_000);
    captureFailures(hostPage);
    captureFailures(playerPage);

    const playerName = await readDisplayName(playerPage);
    if (FP_PLAYERS.includes(playerName)) {
      throw new Error(
        `The PLAYER account is called "${playerName}", which is also a placeholder name in this test. ` +
          `Accepting a claim renames the claimed row to the account's name, so the roster would end up with ` +
          `two identical names and the standings would be ambiguous.`,
      );
    }

    const sessionName = uniqueName("FixedPartner podium");
    const sessionId = trackSession(
      await startSessionAsHost(hostPage, {
        name: sessionName,
        players: FP_PLAYERS,
        fixedPartnerPairs: FP_PAIRS,
        // 6 players auto-size to 1 court; 3 pairs on 1 court is 3 matchups, so
        // the round-robin target is 3 rounds.
        expectCourts: 1,
        expectRounds: 3,
      }),
    );
    await expect(
      hostPage.getByText(/· Fixed Partner ·/),
      "the live session does not say it is a Fixed Partner session — the toggle did not persist",
    ).toBeVisible();

    // ── The link. Everything after this depends on it ───────────────────────
    await linkPlayerToSession(hostPage, playerPage, sessionId, playerName);

    // ── Play it out ─────────────────────────────────────────────────────────
    const rounds = await scoreWholeSchedule(hostPage, marginFor);
    expect(rounds, "3 pairs on 1 court should pre-generate 3 rounds").toBe(3);

    await endSession(hostPage);
    await expect(hostPage).toHaveURL(new RegExp(`/session/${sessionId}/final`));

    // ── The host's podium, captured as the expected value ───────────────────
    const hostTable = await readPodiumTable(hostPage);
    const hostHeadline = await readPodiumHeadline(hostPage);
    const hostSubjects = await readStatTile(hostPage, "Players");
    const hostRounds = await readStatTile(hostPage, "Rounds");
    const hostMatches = await readStatTile(hostPage, "Matches");

    // Three pairs, not six players. A regression to per-player subjects shows up
    // here as six rows.
    expect(
      hostTable.length,
      "a 6-player Fixed Partner session has three ranked subjects — one per pair, not one per player",
    ).toBe(3);
    expect(hostSubjects, 'the "Players" tile counts ranked subjects, which for Fixed Partner is pairs').toBe(3);
    expect(hostRounds).toBe(3);
    expect(hostMatches, "1 court × 3 rounds = 3 final matches").toBe(3);
    expect(
      hostTable.map((row) => row.rank),
      "the table under the podium lists every subject including rank 1, in rank order",
    ).toEqual([1, 2, 3]);

    // Every subject is a PAIR label built from two roster names — and the pair
    // holding the claimed spot now carries the PLAYER's account name, because
    // accepting a claim renames that row.
    const expectedSubjects = [
      `${FP_PAIRS[0][0]} & ${FP_PAIRS[0][1]}`,
      `${FP_PAIRS[1][0]} & ${FP_PAIRS[1][1]}`,
      `${FP_PAIRS[2][0]} & ${playerName}`,
    ];
    expect(
      [...hostTable.map((row) => row.subject)].sort(),
      "the podium page's subjects should be the three pairs the wizard locked in",
    ).toEqual([...expectedSubjects].sort());

    // ── The player's podium: same URL, same everything ──────────────────────
    // Navigated to directly rather than through the You tab's Player list: that
    // list comes from get_player_sessions, which matches CONFIRMED JOIN REQUESTS
    // BY EMAIL, and claiming a spot files no join request — so a claim-linked
    // session never appears there. Reported as a finding; it is not what this
    // block is about, and /session/:id/final is the one destination the app
    // itself sends every reader to.
    await playerPage.goto(`/session/${sessionId}/final`);
    await expect(playerPage, "the player should be on the very same URL as the host").toHaveURL(
      new RegExp(`/session/${sessionId}/final`),
    );
    await expect(
      playerPage.getByText("Session complete"),
      "the player got an error instead of the podium — see the http-*.txt attachments",
    ).toBeVisible();

    const playerTable = await readPodiumTable(playerPage);
    expect(
      playerTable,
      "the player's podium table differs from the host's — that is exactly the bug block 5 exists for",
    ).toEqual(hostTable);
    expect(await readPodiumHeadline(playerPage), "the two accounts name different winners").toBe(hostHeadline);
    expect(await readStatTile(playerPage, "Players")).toBe(hostSubjects);
    expect(await readStatTile(playerPage, "Rounds")).toBe(hostRounds);
    expect(await readStatTile(playerPage, "Matches")).toBe(hostMatches);

    // ── The player's "Standings & rounds": read-only, no login wall ─────────
    await playerPage.getByRole("link", { name: "Standings & rounds", exact: true }).click();
    await expect(playerPage, 'the podium\'s "Standings & rounds" should open /live/:token').toHaveURL(
      /\/live\/[^/?#]+/,
    );
    await expect(playerPage.getByText("Final result", { exact: true })).toBeVisible();
    await expect(playerPage.getByText("Ended", { exact: true })).toBeVisible();
    await expect(playerPage.getByRole("heading", { name: sessionName })).toBeVisible();
    await expect(
      playerPage.getByRole("button", { name: "Continue", exact: true }),
      "the read-only view asked the player to sign in — this button used to point at the host-gated screen",
    ).toHaveCount(0);
    const spectatorBoard = playerPage
      .getByText("Full standings", { exact: true })
      .locator("xpath=following-sibling::div[1]");
    for (const subject of expectedSubjects) {
      await expect(
        spectatorBoard.getByText(subject, { exact: true }),
        `"${subject}" is missing from the read-only view's Full standings`,
      ).toHaveCount(1);
    }

    // ── The host's /host URL now belongs to the podium ──────────────────────
    await gotoTab(hostPage, "play");
    await hostPage.goto(`/session/${sessionId}/host`);
    await expect(
      hostPage,
      "an ended session's host URL should redirect to the podium — HostLivePage does it on load",
    ).toHaveURL(new RegExp(`/session/${sessionId}/final`), { timeout: 30_000 });
    // The redirect uses `replace`, so Back leaves rather than bouncing forward.
    await hostPage.goBack();
    await expect(
      hostPage,
      "Back from the podium bounced straight forward again — the redirect is not replacing history",
    ).toHaveURL(/\/play(\?|#|$)/);

    // ── The share case: a stranger with the link ────────────────────────────
    const strangerContext = await browser.newContext({ baseURL, viewport, hasTouch: true });
    const stranger = await strangerContext.newPage();
    const strangerCapture = captureFailures(stranger);
    try {
      await stranger.goto(`/session/${sessionId}/final`);
      await expect(
        stranger.getByText("Session complete"),
        "a signed-out visitor cannot open the podium — get_public_session_by_id is granted to anon, so this is the share link broken",
      ).toBeVisible();
      await expect(stranger.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
      expect(
        await readPodiumTable(stranger),
        "the shared link shows a different board from the host's",
      ).toEqual(hostTable);
    } finally {
      await strangerCapture.flush();
      await strangerContext.close();
    }
  });

  // Block 4, steps 1-3. Guards 0039's get_my_participation. Asserted as DELTAS
  // rather than absolute totals: this suite runs against a real account whose
  // history is whatever previous runs left, and two documented open bugs (a
  // rating write that fails at session end is never retried, and sessions
  // deleted before 0040 were never unrated) mean the absolute rating-games and
  // record totals can legitimately disagree by a constant. The delta is what
  // this fix actually controls, and it has to be identical on both sides.
  test("a claimed player's record and counters count the session they played", async ({ hostPage, playerPage }) => {
    test.setTimeout(300_000);
    captureFailures(hostPage);
    captureFailures(playerPage);

    const playerName = await readDisplayName(playerPage);
    const before = await readSettledYouNumbers(playerPage);

    const sessionId = trackSession(
      await createSession(hostPage, {
        name: uniqueName("record"),
        format: "americano",
        players: FOUR_PLAYERS,
        courts: 1,
      }),
    );
    await linkPlayerToSession(hostPage, playerPage, sessionId, playerName);

    // 4 players on 1 court: everyone is on court every round, so the player's
    // game count for this session is exactly the round count.
    const rounds = await scoreWholeSchedule(hostPage, marginFor);
    expect(rounds, "4 players on 1 court should pre-generate 3 rounds").toBe(3);
    await endSession(hostPage);

    // Two independent writes have to land before this page is comparable: the
    // record's rows (the matches, already final) and profiles.rating_games,
    // written by applySessionRatings — which endSession fires best-effort and
    // the app never reports the progress of. So poll both numbers rather than
    // waiting a fixed time and hoping.
    await expect
      .poll(
        async () => {
          const now = await readSettledYouNumbers(playerPage);
          return { games: now.games, ratingGames: now.ratingGames };
        },
        {
          message:
            "the You tab never counted this session — with a rating on screen and a record of 0 this is the RLS " +
            "split 0039 fixes (get_my_participation returning nothing); if only ratingGames is short, the " +
            "best-effort applySessionRatings write never landed and is never retried",
          timeout: 120_000,
          intervals: [2_000, 3_000, 5_000, 5_000, 10_000],
        },
      )
      .toEqual({ games: before.games + rounds, ratingGames: before.ratingGames + rounds });

    const after = await readSettledYouNumbers(playerPage);

    // 1. The Record card shows a real W·L·D, not the empty state.
    expect(
      after.record,
      'the Record card is still showing "Play a session and your record shows up here" after a session the player was linked into',
    ).not.toBeNull();
    await expect(
      playerPage.getByText("Play a session and your record shows up here."),
      "the record empty state is still on screen",
    ).toHaveCount(0);
    const record = after.record as RecordNumbers;
    const played = record.wins + record.losses + record.draws;
    const playedBefore =
      before.record === null ? 0 : before.record.wins + before.record.losses + before.record.draws;
    expect(played - playedBefore, "the record should have gained one result per match played").toBe(rounds);

    // 2. Played and Games are real numbers, not zero.
    expect(after.played, "Played is 0 with a finished session sitting in the player's history").toBeGreaterThanOrEqual(1);
    expect(after.games, "Games is 0 with a finished session sitting in the player's history").toBeGreaterThan(0);
    expect(after.played - before.played, "one more session played").toBe(1);

    // 3. The rating strip and the record agree. They come from two different
    //    places — profiles.rating_games (written by the host's
    //    apply_session_ratings) and get_my_participation — which is precisely why
    //    one could read 7 games while the other read none.
    expect(
      after.ratingGames - before.ratingGames,
      "the rating strip counted a different number of games for this session than the record did",
    ).toBe(played - playedBefore);
    expect(
      after.games,
      "the Sessions Games tile and the Record card are the same number computed twice",
    ).toBe(played);
  });

  // Block 3, steps 1-4. Guards 0038: leagueQueries had to know which of a club's
  // sessions count toward the league, and read `sessions` directly to find out —
  // a table no non-host member may SELECT from since 0021. RLS returns an empty
  // result rather than an error, so every result row was skipped and a member's
  // board was empty forever while the host's was full.
  test("a club member sees the league board the host sees", async ({ hostPage, playerPage }) => {
    test.setTimeout(360_000);
    captureFailures(hostPage);
    captureFailures(playerPage);

    const playerName = await readDisplayName(playerPage);
    const clubName = uniqueName("club");

    // ── A club owned by the host, with the player as a member ───────────────
    const club = await createClubAsHost(hostPage, clubName);
    createdClubs.push(club.id);
    await requestClubJoinAsPlayer(playerPage, club.code, clubName);
    await acceptClubJoinAsHost(hostPage, club.id, playerName);
    await expect(
      hostPage.getByText(/2 members/),
      "the club still reports one member — the join request was accepted but no membership row appeared",
    ).toBeVisible({ timeout: 30_000 });

    // ── A club session that counts for the league, including the player ─────
    const sessionName = uniqueName("club session");
    const sessionId = trackSession(
      await startSessionAsHost(hostPage, {
        name: sessionName,
        players: FOUR_PLAYERS,
        clubName,
        expectCourts: 1,
        expectRounds: 3,
      }),
    );
    await linkPlayerToSession(hostPage, playerPage, sessionId, playerName);
    await scoreWholeSchedule(hostPage, marginFor);
    await endSession(hostPage);

    // ── The member's board ─────────────────────────────────────────────────
    // applySessionResults is best-effort and fired after end-session, with no
    // progress shown anywhere, so poll for the row instead of waiting.
    await openClubLeague(playerPage, clubName);
    await expect
      .poll(
        async () => {
          await playerPage.reload();
          return playerPage.locator('a[href^="/u/"]').count();
        },
        {
          message:
            "the player's league board never populated — a member reading zeros while the host reads a board is the 0038 bug",
          timeout: 120_000,
          intervals: [3_000, 5_000, 5_000, 10_000],
        },
      )
      .toBeGreaterThan(0);

    await expect(
      playerPage.getByText("No standings yet"),
      "the member is looking at the empty state with a qualifying session played",
    ).toHaveCount(0);
    await expect(
      playerPage.getByText(/none were set to count for the league/),
      'the member\'s board says none of the club\'s sessions qualified — this is the "0 of N sessions qualified" symptom',
    ).toHaveCount(0);

    const playerRows = await readLeagueRows(playerPage);
    const ownRow = playerRows.filter((row) => row.includes(playerName));
    expect(ownRow, `the member does not appear on their own club's league board (rows: ${playerRows.join(" | ")})`).toHaveLength(1);
    // The per-row sub-line is "<n> sessions · <n> pts · CS <n>" — the only place
    // the app renders a qualifying-session count once the board is non-empty
    // (LeagueBoard.qualifyingSessions itself is only used in the empty state).
    expect(ownRow[0], "the member's row should credit them with the one qualifying session").toContain("1 session");

    // ── The host's board, same screen, same numbers ─────────────────────────
    await openClubLeague(hostPage, clubName);
    const hostRows = await readLeagueRows(hostPage);
    expect(
      playerRows,
      "the host and the member see different league boards for the same club and period",
    ).toEqual(hostRows);
  });
});
