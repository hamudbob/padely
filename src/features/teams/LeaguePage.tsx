import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { updateTeam, Team } from "../../lib/supabase/teamQueries";
import { getClubLeague, LeagueBoard, LeagueRow } from "../../lib/supabase/leagueQueries";
import { SEASON_LENGTHS } from "../../lib/league/seasons";
import { SkeletonScreen, SkeletonTable } from "../shell/Skeleton";
import { useCachedQuery } from "../../lib/cache/useCachedQuery";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { Face, Podium, card } from "./club/ui";

/**
 * The League tab of the club page (ADR-002). Was its own page until Nov 2026;
 * /teams/:id/league now opens the club on this tab.
 */

type SortKey = "pointsPerSession" | "totalPoints" | "winsPerSession" | "clubScore" | "rating";

const SORTS: { key: SortKey; label: string; unit: string }[] = [
  { key: "pointsPerSession", label: "Per night", unit: "/ night" },
  { key: "totalPoints", label: "Total points", unit: "pts" },
  { key: "winsPerSession", label: "Wins / night", unit: "/ night" },
  { key: "clubScore", label: "Club Score", unit: "" },
  { key: "rating", label: "Rating", unit: "" },
];

function fmtValue(key: SortKey, r: LeagueRow): string {
  switch (key) {
    case "pointsPerSession":
      return r.pointsPerSession.toFixed(1);
    case "totalPoints":
      return String(r.totalPoints);
    case "winsPerSession":
      return r.winsPerSession.toFixed(1);
    case "clubScore":
      return String(r.clubScore);
    case "rating":
      return String(Math.round(r.rating));
    default:
      return "";
  }
}

function sortRows(rows: LeagueRow[], key: SortKey): LeagueRow[] {
  return [...rows].sort((x, y) => (y[key] as number) - (x[key] as number) || y.totalPoints - x.totalPoints);
}

/** "You're 4th in Season 3", "1 more night to qualify": the club band's line
 *  about you, from the season in progress. Null when there's nothing to say. */
export function seasonLineFor(board: LeagueBoard | undefined | null, userId: string | undefined, sort: string): string | null {
  if (!board || !userId) return null;
  const key = (SORTS.some((s) => s.key === sort) ? sort : "pointsPerSession") as SortKey;
  const season = board.periodLabel.split(" · ")[0] || "the league";
  const rows = sortRows(board.rows, key);
  const i = rows.findIndex((r) => r.userId === userId);
  if (i >= 0) {
    const n = i + 1;
    const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
    return `You're ${n}${suffix} in ${season}`;
  }
  const mine = board.nights?.[userId] ?? 0;
  const need = board.minSessions - mine;
  if (mine > 0 && need > 0) return `${need} more ${need === 1 ? "night" : "nights"} to qualify`;
  return null;
}

