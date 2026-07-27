import { supabase } from "./client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Realtime "someone changed this session" signalling, via Supabase Broadcast.
 *
 * Why broadcast (not postgres_changes): a spectator is anonymous and, by design,
 * has NO direct table access — everything they see comes through the
 * security-definer get_public_session RPC. Postgres-changes realtime would
 * require granting anon SELECT on matches/rounds/standings (a security surface
 * the audit explicitly wanted to shrink). Broadcast is a plain pub/sub bus: the
 * host's client sends a contentless "update" ping, spectators receive it and
 * re-pull through the RPC. No table exposure, no publication/RLS changes.
 *
 * The channel is keyed by session id (returned by get_public_session since
 * migration 0010). The ping carries no data — it only says "re-fetch now".
 */

const CHANNEL_PREFIX = "live-session:";

// One reusable sender channel per session on the host side, so we join once and
// then every notify() is a cheap send on the already-joined channel.
const senderChannels = new Map<string, RealtimeChannel>();

/** Host side: tell watchers this session just changed (fire-and-forget). */
export function notifyLiveUpdate(sessionId: string): void {
  if (!sessionId) return;
  const name = CHANNEL_PREFIX + sessionId;
  let channel = senderChannels.get(name);
  if (!channel) {
    channel = supabase.channel(name, { config: { broadcast: { ack: false } } });
    senderChannels.set(name, channel);
    channel.subscribe();
  }
  // send() no-ops harmlessly if the join hasn't completed yet; the spectator's
  // safety poll covers that brief window, and every later ping lands live.
  void channel.send({ type: "broadcast", event: "update", payload: {} });
}

/**
 * Spectator side: run `onUpdate` whenever the host pings this session. Returns
 * an unsubscribe function — call it on unmount.
 */
export function subscribeLiveUpdates(sessionId: string, onUpdate: () => void): () => void {
  const name = CHANNEL_PREFIX + sessionId;
  const channel = supabase.channel(name);
  channel.on("broadcast", { event: "update" }, () => onUpdate()).subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
