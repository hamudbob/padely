import type { FullConfig } from "@playwright/test";

/**
 * Fail fast, with one readable sentence, when the dev server isn't up.
 *
 * We deliberately don't start vite ourselves (see playwright.config.ts). The
 * failure mode we're avoiding is 30 tests each timing out on `page.goto` with
 * "net::ERR_CONNECTION_REFUSED", which reads like a Playwright problem rather
 * than "your dev server isn't running".
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use?.baseURL ?? process.env.E2E_BASE_URL ?? "http://localhost:5173";

  const missing = ["E2E_HOST_EMAIL", "E2E_HOST_PASSWORD", "E2E_PLAYER_EMAIL", "E2E_PLAYER_PASSWORD"].filter(
    (key) => !process.env[key],
  );
  if (missing.length > 0) {
    throw new Error(
      `E2E credentials missing: ${missing.join(", ")}.\n` +
        `Create a .env.test in the repo root — see tests/e2e/README.md for the full list.\n` +
        `(.env.test is gitignored; it holds two real Supabase accounts.)`,
    );
  }

  let reachable = false;
  let detail = "";
  try {
    const res = await fetch(baseURL, { signal: AbortSignal.timeout(8_000) });
    reachable = res.ok || res.status < 500;
    if (!reachable) detail = `responded ${res.status} ${res.statusText}`;
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
  }

  if (!reachable) {
    throw new Error(
      `Nothing usable is serving ${baseURL} (${detail}).\n` +
        `The E2E suite does NOT start vite for you — run \`npm run dev\` in another terminal first,\n` +
        `or point E2E_BASE_URL in .env.test at wherever the app is actually running.`,
    );
  }
}