export function LeagueTab({
  teamId,
  team,
  isAdmin,
  userId,
  onTeamChanged,
}: {
  teamId: string;
  team: Team;
  isAdmin: boolean;
  userId: string | undefined;
  onTeamChanged: (t: Team) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("pointsPerSession");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [savedDefault, setSavedDefault] = useState(false);

  // Keyed by season as well as club, so paging back and forth is instant.
  const boardQ = useCachedQuery(`club:${teamId}:league:season:${periodOffset}`, () => getClubLeague(teamId, periodOffset));
  const board = boardQ.data;

  useEffect(() => {
    setSortKey((SORTS.some((s) => s.key === team.defaultSort) ? team.defaultSort : "pointsPerSession") as SortKey);
  }, [team.defaultSort]);

  const rows = useMemo(() => (board ? sortRows(board.rows, sortKey) : []), [board, sortKey]);
  const active = SORTS.find((s) => s.key === sortKey) ?? SORTS[0];
  const myIndex = rows.findIndex((r) => r.userId === userId);

  async function saveDefaultSort() {
    try {
      await updateTeam(teamId, { defaultSort: sortKey });
      onTeamChanged({ ...team, defaultSort: sortKey });
      setSavedDefault(true);
      setTimeout(() => setSavedDefault(false), 1600);
    } catch {
      /* non-fatal */
    }
  }

  if (boardQ.error && !board) {
    return (
      <div className="px-5 mt-5">
        <ErrorNote error={withFallback(boardQ.error, "Couldn't load the league.")} where="LeagueTab" />
      </div>
    );
  }

  const daysLeft = board && board.offset === 0 && board.periodEnd ? Math.max(0, Math.ceil((new Date(board.periodEnd).getTime() - Date.now()) / 86400000)) : null;
  const [seasonName, seasonDates] = (board?.periodLabel ?? "Season").split(" · ");
  const behind =
    myIndex > 0 && rows[myIndex - 1] ? (rows[myIndex - 1][sortKey] as number) - (rows[myIndex][sortKey] as number) : null;
  const myNights = userId ? board?.nights?.[userId] ?? 0 : 0;
  const needToQualify = board && myIndex < 0 && myNights > 0 ? board.minSessions - myNights : 0;

  return (
    <div className="px-5">
      {/* Season */}
      <div className="flex items-center justify-between mt-5">
        <button
          onClick={() => board && setPeriodOffset((o) => Math.max(-(board.seasonCount - 1), o - 1))}
          disabled={!board || board.offset <= -(board.seasonCount - 1)}
          aria-label="Previous season"
          className="w-[34px] h-[34px] rounded-full bg-surface text-ink-2 shadow-[0_1px_2px_rgba(13,13,13,0.08)] disabled:opacity-30 active:scale-95"
        >
          ‹
        </button>
        <span className="text-center">
          <span className="block font-serif text-[18px] font-semibold text-graphite">{seasonName}</span>
          <span className="block text-[11.5px] text-warm-gray mt-0.5">
            {seasonDates ?? ""}
            {daysLeft != null ? ` · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` : ""}
          </span>
        </span>
        <button
          onClick={() => setPeriodOffset((o) => Math.min(0, o + 1))}
          disabled={periodOffset >= 0}
          aria-label="Next season"
          className="w-[34px] h-[34px] rounded-full bg-surface text-ink-2 shadow-[0_1px_2px_rgba(13,13,13,0.08)] disabled:opacity-30 active:scale-95"
        >
          ›
        </button>
      </div>

      {!board ? (
        <SkeletonScreen label="Loading the league table">
          <SkeletonTable n={6} className="mt-5" />
        </SkeletonScreen>
      ) : (
        <>
          {rows.length > 0 && (
            <div className={`mt-3.5 ${card} px-4 pt-[18px] pb-3.5`}>
              <Podium
                entries={rows.slice(0, 3).map((r) => ({
                  key: r.userId,
                  name: r.displayName,
                  avatarUrl: r.avatarUrl,
                  value: fmtValue(sortKey, r),
                  unit: active.unit || active.label,
                  href: `/u/${r.userId}`,
                }))}
              />
              <p className="text-[11.5px] text-warm-gray text-center mt-3">
                {board.qualifyingSessions} {board.qualifyingSessions === 1 ? "night" : "nights"} played · {board.minSessions}{" "}
                {board.minSessions === 1 ? "night" : "nights"} to qualify
              </p>
            </div>
          )}
          {board.offset === 0 && board.pendingChange && (
            <p className="text-[12px] text-gold-ink text-center mt-2.5">
              From {new Date(board.pendingChange.startsAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })},
              seasons are {(SEASON_LENGTHS.find((l) => l.value === board.pendingChange!.length)?.label ?? "").toLowerCase()} long.
            </p>
          )}

          <div className="flex items-baseline justify-between mt-6 px-0.5">
            <h2 className="font-serif text-[18px] font-semibold text-graphite">Standings</h2>
            {isAdmin && sortKey !== team.defaultSort && (
              <button onClick={saveDefaultSort} className="text-[12px] font-semibold text-gold-ink">
                Make default
              </button>
            )}
            {savedDefault && <span className="text-[12px] font-semibold text-win">Saved ✓</span>}
          </div>
          {/* Sort as chips you can see, not a menu you have to know about */}
          <div className="flex gap-1.5 mt-2.5 -mr-5 pr-5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Sort by">
            {SORTS.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={s.key === sortKey}
                onClick={() => setSortKey(s.key)}
                className={`shrink-0 h-8 px-3.5 rounded-full text-[12px] ${s.key === sortKey ? "bg-gold-soft text-gold-ink font-bold" : "text-warm-gray font-semibold"}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {boardQ.loading && !board ? null : rows.length === 0 ? (
            <div className={`mt-2.5 ${card} px-4 py-6 text-center`}>
              <p className="text-[13px] text-ink-2 font-semibold mb-1">No standings yet</p>
              <p className="text-[12px] text-warm-gray leading-snug">
                {board.totalSessions === 0
                  ? "No club nights this season yet. Start a session from this club, or one of its Call-ups, and it counts here."
                  : board.qualifyingSessions === 0
                    ? `${board.totalSessions} ${board.totalSessions === 1 ? "night" : "nights"} this season, but none were set to count for the league.`
                    : `Nobody has played ${board.minSessions} ${board.minSessions === 1 ? "night" : "nights"} yet. Standings appear as soon as someone has.`}
              </p>
            </div>
          ) : (
            <div className={`mt-2.5 ${card} overflow-hidden`}>
              {rows.map((r, i) => {
                const me = r.userId === userId;
                return (
                  <Link
                    key={r.userId}
                    to={`/u/${r.userId}`}
                    className={`flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0 active:bg-surface-2 ${me ? "bg-gold-soft" : ""}`}
                  >
                    <span className={`w-5 text-center font-mono tnum text-[13px] font-semibold ${i === 0 || me ? "text-gold-ink" : "text-warm-gray"}`}>{i + 1}</span>
                    <Face name={r.displayName} url={r.avatarUrl} />
                    <span className="flex-1 min-w-0">
                      <b className="block text-[14.5px] font-semibold text-graphite truncate">
                        {r.displayName}
                        {me && <span className="font-normal text-warm-gray"> · you</span>}
                      </b>
                      {me && behind != null && behind > 0 ? (
                        <span className="block text-[11px] font-semibold text-gold-ink">
                          {sortKey === "pointsPerSession" || sortKey === "winsPerSession" ? behind.toFixed(1) : Math.round(behind)} behind {i}
                          {i === 1 ? "st" : i === 2 ? "nd" : i === 3 ? "rd" : "th"}
                        </span>
                      ) : (
                        <span className="block text-[11px] text-warm-gray tnum">
                          {r.sessions} {r.sessions === 1 ? "night" : "nights"} · {r.totalPoints} pts · CS {r.clubScore}
                        </span>
                      )}
                    </span>
                    <span className="text-right shrink-0">
                      <span className="font-mono tnum text-[18px] font-semibold text-graphite leading-none">{fmtValue(sortKey, r)}</span>
                      {active.unit && <span className="block text-[9px] font-semibold text-warm-gray mt-0.5">{active.unit}</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {(needToQualify > 0 || board.belowThreshold > 0) && (
            <p className="text-[11.5px] text-warm-gray mt-3 leading-relaxed text-center px-2">
              {needToQualify > 0 && (
                <b className="text-gold-ink font-semibold">
                  You need {needToQualify} more {needToQualify === 1 ? "night" : "nights"} to appear.{" "}
                </b>
              )}
              {board.belowThreshold > 0 &&
                `${board.belowThreshold} ${board.belowThreshold === 1 ? "member hasn't" : "members haven't"} played ${board.minSessions} ${board.minSessions === 1 ? "night" : "nights"} this season yet. They'll appear once they do.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
