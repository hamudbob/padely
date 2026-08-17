import type { Locator, Page } from "@playwright/test";
import {
  captureFailures,
  createSession,
  type CreateSessionOptions,
  deleteSessionAsHost,
  expect,
  scoreAllCourtsInCurrentRound,
  sessionIdFromUrl,
  setPlayerSide,
  startNextRound,
  test,
} from "./fixtures";

/**
 * docs/TEST_PLAN.md blocks 1 and 2.
 *
 * Block 1 — Fixed Position ("side_americano") is playable. The format string was
 * missing from `isFullyPreGeneratedFormat`, so on a 7-round pre-generated
 * schedule only the LAST round would open its score picker: `canEdit` fell back
 * to the Mexicano rule (`isViewingCurrent`), and the Refresh/Randomize round
 * actions were offered on a schedule that has nothing to redraw.
 *
 * Block 2 — Randomize can't destroy a round. `regenerateCurrentRound` used to
 * delete the live round and *then* generate its replacement, so anything that
 * made generation throw (fewer than 4 active players, no available courts) left
 * the round deleted and nothing in its place. It now calls `assertRegenerable`
 * BEFORE the delete.
 *
 * Everything here drives the real UI through the shared harness in fixtures.ts.
 * The helpers below are local on purpose — they are specific to the host live
 * page's round pager and Manage sheet, which no other block needs.
 *
 * Every test calls `captureFailures` explicitly, as the plan asks. The hostPage
 * fixture already wires one up; the extra call costs a duplicate http-*.txt on a
 * failing request and guarantees the attachment even if the fixture changes.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Local helpers — the round pager, the ⋯/Round-options menus, Manage
   ══════════════════════════════════════════════════════════════════════════ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Unique per run, so a leftover row from a previous run can never be picked up
 *  by `deleteSessionAsHost` (which matches on the session id) or read back as
 *  this run's session on the You tab. */
const RUN_TAG = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
let nameCounter = 0;
function uniqueSessionName(label: string): string {
  nameCounter += 1;
  return `e2e ${label} ${RUN_TAG}-${nameCounter}`;
}

const EIGHT_PLAYERS = ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
const FOUR_PLAYERS = ["Ivan", "Juliet", "Kilo", "Lima"];

/**
 * The round pager's centre label. HostLivePage renders it as
 * `<b>Round <span>{sequence}</span></b>`, so the `b` reads "Round 4" — the only
 * bold element on the Rounds tab that does.
 */
function roundLabel(page: Page): Locator {
  return page.locator("b").filter({ hasText: /^Round \d+$/ });
}

/** Which round the pager is showing right now. */
async function viewedRound(page: Page): Promise<number> {
  await expect(roundLabel(page), "the round pager never rendered").toBeVisible();
  const text = (await roundLabel(page).innerText()).trim();
  const match = /^Round\s+(\d+)$/.exec(text);
  if (!match) throw new Error(`Could not read a round number out of the pager (got "${text}").`);
  return Number.parseInt(match[1], 10);
}

/**
 * How many rounds the schedule has, read from the pager's sub-line — which for a
 * fully pre-generated format reads "Round 3 of 7". A round-by-round format never
 * renders it (it has no known total), so this doubles as an assertion that the
 * schedule really was generated upfront.
 */
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

/**
 * Walk the pager to a specific round with the ‹ / › controls.
 *
 * Only ever steps forward while browsing history, so the › it clicks is always
 * the "Next round" one and never the lit "Start next round" (which only appears
 * on the newest round, where no forward step is needed).
 */
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

/** Walk forward to the newest round in the pager and return its sequence. */
async function gotoNewestRound(page: Page): Promise<number> {
  const forward = page.getByRole("button", { name: "Next round", exact: true });
  for (let guard = 0; guard < 40; guard += 1) {
    // The control renames itself to "Start next round" on the newest round of a
    // fully-scored session — either way, there is nothing newer to walk to.
    if ((await forward.count()) === 0) break;
    if (!(await forward.isEnabled())) break;
    const current = await viewedRound(page);
    await forward.click();
    await expect(roundLabel(page)).not.toHaveText(`Round ${current}`);
  }
  return viewedRound(page);
}

