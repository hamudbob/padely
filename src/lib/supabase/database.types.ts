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
          format: "americano" | "mexicano" | "mix_americano" | "mix_mexicano" | "fixed_partner" | "team_sparring";
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
          status?: "active" | "late" | "left";
        };
        // Partial<Row>, not Partial<Insert> — Insert omits server/lifecycle
        // fields (left_at, joined_at) that the Manage menu's "mark as left"
        // action needs to set on update, same reasoning as sessions.Update.
        Update: Partial<Database["public"]["Tables"]["players"]["Row"]>;
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
    };
  };
}
