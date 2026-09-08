import { Share } from "@capacitor/share";
import { isNative } from "./native";

/**
 * Share a link out of the app — correctly, on both platforms.
 *
 * TWO BUGS THIS EXISTS TO KILL, and the second is the dangerous one.
 *
 * 1. NO SHARE SHEET. Several buttons only copied to the clipboard. On a phone
 *    "Share" that silently copies is a button that appears not to work: no
 *    sheet, no feedback anyone notices, and nothing in the place people look.
 *
 * 2. THE LINK WAS WRONG. Every one of them built the URL from
 *    `window.location.origin`, which in a Capacitor app is
 *    `capacitor://localhost`. So on the rare occasion the copy DID work, what
 *    landed in the group chat was
 *
 *        capacitor://localhost/e/abc123
 *
 *    — a link that opens nothing, for anybody, ever. It works perfectly in a
 *    browser, which is exactly why it survived: the web build is right and the
 *    app build is silently broken.
 *
 * So links are always built against the real public origin, and always go
 * through the platform's own share sheet.
 */

/**
 * Where a shared link must point.
 *
 * Hardcoded for the native build on purpose. There is no runtime way to ask
 * "what is my public web address" from inside a webview served over a custom
 * scheme, and inferring it would be guessing. The web build keeps using its
 * own origin so that previews and localhost still share links to themselves.
 */
export const PUBLIC_ORIGIN = isNative() ? "https://padelier.id" : window.location.origin;

/** An absolute, sendable URL for an in-app path. */
export function publicUrl(path: string): string {
  return `${PUBLIC_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

/**
 * Open the share sheet for a link, falling back to the clipboard.
 *
 * Returns what actually happened so the caller can say "Copied" only when it
 * really did copy — the old code showed a "Copied!" confirmation on a path
 * that had already failed.
 */
export async function shareUrl(path: string, title?: string, text?: string): Promise<ShareOutcome> {
  const url = publicUrl(path);

  if (isNative()) {
    try {
      await Share.share({ title, text, url });
      return "shared";
    } catch (err) {
      // The sheet throws on cancel as well as on failure and the two are not
      // reliably distinguishable, so anything cancel-shaped is reported as a
      // dismissal rather than an error the person did not cause.
      const message = err instanceof Error ? err.message : String(err);
      if (/cancel|abort|dismiss/i.test(message)) return "dismissed";
      // Fall through to the clipboard rather than failing outright.
    }
  } else {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title, text, url });
        return "shared";
      } catch {
        return "dismissed";
      }
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
