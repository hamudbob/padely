import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useBackNav } from "../../lib/useBackNav";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getTeam, getTeamMembers, updateTeam, Team } from "../../lib/supabase/teamQueries";
import { getClubLeague, shiftPeriodReference, LeagueBoard, LeagueRow, LeaguePeriod } from "../../lib/supabase/leagueQueries";

type SortKey = "pointsPerSession" | "totalPoints" | "winsPerSession" | "clubScore" | "rating";

const SORTS: { key: SortKey; label: string; unit: string }[] = [
  { key: "pointsPerSession", label: "Per session", unit: "/ session" },
  { key: "totalPoints", label: "Total points", unit: "pts" },
  { key: "winsPerSession", label: "Wins / session", unit: "/ session" },
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

export default function LeaguePage() {
  const { teamId } = useParams();
  const back = useBackNav(teamId ? `/teams/${teamId}` : "/teams");
  const { user } = useHostSession();
  const [team, setTeam] = useState<Team | null>(null);
  const [board, setBoard] = useState<LeagueBoard | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pointsPerSession");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [showSort, setShowSort] = useState(false);
  const [savedDefault, setSavedDefault] = useState(false);

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

  const active = SORTS.find((s) => s.key === sortKey) ?? SORTS[0];

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
    setShowSort(false);
  }

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";
  const backBar = (
    <div className="flex items-center justify-between mb-2">
      <button onClick={back} aria-label="Back" className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform">‹</button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (loading) return <div className={shell}>{backBar}<p className="text-[13px] text-warm-gray mt-16 text-center">Loading league…</p></div>;
  if (error) return <div className={shell}>{backBar}<p className="text-[13px] text-loss mt-16 text-center">{error}</p></div>;

  return (
    <div className={shell}>
      {backBar}

      <div className="pt-2">
        <h1 className="font-serif text-[28px] font-semibold text-graphite tracking-tight">League</h1>
        <p className="text-[12.5px] text-warm-gray mt-0.5">{team?.name ?? "Team"} · winner by points / session</p>
      </div>

      {/* Period */}
      {board && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button onClick={() => setPeriodOffset((o) => o - 1)} aria-label="Previous period" className="w-[30px] h-[30px] rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95">‹</button>
          <span className="text-[13px] font-semibold text-graphite tnum">{board.periodLabel}</span>
          <button onClick={() => setPeriodOffset((o) => Math.min(0, o + 1))} disabled={periodOffset >= 0} aria-label="Next period" className="w-[30px] h-[30px] rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95 disabled:opacity-30">›</button>
        </div>
      )}

      {/* Standings header + sort */}
      <div className="relative flex items-center justify-between mt-5 mb-2 px-0.5">
        <h3 className="text-[13px] font-semibold text-ink-2">Standings</h3>
        <button onClick={() => setShowSort((v) => !v)} className="text-[12.5px] font-semibold text-gold-ink active:opacity-70">
          Sort: {active.label} ▾
        </button>
        {showSort && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowSort(false)} />
            <div className="absolute right-0 top-7 z-30 w-[190px] rounded-2xl bg-surface border border-line shadow-[0_10px_30px_rgba(13,13,13,0.14)] overflow-hidden">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => {
                    setSortKey(s.key);
                    setShowSort(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-[13.5px] border-t border-line first:border-t-0 ${s.key === sortKey ? "font-semibold text-graphite bg-surface-2" : "text-ink-2"}`}
                >
                  {s.label}
                </button>
              ))}
              {isAdmin && (
                <button onClick={saveDefaultSort} className="w-full text-left px-4 py-2.5 text-[12.5px] font-semibold text-gold-ink border-t border-line">
                  {savedDefault ? "Saved ✓" : "Set as team default"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {boardLoading ? (
        <p className="text-[13px] text-warm-gray mt-8 text-center">Loading…</p>
      ) : sortedRows.length === 0 ? (
        <div className="rounded-2xl bg-surface px-4 py-6 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <p className="text-[13px] text-ink-2 font-semibold mb-1">No standings yet</p>
          <p className="text-[12px] text-warm-gray leading-snug">
            {board && board.totalSessions === 0
              ? "No team sessions this period yet. Attach a session to this team when you create it and it'll count here."
              : board && board.qualifyingSessions === 0
                ? `${board.totalSessions} session${board.totalSessions === 1 ? "" : "s"} this period, but none were set to count for the league, so no points were awarded.`
                : board
                  ? `${board.qualifyingSessions} counting session${board.qualifyingSessions === 1 ? "" : "s"} so far — standings appear as soon as one is played.`
                  : ""}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          {sortedRows.map((r, i) => (
            <Link key={r.userId} to={`/u/${r.userId}`} className="flex items-center gap-3 px-3.5 py-3 border-t border-line first:border-t-0 active:bg-surface-2 transition-colors">
              <span className={`w-5 text-center text-[13px] font-bold tnum ${i === 0 ? "text-gold-ink" : "text-warm-gray"}`}>{i + 1}</span>
              <div className="w-[36px] h-[36px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[13px] font-semibold overflow-hidden shrink-0">
                {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="w-full h-full object-cover" /> : r.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <b className="block text-[14.5px] font-semibold text-graphite truncate">{r.displayName}</b>
                <span className="block text-[11px] text-warm-gray tnum">{r.sessions} sessions · {r.totalPoints} pts · CS {r.clubScore}</span>
              </div>
              <div className="text-right shrink-0">
                <span className="font-mono tnum text-[18px] font-semibold text-graphite leading-none">{fmtValue(sortKey, r)}</span>
                {active.unit && <span className="block text-[9px] font-semibold text-warm-gray mt-0.5">{active.unit}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {board && (sortedRows.length > 0 || board.belowThreshold > 0) && (
        <p className="text-[11px] text-warm-gray mt-3.5 leading-relaxed px-0.5">
          Tap “Sort” to rank by total, wins, Club Score, or rating.
          {board.belowThreshold > 0 ? ` ${board.belowThreshold} member${board.belowThreshold === 1 ? "" : "s"} haven't reached ${board.minSessions} qualifying sessions yet — they'll appear once they do.` : ""}
        </p>
      )}
    </div>
  );
}
