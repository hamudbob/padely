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
  test,
} from "./fixtures";

/**
 * docs/TEST_PLAN.md block 9 — "Deleting a session takes its rating with it".
 *
 * The bug: profiles.rating is a SNAPSHOT that apply_session_ratings overwrites at
 * the end of every session. Deleting the session cascaded away its matches,
 * players and league rows — so the record recomputed and the league forgot it —
 * but nothing ever walked the rating back. Run a test session, win it, delete it,
 * and the spike stayed forever, on a rating that no longer corresponded to any
 * game that existed. rating_history kept a point for it too, with session_id
 * nulled by the FK, so the trend line kept a bump nobody could trace.
 *
 * 0040's answer, and the two branches these tests pin down:
 *
 *   • the session is the player's MOST RECENT rated one → restore the snapshot
 *     rating_history now records (rating / RD / volatility / games as they were
 *     before it). An exact undo. That is 9a.
 *   • later sessions have been rated since → subtract that session's delta and
 *     its game count, and leave RD/volatility alone, because Glicko-2 is
 *     sequential and there is no term-by-term removal of a middle session. That
 *     is 9b.
 *
 * ── Two things this file is careful about ───────────────────────────────────
 *
 * 1. TIMING. applySessionRatings is fired best-effort from endSession and the app
 *    surfaces no progress for it at all — no spinner, no toast, nothing that
 *    turns green when it lands. Every "has the rating moved / moved back" check
 *    is therefore an expect.poll with a generous timeout that reloads the You tab
 *    each attempt, never a fixed wait. A fixed wait here would either be flaky or
 *    be a minute long.
 *
 * 2. THE PLAYER MUST BE LINKED. Only "Claim your spot", accepted by the host,
 *    ties a player row to an account (0029). A player who joins by code and is
 *    confirmed stays unlinked and is never rated — a documented open bug, not
 *    something these tests can work around. So every rated session below is:
 *    host starts it with a placeholder → player claims the placeholder from the
 *    live view → host accepts → then play.
 *
 * Numbers are always read as DELTAS against a baseline taken at the start of the
 * test, never as absolutes: this suite runs against a real account whose history
 * is whatever earlier runs left behind.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Naming and rosters
   ══════════════════════════════════════════════════════════════════════════ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RUN_TAG = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
let nameCounter = 0;
function uniqueName(label: string): string {
  nameCounter += 1;
  return `e2e ${label} ${RUN_TAG}-${nameCounter}`;
}

/** The placeholder row the PLAYER account claims. */
const CLAIM_TARGET = "Zola Spot";

/** A rated session's roster: three placeholders plus the claim target. */
const CLAIMABLE_FOUR = ["Gilang Aji", "Hanif Budi", "Intan Citra", CLAIM_TARGET];

/** A roster with no claimable spot in it — nobody's account is ever attached to
 *  these, so no session built from them can move any rating. */
const GUEST_FOUR = ["Nadia Sari", "Oka Putu", "Prita Ayu", "Rudi Hasan"];

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

/**
 * The player half of the link: /watch → the host's code → the live view →
 * "Claim your spot" → the placeholder that represents them. The session has to be
 * LIVE — request_player_claim refuses on an ended one, and the panel only renders
 * while it is live.
 */
async function claimSpotAsPlayer(page: Page, joinCode: string, placeholder: string): Promise<void> {
  await page.goto("/watch");
  const code = page.getByLabel("6-digit code");
  await expect(code, "the /watch code screen never rendered its input").toBeVisible();
  await code.fill(joinCode);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/live\/[^/?#]+/, { timeout: 30_000 });

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
    `"${placeholder}" is not offered as a claimable spot — get_claimable_players only returns ACTIVE, still-unlinked names`,
  ).toBeVisible();
  await chip.click();
  await expect(
    page.getByText(new RegExp(`Claim sent for\\s+${escapeRegExp(placeholder)}`)),
    "the claim was not filed — see this test's http-*.txt attachments for the RPC error",
  ).toBeVisible();
}

/**
 * The host half: accept the claim, which sets players.linked_user_id AND renames
 * that row to the claimant's profile name. The host page polls claims every 10
 * seconds; reloading asks immediately.
 */
