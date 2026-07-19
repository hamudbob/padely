import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getHostLiveSnapshot, HostLiveSnapshot } from "../../lib/supabase/sessionQueries";
import { submitMatchScore } from "../../lib/supabase/scoreActions";
import { generateNextRound } from "../../lib/supabase/roundActions";
import { endSession } from "../../lib/supabase/sessionActions";
import { getSessionStandings, SessionStandings } from "../../lib/supabase/standingsQueries";
import { getRoundHistory, RoundHistoryEntry } from "../../lib/supabase/roundHistoryQueries";
import { renameCourt, setCourtAvailability, addLatePlayer, markPlayerLeft, restorePlayer } from "../../lib/supabase/manageActions";
import { isAutoFillFormat, scoreRangeForFormat, ScoringFormat } from "../../lib/scoring/formats";
import { supabase } from "../../lib/supabase/client";

type Tab = "round" | "matches" | "players" | "standings";
type SortBy = "points" | "wins";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
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
  const [tab, setTab] = useState<Tab>("round");
  const [snapshot, setSnapshot] = useState<HostLiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerMatchId, setPickerMatchId] = useState<string | null>(null);
  const [pickerSide, setPickerSide] = useState<"A" | "B" | null>(null);
  const [pendingA, setPendingA] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generatingRound, setGeneratingRound] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);

  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [endSessionError, setEndSessionError] = useState<string | null>(null);

  const [showManage, setShowManage] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageSaving, setManageSaving] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerGender, setNewPlayerGender] = useState<"M" | "F">("M");
  const [newPlayerTeamSide, setNewPlayerTeamSide] = useState<"A" | "B">("A");

  const [standings, setStandings] = useState<SessionStandings | null>(null);
  const [standingsError, setStandingsError] = useState<string | null>(null);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy | null>(null); // null = follow session's ranking_basis until the host picks

  const [roundHistory, setRoundHistory] = useState<RoundHistoryEntry[] | null>(null);
  const [roundHistoryError, setRoundHistoryError] = useState<string | null>(null);
  // roundHistory is sorted most-recent-first (see getRoundHistory), so index
  // 0 = the live/current round for Mexicano. < moves to an OLDER round
  // (index+1), > moves back toward index 0 (index-1). Americano is
  // different: its whole schedule is pre-generated, so index 0 is just the
  // LAST round of the schedule, not necessarily the one being played — see
  // the auto-positioning effect below.
  const [viewedIndex, setViewedIndex] = useState(0);
  const [hasAutoPositioned, setHasAutoPositioned] = useState(false);

  function load() {
    if (!sessionId) return;
    getHostLiveSnapshot(sessionId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this session."));
  }

  function loadStandings() {
    if (!sessionId) return;
    setStandingsLoading(true);
    setStandingsError(null);
    getSessionStandings(sessionId)
      .then(setStandings)
      .catch((err) => setStandingsError(err instanceof Error ? err.message : "Could not load standings."))
      .finally(() => setStandingsLoading(false));
  }

  function loadRoundHistory() {
    if (!sessionId) return;
    setRoundHistoryError(null);
    getRoundHistory(sessionId)
      .then(setRoundHistory)
      .catch((err) => setRoundHistoryError(err instanceof Error ? err.message : "Could not load rounds."));
  }

  useEffect(load, [sessionId]);
  useEffect(loadRoundHistory, [sessionId]);
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
    const isFullyPreGenerated =
      snapshot.session.format === "americano" ||
      snapshot.session.format === "team_sparring" ||
      snapshot.session.format === "mix_americano" ||
      snapshot.session.fixedPartnerStyle === "round_robin" ||
      snapshot.session.format === "fixed_partner"; // legacy pre-rework rows
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
      <div className="mx-auto max-w-sm min-h-screen bg-white px-4 py-8">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-white px-4 py-8">
        <p className="text-sm text-slate-400">Loading…</p>
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
  const fullyPreGenerated =
    snapshot.session.format === "americano" ||
    snapshot.session.format === "team_sparring" ||
    snapshot.session.format === "mix_americano" ||
    snapshot.session.fixedPartnerStyle === "round_robin" ||
    snapshot.session.format === "fixed_partner"; // legacy pre-rework rows
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
  // Scoring/Next Round only ever apply to the live round of a still-live
  // Mexicano session — once ended, every round (including the last one) is
  // read-only. Americano has no single "current" round to restrict to, so
  // any round is editable until the session ends.
  const canEdit = fullyPreGenerated ? !sessionEnded : isViewingCurrent && !sessionEnded;
  const canGoOlder = !!roundHistory && safeIndex < roundHistory.length - 1;
  const canGoNewer = safeIndex > 0;

  const activeMatch = viewedRound?.matches.find((m) => m.id === pickerMatchId) ?? null;

  // correction #6: Next Round only unlocks once every match in the CURRENT
  // round is Final — this always checks roundHistory[0], never whichever
  // round the host happens to be browsing.
  const currentRound = roundHistory?.[0] ?? null;
  const allMatchesFinal = !!currentRound && currentRound.matches.length > 0 && currentRound.matches.every((m) => m.status === "final");

  // The rank BADGE always reflects the session's official ranking_basis
  // (points_first/wins_first — set at session creation and used for the
  // real placement). The sort toggle only changes viewing ORDER, so the
  // host can check "who has the most wins" without changing anyone's
  // official rank.
  const effectiveSortBy: SortBy = sortBy ?? (standings?.rankingBasis === "wins_first" ? "wins" : "points");
  const sortedStandingsRows = standings
    ? [...standings.rows].sort((a, b) =>
        effectiveSortBy === "points" ? b.totalPoints - a.totalPoints : b.wins - a.wins,
      )
    : [];

  function goOlder() {
    if (canGoOlder) setViewedIndex((i) => i + 1);
  }
  function goNewer() {
    if (canGoNewer) setViewedIndex((i) => Math.max(0, i - 1));
  }

  function openPicker(matchId: string, side: "A" | "B") {
    if (!canEdit) return; // history is read-only, and so is an ended session's live round
    if (autoFill && side === "B") return; // Team B is derived, not tappable, for any fixed-sum format
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

    // Fixed-21: one tap on Team A is enough (Team B auto-derives server-side too).
    if (autoFill && pickerSide === "A") {
      await save(activeMatch.id, value, null);
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

  async function save(matchId: string, scoreA: number | null, scoreB: number | null) {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      await submitMatchScore({
        matchId,
        format,
        scoreA,
        scoreB,
        editedBy: userData.user?.id ?? "",
      });
      closePicker();
      load();
      loadRoundHistory();
      if (tab === "standings" || isTeamSparring) loadStandings();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save score.");
    } finally {
      setSaving(false);
    }
  }

  async function handleNextRound() {
    if (!sessionId) return;
    setGeneratingRound(true);
    setRoundError(null);
    try {
      await generateNextRound(sessionId);
      setViewedIndex(0); // jump to the newly created current round
      load();
      loadRoundHistory();
      if (tab === "standings" || isTeamSparring) loadStandings();
    } catch (err) {
      setRoundError(err instanceof Error ? err.message : "Could not generate the next round.");
    } finally {
      setGeneratingRound(false);
    }
  }

  async function handleRenameCourt(courtId: string, name: string) {
    setManageError(null);
    try {
      await renameCourt(courtId, name);
      load();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Could not rename court.");
    }
  }

  async function handleToggleCourtAvailability(courtId: string, available: boolean) {
    setManageError(null);
    try {
      await setCourtAvailability(courtId, available);
      load();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Could not update court.");
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
      setManageError(err instanceof Error ? err.message : "Could not add player.");
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
      setManageError(err instanceof Error ? err.message : "Could not update player.");
    }
  }

  async function handleRestorePlayer(playerId: string) {
    setManageError(null);
    try {
      await restorePlayer(playerId);
      load();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Could not update player.");
    }
  }

  async function handleEndSession() {
    if (!sessionId) return;
    setEndingSession(true);
    setEndSessionError(null);
    try {
      await endSession(sessionId);
      setShowEndConfirm(false);
      load(); // status flips to "ended" — the whole page (including round 0) goes read-only
    } catch (err) {
      setEndSessionError(err instanceof Error ? err.message : "Could not end this session.");
    } finally {
      setEndingSession(false);
    }
  }

  const activeSideNames =
    activeMatch && pickerSide ? (pickerSide === "A" ? activeMatch.teamANames : activeMatch.teamBNames).join(" & ") : "";
  const otherSideNames =
    activeMatch && pickerSide ? (pickerSide === "A" ? activeMatch.teamBNames : activeMatch.teamANames).join(" & ") : "";

  // Players tab — matches played / rests per player, computed from
  // roundHistory's id arrays (never from names, which could collide between
  // two players who happen to share a name) rather than a separate query.
  const matchesPlayedByPlayerId = new Map<string, number>();
  const restsByPlayerId = new Map<string, number>();
  for (const r of roundHistory ?? []) {
    for (const m of r.matches) {
      for (const id of [...m.teamAIds, ...m.teamBIds]) {
        matchesPlayedByPlayerId.set(id, (matchesPlayedByPlayerId.get(id) ?? 0) + 1);
      }
    }
    for (const id of r.restingIds) {
      restsByPlayerId.set(id, (restsByPlayerId.get(id) ?? 0) + 1);
    }
  }
  // Matches tab — every round that actually has matches, most-recent first
  // (roundHistory is already sorted that way).
  const roundsWithMatches = (roundHistory ?? []).filter((r) => r.matches.length > 0);

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-white px-4 py-8 relative">
      <div className="flex items-center justify-between mb-1">
        <Link
          to="/"
          aria-label="Back to home"
          className="w-8 h-8 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center text-sm shrink-0"
        >
          🏠
        </Link>
        <h1 className="text-lg font-extrabold flex-1 text-center px-2 truncate">{snapshot.session.name}</h1>
        <span
          className={`text-[9px] font-bold rounded-full px-2 py-1 shrink-0 ${
            sessionEnded ? "bg-slate-100 text-slate-500" : "bg-accent-soft text-accent-dark"
          }`}
        >
          {snapshot.session.status.toUpperCase()}
        </span>
      </div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-500">
          {FORMAT_LABELS[snapshot.session.format] ?? snapshot.session.format}
          {snapshot.session.fixedPartnerStyle ? " · Fixed Partner" : ""} · Code {snapshot.session.joinCode}
        </p>
        {!sessionEnded && (
          <div className="flex items-center gap-3">
            <button onClick={() => setShowManage(true)} className="text-[10px] font-bold text-slate-500">
              Manage
            </button>
            <button onClick={() => setShowEndConfirm(true)} className="text-[10px] font-bold text-red-500">
              End Session
            </button>
          </div>
        )}
      </div>

      {isTeamSparring && teamTotals && (
        <div className="mb-4 rounded-2xl border border-accent bg-gradient-to-br from-accent-soft to-white px-4 py-3">
          <p className="text-[9px] font-bold uppercase text-slate-500 text-center mb-1">
            Team Score · {TEAM_SCORE_MODE_LABELS[teamScoreMode] ?? teamScoreMode}
          </p>
          <div className="flex items-center justify-center gap-4">
            <div className="text-center flex-1">
              <p className="text-[10px] font-bold text-sky-700">TEAM A</p>
              <p className="text-2xl font-extrabold text-accent-dark">{teamTotals.a}</p>
            </div>
            <span className="text-slate-300 font-bold text-sm">vs</span>
            <div className="text-center flex-1">
              <p className="text-[10px] font-bold text-amber-700">TEAM B</p>
              <p className="text-2xl font-extrabold text-accent-dark">{teamTotals.b}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex bg-slate-100 rounded-xl p-1 mb-4">
        <button
          onClick={() => setTab("round")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold ${tab === "round" ? "bg-white shadow" : "text-slate-500"}`}
        >
          Rounds
        </button>
        <button
          onClick={() => setTab("matches")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold ${tab === "matches" ? "bg-white shadow" : "text-slate-500"}`}
        >
          Matches
        </button>
        <button
          onClick={() => setTab("players")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold ${tab === "players" ? "bg-white shadow" : "text-slate-500"}`}
        >
          Players
        </button>
        <button
          onClick={() => setTab("standings")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold ${tab === "standings" ? "bg-white shadow" : "text-slate-500"}`}
        >
          Standings
        </button>
      </div>

      {tab === "round" && (
        <>
          {roundHistoryError && <p className="text-sm text-red-600 mb-3">{roundHistoryError}</p>}

          {!roundHistory && !roundHistoryError && <p className="text-sm text-slate-400">Loading rounds…</p>}

          {viewedRound && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={goOlder}
                  disabled={!canGoOlder}
                  aria-label="Previous round"
                  className="w-9 h-9 rounded-full border border-slate-300 text-slate-600 font-bold flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ‹
                </button>
                <div className="text-center">
                  <p className="text-sm font-extrabold">Round {viewedRound.sequence}</p>
                  <p className="text-[9px] text-slate-400">
                    {fullyPreGenerated
                      ? `Round ${viewedRound.sequence} of ${roundHistory?.length ?? viewedRound.sequence}${
                          sessionEnded ? " · session ended" : ""
                        }`
                      : canEdit
                        ? "Current round"
                        : isViewingCurrent && sessionEnded
                          ? "Final round · session ended"
                          : `Viewing history${viewedRound.status === "scored" ? " · scored" : ""}`}
                  </p>
                </div>
                <button
                  onClick={goNewer}
                  disabled={!canGoNewer}
                  aria-label="Next round"
                  className="w-9 h-9 rounded-full border border-slate-300 text-slate-600 font-bold flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ›
                </button>
              </div>

              <div className="space-y-2">
                {viewedRound.matches.map((m) => (
                  <div key={m.id} className="rounded-xl border border-slate-200 px-3 py-2">
                    <div className="flex justify-between items-center mb-1">
                      <b className="text-xs">{m.courtName}</b>
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                        {m.status === "final" ? `Final ${m.scoreA}-${m.scoreB}` : "Not started"}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={() => openPicker(m.id, "A")}
                        disabled={!canEdit}
                        className={`flex flex-col items-center gap-1 w-24 rounded-xl border px-2 py-2 ${
                          m.scoreA !== null ? "border-accent bg-accent-soft" : "border-slate-300"
                        } ${!canEdit ? "opacity-80" : ""}`}
                      >
                        <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center">
                          {isTeamSparring && <span className="block text-[9px] font-bold text-sky-700">TEAM A</span>}
                          {m.teamANames.join(" & ")}
                        </span>
                        <span className={`font-extrabold text-lg ${m.scoreA !== null ? "text-accent-dark" : "text-slate-400"}`}>
                          {m.scoreA ?? "–"}
                        </span>
                      </button>
                      <span className="text-slate-400 font-bold">vs</span>
                      <button
                        onClick={() => openPicker(m.id, "B")}
                        disabled={!canEdit || autoFill}
                        className={`flex flex-col items-center gap-1 w-24 rounded-xl border px-2 py-2 ${
                          m.scoreB !== null ? "border-accent bg-accent-soft" : "border-slate-300"
                        } ${!canEdit || autoFill ? "opacity-80" : ""}`}
                      >
                        <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center">
                          {isTeamSparring && <span className="block text-[9px] font-bold text-amber-700">TEAM B</span>}
                          {m.teamBNames.join(" & ")}
                        </span>
                        <span className={`font-extrabold text-lg ${m.scoreB !== null ? "text-accent-dark" : "text-slate-400"}`}>
                          {m.scoreB ?? "–"}
                        </span>
                      </button>
                    </div>
                    {canEdit && autoFill && (
                      <p className="text-center text-[9px] text-slate-400 mt-1">Opponent score auto-fills as {range.max} − this score</p>
                    )}
                  </div>
                ))}
              </div>

              {viewedRound.restingNames.length > 0 && (
                <p className="text-xs text-slate-500 mt-3">Resting: {viewedRound.restingNames.join(", ")}</p>
              )}

              {sessionEnded && (fullyPreGenerated || isViewingCurrent) && (
                <p className="text-xs text-slate-400 text-center mt-5">This session has ended. Scores are locked.</p>
              )}

              {!fullyPreGenerated && canEdit && (
                <div className="mt-5">
                  <button
                    onClick={handleNextRound}
                    disabled={!allMatchesFinal || generatingRound}
                    className="w-full rounded-xl px-4 py-3 font-bold text-white bg-gradient-to-br from-accent to-accent-dark shadow disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generatingRound ? "Generating next round…" : "Next Round"}
                  </button>
                  {!allMatchesFinal && (
                    <p className="text-[10px] text-slate-400 mt-1 text-center">
                      Finish scoring every match this round to unlock the next round.
                    </p>
                  )}
                  {roundError && <p className="text-xs text-red-600 mt-2 text-center">{roundError}</p>}
                </div>
              )}

              {fullyPreGenerated && canEdit && isViewingCurrent && allMatchesFinal && (
                <div className="mt-5">
                  <button
                    onClick={handleNextRound}
                    disabled={generatingRound}
                    className="w-full rounded-xl px-4 py-3 font-bold text-white bg-gradient-to-br from-accent to-accent-dark shadow disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generatingRound ? "Generating round…" : "Add Another Round"}
                  </button>
                  <p className="text-[10px] text-slate-400 mt-1 text-center">
                    Every round of the original schedule is scored — this adds one more beyond it.
                  </p>
                  {roundError && <p className="text-xs text-red-600 mt-2 text-center">{roundError}</p>}
                </div>
              )}
            </>
          )}

          <p className="text-[10px] text-slate-400 mt-6">
            TODO (next build pass): manage menu (courts/players mid-session), realtime updates.
          </p>
        </>
      )}

      {tab === "matches" && (
        <div className="space-y-4">
          {roundHistoryError && <p className="text-sm text-red-600">{roundHistoryError}</p>}
          {!roundHistory && !roundHistoryError && <p className="text-sm text-slate-400">Loading matches…</p>}
          {roundHistory && roundsWithMatches.length === 0 && <p className="text-sm text-slate-400">No matches yet.</p>}
          {roundsWithMatches.map((r) => (
            <div key={r.roundId}>
              <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">
                Round {r.sequence}
                {r.status === "scored" ? " · scored" : ""}
              </p>
              <div className="space-y-2">
                {r.matches.map((m) => (
                  <div key={m.id} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
                    <div className="flex justify-between items-center mb-1">
                      <b>{m.courtName}</b>
                      <span className="text-[9px] font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                        {m.status === "final" ? `Final ${m.scoreA}-${m.scoreB}` : "Not started"}
                      </span>
                    </div>
                    <p className="text-slate-700">
                      {isTeamSparring && <span className="font-bold text-sky-700">A </span>}
                      {m.teamANames.join(" & ")} vs{" "}
                      {isTeamSparring && <span className="font-bold text-amber-700">B </span>}
                      {m.teamBNames.join(" & ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "players" && (
        <div className="space-y-2">
          {snapshot.roster.length === 0 && <p className="text-sm text-slate-400">No players yet.</p>}
          {snapshot.roster.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
              <span
                className={`w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0 ${
                  p.gender === "M" ? "bg-blue-500" : "bg-pink-500"
                }`}
              >
                {p.gender}
              </span>
              <span className="flex-1 min-w-0 text-sm font-semibold truncate">
                {p.name}
                {p.status !== "active" && (
                  <span className="ml-1.5 text-[9px] font-bold rounded px-1 py-0.5 bg-slate-100 text-slate-500">
                    {p.status.toUpperCase()}
                  </span>
                )}
                {isTeamSparring && p.teamSide && (
                  <span
                    className={`ml-1.5 text-[9px] font-bold rounded px-1 py-0.5 ${
                      p.teamSide === "A" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {p.teamSide}
                  </span>
                )}
                {p.pairLabel && <span className="block text-[10px] font-normal text-slate-400 mt-0.5 truncate">{p.pairLabel}</span>}
              </span>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-slate-700">{matchesPlayedByPlayerId.get(p.id) ?? 0} played</p>
                <p className="text-[10px] text-slate-400">{restsByPlayerId.get(p.id) ?? 0} rested</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "standings" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] text-slate-400">Sort by</p>
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setSortBy("points")}
                className={`px-3 py-1 rounded-md text-[11px] font-bold ${
                  effectiveSortBy === "points" ? "bg-white shadow text-accent-dark" : "text-slate-500"
                }`}
              >
                Points
              </button>
              <button
                onClick={() => setSortBy("wins")}
                className={`px-3 py-1 rounded-md text-[11px] font-bold ${
                  effectiveSortBy === "wins" ? "bg-white shadow text-accent-dark" : "text-slate-500"
                }`}
              >
                Wins
              </button>
            </div>
          </div>

          {standingsLoading && !standings && <p className="text-sm text-slate-400">Loading standings…</p>}
          {standingsError && <p className="text-sm text-red-600">{standingsError}</p>}

          {standings && (
            <div className="space-y-1.5">
              {sortedStandingsRows.map((row) => (
                <div
                  key={row.subjectId}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2"
                >
                  <span className="w-6 text-center text-xs font-extrabold text-slate-400">{row.rank}</span>
                  <span className="flex-1 text-sm font-semibold">
                    {row.playerName}
                    {isTeamSparring && row.teamSide && (
                      <span
                        className={`ml-1.5 text-[9px] font-bold rounded px-1 py-0.5 ${
                          row.teamSide === "A" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {row.teamSide}
                      </span>
                    )}
                  </span>
                  <div className="text-right">
                    <p className={`text-sm font-extrabold ${effectiveSortBy === "points" ? "text-accent-dark" : "text-slate-700"}`}>
                      {row.totalPoints} pts
                    </p>
                    <p className={`text-[10px] ${effectiveSortBy === "wins" ? "font-bold text-accent-dark" : "text-slate-400"}`}>
                      {row.wins}W-{row.draws}D-{row.losses}L · {row.matchesPlayed} played
                    </p>
                  </div>
                </div>
              ))}
              {sortedStandingsRows.length === 0 && (
                <p className="text-sm text-slate-400">No finished matches yet — standings will fill in as scores come in.</p>
              )}
            </div>
          )}
        </div>
      )}

      {activeMatch && pickerSide && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-40">
          <div className="w-full max-w-sm bg-white rounded-t-2xl p-4">
            <div className="flex justify-between items-center mb-1">
              <b className="text-sm">{activeMatch.courtName}</b>
              <button onClick={closePicker} className="w-6 h-6 rounded-full bg-slate-100 text-xs">
                ✕
              </button>
            </div>
            <p className="text-sm font-bold text-accent-dark mb-1">
              Entering score for: {isTeamSparring && pickerSide && `Team ${pickerSide} — `}
              {activeSideNames}
            </p>
            {!autoFill && (
              <p className="text-[10px] text-slate-400 mb-2">
                {pickerSide === "B" && pendingA !== null
                  ? `${activeMatch.teamANames.join(" & ")} scored ${pendingA}. Now pick ${otherSideNames}'s score.`
                  : `Next you'll be asked for ${otherSideNames}'s score.`}
              </p>
            )}
            <p className="text-[10px] text-slate-400 mb-2">
              Valid range {range.min}-{range.max}
              {autoFill ? ` (opponent auto-fills as ${range.max} − this score).` : "."}
            </p>
            <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto">
              {Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i).map((n) => (
                <button
                  key={n}
                  onClick={() => pickNumber(n)}
                  disabled={saving}
                  className="aspect-square rounded-lg border border-slate-300 font-bold text-sm disabled:opacity-40"
                >
                  {n}
                </button>
              ))}
            </div>
            {saveError && <p className="text-xs text-red-600 mt-2">{saveError}</p>}
            {saving && <p className="text-xs text-slate-400 mt-2">Saving…</p>}
          </div>
        </div>
      )}

      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 px-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-4">
            <b className="text-sm">End this session?</b>
            <p className="text-xs text-slate-500 mt-2">
              Scores and standings stay exactly as they are — you just won't be able to add more scores or
              generate another round. You can still reopen this session anytime from the home page to see the
              results.
            </p>
            {endSessionError && <p className="text-xs text-red-600 mt-2">{endSessionError}</p>}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowEndConfirm(false)}
                disabled={endingSession}
                className="flex-1 rounded-xl px-4 py-2.5 font-bold border border-slate-300 text-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEndSession}
                disabled={endingSession}
                className="flex-1 rounded-xl px-4 py-2.5 font-bold text-white bg-red-500 disabled:opacity-50"
              >
                {endingSession ? "Ending…" : "End Session"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showManage && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-40">
          <div className="w-full max-w-sm bg-white rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <b className="text-sm">Manage Session</b>
              <button onClick={() => setShowManage(false)} className="w-6 h-6 rounded-full bg-slate-100 text-xs">
                ✕
              </button>
            </div>

            {manageError && <p className="text-xs text-red-600 mb-2">{manageError}</p>}

            <p className="text-[10px] font-bold uppercase text-slate-500 mb-1.5">Courts</p>
            <div className="space-y-2 mb-4">
              {snapshot.courts.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                  <input
                    key={`${c.id}-${c.name}`}
                    defaultValue={c.name}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value && value !== c.name) handleRenameCourt(c.id, value);
                    }}
                    className="flex-1 min-w-0 text-sm font-semibold border-none focus:outline-none focus:ring-1 focus:ring-accent rounded px-1"
                  />
                  <button
                    onClick={() => handleToggleCourtAvailability(c.id, !c.available)}
                    className={`shrink-0 text-[9px] font-bold rounded-full px-2 py-1 ${
                      c.available ? "bg-accent-soft text-accent-dark" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {c.available ? "Available" : "Unavailable"}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 -mt-3 mb-4">
              An unavailable court is skipped starting with the next generated round — matches already scheduled on it stay as-is.
            </p>

            <p className="text-[10px] font-bold uppercase text-slate-500 mb-1.5">Players</p>

            {isFixedPartner ? (
              <p className="text-[10px] text-slate-400 mb-3">
                Adding players mid-session isn't available for Fixed Partner — every player needs a locked partner from the start.
              </p>
            ) : (
              <div className="flex gap-2 mb-3">
                <input
                  className="flex-1 min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="New player name…"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddPlayer();
                  }}
                />
                <button
                  onClick={() => setNewPlayerGender((g) => (g === "M" ? "F" : "M"))}
                  className={`w-9 h-9 rounded-xl text-xs font-bold text-white shrink-0 ${
                    newPlayerGender === "M" ? "bg-blue-500" : "bg-pink-500"
                  }`}
                >
                  {newPlayerGender}
                </button>
                {isTeamSparring && (
                  <button
                    onClick={() => setNewPlayerTeamSide((s) => (s === "A" ? "B" : "A"))}
                    className="w-9 h-9 rounded-xl text-xs font-bold border border-slate-300 shrink-0"
                  >
                    {newPlayerTeamSide}
                  </button>
                )}
                <button
                  onClick={handleAddPlayer}
                  disabled={manageSaving || !newPlayerName.trim()}
                  className="px-3 rounded-xl bg-ink text-white text-sm font-bold shrink-0 disabled:opacity-40"
                >
                  + Add
                </button>
              </div>
            )}

            <div className="space-y-2">
              {snapshot.roster.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
                  <span className="text-sm font-semibold truncate">
                    {p.name}
                    {p.status === "left" && (
                      <span className="ml-1.5 text-[9px] font-bold rounded px-1 py-0.5 bg-slate-100 text-slate-500">LEFT</span>
                    )}
                  </span>
                  {p.status === "left" ? (
                    <button onClick={() => handleRestorePlayer(p.id)} className="shrink-0 text-[10px] font-bold text-accent-dark">
                      Restore
                    </button>
                  ) : (
                    <button onClick={() => handleMarkLeft(p.id)} className="shrink-0 text-[10px] font-bold text-red-500">
                      Mark as left
                    </button>
                  )}
                </div>
              ))}
            </div>

            <p className="text-[10px] text-slate-400 mt-4">
              Player changes take effect starting with the next generated round — scores and rounds already played stay exactly as they are.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
