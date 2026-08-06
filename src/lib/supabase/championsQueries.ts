import { supabase } from "./client";

/**
 * Club Champions Hall (0030) — a derived hall-of-fame read from session_results.
 * No new table; member-gated via the get_club_champions RPC.
 */

export interface TitleHolder {
  userId: string;
  name: string;
  avatarUrl: string | null;
  titles: number;
  podiums: number;
  sessions: number;
}

export interface PodiumEntry {
  rank: number;
  name: string;
  avatarUrl: string | null;
}

export interface ChampionSession {
  sessionId: string;
  sessionName: string;
  sessionDate: string;
  fieldSize: number;
  playerCount: number;
  champion: { userId: string; name: string; avatarUrl: string | null; points: number };
  podium: PodiumEntry[];
}

export interface ClubChampions {
  titles: TitleHolder[];
  recent: ChampionSession[];
}

export async function getClubChampions(clubId: string): Promise<ClubChampions> {
  const { data, error } = await supabase.rpc("get_club_champions", { p_club_id: clubId });
  if (error) throw error;
  const d = (data ?? {}) as {
    titles?: { user_id: string; name: string | null; avatar: string | null; titles: number; podiums: number; sessions: number }[];
    recent?: {
      session_id: string;
      session_name: string | null;
      session_date: string;
      field_size: number;
      player_count: number;
      champion: { user_id: string; name: string | null; avatar: string | null; points: number };
      podium: { rank: number; name: string | null; avatar: string | null }[];
    }[];
  };
  return {
    titles: (d.titles ?? []).map((t) => ({
      userId: t.user_id,
      name: t.name ?? "Player",
      avatarUrl: t.avatar,
      titles: t.titles,
      podiums: t.podiums,
      sessions: t.sessions,
    })),
    recent: (d.recent ?? []).map((r) => ({
      sessionId: r.session_id,
      sessionName: r.session_name ?? "Session",
      sessionDate: r.session_date,
      fieldSize: r.field_size,
      playerCount: r.player_count,
      champion: {
        userId: r.champion.user_id,
        name: r.champion.name ?? "Player",
        avatarUrl: r.champion.avatar,
        points: Number(r.champion.points ?? 0),
      },
      podium: (r.podium ?? []).map((p) => ({ rank: p.rank, name: p.name ?? "Player", avatarUrl: p.avatar })),
    })),
  };
}
