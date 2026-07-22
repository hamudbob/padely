import { supabase } from "./client";

export interface HostCredentials {
  email: string;
  password: string;
}

export async function signUpHost({ name, email, password }: HostCredentials & { name: string }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
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

export async function getCurrentHost() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}
