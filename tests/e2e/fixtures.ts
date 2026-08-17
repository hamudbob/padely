import fs from "node:fs";
import path from "node:path";
import {
  test as base,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

/* ══════════════════════════════════════════════════════════════════════════
   Storage state
   ══════════════════════════════════════════════════════════════════════════

   Written by auth.setup.ts (the `setup` project), consumed by the hostPage /
   playerPage fixtures. Paths are relative to the repo root, which is where
   Playwright is invoked from.
*/
export const AUTH_DIR = path.join("tests", ".auth");
export const HOST_STORAGE_STATE = path.join(AUTH_DIR, "host.json");
export const PLAYER_STORAGE_STATE = path.join(AUTH_DIR, "player.json");

/* ══════════════════════════════════════════════════════════════════════════
   Domain types — mirrored from the app, not imported
   ══════════════════════════════════════════════════════════════════════════

   These deliberately duplicate src/lib/supabase/database.types.ts rather than
   importing it: the tests drive the app through its UI, and a compile error in
   app types should not be able to take the harness down with it. If a format
   is added to the app, add it here too.
*/
export type SessionFormat =
  | "americano"
  | "mexicano"
  | "mix_americano"
  | "side_americano"
  | "mix_mexicano"
  | "team_sparring";

export type ScoringFormat = "fixed_21" | "fixed_4_games" | "fixed_5_games" | "race_4" | "race_6";

export type Side = "L" | "R";

export type TabName = "play" | "club" | "you";

/** The exact strings the Format step renders. `side_americano` is "Fixed Position". */
const FORMAT_LABELS: Record<SessionFormat, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  side_americano: "Fixed Position",
  mix_mexicano: "Mix Mexicano",
  team_sparring: "Team Sparring",
};

/** The exact strings the Points step renders. */
const SCORING_LABELS: Record<ScoringFormat, string> = {
  fixed_21: "Fixed 21 points",
  fixed_4_games: "Fixed 4 games",
  fixed_5_games: "Fixed 5 games",
  race_4: "Race to 4",
  race_6: "Race to 6",
};

/** Formats whose whole schedule is generated upfront, so the Courts step
 *  offers a round-count stepper. Mirrors `needsUpfrontSchedule` in
 *  CreateSessionPage.tsx. */
const UPFRONT_SCHEDULE_FORMATS: ReadonlySet<SessionFormat> = new Set<SessionFormat>([
  "americano",
  "mix_americano",
  "side_americano",
  "team_sparring",
]);

const TAB_PATHS: Record<TabName, string> = {
  play: "/play",
  club: "/teams",
  you: "/profile",
};

/** TabBar labels, in TabBar.tsx order. */
const TAB_LABELS: Record<TabName, string> = {
  play: "Play",
  club: "Club",
  you: "You",
};

/** The "−" in the wizard's steppers is U+2212 MINUS SIGN, not a hyphen. */
const MINUS = "−";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ══════════════════════════════════════════════════════════════════════════
   captureFailures — the most important helper in this file
   ══════════════════════════════════════════════════════════════════════════

   The app is honest with users and useless to testers: a failed insert becomes
   "Could not start the session." on screen, and the actual PostgREST error
   ("new row violates row-level security policy for table \"players\"") only
   exists in the response body. Every failing response (>= 400) is therefore
   attached to the report WITH ITS BODY, plus the request body that caused it.

   Console errors and uncaught page exceptions are accumulated and attached on
   flush(). The hostPage / playerPage fixtures flush automatically; if you build
   a page by hand, call flush() yourself (or just let the test end — the network
   attachments happen immediately either way).
*/
export interface FailureCapture {
  /** Console `error` messages and uncaught page exceptions, newest last. */
  readonly consoleErrors: string[];
  /** One entry per response with status >= 400, formatted for humans. */
  readonly failedResponses: string[];
  /** Attach the accumulated console errors. Safe to call more than once. */
  flush(): Promise<void>;
}

