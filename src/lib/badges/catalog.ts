/**
 * Every badge, agreed with Hamud on 19 Nov 2026: 18 for the player and 12 for
 * each club, all on the one profile shelf, whoever opens it.
 *
 * The server decides who has earned what (supabase/migrations/0087_badges.sql,
 * refresh_badges); this file is how each one is named, explained and drawn.
 * The ids, kinds and levels must match badge_rules() there.
 *
 * Kinds:
 *   tier    earned once, kept forever (the Competitor / Master / Elite ladder)
 *   levels  numbered levels; the badge shows the highest one reached
 *   repeat  earned again and again; the badge shows ×N
 *   once    earned once
 *   hidden  shows as ??? until earned, then like "once"
 * No bronze, silver or gold: padel grading already uses those.
 */

export type BadgeKind = "tier" | "levels" | "repeat" | "once" | "hidden";
export type BadgeScope = "player" | "club";
export type BadgeGroup = "tiers" | "milestones" | "moments" | "people" | "hidden" | "club";

export type BadgeIconName =
  | "tier1" | "tier2" | "tier3"
  | "calendar" | "racket" | "check" | "flame"
  | "shield" | "zero" | "slingshot" | "arrowUp"
  | "people" | "swords" | "whistle"
  | "moon" | "sunrise" | "hourglass" | "two"
  | "court" | "star" | "crown" | "podium" | "three"
  | "trophy" | "laurel" | "repeat" | "flag" | "invite" | "full" | "pencil";

export interface BadgeDef {
  id: string;
  scope: BadgeScope;
  group: BadgeGroup;
  kind: BadgeKind;
  name: string;
  /** Thresholds, lowest first ("levels" only). */
  levels?: number[];
  /** What a level counts: "nights", "partners". */
  unit?: string;
  /** How it's earned, one line. */
  how: string;
  icon: BadgeIconName;
  /** Only the club's owner can earn it (Founder). */
  ownerOnly?: boolean;
}

