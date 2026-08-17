import { test, expect, captureFailures } from "./fixtures";

/**
 * Proves the harness itself works: the setup project's storage state really
 * signs someone in, the app shell renders, and a signed-out context can still
 * reach a public page. Nothing here is a feature test — feature specs follow
 * docs/TEST_PLAN.md and live in their own files.
 */
test.describe("harness smoke", () => {
  test("the host account is signed in and lands on Play", async ({ hostPage }) => {
    await hostPage.goto("/");
    // "/" routes by session state: signed in means Play.
    await expect(hostPage).toHaveURL(/\/play(\?|#|$)/);

    const tabs = hostPage.getByRole("navigation", { name: "Main" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Play", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Club", exact: true })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "You", exact: true })).toBeVisible();
  });

  test("/privacy renders for a signed-out visitor", async ({ browser, baseURL, viewport }) => {
    // A deliberately empty context: no storage state, no session. A privacy
    // notice only a signed-in user can read is no notice at all.
    const context = await browser.newContext({ baseURL, viewport, hasTouch: true });
    const page = await context.newPage();
    const capture = captureFailures(page);
    try {
      await page.goto("/privacy");
      await expect(page).toHaveURL(/\/privacy$/);
      // The document renders in EN or ID depending on navigator.language.
      await expect(page.getByRole("heading", { name: /Privacy policy|Kebijakan Privasi/ })).toBeVisible();
      // Not bounced to the login screen.
      await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    } finally {
      await capture.flush();
      await context.close();
    }
  });
});
