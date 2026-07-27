import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getPublicSession, PublicSessionData } from "../../lib/supabase/publicSessionQueries";
import { subscribeLiveUpdates } from "../../lib/supabase/liveChannel";

/**
 * Public / Spectator live view (`/live/:publicToken`). Read-only, wired to the
 * `get_public_session` RPC via the additive publicSessionQueries.ts wrapper.
 *
 * Live updates: subscribes to a Realtime *broadcast* channel keyed by the
 * session id (returned since migration 0010). The host pings that channel when a
 * score lands / a round is drawn / the session ends, and we silently re-pull.
 * A 15s safety poll + a refetch-on-focus cover any missed ping. No table is
 * exposed to anon — the ping is contentless and all data still comes via the RPC.
 *
 * Layout: a LIVE session leads with the current round's per-court scores
 * (a live scoreboard), then the leaderboard, then earlier rounds. An ENDED
 * session leads with a podium, then the final standings, then all rounds.
 */

const SAFETY_POLL_MS = 15000;

function firstNameOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Player";
  return trimmed.split(/\s+/)[0];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PublicLivePage() {
  const { publicToken } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewedSeq, setViewedSeq] = useState<number | null>(null); // which earlier round to show
  const [justUpdated, setJustUpdated] = useState(false); // brief "updated" flash

  // Keep the latest fetch in a ref so background refetches never race the token.
  const tokenRef = useRef<string | undefined>(publicToken);
  tokenRef.current = publicToken;

  const load = useCallback(
    async (silent: boolean) => {
      const token = tokenRef.current;
      if (!token) return;
      if (!silent) {
        setLoading(true);
        setError(null);
        setNotFound(false);
      }
      try {
        const d = await getPublicSession(token);
        if (tokenRef.current !== token) return; // token changed mid-flight
        if (d === null) {
          if (!silent) setNotFound(true);
        } else {
          setData(d);
          if (silent) {
            setJustUpdated(true);
            window.setTimeout(() => setJustUpdated(false), 1200);
          }
        }
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : "Couldn't load this session.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  // Initial load (and whenever the token changes).
  useEffect(() => {
    void load(false);
  }, [publicToken, load]);

  const sessionId = data?.session.id ?? "";
  const isLive = data?.session.status === "live";

  // Realtime + safety net. Only meaningful while the session is live; an ended
  // session's data is frozen. Broadcast pushes the instant a score lands; the
  // poll and focus-refetch are belt-and-braces for a dropped ping.
  useEffect(() => {
    if (!isLive) return;
    const refetch = () => void load(true);

    const unsub = sessionId ? subscribeLiveUpdates(sessionId, refetch) : undefined;
    const interval = window.setInterval(refetch, SAFETY_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      unsub?.();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isLive, sessionId, load]);

  const shell = "mx-auto max-w-sm min-h-screen bg-graphite text-ivory px-5 py-8";

  const backBtn = (
    <button
      onClick={() => navigate(-1)}
      aria-label="Go back"
      className="inline-flex items-center gap-1.5 text-[12.5px] text-ivory/60 hover:text-ivory transition-colors mb-4"
    >
      <span className="w-7 h-7 rounded-full border border-white/15 bg-white/[0.04] flex items-center justify-center text-[15px] leading-none">‹</span>
      Back
    </button>
  );

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
        {backBtn}
        <p className="text-[13px] text-loss mt-16 text-center">Couldn't load this session.</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className={shell}>
        {backBtn}
        <p className="text-[13px] text-ivory/60 mt-16 text-center">This live link isn't active.</p>
      </div>
    );
  }

  const { session, players, standings, rounds, matches } = data;
  const nameById = new Map(players.map((p) => [p.id, p.displayName]));

  // Leaderboard (points → wins → fewer losses; the RPC returns no rank/name).
  const board = [...standings]
    .sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins || a.losses - b.losses)
    .map((s, i) => ({
      rank: i + 1,
      name: nameById.get(s.playerId) ?? "Player",
      points: s.totalPoints,
      wins: s.wins,
      losses: s.losses,
    }));

  // Court scores grouped by round.
  const roundSeqs = [...new Set(matches.map((m) => m.roundSequence))].sort((a, b) => a - b);
  const latestSeq = roundSeqs[roundSeqs.length - 1] ?? 0;
  const currentRoundSeq = rounds.length > 0 ? Math.max(...rounds.map((r) => r.sequence)) : latestSeq;

  const currentMatches = matches.filter((m) => m.roundSequence === latestSeq);

  // Earlier rounds live behind a pager; default to the latest earlier round.
  const earlierSeqs = roundSeqs.filter((s) => s !== latestSeq);
  const activeEarlierSeq =
    viewedSeq != null && earlierSeqs.includes(viewedSeq) ? viewedSeq : earlierSeqs[earlierSeqs.length - 1] ?? 0;
  const activeEarlierIdx = earlierSeqs.indexOf(activeEarlierSeq);
  const earlierMatches = matches.filter((m) => m.roundSequence === activeEarlierSeq);

  const podium = board.slice(0, 3);
  const rest = board.slice(3);
  const podiumSlots = [podium[1], podium[0], podium[2]]; // 2nd · 1st · 3rd
  const podiumHeights = ["h-16", "h-24", "h-12"];
  const podiumBar = ["bg-white/[0.06]", "bg-gold/25", "bg-white/[0.06]"];

  const CourtCard = ({
    m,
    live,
  }: {
    m: PublicSessionData["matches"][number];
    live: boolean;
  }) => {
    const scored = m.scoreA != null && m.scoreB != null;
    const aWon = scored && (m.scoreA as number) > (m.scoreB as number);
    const bWon = scored && (m.scoreB as number) > (m.scoreA as number);
    const inPlay = live && m.status !== "final";
    return (
      <div className={`rounded-2xl border px-3.5 py-3 ${inPlay ? "border-court-lime/30 bg-court-lime/[0.06]" : "border-white/10 bg-white/[0.04]"}`}>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[9.5px] uppercase tracking-[0.14em] text-ivory/45">{m.courtName}</p>
          {inPlay && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-court-lime">
              <span className="w-1.5 h-1.5 rounded-full bg-court-lime animate-pulse" aria-hidden />
              In play
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex-1 min-w-0 text-[12.5px] ${aWon ? "text-ivory font-semibold" : "text-ivory/85"}`}>{m.teamA.join(" & ") || "—"}</span>
          <span className="font-mono tnum text-[17px] font-semibold shrink-0 px-1">
            <span className={aWon ? "text-gold" : "text-ivory"}>{m.scoreA ?? "–"}</span>
            <span className="text-ivory/35"> - </span>
            <span className={bWon ? "text-gold" : "text-ivory"}>{m.scoreB ?? "–"}</span>
          </span>
          <span className={`flex-1 min-w-0 text-right text-[12.5px] ${bWon ? "text-ivory font-semibold" : "text-ivory/85"}`}>{m.teamB.join(" & ") || "—"}</span>
        </div>
      </div>
    );
  };

  return (
    <div className={shell}>
      {backBtn}

      {/* Wordmark + live/ended chip */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-wordmark text-[19px] font-semibold text-ivory flex items-baseline leading-none">
          Padelier
          <span className="ml-[3px] w-[7px] h-[7px] rounded-full bg-gold inline-block" aria-hidden />
        </div>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-court-lime/15 text-court-lime">
            <span className="relative w-1.5 h-1.5 inline-flex items-center justify-center" aria-hidden>
              <span className="absolute w-1.5 h-1.5 rounded-full bg-court-lime animate-ping" />
              <span className="w-1.5 h-1.5 rounded-full bg-court-lime" />
            </span>
            Live
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-white/10 text-ivory/70">
            Ended
          </span>
        )}
      </div>

      <p className="text-gold text-[10px] font-bold uppercase tracking-[0.22em] mt-4 flex items-center gap-2">
        {isLive ? "Now watching" : "Final result"}
        {justUpdated && <span className="text-court-lime/80 normal-case tracking-normal font-medium text-[10px]">· updated</span>}
      </p>
      <h1 className="font-serif text-[26px] font-medium tracking-tight text-ivory mt-0.5">{session.name || "Live session"}</h1>
      <p className="text-[12.5px] text-ivory/60 mb-5">
        {isLive
          ? <>Round <span className="font-mono tnum">{currentRoundSeq}</span> in play · anyone with the link can watch</>
          : "Session ended · final standings below"}
      </p>

      {/* ── LIVE: current round hero ─────────────────────── */}
      {isLive && currentMatches.length > 0 && (
        <div className="mb-5">
          <p className="text-court-lime text-[10px] font-bold uppercase tracking-[0.22em] mb-2.5">
            Round <span className="font-mono tnum">{latestSeq}</span> · on court now
          </p>
          <div className="space-y-2">
            {currentMatches.map((m, i) => (
              <CourtCard key={i} m={m} live />
            ))}
          </div>
        </div>
      )}

      {/* ── ENDED: podium ─────────────────────────────────── */}
      {!isLive && podium.length > 0 && (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-4 pt-5 pb-4 mb-4">
          <div className="flex items-end justify-center gap-2.5">
            {podiumSlots.map((slot, i) =>
              slot ? (
                <div key={slot.rank} className="flex-1 flex flex-col items-center min-w-0">
                  <span className="text-[12px] mb-1">{slot.rank === 1 ? "🥇" : slot.rank === 2 ? "🥈" : "🥉"}</span>
                  <div className={`w-11 h-11 rounded-full border flex items-center justify-center text-[13px] font-semibold ${slot.rank === 1 ? "bg-gold/20 text-gold border-gold/40" : "bg-white/[0.06] text-ivory border-white/10"}`}>
                    {initialsOf(slot.name)}
                  </div>
                  <span className="text-[12px] text-ivory/90 mt-1.5 truncate max-w-full text-center">{firstNameOf(slot.name)}</span>
                  <span className="font-mono tnum text-[13px] text-gold font-semibold">{slot.points}</span>
                  <div className={`w-full mt-1.5 rounded-t-lg ${podiumHeights[i]} ${podiumBar[i]}`} aria-hidden />
                </div>
              ) : (
                <div key={`empty-${i}`} className="flex-1" />
              )
            )}
          </div>
        </div>
      )}

      {/* ── Leaderboard ───────────────────────────────────── */}
      <p className="text-gold text-[10px] font-bold uppercase tracking-[0.22em] mb-2">
        {isLive ? "Leaderboard" : "Full standings"}
      </p>
      {board.length === 0 ? (
        <p className="text-[12.5px] text-ivory/60 py-2.5">No scores yet — check back once play begins.</p>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 divide-y divide-white/[0.06] mb-5">
          {(isLive ? board : rest).map((row) => (
            <div key={`${row.rank}-${row.name}`} className="flex items-center justify-between py-2.5 text-[12.5px] text-ivory">
              <span className={row.rank === 1 && isLive ? "font-semibold" : ""}>
                <span className={`font-mono tnum w-6 inline-block ${row.rank === 1 ? "text-gold" : "text-warm-gray"}`}>{row.rank}</span>
                {row.name}
              </span>
              <span className="font-mono tnum flex items-baseline gap-2">
                <span className="text-ivory/40 text-[10.5px]">{row.wins}W</span>
                <span className="text-gold font-semibold">{row.points}</span>
              </span>
            </div>
          ))}
          {!isLive && rest.length === 0 && (
            <div className="py-2.5 text-[12px] text-ivory/45">Top three are on the podium above.</div>
          )}
        </div>
      )}

      {/* ── Round history (earlier rounds, paged) ─────────── */}
      {earlierSeqs.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2.5">
            <button
              onClick={() => activeEarlierIdx > 0 && setViewedSeq(earlierSeqs[activeEarlierIdx - 1])}
              disabled={activeEarlierIdx <= 0}
              aria-label="Previous round"
              className="w-8 h-8 rounded-full border border-white/15 bg-white/[0.04] text-ivory/80 flex items-center justify-center text-[16px] disabled:opacity-30"
            >
              ‹
            </button>
            <p className="text-ivory/70 text-[10px] font-bold uppercase tracking-[0.22em]">
              {isLive ? "Earlier" : "Round"} <span className="font-mono tnum">{activeEarlierSeq}</span> · Scores
            </p>
            <button
              onClick={() => activeEarlierIdx < earlierSeqs.length - 1 && setViewedSeq(earlierSeqs[activeEarlierIdx + 1])}
              disabled={activeEarlierIdx >= earlierSeqs.length - 1}
              aria-label="Next round"
              className="w-8 h-8 rounded-full border border-white/15 bg-white/[0.04] text-ivory/80 flex items-center justify-center text-[16px] disabled:opacity-30"
            >
              ›
            </button>
          </div>
          <div className="space-y-2">
            {earlierMatches.map((m, i) => (
              <CourtCard key={i} m={m} live={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