async function acceptClaimAsHost(page: Page, sessionId: string, placeholder: string): Promise<void> {
  await page.goto(`/session/${sessionId}/host`);
  const heading = page.getByText(/^Claim requests?$/);
  await expect(heading, "no claim request ever reached the host — see the http-*.txt attachments").toBeVisible({
    timeout: 30_000,
  });
  const card = heading.locator("xpath=..");
  await expect(card, `the claim card does not mention "${placeholder}"`).toContainText(placeholder);
  await card.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    page.getByText(/^Claim requests?$/),
    "the claim card stayed on screen — respond_player_claim failed (see the attachments)",
  ).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Link the PLAYER account into a live session and prove it took: without this,
 * nothing the player does in the session is theirs and nothing below would have
 * anything to measure.
 */
async function linkPlayerToSession(
  hostPage: Page,
  playerPage: Page,
  sessionId: string,
  playerName: string,
): Promise<void> {
  const joinCode = await readJoinCode(hostPage);
  await claimSpotAsPlayer(playerPage, joinCode, CLAIM_TARGET);
  await acceptClaimAsHost(hostPage, sessionId, CLAIM_TARGET);
  // The panel polls every 8s while a claim is pending; reload rather than wait.
  await playerPage.reload();
  await expect(
    playerPage.getByText(new RegExp(`in as\\s+${escapeRegExp(playerName)}`)),
    `the player's live view still doesn't say they're in as "${playerName}" — the accept did not link the account, ` +
      `so this session will never touch their rating`,
  ).toBeVisible({ timeout: 30_000 });
}

/* ══════════════════════════════════════════════════════════════════════════
   Scoring a pre-generated schedule
   ══════════════════════════════════════════════════════════════════════════ */

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

/** Wait until the offline score queue has drained, so the ratings about to be
 *  applied are applied to scores the server actually has. */
async function expectScoresSynced(page: Page): Promise<void> {
  await expect(
    page.getByText(/waiting to sync|Syncing \d+ score|^Offline · /),
    "scores never finished uploading — see this test's http-*.txt attachments",
  ).toHaveCount(0, { timeout: 45_000 });
}

/**
 * Score every round of a fully pre-generated schedule and return the round count.
 *
 * With 4 players on 1 court everyone is on court every round, so for a
 * claim-linked player this number is also their game count for the session —
 * which is what the games arithmetic below is checked against.
 *
 * Every round is scored decisively (never a draw): a drawn game between equal
 * ratings can move a rating by less than half a point, which rounds to no visible
 * change at all in the rating strip and would make "the rating moved" unprovable.
 */
