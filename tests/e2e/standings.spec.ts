import type { Locator, Page } from "@playwright/test";
import {
  captureFailures,
  createSession,
  type CreateSessionOptions,
  deleteSessionAsHost,
  endSession,
  expect,
  scoreAllCourtsInCurrentRound,
  test,
} from "./fixtures";

/**
 * docs/TEST_PLAN.md block 6 — "Standings show everyone (was: the board minus the
 * podium)".
 *
 * The bug: both post-session boards rendered `rows.slice(3)` under a heading that
 * said "Full standings" / sat under the podium. With three or fewer subjects that
 * table came out completely empty, and with four it was a one-row table missing
 * everyone the reader actually cares about. FinalSummaryPage now renders
 * `rest = rows` and PublicLivePage renders the whole `board`, with rank 1
 * highlighted in both — the podium is a summary, not a substitute.
 *
 * Four players is the shape that catches it: fewer subjects than the podium's
 * three plus one. A regression shows up as a table with exactly ONE row.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Local helpers
   ══════════════════════════════════════════════════════════════════════════ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RUN_TAG = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
let nameCounter = 0;
function uniqueSessionName(label: string): string {
  nameCounter += 1;
  return `e2e ${label} ${RUN_TAG}-${nameCounter}`;
}

/**
 * Two-word names on purpose. Both boards show the FULL name in the table and only
 * `firstNameOf(...)` on the podium, so a two-word name lets one assertion
 * distinguish "this name is in the table" from "this name is on the podium".
 * The first names are unique, which is what makes the podium's
 * "Well played, <first name>." heading enough to identify rank 1.
 */
const PLAYERS = ["Ana Rossi", "Budi Santo", "Cira Lopez", "Dewi Putri"];

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0];
}

/** The host live page's round-pager label, `<b>Round <span>N</span></b>`. */
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

/** Length of a fully pre-generated schedule, from the pager's "Round N of M". */
async function scheduleLength(page: Page): Promise<number> {
  const subline = page.getByText(/^Round \d+ of \d+/);
  await expect(subline, 'the pager never showed "Round N of M"').toBeVisible();
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

/** Wait for the offline score queue to drain, so the scores that the podium is
 *  about to be built from really are on the server. */
async function expectScoresSynced(page: Page): Promise<void> {
  await expect(
    page.getByText(/waiting to sync|Syncing \d+ score|^Offline · /),
    "scores never finished uploading — see this test's http-*.txt attachments",
  ).toHaveCount(0, { timeout: 45_000 });
}

/**
 * One row of the podium page's standings table (FinalSummaryPage), matched on its
 * exact whole text: rank, then the full name, then the points, and nothing else.
 *
 * The table has no test id and its container is identified only by Tailwind
 * classes, so the row's shape is the most stable thing to anchor on — the
 * enclosing table div holds every row's text at once and therefore can't match
 * an anchored single-row pattern.
 */
function podiumTableRow(page: Page, player: string): Locator {
  return page.locator("div").filter({ hasText: new RegExp(`^\\d+\\s*${escapeRegExp(player)}\\s*\\d+$`) });
}

/** The spectator view's "Full standings" table (the div right after the heading). */
function spectatorBoard(page: Page): Locator {
  return page.getByText("Full standings", { exact: true }).locator("xpath=following-sibling::div[1]");
}

/**
 * Rank 1's first name, read off the podium heading ("Well played, Ana.").
 * Returned as the matching full name from `PLAYERS`.
 */
async function winnerFromPodium(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading, "the podium never rendered its heading").toBeVisible();
  const text = (await heading.innerText()).trim();
  const match = /Well played,\s*([^.]+)\./.exec(text);
  if (!match) throw new Error(`The podium heading did not name a winner (got "${text}").`);
  const first = match[1].trim();
  const full = PLAYERS.find((p) => firstNameOf(p) === first);
  if (!full) throw new Error(`The podium named "${first}", who is not one of this session's players.`);
  return full;
}

/* ══════════════════════════════════════════════════════════════════════════
   Cleanup
   ══════════════════════════════════════════════════════════════════════════ */

const createdSessions: string[] = [];

async function createTrackedSession(page: Page, opts: CreateSessionOptions): Promise<string> {
  const id = await createSession(page, opts);
  createdSessions.push(id);
  return id;
}