/** The two score tiles of one court block in the round on screen. */
function courtTiles(page: Page, court: number): Locator {
  return page.getByText(`Court ${court}`, { exact: true }).locator("xpath=..").getByRole("button");
}

async function expectCourtScores(page: Page, court: number, scoreA: number, scoreB: number): Promise<void> {
  const tiles = courtTiles(page, court);
  await expect(tiles.nth(0), `Court ${court}, team A`).toHaveText(String(scoreA));
  await expect(tiles.nth(1), `Court ${court}, team B`).toHaveText(String(scoreB));
}

/** The score-entry sheet — anchored the same way fixtures.ts anchors it. */
function scorePicker(page: Page): Locator {
  return page.locator("p").filter({ hasText: "Entering score for:" });
}

/**
 * Wait until the offline score queue has drained, i.e. every score really
 * reached Supabase. The floating pill at the bottom of HostLivePage is the only
 * surface for it: "N scores waiting to sync" / "Syncing N scores…" / "Offline
 * · …". While anything is queued, HostLivePage also overlays the queued value
 * on the round history, so asserting a score survived a reload only means
 * something once this is clear.
 */
async function expectScoresSynced(page: Page): Promise<void> {
  await expect(
    page.getByText(/waiting to sync|Syncing \d+ score|^Offline · /),
    "scores never finished uploading — see this test's http-*.txt attachments",
  ).toHaveCount(0, { timeout: 45_000 });
}

/** Tap the full-screen scrim that both dropdowns render, to close them without
 *  activating one of their items. */
async function dismissDropdown(page: Page): Promise<void> {
  await page.mouse.click(8, 700);
}

/** The Manage Session bottom sheet (⋯ → Manage session). */
function manageSheet(page: Page): Locator {
  return page.getByText("Manage Session", { exact: true }).locator("xpath=ancestor::div[2]");
}

async function openManageSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Session menu", exact: true }).click();
  await page.getByRole("button", { name: "Manage session", exact: true }).click();
  await expect(manageSheet(page), "the Manage Session sheet never opened").toBeVisible();
}

async function closeManageSheet(page: Page): Promise<void> {
  await manageSheet(page).getByRole("button", { name: "✕", exact: true }).click();
  await expect(page.getByText("Manage Session", { exact: true })).toHaveCount(0);
}

/**
 * Mark one player as left from the Manage sheet.
 *
 * The roster row has no test id, so it's matched on its exact whole text: the
 * player's name plus its single action button. That text is also how we prove the
 * change landed — the row turns into "<name> LEFT Restore".
 */
async function markPlayerLeft(page: Page, player: string): Promise<void> {
  const sheet = manageSheet(page);
  const activeRow = sheet.locator("div").filter({ hasText: new RegExp(`^${escapeRegExp(player)}Mark as left$`) });
  await expect(activeRow, `no active roster row for "${player}" in Manage Session`).toHaveCount(1);
  await activeRow.getByRole("button", { name: "Mark as left", exact: true }).click();
  await expect(
    sheet.locator("div").filter({ hasText: new RegExp(`^${escapeRegExp(player)}\\s*LEFT\\s*Restore$`) }),
    `"${player}" was not marked as left`,
  ).toHaveCount(1);
}

type RoundOption = "Refresh round" | "Randomize" | "Delete round";

/** The confirm dialog's button is labelled differently from the menu item it
 *  came from ("Refresh round" → "Refresh"). */
const CONFIRM_LABEL: Record<RoundOption, string> = {
  "Refresh round": "Refresh",
  Randomize: "Randomize",
  "Delete round": "Delete round",
};

