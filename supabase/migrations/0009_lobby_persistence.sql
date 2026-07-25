-- =====================================================================
-- Lobby persistence + hygiene
--   * sessions.draft_state — the create wizard saves its in-progress lobby
--     (roster + config) here live, so an accidental exit never loses players.
--     Null once the session goes live.
--   * indexes on the two hot lobby/standings read paths.
-- Backwards-safe: existing rows get draft_state = NULL and behave exactly as
-- before. Run this in the Supabase SQL editor.
-- =====================================================================

alter table sessions add column if not exists draft_state jsonb;

-- join_requests is polled every couple of seconds while a lobby is open,
-- always filtered by (session_id, status).
create index if not exists idx_join_requests_session_status on join_requests (session_id, status);

-- adjustments is read on every standings recompute, filtered by session_id.
create index if not exists idx_adjustments_session on adjustments (session_id);
