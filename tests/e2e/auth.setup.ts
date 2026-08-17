import fs from "node:fs";
import { test as setup, expect, type Locator, type Page } from "@playwright/test";
import { AUTH_DIR, HOST_STORAGE_STATE, PLAYER_STORAGE_STATE } from "./fixtures";

/**
 * Signs in as HOST and as PLAYER once per run and saves both storage states.
 *
 * Two accounts is not a nicety. Nearly every bug in the audit was a non-host
 * seeing an empty screen where the host saw data (see docs/TEST_PLAN.md §0), so
 * the harness is built around driving both roles inside one test.
 *
 * /login is email-first: one field, Continue, and then the SAME screen becomes
 * either a password prompt (existing confirmed account), a create-password form
 * (no account), or a "resend confirmation" page (account exists, link never
 * opened). Those last two are not test failures we can fix by retrying — they
 * mean the account isn't set up — so each gets its own message.
 */

type Stage = "signin" | "signup" | "pending" | "timeout";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.test (see tests/e2e/README.md).`);
  }
  return value;
}

/** Wait for whichever of several things appears first, without leaving rejected
 *  promises behind when the losers time out. */
function firstOf<T>(candidates: { locator: Locator; value: T }[], timeout: number, fallback: T): Promise<T> {
  const swallow = (): Promise<never> => new Promise<never>(() => {});
  return Promise.race<T>([
    ...candidates.map(({ locator, value }) =>
      locator
        .waitFor({ state: "visible", timeout })
        .then(() => value)
        .catch(swallow),
    ),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeout + 1_000)),
  ]);
}

async function signIn(page: Page, role: "HOST" | "PLAYER", email: string, password: string, statePath: string) {
  const who = `${role} account <${email}>`;

  // ?next=/play so a successful sign-in lands somewhere we can assert on
  // instead of bouncing through "/" and its own session-dependent redirect.
  await page.goto("/login?next=%2Fplay");

  const emailInput = page.getByPlaceholder("Email", { exact: true });
  await expect(
    emailInput,
    `${who}: /login never rendered its email field. Is the app actually serving, and is it built with ` +
      `VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set?`,
  ).toBeVisible();
  await emailInput.fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const stage = await firstOf<Stage>(
    [
      { locator: page.getByPlaceholder("Password", { exact: true }), value: "signin" },
      { locator: page.getByPlaceholder("Create a password", { exact: true }), value: "signup" },
      { locator: page.getByRole("button", { name: "Resend email", exact: true }), value: "pending" },
    ],
    25_000,
    "timeout",
  );

  if (stage === "signup") {
    throw new Error(
      `${who}: Supabase says this email has NO account — /login offered "Create a password" instead of a ` +
        `password prompt. Create the account by hand, confirm the email, and finish onboarding, then re-run.`,
    );
  }
  if (stage === "pending") {
    throw new Error(
      `${who}: the account exists but its confirmation link was never opened, so it cannot sign in. ` +
        `Confirm the email (or confirm the user in the Supabase dashboard) and finish onboarding, then re-run.`,
    );
  }
  if (stage === "timeout") {
    throw new Error(
      `${who}: after Continue, /login showed neither a password field nor a resend screen. ` +
        `The email-existence lookup (emailHasAccount / RPC 0035) is probably failing — see this test's ` +
        `network attachments in the HTML report.`,
    );
  }

  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // Either destination ends the navigation; both are checked below so the
  // failure message can be specific.
  await page.waitForURL(/\/(play|welcome)(\?|#|$)/, { timeout: 30_000 }).catch(() => undefined);

  const url = page.url();

  if (/\/welcome(\?|#|$)/.test(url)) {
    throw new Error(
      `${who}: signed in, but the app sent it to /welcome — this account has never completed onboarding ` +
        `(profiles.onboarded_at is null). Onboarding sets a name, photo, side and gender, and the tests ` +
        `must not do it for you because the values become real profile data. Finish /welcome by hand for ` +
        `this account once, then re-run.`,
    );
  }

  if (!/\/play(\?|#|$)/.test(url)) {
    // Whatever the form is complaining about is inside it — Supabase's message
    // ("Invalid login credentials") included.
    const form = page.locator("form");
    const shown = (await form.count()) > 0 ? (await form.first().innerText()).replace(/\s+/g, " ").trim() : "";
    throw new Error(
      `${who}: sign-in did not reach /play (still at ${url}).\n` +
        `The sign-in form says: ${shown || "(nothing)"}\n` +
        `Check that the password in .env.test is right, that the account is confirmed, and that it has been ` +
        `onboarded.`,
    );
  }

  // A signed-in, onboarded account always has the three-tab bar.
  await expect(
    page.getByRole("navigation", { name: "Main" }),
    `${who}: landed on /play but the Play/Club/You tab bar never rendered`,
  ).toBeVisible();

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: statePath });
}

setup("authenticate as host", async ({ page }) => {
  await signIn(page, "HOST", required("E2E_HOST_EMAIL"), required("E2E_HOST_PASSWORD"), HOST_STORAGE_STATE);
});

setup("authenticate as player", async ({ page }) => {
  await signIn(page, "PLAYER", required("E2E_PLAYER_EMAIL"), required("E2E_PLAYER_PASSWORD"), PLAYER_STORAGE_STATE);
});
