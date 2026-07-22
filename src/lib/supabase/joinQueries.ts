import { supabase } from "./client";

/**
 * STUBBED join-by-code resolver — ADDITIVE, calls a NOT-YET-EXISTING RPC.
 *
 * Intended contract: resolve a host's private `join_code` → the session's
 * `public_token`, so a watcher can be sent to `/live/:publicToken` (read-only,
 * no mutation, no account).
 *
 * BLOCKER (product + security decision required — see PR notes):
 * There is currently NO anon-safe way to resolve join_code → public_token.
 * By schema, `join_code` is host-only and must never be exposed publicly, so we
 * MUST NOT select `sessions` by `join_code` from an unauthenticated client
 * (RLS blocks it, and bypassing it would leak private session data). The correct
 * fix is a server-side `security definer` RPC `resolve_join_code(p_join_code)`
 * that returns ONLY the `public_token` for a `live` session and nothing else.
 * That RPC does not exist in the schema or database.types yet.
 *
 * The cast below is deliberate: it lets this real call compile against the
 * current typed client until the RPC is added. Until then this throws and the
 * caller surfaces a friendly "not switched on yet" message.
 */
export async function resolveJoinCode(code: string): Promise<string> {
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("resolve_join_code", { p_join_code: code });
  if (error) throw new Error(error.message);
  const token = (data as { public_token?: string } | null)?.public_token;
  if (!token) throw new Error("No live session matched that code.");
  return token;
}
