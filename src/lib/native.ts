import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { supabase } from "./supabase/client";

/** True inside the iOS/Android shell, false in a browser. Every native-only
 *  branch in the app hangs off this, so the web build behaves as it always
 *  has. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Where the OAuth provider sends the phone back to. A custom scheme, not an
 * https URL: iOS hands `id.padelier.app://…` straight to this app, with no
 * server in between and nothing to intercept it.
 *
 * Must also be listed in Supabase → Authentication → URL Configuration →
 * Redirect URLs, on BOTH projects, or Supabase refuses the redirect and the
 * browser lands on the Site URL instead — which looks, confusingly, like a
 * successful sign-in that forgot to come home.
 */
export const NATIVE_REDIRECT = "id.padelier.app://auth";

/**
 * Sign in with a provider on a phone.
 *
 * Google refuses OAuth inside an app's embedded webview — `disallowed_useragent`
 * — and Capacitor's webview is exactly that. So we don't navigate: we ask
 * Supabase for the URL (`skipBrowserRedirect`), hand it to the real system
 * browser, and wait for iOS to deliver the result back through the deep link
 * registered above.
 *
 * `Browser.open` is SFSafariViewController rather than the outside Safari app:
 * it keeps the person visually inside Padelier, and it comes back reliably.
 * Sending them to whatever their default browser is means trusting that browser
 * to honour a custom scheme, which not all of them do.
 *
 * Returns once the browser is showing. The session arrives later, through
 * handleDeepLink.
 */
export async function startNativeOAuth(provider: "google" | "apple"): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: NATIVE_REDIRECT,
      skipBrowserRedirect: true,
      // Same reasoning as on the web: without it Google silently reuses
      // whichever account the phone is already signed into, which is wrong on
      // a shared phone and baffling on one with two accounts.
      queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Couldn't start sign-in. Try again in a moment.");
  await Browser.open({ url: data.url });
}

/** What a deep link turned out to mean, so the caller can route accordingly. */
export type DeepLinkResult =
  | { kind: "signed-in" }
  | { kind: "auth-error"; message: string }
  | { kind: "path"; path: string }
  | { kind: "ignored" };

/**
 * Turn one incoming URL into something the app can act on.
 *
 * Two shapes arrive here. The OAuth return (`id.padelier.app://auth?code=…`),
 * which we exchange for a session; and later, universal links — someone tapping
 * a shared `padelier.id/e/<id>` in WhatsApp — which we hand back as a path for
 * react-router.
 *
 * Errors come back in the URL too (`?error=access_denied` when someone taps
 * Cancel), and that is not a failure worth shouting about.
 */
export async function handleDeepLink(url: string): Promise<DeepLinkResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "ignored" };
  }

  const params = parsed.searchParams;
  const code = params.get("code");
  const errorDescription = params.get("error_description") ?? params.get("error");

  if (code) {
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      // Close the browser sheet whichever way it went — leaving it up over a
      // signed-in app is worse than either outcome.
      await Browser.close().catch(() => undefined);
      if (error) return { kind: "auth-error", message: error.message };
      return { kind: "signed-in" };
    } catch (err) {
      await Browser.close().catch(() => undefined);
      return { kind: "auth-error", message: err instanceof Error ? err.message : "Sign-in didn't complete." };
    }
  }

  if (errorDescription) {
    await Browser.close().catch(() => undefined);
    // "access_denied" is someone changing their mind at Google's screen. Say
    // nothing; they are back where they started and know why.
    if (/access_denied|cancel/i.test(errorDescription)) return { kind: "ignored" };
    return { kind: "auth-error", message: errorDescription };
  }

  // A universal link: padelier.id/e/<id> → /e/<id>. Custom-scheme URLs with no
  // code are nothing we know about.
  if (parsed.protocol === "https:" && parsed.pathname && parsed.pathname !== "/") {
    return { kind: "path", path: parsed.pathname + parsed.search };
  }

  return { kind: "ignored" };
}

/** Subscribe to incoming links. Returns an unsubscribe function. No-op on web. */
export function onDeepLink(handler: (url: string) => void): () => void {
  if (!isNative()) return () => undefined;
  const handle = CapApp.addListener("appUrlOpen", (event) => handler(event.url));
  return () => {
    void handle.then((h) => h.remove());
  };
}
