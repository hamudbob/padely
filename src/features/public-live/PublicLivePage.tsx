import { useCallback, useEffect, useRef, useState } from "react";
import { withFallback } from "../../lib/errors";
import ErrorNote from "../shell/ErrorNote";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { getPublicSession, PublicSessionData } from "../../lib/supabase/publicSessionQueries";
import { subscribeLiveUpdates } from "../../lib/supabase/liveChannel";
import SessionJoinPanel from "./SessionJoinPanel";

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
  // The 6-digit code the viewer entered to get here (carried as ?j=). Needed so
  // the join-as-new path can call request_join; absent on a bare watch link.
  const [params] = useSearchParams();
  const joinCode = params.get("j");
  const [data, setData] = useState<PublicSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewedSeq, setViewedSeq] = useState<number | null>(null); // which earlier round to show
  const [justUpdated, setJustUpdated] = useState(false); // brief "updated" flash

  // Keep the latest fetch in a ref so background refetches never race the token.
  const tokenRef = useRef<string | undefined>(publicToken);
  tokenRef.current = publicToken;
  const updatedTimer = useRef<number | null>(null);
  const lastRefetchAt = useRef(0); // throttles live refetches (anti-amplification)

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
            if (updatedTimer.current != null) window.clearTimeout(updatedTimer.current);
            updatedTimer.current = window.setTimeout(() => setJustUpdated(false), 1200);
          }
        }
      } catch (err) {
        if (!silent) setError(withFallback(err, "Couldn't load this session."));
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

  // Clear the "· updated" flash timer on unmount.
  useEffect(() => () => {
    if (updatedTimer.current != null) window.clearTimeout(updatedTimer.current);
  }, []);

  const sessionId = data?.session.id ?? "";
  const isLive = data?.session.status === "live";

  // Realtime + safety net. Only meaningful while the session is live; an ended
  // session's data is frozen. Broadcast pushes the instant a score lands; the
  // poll and focus-refetch are belt-and-braces for a dropped ping.
  useEffect(() => {
    if (!isLive) return;
    // Throttle: a live refetch runs at most once every 2.5s, so a burst of
    // realtime pings (including any spoofed on the public channel) collapses to
    // a single RPC call instead of amplifying into a refetch storm.
    const refetch = () => {
      const now = Date.now();
      if (now - lastRefetchAt.current < 2500) return;
      lastRefetchAt.current = now;
      void load(true);
    };

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

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";

  const topBar = (
    <div className="flex items-center justify-between mb-2">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
      >
        ‹
      </button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (loading) {
    return (
      <div className={shell}>
        {topBar}
        <p className="text-[13px] text-warm-gray mt-16 text-center">Loading the live view…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={shell}>
        {topBar}
        {/* A spectator link is the one screen a total stranger lands on, so
            the code matters more here than anywhere: they have no account and
            no other way to tell you what they saw. */}
        <div className="mt-16">
          <ErrorNote error={error} where="PublicLivePage" fallback="Couldn't load this session." />
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className={shell}>
        {topBar}
        <p className="text-[13px] text-warm-gray mt-16 text-center">This live link isn't active.</p>
      </div>
    );
  }

  const { session, standings, rounds, matches } = data;

  // Leaderboard rows are already ranked by assembleStandings — the SAME engine
  // the host uses (rest compensation, ranking_basis, integer wins, Fixed-Partner
  // pair collapse, zero-match players all handled server-side-of-truth). Just map
  // for display, preserving the computed order and shared ranks.
  const board = standings.map((s) => ({
    rank: s.rank,
    name: s.playerName,
    points: s.totalPoints,
    wins: s.wins,
    losses: s.losses,
    draws: s.draws,
    played: s.matchesPlayed,
    comp: s.restCompensation,
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
  const podiumSlots = [podium[1], podium[0], podium[2]]; // 2nd · 1st · 3rd
  const podiumHeights = ["h-16", "h-24", "h-12"];
  const podiumBar = ["bg-stone/50", "bg-gold/30", "bg-stone/50"];

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
      <div className={`rounded-2xl border px-3.5 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)] ${inPlay ? "border-court-lime/50 bg-court-lime/[0.08]" : "border-line bg-surface"}`}>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[9.5px] uppercase tracking-[0.14em] text-warm-gray">{m.courtName}</p>
          {inPlay && (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5f7a12]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8FB01E] animate-pulse" aria-hidden />
              In play
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex-1 min-w-0 text-[12.5px] ${aWon ? "text-graphite font-semibold" : "text-ink-2"}`}>{m.teamA.join(" & ") || "—"}</span>
          <span className="font-mono tnum text-[17px] font-semibold shrink-0 px-1">
            <span className={aWon ? "text-gold-ink" : "text-graphite"}>{m.scoreA ?? "–"}</span>
            <span className="text-stone"> - </span>
            <span className={bWon ? "text-gold-ink" : "text-graphite"}>{m.scoreB ?? "–"}</span>
          </span>
          <span className={`flex-1 min-w-0 text-right text-[12.5px] ${bWon ? "text-graphite font-semibold" : "text-ink-2"}`}>{m.teamB.join(" & ") || "—"}</span>
        </div>
      </div>
    );
  };

  return (
    <div className={shell}>
      {topBar}

      {/* Eyebrow + live/ended chip */}
      <div className="flex items-center justify-between mt-3 mb-0.5">
        <p className="text-gold-ink text-[10px] font-bold uppercase tracking-[0.2em] flex items-center gap-2">
          {isLive ? "Now watching" : "Final result"}
          {justUpdated && <span className="text-[#5f7a12] normal-case tracking-normal font-semibold text-[10px]">· updated</span>}
        </p>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold bg-court-lime/20 text-ink">
            <span className="relative w-1.5 h-1.5 inline-flex items-center justify-center" aria-hidden>
              <span className="absolute w-1.5 h-1.5 rounded-full bg-court-lime animate-ping" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#8FB01E]" />
            </span>
            Live
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold bg-surface-2 border border-line text-warm-gray">
            Ended
          </span>
        )}
      </div>
      <h1 className="font-serif text-[26px] font-semibold tracking-tight text-graphite">{session.name || "Live session"}</h1>
      <p className="text-[12.5px] text-warm-gray mb-5">
        {isLive
          ? <>Round <span className="font-mono tnum">{currentRoundSeq}</span> in play · anyone with the link can watch</>
          : "Session ended · final standings below"}
      </p>

      {/* ── Get in the game (live only) ───────────────────── */}
      {isLive && publicToken && <SessionJoinPanel publicToken={publicToken} joinCode={joinCode} />}

      {/* ── LIVE: current round hero ─────────────────────── */}
      {isLive && currentMatches.length > 0 && (
        <div className="mb-5">
          <p className="text-ink-2 text-[10px] font-bold uppercase tracking-[0.16em] mb-2.5">
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
        <div className="rounded-3xl border border-line bg-surface px-4 pt-5 pb-4 mb-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <div className="flex items-end justify-center gap-2.5">
            {podiumSlots.map((slot, i) =>
              slot ? (
                <div key={slot.rank} className="flex-1 flex flex-col items-center min-w-0">
                  <span className="text-[13px] mb-1">{slot.rank === 1 ? "🥇" : slot.rank === 2 ? "🥈" : "🥉"}</span>
                  <div className={`w-11 h-11 rounded-full border flex items-center justify-center text-[13px] font-semibold ${slot.rank === 1 ? "bg-gold-soft text-gold-ink border-gold/40" : "bg-surface-2 text-ink-2 border-line"}`}>
                    {initialsOf(slot.name)}
                  </div>
                  <span className="text-[12px] text-graphite mt-1.5 truncate max-w-full text-center font-medium">{firstNameOf(slot.name)}</span>
                  <span className="font-mono tnum text-[13px] text-gold-ink font-semibold">{slot.points}</span>
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
      <p className="text-gold-ink text-[10px] font-bold uppercase tracking-[0.16em] mb-2 px-0.5">
        {isLive ? "Leaderboard" : "Full standings"}
      </p>
      {board.length === 0 ? (
        <p className="text-[12.5px] text-warm-gray py-2.5">No scores yet — check back once play begins.</p>
      ) : (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden mb-5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          {/* column hint */}
          <div className="flex items-center gap-3 px-4 pt-2.5 pb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-warm-gray">
            <span className="w-5 text-center">#</span>
            <span className="flex-1">Player</span>
            <span className="w-14 text-right">W–L</span>
            <span className="w-12 text-right">Pts</span>
          </div>
          <div className="divide-y divide-line">
            {/* An ended session used to render only the board MINUS the podium
                here, under a heading that reads "Full standings". With three or
                fewer subjects that table came out empty — and in Fixed Partner
                the subjects are PAIRS, so any session of six or fewer players
                hit it: a podium, a "Full standings" heading, and nothing at all
                underneath. The heading was the honest half; the data was the
                wrong half. Now it renders the whole board in both states, with
                rank 1 highlighted as it already was, and the podium above it
                stays what it always was — a visual summary, not a substitute. */}
            {board.map((row) => {
              const top = row.rank === 1;
              return (
                <div key={`${row.rank}-${row.name}`} className={`flex items-center gap-3 px-4 py-2.5 ${top ? "bg-gold-soft/50" : ""}`}>
                  <span className={`w-5 text-center font-mono tnum text-[13px] font-bold ${top ? "text-gold-ink" : "text-warm-gray"}`}>{row.rank}</span>
                  <span className={`flex-1 min-w-0 truncate text-[13.5px] ${top ? "text-graphite font-semibold" : "text-ink"}`}>{row.name}</span>
                  <span className="w-14 text-right font-mono tnum text-[11.5px] text-warm-gray">
                    {row.wins}<span className="text-stone">–</span>{row.losses}{row.draws > 0 ? <span className="text-stone">–{row.draws}</span> : null}
                  </span>
                  <span className="w-12 text-right font-mono tnum text-[15px] font-semibold text-gold-ink whitespace-nowrap">
                    {row.points}
                    {row.comp > 0 && <span className="align-top text-[8px] font-bold text-gold-ink/70 ml-0.5">+{row.comp}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {board.some((r) => r.comp > 0) && (
            <p className="px-4 py-2 text-[10px] text-warm-gray border-t border-line">+N = points credited for rounds rested (kept fair).</p>
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
              className="w-8 h-8 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[16px] disabled:opacity-30 active:scale-95 transition-transform"
            >
              ‹
            </button>
            <p className="text-warm-gray text-[10px] font-bold uppercase tracking-[0.16em]">
              {isLive ? "Earlier" : "Round"} <span className="font-mono tnum">{activeEarlierSeq}</span> · Scores
            </p>
            <button
              onClick={() => activeEarlierIdx < earlierSeqs.length - 1 && setViewedSeq(earlierSeqs[activeEarlierIdx + 1])}
              disabled={activeEarlierIdx >= earlierSeqs.length - 1}
              aria-label="Next round"
              className="w-8 h-8 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[16px] disabled:opacity-30 active:scale-95 transition-transform"
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