export const BADGES: BadgeDef[] = [
  // ── Player · tiers ──
  { id: "competitor", scope: "player", group: "tiers", kind: "tier", name: "Competitor", icon: "tier1",
    how: "Finish a night rated 1575 or more, once your rating has settled. Yours to keep, even if your rating drops later." },
  { id: "master", scope: "player", group: "tiers", kind: "tier", name: "Master", icon: "tier2",
    how: "Finish a night rated 1700 or more, once your rating has settled. Yours to keep." },
  { id: "elite", scope: "player", group: "tiers", kind: "tier", name: "Elite", icon: "tier3",
    how: "The top tier. Finish a night rated 1800 or more. Its name stays hidden until someone reaches it." },

  // ── Player · milestones ──
  { id: "nights_played", scope: "player", group: "milestones", kind: "levels", name: "Nights played", icon: "calendar",
    levels: [1, 10, 25, 50, 100, 250], unit: "nights", how: "Every session you play, in a club or not." },
  { id: "games_played", scope: "player", group: "milestones", kind: "levels", name: "Games played", icon: "racket",
    levels: [100, 500, 1000], unit: "games", how: "Every match you play on court." },
  { id: "match_wins", scope: "player", group: "milestones", kind: "levels", name: "Match wins", icon: "check",
    levels: [50, 200, 500], unit: "wins", how: "Every match you win." },
  { id: "on_a_roll", scope: "player", group: "milestones", kind: "levels", name: "On a roll", icon: "flame",
    levels: [4, 8, 12], unit: "weeks", how: "Play at least one night a week, weeks in a row (Monday to Sunday). Your best run counts." },

  // ── Player · moments ──
  { id: "unbeaten_night", scope: "player", group: "moments", kind: "repeat", name: "Unbeaten night", icon: "shield",
    how: "Win every match of a night, with at least 4 played." },
  { id: "clean_sheet", scope: "player", group: "moments", kind: "repeat", name: "Clean sheet", icon: "zero",
    how: "Win a match where the other side scores nothing: 21–0, 4–0." },
  { id: "giant_slayer", scope: "player", group: "moments", kind: "once", name: "Giant-slayer", icon: "slingshot",
    how: "Beat a pair rated 150 or more above yours (both pairs' average, at the start of that night)." },
  { id: "big_climb", scope: "player", group: "moments", kind: "once", name: "Big climb", icon: "arrowUp",
    how: "Your rating goes up 50 or more in one night, once it has settled." },

  // ── Player · people ──
  { id: "mixer", scope: "player", group: "people", kind: "levels", name: "Mixer", icon: "people",
    levels: [10, 25, 50], unit: "partners", how: "Different partners you've played with." },
  { id: "rivalry", scope: "player", group: "people", kind: "once", name: "Rivalry", icon: "swords",
    how: "Face the same opponent 20 times." },
  { id: "host", scope: "player", group: "people", kind: "levels", name: "Host", icon: "whistle",
    levels: [1, 10, 50], unit: "sessions", how: "Sessions you created that were played." },

  // ── Player · hidden ──
  { id: "night_owl", scope: "player", group: "hidden", kind: "hidden", name: "Night owl", icon: "moon",
    how: "A night you played ended after midnight." },
  { id: "early_bird", scope: "player", group: "hidden", kind: "hidden", name: "Early bird", icon: "sunrise",
    how: "A night you played started before 8 in the morning." },
  { id: "marathon", scope: "player", group: "hidden", kind: "hidden", name: "Marathon", icon: "hourglass",
    how: "Play 12 or more matches in one night." },
  { id: "double_header", scope: "player", group: "hidden", kind: "hidden", name: "Double header", icon: "two",
    how: "Play two different sessions on the same day." },

  // ── Club ──
  { id: "club_nights", scope: "club", group: "club", kind: "levels", name: "Club nights", icon: "court",
    levels: [1, 10, 25, 50, 100], unit: "nights", how: "Nights you've played at this club." },
  { id: "season_regular", scope: "club", group: "club", kind: "repeat", name: "Season regular", icon: "star",
    how: "A finished season where you played enough nights to appear in the table." },
  { id: "night_champion", scope: "club", group: "club", kind: "levels", name: "Night champion", icon: "crown",
    levels: [1, 5, 10, 25], unit: "titles", how: "Finish 1st on a club night." },
  { id: "podiums", scope: "club", group: "club", kind: "levels", name: "Podiums", icon: "podium",
    levels: [5, 10, 25, 50], unit: "podiums", how: "Finish in the top 3 on a club night (1st counts too)." },
  { id: "hat_trick", scope: "club", group: "club", kind: "repeat", name: "Hat-trick", icon: "three",
    how: "Win 3 club nights in a row, counting only the nights you played. Six in a row is ×2." },
  { id: "season_champion", scope: "club", group: "club", kind: "repeat", name: "Season champion", icon: "trophy",
    how: "Finish 1st in a season, as the Champions tab shows it." },
  { id: "season_podium", scope: "club", group: "club", kind: "repeat", name: "Season podium", icon: "laurel",
    how: "Finish in the top 3 of a season (the champion too)." },
  { id: "back_to_back", scope: "club", group: "club", kind: "repeat", name: "Back-to-back", icon: "repeat",
    how: "Season champion two seasons running." },
  { id: "founder", scope: "club", group: "club", kind: "levels", name: "Founder", icon: "flag", ownerOnly: true,
    levels: [10, 25, 50, 100], unit: "members", how: "For the club's owner: the club reaches this many members. Kept if people leave later." },
  { id: "recruiter", scope: "club", group: "club", kind: "levels", name: "Recruiter", icon: "invite",
    levels: [1, 5, 10], unit: "joined", how: "People who joined the club from your invite." },
  { id: "full_house", scope: "club", group: "club", kind: "levels", name: "Full house", icon: "full",
    levels: [1, 10, 25], unit: "full Call-ups", how: "Call-ups you posted where every spot was taken." },
  { id: "scorer", scope: "club", group: "club", kind: "levels", name: "Scorer", icon: "pencil",
    levels: [25, 100, 250], unit: "scores", how: "Match scores you entered at this club's nights, as host or co-host." },
];

export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));
export const PLAYER_BADGES = BADGES.filter((b) => b.scope === "player");
export const CLUB_BADGES = BADGES.filter((b) => b.scope === "club");

export const GROUP_LABEL: Record<BadgeGroup, string> = {
  tiers: "Tiers",
  milestones: "Milestones",
  moments: "Moments",
  people: "People and organising",
  hidden: "Hidden",
  club: "Club",
};
