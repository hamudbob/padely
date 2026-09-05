import PageHeader from "../shell/PageHeader";
import { tap, notify } from "../../lib/nativeShell";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { getHostLiveSnapshot, HostLiveSnapshot } from "../../lib/supabase/sessionQueries";
import { generateNextRound, regenerateCurrentRound, deleteCurrentRound, swapRoundPlayers, previewRedrawRemaining, redrawRemainingRounds } from "../../lib/supabase/roundActions";
import { endSession } from "../../lib/supabase/sessionActions";
import { getSessionStandings, SessionStandings } from "../../lib/supabase/standingsQueries";
import { getRoundHistory, RoundHistoryEntry } from "../../lib/supabase/roundHistoryQueries";
import { renameCourt, setCourtAvailability, addLatePlayer, markPlayerLeft, restorePlayer, setRankingBasis } from "../../lib/supabase/manageActions";
import { listJoinRequests, confirmJoinRequest, rejectJoinRequest, JoinRequest } from "../../lib/supabase/joinRequestQueries";
import { getPendingClaims, respondPlayerClaim, PendingClaim } from "../../lib/supabase/claimQueries";
import { isAutoFillFormat, scoreRangeForFormat, validateAndDeriveScore, ScoringFormat } from "../../lib/scoring/formats";
import { isFullyPreGeneratedFormat } from "../../lib/scheduling/initialSchedule";
import {
  enqueueScore,
  subscribeSyncQueue,
  pendingCountFor,
  isOnline as syncIsOnline,
  isFlushing as syncIsFlushing,
  flushAndCount,
  getPending,
  clearPendingForSession,
} from "../../lib/supabase/scoreSyncQueue";
import { supabase } from "../../lib/supabase/client";
import { notifyLiveUpdate } from "../../lib/supabase/liveChannel";
import { SkeletonScreen, SkeletonLine, SkeletonCourts } from "../shell/Skeleton";
import { isLocalOnly } from "../../lib/offline/localSession";

/**
 * Overlays any locally-queued (not-yet-synced) scores on top of the server's
 * round history, so a score the host just entered shows instantly and survives
 * a page reload while still offline. Server data stays the source of truth;
 * this only patches matches that have a pending write waiting to upload.
 */
function overlayPendingScores(rounds: RoundHistoryEntry[], sessionId: string): RoundHistoryEntry[] {
  const pending = getPending(sessionId);
  if (pending.length === 0) return rounds;
  const byMatch = new Map(pending.map((p) => [p.matchId, p]));
  return rounds.map((round) => {
    if (!round.matches.some((m) => byMatch.has(m.id))) return round;
    return {
      ...round,
      matches: round.matches.map((m) => {
        const p = byMatch.get(m.id);
        if (!p) return m;
        const outcome =
          p.scoreA === null || p.scoreB === null
            ? m.outcome
            : p.scoreA === p.scoreB
              ? "draw"
              : p.scoreA > p.scoreB
                ? "win_a"
                : "win_b";
        return { ...m, scoreA: p.scoreA, scoreB: p.scoreB, status: "final", outcome };
      }),
    };
  });
}

type Tab = "round" | "standings";
type SortBy = "wins" | "points" | "pointAvg" | "winPct";

// The four standings views. Wins/Points are "as-played" totals (Points carries
// the neutral rest compensation); Point avg and Win % are per-game rates that
// self-normalize for uneven match counts. This is DISPLAY ONLY — it never
// affects Mexicano round generation, which always ranks by the session's own
// ranking_basis server-side.
const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "wins", label: "Wins" },
  { value: "points", label: "Points" },
  { value: "pointAvg", label: "Point avg" },
  { value: "winPct", label: "Win %" },
];
const SORT_LABELS: Record<SortBy, string> = { wins: "Wins", points: "Points", pointAvg: "Point avg", winPct: "Win %" };

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  side_americano: "Fixed Position",
  mix_mexicano: "Mix Mexicano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

const TEAM_SCORE_MODE_LABELS: Record<string, string> = {
  by_point: "Sparring by Point",
  by_win: "Sparring by Win",
  by_round: "Sparring by Round",
};

/** by_win: +1 to a side every time it wins a match (one court), across every round played so far. */
function computeByWinTally(roundHistory: RoundHistoryEntry[] | null): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const r of roundHistory ?? []) {
    for (const m of r.matches) {
      if (m.outcome === "win_a") a++;
      else if (m.outcome === "win_b") b++;
    }
  }
  return { a, b };
}

/**
 * by_round: +1 to whichever side wins the MAJORITY of courts within a
 * round. A round only counts once every match in it is Final, so the round
 * score never flips mid-round as courts finish one at a time. (by_round is
 * only selectable at session creation with an odd court count, so a round
 * always has a decisive majority — see CreateSessionPage's canUseByRound.)
 */
function computeByRoundTally(roundHistory: RoundHistoryEntry[] | null): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const r of roundHistory ?? []) {
    if (r.matches.length === 0 || r.matches.some((m) => m.status !== "final")) continue;
    let courtsA = 0;
    let courtsB = 0;
    for (const m of r.matches) {
      if (m.outcome === "win_a") courtsA++;
      else if (m.outcome === "win_b") courtsB++;
    }
    if (courtsA > courtsB) a++;
    else if (courtsB > courtsA) b++;
  }
  return { a, b };
}

/** Pure display transform: initials for a standings/podium avatar. "Adam Chen"
 * → "AC", "Hamud & Said" → "HS", "Adam" → "AD". No state, reads the name only. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s&]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Matches padel_wireframe.html screen 9 + score picker overlay, plus the
 * Standings tab (correction #7) and round navigation (correction #6: "add a
 * button to see previous rounds" — done as < / > nav over the round cards
 * rather than a separate tab, per feedback). roundHistory is fetched once
 * (most-recent-first) and viewedIndex just picks which entry to show.
 *
 * For Mexicano, index 0 is always the live/current round — that's the only
 * one that's editable and the only one the Next Round button cares about.
 * Americano is different: its whole schedule is generated up front, so
 * every round already exists in the DB and index 0 is just the last one —
 * see `fullyPreGenerated` below, which relaxes editing to any round and
 * auto-positions the view on load to the first round that's still
 * unfinished. The Matches tab (every match across the whole session, flat)
 * and Players tab (roster with matches-played/rests, computed client-side
 * from roundHistory + snapshot.roster — no extra queries) are both real now.
 * The manage menu and realtime updates are still the next build pass — this
 * refetches after every save instead of subscribing, which is correct but
 * not instant across multiple devices yet.
 */
