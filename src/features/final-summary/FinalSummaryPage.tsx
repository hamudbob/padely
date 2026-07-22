import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSessionStandings, SessionStandings, StandingsRow } from "../../lib/supabase/standingsQueries";
import { getRoundHistory, RoundHistoryEntry } from "../../lib/supabase/roundHistoryQueries";
import { getHostLiveSnapshot, HostLiveSnapshot } from "../../lib/supabase/sessionQueries";

function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s&]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Champion / final-summary screen (`/session/:sessionId/final`). Wired to real
 * data via the existing read-only queries (getSessionStandings + getRoundHistory
 * + getHostLiveSnapshot for the session name) — no new backend. Route is public
 * in App.tsx; note getSessionStandings/getHostLiveSnapshot read tables directly,
 * so a non-host viewer only fully renders this if project RLS allows it
 * (flagged for QA).
 */
export default function FinalSummaryPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [standings, setStandings] = useState<SessionStandings | null>(null);
  const [history, setHistory] = useState<RoundHistoryEntry[] | null>(null);
  const [snapshot, setSnapshot] = useState<HostLiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getSessionStandings(sessionId),
      getRoundHistory(sessionId),
      // Session name is a nicety — if RLS blocks the snapshot for a non-host
      // viewer, degrade to a generic title rather than failing the whole page.
      getHostLiveSnapshot(sessionId).catch(() => null),
    ])
      .then(([s, h, snap]) => {
        setStandings(s);
        setHistory(h);
        setSnapshot(snap);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the results."))
      .finally(() => setLoading(false));
  }, [sessionId]);

  function handleShare() {
    const url = `${window.location.origin}/session/${sessionId ?? ""}/final`;
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ url }).catch(() => {});
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  }

  const shell = "mx-auto max-w-sm min-h-screen bg-graphite text-ivory px-5 py-10 text-center";

  if (loading) {
    return (
      <div className={shell}>
        <p className="text-[13px] text-ivory/60 mt-16">Tallying the final standings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={shell}>
        <p className="text-[13px] text-loss mt-16">{error}</p>
        <Link to="/" className="inline-block mt-6 text-[13px] font-semibold text-ivory/80 underline">
          Back to sessions
        </Link>
      </div>
    );
  }

  const rows: StandingsRow[] = standings?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className={shell}>
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold">Session complete</p>
        <h1 className="font-serif text-[34px] font-medium tracking-tight leading-[1.05] mt-2">Well played.</h1>
        <p className="text-[12.5px] text-ivory/60 mt-3">This session has no results yet.</p>
        <Link to="/" className="inline-block mt-6 text-[13px] font-semibold text-ivory/80 underline">
          Back to sessions
        </Link>
      </div>
    );
  }

  const winner = rows[0];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const roundCount = history?.length ?? 0;
  const matchCount = (history ?? []).reduce((n, r) => n + r.matches.length, 0);
  const playerCount = rows.length;
  const sessionName = snapshot?.session.name ?? "This session";

  // Podium columns laid out 2nd · 1st · 3rd (prototype order). Missing places
  // (fewer than 3 players) simply drop out.
  const podiumSlots = (
    [
      podium[1] ? { row: podium[1], place: 2 } : null,
      podium[0] ? { row: podium[0], place: 1 } : null,
      podium[2] ? { row: podium[2], place: 3 } : null,
    ] as ({ row: StandingsRow; place: number } | null)[]
  ).filter((s): s is { row: StandingsRow; place: number } => s !== null);

  return (
    <div className={shell}>
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold">Session complete</p>
      <h1 className="font-serif text-[34px] font-medium tracking-tight leading-[1.05] mt-2">
        Well played, <span className="italic text-gold">{firstNameOf(winner.playerName)}</span>.
      </h1>
      <p className="text-[12.5px] text-ivory/60 mb-6">
        {sessionName} · <span className="font-mono tnum">{roundCount}</span> rounds
      </p>

      {/* Podium (top 3, ordered 2nd · 1st · 3rd) */}
      <div className="flex items-end justify-center gap-2.5 mb-6">
        {podiumSlots.map(({ row, place }) => (
          <div key={row.subjectId} className="flex-1 max-w-[92px] text-center">
            <div
              className={`rounded-full mx-auto flex items-center justify-center font-semibold ${
                place === 1
                  ? "w-16 h-16 bg-gold text-graphite ring-4 ring-gold/20 text-[18px]"
                  : "w-[52px] h-[52px] bg-white/[0.06] border border-white/10 text-ivory text-[15px]"
              }`}
            >
              {initialsOf(row.playerName)}
            </div>
            <p className="text-[12px] font-semibold mt-2">{firstNameOf(row.playerName)}</p>
            <p className="font-mono tnum text-[14px] font-bold text-gold">{row.totalPoints}</p>
            <div
              className={`mt-2.5 bg-white/[0.04] border border-white/10 border-b-0 rounded-t-xl flex justify-center pt-2 font-mono font-bold ${
                place === 1 ? "h-[76px] text-gold" : place === 2 ? "h-[54px] text-white/30" : "h-[40px] text-white/30"
              }`}
            >
              {place}
            </div>
          </div>
        ))}
      </div>

      {/* Stat tiles */}
      <div className="flex gap-2 mb-4">
        {[
          { value: roundCount, label: "Rounds" },
          { value: matchCount, label: "Matches" },
          { value: playerCount, label: "Players" },
        ].map((stat) => (
          <div key={stat.label} className="flex-1 bg-white/[0.04] border border-white/10 rounded-2xl px-2.5 py-3 text-center">
            <b className="font-mono tnum text-[20px] font-semibold text-ivory block">{stat.value}</b>
            <span className="text-[9.5px] uppercase tracking-wide text-ivory/50">{stat.label}</span>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <>
          <div className="border-t border-white/10 my-3" />
          {rest.map((row) => (
            <div key={row.subjectId} className="flex items-center justify-between py-2.5 text-[12.5px] text-ivory/85">
              <span>
                <span className="font-mono tnum text-warm-gray w-5 inline-block">{row.rank}</span>
                {row.playerName}
              </span>
              <span className="font-mono tnum text-gold font-semibold">{row.totalPoints}</span>
            </div>
          ))}
        </>
      )}

      <div className="h-4" />
      <button
        onClick={handleShare}
        className="w-full rounded-full px-4 py-3.5 font-semibold text-graphite bg-gold active:scale-[0.99] transition-transform"
      >
        Share result
      </button>
      <button
        onClick={() => navigate("/")}
        className="w-full mt-2.5 rounded-full px-4 py-3.5 font-semibold border-[1.5px] border-white/40 text-ivory bg-transparent active:scale-[0.99] transition-transform"
      >
        Back to sessions
      </button>
    </div>
  );
}
