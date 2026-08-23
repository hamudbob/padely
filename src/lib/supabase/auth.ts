import { supabase } from "./client";

export interface HostCredentials {
  email: string;
  password: string;
}

/**
 * Ask whether an address already has an account (0035). Powers the email-first
 * screen: one field, then either a log-in or a sign-up.
 *
 * Returns null when the lookup can't be trusted — rate-limited, offline, or the
 * RPC revoked. Callers MUST treat null as "don't know" and fall back to
 * resolving on submit, never as "no account exists", or a returning user would
 * be pushed into a sign-up that then fails.
 */
export async function emailHasAccount(email: string): Promise<{ exists: boolean; confirmed: boolean } | null> {
  const { data, error } = await supabase.rpc("email_exists", { p_email: email });
  if (error || !data || typeof data !== "object") return null;
  const row = data as { exists?: boolean; confirmed?: boolean };
  if (typeof row.exists !== "boolean") return null;
  return { exists: row.exists, confirmed: row.confirmed === true };
}

/**
 * Hand off to Google's consent screen. Supabase does the OAuth dance; the
 * browser comes back to `redirectTo` with the session in the URL fragment,
 * which the client picks up automatically (detectSessionInUrl defaults on).
 *
 * There is no `data` to read here and no session yet — a successful call ends
 * with a full-page navigation away, so anything after it never runs. Only an
 * error means we're still on the page.
 *
 * `prompt: "select_account"` is deliberate: without it Google silently reuses
 * whichever account the browser is already signed into, which is wrong on a
 * shared phone and confusing on a laptop with two Gmail accounts.
 *
 * `redirectTo` MUST be on the project's redirect allow-list (Supabase →
 * Authentication → URL Configuration) or Google returns to the Site URL and
 * drops the ?next= we sent it.
 */
export async function signInWithGoogle(redirectTo: string) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}

/** True when the signed-in account has no password of its own — it exists only
 *  because of Google (or another provider). Settings uses this to hide "change
 *  password", which would otherwise ask for a current password that never
 *  existed. */
export async function hasPasswordIdentity(): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const identities = data.user?.identities ?? [];
  return identities.some((i) => i.provider === "email");
}

/** Marks the caller's onboarding finished, so the router stops sending them to /welcome. */
export async function completeOnboarding() {
  const { error } = await supabase.rpc("complete_onboarding");
  if (error) throw error;
}

/**
 * Sign-up result. `alreadyRegistered` is the case Supabase hides: signing up
 * with an address that already has a confirmed account returns a *fake success*
 * (so strangers can't probe who's registered) with `identities: []` and no
 * session. Without checking that array the UI shows "check your email" for a
 * mail that is never sent, and the person waits forever.
 */
export interface SignUpOutcome {
  needsConfirmation: boolean;
  alreadyRegistered: boolean;
}

export async function signUpHost({
  name,
  email,
  password,
  redirectTo,
}: HostCredentials & { name?: string; redirectTo?: string }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // emailRedirectTo is where the confirmation link lands the user AFTER they
    // click it. We point it back at /login?next=… so a brand-new signup returns
    // to the page they were trying to reach (e.g. a shared event) instead of home.
    // `name` is optional now — it's collected on /welcome after confirmation.
    options: { data: name ? { name } : {}, emailRedirectTo: redirectTo },
  });
  if (error) throw error;

  // Phase 1 = one team per host, created automatically on first signup —
  // but only if we actually have an active session. If the Supabase project
  // still requires email confirmation, data.session is null here (the user
  // row exists but isn't logged in yet), and auth.uid() would be null too —
  // this insert would silently fail RLS if we tried it now. ensureHostTeam()
  // runs again on first real sign-in instead, once a session truly exists.
  if (data.session && data.user) {
    await ensureHostTeam(data.user.id, name ?? email.split("@")[0]);
  }
  return data;
}

/**
 * signUp, classified. Use this rather than reading `data` at the call site —
 * the already-registered case is easy to miss and strands the user.
 */
export async function signUpAndClassify(
  args: HostCredentials & { name?: string; redirectTo?: string },
): Promise<SignUpOutcome> {
  const data = await signUpHost(args);
  // An empty identities array means Supabase recognised the address and quietly
  // did nothing. A genuine new signup always comes back with one identity.
  const alreadyRegistered = Array.isArray(data.user?.identities) && data.user.identities.length === 0;
  return { needsConfirmation: !data.session && !alreadyRegistered, alreadyRegistered };
}

/** Re-send the sign-up confirmation email (for the "didn't get it / check spam" case). */
export async function resendConfirmation(email: string, redirectTo?: string) {
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } });
  if (error) throw error;
}

/** Ensure the host's Phase-1 team exists for whoever is currently signed in.
 * Needed on the email-confirmation return path, where the session appears via
 * the URL (detectSessionInUrl) without an explicit signInHost() call — so the
 * team auto-creation that normally rides on sign-in would otherwise be skipped. */
export async function ensureHostTeamForCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return;
  const name = (data.user.user_metadata?.name as string | undefined) ?? "My";
  await ensureHostTeam(data.user.id, name);
}

/**
 * Thrown ONLY when Supabase rejected the credentials themselves. Everything
 * else — a network blip, a failed team insert — is a different kind of problem
 * and must not be mistaken for "wrong password".
 */
export class InvalidCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCredentialsError";
  }
}