export default function HostLivePage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("round");
  const [snapshot, setSnapshot] = useState<HostLiveSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pickerMatchId, setPickerMatchId] = useState<string | null>(null);
  const [pickerSide, setPickerSide] = useState<"A" | "B" | null>(null);
  const [pendingA, setPendingA] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [generatingRound, setGeneratingRound] = useState(false);
  const [roundError, setRoundError] = useState<unknown>(null);

  // Round-actions dropdown (Refresh / Randomize / Delete) on the live round.
  const [showRoundMenu, setShowRoundMenu] = useState(false);
  const [roundActionBusy, setRoundActionBusy] = useState(false);
  const [roundConfirm, setRoundConfirm] = useState<"refresh" | "randomize" | "delete" | null>(null);
  const [rankingBasisSaving, setRankingBasisSaving] = useState(false);

  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [endSessionError, setEndSessionError] = useState<unknown>(null);

  const [showManage, setShowManage] = useState(false);
  const [showMenu, setShowMenu] = useState(false); // header overflow (⋯) dropdown → Manage / End
  const [manageError, setManageError] = useState<unknown>(null);
  // Which unplayed rounds a redraw would replace — loaded when the Manage
  // panel opens so the button can name them before it's tapped.
  const [redrawPreview, setRedrawPreview] = useState<{ fromSequence: number; toSequence: number; rounds: number } | null>(null);
  const [redrawing, setRedrawing] = useState(false);
  const [redrawNote, setRedrawNote] = useState<string | null>(null);
  const [manageSaving, setManageSaving] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerGender, setNewPlayerGender] = useState<"M" | "F">("M");
  const [newPlayerTeamSide, setNewPlayerTeamSide] = useState<"A" | "B">("A");

  // Self-service join requests (players who scanned the QR / entered the code).
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [joinBusyId, setJoinBusyId] = useState<string | null>(null);

  const [claims, setClaims] = useState<PendingClaim[]>([]);
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [standings, setStandings] = useState<SessionStandings | null>(null);
  const [standingsError, setStandingsError] = useState<unknown>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy | null>(null); // null = follow session's ranking_basis until the host picks
  const [showSortMenu, setShowSortMenu] = useState(false);

  const [roundHistory, setRoundHistory] = useState<RoundHistoryEntry[] | null>(null);
  const [roundHistoryError, setRoundHistoryError] = useState<unknown>(null);
  // roundHistory is sorted most-recent-first (see getRoundHistory), so index
  // 0 = the live/current round for Mexicano. < moves to an OLDER round
  // (index+1), > moves back toward index 0 (index-1). Americano is
  // different: its whole schedule is pre-generated, so index 0 is just the
  // LAST round of the schedule, not necessarily the one being played — see
  // the auto-positioning effect below.
  const [viewedIndex, setViewedIndex] = useState(0);
  const [hasAutoPositioned, setHasAutoPositioned] = useState(false);

  // --- Offline-first score sync ---
  // hostUserId is fetched once so saving a score needs zero network in the hot
  // path (submitMatchScore needs the editor's auth id). syncPending/Online/
  // Flushing drive the little status pill and gate the Next Round button.
  const [hostUserId, setHostUserId] = useState("");
  // Owner-only lineup editing (0033) — a private backdoor gated to one account.
  const [isOwner, setIsOwner] = useState(false);
  const [editLineup, setEditLineup] = useState(false);
  const [swapSel, setSwapSel] = useState<string | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [syncPending, setSyncPending] = useState(0);
  const [syncOnline, setSyncOnline] = useState(syncIsOnline());
  const [syncFlushing, setSyncFlushing] = useState(syncIsFlushing());
  const prevPendingRef = useRef(0);

  function load() {
    if (!sessionId) return;
    getHostLiveSnapshot(sessionId)
      .then((snap) => {
        // An ended session has one home, and it isn't this screen. Everything
        // this page still offered once the scores were locked — the board, every
        // round — the podium either shows or links to, and it's the page players
        // and shared links land on too. `replace` so Back doesn't bounce here
        // and immediately forward again.
        if (snap?.session.status === "ended") {
          // Same reason as in the end handler: no server session, no podium.
          // Without this the screen would bounce a local ended session into a
          // page that cannot load, and the back button would bounce it
          // straight back — a loop with no exit.
          navigate(isLocalOnly(sessionId) ? "/play" : `/session/${sessionId}/final`, { replace: true });
          return;
        }
        setSnapshot(snap);
      })
      .catch((err) => setError(withFallback(err, "Could not load this session.")));
  }

  function loadStandings() {
    if (!sessionId) return;
    setStandingsLoading(true);
    setStandingsError(null);
    getSessionStandings(sessionId)
      .then(setStandings)
      .catch((err) => setStandingsError(withFallback(err, "Could not load standings.")))
      .finally(() => setStandingsLoading(false));
  }

  function loadRoundHistory() {
    if (!sessionId) return;
    setRoundHistoryError(null);
    getRoundHistory(sessionId)
      // Overlay any locally-queued scores so an unsynced entry never visually
      // disappears when the server round history reloads.
      .then((rounds) => setRoundHistory(overlayPendingScores(rounds, sessionId)))
      .catch((err) => setRoundHistoryError(withFallback(err, "Could not load rounds.")));
  }

  useEffect(load, [sessionId]);
  useEffect(loadRoundHistory, [sessionId]);

  // Cache the host's auth id once so saving a score touches no network.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setHostUserId(data.user?.id ?? "");
      setIsOwner((data.user?.email ?? "") === "hamudbob@yahoo.com");
    });
  }, []);

  // Mirror the sync queue into local state for the status pill + Next Round
  // gating, and — when the queue fully drains — pull the server's authoritative
  // rows back in to replace the optimistic overlay.
  useEffect(() => {
    if (!sessionId) return;
    function onSyncChange() {
      const count = pendingCountFor(sessionId!);
      setSyncPending(count);
      setSyncOnline(syncIsOnline());
      setSyncFlushing(syncIsFlushing());
      if (prevPendingRef.current > 0 && count === 0) {
        load();
        loadRoundHistory();
        loadStandings();
      }
      prevPendingRef.current = count;
    }
    onSyncChange();
    return subscribeSyncQueue(onSyncChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Refresh the pending self-service join list whenever the Manage panel opens.
  useEffect(() => {
    if (showManage) loadJoinRequests();
    if (showManage && sessionId) {
      previewRedrawRemaining(sessionId).then(setRedrawPreview).catch(() => setRedrawPreview(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showManage, sessionId]);

  // Poll pending "claim your spot" requests while the session is live so the
  // host sees them arrive without refreshing.
  useEffect(() => {
    if (!sessionId || snapshot?.session.status === "ended") return;
    loadClaims();
    const t = window.setInterval(loadClaims, 10000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, snapshot?.session.status]);
  useEffect(() => {
    // Team Sparring also needs standings loaded on the Rounds tab, not just
    // Standings — the Team A vs Team B scoreboard banner is visible there
    // too, since that running score is the whole point of the format.
    if (tab === "standings" || snapshot?.session.format === "team_sparring") loadStandings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sessionId, snapshot?.session.format]);

  // Americano and Team Sparring both generate their whole schedule up front,
  // so roundHistory[0] (highest sequence) isn't "the round being played" the
  // way it is for Mexicano — it's just the last round of the schedule. On
  // first load, jump to whichever round still has an unfinished match (the
  // natural "next thing to score"); if every round is already scored, stay
  // put on the last one. Runs once per page load, not on every refetch.
  useEffect(() => {
    if (hasAutoPositioned) return;
    if (!snapshot || !roundHistory) return;
    const isFullyPreGenerated = isFullyPreGeneratedFormat(snapshot.session.format, snapshot.session.fixedPartnerStyle);
    if (!isFullyPreGenerated) {
      setHasAutoPositioned(true);
      return;
    }
    let target = 0;
    for (let i = roundHistory.length - 1; i >= 0; i--) {
      const r = roundHistory[i];
      if (r.matches.length === 0 || r.matches.some((m) => m.status !== "final")) {
        target = i;
        break;
      }
    }
    setViewedIndex(target);
    setHasAutoPositioned(true);
  }, [snapshot, roundHistory, hasAutoPositioned]);

  if (error) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-4 py-8 safe-top">
        <ErrorNote error={error} where="HostLivePage.load" />
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-4 py-8 safe-top">
        <SkeletonScreen label="Loading this session">
          <SkeletonLine w="62%" h={26} />
          <div className="mt-2 mb-5"><SkeletonLine w="44%" h={11} /></div>
          <div className="skeleton h-[46px] rounded-full mb-6" />
          <SkeletonCourts n={3} />
        </SkeletonScreen>
      </div>
    );
  }

  const format = snapshot.session.scoringFormat as ScoringFormat;
  const autoFill = isAutoFillFormat(format);
  const range = scoreRangeForFormat(format);

  const sessionEnded = snapshot.session.status === "ended";
  // Americano and Team Sparring both generate their whole schedule at
  // session start — every round already exists in the DB, so there's no
  // single "current" round the way Mexicano has one; any not-yet-ended
  // round can be scored in any order.
  // Americano, Team Sparring, Mix Americano, and Fixed Partner's round_robin
  // flavor (Americano base) all generate their whole schedule at session
  // start (none of their pairing depends on scores). Mexicano, Mix Mexicano,
  // and Fixed Partner's rank_based flavor (Mexicano base) stay round-by-round
  // — their pairing needs live standings that don't exist until a round is
  // scored.
  // Single source of truth — see initialSchedule.ts. Adding a format to the
  // scheduler used to mean remembering to add it here too, in two places; it
  // didn't happen for Fixed Position, and every round but the last silently
  // refused to open the score picker.
  const fullyPreGenerated = isFullyPreGeneratedFormat(snapshot.session.format, snapshot.session.fixedPartnerStyle);
  const isTeamSparring = snapshot.session.format === "team_sparring";
  // Manage menu only — Fixed Partner blocks adding a player mid-session,
  // since a locked-pairs format has nobody for a newcomer to be paired with.
  const isFixedPartner = snapshot.session.fixedPartnerStyle !== null || snapshot.session.format === "fixed_partner";
  const teamScoreMode = snapshot.session.teamScoreMode ?? "by_point";

  // Team Sparring's headline feature: a running Team A vs Team B score.
  // Three ways to tally it, chosen at session creation (see
  // CreateSessionPage's "Team score" picker):
  //   by_point — sum of every player's own scored points/games per side,
  //              from the same standings rows the Standings tab uses
  //              (StandingsRow.teamSide) — never a second source of truth.
  //   by_win   — a running count of matches (courts) won per side.
  //   by_round — a running count of ROUNDS won per side (majority of
  //              courts in that round), computed straight from roundHistory.
  const teamTotals = isTeamSparring
    ? teamScoreMode === "by_point"
      ? standings
        ? standings.rows.reduce(
            (acc, row) => {
              if (row.teamSide === "A") acc.a += row.totalPoints;
              else if (row.teamSide === "B") acc.b += row.totalPoints;
              return acc;
            },
            { a: 0, b: 0 },
          )
        : null
      : teamScoreMode === "by_win"
        ? computeByWinTally(roundHistory)
        : computeByRoundTally(roundHistory)
    : null;

  const safeIndex = roundHistory ? Math.min(viewedIndex, Math.max(0, roundHistory.length - 1)) : 0;
  const viewedRound = roundHistory?.[safeIndex] ?? null;
  const isViewingCurrent = safeIndex === 0;
  // Any round of a live session can be corrected, in every format.
  //
  // This used to lock Mexicano history to the current round, on the reasoning
  // that a Mexicano round is drawn from the standings and so an old score
  // "belongs" to the pairings that came after it. That reasoning is wrong in
  // practice. A wrong score is wrong; refusing to fix it doesn't restore the
  // pairings that would have happened, it just leaves the board lying for the
  // rest of the night — and the host is standing on a court with people
  // waiting, which is the worst possible moment to be told no.
  //
  // Editing an old score does NOT regenerate anything. Rounds are stored rows;
  // they stay exactly as they were played. The standings recompute from the
  // match scores, and the NEXT round the host asks for is drawn from the
  // corrected board. That is the behaviour Americano has always had, and there
  // was never a good reason for Mexicano to differ.
  //
  // An ended session stays locked in both families — that's where results and
  // ratings have already been applied downstream.
  const canEdit = !sessionEnded;
  const canGoOlder = !!roundHistory && safeIndex < roundHistory.length - 1;
  const canGoNewer = safeIndex > 0;

  // Owner-only lineup swap: available only while NO score has been entered
  // anywhere in the session. `lineupChips` are the viewed round's players
  // (on court + resting) as tappable swap targets.
  const anyScored = !!roundHistory?.some((r) => r.matches.some((m) => m.status === "final" || m.scoreA !== null || m.scoreB !== null));
  const canOwnerEdit = isOwner && !sessionEnded && !anyScored;
  const lineupChips: { id: string; name: string; resting: boolean }[] = viewedRound
    ? [
        ...viewedRound.matches.flatMap((m) => [
          ...m.teamAIds.map((id, i) => ({ id, name: m.teamANames[i] ?? "?", resting: false })),
          ...m.teamBIds.map((id, i) => ({ id, name: m.teamBNames[i] ?? "?", resting: false })),
        ]),
        ...viewedRound.restingIds.map((id, i) => ({ id, name: viewedRound.restingNames[i] ?? "?", resting: true })),
      ]
    : [];

  async function onSwapChip(playerId: string) {
    if (!viewedRound) return;
    if (swapSel === null) {
      setSwapSel(playerId);
      return;
    }
    if (swapSel === playerId) {
      setSwapSel(null);
      return;
    }
    const a = swapSel;
    setSwapBusy(true);
    setSaveError(null);
    try {
      await swapRoundPlayers(viewedRound.roundId, a, playerId);
      setSwapSel(null);
      load();
      loadRoundHistory();
      if (sessionId) notifyLiveUpdate(sessionId);
    } catch (e) {
      setSaveError(withFallback(e, "Couldn't swap those players."));
    } finally {
      setSwapBusy(false);
    }
  }

  const activeMatch = viewedRound?.matches.find((m) => m.id === pickerMatchId) ?? null;

  // correction #6: Next Round only unlocks once every match in the CURRENT
  // round is Final — this always checks roundHistory[0], never whichever
  // round the host happens to be browsing.
  const currentRound = roundHistory?.[0] ?? null;
  const allMatchesFinal = !!currentRound && currentRound.matches.length > 0 && currentRound.matches.every((m) => m.status === "final");

  // Presentation-only derived boolean (approved V2 A.1 next-round relocation):
  // exactly the condition the old bottom Next-Round / Add-Another-Round buttons
  // used to gate on. Decides whether the round-nav header shows the outline
  // "Round N ›" pill (fires the SAME handleNextRound) vs. a history-forward
  // chip. Pure expression over existing values — no new state/handler/fetch.
  // Both branches check isViewingCurrent now. The Mexicano branch used to lean
  // on canEdit implying it — with history editable, leaning on it would offer
  // "next round" while the host is browsing round 2 of 8.
  const advanceAvailable = canEdit && isViewingCurrent && allMatchesFinal;

  // Round actions (Refresh / Randomize / Delete) only apply to the LIVE round
  // of a round-by-round (Mexicano-family) session, and only once there's a
  // prior round to fall back to — pre-generated formats (Americano etc.) draw
  // their whole schedule up front, so redrawing a single round mid-schedule
  // isn't a meaningful operation there.
  const roundActionsAvailable =
    !fullyPreGenerated && isViewingCurrent && canEdit && !sessionEnded && (roundHistory?.length ?? 0) > 1;

  // The rank BADGE always reflects the session's official ranking_basis
  // (points_first/wins_first — set at session creation and used for the
  // real placement). The sort toggle only changes viewing ORDER, so the
  // host can check "who has the most wins" without changing anyone's
  // official rank.
  const effectiveSortBy: SortBy = sortBy ?? (standings?.rankingBasis === "wins_first" ? "wins" : "points");
  const sortedStandingsRows = standings
    ? [...standings.rows].sort((a, b) => {
        switch (effectiveSortBy) {
          case "wins":
            return b.wins - a.wins || b.compensatedPoints - a.compensatedPoints;
          case "points":
            return b.compensatedPoints - a.compensatedPoints || b.wins - a.wins;
          case "pointAvg":
            return b.pointAvg - a.pointAvg || b.matchesPlayed - a.matchesPlayed || b.totalPoints - a.totalPoints;
          case "winPct":
            return b.winPct - a.winPct || b.matchesPlayed - a.matchesPlayed || b.wins - a.wins;
          default:
            return 0;
        }
      })
    : [];

  // --- Standings table shape ---
  // Ties (T) are only possible — and only shown — for best-of-4-games, the one
  // format whose fixed sum is even (2–2). The W and PTS columns double as the
  // rate columns: sorting by Win % turns W into "Win%", sorting by Point avg
  // turns PTS into "PTS%". The active sort's column is emphasized.
  const showTies = format === "fixed_4_games";
  const wActive = effectiveSortBy === "wins" || effectiveSortBy === "winPct";
  const ptsActive = effectiveSortBy === "points" || effectiveSortBy === "pointAvg";
  const wHeader = effectiveSortBy === "winPct" ? "Win%" : "W";
  const ptsHeader = effectiveSortBy === "pointAvg" ? "PTS%" : "PTS";
  const standingsGridCols = [
    "1.4rem", // #
    "minmax(0,1fr)", // Name
    "2.9rem", // GP (+ compensation)
    effectiveSortBy === "winPct" ? "2.7rem" : "1.8rem", // W / Win%
    "1.6rem", // L
    showTies ? "1.5rem" : null, // T
    effectiveSortBy === "pointAvg" ? "2.9rem" : "2.7rem", // PTS / PTS%
  ]
    .filter(Boolean)
    .join(" ");

  function goOlder() {
    if (canGoOlder) setViewedIndex((i) => i + 1);
  }
  function goNewer() {
    if (canGoNewer) setViewedIndex((i) => Math.max(0, i - 1));
  }

  function openPicker(matchId: string, side: "A" | "B") {
    if (!canEdit) return; // an ended session is read-only; a live one is editable in any round
    // Fixed-sum formats now accept a tap on EITHER side — the other auto-fills
    // as (total − this score), so the host can enter whichever number they saw.
    setPickerMatchId(matchId);
    setPickerSide(side);
    setPendingA(null);
    setSaveError(null);
  }

  function closePicker() {
    setPickerMatchId(null);
    setPickerSide(null);
    setPendingA(null);
  }

  async function pickNumber(value: number) {
    if (!activeMatch || !pickerSide) return;
    void tap("light"); // a real Taptic tap on a phone; navigator.vibrate elsewhere

    // Fixed-sum formats: one tap on EITHER side is enough — the other side is
    // (total − this score). Tapping Team A sets A; tapping Team B sets B.
    if (autoFill) {
      const other = range.max - value;
      if (pickerSide === "A") await save(activeMatch.id, value, other);
      else await save(activeMatch.id, other, value);
      return;
    }

    // Two-number formats: capture Team A first, then prompt for Team B —
    // the modal switches (not closes) so the host can enter both numbers
    // without re-opening it, hence the "now entering ..." banner below.
    if (pickerSide === "A") {
      setPendingA(value);
      setPickerSide("B");
      return;
    }
    // pickerSide === "B" with a two-number format
    await save(activeMatch.id, pendingA, value);
  }

  function save(matchId: string, scoreA: number | null, scoreB: number | null) {
    if (!sessionId) return;
    // Validate + derive locally (pure, no network) so we can show the exact
    // final score/outcome instantly — including Team B for race/fixed formats.
    const validation = validateAndDeriveScore(format, { scoreA, scoreB });
    if (!validation.valid) {
      setSaveError(validation.error ?? "Invalid score.");
      return;
    }
    const finalB = validation.derivedScoreB ?? scoreB;
    if (finalB === null || finalB === undefined) {
      setSaveError("Enter both teams' scores.");
      return;
    }
    setSaveError(null);

    // Optimistic UI: patch the match in place so the score appears the instant
    // the host taps — no spinner, no waiting on the network, even fully offline.
    setRoundHistory((prev) =>
      prev
        ? prev.map((round) =>
            round.matches.some((m) => m.id === matchId)
              ? {
                  ...round,
                  matches: round.matches.map((m) =>
                    m.id === matchId
                      ? { ...m, scoreA, scoreB: finalB, status: "final", outcome: validation.outcome ?? m.outcome }
                      : m,
                  ),
                }
              : round,
          )
        : prev,
    );
    void tap("medium"); // the score landed
    closePicker();

    // Hand off to the background sync queue (persists to localStorage + uploads
    // when there's signal). The queue subscription reconciles with the server
    // once it drains.
    enqueueScore({ sessionId, matchId, format, scoreA, scoreB: finalB, editedBy: hostUserId });
  }

  async function handleNextRound() {
    if (!sessionId) return;
    setGeneratingRound(true);
    setRoundError(null);
    try {
      // A session started with no signal draws its next round from the LOCAL
      // rows, and those already carry every score the host has entered — so
      // there is nothing to wait for and this gate must not apply.
      //
      // Applying it was worse than merely unnecessary: for a local session
      // the queued scores CANNOT sync until the session itself does, so the
      // count never reaches zero and the host is told to reconnect in order
      // to continue a session that was designed to need no connection. A
      // dead end, on a court, mid-evening.
      if (!isLocalOnly(sessionId)) {
        // Online sessions still wait. The pairings are computed FROM the
        // scores, and the rows the generator reads are the server's — so
        // advancing with scores still queued would draw from stale data.
        const remaining = await flushAndCount(sessionId);
        if (remaining > 0) {
          setRoundError(
            `Waiting to sync ${remaining} score${remaining > 1 ? "s" : ""} — reconnect to the internet to start the next round.`,
          );
          void notify("warning"); // refused, and the host may not be looking at the screen
          return;
        }
      }
      await generateNextRound(sessionId);
      setViewedIndex(0); // jump to the newly created current round
      load();
      loadRoundHistory();
      if (tab === "standings" || isTeamSparring) loadStandings();
      notifyLiveUpdate(sessionId); // push the new round to spectators
      void tap("medium"); // a new round exists — the biggest thing this screen does
    } catch (err) {
      setRoundError(withFallback(err, "Could not generate the next round."));
    } finally {
      setGeneratingRound(false);
    }
  }

  // --- Round actions (Refresh / Randomize / Delete) ---
  // All three throw away the current round, so any scores queued offline for it
  // must be dropped first (their matches are about to be deleted). Refresh and
  // Randomize both redraw the round; Delete drops back to the previous one.
  async function runRoundAction(kind: "refresh" | "randomize" | "delete") {
    if (!sessionId) return;
    setRoundActionBusy(true);
    setRoundError(null);
    setRoundConfirm(null);
    setShowRoundMenu(false);
    try {
      clearPendingForSession(sessionId);
      if (kind === "delete") {
        await deleteCurrentRound(sessionId);
      } else {
        await regenerateCurrentRound(sessionId, { randomize: kind === "randomize" });
      }
      setViewedIndex(0);
      load();
      loadRoundHistory();
      loadStandings();
      notifyLiveUpdate(sessionId); // push the redrawn/deleted round to spectators
    } catch (err) {
      setRoundError(withFallback(err, "Could not update the round."));
    } finally {
      setRoundActionBusy(false);
    }
  }

  // Delete always confirms; Refresh/Randomize confirm only when they'd discard
  // scores already entered in the current round.
  function onRoundAction(kind: "refresh" | "randomize" | "delete") {
    setShowRoundMenu(false);
    const currentHasScores = !!currentRound && currentRound.matches.some((m) => m.status === "final");
    if (kind === "delete" || currentHasScores) setRoundConfirm(kind);
    else runRoundAction(kind);
  }

  function loadJoinRequests() {
    if (!sessionId) return;
    listJoinRequests(sessionId)
      .then(setJoinRequests)
      .catch(() => setJoinRequests([]));
  }

  async function handleConfirmJoin(request: JoinRequest) {
    if (!sessionId) return;
    setJoinBusyId(request.id);
    setManageError(null);
    try {
      await confirmJoinRequest(sessionId, request);
      loadJoinRequests();
      load(); // roster now includes the new player
      notifyLiveUpdate(sessionId); // spectators see the new player on the board
    } catch (err) {
      setManageError(withFallback(err, "Could not add that player."));
    } finally {
      setJoinBusyId(null);
    }
  }

  async function handleRejectJoin(requestId: string) {
    setJoinBusyId(requestId);
    setManageError(null);
    try {
      await rejectJoinRequest(requestId);
      loadJoinRequests();
    } catch (err) {
      setManageError(withFallback(err, "Could not decline that request."));
    } finally {
      setJoinBusyId(null);
    }
  }

  function loadClaims() {
    if (!sessionId) return;
    getPendingClaims(sessionId)
      .then(setClaims)
      .catch(() => setClaims([]));
  }

  async function respondClaim(claimId: string, accept: boolean) {
    if (!sessionId) return;
    setClaimBusyId(claimId);
    try {
      await respondPlayerClaim(claimId, accept);
      setClaims((cs) => cs.filter((c) => c.id !== claimId));
      loadClaims();
      if (accept) {
        load(); // the claimed spot is now renamed to the real player
        loadStandings();
        notifyLiveUpdate(sessionId); // spectators see the renamed player
      }
    } catch {
      loadClaims();
    } finally {
      setClaimBusyId(null);
    }
  }

  async function handleCopyJoinLink() {
    const link = `${window.location.origin}/join?code=${snapshot?.session.joinCode ?? ""}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      /* clipboard may be unavailable — the code is shown as a fallback */
    }
  }

  async function handleSetRankingBasis(basis: "points_first" | "wins_first") {
    if (!sessionId) return;
    setRankingBasisSaving(true);
    setManageError(null);
    try {
      await setRankingBasis(sessionId, basis);
      load();
    } catch (err) {
      setManageError(withFallback(err, "Could not change the ranking basis."));
    } finally {
      setRankingBasisSaving(false);
    }
  }

  async function handleRenameCourt(courtId: string, name: string) {
    setManageError(null);
    try {
      await renameCourt(courtId, name);
      load();
    } catch (err) {
      setManageError(withFallback(err, "Could not rename court."));
    }
  }

  async function handleToggleCourtAvailability(courtId: string, available: boolean) {
    setManageError(null);
    try {
      await setCourtAvailability(courtId, available);
      load();
    } catch (err) {
      setManageError(withFallback(err, "Could not update court."));
    }
  }

  async function handleAddPlayer() {
    if (!sessionId) return;
    setManageSaving(true);
    setManageError(null);
    try {
      await addLatePlayer({
        sessionId,
        name: newPlayerName,
        gender: newPlayerGender,
        teamSide: isTeamSparring ? newPlayerTeamSide : undefined,
      });
      setNewPlayerName("");
      load();
    } catch (err) {
      setManageError(withFallback(err, "Could not add player."));
    } finally {
      setManageSaving(false);
    }
  }

  async function handleMarkLeft(playerId: string) {
    setManageError(null);
    try {
      await markPlayerLeft(playerId);
      load();
    } catch (err) {
      setManageError(withFallback(err, "Could not update player."));
    }
  }

  async function handleRedraw() {
    if (!sessionId || !redrawPreview) return;
    const { fromSequence: from, toSequence: to } = redrawPreview;
    const which = from === to ? `round ${from}` : `rounds ${from}–${to}`;
    if (!confirm(`Redraw ${which} from the players still in? Rounds already played are untouched.`)) return;
    setRedrawing(true);
    setManageError(null);
    setRedrawNote(null);
    try {
      const result = await redrawRemainingRounds(sessionId);
      setRedrawNote(
        `${result.rounds === 1 ? "Round" : "Rounds"} ${
          result.fromSequence === result.toSequence ? result.fromSequence : `${result.fromSequence}–${result.toSequence}`
        } redrawn for ${result.players} players.`,
      );
      load();
      loadRoundHistory();
      setRedrawPreview(await previewRedrawRemaining(sessionId));
    } catch (err) {
      setManageError(withFallback(err, "Could not redraw the remaining rounds."));
    } finally {
      setRedrawing(false);
    }
  }

  async function handleRestorePlayer(playerId: string) {
    setManageError(null);
    try {
      await restorePlayer(playerId);
      load();
    } catch (err) {
      setManageError(withFallback(err, "Could not update player."));
    }
  }

  async function handleEndSession() {
    if (!sessionId) return;
    setEndingSession(true);
    setEndSessionError(null);
    try {
      const wasLocal = isLocalOnly(sessionId);
      await endSession(sessionId);
      setShowEndConfirm(false);

      if (wasLocal) {
        // The podium is built by get_public_session_by_id — a server RPC — so
        // a session that hasn't synced has no podium to show yet. Sending the
        // host there anyway is what produced an error screen with no way back
        // to a session they had just correctly ended.
        //
        // Home instead. The session IS ended, it uploads itself, and the
        // podium is waiting in their history once it has. Losing the flourish
        // on a dead court is a fair trade for not losing the way out.
        navigate("/play", { replace: true });
        return;
      }

      notifyLiveUpdate(sessionId); // flip any watchers to the final/ended view
      navigate(`/session/${sessionId}/final`); // straight to the podium; rounds/standings stay reachable from there
    } catch (err) {
      setEndSessionError(withFallback(err, "Could not end this session."));
    } finally {
      setEndingSession(false);
    }
  }

  const activeSideNames =
    activeMatch && pickerSide ? (pickerSide === "A" ? activeMatch.teamANames : activeMatch.teamBNames).join(" & ") : "";
  const otherSideNames =
    activeMatch && pickerSide ? (pickerSide === "A" ? activeMatch.teamBNames : activeMatch.teamANames).join(" & ") : "";

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-4 safe-top safe-bottom relative anim-fade">
      {/* Top bar: back + wordmark + overflow menu. The wordmark matters more
          here than anywhere — this screen has no tab bar (it's a task, and
          leaving mid-round is a hazard), so it's the only thing on screen
          telling you which app you're in, and it doubles as the way out. */}
      <PageHeader
        className="mb-3"
        fallback="/play"
        trailing={
          sessionEnded ? undefined : (
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                aria-label="Session menu"
                className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
                </svg>
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} aria-hidden />
                  <div className="absolute right-0 top-11 z-50 w-48 rounded-2xl border border-line bg-surface shadow-[0_20px_44px_-16px_rgba(13,13,13,0.35)] overflow-hidden">
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        setShowManage(true);
                      }}
                      className="w-full text-left px-4 py-3 text-[13px] font-semibold text-ink active:bg-surface-2"
                    >
                      Manage session
                    </button>
                    <div className="h-px bg-line" />
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        setShowEndConfirm(true);
                      }}
                      className="w-full text-left px-4 py-3 text-[13px] font-semibold text-loss active:bg-surface-2"
                    >
                      End session
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        }
      />

      {/* Session title + status */}
      <div className="flex items-center gap-2.5 mb-1">
        <h1 className="font-serif text-[24px] font-semibold text-graphite tracking-tight leading-tight truncate">{snapshot.session.name}</h1>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold rounded-full px-2.5 py-1 ${
            sessionEnded ? "bg-surface-2 text-warm-gray border border-line" : "bg-graphite text-ivory"
          }`}
        >
          {!sessionEnded && <span className="w-1.5 h-1.5 rounded-full bg-court-lime" aria-hidden />}
          {snapshot.session.status.toUpperCase()}
        </span>
      </div>
      <p className="text-[12px] text-warm-gray mb-4">
        {FORMAT_LABELS[snapshot.session.format] ?? snapshot.session.format}
        {snapshot.session.fixedPartnerStyle ? " · Fixed Partner" : ""} · Code <span className="font-mono tnum">{snapshot.session.joinCode}</span>
      </p>

      {/* Claim requests — late joiners taking over a manual spot */}
      {!sessionEnded && claims.length > 0 && (
        <div className="mb-4 rounded-2xl bg-gold-soft/60 border border-gold/25 overflow-hidden">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-ink px-3.5 pt-2.5 pb-1">
            Claim {claims.length === 1 ? "request" : "requests"}
          </p>
          {claims.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 px-3.5 py-2.5 border-t border-gold/15">
              <span className="w-[30px] h-[30px] rounded-full bg-graphite text-ivory flex items-center justify-center text-[12px] font-semibold overflow-hidden shrink-0">
                {c.claimantAvatar ? <img src={c.claimantAvatar} alt="" className="w-full h-full object-cover" /> : c.claimantName.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0 text-[13px] text-graphite leading-tight">
                <b className="font-semibold">{c.claimantName}</b>
                <span className="text-warm-gray"> is </span>
                <b className="font-semibold">{c.playerName}</b>
              </span>
              <button
                onClick={() => respondClaim(c.id, true)}
                disabled={claimBusyId === c.id}
                className="shrink-0 rounded-full bg-graphite text-ivory text-[11.5px] font-semibold px-3 py-1.5 disabled:opacity-40"
              >
                Accept
              </button>
              <button
                onClick={() => respondClaim(c.id, false)}
                disabled={claimBusyId === c.id}
                className="shrink-0 text-[11.5px] font-semibold text-warm-gray px-1"
              >
                Decline
              </button>
            </div>
          ))}
        </div>
      )}

      {isTeamSparring && teamTotals && (
        <div className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray text-center mb-1">
            Team Score · {TEAM_SCORE_MODE_LABELS[teamScoreMode] ?? teamScoreMode}
          </p>
          <div className="flex items-center justify-center gap-4">
            <div className="text-center flex-1">
              <p className="text-[10px] font-bold text-graphite">TEAM A</p>
              <p className="font-mono tnum text-3xl text-graphite">{teamTotals.a}</p>
            </div>
            <span className="text-warm-gray font-mono text-sm">vs</span>
            <div className="text-center flex-1">
              <p className="text-[10px] font-bold text-gold-ink">TEAM B</p>
              <p className="font-mono tnum text-3xl text-graphite">{teamTotals.b}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex rounded-full bg-surface border border-line p-1 mb-4">
        <button
          onClick={() => setTab("round")}
          className={`flex-1 rounded-full py-2 text-[13px] font-semibold ${tab === "round" ? "bg-graphite text-ivory" : "text-warm-gray"}`}
        >
          Rounds
        </button>
        <button
          onClick={() => setTab("standings")}
          className={`flex-1 rounded-full py-2 text-[13px] font-semibold ${tab === "standings" ? "bg-graphite text-ivory" : "text-warm-gray"}`}
        >
          Standings
        </button>
      </div>

      {tab === "round" && (
        <>
          <ErrorNote error={roundHistoryError} where="HostLivePage.rounds" />

          {!roundHistory && !roundHistoryError && (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-24 rounded-2xl skeleton" />
              ))}
            </div>
          )}

          {viewedRound && (
            <>
              {/* Round navigator (prototype .roundnav) */}
              <div className="flex items-center gap-2 mb-3.5">
                <button
                  onClick={goOlder}
                  disabled={!canGoOlder}
                  aria-label="Previous round"
                  className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ‹
                </button>
                <div className="flex-1 text-center min-w-0">
                  <b className="font-serif text-[16px] font-semibold text-graphite">Round <span className="font-mono tnum">{viewedRound.sequence}</span></b>
                  <span className={`block text-[10px] mt-0.5 ${advanceAvailable ? "text-win font-semibold" : "text-warm-gray"}`}>
                    {advanceAvailable
                      ? "All scored — tap › for the next round"
                      : fullyPreGenerated
                        ? `Round ${viewedRound.sequence} of ${roundHistory?.length ?? viewedRound.sequence}${
                            sessionEnded ? " · session ended" : ""
                          }`
                        : isViewingCurrent && !sessionEnded
                          ? "Current round"
                          : isViewingCurrent && sessionEnded
                            ? "Final round · session ended"
                            : `Viewing history${viewedRound.status === "scored" ? " · scored" : ""}`}
                  </span>
                </div>
                {/* Fixed-size forward control so the centered "Round N" never shifts.
                    When the round is fully scored it lights up (graphite fill, gold
                    arrow) and advances; otherwise it browses newer history. */}
                <button
                  onClick={advanceAvailable ? handleNextRound : goNewer}
                  disabled={advanceAvailable ? generatingRound : !canGoNewer}
                  aria-label={advanceAvailable ? "Start next round" : "Next round"}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-[17px] shrink-0 transition-colors ${
                    advanceAvailable
                      ? "bg-graphite text-gold disabled:opacity-40"
                      : `bg-surface border border-line text-ink-2 ${!canGoNewer ? "opacity-30 cursor-not-allowed" : ""}`
                  }`}
                >
                  ›
                </button>
              </div>

              {/* Round options — redraw or delete the live round */}
              {roundActionsAvailable && (
                <div className="relative mb-4 flex justify-end">
                  <button
                    onClick={() => setShowRoundMenu((v) => !v)}
                    disabled={roundActionBusy}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {roundActionBusy ? "Working…" : "Round options"}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-warm-gray">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {showRoundMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowRoundMenu(false)} aria-hidden />
                      <div className="absolute right-0 top-10 z-50 w-64 rounded-2xl border border-line bg-surface shadow-[0_20px_44px_-16px_rgba(13,13,13,0.35)] overflow-hidden">
                        <button onClick={() => onRoundAction("refresh")} className="w-full text-left px-4 py-3 active:bg-surface-2">
                          <span className="block text-[13px] font-semibold text-ink">Refresh round</span>
                          <span className="block text-[11px] text-warm-gray mt-0.5 leading-snug">Re-draw with the current players — use after marking someone left.</span>
                        </button>
                        <div className="h-px bg-line" />
                        <button onClick={() => onRoundAction("randomize")} className="w-full text-left px-4 py-3 active:bg-surface-2">
                          <span className="block text-[13px] font-semibold text-ink">Randomize</span>
                          <span className="block text-[11px] text-warm-gray mt-0.5 leading-snug">Shuffle a fresh draw — the least-played still get on court, just mixed up.</span>
                        </button>
                        <div className="h-px bg-line" />
                        <button onClick={() => onRoundAction("delete")} className="w-full text-left px-4 py-3 active:bg-surface-2">
                          <span className="block text-[13px] font-semibold text-loss">Delete round</span>
                          <span className="block text-[11px] text-warm-gray mt-0.5 leading-snug">Remove this round and go back to the previous one.</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Match blocks (prototype .cmatch) — score tiles floating over a names card */}
              {viewedRound.matches.map((m) => (
                <div key={m.id} className="mb-6">
                  <div className="text-right text-[13px] font-semibold text-warm-gray mb-2.5">{m.courtName}</div>
                  <div className="flex justify-center gap-3 relative z-[2] -mb-6">
                    <button
                      onClick={() => openPicker(m.id, "A")}
                      disabled={!canEdit}
                      className={`relative w-[62px] h-[54px] rounded-[14px] bg-graphite flex items-center justify-center font-mono tnum text-[25px] font-bold shadow-[0_9px_20px_-13px_rgba(13,13,13,0.5)] disabled:cursor-default ${
                        m.scoreA === null ? "text-stone" : "text-ivory"
                      }`}
                    >
                      {m.status === "final" && m.scoreA !== null && m.scoreB !== null && m.scoreA > m.scoreB && (
                        <span aria-hidden className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-gold" />
                      )}
                      {m.scoreA ?? "–"}
                    </button>
                    <button
                      onClick={() => openPicker(m.id, "B")}
                      disabled={!canEdit}
                      className={`relative w-[62px] h-[54px] rounded-[14px] bg-graphite flex items-center justify-center font-mono tnum text-[25px] font-bold shadow-[0_9px_20px_-13px_rgba(13,13,13,0.5)] disabled:cursor-default ${
                        m.scoreB === null ? "text-stone" : "text-ivory"
                      }`}
                    >
                      {m.status === "final" && m.scoreA !== null && m.scoreB !== null && m.scoreB > m.scoreA && (
                        <span aria-hidden className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-gold" />
                      )}
                      {m.scoreB ?? "–"}
                    </button>
                  </div>
                  <div className="rounded-[18px] border border-line bg-surface px-[18px] pt-8 pb-4 flex items-center justify-between gap-2.5">
                    <div className="flex flex-col min-w-0">
                      {isTeamSparring && <span className="text-[10px] font-bold text-graphite">TEAM A</span>}
                      {m.teamANames.map((n, i) => (
                        <span key={i} className="text-[14.5px] font-semibold text-ink leading-[1.3]">{n}</span>
                      ))}
                    </div>
                    <span className="font-mono text-[12px] font-semibold text-warm-gray shrink-0">vs</span>
                    <div className="flex flex-col items-end text-right min-w-0">
                      {isTeamSparring && <span className="text-[10px] font-bold text-gold-ink">TEAM B</span>}
                      {m.teamBNames.map((n, i) => (
                        <span key={i} className="text-[14.5px] font-semibold text-ink leading-[1.3]">{n}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              {viewedRound.restingNames.length > 0 && (
                <p className="mt-3.5 flex gap-2 items-start text-[12px] text-ink-2 leading-relaxed">
                  <span className="text-win font-semibold shrink-0">Resting</span>
                  <span>{viewedRound.restingNames.join(", ")} this round — back on court next.</span>
                </p>
              )}

              {/* Owner-only lineup swap — hidden from every other host. */}
              {canOwnerEdit && (
                <div className="mt-4">
                  <button
                    onClick={() => {
                      setEditLineup((v) => !v);
                      setSwapSel(null);
                    }}
                    className="text-[10.5px] font-semibold text-warm-gray/60 active:opacity-70"
                  >
                    {editLineup ? "Done editing" : "Edit lineup"}
                  </button>
                  {editLineup && (
                    <div className="mt-2 rounded-2xl border border-dashed border-line bg-surface p-3">
                      <p className="text-[11px] text-warm-gray mb-2">Tap two players to swap them. Only until scoring starts.</p>
                      <div className="flex flex-wrap gap-2">
                        {lineupChips.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => onSwapChip(c.id)}
                            disabled={swapBusy}
                            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors disabled:opacity-40 ${
                              swapSel === c.id
                                ? "bg-graphite text-ivory border-graphite"
                                : c.resting
                                  ? "bg-surface-2 border-line text-warm-gray"
                                  : "bg-surface border-line text-ink"
                            }`}
                          >
                            {c.name}
                            {c.resting ? " · rest" : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {canEdit && isViewingCurrent && !allMatchesFinal && (
                <p className="text-[10px] text-warm-gray text-center mt-3">
                  Finish scoring every match this round to unlock the next round.
                </p>
              )}
              <ErrorNote error={roundError} where="HostLivePage.nextRound" className="mt-2" />

              {sessionEnded && (fullyPreGenerated || isViewingCurrent) && (
                <p className="text-xs text-warm-gray text-center mt-5">This session has ended. Scores are locked.</p>
              )}
            </>
          )}
        </>
      )}

      {tab === "standings" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Standings</p>
            <div className="relative">
              <button
                onClick={() => setShowSortMenu((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink active:scale-[0.98] transition-transform"
              >
                Sort · {SORT_LABELS[effectiveSortBy]}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-warm-gray">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {showSortMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} aria-hidden />
                  <div className="absolute right-0 top-10 z-50 w-40 rounded-2xl border border-line bg-surface shadow-[0_20px_44px_-16px_rgba(13,13,13,0.35)] overflow-hidden">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setSortBy(opt.value);
                          setShowSortMenu(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-[12.5px] font-semibold active:bg-surface-2 ${
                          effectiveSortBy === opt.value ? "text-graphite bg-surface-2" : "text-ink-2"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {standingsLoading && !standings && (
            <div className="rounded-2xl border border-line overflow-hidden">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-11 border-t border-line first:border-t-0 skeleton" />
              ))}
            </div>
          )}
          <ErrorNote error={standingsError} where="HostLivePage.standings" />

          {standings && (
            <div className="rounded-2xl border border-line bg-surface overflow-hidden">
              {/* Column header */}
              <div
                className="grid items-center gap-1.5 px-3 py-2 bg-surface-2 border-b border-line text-[9.5px] font-bold uppercase tracking-wide text-warm-gray"
                style={{ gridTemplateColumns: standingsGridCols }}
              >
                <span className="text-center">#</span>
                <span>Name</span>
                <span className="text-center">GP</span>
                <span className={`text-center ${wActive ? "text-gold-ink" : ""}`}>{wHeader}</span>
                <span className="text-center">L</span>
                {showTies && <span className="text-center">T</span>}
                <span className={`text-center ${ptsActive ? "text-gold-ink" : ""}`}>{ptsHeader}</span>
              </div>

              {sortedStandingsRows.map((row, i) => {
                const isLeader = i === 0;
                // Rest compensation — the neutral bonus credited for games a
                // player sat out — already folded into PTS. Surfaced as a small
                // "+N" next to the points so a rester reads as "credited +N",
                // not penalised. (restCompensation is the separated amount;
                // compensatedPoints already includes it, so the two are equal.)
                const comp = row.restCompensation;
                const wValue = effectiveSortBy === "winPct" ? `${Math.round(row.winPct * 100)}%` : row.wins;
                const ptsValue = effectiveSortBy === "pointAvg" ? row.pointAvg.toFixed(1) : row.compensatedPoints;
                return (
                  <div
                    key={row.subjectId}
                    className={`grid items-center gap-1.5 px-3 py-2.5 border-t border-line first:border-t-0 ${
                      isLeader ? "bg-gold-soft/50" : ""
                    }`}
                    style={{ gridTemplateColumns: standingsGridCols }}
                  >
                    <span className={`text-center font-mono tnum text-[12px] ${isLeader ? "text-gold-ink font-bold" : "text-warm-gray"}`}>{i + 1}</span>
                    <span className="min-w-0 flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-graphite">{row.playerName}</span>
                      {isTeamSparring && row.teamSide && (
                        <span
                          className={`shrink-0 text-[9px] font-bold rounded px-1 py-0.5 ${
                            row.teamSide === "A" ? "bg-graphite text-ivory" : "bg-gold-soft text-gold-ink border border-gold/30"
                          }`}
                        >
                          {row.teamSide}
                        </span>
                      )}
                    </span>
                    <span className="text-center font-mono tnum text-[12.5px] text-ink-2 whitespace-nowrap">
                      {row.matchesPlayed}
                    </span>
                    <span className={`text-center font-mono tnum text-[13px] ${wActive ? "font-bold text-graphite" : "text-ink-2"}`}>{wValue}</span>
                    <span className="text-center font-mono tnum text-[13px] text-ink-2">{row.losses}</span>
                    {showTies && <span className="text-center font-mono tnum text-[13px] text-ink-2">{row.draws}</span>}
                    <span className={`text-center font-mono tnum text-[13px] whitespace-nowrap ${ptsActive ? "font-bold text-graphite" : "text-ink-2"}`}>
                      {ptsValue}
                      {comp > 0 && effectiveSortBy !== "pointAvg" && (
                        <span className="align-top text-[8.5px] font-bold text-gold-ink ml-0.5">+{comp}</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {sortedStandingsRows.length === 0 && (
                <p className="text-sm text-warm-gray px-4 py-3">No finished matches yet — standings will fill in as scores come in.</p>
              )}
            </div>
          )}
        </div>
      )}

      {activeMatch && pickerSide && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-40">
          <div className="w-full max-w-sm bg-ivory rounded-t-2xl p-4">
            <div className="flex justify-between items-center mb-1">
              <b className="text-sm text-ink">{activeMatch.courtName}</b>
              <button onClick={closePicker} className="w-7 h-7 rounded-full bg-surface border border-line text-warm-gray text-xs">
                ✕
              </button>
            </div>
            <p className="text-sm font-semibold text-ink mb-1">
              Entering score for: {isTeamSparring && pickerSide && `Team ${pickerSide} — `}
              {activeSideNames}
            </p>
            {!autoFill && (
              <p className="text-[11px] text-warm-gray mb-2">
                {pickerSide === "B" && pendingA !== null
                  ? <>{activeMatch.teamANames.join(" & ")} scored <span className="font-mono tnum">{pendingA}</span>. Now pick {otherSideNames}'s score.</>
                  : `Next you'll be asked for ${otherSideNames}'s score.`}
              </p>
            )}
            <p className="text-[11px] text-warm-gray mb-2">
              Valid range <span className="font-mono tnum">{range.min}-{range.max}</span>
              {autoFill ? <> (opponent auto-fills as <span className="font-mono tnum">{range.max}</span> − this score).</> : "."}
            </p>
            <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto">
              {Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i).map((n) => (
                <button
                  key={n}
                  onClick={() => pickNumber(n)}
                  disabled={saving}
                  className="aspect-square rounded-xl border border-line bg-surface font-mono tnum font-semibold text-graphite active:bg-graphite active:text-ivory disabled:opacity-40"
                >
                  {n}
                </button>
              ))}
            </div>
            <ErrorNote error={saveError} where="HostLivePage.score" className="mt-2" />
            {saving && <p className="text-xs text-warm-gray mt-2">Saving…</p>}
          </div>
        </div>
      )}

      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 px-4">
          <div className="w-full max-w-sm bg-surface rounded-2xl p-4 border border-line">
            <b className="text-sm text-ink">End this session?</b>
            <p className="text-[13px] text-ink-2 mt-2">
              Scores and standings stay exactly as they are — you just won't be able to add more scores or
              generate another round. You can still reopen this session anytime from the home page to see the
              results.
            </p>
            <ErrorNote error={endSessionError} where="HostLivePage.end" className="mt-2" />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowEndConfirm(false)}
                disabled={endingSession}
                className="flex-1 flex items-center justify-center rounded-full px-4 py-2.5 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEndSession}
                disabled={endingSession}
                className="flex-1 flex items-center justify-center rounded-full px-4 py-2.5 font-semibold text-ivory bg-loss active:scale-[0.99] transition-transform disabled:opacity-50"
              >
                {endingSession ? "Ending…" : "End Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {roundConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 px-4">
          <div className="w-full max-w-sm bg-surface rounded-2xl p-4 border border-line">
            <b className="text-sm text-ink">
              {roundConfirm === "delete" ? "Delete this round?" : roundConfirm === "randomize" ? "Randomize this round?" : "Refresh this round?"}
            </b>
            <p className="text-[13px] text-ink-2 mt-2 leading-relaxed">
              {roundConfirm === "delete"
                ? `Round ${currentRound?.sequence ?? ""} and its matches will be removed, and you'll go back to the previous round.`
                : roundConfirm === "randomize"
                  ? `This shuffles a brand-new draw for Round ${currentRound?.sequence ?? ""}. Any scores already entered in this round will be cleared.`
                  : `This re-draws Round ${currentRound?.sequence ?? ""} with the current players. Any scores already entered in this round will be cleared.`}
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setRoundConfirm(null)}
                disabled={roundActionBusy}
                className="flex-1 flex items-center justify-center rounded-full px-4 py-2.5 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => runRoundAction(roundConfirm)}
                disabled={roundActionBusy}
                className={`flex-1 flex items-center justify-center rounded-full px-4 py-2.5 font-semibold text-ivory active:scale-[0.99] transition-transform disabled:opacity-50 ${
                  roundConfirm === "delete" ? "bg-loss" : "bg-graphite"
                }`}
              >
                {roundActionBusy
                  ? "Working…"
                  : roundConfirm === "delete"
                    ? "Delete round"
                    : roundConfirm === "randomize"
                      ? "Randomize"
                      : "Refresh"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showManage && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-40">
          <div className="w-full max-w-sm bg-ivory rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <b className="text-sm text-ink">Manage Session</b>
              <button onClick={() => setShowManage(false)} className="w-7 h-7 rounded-full bg-surface border border-line text-warm-gray text-xs">
                ✕
              </button>
            </div>

            <ErrorNote error={manageError} where="HostLivePage.manage" />

            {/* Invite players — share the code, review who's asking to join */}
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Invite players</p>
            <div className="rounded-2xl border border-line bg-surface p-3.5 mb-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Join code</p>
                  <p className="font-mono tnum text-[26px] font-semibold text-graphite leading-tight tracking-[0.12em]">
                    {snapshot.session.joinCode}
                  </p>
                </div>
                <button
                  onClick={handleCopyJoinLink}
                  className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3.5 py-2 active:scale-95 transition-transform"
                >
                  {copiedLink ? "Copied ✓" : "Copy link"}
                </button>
              </div>
              <p className="text-[11px] text-warm-gray mt-2 leading-snug">
                Players enter this code (or open your link) to ask to join — you confirm them below. Scannable QR is coming next.
              </p>
            </div>

            {joinRequests.length > 0 && (
              <div className="space-y-2 mb-2">
                {joinRequests.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-gold/40 bg-gold-soft/50 px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <b className="block text-[14px] font-semibold text-graphite truncate">{r.displayName}</b>
                        <p className="text-[11px] text-ink-2 mt-0.5">
                          {r.preferredSide === "L" ? "Left" : r.preferredSide === "R" ? "Right" : "Any side"} · {r.gender === "F" ? "Female" : "Male"}
                          {r.email ? ` · ${r.email}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleRejectJoin(r.id)}
                          disabled={joinBusyId === r.id}
                          className="text-[12px] font-semibold text-ink-2 rounded-full border border-line bg-surface px-3 py-1.5 disabled:opacity-50"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => handleConfirmJoin(r)}
                          disabled={joinBusyId === r.id}
                          className="text-[12px] font-semibold text-ivory rounded-full bg-graphite px-3 py-1.5 disabled:opacity-50"
                        >
                          {joinBusyId === r.id ? "…" : "Add"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-warm-gray mb-4">
              {joinRequests.length === 0
                ? "No one's waiting to join right now."
                : `${joinRequests.length} ${joinRequests.length === 1 ? "person is" : "people are"} waiting — added players join from the next round.`}
            </p>

            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Ranking basis</p>
            <div className="flex gap-1 mb-1.5 rounded-2xl border border-line bg-surface p-1">
              {(["points_first", "wins_first"] as const).map((b) => {
                const active = snapshot.session.rankingBasis === b;
                return (
                  <button
                    key={b}
                    onClick={() => {
                      if (!active) handleSetRankingBasis(b);
                    }}
                    disabled={rankingBasisSaving}
                    className={`flex-1 rounded-xl px-3 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
                      active ? "bg-graphite text-ivory" : "text-ink-2 active:bg-surface-2"
                    }`}
                  >
                    {b === "points_first" ? "By points" : "By wins"}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-warm-gray mb-4">
              {fullyPreGenerated
                ? "Sets what the standings rank on. Applies immediately."
                : "Sets what the standings rank on and how the next rounds pair players. Applies from the next generated round."}
            </p>

            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Courts</p>
            <div className="space-y-2 mb-4">
              {snapshot.courts.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2">
                  {/* Tap the court name to rename it — the pencil signals it's editable. */}
                  <label className="flex-1 min-w-0 flex items-center gap-1.5 cursor-text rounded-lg px-1.5 py-1 focus-within:bg-surface-2 focus-within:ring-2 focus-within:ring-graphite/15">
                    <input
                      key={`${c.id}-${c.name}`}
                      defaultValue={c.name}
                      aria-label={`Rename ${c.name}`}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== c.name) handleRenameCourt(c.id, value);
                      }}
                      className="flex-1 min-w-0 text-[16px] font-semibold bg-transparent border-none focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55 rounded-lg px-1 text-ink"
                    />
                    <svg className="w-3.5 h-3.5 text-warm-gray shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </label>
                  <button
                    onClick={() => handleToggleCourtAvailability(c.id, !c.available)}
                    className={`shrink-0 text-[10px] font-semibold rounded-full px-2 py-1 ${
                      c.available ? "bg-win-soft text-win" : "bg-surface-2 text-warm-gray border border-line"
                    }`}
                  >
                    {c.available ? "Available" : "Unavailable"}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-warm-gray -mt-3 mb-4">
              An unavailable court is skipped starting with the next generated round — matches already scheduled on it stay as-is.
            </p>

            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1.5">Players</p>

            {isFixedPartner ? (
              <p className="text-[11px] text-warm-gray mb-3">
                Adding players mid-session isn't available for Fixed Partner — every player needs a locked partner from the start.
              </p>
            ) : (
              <div className="flex gap-2 mb-3">
                <input
                  className="flex-1 min-w-0 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[16px] text-ink placeholder:text-warm-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-graphite/55"
                  placeholder="New player name…"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddPlayer();
                  }}
                />
                <button
                  onClick={() => setNewPlayerGender((g) => (g === "M" ? "F" : "M"))}
                  className={`w-9 h-9 rounded-full text-xs font-bold shrink-0 ${
                    newPlayerGender === "M" ? "bg-graphite text-ivory" : "bg-gold text-graphite"
                  }`}
                >
                  {newPlayerGender}
                </button>
                {isTeamSparring && (
                  <button
                    onClick={() => setNewPlayerTeamSide((s) => (s === "A" ? "B" : "A"))}
                    className="w-9 h-9 rounded-full text-xs font-bold border border-line text-ink shrink-0"
                  >
                    {newPlayerTeamSide}
                  </button>
                )}
                <button
                  onClick={handleAddPlayer}
                  disabled={manageSaving || !newPlayerName.trim()}
                  className="px-4 rounded-full bg-graphite text-ivory text-sm font-semibold shrink-0 disabled:opacity-40"
                >
                  + Add
                </button>
              </div>
            )}

            {/* One action, two meanings. Someone who has played and gone home
                has "left"; someone the RSVP list added who hasn't walked in yet
                has not left anything. Both are the same row in the database —
                out of the draw, restorable — but calling the second one "left"
                made hosts hesitate to use it on the person they were waiting
                for, which is exactly the case it's best at. So the label
                follows whether they have actually been on court. */}
            <div className="space-y-2">
              {snapshot.roster.map((p) => {
                const neverPlayed = p.matchesPlayed === 0;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-3 py-2">
                    <span className="text-sm font-semibold text-ink truncate">
                      {p.name}
                      {p.status === "left" && (
                        <span className="ml-1.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-surface-2 text-warm-gray border border-line">
                          {neverPlayed ? "NOT HERE" : "LEFT"}
                        </span>
                      )}
                    </span>
                    {p.status === "left" ? (
                      <button onClick={() => handleRestorePlayer(p.id)} className="shrink-0 text-[11px] font-semibold text-ink-2">
                        {neverPlayed ? "They're here" : "Restore"}
                      </button>
                    ) : (
                      <button onClick={() => handleMarkLeft(p.id)} className="shrink-0 text-[11px] font-semibold text-loss">
                        {neverPlayed ? "Not here yet" : "Mark as left"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pre-generated formats only. Americano and its relatives draw the
                whole schedule at the start, so a player who leaves is still
                written into every future round and nothing will ever take them
                out on its own. Mexicano needs no button — it filters the roster
                as it draws each round. */}
            {fullyPreGenerated && !sessionEnded && (
              <div className="mt-4 rounded-2xl border border-line bg-surface-2 px-3.5 py-3">
                <p className="text-[12px] font-semibold text-ink">Rounds not yet played</p>
                <p className="text-[11px] text-warm-gray mt-1 leading-snug">
                  {redrawPreview
                    ? `The whole schedule was drawn at the start, so ${
                        redrawPreview.fromSequence === redrawPreview.toSequence
                          ? `round ${redrawPreview.fromSequence} still lists`
                          : `rounds ${redrawPreview.fromSequence}–${redrawPreview.toSequence} still list`
                      } anyone who has left. Redraw them from the players still in — everything already played stays exactly as it is.`
                    : "Every round has been played or scored. There's nothing left to redraw."}
                </p>
                <button
                  onClick={handleRedraw}
                  disabled={!redrawPreview || redrawing}
                  className="w-full mt-2.5 rounded-full border border-graphite text-graphite bg-surface text-[12.5px] font-semibold py-2.5 active:scale-[0.99] transition-transform disabled:opacity-40"
                >
                  {redrawing
                    ? "Redrawing…"
                    : redrawPreview
                      ? redrawPreview.fromSequence === redrawPreview.toSequence
                        ? `Redraw round ${redrawPreview.fromSequence}`
                        : `Redraw rounds ${redrawPreview.fromSequence}–${redrawPreview.toSequence}`
                      : "Nothing to redraw"}
                </button>
                {redrawNote && <p className="text-[11px] text-win font-semibold mt-2">{redrawNote}</p>}
              </div>
            )}

            <p className="text-[11px] text-warm-gray mt-4">
              Scores and rounds already played always stay exactly as they are. In Mexicano, player changes take effect
              from the next round you generate; in Americano the schedule was drawn up front, so use Redraw above to
              apply them to the rounds still to come. Anyone marked "not here yet" is left out of the draw until you say
              they've arrived, and keeps their place and their points meanwhile.
            </p>
          </div>
        </div>
      )}

      {/* The sync toast that used to live here is gone, deliberately.
          It reported OUR plumbing: how many scores were queued, whether a
          flush was running, whether the phone had a connection. None of that
          is the host's problem. They tapped a score and the score is on the
          screen; whether the row has reached Postgres yet is our job to get
          right, not theirs to monitor. A status pill about it only teaches
          someone to worry about something they cannot act on — and worse,
          invites them to wait before doing the next thing.

          What replaced it is not a quieter message: it is the work that makes
          the message unnecessary. Scores save locally and upload themselves,
          a session started offline runs and syncs itself, and every action on
          this screen works with no signal. Nothing to report. */}
    </div>
  );
}