test.afterEach(async ({ hostPage }) => {
  while (createdSessions.length > 0) {
    const id = createdSessions.pop() as string;
    await deleteSessionAsHost(hostPage, id);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Tests
   ══════════════════════════════════════════════════════════════════════════ */

test.describe("standings after a session ends", () => {
  // Block 6, steps 1–3. Guards the `rows.slice(3)` bug in FinalSummaryPage and
  // PublicLivePage: with only 4 subjects, a board minus the podium is a single
  // row. Both surfaces must list all four, with rank 1 among them.
  test("a 4-player session lists all 4 on the podium page and in Full standings", async ({ hostPage }) => {
    // Create + score a whole 3-round schedule + end the session + walk two
    // result screens does not fit in the 90s default.
    test.setTimeout(180_000);
    captureFailures(hostPage);

    const sessionName = uniqueSessionName("Standings 4up");
    const sessionId = await createTrackedSession(hostPage, {
      name: sessionName,
      format: "americano",
      players: PLAYERS,
      courts: 1,
    });

    // Americano pre-generates its whole schedule; 4 players on 1 court is 3
    // rounds (6 partnerships / 2 per round).
    await expect(roundLabel(hostPage)).toHaveText("Round 1");
    const rounds = await scheduleLength(hostPage);
    expect(rounds, "4 players on 1 court should pre-generate 3 rounds").toBe(3);

    // A different margin per round, so the four players end on four different
    // point totals instead of two tied pairs — a board with distinct ranks is
    // what makes "rank 1 is in the table" an unambiguous assertion.
    const margins = [
      { scoreA: 15, scoreB: 6 },
      { scoreA: 13, scoreB: 8 },
      { scoreA: 12, scoreB: 9 },
    ];
    for (let sequence = 1; sequence <= rounds; sequence += 1) {
      await gotoRound(hostPage, sequence);
      const courts = await scoreAllCourtsInCurrentRound(hostPage, margins[(sequence - 1) % margins.length]);
      expect(courts, `round ${sequence} should have exactly 1 court`).toBe(1);
    }
    await expectScoresSynced(hostPage);

    await endSession(hostPage);
    await expect(hostPage).toHaveURL(new RegExp(`/session/${sessionId}/final`));

    // ── The podium page ─────────────────────────────────────────────────────
    const winner = await winnerFromPodium(hostPage);

    // The stat tile counts the subjects the board was built from.
    await expect(
      hostPage.locator("div").filter({ hasText: /^4\s*Players$/ }),
      "the podium should report 4 players",
    ).toHaveCount(1);

    // Every subject is in the table under the podium — this is the assertion the
    // block exists for. Before the fix this table held one row (rows.slice(3)).
    for (const player of PLAYERS) {
      await expect(
        podiumTableRow(hostPage, player),
        `"${player}" is missing from the podium page's standings table — it is showing the board minus the podium`,
      ).toHaveCount(1);
    }

    // Rank 1 is in the table AND on the podium, not only on the podium.
    await expect(
      podiumTableRow(hostPage, winner),
      `rank 1 (${winner}) must be the first row of the table, not omitted from it`,
    ).toHaveText(new RegExp(`^1\\s*${escapeRegExp(winner)}`));
    await expect(
      hostPage.locator("p").filter({ hasText: new RegExp(`^${escapeRegExp(firstNameOf(winner))}$`) }),
      `${winner} should also be named on the podium itself`,
    ).toHaveCount(1);

    // ── The spectator view, reached the way a reader reaches it ─────────────
    await hostPage.getByRole("link", { name: "Standings & rounds", exact: true }).click();
    await expect(hostPage, "the podium's read-only link should open /live/:token").toHaveURL(/\/live\/[^/?#]+/);
    await expect(hostPage.getByText("Final result", { exact: true })).toBeVisible();
    await expect(hostPage.getByText("Ended", { exact: true })).toBeVisible();
    await expect(hostPage.getByRole("heading", { name: sessionName })).toBeVisible();

    const board = spectatorBoard(hostPage);
    for (const player of PLAYERS) {
      await expect(
        board.getByText(player, { exact: true }),
        `"${player}" is missing from "Full standings" — the spectator board is short of the full field`,
      ).toHaveCount(1);
    }

    // Rank 1 heads the table here too, and is on this page's podium as well.
    await expect(
      board.getByText(winner, { exact: true }).locator("xpath=.."),
      `rank 1 (${winner}) must be the top row of "Full standings"`,
    ).toHaveText(new RegExp(`^1\\s*${escapeRegExp(winner)}`));
    await expect(
      hostPage.getByText(firstNameOf(winner), { exact: true }),
      `${winner} should be on the spectator podium as well as in the table`,
    ).toHaveCount(1);
    await expect(hostPage.getByText("🥇")).toBeVisible();
  });
});
