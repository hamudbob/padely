import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getTeam, getTeamMembers, updateTeam, Team } from "../../lib/supabase/teamQueries";
import { getClubLeague, shiftPeriodReference, LeagueBoard, LeagueRow, LeaguePeriod } from "../../lib/supabase/leagueQueries";

type SortKey = "pointsPerSession" | "totalPoints" | "winsPerSession" | "clubScore" | "rating";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "pointsPerSession", label: "Pts/session" },
  { key: "totalPoints", label: "Total" },
  { key: "winsPerSession", label: "Win/session" },
  { key: "clubScore", label: "Club Score" },
  { key: "rating", label: "Rating" },
];

function fmt(key: SortKey, r: LeagueRow): string {
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

export default function LeaguePage() {
  const { teamId } = useParams();
  const { user } = useHostSession();
  const [team, setTeam] = useState<Team | null>(null);
  const [board, setBoard] = useState<LeagueBoard | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pointsPerSession");
  const [periodOffset, setPeriodOffset] = useState(0); // 0 = current period, −1 = previous…
  const [savedDefault, setSavedDefault] = useState(false);

  // Load the team once (also seeds the default sort + admin state).
  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    Promise.all([getTeam(teamId), getTeamMembers(teamId)])
      .then(([t, members]) => {
        setTeam(t);
        if (t) setSortKey((SORTS.some((s) => s.key === t.defaultSort) ? t.defaultSort : "pointsPerSession") as SortKey);
        setIsAdmin(members.some((m) => m.userId === user?.id && (m.role === "owner" || m.role === "admin")));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the league."))
      .finally(() => setLoading(false));
  }, [teamId, user?.id]);

  // (Re)load the board whenever the team or the viewed period changes.
  useEffect(() => {
    if (!teamId || !team) return;
    setBoardLoading(true);
    const reference = shiftPeriodReference(team.leaguePeriod as LeaguePeriod, new Date(), periodOffset);
    getClubLeague(teamId, reference)
      .then(setBoard)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the league."))
      .finally(() => setBoardLoading(false));
  }, [teamId, team, periodOffset]);

  const sortedRows = useMemo(() => {
    if (!board) return [];
    return [...board.rows].sort((x, y) => (y[sortKey] as number) - (x[sortKey] as number) || y.totalPoints - x.totalPoints);
  }, [board, sortKey]);

  async function saveDefaultSort() {
    if (!teamId) return;
    try {
      await updateTeam(teamId, { defaultSort: sortKey });
      setTeam((t) => (t ? { ...t, defaultSort: sortKey } : t));
      setSavedDefault(true);
      setTimeout(() => setSavedDefault(false), 1600);
    } catch {
      /* non-fatal */
    }
  }

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";
  const backBar = (
    <div className="flex items-center justify-between mb-5">
      <Link to={teamId ? `/teams/${teamId}` : "/teams"} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</Link>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (loading) return <div className={shell}>{backBar}<p className="text-[13px] text-warm-gray mt-16 text-center">Loading league…</p></div>;
  if (error) return <div className={shell}>{backBar}<p className="text-[13px] text-loss mt-16 text-center">{error}</p></div>;

  const isDefaultSort = team?.defaultSort === sortKey;

  return (
    <div className={shell}>
      {backBar}

      <h1 className="font-serif text-[24px] font-semibold text-graphite tracking-tight mb-1">{team?.name ?? "Team"} league</h1>

      {/* Period navigation */}
      {board && (
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setPeriodOffset((o) => o - 1)} aria-label="Previous period" className="w-8 h-8 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95">‹</button>
          <div className="text-center">
            <span className="block rounded-full bg-graphite text-ivory text-[11px] font-bold uppercase tracking-[0.1em] px-3 py-1">{board.periodLabel}</span>
            {periodOffset === 0 && <span className="block text-[10px] text-warm-gray mt-1">Current period</span>}
          </div>
          <button onClick={() => setPeriodOffset((o) => Math.min(0, o + 1))} disabled={periodOffset >= 0} aria-label="Next period" className="w-8 h-8 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95 disabled:opacity-30">›</button>
        </div>
      )}
      <p className="text-[11px] text-warm-gray mb-3">Rating = all-time · everything else = this period</p>

      {/* Sort chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSortKey(s.key)}
            className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold border ${
              sortKey === s.key ? "border-graphite bg-graphite text-ivory" : "border-line bg-surface text-ink-2"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {isAdmin && (
        <div className="mb-4 h-4">
          {isDefaultSort ? (
            <span className="text-[10.5px] text-warm-gray">This is the team's default sort.</span>
          ) : (
            <button onClick={saveDefaultSort} className="text-[10.5px] font-semibold text-gold-ink">
              {savedDefault ? "Saved ✓" : "Set as team default"}
            </button>
          )}
        </div>
      )}
      {!isAdmin && <div className="mb-4" />}

      {boardLoading ? (
        <p className="text-[13px] text-warm-gray mt-8 text-center">Loading…</p>
      ) : sortedRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-4 py-6 text-center">
          <p className="text-[13px] text-ink-2 font-semibold mb-1">No standings yet</p>
          <p className="text-[12px] text-warm-gray leading-snug">
            {board && board.totalSessions === 0
              ? `No team sessions this period yet. Attach a session to this team when you create it, and it'll count here.`
              : board && board.qualifyingSessions === 0
                ? `${board.totalSessions} session${board.totalSessions === 1 ? "" : "s"} this period, but none reached the ${board.sessionFloor}-player turnout floor, so no points were awarded. Lower the floor in team settings or play bigger nights.`
                : board
                  ? `${board.qualifyingSessions} qualifying session${board.qualifyingSessions === 1 ? "" : "s"} so far. Members appear once they've played ${board.minSessions} of them.`
                  : ""}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          {sortedRows.map((r, i) => (
            <div key={r.userId} className="flex items-center gap-2.5 px-3 py-2.5 border-t border-line first:border-t-0">
              <span className={`w-6 text-center text-[13px] font-bold tnum ${i === 0 ? "text-gold-ink" : "text-warm-gray"}`}>{i + 1}</span>
              <div className="w-[34px] h-[34px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[13px] font-semibold overflow-hidden shrink-0">
                {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="w-full h-full object-cover" /> : r.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <b className="block text-[14px] font-semibold text-graphite truncate">{r.displayName}</b>
                <span className="block text-[10.5px] text-warm-gray tnum">
                  {r.sessions} {r.sessions === 1 ? "session" : "sessions"} · {r.totalPoints} pts · CS {r.clubScore} · {Math.round(r.rating)}
                </span>
              </div>
              <span className="shrink-0 font-mono tnum text-[17px] font-semibold text-graphite tabular-nums">{fmt(sortKey, r)}</span>
            </div>
          ))}
        </div>
      )}

      {board && board.belowThreshold > 0 && (
        <p className="text-[11px] text-warm-gray mt-3 leading-snug">
          {board.belowThreshold} {board.belowThreshold === 1 ? "member has" : "members have"} played but not yet reached {board.minSessions} qualifying sessions this period — they'll appear once they do.
        </p>
      )}

      <p className="text-[11px] text-warm-gray mt-4 leading-snug">
        Winner is decided by <b className="font-semibold text-ink-2">points per session</b> (finishing place + podium bonus, averaged), with ties broken by most 1st-place finishes then best average rank. Club Score is a shrunk 0–100 index of how you did <i>relative to the opponents you faced</i>; Rating is your global skill (all-time), for reference only.
      </p>
    </div>
  );
}