/** Open the "Round options" dropdown and run one of its three actions. */
async function runRoundOption(page: Page, option: RoundOption): Promise<void> {
  const trigger = page.getByRole("button", { name: "Round options", exact: true });
  await expect(trigger, 'the "Round options" control is not on screen').toBeVisible();
  await trigger.click();
  // Each menu item's accessible name is its title plus its description line.
  const item = page.getByRole("button", { name: new RegExp(`^${escapeRegExp(option)}`) });
  await expect(item, `"${option}" is not in the Round options menu`).toBeVisible();
  await item.click();

  // Refresh/Randomize only confirm when they would discard scores already
  // entered in the live round; Delete always confirms. Give the dialog a moment
  // to appear, then take it if it did.
  const confirm = page.getByRole("button", { name: CONFIRM_LABEL[option], exact: true });
  await confirm.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  if (await confirm.isVisible()) await confirm.click();

  await expect(trigger, "the round action never finished (still Working…)").toBeVisible({ timeout: 45_000 });
}

/* ══════════════════════════════════════════════════════════════════════════
   Cleanup
   ══════════════════════════════════════════════════════════════════════════ */

const createdSessions: string[] = [];

/** Create a session and register it for deletion, so a failure halfway through a
 *  test still leaves nothing behind. */
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