async function scoreWholeSchedule(page: Page): Promise<number> {
  const margins = [
    { scoreA: 21, scoreB: 0 },
    { scoreA: 19, scoreB: 2 },
    { scoreA: 15, scoreB: 6 },
  ];
  const rounds = await scheduleLength(page);
  for (let sequence = 1; sequence <= rounds; sequence += 1) {
    await gotoRound(page, sequence);
    await scoreAllCourtsInCurrentRound(page, margins[(sequence - 1) % margins.length]);
  }
  await expectScoresSynced(page);
  return rounds;
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading the player's numbers
   ══════════════════════════════════════════════════════════════════════════ */

interface PlayerNumbers {
  /** Rating strip, left column. Rendered as Math.round of a numeric column. */
  rating: number;
  /** Rating strip, right column — profiles.rating_games. */
  games: number;
  /** Sessions tile: distinct sessions the caller has a linked player row in. */
  played: number;
  /** Sessions tile: final matches behind the record (get_my_participation). */
  matches: number;
}

async function reloadProfile(page: Page): Promise<void> {
  if (/\/profile(\?|#|$)/.test(page.url())) await page.reload();
  else await page.goto("/profile");
}

/**
 * Wait for the profile request to land.
 *
 * RatingStrip renders `profile?.rating ?? 1500` and `games ?? 0`, so until the
 * fetch resolves the You tab shows a perfectly plausible 1500 / 0 that belongs to
 * nobody. Reading through that would quietly poison a baseline — and for a fresh
 * account, 1500 / 0 is also the right answer, so the mistake wouldn't even look
 * like one. "Playing since <month year>" is the only line that requires `profile`
 * to be set, which makes it the load marker.
 */
async function waitForProfileLoaded(page: Page): Promise<void> {
  await expect(
    page.getByText(/^Playing since /),
    'the You tab never rendered "Playing since" — until the profile request lands, the rating strip shows a placeholder 1500 / 0',
  ).toBeVisible();
}

/** The account's own display name — also what accepting a claim renames the
 *  claimed player row to. */
async function readDisplayName(page: Page): Promise<string> {
  await gotoTab(page, "you");
  await waitForProfileLoaded(page);
  const name = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
  if (name.length === 0) throw new Error("The You tab's heading is empty — could not read the account's name.");
  return name;
}

/** One of the three Sessions tiles (Played · Hosted · Games). The tile is
 *  `<b>{value}</b><span>{label}</span>`; the rating strip's own "Games" label is
 *  a `p`, so a span-scoped match cannot pick it up by mistake. */
async function readTile(page: Page, label: string): Promise<number> {
  const value = page.locator(`xpath=//span[normalize-space()="${label}"]/preceding-sibling::b[1]`);
  await expect(value, `the You tab has no Sessions "${label}" tile`).toHaveCount(1);
  const text = (await value.innerText()).trim();
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) throw new Error(`The "${label}" tile does not hold a number (got "${text}").`);
  return parsed;
}

async function readNumbersFromDom(page: Page): Promise<PlayerNumbers> {
  const strip = await readRating(page);
  return {
    rating: strip.rating,
    games: strip.games,
    played: await readTile(page, "Played"),
    matches: await readTile(page, "Games"),
  };
}

/**
 * Reload the You tab and read every number off it once they have stopped moving.
 *
 * The page fills in from four independent requests and each renders a zero until
 * it answers. Waiting for "Playing since" proves only that the PROFILE landed;
 * the Sessions tiles come from getPlayerInsights, which has no load marker of its
 * own (an empty record card looks exactly like a loading one). So: read twice and
 * require the same answer. This is a settle check on one render, not a wait for
 * an asynchronous write — those are polled by the tests themselves.
 */
async function readSettledNumbers(page: Page): Promise<PlayerNumbers> {
  await reloadProfile(page);
  await waitForProfileLoaded(page);
  let previous: PlayerNumbers | null = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await readNumbersFromDom(page);
    if (previous !== null && JSON.stringify(previous) === JSON.stringify(current)) return current;
    previous = current;
    await page.waitForTimeout(500);
  }
  throw new Error("The You tab's numbers never stopped changing — something on it is refetching in a loop.");
}

/**
 * Wait for a just-ended session's rating write to land, and return the numbers
 * afterwards.
 *
 * `expectedGames` is the arithmetic anchor: profiles.rating_games grows by
 * exactly one per rated game, so it is an integer that either has or hasn't been
 * written — unlike the rating itself, which is compared with a tolerance
 * elsewhere because the strip shows Math.round of a numeric column.
 *
 * Polling, not waiting: endSession fires applySessionRatings best-effort and
 * nothing in the app reports whether it succeeded, so the only honest way to know
 * is to keep asking. A timeout here means the write never happened — the
 * documented "a failed rating write at session end is never retried" bug — and
 * not that the poll was too impatient.
 */
async function waitForRatedGames(page: Page, expectedGames: number): Promise<PlayerNumbers> {
  await expect
    .poll(async () => (await readSettledNumbers(page)).games, {
      message:
        `profiles.rating_games never reached ${expectedGames}. applySessionRatings is fired best-effort at ` +
        `end-session and never retried, so either it failed (check the host's console-errors.txt attachment) or ` +
        `the claimed player row was never linked to the account.`,
      timeout: 120_000,
      intervals: [2_000, 3_000, 5_000, 5_000, 10_000, 10_000],
    })
    .toBe(expectedGames);
  return readSettledNumbers(page);
}

/** Poll the You tab until every number matches `expected`. Used after a delete,
 *  where the reversal happens inside the delete RPC but the page that shows it is
 *  a separate browser context that has to be reloaded to notice. */
async function expectNumbersSettleTo(page: Page, expected: PlayerNumbers, message: string): Promise<void> {
  await expect
    .poll(async () => readSettledNumbers(page), {
      message,
      timeout: 120_000,
      intervals: [2_000, 3_000, 5_000, 5_000, 10_000],
    })
    .toEqual(expected);
}

/** How many rows the You tab's PLAYER list holds for a given session. */
async function playerTabRowCount(page: Page, sessionId: string): Promise<number> {
  await gotoTab(page, "you");
  await page.getByRole("button", { name: /^player$/i }).click();
  return page.locator(`a[href="/session/${sessionId}/final"]`).count();
}

/* ══════════════════════════════════════════════════════════════════════════
   Deleting
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The You tab's multi-select delete: Host list → Select → tick every row →
 * Delete (n).
 *
 * fixtures' deleteSessionAsHost does one session; this does several in one batch,
 * which is the specific thing block 9c asks for. Rows are found by href (a
 * session id is what callers have) and then re-found by the name read off them,
 * because select mode swaps the links for buttons.
 */
async function deleteSessionsAsHost(page: Page, sessionIds: string[]): Promise<void> {
  await gotoTab(page, "you");
  await page.getByRole("button", { name: /^host$/i }).click();

  const rowFor = (id: string): Locator =>
    page.locator(`a[href="/session/${id}/final"], a[href="/session/${id}/host"]`);

  const names: string[] = [];
  for (const id of sessionIds) {
    const row = rowFor(id);
    await expect(row, `session ${id} is not in the host's session list`).toHaveCount(1);
    names.push((await row.locator("b").first().innerText()).trim());
  }

  await page.getByRole("button", { name: "Select", exact: true }).click();
  for (const name of names) {
    const selectable = page.getByRole("button").filter({ hasText: name });
    await expect(selectable, `"${name}" is not selectable in the host list`).toHaveCount(1);
    await selectable.click();
  }
  await expect(
    page.getByText(`${names.length} selected`),
    `only some of the ${names.length} rows ticked`,
  ).toBeVisible();

  // Behind window.confirm — see the dialog handler in beforeEach.
  await page.getByRole("button", { name: `Delete (${names.length})`, exact: true }).click();
  for (const [index, id] of sessionIds.entries()) {
    await expect(
      rowFor(id),
      `"${names[index]}" is still listed after the batch delete — the inline error above the list has the reason, ` +
        `and the RPC's own message is in the http-*.txt attachments`,
    ).toHaveCount(0, { timeout: 60_000 });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Setup and cleanup
   ══════════════════════════════════════════════════════════════════════════ */

const createdSessions: string[] = [];
/** Draft lobbies, tracked by name because a draft has no id in any URL. */
const createdDrafts: string[] = [];

function trackSession(id: string): string {
  createdSessions.push(id);
  return id;
}

/** Forget a session this test already deleted, so cleanup doesn't hunt for it. */
function forgetSession(id: string): void {
  const at = createdSessions.indexOf(id);
  if (at >= 0) createdSessions.splice(at, 1);
}

test.beforeEach(async ({ hostPage, playerPage }) => {
  // Deleting sessions from the You tab, discarding a draft from Play — both sit
  // behind window.confirm. Playwright DISMISSES dialogs when nothing is
  // listening, and a dismissed confirm() is a "no", so without this handler
  // every delete in this file (including fixtures' deleteSessionAsHost) silently
  // does nothing.
  for (const page of [hostPage, playerPage]) {
    page.on("dialog", (dialog) => {
      void dialog.accept();
    });
  }
});

test.afterEach(async ({ hostPage }) => {
  while (createdSessions.length > 0) {
    const id = createdSessions.pop() as string;
    await deleteSessionAsHost(hostPage, id);
  }
  // A draft that was never discarded is invisible in every session list and only
  // swept after 10 days, so it has to be cleaned up from the one place it shows:
  // the "Unfinished setup" card on Play.
  while (createdDrafts.length > 0) {
    const name = createdDrafts.pop() as string;
    await hostPage.goto("/play");
    const discard = hostPage.getByRole("button", { name: `Discard ${name}`, exact: true });
    const present = await discard
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!present) continue;
    await discard.click();
    await expect(discard).toHaveCount(0, { timeout: 30_000 });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════════ */

test.describe("deleting a session takes its rating with it", () => {
  // Block 9a. Guards the snapshot branch of delete_session_and_unrate: for the
  // player's most recent rated session, rating_before / games_before are restored
  // verbatim, so the account ends up EXACTLY where it started. Before 0040 the
  // rating kept the spike and rating_history kept an untraceable point.
  test("9a — deleting the player's most recent session puts the rating back exactly", async ({
    hostPage,
    playerPage,
  }) => {
    // A claim round trip, three scored rounds, an end, a delete, and several
    // polled reloads of the You tab.
    test.setTimeout(420_000);
    captureFailures(hostPage);
    captureFailures(playerPage);

    const playerName = await readDisplayName(playerPage);
    const before = await readSettledNumbers(playerPage);

    const sessionName = uniqueName("unrate exact");
    const sessionId = trackSession(
      await createSession(hostPage, {
        name: sessionName,
        format: "americano",
        players: CLAIMABLE_FOUR,
        courts: 1,
      }),
    );
    await linkPlayerToSession(hostPage, playerPage, sessionId, playerName);

    const rounds = await scoreWholeSchedule(hostPage);
    expect(rounds, "4 players on 1 court should pre-generate 3 rounds").toBe(3);
    await endSession(hostPage);

    // ── AFTER: the rating really moved ──────────────────────────────────────
    const after = await waitForRatedGames(playerPage, before.games + rounds);
    expect(
      after.rating,
      "the rating did not move at all for a session the player played three decisive games in",
    ).not.toBe(before.rating);
    expect(after.played, "the session should be counted as one more session played").toBe(before.played + 1);
    expect(after.matches, "the record should have gained one game per match").toBe(before.matches + rounds);

    // ── The delete, through the app's own button ────────────────────────────
    await deleteSessionAsHost(hostPage, sessionId);
    forgetSession(sessionId);

    // ── BEFORE again, exactly ───────────────────────────────────────────────
    await expectNumbersSettleTo(
      playerPage,
      before,
      `deleting the player's most recent session did not restore ${JSON.stringify(before)}. This is the snapshot ` +
        `branch of delete_session_and_unrate: rating_before / games_before are stored by apply_session_ratings ` +
        `(0040) and restored verbatim, so anything else means the snapshot was missing or the wrong branch ran.`,
    );

    // The session is gone from the player's side too.
    //
    // NOTE on how weak this assertion is: the You tab's Player list comes from
    // get_player_sessions, which matches CONFIRMED JOIN REQUESTS BY EMAIL.
    // Claiming a spot files no join request, so a claim-linked session is never
    // in that list to begin with — asserting it has gone can't fail. The real
    // "it's out of my history" evidence is the Played / Games tiles above, which
    // do come from the player's linked rows. Reported as a finding.
    expect(
      await playerTabRowCount(playerPage, sessionId),
      "the deleted session is still listed on the player's Player tab",
    ).toBe(0);
  });

  // Block 9b. Guards the OTHER branch: with a later session already rated, the
  // deleted one can only be subtracted — its delta off the rating, its game count
  // off the games — and RD/volatility are deliberately left where the later
  // session put them, because Glicko-2 is sequential and an exact removal would
  // need a full replay. S1's delta is derived from the readings, never hardcoded.
  test("9b — deleting an older session subtracts that session's delta", async ({ hostPage, playerPage }) => {
    // Two full claim-and-play sessions back to back.
    test.setTimeout(600_000);
    captureFailures(hostPage);
    captureFailures(playerPage);

    const playerName = await readDisplayName(playerPage);
    const start = await readSettledNumbers(playerPage);

    // ── S1 ──────────────────────────────────────────────────────────────────
    const firstId = trackSession(
      await createSession(hostPage, {
        name: uniqueName("unrate older S1"),
        format: "americano",
        players: CLAIMABLE_FOUR,
        courts: 1,
      }),
    );
    await linkPlayerToSession(hostPage, playerPage, firstId, playerName);
    const firstRounds = await scoreWholeSchedule(hostPage);
    await endSession(hostPage);
    const afterFirst = await waitForRatedGames(playerPage, start.games + firstRounds);

    // ── S2 ──────────────────────────────────────────────────────────────────
    const secondId = trackSession(
      await createSession(hostPage, {
        name: uniqueName("unrate older S2"),
        format: "americano",
        players: CLAIMABLE_FOUR,
        courts: 1,
      }),
    );
    await linkPlayerToSession(hostPage, playerPage, secondId, playerName);
    const secondRounds = await scoreWholeSchedule(hostPage);
    await endSession(hostPage);
    const afterSecond = await waitForRatedGames(playerPage, afterFirst.games + secondRounds);

    // S1's contribution, derived from the readings rather than assumed.
    const firstDelta = afterFirst.rating - start.rating;
    const firstGames = afterFirst.games - start.games;
    expect(firstGames, "S1 should have contributed one rated game per match played").toBe(firstRounds);
    expect(firstDelta, "S1 moved the rating by nothing, so there is no subtraction to test").not.toBe(0);

    // ── Delete the OLDER one ────────────────────────────────────────────────
    await deleteSessionAsHost(hostPage, firstId);
    forgetSession(firstId);

    // Games are integers on both sides of the arithmetic, so this is exact.
    await expect
      .poll(async () => (await readSettledNumbers(playerPage)).games, {
        message:
          `games should have dropped by S1's ${firstGames} rated games. delete_session_and_unrate subtracts ` +
          `games_after - games_before for a session that is no longer the player's most recent.`,
        timeout: 120_000,
        intervals: [2_000, 3_000, 5_000, 5_000, 10_000],
      })
      .toBe(afterSecond.games - firstGames);

    const afterDelete = await readSettledNumbers(playerPage);
    // The rating is compared with a ±1 tolerance, and that is not slack for a
    // bug: profiles.rating is numeric and the strip prints Math.round of it, so
    // an expectation built out of three separately-rounded readings
    // (afterSecond − (afterFirst − start)) can differ from the app's single
    // rounding of the true value by one unit. Anything further out is a real
    // arithmetic error, not rounding.
    const expectedRating = afterSecond.rating - firstDelta;
    expect(
      Math.abs(afterDelete.rating - expectedRating),
      `after deleting S1 the rating should be (after S2) − (S1's delta) = ${afterSecond.rating} − ${firstDelta} = ` +
        `${expectedRating}, but the You tab shows ${afterDelete.rating}. A value equal to "after S1" ` +
        `(${afterFirst.rating}) means the snapshot branch ran on a session that was NOT the most recent.`,
    ).toBeLessThanOrEqual(1);

    // S2 is still there, so the player keeps its session and its games.
    expect(afterDelete.played, "only S1 should have left the player's history").toBe(start.played + 1);
    expect(afterDelete.matches, "the record should have lost exactly S1's matches").toBe(
      start.matches + secondRounds,
    );

    // NOTE for whoever runs this against a real account: cleanup CANNOT put this
    // account fully back, and no rewriting of this test would change that.
    // afterEach deletes S2, which by then IS the player's most recent rated
    // session, so 0040 restores S2's stored snapshot — and that snapshot was
    // taken after S1, which no longer exists. The account is therefore left at
    // "after S1" (the `afterFirst` reading above), a few points and
    // `firstGames` games away from where the test found it. That is the
    // documented non-exactness of removing a middle session showing up in the
    // cleanup path, not a test defect, and it is why every test in this file
    // reads its own baseline instead of trusting a global one.
  });

  // Block 9c, step 2. A draft lobby is the shell the wizard mints for its join
  // code: it has no players in the database and no rounds, so discarding it must
  // be a clean delete that touches nobody's rating. It goes through the same
  // delete_session_and_unrate RPC as a played session, which is the reason to
  // check it at all — an unrate that mis-handled a session with no history could
  // just as easily throw as no-op.
  test("9c — discarding a draft lobby deletes cleanly and changes no rating", async ({ hostPage, playerPage }) => {
    test.setTimeout(240_000);
    captureFailures(hostPage);
    captureFailures(playerPage);

    const before = await readSettledNumbers(playerPage);

    const draftName = uniqueName("draft discard");
    createdDrafts.push(draftName);
    const next = hostPage.getByRole("button", { name: "Next", exact: true });

    await hostPage.goto("/create");
    await hostPage.getByPlaceholder("Tuesday Night Padel").fill(draftName);
    await next.click(); // → Format (Americano is the default)
    await next.click(); // → Players, which is where the draft session is minted
    await expect(
      hostPage.getByText("Join code"),
      "the Players step never minted a lobby — without one there is no draft to discard",
    ).toBeVisible({ timeout: 30_000 });

    // A draft with nobody in it is deleted by the wizard on the way out, so the
    // roster is what makes this a draft that survives being left.
    await hostPage.getByRole("button", { name: "Bulk Add", exact: true }).click();
    await hostPage.getByPlaceholder("One name per line").fill(GUEST_FOUR.join("\n"));
    await hostPage.getByRole("button", { name: "Add all lines as players", exact: true }).click();
    await expect(hostPage.getByText(`Players (${GUEST_FOUR.length})`)).toBeVisible();

    // The wizard live-saves the lobby 600ms after the last edit, on a debounce
    // whose timer dies with the page. Leaving sooner would strand a draft with a
    // null draft_state: invisible on Play, unreachable by "Resume setup", and
    // only swept after ten days. A fixed wait is the honest tool for waiting out
    // a debounce — there is nothing to poll for on this screen.
    await hostPage.waitForTimeout(2_000);
    await gotoTab(hostPage, "play");

    const discard = hostPage.getByRole("button", { name: `Discard ${draftName}`, exact: true });
    await expect(
      discard,
      `"${draftName}" is not offered as an unfinished setup on Play — getResumableLobbies only lists drafts that ` +
        `have a saved draft_state with at least one player`,
    ).toBeVisible({ timeout: 30_000 });
    await discard.click();
    await expect(discard, "the draft is still on Play after discarding it").toHaveCount(0, { timeout: 30_000 });
    createdDrafts.splice(createdDrafts.indexOf(draftName), 1);

    // It was never a real session, and it is not one now.
    await gotoTab(hostPage, "you");
    await hostPage.getByRole("button", { name: /^host$/i }).click();
    await expect(
      hostPage.getByText(draftName),
      "a discarded draft is showing up in the host's session list",
    ).toHaveCount(0);

    expect(
      await readSettledNumbers(playerPage),
      "discarding a draft moved somebody's rating — nothing about a draft has ever been rated",
    ).toEqual(before);
  });

  // Block 9c, step 3. Three sessions ticked at once and deleted, and the rating
  // reflects the reversal.
  //
  // Only ONE of the three carries a rating, on purpose. ProfilePage's
  // deleteSelected fires the three delete_session_and_unrate calls CONCURRENTLY
  // (Promise.allSettled), and each call decides between 0040's snapshot branch
  // and its subtract branch by asking whether its session is the player's most
  // recent RATED one — a question whose answer depends on which of the other two
  // has already committed. With two or more rated sessions in one batch the final
  // rating is therefore genuinely order-dependent (delete the oldest first and
  // the newest still restores a snapshot that includes the one already removed),
  // so there is no deterministic value to assert. That race is worth knowing
  // about; a test that pretended otherwise would just be flaky.
  test("9c — deleting three sessions at once removes all three and reverses the rating", async ({
    hostPage,
    playerPage,
  }) => {
    test.setTimeout(480_000);
    captureFailures(hostPage);
    captureFailures(playerPage);

    const playerName = await readDisplayName(playerPage);
    const before = await readSettledNumbers(playerPage);

    // ── One rated session: claimed, played, ended ───────────────────────────
    const ratedId = trackSession(
      await createSession(hostPage, {
        name: uniqueName("multi rated"),
        format: "americano",
        players: CLAIMABLE_FOUR,
        courts: 1,
      }),
    );
    await linkPlayerToSession(hostPage, playerPage, ratedId, playerName);
    const rounds = await scoreWholeSchedule(hostPage);
    await endSession(hostPage);
    const rated = await waitForRatedGames(playerPage, before.games + rounds);
    expect(rated.rating, "the rated session did not move the rating, so there is nothing to reverse").not.toBe(
      before.rating,
    );

    // ── Two more, left live and unscored. No account is on either roster, so
    //    applySessionRatings has nobody to rate even if they were ended. ─────
    const secondId = trackSession(
      await createSession(hostPage, {
        name: uniqueName("multi guest A"),
        format: "americano",
        players: GUEST_FOUR,
        courts: 1,
      }),
    );
    const thirdId = trackSession(
      await createSession(hostPage, {
        name: uniqueName("multi guest B"),
        format: "americano",
        players: GUEST_FOUR,
        courts: 1,
      }),
    );

    // ── All three, in one batch ─────────────────────────────────────────────
    await deleteSessionsAsHost(hostPage, [ratedId, secondId, thirdId]);
    forgetSession(ratedId);
    forgetSession(secondId);
    forgetSession(thirdId);

    await expectNumbersSettleTo(
      playerPage,
      before,
      "the batch delete did not reverse the rated session's rating. Every row it deleted went through the same " +
        "delete_session_and_unrate as a single delete, so a difference here is either a failed RPC (see the " +
        "inline error the list shows and the http-*.txt attachments) or the wrong 0040 branch.",
    );
  });
});