/** Supabase's wording for a bad email/password pair, across versions. */
function isCredentialFailure(message: string): boolean {
  return /invalid login credentials|invalid email or password/i.test(message);
}

export async function signInHost({ email, password }: HostCredentials) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (isCredentialFailure(error.message)) throw new InvalidCredentialsError(error.message);
    throw error;
  }
  if (data.user) {
    const fallbackName = (data.user.user_metadata?.name as string | undefined) ?? "My";
    // Non-fatal. The sign-in has already succeeded at this point — letting a
    // team-row hiccup bubble up would make a perfectly good login look like a
    // failed one, and callers that fall back to sign-up on failure would then
    // try to create an account the person already has.
    await ensureHostTeam(data.user.id, fallbackName).catch(() => undefined);
  }
  return data;
}

/** Creates the host's one Phase-1 team if it doesn't exist yet. Safe to call every login. */
async function ensureHostTeam(ownerId: string, name: string) {
  const { data: existing, error: lookupError } = await supabase
    .from("teams")
    .select("id")
    .eq("owner_id", ownerId)
    .limit(1);
  if (lookupError) throw lookupError;
  if (existing && existing.length > 0) return;

  const { error: insertError } = await supabase.from("teams").insert({
    owner_id: ownerId,
    name: `${name}'s Team`,
  });
  // 23505 = the unique index added in 0044 rejecting a second team for this
  // owner. That is not a failure: it means another call — the other half of
  // the sign-in/onboarding race — created the team a moment ago, which is all
  // this function ever wanted. Before 0044 both inserts succeeded and the
  // account was left with two teams, which broke every screen that reads one.
  if (insertError && (insertError as { code?: string }).code !== "23505") throw insertError;
}

/**
 * Send the "reset your password" email. `redirectTo` must be on the project's
 * allow-list (Supabase → Authentication → URL Configuration) or the link will
 * silently fall back to the Site URL and land the user on the home screen with
 * no way to actually set a new password.
 *
 * Always resolves, even for an unknown address — telling a stranger whether an
 * email is registered is an account-enumeration leak.
 */
export async function sendPasswordReset(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  // Rate-limit errors are worth surfacing; "user not found" deliberately isn't.
  if (error && /rate|too many/i.test(error.message)) throw error;
}

/** Set a new password for the currently-authenticated (or recovery) session. */
export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * Change your password from inside the app (Settings), re-authenticating first.
 *
 * Supabase's updateUser({ password }) will happily change the password for any
 * live session without asking for the old one. That's fine for the recovery
 * flow, where the email link *is* the proof — but not here: an unattended phone
 * or a stolen session token would otherwise be enough for someone to lock the
 * real owner out of their own account. Verifying the current password first
 * makes the change require something only the owner knows.
 *
 * The verification sign-in is against the same account that's already signed
 * in, so a success is a no-op on the session and a failure changes nothing.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) throw new Error("You're not signed in.");

  const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (checkError) {
    if (isCredentialFailure(checkError.message)) {
      throw new InvalidCredentialsError("That's not your current password.");
    }
    throw checkError;
  }

  await updatePassword(newPassword);
}

export async function signOutHost() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Erases the signed-in person's identity and ends the session (0037).
 *
 * Order matters. The avatar goes FIRST, through the storage API rather than
 * from SQL: deleting the storage.objects row server-side would drop the
 * metadata and strand the actual file in the bucket — public, at a guessable
 * path — with nothing left to delete it by. This call needs the user's own
 * token, which is why it can't wait until after the RPC has cut the session.
 *
 * A failure here is not fatal to the deletion. Stranding one image is bad; a
 * person stuck unable to delete their account because a storage call timed out
 * is worse, and the RPC clears avatar_url regardless so nothing points at it.
 */
export async function deleteMyAccount(): Promise<{ avatarRemoved: boolean }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;

  let avatarRemoved = true;
  if (uid) {
    try {
      const { data: files } = await supabase.storage.from("avatars").list(uid);
      const paths = (files ?? []).map((f) => `${uid}/${f.name}`);
      if (paths.length) {
        const { error } = await supabase.storage.from("avatars").remove(paths);
        if (error) avatarRemoved = false;
      }
    } catch {
      avatarRemoved = false;
    }
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;

  // Best effort: the RPC has already deleted the server-side session, so this
  // is really just clearing the local token. Failing here must not look like a
  // failed deletion.
  await supabase.auth.signOut().catch(() => undefined);

  return { avatarRemoved };
}

/** Updates the host's display name (stored on the auth user's metadata, the
 * same `name` set at sign-up). Returns the refreshed user. */
export async function updateHostName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name can't be empty.");
  const { data, error } = await supabase.auth.updateUser({ data: { name: trimmed } });
  if (error) throw error;
  return data.user;
}

/**
 * Saves the account's default playing preferences (padel court side + gender)
 * onto the auth user's metadata. These feed a signed-in player's join so they
 * never re-enter them. updateUser merges into existing metadata, so `name` is
 * left untouched.
 */
export async function updateHostPrefs(prefs: { gender?: "M" | "F"; preferredSide?: "L" | "R" }) {
  const data: Record<string, unknown> = {};
  if (prefs.gender) data.gender = prefs.gender;
  if (prefs.preferredSide) data.preferred_side = prefs.preferredSide;
  const { data: res, error } = await supabase.auth.updateUser({ data });
  if (error) throw error;
  return res.user;
}