test.describe("Fixed Position and the round actions", () => {
  // Block 1, steps 1 + 3. Guards: `side_americano` missing from
  // `isFullyPreGeneratedFormat`, which made `canEdit` fall back to
  // "only the newest round", so round 1 of 7 refused to open the score picker.
  test("a Fixed Position schedule opens and scores round 1, not just the newest round", async ({ hostPage }) => {
    // Creating an 8-player session, scoring 2 courts, waiting for the sync
    // queue, reloading and walking the pager does not fit in the 90s default.
    test.setTimeout(180_000);
    captureFailures(hostPage);

    await createTrackedSession(hostPage, {
      name: uniqueSessionName("Fixed Position r1"),
      format: "side_americano",
      players: EIGHT_PLAYERS,
      courts: 2,
    });

    // The whole schedule exists at start, and the page auto-positions on the
    // first unfinished round — round 1, not the newest one.
    await expect(roundLabel(hostPage), "the pager did not open on round 1").toHaveText("Round 1");
    expect(
      await scheduleLength(hostPage),
      "8 players on 2 courts should pre-generate 7 rounds (28 partnerships / 4 per round)",
    ).toBe(7);

    // Walk to the newest round and back, so the round we score is one the pager
    // navigated to — that is the exact path the bug broke.
    expect(await gotoNewestRound(hostPage)).toBe(7);
    await gotoRound(hostPage, 1);

    const courts = await scoreAllCourtsInCurrentRound(hostPage, (court) =>
      court === 1 ? { scoreA: 15, scoreB: 6 } : { scoreA: 12, scoreB: 9 },
    );
    expect(courts, "2 courts were requested, so round 1 should have 2 match blocks").toBe(2);

    // Prove the scores are on the server, not just in the local sync queue:
    // wait for the queue to drain, then reload and read them back.
    await expectScoresSynced(hostPage);
    await hostPage.reload();
    // With round 1 final, the auto-position now lands on round 2 — which is
    // itself server-side proof that round 1 was accepted as scored.
    await expect(
      roundLabel(hostPage),
      "after a reload the pager should sit on round 2, the first still-unfinished round",
    ).toHaveText("Round 2");

    await gotoRound(hostPage, 1);
    await expectCourtScores(hostPage, 1, 15, 6);
    await expectCourtScores(hostPage, 2, 12, 9);
  });

  // Block 1, step 4. Guards the same `canEdit` regression from the other side:
  // a round that is neither the newest nor adjacent to a scored one must open.
  test("a Fixed Position round can be scored out of order (round 4 before rounds 2 and 3)", async ({ hostPage }) => {
    test.setTimeout(180_000);
    captureFailures(hostPage);

    await createTrackedSession(hostPage, {
      name: uniqueSessionName("Fixed Position r4"),
      format: "side_americano",
      players: EIGHT_PLAYERS,
      courts: 2,
    });

    await expect(roundLabel(hostPage)).toHaveText("Round 1");
    expect(await scheduleLength(hostPage)).toBe(7);

    // Jump straight to round 4 — rounds 1, 2 and 3 are left untouched.
    await gotoRound(hostPage, 4);
    const courts = await scoreAllCourtsInCurrentRound(hostPage, (court) =>
      court === 1 ? { scoreA: 21, scoreB: 0 } : { scoreA: 11, scoreB: 10 },
    );
    expect(courts).toBe(2);
    await expectScoresSynced(hostPage);

    await hostPage.reload();
    // Round 1 is still the first unfinished round, so the pager returns there —
    // round 4 being scored did not disturb the rest of the schedule.
    await expect(roundLabel(hostPage)).toHaveText("Round 1");
    await gotoRound(hostPage, 4);
    await expectCourtScores(hostPage, 1, 21, 0);
    await expectCourtScores(hostPage, 2, 11, 10);
  });

  // Block 1, step 5. Guards the second half of the same bug: the round actions
  // were offered for a fixed schedule, where redrawing one round mid-schedule is
  // meaningless. Asserted on the NEWEST round, where the only remaining reason
  // for them to be hidden is the format itself.
  test("Fixed Position offers no Refresh or Randomize anywhere in its menus", async ({ hostPage }) => {
    test.setTimeout(180_000);
    captureFailures(hostPage);

    await createTrackedSession(hostPage, {
      name: uniqueSessionName("Fixed Position menu"),
      format: "side_americano",
      players: FOUR_PLAYERS,
      courts: 1,
    });

    // Wait for the page's own auto-positioning to settle before navigating, so
    // the pager can't be moved out from under the assertions below.
    await expect(roundLabel(hostPage)).toHaveText("Round 1");
    const total = await scheduleLength(hostPage);
    expect(total, "4 players on 1 court should pre-generate 3 rounds").toBe(3);
    // On the newest round of a live session with more than one round — the exact
    // state in which a Mexicano session DOES offer the round actions.
    expect(await gotoNewestRound(hostPage)).toBe(total);

    await expect(
      hostPage.getByRole("button", { name: "Round options", exact: true }),
      "Fixed Position pre-generates its whole schedule — it must not offer round redraws",
    ).toHaveCount(0);
    await expect(hostPage.getByText("Refresh round", { exact: true })).toHaveCount(0);
    await expect(hostPage.getByText("Randomize", { exact: true })).toHaveCount(0);
    await expect(hostPage.getByText("Delete round", { exact: true })).toHaveCount(0);

    // The ⋯ header menu itself: Manage and End, and nothing about redrawing.
    await hostPage.getByRole("button", { name: "Session menu", exact: true }).click();
    await expect(hostPage.getByRole("button", { name: "Manage session", exact: true })).toBeVisible();
    await expect(hostPage.getByRole("button", { name: "End session", exact: true })).toBeVisible();
    await expect(
      hostPage.getByRole("button", { name: /Refresh|Randomize/ }),
      "the ⋯ menu must not offer a redraw on a fixed schedule",
    ).toHaveCount(0);
  });

  // Block 1, step 1 (the wizard half). The review step is the host's only
  // promise that the whole schedule is generated upfront; before the fix the
  // wizard made that promise and the live screen then refused to honour it.
  // Driven step by step rather than through createSession(), because the
  // assertions are on screens createSession passes through.
  test("the wizard promises all 7 Fixed Position rounds on the review step", async ({ hostPage }) => {
    test.setTimeout(180_000);
    captureFailures(hostPage);
    const next = hostPage.getByRole("button", { name: "Next", exact: true });
    const sessionName = uniqueSessionName("Fixed Position review");

    await hostPage.goto("/create");
    await hostPage.getByPlaceholder("Tuesday Night Padel").fill(sessionName);
    await next.click();

    const formatCard = hostPage
      .getByRole("button")
      .filter({ has: hostPage.getByText("Fixed Position", { exact: true }) });
    await formatCard.click();
    await expect(formatCard).toContainText("✓");
    await next.click();

    await hostPage.getByRole("button", { name: "Bulk Add", exact: true }).click();
    await hostPage.getByPlaceholder("One name per line").fill(EIGHT_PLAYERS.join("\n"));
    await hostPage.getByRole("button", { name: "Add all lines as players", exact: true }).click();
    await expect(hostPage.getByText(`Players (${EIGHT_PLAYERS.length})`)).toBeVisible();
    // Fixed Position builds every team from one Left + one Right.
    for (const [i, player] of EIGHT_PLAYERS.entries()) {
      await setPlayerSide(hostPage, player, i % 2 === 0 ? "L" : "R");
    }
    await next.click();

    // The Courts step auto-sizes both steppers; read them without touching them.
    // "−" is U+2212 MINUS SIGN, and the value is the <b> that follows it.
    const stepperValue = (row: Locator): Locator =>
      row.getByRole("button", { name: "−", exact: true }).locator("xpath=following-sibling::b[1]");
    const courtRow = hostPage.getByText("Court count", { exact: true }).locator("xpath=..");
    const roundsRow = hostPage.getByText("Rounds", { exact: true }).locator("xpath=../..");
    await expect(stepperValue(courtRow), "8 players should auto-size to 2 courts").toHaveText("2");
    await expect(
      stepperValue(roundsRow),
      "Fixed Position is an upfront-schedule format: the Courts step must offer a round count, auto-calculated to 7",
    ).toHaveText("7");
    await next.click();

    // Points step — keep the default (Fixed 21 points).
    await next.click();

    const readiness = hostPage.getByText(/the whole schedule is ready the moment you start/);
    await expect(readiness, "the Review step never promised the full schedule").toBeVisible();
    await expect(readiness, "round 1 is previewed, so the other 6 are the ones announced here").toContainText(
      "6 more rounds",
    );

    // Reaching the Players step already minted a draft session row, so this
    // wizard has to be finished rather than abandoned — otherwise the draft is
    // test data left behind. Starting it also ties the promise above to what the
    // live screen actually got.
    const start = hostPage.getByRole("button", { name: "Start Session", exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    await hostPage.waitForURL(/\/session\/[^/]+\/host/, { timeout: 45_000 });
    createdSessions.push(sessionIdFromUrl(hostPage.url()));
    await expect(hostPage.getByRole("heading", { name: sessionName })).toBeVisible();

    await expect(roundLabel(hostPage)).toHaveText("Round 1");
    expect(
      await scheduleLength(hostPage),
      "the Review step promised 7 rounds — the live session must have all 7",
    ).toBe(7);
  });

  // Block 1, step 7 — the contrast case. A round-by-round format keeps the old
  // rules: the round actions ARE offered, and only the live round is scorable.
  // If this test and the two above ever agree, the single source of truth in
  // isFullyPreGeneratedFormat has collapsed again.
  test("Mexicano does offer Refresh/Randomize, and only its current round is scorable", async ({ hostPage }) => {
    test.setTimeout(180_000);
    captureFailures(hostPage);

    await createTrackedSession(hostPage, {
      name: uniqueSessionName("Mexicano menu"),
      format: "mexicano",
      players: FOUR_PLAYERS,
      courts: 1,
    });

    // Round-by-round: no "of M" total, because later rounds don't exist yet.
    await expect(roundLabel(hostPage)).toHaveText("Round 1");
    await expect(
      hostPage.getByText(/^Round \d+ of \d+/),
      "Mexicano generates one round at a time — it must not claim a schedule length",
    ).toHaveCount(0);
    await expect(hostPage.getByText("Current round", { exact: true })).toBeVisible();

    await scoreAllCourtsInCurrentRound(hostPage, { scoreA: 15, scoreB: 6 });
    await expectScoresSynced(hostPage);
    await startNextRound(hostPage);
    await expect(roundLabel(hostPage)).toHaveText("Round 2");

    // All three round actions, on the live round of a two-round session.
    const trigger = hostPage.getByRole("button", { name: "Round options", exact: true });
    await expect(trigger, "Mexicano's live round should offer the redraw actions").toBeVisible();
    await trigger.click();
    await expect(hostPage.getByRole("button", { name: /^Refresh round/ })).toBeVisible();
    await expect(hostPage.getByRole("button", { name: /^Randomize/ })).toBeVisible();
    await expect(hostPage.getByRole("button", { name: /^Delete round/ })).toBeVisible();
    await dismissDropdown(hostPage);
    await expect(hostPage.getByRole("button", { name: /^Refresh round/ })).toHaveCount(0);

    // Round 1 is history now: read-only, and the actions go with it.
    await gotoRound(hostPage, 1);
    const tiles = courtTiles(hostPage, 1);
    await expect(tiles.nth(0), "a past Mexicano round must not be editable").toBeDisabled();
    await expect(tiles.nth(1)).toBeDisabled();
    await expect(scorePicker(hostPage), "no score picker should be open on a history round").toHaveCount(0);
    await expect(
      hostPage.getByRole("button", { name: "Round options", exact: true }),
      "the round actions only apply to the live round",
    ).toHaveCount(0);
  });

  // Block 2, steps 1–4. Guards the delete-then-regenerate order in
  // `regenerateCurrentRound`: one tap on Randomize used to eat the live round
  // whenever generation could not produce a replacement. The assertion that
  // matters is the last one — the round is still there after the failure.
  test("Randomize redraws the live round and never deletes it, even when the redraw fails", async ({ hostPage }) => {
    test.setTimeout(180_000);
    captureFailures(hostPage);

    await createTrackedSession(hostPage, {
      name: uniqueSessionName("Mexicano randomize"),
      format: "mexicano",
      players: FOUR_PLAYERS,
      courts: 1,
    });

    // Round 1 scored, round 2 live and unscored.
    await scoreAllCourtsInCurrentRound(hostPage, { scoreA: 15, scoreB: 6 });
    await expectScoresSynced(hostPage);
    await startNextRound(hostPage);
    await expect(roundLabel(hostPage)).toHaveText("Round 2");
    // Sequences are 1-based and contiguous, so the newest sequence IS the round
    // count — 2 rounds now, and 2 rounds is what must survive everything below.
    expect(await gotoNewestRound(hostPage)).toBe(2);

    // ── The happy path: a redraw that succeeds keeps the round ──────────────
    await runRoundOption(hostPage, "Randomize");
    await expect(roundLabel(hostPage), "Randomize must redraw round 2, not drop back to round 1").toHaveText("Round 2");
    expect(await gotoNewestRound(hostPage), "the round count changed after a successful Randomize").toBe(2);
    await expect(
      hostPage.getByRole("button", { name: "Previous round", exact: true }),
      "round 1 should still be behind round 2 in the pager",
    ).toBeEnabled();
    await expect(hostPage.getByText("Current round", { exact: true }), "round 2 should still be the live round").toBeVisible();
    await expect(hostPage.getByText("LIVE", { exact: true }), "the session should still be live").toBeVisible();
    await expect(hostPage.getByText("Court 1", { exact: true })).toBeVisible();

    // ── The failure path: fewer than 4 active players ───────────────────────
    await openManageSheet(hostPage);
    await markPlayerLeft(hostPage, FOUR_PLAYERS[0]);
    await closeManageSheet(hostPage);

    await runRoundOption(hostPage, "Randomize");
    await expect(
      hostPage.getByText(/at least 4 active players/),
      "a redraw that cannot be built must say so — see assertRegenerable in roundActions.ts",
    ).toBeVisible();

    // THE POINT OF THIS TEST: the round survived the failed redraw.
    await expect(roundLabel(hostPage), "round 2 was deleted by a failed Randomize").toHaveText("Round 2");
    expect(await gotoNewestRound(hostPage), "a failed Randomize must not change the round count").toBe(2);
    await expect(
      hostPage.getByText("Court 1", { exact: true }),
      "round 2 still has to have its match on screen after the failed redraw",
    ).toBeVisible();
    await expect(
      hostPage.getByRole("button", { name: "Previous round", exact: true }),
      "round 1 must still be there too",
    ).toBeEnabled();
  });
});