export function captureFailures(page: Page, info?: TestInfo): FailureCapture {
  const testInfo: TestInfo = info ?? test.info();
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const pending: Promise<void>[] = [];
  let counter = 0;
  let flushed = false;

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const loc = msg.location();
    consoleErrors.push(`[console.error] ${msg.text()}\n    at ${loc.url}:${loc.lineNumber}:${loc.columnNumber}`);
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`[pageerror] ${err.message}\n${err.stack ?? "(no stack)"}`);
  });

  page.on("requestfailed", (req) => {
    consoleErrors.push(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`);
  });

  page.on("response", (response) => {
    if (response.status() < 400) return;
    counter += 1;
    const index = counter;
    pending.push(
      (async () => {
        const request = response.request();
        let body: string;
        try {
          body = await response.text();
        } catch (err) {
          body = `<response body unavailable: ${err instanceof Error ? err.message : String(err)}>`;
        }
        const report = [
          `${response.status()} ${response.statusText()}  ${request.method()} ${response.url()}`,
          "",
          "--- request body ---",
          request.postData() ?? "(none)",
          "",
          "--- response body ---",
          body.length > 0 ? body : "(empty)",
          "",
        ].join("\n");
        failedResponses.push(report);
        try {
          await testInfo.attach(`http-${response.status()}-${index}.txt`, {
            body: report,
            contentType: "text/plain",
          });
        } catch {
          // The test has already finished reporting; the array still holds it.
        }
      })(),
    );
  });

  return {
    consoleErrors,
    failedResponses,
    async flush(): Promise<void> {
      await Promise.all(pending);
      if (flushed) return;
      flushed = true;
      if (consoleErrors.length === 0) return;
      try {
        await testInfo.attach("console-errors.txt", {
          body: consoleErrors.join("\n\n"),
          contentType: "text/plain",
        });
      } catch {
        // Same as above — nothing useful to do if reporting is closed.
      }
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Fixtures
   ══════════════════════════════════════════════════════════════════════════ */

export interface RoleFixtures {
  /** A page in its own context, signed in as the HOST account. */
  hostPage: Page;
  /** A page in its own context, signed in as the PLAYER account. */
  playerPage: Page;
}

function assertStorageState(file: string, role: string): void {
  if (fs.existsSync(file)) return;
  throw new Error(
    `No saved sign-in for the ${role} account (${file} is missing).\n` +
      `The "setup" project writes it — run \`npm run e2e\` (which depends on it) rather than\n` +
      `pointing Playwright at a single spec with --project=chromium and no setup.`,
  );
}

/**
 * Say yes to window.confirm().
 *
 * Playwright's default for an unhandled dialog is to DISMISS it — and a
 * dismissed confirm() is a "no". The app gates deleting sessions, discarding a
 * draft lobby and leaving a club behind native confirms, so without this every
 * one of those actions silently does nothing: no error, no dialog, the row just
 * stays. Cleanup appears to run and doesn't, which is the worst possible
 * failure mode for a suite that writes to a real database.
 *
 * It lives on the fixtures rather than in each spec so no test can forget it.
 * If a test ever needs to assert that CANCELLING a confirm is respected, it
 * should build its own context rather than reaching for this.
 */
function acceptNativeConfirms(page: Page): void {
  page.on("dialog", (dialog) => {
    void dialog.accept();
  });
}

export const test = base.extend<RoleFixtures>({
  hostPage: async ({ browser, baseURL, viewport }, use) => {
    assertStorageState(HOST_STORAGE_STATE, "HOST");
    const context = await browser.newContext({
      storageState: HOST_STORAGE_STATE,
      // browser.newContext() does NOT inherit the project's `use` block, so
      // baseURL and the phone viewport have to be handed over explicitly.
      baseURL,
      viewport,
      hasTouch: true,
    });
    const page = await context.newPage();
    acceptNativeConfirms(page);
    const capture = captureFailures(page);
    await use(page);
    await capture.flush();
    await context.close();
  },

  playerPage: async ({ browser, baseURL, viewport }, use) => {
    assertStorageState(PLAYER_STORAGE_STATE, "PLAYER");
    const context = await browser.newContext({
      storageState: PLAYER_STORAGE_STATE,
      baseURL,
      viewport,
      hasTouch: true,
    });
    const page = await context.newPage();
    acceptNativeConfirms(page);
    const capture = captureFailures(page);
    await use(page);
    await capture.flush();
    await context.close();
  },
});

export { expect };

/* ══════════════════════════════════════════════════════════════════════════
   Navigation
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Go to one of the three tabs. Uses the real tab bar when it's on screen (that
 * is itself worth exercising) and falls back to a direct navigation from
 * anywhere that hides it — the create wizard and a live session both do.
 */
export async function gotoTab(page: Page, tab: TabName): Promise<void> {
  const target = TAB_PATHS[tab];
  const nav = page.getByRole("navigation", { name: "Main" });
  if (await nav.isVisible().catch(() => false)) {
    await nav.getByRole("link", { name: TAB_LABELS[tab], exact: true }).click();
  } else {
    await page.goto(target);
  }
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(target)}(\\?|#|$)`));
}

/* ══════════════════════════════════════════════════════════════════════════
   The create-session wizard
   ══════════════════════════════════════════════════════════════════════════ */

export interface CreateSessionOptions {
  /** 2–80 characters. Make it unique per test run — it's how you find the
   *  session again on the You tab. */
  name: string;
  format: SessionFormat;
  /** Roster, added through Bulk Add. Names must be unique within a session:
   *  the per-player chips are located by name. */
  players: string[];
  /**
   * L/R per player, positionally aligned with `players`. Only meaningful for
   * `side_americano` (Fixed Position), where every team is one Left + one
   * Right. Every player defaults to Right in the app, so when the format is
   * `side_americano` and this is omitted we alternate L,R,L,R… — an all-Right
   * roster can't be paired at all.
   */
  sides?: Side[];
  /** Court count. Left alone (the app auto-sizes it from the roster) if omitted. */
  courts?: number;
  /** Round count. Only offered for upfront-scheduled formats; ignored otherwise. */
  rounds?: number;
  /** Scoring format. Defaults to the app's own default, Fixed 21 points. */
  scoring?: ScoringFormat;
}

/** Returns the stepper row's current value, read from the `<b>` between − and +. */
async function readStepper(row: Locator): Promise<number> {
  const value = row.getByRole("button", { name: MINUS, exact: true }).locator("xpath=following-sibling::b[1]");
  const text = (await value.innerText()).trim();
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) throw new Error(`Could not read a number out of the stepper (got "${text}").`);
  return parsed;
}

