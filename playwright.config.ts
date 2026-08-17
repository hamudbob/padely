import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

/**
 * Playwright config for the Padelier E2E harness.
 *
 * Read this before changing anything:
 *
 *  - `.env.test` is loaded from the repo root (see tests/e2e/README.md for the
 *    variables it must contain). Run the suite from the repo root — dotenv
 *    resolves this path against the process working directory.
 *
 *  - There is deliberately NO `webServer`. The dev server is already running
 *    when these tests are used, and letting Playwright boot a second vite on a
 *    random port made every "why is my change not showing up" debugging session
 *    twice as long. Instead `globalSetup` pings the baseURL and fails with one
 *    clear sentence if nothing answers.
 *
 *  - One worker, no parallelism, no retries. Every test writes real rows to the
 *    live Supabase project; two workers would race over the same host account's
 *    session list, and a retry would re-run a half-finished mutation on top of
 *    the data the first attempt left behind.
 *
 *  - The viewport is a phone (iPhone 15-ish, 393x852). This app is mobile-first
 *    and lays out inside a `max-w-sm` column with a fixed bottom tab bar; on a
 *    desktop viewport you get a valid-looking page that no user ever sees.
 */
dotenv.config({ path: ".env.test" });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",

  // Tests share ONE Supabase project. Parallel runs would collide.
  workers: 1,
  fullyParallel: false,
  // A retry would replay writes on top of the previous attempt's leftovers.
  retries: 0,
  // Creating a session is a wizard plus a dozen round trips to Supabase; ending
  // one writes ratings for every player. 90s is generous but not silly.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Nothing here is safe to leave behind on CI without a human looking at it.
  forbidOnly: !!process.env.CI,

  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // The app talks to Supabase over the network on nearly every interaction.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      // Signs in as HOST and as PLAYER and writes the two storage states that
      // every other project depends on.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: {
        browserName: "chromium",
      },
    },
  ],
});
