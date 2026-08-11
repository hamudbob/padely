import { supabase } from "./client";

export interface HostCredentials {
  email: string;
  password: string;
}

export async function signUpHost({
  name,
  email,
  password,
  redirectTo,
}: HostCredentials & { name: string; redirectTo?: string }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // emailRedirectTo is where the confirmation link lands the user AFTER they
    // click it. We point it back at /login?next=… so a brand-new signup returns
    // to the page they were trying to reach (e.g. a shared event) instead of home.
    options: { data: { name }, emailRedirectTo: redirectTo },
  });
  if (error) throw error;

  // Phase 1 = one team per host, created automatically on first signup —
  // but only if we actually have an active session. If the Supabase project
  // still requires email confirmation, data.session is null here (the user
  // row exists but isn't logged in yet), and auth.uid() would be null too —
  // this insert would silently fail RLS if we tried it now. ensureHostTeam()
  // runs again on first real sign-in instead, once a session truly exists.
  if (data.session && data.user) {
    await ensureHostTeam(data.user.id, name);
  }
  return data;
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

export async function signInHost({ email, password }: HostCredentials) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.user) {
    const fallbackName = (data.user.user_metadata?.name as string | undefined) ?? "My";
    await ensureHostTeam(data.user.id, fallbackName);
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
  if (insertError) throw insertError;
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

export async function signOutHost() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
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