async function setStepper(row: Locator, target: number, what: string): Promise<void> {
  const value = row.getByRole("button", { name: MINUS, exact: true }).locator("xpath=following-sibling::b[1]");
  for (let guard = 0; guard < 40; guard += 1) {
    const current = await readStepper(row);
    if (current === target) return;
    await row.getByRole("button", { name: current < target ? "+" : MINUS, exact: true }).click();
    try {
      // React re-renders after the click; wait for the number to actually move
      // so a clamped stepper reports itself instead of spinning.
      await expect(value).not.toHaveText(String(current), { timeout: 3_000 });
    } catch {
      throw new Error(
        `${what} is clamped at ${current} — it will not move toward ${target}. ` +
          `(Courts cap at 6, rounds at 30, and Team Sparring caps courts by the A/B split.)`,
      );
    }
  }
  throw new Error(`Gave up setting ${what} to ${target}.`);
}

/**
 * Drives all six steps of /create and returns the new session's id.
 *
 * Name → Format → Players (Bulk Add, then the L/R chips) → Courts (+ rounds)
 * → Points → Review → "Start Session", then reads the id out of the
 * /session/:id/host URL it lands on.
 */
export async function createSession(page: Page, opts: CreateSessionOptions): Promise<string> {
  if (opts.players.length < 4) {
    throw new Error(`A session needs at least 4 players; got ${opts.players.length}.`);
  }
  const duplicate = opts.players.find((n, i) => opts.players.indexOf(n) !== i);
  if (duplicate !== undefined) {
    throw new Error(
      `Duplicate player name "${duplicate}". The roster chips are located by name, so names must be unique.`,
    );
  }

  const next = page.getByRole("button", { name: "Next", exact: true });

  // ── Step 1 of 6: Name ────────────────────────────────────────────────────
  await page.goto("/create");
  const nameInput = page.getByPlaceholder("Tuesday Night Padel");
  await expect(nameInput, "the /create wizard never reached the Name step").toBeVisible();
  await nameInput.fill(opts.name);
  await next.click();

  // ── Step 2 of 6: Format ──────────────────────────────────────────────────
  const label = FORMAT_LABELS[opts.format];
  // The card's accessible name is label + sub-line + the tick, and "Americano"
  // is a substring of "Mix Americano", so match the card by the element whose
  // text is EXACTLY the label.
  const formatCard = page.getByRole("button").filter({ has: page.getByText(label, { exact: true }) });
  await expect(formatCard, `no format card labelled "${label}" on the Format step`).toBeVisible();
  await formatCard.click();
  await expect(formatCard, `tapping "${label}" did not select it`).toContainText("✓");
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

  // Fixed Position builds every team from one Left + one Right, and every
  // player starts as Right.
  const sides: Side[] | undefined =
    opts.sides ??
    (opts.format === "side_americano"
      ? opts.players.map((_, i): Side => (i % 2 === 0 ? "L" : "R"))
      : undefined);
  if (sides) {
    if (sides.length !== opts.players.length) {
      throw new Error(`sides has ${sides.length} entries but there are ${opts.players.length} players.`);
    }
    for (const [i, player] of opts.players.entries()) {
      await setPlayerSide(page, player, sides[i] as Side);
    }
  }
  await next.click();

  // ── Step 4 of 6: Courts (and rounds, for upfront formats) ────────────────
  const courtRow = page.getByText("Court count", { exact: true }).locator("xpath=..");
  await expect(courtRow, "the Courts step never rendered").toBeVisible();
  if (opts.courts !== undefined) {
    await setStepper(courtRow, opts.courts, "court count");
  }
  if (opts.rounds !== undefined) {
    if (!UPFRONT_SCHEDULE_FORMATS.has(opts.format)) {
      throw new Error(
        `${FORMAT_LABELS[opts.format]} generates rounds one at a time — the Courts step has no round stepper, ` +
          `so \`rounds\` cannot be set for it.`,
      );
    }
    // The "Rounds" label sits in a div next to the stepper div, both inside the
    // row — hence two levels up rather than one.
    const roundsRow = page.getByText("Rounds", { exact: true }).locator("xpath=../..");
    await setStepper(roundsRow, opts.rounds, "round count");
  }
  // This is the one step besides Name that gates Next: the roster has to fill
  // every court (4 per court), and Team Sparring also needs 2+ players a side.
  await expect(
    next,
    "Next is disabled on the Courts step — the roster does not fill the chosen number of courts",
  ).toBeEnabled();
  await next.click();

  // ── Step 5 of 6: Points ──────────────────────────────────────────────────
  if (opts.scoring !== undefined) {
    await page.getByRole("button", { name: SCORING_LABELS[opts.scoring], exact: true }).click();
  }
  await next.click();

  // ── Step 6 of 6: Review → Start ──────────────────────────────────────────
  const start = page.getByRole("button", { name: "Start Session", exact: true });
  await expect(start, "the Review step never rendered its Start Session button").toBeVisible();
  await expect(
    start,
    "Start Session is disabled — not enough players for the court count, or an unbalanced Team Sparring split",
  ).toBeEnabled();
  await start.click();

  try {
    await page.waitForURL(/\/session\/[^/]+\/host/, { timeout: 45_000 });
  } catch (err) {
    // startError renders as the paragraph immediately before the button. The
    // string is generic ("Could not start the session.") — the real cause is in
    // the http-*.txt attachments from captureFailures.
    const inlineError = page
      .getByRole("button", { name: /^(Start Session|Starting…)$/ })
      .locator("xpath=preceding-sibling::p[1]");
    const shown = (await inlineError.count()) > 0 ? (await inlineError.innerText()).trim() : "(no inline error)";
    throw new Error(
      `Start Session never navigated to the live session.\nOn screen: ${shown}\n` +
        `Check the http-4xx/5xx attachments on this test for the real PostgREST error.\n` +
        `Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const sessionId = sessionIdFromUrl(page.url());
  await expect(page.getByRole("heading", { name: opts.name })).toBeVisible();
  return sessionId;
}

/** Pulls the uuid out of /session/:id/host or /session/:id/final. */
export function sessionIdFromUrl(url: string): string {
  const match = /\/session\/([^/?#]+)\/(host|final)/.exec(url);
  if (!match?.[1]) throw new Error(`No session id in URL: ${url}`);
  return match[1];
}

/**
 * Flip one player's L/R chip on the Players step.
 *
 * The roster row has no test id, so we anchor on the name button — whose
 * accessible name is the gender letter plus the name, e.g. "M Ana" — and walk
 * one level up to the row's left-hand group, which is where the Team A/B and
 * L/R chips live.
 */
export async function setPlayerSide(page: Page, player: string, side: Side): Promise<void> {
  const nameButton = page.getByRole("button", {
    name: new RegExp(`^[MF]\\s+${escapeRegExp(player)}$`),
  });
  await expect(nameButton, `no roster row for "${player}"`).toBeVisible();
  const chip = nameButton.locator("xpath=..").getByRole("button", { name: /^(Left|Right)$/ });
  await expect(
    chip,
    `"${player}" has no L/R chip — that chip only renders for Fixed Position and Fixed Partner`,
  ).toBeVisible();
  const current = (await chip.innerText()).trim();
  const wanted = side === "L" ? "Left" : "Right";
  if (current !== wanted) {
    await chip.click();
    await expect(chip).toHaveText(wanted);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Scoring a live session
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The score picker sheet. It isn't a dialog and has no test id, so it's
 * anchored on the one string only it renders ("Entering score for:") — scoped
 * to the `p` that carries it, because the number grid must NOT be searched from
 * an ancestor that also contains the match cards' score tiles (those show
 * numbers too, and "21" would then be ambiguous).
 */
function scorePicker(page: Page): Locator {
  return page.locator("p").filter({ hasText: "Entering score for:" }).locator("xpath=..");
}

export interface ScoreRoundOptions {
  /** Court number (1-based) or the court's exact name if it was renamed. */
  court: number | string;
  scoreA: number;
  scoreB: number;
}

/**
 * Score one court in the round currently on screen.
 *
 * Fixed 21 / Fixed 4 games / Fixed 5 games auto-fill the opponent, so exactly
 * one number is tapped and scoreA + scoreB must equal the format total. Race
 * formats take two taps: the sheet switches from Team A to Team B rather than
 * closing.
 */
export async function scoreRound(page: Page, opts: ScoreRoundOptions): Promise<void> {
  const courtName = typeof opts.court === "number" ? `Court ${opts.court}` : opts.court;
  const courtLabel = page.getByText(courtName, { exact: true });
  await expect(
    courtLabel,
    `no match block labelled "${courtName}" in the round on screen — wrong round, or fewer courts than expected`,
  ).toBeVisible();

  // The match block is: court name, then the two score tiles, then the names
  // card. Those two tiles are the only buttons inside it.
  const block = courtLabel.locator("xpath=..");
  const tiles = block.getByRole("button");
  await expect(tiles, `expected 2 score tiles under "${courtName}"`).toHaveCount(2);

  await tiles.nth(0).click();
  const picker = scorePicker(page);
  await expect(
    picker,
    "tapping the score tile did not open the picker — the round is read-only (history, or an ended session)",
  ).toBeVisible();

  const pickerText = await picker.innerText();
  const autoFill = pickerText.includes("auto-fills as");
  const range = /Valid range\s+(\d+)\s*-\s*(\d+)/.exec(pickerText);
  if (autoFill && range) {
    const total = Number.parseInt(range[2] as string, 10);
    if (opts.scoreA + opts.scoreB !== total) {
      // Leave the screen usable for whatever the test does next.
      await picker.getByRole("button", { name: "✕", exact: true }).click().catch(() => undefined);
      throw new Error(
        `This is a fixed-total format: scoreA + scoreB must equal ${total}, ` +
          `but ${opts.scoreA} + ${opts.scoreB} = ${opts.scoreA + opts.scoreB}. ` +
          `The picker fills the other side in for you.`,
      );
    }
  }

  await picker.getByRole("button", { name: String(opts.scoreA), exact: true }).click();
  if (!autoFill) {
    // Two-number format: the sheet is now asking for Team B.
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: String(opts.scoreB), exact: true }).click();
  }

  await expect(picker, "the score picker stayed open — the score was rejected as invalid").toBeHidden();
  await expect(tiles.nth(0)).toHaveText(String(opts.scoreA));
  await expect(tiles.nth(1)).toHaveText(String(opts.scoreB));
}

export type ScoreForCourt = (court: number) => { scoreA: number; scoreB: number };

/**
 * Score every court in the round on screen. Returns how many courts it scored.
 * Pass either one score for all of them, or a function of the court number.
 *
 * Court blocks are found by their default "Court N" names; if a test renames a
 * court through Manage, score it with `scoreRound` instead.
 */
export async function scoreAllCourtsInCurrentRound(
  page: Page,
  score: { scoreA: number; scoreB: number } | ScoreForCourt,
): Promise<number> {
  const labels = page.getByText(/^Court \d+$/);
  await expect(labels.first(), "no courts on screen in this round").toBeVisible();
  const names = (await labels.allInnerTexts()).map((t) => t.trim());

  for (const name of names) {
    const number = Number.parseInt(name.replace(/^Court\s+/, ""), 10);
    const { scoreA, scoreB } = typeof score === "function" ? score(number) : score;
    await scoreRound(page, { court: name, scoreA, scoreB });
  }
  return names.length;
}

/** Tap the lit "›" that generates the next round. Only available once every
 *  match in the current round is final. */
export async function startNextRound(page: Page): Promise<void> {
  const advance = page.getByRole("button", { name: "Start next round", exact: true });
  await expect(
    advance,
    'the "›" control is not in advance mode — finish scoring every match in the current round first',
  ).toBeVisible();
  await advance.click();
  await expect(advance).toBeHidden();
}

/* ══════════════════════════════════════════════════════════════════════════
   Ending and deleting
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⋯ → "End session" → confirm "End Session". Lands on the podium.
 *
 * The two buttons differ only in the case of one letter, so both locators use
 * `exact: true` (which is case-sensitive) — without it the menu item and the
 * confirm button match each other.
 */
export async function endSession(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Session menu", exact: true }).click();
  await page.getByRole("button", { name: "End session", exact: true }).click();

  const confirm = page.getByRole("button", { name: "End Session", exact: true });
  await expect(confirm, "the End-session confirmation never appeared").toBeVisible();
  await confirm.click();

  try {
    await page.waitForURL(/\/session\/[^/]+\/final/, { timeout: 45_000 });
  } catch (err) {
    const dialog = confirm.locator("xpath=ancestor::div[2]");
    const shown = (await dialog.count()) > 0 ? (await dialog.innerText()).trim() : "(dialog gone)";
    throw new Error(
      `Ending the session never reached the podium.\nDialog said:\n${shown}\n` +
        `Check this test's http-4xx/5xx attachments.\n` +
        `Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await expect(page.getByText("Session complete")).toBeVisible();
}

/**
 * Delete one of the signed-in host's sessions from the You tab: Host list →
 * Select → tick the row → Delete (n).
 *
 * The row is found by its href (react-router renders `to` verbatim), because a
 * session id is what callers have; its name is then read off the row so the
 * same row can be ticked once the list swaps links for buttons in select mode.
 */
export async function deleteSessionAsHost(page: Page, sessionId: string): Promise<void> {
  await gotoTab(page, "you");
  // The role tabs render the lowercase strings "host"/"player" and uppercase
  // the first letter in CSS; accessible-name computation applies
  // text-transform, so match case-insensitively rather than guessing.
  await page.getByRole("button", { name: /^host$/i }).click();

  const row = page.locator(
    `a[href="/session/${sessionId}/final"], a[href="/session/${sessionId}/host"]`,
  );
  await expect(row, `session ${sessionId} is not in the host's session list`).toHaveCount(1);
  const sessionName = (await row.locator("b").first().innerText()).trim();

  await page.getByRole("button", { name: "Select", exact: true }).click();
  const selectableRow = page.getByRole("button").filter({ hasText: sessionName });
  await expect(selectableRow, `"${sessionName}" is not selectable`).toBeVisible();
  await selectableRow.click();
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.getByRole("button", { name: /^Delete \(\d+\)$/ }).click();
  await expect(
    row,
    `"${sessionName}" is still listed after deleting — see the http-*.txt attachments for the RPC error`,
  ).toHaveCount(0, { timeout: 30_000 });
}

/* ══════════════════════════════════════════════════════════════════════════
   Reading the profile
   ══════════════════════════════════════════════════════════════════════════ */

export interface RatingSnapshot {
  rating: number;
  games: number;
  /**
   * e.g. "main lagi", "cacing sr", "jago". The strip uppercases in CSS, so the
   * rendered text is "CACING SR"; this is lower-cased back to the value
   * `tierFor()` actually returns.
   */
  tier: string;
}

/**
 * Read the Rating · Tier · Games strip from the You tab.
 *
 * Anchored on the "?" link beside the Rating label (aria-label "How the rating
 * works"), which is the only unambiguous thing in the strip — the word "Games"
 * also appears in the Sessions tiles lower down the page.
 */
export async function readRating(page: Page): Promise<RatingSnapshot> {
  await gotoTab(page, "you");

  const help = page.getByRole("link", { name: "How the rating works", exact: true });
  await expect(help, "the rating strip never rendered on the You tab").toBeVisible();

  const ratingColumn = help.locator("xpath=ancestor::div[1]");
  const strip = ratingColumn.locator("xpath=..");

  const asNumber = async (locator: Locator, what: string): Promise<number> => {
    const text = (await locator.innerText()).trim();
    const parsed = Number.parseInt(text.replace(/[^\d-]/g, ""), 10);
    if (Number.isNaN(parsed)) throw new Error(`Could not read ${what} from the rating strip (got "${text}").`);
    return parsed;
  };

  // Strip children: rating column, divider, tier column, divider, games column.
  return {
    rating: await asNumber(ratingColumn.locator("xpath=./p[2]"), "rating"),
    tier: (await strip.locator("xpath=./div[3]/p[2]").innerText()).trim().toLowerCase(),
    games: await asNumber(strip.locator("xpath=./div[5]/p[2]"), "games"),
  };
}
