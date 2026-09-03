import { supabase } from "./client";

/**
 * Catch the provider refresh token at sign-in, because there is no second
 * chance to.
 *
 * Supabase puts `provider_refresh_token` on the session object it emits with
 * the SIGNED_IN event and nowhere else. It is not written to storage, it is
 * not on the session you get back from `getSession()` a moment later, and it
 * is not on the user. If this listener is not attached when that event fires,
 * the token is gone until the person signs in again.
 *
 * That matters because deleting an Apple account requires revoking the grant
 * with Apple (App Store guideline 5.1.1(v)), and revoking needs this token.
 * Without it the delete half-works in the way that looks most like a bug: our
 * side is erased, Apple's side is not, and the person's next sign-in is a
 * re-authorization into an empty account that Apple still labels with their
 * name.
 *
 * ── Two things that look like fussiness and are not ───────────────────────
 *
 * REGISTERED FROM main.tsx, BEFORE RENDER. Not from a hook. A hook attaches
 * when its component mounts, which on a cold start with a `?code=` in the URL
 * can be after the exchange has already happened — and then it catches
 * nothing, intermittently, in a way that only shows up as a failed revoke
 * months later when someone deletes their account.
 *
 * THE setTimeout IS REQUIRED. Calling into supabase-js from inside an
 * onAuthStateChange callback can deadlock: the callback runs while the auth
 * client holds its internal lock, and an RPC that needs a session will wait
 * for a lock that is waiting for the callback. Deferring to the next tick
 * lets the callback return first. Supabase documents this; it is not
 * superstition.
 */
export function startProviderTokenCapture(): void {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event !== "SIGNED_IN") return;

    const token = session?.provider_refresh_token;
    if (!token) return;

    // Only Apple, for now. Google issues refresh tokens too, but Google does
    // not require revocation on delete and storing a credential we have no
    // use for is a liability rather than a feature.
    const provider = session?.user?.app_metadata?.provider;
    if (provider !== "apple") return;

    setTimeout(() => {
      void supabase
        .rpc("store_provider_refresh_token", { p_provider: "apple", p_token: token })
        .then(({ error }) => {
          // Deliberately quiet. A failure here costs a tidy revoke later; it
          // must never interrupt a sign-in that has otherwise succeeded, and
          // there is nothing the person could do about it if we told them.
          if (error) console.warn("Could not store the Apple refresh token:", error.message);
        });
    }, 0);
  });
}
