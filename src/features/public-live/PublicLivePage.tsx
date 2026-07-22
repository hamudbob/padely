import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicSession, PublicSessionData } from "../../lib/supabase/publicSessionQueries";

/**
 * Public / Spectator live view (`/live/:publicToken`). Read-only, wired to the
 * `get_public_session` RPC via the additive publicSessionQueries.ts wrapper.
 *
 * FLAGS (see PR notes):
 * - The RPC returns NO matches / per-court live scores, so the prototype's live
 *   court-score card cannot be rendered faithfully yet — we show a clearly
 *   labelled "pending" slot instead of fabricating scores. Extending the RPC to
 *   return current-round matches is backend work outside this pass.
 * - The RPC's standings carry no rank and no name; we derive rank by sorting on
 *   total points (points-first) and join names from `players`. This does not
 *   honour a `wins_first` ranking_basis (the RPC doesn't return it) — acceptable
 *   for a spectator glance.
 */
export default function PublicLivePage() {
  const { publicToken } = useParams();
  const [data, setData] = useState<PublicSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!publicToken) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    getPublicSession(publicToken)
      .then((d) => {
        if (d === null) setNotFound(true);
        else setData(d);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this session."))
      .finally(() => setLoading(false));
  }, [publicToken]);

  const shell = "mx-auto max-w-sm min-h-screen bg-graphite text-ivory px-5 py-8";

  if (loading) {
    return (
      <div className={shell}>
        <p className="text-[13px] text-ivory/60 mt-16 text-center">Loading the live view…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={shell}>
        <p className="text-[13px] text-loss mt-16 text-center">Couldn't load this session.</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className={shell}>
        <p className="text-[13px] text-ivory/60 mt-16 text-center">This live link isn't active.</p>
      </div>
    );
  }

  const { session, players, standings, rounds } = data;
  const isLive = session.status === "live";
  const nameById = new Map(players.map((p) => [p.id, p.displayName]));
  // Derive rank client-side (points-first; the RPC returns no rank/name).
  const board = [...standings]
    .sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins)
    .map((s, i) => ({ rank: i + 1, name: nameById.get(s.playerId) ?? "Player", points: s.totalPoints }));
  const currentRoundSeq = rounds.length > 0 ? Math.max(...rounds.map((r) => r.sequence)) : 0;

  return (
    <div className={shell}>
      {/* Wordmark + live chip */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-wordmark text-[19px] font-semibold text-ivory flex items-baseline leading-none">
          Padelier
          <span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-white/10 text-ivory">
            <span className="w-1.5 h-1.5 rounded-full bg-court-lime" aria-hidden />
            Live
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-white/10 text-ivory/70">
            Ended
          </span>
        )}
      </div>

      <p className="text-gold text-[10px] font-bold uppercase tracking-[0.22em] mt-4">Now watching</p>
      <h1 className="font-serif text-[26px] font-medium tracking-tight text-ivory mt-0.5">{session.name || "Live session"}</h1>
      <p className="text-[12.5px] text-ivory/60 mb-4">
        {isLive
          ? <>Round <span className="font-mono tnum">{currentRoundSeq}</span> in play · anyone with the link can watch</>
          : "Session ended · final standings below"}
      </p>

      {/* Live court scores are not available from get_public_session yet — do not
          fabricate. Clearly labelled pending slot (see file-level FLAG). */}
      {isLive && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 mb-2.5">
          <p className="text-[10px] uppercase tracking-[0.1em] text-ivory/55">Court scores</p>
          <p className="text-[12.5px] text-ivory/70 mt-1.5">
            Live per-court scores appear here once the public scoreboard is switched on for this session.
          </p>
        </div>
      )}

      {/* Leaderboard (real, derived) */}
      <p className="text-gold text-[10px] font-bold uppercase tracking-[0.22em] mt-4 mb-2">Leaderboard</p>
      {board.length === 0 ? (
        <p className="text-[12.5px] text-ivory/60 py-2.5">No scores yet — check back once play begins.</p>
      ) : (
        board.map((row) => (
          <div key={`${row.rank}-${row.name}`} className="flex items-center justify-between py-2.5 text-[12.5px] text-ivory">
            <span className={row.rank === 1 ? "font-semibold" : ""}>
              <span className={`font-mono tnum w-5 inline-block ${row.rank === 1 ? "text-gold" : "text-warm-gray"}`}>{row.rank}</span>
              {row.name}
            </span>
            <span className="font-mono tnum text-gold font-semibold">{row.points}</span>
          </div>
        ))
      )}
    </div>
  );
}
