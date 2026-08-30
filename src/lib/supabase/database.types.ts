// Hand-written to match supabase/migrations/0001_init.sql. Once the Supabase
// project is live, regenerate the authoritative version with:
//   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
// and this file becomes redundant — keeping it for now so the app typechecks
// before that project exists.
//
// IMPORTANT: every table/view below carries a `Relationships: []` field.
// @supabase/supabase-js's real types require each table to satisfy
// `GenericTable` (Row/Insert/Update/Relationships) — without Relationships,
// TypeScript can't confirm this Database type matches what createClient<Database>
// expects, and silently resolves every `.from(...)` call to `never`. That
// shows up as a wall of "Property 'x' does not exist on type 'never'" errors
// across every file that queries Supabase — which is exactly what a real
// `tsc` build (e.g. on Netlify) surfaces, but a loose/local editor check can
// miss. We don't use embedded foreign-table selects anywhere in this app, so
// an empty array is accurate, not a placeholder.

export interface Database {
  public: {
    Tables: {
      teams: {
        Row: { id: string; owner_id: string; name: string; settings: Record<string, unknown>; created_at: string };
        Insert: { id?: string; owner_id: string; name: string; settings?: Record<string, unknown> };
        Update: Partial<Database["public"]["Tables"]["teams"]["Insert"]>;
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          format: "americano" | "mexicano" | "mix_americano" | "mix_mexicano" | "fixed_partner" | "team_sparring" | "side_americano";
          scoring_format: "fixed_21" | "fixed_4_games" | "fixed_5_games" | "race_4" | "race_6";
          ranking_basis: "points_first" | "wins_first";
          status: "draft" | "live" | "ended";
          join_code: string;
          public_token: string;
          scheduling_seed: number;
          min_players_per_court: number;
          /** Team Sparring only — how the Team A vs Team B banner tallies its running score. Null for every other format. */
          team_score_mode: "by_point" | "by_win" | "by_round" | null;
          /** Set only when the host locks partners for the whole session (Players step toggle, Americano/Mexicano base only). Null otherwise. */
          fixed_partner_style: "round_robin" | "rank_based" | null;
          /** Draft/lobby only — the create wizard's serialized in-progress state (roster + config),
           * saved live so an accidental exit never loses it. Null once the session goes live. */
          draft_state: Record<string, unknown> | null;
          /** Set true once the global Glicko ratings for this session have been
           * applied (0013) — the idempotency guard so a session can't double-count. */
          ratings_applied: boolean;
          /** Set true once the club league results for this session have been
           * recorded (0021) — once-only guard, consistent with ratings_applied. */
          results_applied: boolean;
          /** Optional club this session belongs to (0018) — what a club's league
           * + leaderboard aggregate over. Null for an ad-hoc (non-team) session. */
          club_id: string | null;
          /** Whether this session counts toward its club's league (0032) — the
           * host's create-wizard choice, defaults true. Irrelevant when club_id is null. */
          counts_for_league: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
          started_at: string | null;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          format: Database["public"]["Tables"]["sessions"]["Row"]["format"];
          scoring_format: Database["public"]["Tables"]["sessions"]["Row"]["scoring_format"];
          ranking_basis: Database["public"]["Tables"]["sessions"]["Row"]["ranking_basis"];
          status?: Database["public"]["Tables"]["sessions"]["Row"]["status"];
          join_code: string;
          public_token: string;
          scheduling_seed: number;
          min_players_per_court?: number;
          team_score_mode?: Database["public"]["Tables"]["sessions"]["Row"]["team_score_mode"];
          fixed_partner_style?: Database["public"]["Tables"]["sessions"]["Row"]["fixed_partner_style"];
          club_id?: string | null;
          counts_for_league?: boolean;
          created_by: string;
        };
        // Partial<Row>, not Partial<Insert> — Insert omits server/lifecycle
        // fields (started_at, ended_at, updated_at) that endSession() and
        // future lifecycle actions need to set on update.
        Update: Partial<Database["public"]["Tables"]["sessions"]["Row"]>;
        Relationships: [];
      };
      courts: {
        Row: { id: string; session_id: string; ordinal: number; display_name: string; available: boolean };
        Insert: { id?: string; session_id: string; ordinal: number; display_name: string; available?: boolean };
        Update: Partial<Database["public"]["Tables"]["courts"]["Insert"]>;
        Relationships: [];
      };
      players: {
        Row: {
          id: string;
          session_id: string;
          display_name: string;
          gender: "M" | "F";
          linked_user_id: string | null;
          team_side: "A" | "B" | null;
          /** Fixed Partner's "auto-pair by position" mode only — null for every other case. */
          preferred_side: "left" | "right" | null;
          /** Captured at self-join so a returning guest can be matched, and later linked to an account made with the same email (0005). */
          email: string | null;
          status: "active" | "late" | "left";
          matches_played: number;
          rests: number;
          joined_at: string;
          left_at: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          display_name: string;
          gender?: "M" | "F";
          team_side?: "A" | "B" | null;
          preferred_side?: "left" | "right" | null;
          email?: string | null;
          /** Set when we know the account behind this player (host adding themselves,
           * or a signed-in self-join) so their session history is attributable. */
          linked_user_id?: string | null;
          status?: "active" | "late" | "left";
        };
        // Partial<Row>, not Partial<Insert> — Insert omits server/lifecycle
        // fields (left_at, joined_at) that the Manage menu's "mark as left"
        // action needs to set on update, same reasoning as sessions.Update.
        Update: Partial<Database["public"]["Tables"]["players"]["Row"]>;
        Relationships: [];
      };
      join_requests: {
        Row: {
          id: string;
          session_id: string;
          display_name: string;
          gender: "M" | "F";
          team_side: "A" | "B" | null;
          /** Padel left/right court preference captured at join ('L'/'R'); mapped to players.preferred_side ('left'/'right') on confirm. */
          preferred_side: "L" | "R" | null;
          email: string | null;
          status: "pending" | "confirmed" | "rejected";
          player_id: string | null;
          created_at: string;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          display_name: string;
          gender?: "M" | "F";
          team_side?: "A" | "B" | null;
          preferred_side?: "L" | "R" | null;
          email?: string | null;
          status?: "pending" | "confirmed" | "rejected";
          player_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["join_requests"]["Row"]>;
        Relationships: [];
      };
      pairs: {
        Row: {
          id: string;
          session_id: string;
          label: string;
          is_auto_label: boolean;
          team_side: "A" | "B" | null;
          player_a_id: string;
          player_b_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          label: string;
          is_auto_label?: boolean;
          team_side?: "A" | "B" | null;
          player_a_id: string;
          player_b_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["pairs"]["Insert"]>;
        Relationships: [];
      };
      rounds: {
        Row: {
          id: string;
          session_id: string;
          sequence: number;
          status: "planned" | "in_progress" | "scored" | "superseded";
          generation_reason: string;
          seed_used: number;
          generated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          sequence: number;
          status?: Database["public"]["Tables"]["rounds"]["Row"]["status"];
          generation_reason: string;
          seed_used: number;
        };
        Update: Partial<Database["public"]["Tables"]["rounds"]["Insert"]>;
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          round_id: string;
          court_id: string;
          pair_a_id: string | null;
          pair_b_id: string | null;
          score_a: number | null;
          score_b: number | null;
          outcome: "win_a" | "win_b" | "draw" | "cancelled" | null;
          status: "not_started" | "in_progress" | "final" | "cancelled";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          round_id: string;
          court_id: string;
          pair_a_id?: string | null;
          pair_b_id?: string | null;
          status?: Database["public"]["Tables"]["matches"]["Row"]["status"];
        };
        Update: Partial<Database["public"]["Tables"]["matches"]["Row"]>;
        Relationships: [];
      };
      match_participants: {
        Row: { match_id: string; player_id: string; side: "A" | "B" };
        Insert: { match_id: string; player_id: string; side: "A" | "B" };
        Update: Partial<Database["public"]["Tables"]["match_participants"]["Insert"]>;
        Relationships: [];
      };
      adjustments: {
        Row: {
          id: string;
          session_id: string;
          player_id: string | null;
          pair_id: string | null;
          amount: number;
          unit: "points" | "games";
          reason: string;
          applied_by: string;
          applied_at: string;
          counts_as_match: boolean;
        };
        Insert: {
          id?: string;
          session_id: string;
          player_id?: string | null;
          pair_id?: string | null;
          amount: number;
          unit: "points" | "games";
          reason: string;
          applied_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["adjustments"]["Insert"]>;
        Relationships: [];
      };
      round_rests: {
        // composite primary key (round_id, player_id) — no separate id column.
        Row: { round_id: string; player_id: string; consecutive_rest_count: number };
        Insert: { round_id: string; player_id: string; consecutive_rest_count?: number };
        Update: Partial<Database["public"]["Tables"]["round_rests"]["Insert"]>;
        Relationships: [];
      };
      score_edits: {
        Row: {
          id: string;
          match_id: string;
          old_score_a: number | null;
          old_score_b: number | null;
          new_score_a: number | null;
          new_score_b: number | null;
          edited_by: string;
          reason: string | null;
          edited_at: string;
        };
        Insert: {
          id?: string;
          match_id: string;
          old_score_a?: number | null;
          old_score_b?: number | null;
          new_score_a?: number | null;
          new_score_b?: number | null;
          edited_by: string;
          reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["score_edits"]["Insert"]>;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: string;
          session_id: string;
          actor_id: string;
          entity_type: string;
          entity_id: string;
          old_value: Record<string, unknown> | null;
          new_value: Record<string, unknown> | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          actor_id: string;
          entity_type: string;
          entity_id: string;
          old_value?: Record<string, unknown> | null;
          new_value?: Record<string, unknown> | null;
          reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["audit_events"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          rating: number;
          rating_deviation: number;
          rating_volatility: number;
          rating_games: number;
          stats: Record<string, unknown> | null;
          onboarded_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
          rating?: number;
          rating_deviation?: number;
          rating_volatility?: number;
          rating_games?: number;
          stats?: Record<string, unknown> | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      rating_history: {
        Row: {
          id: string;
          user_id: string;
          session_id: string | null;
          rating: number;
          delta: number;
          created_at: string;
          // Added by 0021/0040 (the audit trail behind a rating move) and
          // missing from this file until 0047 needed to read them back.
          rating_before: number | null;
          rd_before: number | null;
          vol_before: number | null;
          games_before: number | null;
          games_after: number | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id?: string | null;
          rating: number;
          delta?: number;
          rating_before?: number | null;
          rd_before?: number | null;
          vol_before?: number | null;
          games_before?: number | null;
          games_after?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["rating_history"]["Insert"]>;
        Relationships: [];
      };
      clubs: {
        Row: {
          id: string;
          name: string;
          club_code: string;
          logo_url: string | null;
          session_floor: number;
          league_period: "monthly" | "2_month" | "3_month" | "6_month" | "yearly";
          league_min_sessions: number;
          /** Admin-set default sort column for the league board (0022). */
          default_sort: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          club_code: string;
          logo_url?: string | null;
          session_floor?: number;
          league_period?: Database["public"]["Tables"]["clubs"]["Row"]["league_period"];
          league_min_sessions?: number;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["clubs"]["Row"]>;
        Relationships: [];
      };
      session_results: {
        Row: {
          session_id: string;
          club_id: string;
          user_id: string;
          session_date: string;
          rank: number;
          field_size: number;
          player_count: number;
          placement_points: number;
          podium_bonus: number;
          wins: number;
          losses: number;
          draws: number;
          scored_points: number;
          /** Opponent-adjusted per-session performance in [0,1] (0021) — the input
           * to Club Score. 0.5 when a member played no rated matches. */
          perf_adj: number;
        };
        // Written only by apply_session_results (SECURITY DEFINER) — never a
        // direct client insert — so the Insert/Update shapes are unused in
        // practice, but present to satisfy the typed client.
        Insert: Database["public"]["Tables"]["session_results"]["Row"];
        Update: Partial<Database["public"]["Tables"]["session_results"]["Row"]>;
        Relationships: [];
      };
      club_events: {
        Row: {
          id: string;
          club_id: string;
          title: string;
          scheduled_at: string;
          location: string | null;
          notes: string | null;
          status: "scheduled" | "cancelled";
          session_id: string | null;
          created_by: string | null;
          created_at: string;
          // 0048 — the four planning numbers a host is asked for in the group
          // chat within a minute of the invite: courts, hours, places, price.
          court_count: number | null;
          duration_hours: number | null;
          max_players: number | null;
          cost: string | null;
          // 0055 — the readable share path. Written once at creation and never
          // rewritten, so renaming a session can't break a link already in a
          // group chat.
          slug: string | null;
        };
        Insert: {
          id?: string;
          club_id: string;
          title: string;
          scheduled_at: string;
          location?: string | null;
          notes?: string | null;
          status?: "scheduled" | "cancelled";
          session_id?: string | null;
          created_by?: string | null;
          court_count?: number | null;
          duration_hours?: number | null;
          max_players?: number | null;
          cost?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["club_events"]["Row"]>;
        Relationships: [];
      };
      club_event_guests: {
        Row: {
          id: string;
          event_id: string;
          display_name: string;
          gender: "M" | "F";
          invited_by: string | null;
          response: "in" | "waitlist";
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          display_name: string;
          gender?: "M" | "F";
          invited_by?: string | null;
          response?: "in" | "waitlist";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["club_event_guests"]["Insert"]>;
        Relationships: [];
      };
      club_event_rsvps: {
        Row: {
          event_id: string;
          user_id: string;
          response: "in" | "maybe" | "out" | "waitlist";
          responded_at: string;
        };
        Insert: {
          event_id: string;
          user_id: string;
          response: "in" | "maybe" | "out" | "waitlist";
          responded_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["club_event_rsvps"]["Insert"]>;
        Relationships: [];
      };
      club_members: {
        Row: {
          club_id: string;
          user_id: string;
          role: "owner" | "admin" | "member";
          joined_at: string;
        };
        Insert: {
          club_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member";
        };
        Update: Partial<Database["public"]["Tables"]["club_members"]["Insert"]>;
        Relationships: [];
      };
      club_join_requests: {
        Row: {
          id: string;
          club_id: string;
          user_id: string;
          status: "pending" | "accepted" | "declined";
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
        };
        Insert: {
          id?: string;
          club_id: string;
          user_id: string;
          status?: "pending" | "accepted" | "declined";
        };
        Update: Partial<Database["public"]["Tables"]["club_join_requests"]["Row"]>;
        Relationships: [];
      };
      club_invites: {
        Row: {
          id: string;
          club_id: string;
          inviter_id: string | null;
          invitee_id: string;
          status: "pending" | "accepted" | "declined";
          created_at: string;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          club_id: string;
          inviter_id?: string | null;
          invitee_id: string;
          status?: "pending" | "accepted" | "declined";
        };
        Update: Partial<Database["public"]["Tables"]["club_invites"]["Row"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          body: string | null;
          data: Record<string, unknown> | null;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          title: string;
          body?: string | null;
          data?: Record<string, unknown> | null;
          read?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      standings_live: {
        Row: {
          session_id: string;
          player_id: string;
          total_points: number;
          wins: number;
          draws: number;
          losses: number;
          adjustment_total: number;
        };
        Relationships: [];
      };
      standings_live_pairs: {
        Row: {
          session_id: string;
          pair_id: string;
          total_points: number;
          wins: number;
          draws: number;
          losses: number;
          adjustment_total: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_public_session: {
        Args: { p_public_token: string };
        Returns: unknown; // jsonb — see schema comments for shape
      };
      apply_session_ratings: {
        Args: { p_session_id: string; p_updates: unknown };
        Returns: undefined; // void
      };
      apply_session_results: {
        Args: { p_session_id: string; p_rows: unknown };
        Returns: undefined; // void
      };
      get_club_sessions: {
        Args: { p_club_id: string };
        // 0038 added counts_for_league — the league board reads it through here.
        Returns: unknown; // setof { id, name, status, format, created_at, started_at, ended_at, public_token, created_by, counts_for_league }
      };
      search_clubs: {
        Args: { p_query: string };
        Returns: unknown; // setof { id, name, club_code, logo_url, member_count, is_member, requested }
      };
      create_club_event: {
        Args: {
          p_club_id: string;
          p_title: string;
          p_scheduled_at: string;
          p_location?: string | null;
          p_notes?: string | null;
          // 0048 — the old 5-argument signature was dropped, not overloaded:
          // PostgREST resolves by argument name and two candidates differing
          // only by defaults make every call ambiguous.
          p_court_count?: number | null;
          p_duration_hours?: number | null;
          p_max_players?: number | null;
          p_cost?: string | null;
        };
        Returns: string; // uuid
      };
      link_event_session: {
        Args: { p_event_id: string; p_session_id: string };
        Returns: undefined; // void — 0052
      };
      attach_session_to_event: {
        Args: { p_session_id: string };
        Returns: string | null; // the event it claimed, or null when it declined — 0052
      };
      get_public_event_by_ref: {
        Args: { p_ref: string };
        Returns: unknown; // jsonb — 0055, slug or uuid
      };
      resolve_event_ref: {
        Args: { p_ref: string };
        Returns: string | null; // uuid — 0055
      };
      admin_reports: {
        Args: { p_include_closed?: boolean };
        Returns: unknown; // jsonb — 0054
      };
      admin_resolve_report: {
        Args: { p_report_id: string; p_status: string; p_note?: string | null };
        Returns: undefined; // void — 0054
      };
      block_user: {
        Args: { p_user_id: string };
        Returns: undefined; // void — 0053
      };
      unblock_user: {
        Args: { p_user_id: string };
        Returns: undefined; // void — 0053
      };
      my_blocks: {
        Args: Record<string, never>;
        Returns: unknown; // jsonb — 0053
      };
      report_user: {
        Args: { p_user_id: string; p_reason: string; p_detail?: string | null };
        Returns: unknown; // jsonb — 0053
      };
      add_event_guest: {
        Args: { p_event_id: string; p_name: string; p_gender?: string };
        Returns: unknown; // jsonb — the guest, and whether they landed on the waiting list
      };
      remove_event_guest: {
        Args: { p_guest_id: string };
        Returns: unknown; // jsonb
      };
      event_in_count: {
        Args: { p_event_id: string };
        Returns: number;
      };
      set_event_rsvp: {
        Args: { p_event_id: string; p_response: string };
        Returns: unknown; // jsonb — what you actually got, which may be a waitlist place
      };
      event_set_member_rsvp: {
        Args: { p_event_id: string; p_user_id: string; p_response: string };
        Returns: unknown; // jsonb
      };
      update_club_event: {
        Args: {
          p_event_id: string;
          p_title?: string | null;
          p_scheduled_at?: string | null;
          p_court_count?: number | null;
          p_duration_hours?: number | null;
          p_max_players?: number | null;
          p_cost?: string | null;
          p_location?: string | null;
        };
        Returns: unknown; // jsonb
      };
      notify_club_session_started: {
        Args: { p_session_id: string };
        Returns: undefined; // void
      };
      get_public_event: {
        Args: { p_event_id: string };
        Returns: unknown; // jsonb — see 0026 for shape
      };
      get_public_profile: {
        Args: { p_user_id: string };
        Returns: unknown; // jsonb { display_name, avatar_url, rating, rating_games, provisional, member_since, teams[], wins, losses, draws, form[], rating_trend[] }
      };
      get_club_stats: {
        Args: { p_club_id: string };
        Returns: unknown; // jsonb { members, sessions, games }
      };
      get_club_champions: {
        Args: { p_club_id: string };
        Returns: unknown; // jsonb { titles[], recent[] }
      };
      swap_round_players: {
        Args: { p_round_id: string; p_player_a: string; p_player_b: string };
        Returns: undefined; // void
      };
      email_exists: {
        Args: { p_email: string };
        Returns: unknown; // jsonb { exists: boolean, confirmed: boolean }
      };
      complete_onboarding: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      /** 0037 — erases the caller's identity, keeps match rows anonymised. */
      delete_my_account: {
        Args: Record<string, never>;
        Returns: undefined; // void
      };
      /** 0039 — spectator payload addressed by session id (the podium route). */
      get_public_session_by_id: {
        Args: { p_session_id: string };
        Returns: unknown; // jsonb — same shape as get_public_session + token/club/date/avatars
      };
      /** 0039 — the caller's own player rows, matches and co-players. */
      get_my_participation: {
        Args: Record<string, never>;
        Returns: unknown; // jsonb { my_players, my_participations, matches, participants, rounds, sessions, people }
      };
      /** 0040 — deletes a session and reverses the rating it applied. */
      delete_session_and_unrate: {
        Args: { p_session_id: string };
        Returns: number; // sessions removed (0 if not the caller's to delete)
      };
      prune_notifications: {
        Args: { p_days?: number; p_keep?: number };
        Returns: number; // rows removed for the calling user
      };
      get_claimable_players: {
        Args: { p_public_token: string };
        Returns: unknown; // jsonb [{ id, name }]
      };
      request_player_claim: {
        Args: { p_player_id: string };
        Returns: unknown; // jsonb { claim_id }
      };
      get_my_session_claim: {
        Args: { p_public_token: string };
        Returns: unknown; // jsonb { status, player_name } | null
      };
      get_pending_claims: {
        Args: { p_session_id: string };
        Returns: unknown; // jsonb [{ id, player_id, player_name, claimant_id, claimant_name, claimant_avatar }]
      };
      respond_player_claim: {
        Args: { p_claim_id: string; p_accept: boolean };
        Returns: undefined; // void
      };
      create_club: {
        Args: { p_name: string };
        Returns: unknown; // jsonb { id, code }
      };
      leave_club: {
        Args: { p_club_id: string };
        Returns: undefined;
      };
      club_kick_member: {
        Args: { p_club_id: string; p_user_id: string };
        Returns: undefined;
      };
      club_set_member_role: {
        Args: { p_club_id: string; p_user_id: string; p_role: string };
        Returns: undefined;
      };
      request_to_join_club: {
        Args: { p_club_id: string };
        Returns: unknown; // jsonb { request_id }
      };
      join_club_by_code: {
        Args: { p_code: string };
        Returns: unknown; // jsonb { club_id, name, ... }
      };
      respond_join_request: {
        Args: { p_request_id: string; p_accept: boolean };
        Returns: undefined;
      };
      invite_by_email: {
        Args: { p_club_id: string; p_email: string };
        Returns: unknown; // jsonb { invite_id }
      };
      respond_club_invite: {
        Args: { p_invite_id: string; p_accept: boolean };
        Returns: undefined;
      };
    };
  };
}
