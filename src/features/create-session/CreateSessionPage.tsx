import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Database } from "../../lib/supabase/database.types";
import { mulberry32, PlayerFairnessState, PlayerId, RoundResult } from "../../lib/scheduling/types";
import { generateAmericanoSchedule } from "../../lib/scheduling/americano";
import { generateMexicanoRound, StandingLookup } from "../../lib/scheduling/mexicano";
import { generateTeamSparringSchedule } from "../../lib/scheduling/teamSparring";
import { generateMixAmericanoSchedule, Gender } from "../../lib/scheduling/mixAmericano";
import { generateMixMexicanoRound } from "../../lib/scheduling/mixMexicano";
import {
  Pair,
  PairFairnessState,
  SidedPlayer,
  formPairsRandom,
  formPairsByPosition,
  makePair,
  generateFixedPartnerSchedule,
  generateFixedPartnerRankedRound,
} from "../../lib/scheduling/fixedPartner";
import { generateInitialRounds } from "../../lib/scheduling/initialSchedule";
import { createLobby, finalizeAndStart, DraftCourt, DraftPlayer } from "../../lib/supabase/sessionActions";
import { listJoinRequests, acknowledgeJoinRequest, rejectJoinRequest, JoinRequest } from "../../lib/supabase/joinRequestQueries";

type SessionFormat = Database["public"]["Tables"]["sessions"]["Row"]["format"];
type ScoringFormat = Database["public"]["Tables"]["sessions"]["Row"]["scoring_format"];
type RankingBasis = Database["public"]["Tables"]["sessions"]["Row"]["ranking_basis"];

const STEPS = ["Name", "Format", "Players", "Courts", "Points", "Review"];

const FORMAT_OPTIONS: { value: SessionFormat; label: string; sub: string; enabled: boolean }[] = [
  { value: "americano", label: "Americano", sub: "Individual · partners rotate every round", enabled: true },
  { value: "mexicano", label: "Mexicano", sub: "Individual · live rank-based pairing", enabled: true },
  { value: "mix_americano", label: "Mix Americano", sub: "Individual · partners rotate, every team gender-mixed", enabled: true },
  { value: "mix_mexicano", label: "Mix Mexicano", sub: "Individual · rank-based pairing, gender-mixed where possible", enabled: true },
  { value: "team_sparring", label: "Team Sparring", sub: "Two fixed teams · Team A vs Team B every match", enabled: true },
];

type TeamScoreMode = "by_point" | "by_win" | "by_round";

const TEAM_SCORE_MODE_OPTIONS: { value: TeamScoreMode; label: string; description: string }[] = [
  {
    value: "by_point",
    label: "Sparring by Point",
    description: "The score is every player's own scored points/games added up per side — e.g. 88 - 60.",
  },
  {
    value: "by_win",
    label: "Sparring by Win",
    description: "+1 to a side every time it wins a match (one court). A running court-win count — e.g. 5 - 3.",
  },
  {
    value: "by_round",
    label: "Sparring by Round",
    description:
      "+1 to whichever side wins the MAJORITY of courts in a round — e.g. win 2 of 3 courts, +1. Needs an odd number of courts (3, 5, 7…) so every round has a decisive winner.",
  },
];

const SCORING_OPTIONS: { value: ScoringFormat; label: string }[] = [
  { value: "fixed_21", label: "Fixed 21 points" },
  { value: "fixed_4_games", label: "Fixed 4 games" },
  { value: "fixed_5_games", label: "Fixed 5 games" },
  { value: "race_4", label: "Race to 4" },
  { value: "race_6", label: "Race to 6" },
];

let tempIdCounter = 0;
function nextTempId(prefix: string) {
  tempIdCounter += 1;
  return `${prefix}-${tempIdCounter}-${Date.now()}`;
}

function stripListPrefix(line: string): string {
  return line.replace(/^\s*\d+\s*[.)\-:]*\s*/, "").trim();
}

/**
 * Auto-calculated Americano round count — no manual guesswork needed.
 * Targets full partner coverage: every player partners with every other
 * player exactly once (the classic round-robin doubles schedule most
 * Americano apps default to). Formula: total unique partnerships (n choose
 * 2) divided by partnerships produced per round (2 per court — one per
 * team), rounded up. Reduces to the familiar "n − 1 rounds" rule when every
 * player is on court every round (courts === players / 4).
 */
function recommendedAmericanoRounds(playerCount: number, courts: number): number {
  if (playerCount < 4 || courts < 1) return 8;
  const totalPartnerships = (playerCount * (playerCount - 1)) / 2;
  const partnershipsPerRound = 2 * courts;
  const rounds = Math.ceil(totalPartnerships / partnershipsPerRound);
  return Math.min(30, Math.max(1, rounds));
}

/**
 * Same idea as recommendedAmericanoRounds, but per side — a court only ever
 * uses ONE pair from each team, so each side rotates through its own
 * partnerships independently (courtsUsed pairs-per-round-per-side, not
 * courtsUsed*2). Takes the larger of the two sides' targets, since an
 * uneven team split means the bigger side needs more rounds to rotate
 * everyone through.
 */
function recommendedTeamSparringRounds(teamACount: number, teamBCount: number, courts: number): number {
  if (teamACount < 2 || teamBCount < 2 || courts < 1) return 8;
  const courtsUsed = Math.max(1, Math.min(courts, Math.floor(teamACount / 2), Math.floor(teamBCount / 2)));
  const roundsForSide = (size: number) => Math.ceil((size * (size - 1)) / 2 / courtsUsed);
  const rounds = Math.max(roundsForSide(teamACount), roundsForSide(teamBCount));
  return Math.min(30, Math.max(1, rounds));
}

/**
 * Fixed Partner's round-robin target: every PAIR plays every other pair
 * exactly once. Same shape as recommendedAmericanoRounds but at pair
 * granularity — one matchup per court per round (not two), since a court is
 * one pair vs one pair, not two individually-formed teams.
 */
function recommendedFixedPartnerRounds(pairCount: number, courts: number): number {
  if (pairCount < 2 || courts < 1) return 8;
  const courtsUsed = Math.max(1, Math.min(courts, Math.floor(pairCount / 2)));
  const totalMatchups = (pairCount * (pairCount - 1)) / 2;
  const rounds = Math.ceil(totalMatchups / courtsUsed);
  return Math.min(30, Math.max(1, rounds));
}

export default function CreateSessionPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<SessionFormat>("americano");
  const [players, setPlayers] = useState<DraftPlayer[]>([]);
  const [courtCount, setCourtCount] = useState(4);
  // Americano only — its whole schedule is generated upfront (score-independent
  // pairing). roundCount is auto-calculated from player/court count (see
  // recommendedAmericanoRounds) so the host never has to count rounds
  // themselves, the way other Americano apps behave — roundCountTouched
  // just remembers whether the host manually overrode that auto value, so
  // we stop re-computing out from under them once they have.
  // Mexicano stays round-by-round since pairing depends on live standings.
  const [roundCount, setRoundCount] = useState(8);
  const [roundCountTouched, setRoundCountTouched] = useState(false);
  // Team Sparring only — how the running Team A vs Team B score is tallied.
  // Defaults to by_point; by_round additionally requires an odd court count
  // (see canUseByRound below) so a round always has a decisive majority
  // winner rather than needing a tie rule.
  const [teamScoreMode, setTeamScoreMode] = useState<TeamScoreMode>("by_point");
  // Fixed Partner — a toggle on the Players step, not a format of its own.
  // It composes with whichever base format (Americano/Mexicano) is picked in
  // the Format step; only available under those two (see fixedPartnerAvailable
  // below). Manual pairing tracks its own list; the two auto modes are
  // recomputed live from the roster (see resolvedPairs below) rather than
  // stored directly, so they always reflect the current player list without
  // going stale.
  const [fixedPartnerEnabled, setFixedPartnerEnabled] = useState(false);
  const [pairingMode, setPairingMode] = useState<"manual" | "auto_random" | "auto_position">("auto_random");
  const [manualPairs, setManualPairs] = useState<Pair[]>([]);
  const [manualPairPending, setManualPairPending] = useState<string | null>(null);
  const [pairShuffleNonce, setPairShuffleNonce] = useState(0);
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>("fixed_21");
  const [rankingBasis, setRankingBasis] = useState<RankingBasis>("points_first");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [schedulingSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000));

  // Lobby: the Players step mints a draft session so its join code is live and
  // people can join while setup continues. Confirmed joins merge into `players`.
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);

  const courts: DraftCourt[] = useMemo(
    () => Array.from({ length: courtCount }, (_, i) => ({ tempId: `court-${i}`, name: `Court ${i + 1}` })),
    [courtCount],
  );

  const minPlayersNeeded = courtCount * 4;
  const isTeamSparring = format === "team_sparring";
  // Fixed Partner only makes sense layered on Americano (round-robin
  // rotation) or Mexicano (rank-based pairing) — the toggle auto-resets (see
  // effect below) if the host switches to a format that doesn't support it,
  // so it can never linger stale under an unrelated format.
  const fixedPartnerAvailable = format === "americano" || format === "mexicano";
  const isFixedPartner = fixedPartnerEnabled && fixedPartnerAvailable;
  const fixedPartnerStyle: "round_robin" | "rank_based" | undefined = !isFixedPartner
    ? undefined
    : format === "mexicano"
      ? "rank_based"
      : "round_robin";
  const isMixAmericano = format === "mix_americano";
  const isMixMexicano = format === "mix_mexicano";
  const needsGenderMix = isMixAmericano || isMixMexicano;
  // Formats whose entire schedule is generated upfront (score-independent
  // pairing) vs. round-by-round (pairing depends on live standings). Fixed
  // Partner inherits its base format's upfront-ness automatically — the
  // round_robin flavor only ever pairs with format === "americano" (already
  // upfront) and rank_based only ever pairs with "mexicano" (already
  // round-by-round) — so no separate isFixedPartner term is needed here.
  const needsUpfrontSchedule = format === "americano" || format === "team_sparring" || isMixAmericano;

  const genderById = useMemo(() => new Map<PlayerId, Gender>(players.map((p) => [p.tempId, p.gender])), [players]);

  // Fixed Partner only — the pairing the schedule will actually use, derived
  // fresh from the roster + chosen pairing mode every render. Manual mode
  // just filters manualPairs down to players who still exist (a removed
  // player silently drops their pair rather than leaving a dangling one);
  // both auto modes recompute from scratch, so they always reflect the
  // current roster instead of a stale snapshot.
  const resolvedPairs: Pair[] = useMemo(() => {
    if (!isFixedPartner) return [];
    if (pairingMode === "manual") {
      const activeIds = new Set(players.map((p) => p.tempId));
      return manualPairs.filter((pair) => activeIds.has(pair.playerA) && activeIds.has(pair.playerB));
    }
    // Offset well clear of the round-seeding space (schedulingSeed + 1..30)
    // so "shuffle pairs again" can never accidentally reuse a seed a round
    // generator will also use later.
    const rng = mulberry32(schedulingSeed - 1 - pairShuffleNonce);
    if (pairingMode === "auto_position") {
      const sided: SidedPlayer[] = players.map((p) => ({ id: p.tempId, side: p.preferredSide ?? "right" }));
      return formPairsByPosition(sided, rng);
    }
    return formPairsRandom(
      players.map((p) => p.tempId),
      rng,
    );
  }, [isFixedPartner, pairingMode, manualPairs, players, schedulingSeed, pairShuffleNonce]);

  const unpairedPlayerIds = useMemo(() => {
    if (!isFixedPartner) return [];
    const pairedSet = new Set(resolvedPairs.flatMap((p) => [p.playerA, p.playerB]));
    return players.filter((p) => !pairedSet.has(p.tempId)).map((p) => p.tempId);
  }, [isFixedPartner, resolvedPairs, players]);

  // Team Sparring only — a court needs one pair from EACH side, so an
  // uneven team split can cap usable courts below what raw player count
  // alone would allow (unlike every other format, where any 4 players fill
  // a court).
  const teamACount = players.filter((p) => p.teamSide === "A").length;
  const teamBCount = players.filter((p) => p.teamSide === "B").length;
  const maxCourtsByTeamBalance = Math.min(Math.floor(teamACount / 2), Math.floor(teamBCount / 2));

  const courtsOk = players.length >= minPlayersNeeded && (!isTeamSparring || courtCount <= maxCourtsByTeamBalance);
  const suggestedCourts = isTeamSparring
    ? Math.min(Math.max(1, Math.floor(players.length / 4)), Math.max(1, maxCourtsByTeamBalance))
    : Math.max(1, Math.floor(players.length / 4));

  // "Sparring by Round" needs a decisive majority winner every round, which
  // only exists with an odd court count of 3 or more — an even split (e.g.
  // 2-2 on 4 courts) has no majority, and 1 court makes "by round" identical
  // to "by win". If the host picks by_round then changes the court count
  // out from under it, fall back to by_point rather than leaving an invalid
  // mode silently selected.
  const canUseByRound = courtCount > 2 && courtCount % 2 === 1;
  useEffect(() => {
    if (teamScoreMode === "by_round" && !canUseByRound) setTeamScoreMode("by_point");
  }, [teamScoreMode, canUseByRound]);

  // A team-score-mode choice made under Team Sparring shouldn't linger if
  // the host switches away and back to a different format.
  useEffect(() => {
    if (!isTeamSparring) setTeamScoreMode("by_point");
  }, [isTeamSparring]);

  // The Fixed Partner toggle shouldn't linger on if the host switches to a
  // base format that doesn't support it (only Americano/Mexicano do).
  useEffect(() => {
    if (!fixedPartnerAvailable) setFixedPartnerEnabled(false);
  }, [fixedPartnerAvailable]);

  const recommendedRoundCount = useMemo(() => {
    if (isTeamSparring) return recommendedTeamSparringRounds(teamACount, teamBCount, courtCount);
    if (isFixedPartner) return recommendedFixedPartnerRounds(resolvedPairs.length, courtCount);
    return recommendedAmericanoRounds(players.length, courtCount); // shared by Americano + Mix Americano
  }, [isTeamSparring, isFixedPartner, teamACount, teamBCount, resolvedPairs.length, players.length, courtCount]);

  // A manual round-count override made under one format shouldn't silently
  // carry over to a different format's very different recommendation —
  // switching formats clears the override so the new format's auto-calc
  // takes effect fresh.
  useEffect(() => {
    setRoundCountTouched(false);
  }, [format]);

  // Keeps roundCount in sync with the auto-calculated recommendation as the
  // player/court count changes — unless the host has manually overridden it
  // (roundCountTouched), in which case their choice sticks. Applies to every
  // upfront-generated format (Americano, Team Sparring, Fixed Partner, Mix
  // Americano) — all four need a round count decided before Start Session,
  // unlike Mexicano/Mix Mexicano which stay round-by-round.
  useEffect(() => {
    if (!needsUpfrontSchedule || roundCountTouched) return;
    setRoundCount(recommendedRoundCount);
  }, [needsUpfrontSchedule, recommendedRoundCount, roundCountTouched]);

  function handleRoundCountChange(n: number) {
    setRoundCount(n);
    setRoundCountTouched(true);
  }

  function handleResetRoundCount() {
    setRoundCountTouched(false); // the effect above recomputes it from recommendedRoundCount
  }

  // Mint the draft session (→ live join code) the first time the host reaches
  // the Players step. Non-fatal on failure — manual name entry still works.
  useEffect(() => {
    if (step !== 2 || lobbyId || name.trim().length < 2) return;
    createLobby({
      name: name.trim(),
      format,
      scoringFormat,
      rankingBasis,
      teamScoreMode: isTeamSparring ? teamScoreMode : undefined,
      fixedPartnerStyle: isFixedPartner ? fixedPartnerStyle : undefined,
    })
      .then((r) => {
        setLobbyId(r.sessionId);
        setJoinCode(r.joinCode);
      })
      .catch(() => {
        /* code sharing unavailable — the host can still type players in */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, lobbyId, name]);

  // Poll for people asking to join while the host is on the Players step.
  useEffect(() => {
    if (step !== 2 || !lobbyId) return;
    let active = true;
    const load = () => {
      listJoinRequests(lobbyId)
        .then((r) => active && setJoinRequests(r))
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 4000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, [step, lobbyId]);

  // Accept a self-join into the SAME local roster as typed players; the request
  // is marked handled (no DB player yet — finalizeAndStart inserts everyone).
  async function acceptJoin(r: JoinRequest) {
    setPlayers((prev) => [
      ...prev,
      {
        tempId: nextTempId("p"),
        name: r.displayName,
        gender: r.gender,
        teamSide: nextAutoTeamSide(prev),
        preferredSide: r.preferredSide === "L" ? "left" : r.preferredSide === "R" ? "right" : undefined,
      },
    ]);
    setJoinRequests((prev) => prev.filter((x) => x.id !== r.id));
    try {
      await acknowledgeJoinRequest(r.id);
    } catch {
      /* the player is already in the local roster; a stale request row is harmless */
    }
  }

  async function declineJoin(id: string) {
    setJoinRequests((prev) => prev.filter((x) => x.id !== id));
    try {
      await rejectJoinRequest(id);
    } catch {
      /* ignore */
    }
  }

  async function copyJoinLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join?code=${joinCode}`);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      /* clipboard unavailable — the code is shown as a fallback */
    }
  }

  // Auto-balances new players onto whichever team currently has fewer —
  // Team Sparring only, so the host doesn't have to manually place every
  // single player; the per-player chip (see PlayersStep) still lets them
  // override it. Ignored (undefined) for every other format.
  function nextAutoTeamSide(prev: DraftPlayer[]): "A" | "B" | undefined {
    if (format !== "team_sparring") return undefined;
    const aCount = prev.filter((p) => p.teamSide === "A").length;
    const bCount = prev.filter((p) => p.teamSide === "B").length;
    return aCount <= bCount ? "A" : "B";
  }

  function addSinglePlayer(rawName: string) {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    setPlayers((prev) => [...prev, { tempId: nextTempId("p"), name: trimmed, gender: "M", teamSide: nextAutoTeamSide(prev) }]);
  }

  function addBulkPlayers(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map(stripListPrefix)
      .filter(Boolean);
    setPlayers((prev) => {
      const added: DraftPlayer[] = [];
      for (const n of lines) {
        added.push({ tempId: nextTempId("p"), name: n, gender: "M", teamSide: nextAutoTeamSide([...prev, ...added]) });
      }
      return [...prev, ...added];
    });
  }

  function toggleGender(tempId: string) {
    setPlayers((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, gender: p.gender === "M" ? "F" : "M" } : p)));
  }

  function toggleTeamSide(tempId: string) {
    setPlayers((prev) =>
      prev.map((p) => (p.tempId === tempId ? { ...p, teamSide: p.teamSide === "A" ? "B" : "A" } : p)),
    );
  }

  // Fixed Partner's "auto-pair by position" mode only — every other pairing
  // mode ignores this. Defaults display as "right" (see resolvedPairs)
  // until the host taps to flip it, so nothing needs setting up front.
  function togglePreferredSide(tempId: string) {
    setPlayers((prev) =>
      prev.map((p) =>
        p.tempId === tempId ? { ...p, preferredSide: (p.preferredSide ?? "right") === "left" ? "right" : "left" } : p,
      ),
    );
  }

  // Fixed Partner manual pairing: tap one player (marks them "pending"),
  // tap a second to link them — tapping the pending player again cancels.
  function tapPlayerForPairing(tempId: string) {
    setManualPairPending((pending) => {
      if (pending === null) return tempId;
      if (pending === tempId) return null;
      setManualPairs((prev) => [...prev, makePair(pending, tempId)]);
      return null;
    });
  }

  function unpairManual(pairId: string) {
    setManualPairs((prev) => prev.filter((p) => p.pairId !== pairId));
  }

  // Backfills teamSide for any player added before Team Sparring was picked
  // (e.g. the host added players, then changed format) so the team counts
  // and the chip labels can never disagree — every player is guaranteed a
  // real 'A'/'B' the moment this format is selected.
  useEffect(() => {
    if (!isTeamSparring) return;
    setPlayers((prev) => {
      if (prev.every((p) => p.teamSide === "A" || p.teamSide === "B")) return prev;
      let aCount = prev.filter((p) => p.teamSide === "A").length;
      let bCount = prev.filter((p) => p.teamSide === "B").length;
      return prev.map((p) => {
        if (p.teamSide === "A" || p.teamSide === "B") return p;
        const side: "A" | "B" = aCount <= bCount ? "A" : "B";
        if (side === "A") aCount++;
        else bCount++;
        return { ...p, teamSide: side };
      });
    });
  }, [isTeamSparring]);

  function removePlayer(tempId: string) {
    setPlayers((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  // ---- Round preview (recomputed live as the draft changes; frozen for
  // real once Start Session persists it — see sessionActions.ts). Every
  // round is seeded with schedulingSeed + its own 1-based sequence number
  // (matching generateNextRound's convention), so Round 1 always uses
  // schedulingSeed + 1 for every format.
  //
  // Americano and Team Sparring both generate their ENTIRE schedule
  // (roundCount rounds) upfront, since neither one's pairing depends on
  // scores. Mexicano still only ever previews Round 1 — its later rounds
  // depend on standings that don't exist yet, so they're generated
  // round-by-round after each is scored. ----
  const previewRounds: RoundResult[] = useMemo(() => {
    // Single source of truth shared with the lobby's Start (see initialSchedule.ts).
    return generateInitialRounds({
      players: players.map((p) => ({ id: p.tempId, gender: p.gender, teamSide: p.teamSide ?? null })),
      courtsAvailable: courtCount,
      format,
      schedulingSeed,
      roundCount,
      fixedPartnerStyle: isFixedPartner ? fixedPartnerStyle : null,
      pairs: isFixedPartner ? resolvedPairs : undefined,
    });
  }, [players, courtCount, format, schedulingSeed, roundCount, resolvedPairs, isFixedPartner, fixedPartnerStyle]);

  const nameByTempId = useMemo(() => new Map(players.map((p) => [p.tempId, p.name])), [players]);

  const canProceed = (() => {
    if (step === 0) return name.trim().length >= 2 && name.trim().length <= 80;
    // Players step is the lobby now — people can still be joining by code, so
    // don't gate moving on by count. "At least 4" is enforced at Start instead.
    if (step === 3) return courtsOk;
    return true;
  })();

  // Start fills the draft session (minted on the Players step) with the final
  // roster — typed players plus everyone who joined by code — and its computed
  // round preview, then goes live. Falls back to minting the draft here if the
  // Players-step effect never ran (e.g. it failed earlier).
  async function handleStart() {
    if (previewRounds.length === 0) return;
    setStarting(true);
    setStartError(null);
    try {
      let sid = lobbyId;
      if (!sid) {
        const created = await createLobby({
          name: name.trim(),
          format,
          scoringFormat,
          rankingBasis,
          teamScoreMode: isTeamSparring ? teamScoreMode : undefined,
          fixedPartnerStyle: isFixedPartner ? fixedPartnerStyle : undefined,
        });
        sid = created.sessionId;
        setLobbyId(sid);
        setJoinCode(created.joinCode);
      }
      await finalizeAndStart(
        sid,
        {
          name: name.trim(),
          format,
          scoringFormat,
          rankingBasis,
          players,
          courts,
          teamScoreMode: isTeamSparring ? teamScoreMode : undefined,
          pairs: isFixedPartner ? resolvedPairs : undefined,
          fixedPartnerStyle: isFixedPartner ? fixedPartnerStyle : undefined,
        },
        previewRounds,
        schedulingSeed,
      );
      navigate(`/session/${sid}/host`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start the session.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="w-9 h-9 -ml-0.5 mb-3 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
      >
        ‹
      </button>
      <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1] mb-1">Create session</h1>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-4">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>

      <div className="flex gap-1.5 mb-5">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i)}
            aria-label={s}
            className={`flex-1 h-1 rounded-full ${i < step ? "bg-gold" : i === step ? "bg-graphite" : "bg-stone"}`}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-2">
          <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Session name</label>
          <input
            className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tuesday Night Padel"
            maxLength={80}
          />
          <p className="text-[11px] text-warm-gray">2-80 characters, required.</p>
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1] mb-1">How do you want to play?</h2>
          <p className="text-[13.5px] text-ink-2 leading-relaxed mb-5">Pick a format. We'll handle the rotations so every game stays fair.</p>
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={!opt.enabled}
              onClick={() => setFormat(opt.value)}
              className={`w-full text-left rounded-2xl border px-4 py-3.5 mb-2.5 flex items-center justify-between gap-3 ${
                !opt.enabled
                  ? "border-dashed border-line text-warm-gray/50 cursor-not-allowed"
                  : format === opt.value
                    ? "border-graphite bg-graphite"
                    : "border-line bg-surface"
              }`}
            >
              <div>
                <div className={`text-[15px] font-semibold ${format === opt.value ? "text-ivory" : "text-graphite"}`}>{opt.label}</div>
                <div className={`text-[11.5px] mt-0.5 leading-snug ${format === opt.value ? "text-ivory/60" : "text-warm-gray"}`}>{opt.sub}</div>
              </div>
              <span
                className={`w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 ${
                  format === opt.value ? "bg-gold text-graphite text-[13px] font-bold" : "border-[1.5px] border-stone"
                }`}
              >
                {format === opt.value ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Lobby: share the code so players can add themselves */}
          {lobbyId && (
            <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">Join code</p>
                  <p className="font-mono tnum text-[26px] font-semibold text-graphite leading-tight tracking-[0.12em]">{joinCode}</p>
                </div>
                <button
                  type="button"
                  onClick={copyJoinLink}
                  className="shrink-0 rounded-full bg-graphite text-ivory text-[12px] font-semibold px-3.5 py-2 active:scale-95 transition-transform"
                >
                  {copiedLink ? "Copied ✓" : "Copy link"}
                </button>
              </div>
              <p className="text-[11px] text-warm-gray mt-2 leading-snug">
                Players enter this code (or open your link) to add themselves — accept them below. Not on the app? Just type their name. QR coming soon.
              </p>
            </div>
          )}

          {joinRequests.length > 0 && (
            <div className="space-y-2">
              {joinRequests.map((r) => (
                <div key={r.id} className="rounded-2xl border border-gold/40 bg-gold-soft/50 px-3.5 py-2.5 anim-rise">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <b className="block text-[14px] font-semibold text-graphite truncate">{r.displayName}</b>
                      <p className="text-[11px] text-ink-2 mt-0.5">
                        {r.preferredSide === "L" ? "Left" : r.preferredSide === "R" ? "Right" : "Any side"} · {r.gender === "F" ? "Female" : "Male"}
                        {r.email ? ` · ${r.email}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => declineJoin(r.id)} className="text-[12px] font-semibold text-ink-2 rounded-full border border-line bg-surface px-3 py-1.5">
                        Decline
                      </button>
                      <button type="button" onClick={() => acceptJoin(r)} className="text-[12px] font-semibold text-ivory rounded-full bg-graphite px-3 py-1.5">
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <PlayersStep
            players={players}
            onAddSingle={addSinglePlayer}
            onAddBulk={addBulkPlayers}
            onToggleGender={toggleGender}
            onRemove={removePlayer}
            isTeamSparring={isTeamSparring}
            onToggleTeamSide={toggleTeamSide}
            teamACount={teamACount}
            teamBCount={teamBCount}
            isFixedPartner={isFixedPartner}
            onTogglePreferredSide={togglePreferredSide}
            needsGenderMix={needsGenderMix}
          />
          <FixedPartnerToggle
            available={fixedPartnerAvailable}
            enabled={isFixedPartner}
            onToggle={() => setFixedPartnerEnabled((v) => !v)}
          />
          {isFixedPartner && (
            <FixedPartnerPairingStep
              players={players}
              pairingMode={pairingMode}
              onSetPairingMode={setPairingMode}
              resolvedPairs={resolvedPairs}
              unpairedPlayerIds={unpairedPlayerIds}
              nameByTempId={nameByTempId}
              manualPairPending={manualPairPending}
              onTapPlayer={tapPlayerForPairing}
              onUnpair={unpairManual}
              onShuffle={() => setPairShuffleNonce((n) => n + 1)}
            />
          )}
        </div>
      )}

      {step === 3 && (
        <CourtsStep
          courtCount={courtCount}
          setCourtCount={setCourtCount}
          playerCount={players.length}
          minPlayersNeeded={minPlayersNeeded}
          courtsOk={courtsOk}
          suggestedCourts={suggestedCourts}
          format={format}
          roundCount={roundCount}
          onChangeRoundCount={handleRoundCountChange}
          recommendedRoundCount={recommendedRoundCount}
          roundCountTouched={roundCountTouched}
          onResetRoundCount={handleResetRoundCount}
          isTeamSparring={isTeamSparring}
          teamACount={teamACount}
          teamBCount={teamBCount}
          maxCourtsByTeamBalance={maxCourtsByTeamBalance}
          needsUpfrontSchedule={needsUpfrontSchedule}
          isFixedPartner={isFixedPartner}
        />
      )}

      {step === 4 && (
        <div className="space-y-3">
          {isTeamSparring && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">Team score</label>
              <div className="space-y-2">
                {TEAM_SCORE_MODE_OPTIONS.map((opt) => {
                  const disabled = opt.value === "by_round" && !canUseByRound;
                  return (
                    <button
                      key={opt.value}
                      disabled={disabled}
                      onClick={() => setTeamScoreMode(opt.value)}
                      className={`w-full text-left rounded-2xl border px-4 py-3 ${
                        disabled
                          ? "border-dashed border-line text-warm-gray/50 cursor-not-allowed"
                          : teamScoreMode === opt.value
                            ? "border-graphite bg-graphite"
                            : "border-line bg-surface"
                      }`}
                    >
                      <div className={`font-semibold text-sm ${teamScoreMode === opt.value && !disabled ? "text-ivory" : "text-ink"}`}>{opt.label}</div>
                      <div className={`text-[11px] ${teamScoreMode === opt.value && !disabled ? "text-ivory/60" : "text-warm-gray"}`}>
                        {disabled ? `Needs an odd court count (3, 5, 7…) — you have ${courtCount}.` : opt.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">Scoring format</label>
            <div className="space-y-2">
              {SCORING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setScoringFormat(opt.value)}
                  className={`w-full text-left rounded-2xl border px-4 py-3 text-sm font-semibold ${
                    scoringFormat === opt.value ? "border-graphite bg-graphite text-ivory" : "border-line bg-surface text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">Ranking basis</label>
            <div className="flex rounded-full bg-surface border border-line p-1">
              {(["points_first", "wins_first"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setRankingBasis(v)}
                  className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold ${rankingBasis === v ? "bg-graphite text-ivory" : "text-warm-gray"}`}
                >
                  {v === "points_first" ? "Points first" : "Wins first"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-warm-gray">
            Golden point at deuce (0/15/30/40, next point wins at 40-40) applies to every format.
          </p>
        </div>
      )}

      {step === 5 && (
        <ReviewStep
          name={name}
          format={format}
          players={players}
          courts={courts}
          scoringFormat={scoringFormat}
          rankingBasis={rankingBasis}
          isTeamSparring={isTeamSparring}
          teamScoreMode={teamScoreMode}
          isFixedPartner={isFixedPartner}
          previewRounds={previewRounds}
          nameByTempId={nameByTempId}
          courtsOk={courtsOk}
          minPlayersNeeded={minPlayersNeeded}
          suggestedCourts={suggestedCourts}
          onReduceCourts={() => setCourtCount(suggestedCourts)}
          onStart={handleStart}
          starting={starting}
          startError={startError}
        />
      )}

      {step < 5 && (
        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex-1 flex items-center justify-center rounded-full px-4 py-3 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform disabled:opacity-40"
          >
            Back
          </button>
          <button
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={!canProceed}
            className="flex-1 flex items-center justify-center rounded-full px-4 py-3 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PlayersStep({
  players,
  onAddSingle,
  onAddBulk,
  onToggleGender,
  onRemove,
  isTeamSparring,
  onToggleTeamSide,
  teamACount,
  teamBCount,
  isFixedPartner,
  onTogglePreferredSide,
  needsGenderMix,
}: {
  players: DraftPlayer[];
  onAddSingle: (name: string) => void;
  onAddBulk: (text: string) => void;
  onToggleGender: (tempId: string) => void;
  onRemove: (tempId: string) => void;
  isTeamSparring: boolean;
  onToggleTeamSide: (tempId: string) => void;
  teamACount: number;
  teamBCount: number;
  isFixedPartner: boolean;
  onTogglePreferredSide: (tempId: string) => void;
  needsGenderMix: boolean;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [singleName, setSingleName] = useState("");
  const [bulkText, setBulkText] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex rounded-full bg-surface border border-line p-1">
        <button
          onClick={() => setMode("single")}
          className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold ${mode === "single" ? "bg-graphite text-ivory" : "text-warm-gray"}`}
        >
          Single Add
        </button>
        <button
          onClick={() => setMode("bulk")}
          className={`flex-1 rounded-full py-2 text-[12.5px] font-semibold ${mode === "bulk" ? "bg-graphite text-ivory" : "text-warm-gray"}`}
        >
          Bulk Add
        </button>
      </div>

      {mode === "single" ? (
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
            placeholder="Player name…"
            value={singleName}
            onChange={(e) => setSingleName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onAddSingle(singleName);
                setSingleName("");
              }
            }}
          />
          <button
            onClick={() => {
              onAddSingle(singleName);
              setSingleName("");
            }}
            className="px-4 rounded-full bg-graphite text-ivory text-sm font-semibold"
          >
            + Add
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-graphite/15"
            rows={5}
            placeholder={"One name per line\nOscar\nPriya\nQuinn"}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <button
            onClick={() => {
              onAddBulk(bulkText);
              setBulkText("");
            }}
            className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
          >
            Add all lines as players
          </button>
        </div>
      )}

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">
          Players ({players.length}) — tap a name to toggle M/F
          {isTeamSparring ? ", tap the A/B chip to switch teams" : ""}
          {isFixedPartner ? ", tap the L/R chip for their preferred side" : ""}
        </p>
        {isTeamSparring && (
          <p className="text-[11px] font-semibold text-ink-2 mb-2">
            Team A: <span className="font-mono tnum">{teamACount}</span> players · Team B: <span className="font-mono tnum">{teamBCount}</span> players — new players auto-balance onto whichever team is smaller.
          </p>
        )}
        {isFixedPartner && (
          <p className="text-[11px] text-warm-gray mb-2">
            Preferred side (drive/right or revés/left) only matters if you use "Auto (by side)" pairing below — every other
            pairing mode ignores it.
          </p>
        )}
        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.tempId} className="flex items-center justify-between rounded-2xl border border-line bg-surface px-3 py-2">
              <div className="flex items-center gap-2">
                <button onClick={() => onToggleGender(p.tempId)} className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <span
                    className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${
                      p.gender === "M" ? "bg-graphite text-ivory" : "bg-gold text-graphite"
                    }`}
                  >
                    {p.gender}
                  </span>
                  {p.name}
                </button>
                {isTeamSparring && (
                  <button
                    onClick={() => onToggleTeamSide(p.tempId)}
                    className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                      p.teamSide === "B" ? "bg-gold-soft text-gold-ink border border-gold/30" : "bg-graphite text-ivory"
                    }`}
                  >
                    Team {p.teamSide ?? "A"}
                  </button>
                )}
                {isFixedPartner && (
                  <button
                    onClick={() => onTogglePreferredSide(p.tempId)}
                    className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-surface-2 border border-line text-ink-2"
                  >
                    {(p.preferredSide ?? "right") === "left" ? "Left" : "Right"}
                  </button>
                )}
              </div>
              <button onClick={() => onRemove(p.tempId)} className="text-warm-gray text-sm">
                ✕
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-warm-gray mt-2">
          Minimum 4 players. Gender defaults to Male
          {needsGenderMix
            ? " — set it accurately here, since this format keeps every team one man + one woman."
            : " and only matters for Mix Americano/Mix Mexicano."}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
/** The Players-step toggle that turns Fixed Partner on/off — composes with
 * whichever base format (Americano/Mexicano) is already picked in the Format
 * step, rather than being a format entry of its own. Disabled (with an
 * explanation) under every other base format. */
function FixedPartnerToggle({
  available,
  enabled,
  onToggle,
}: {
  available: boolean;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded-2xl border bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)] ${available ? "border-line" : "border-dashed border-line"}`}>
      <button
        onClick={() => available && onToggle()}
        disabled={!available}
        className="w-full flex items-center justify-between text-left disabled:cursor-not-allowed"
      >
        <div>
          <div className={`font-semibold text-sm ${available ? "text-ink" : "text-warm-gray/60"}`}>Fixed Partner</div>
          <div className="text-[11px] text-warm-gray">
            {available
              ? "Lock partners for the whole session — only opponents rotate."
              : "Only available with Americano or Mexicano as the base format."}
          </div>
        </div>
        <div
          className={`w-10 h-6 rounded-full shrink-0 ml-3 relative transition-colors ${
            enabled ? "bg-graphite" : available ? "bg-stone" : "bg-stone/60"
          }`}
        >
          <div
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-surface shadow transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </div>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
function FixedPartnerPairingStep({
  players,
  pairingMode,
  onSetPairingMode,
  resolvedPairs,
  unpairedPlayerIds,
  nameByTempId,
  manualPairPending,
  onTapPlayer,
  onUnpair,
  onShuffle,
}: {
  players: DraftPlayer[];
  pairingMode: "manual" | "auto_random" | "auto_position";
  onSetPairingMode: (m: "manual" | "auto_random" | "auto_position") => void;
  resolvedPairs: Pair[];
  unpairedPlayerIds: string[];
  nameByTempId: Map<string, string>;
  manualPairPending: string | null;
  onTapPlayer: (tempId: string) => void;
  onUnpair: (pairId: string) => void;
  onShuffle: () => void;
}) {
  const pairedTempIds = new Set(resolvedPairs.flatMap((p) => [p.playerA, p.playerB]));
  const MODE_OPTIONS = [
    { value: "auto_random" as const, label: "Auto (random)" },
    { value: "auto_position" as const, label: "Auto (by side)" },
    { value: "manual" as const, label: "Manual" },
  ];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">Pairing</p>
        <div className="flex rounded-full bg-surface border border-line p-1">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onSetPairingMode(opt.value)}
              className={`flex-1 rounded-full py-2 text-[11px] font-semibold ${
                pairingMode === opt.value ? "bg-graphite text-ivory" : "text-warm-gray"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {pairingMode === "manual" ? (
        <div className="space-y-2">
          <p className="text-[11px] text-warm-gray">
            Tap a player, then tap who they're partnering with. Already-paired players are greyed out — unpair them below first
            to change a pairing.
          </p>
          <div className="flex flex-wrap gap-2">
            {players.map((p) => (
              <button
                key={p.tempId}
                onClick={() => onTapPlayer(p.tempId)}
                disabled={pairedTempIds.has(p.tempId)}
                className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                  pairedTempIds.has(p.tempId)
                    ? "border-dashed border-line text-warm-gray/50 cursor-not-allowed"
                    : manualPairPending === p.tempId
                      ? "border-graphite bg-graphite text-ivory"
                      : "border-line bg-surface text-ink"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button onClick={onShuffle} className="w-full flex items-center justify-center rounded-full px-4 py-3 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform">
          🔀 Shuffle pairs again
        </button>
      )}

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">
          Pairs ({resolvedPairs.length})
          {pairingMode !== "manual" ? " — auto-generated, updates automatically if the roster changes" : ""}
        </p>
        {resolvedPairs.length === 0 ? (
          <p className="text-xs text-warm-gray">No pairs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {resolvedPairs.map((pair) => (
              <div
                key={pair.pairId}
                className="flex items-center justify-between rounded-2xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink"
              >
                <span>
                  {nameByTempId.get(pair.playerA) ?? "?"} & {nameByTempId.get(pair.playerB) ?? "?"}
                </span>
                {pairingMode === "manual" && (
                  <button onClick={() => onUnpair(pair.pairId)} className="text-warm-gray">
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {unpairedPlayerIds.length > 0 && (
          <p className="text-[11px] text-gold-ink bg-gold-soft border border-gold/30 rounded-lg px-2 py-1.5 mt-2">
            {unpairedPlayerIds.length} player{unpairedPlayerIds.length > 1 ? "s" : ""} not yet paired —{" "}
            {unpairedPlayerIds.map((id) => nameByTempId.get(id) ?? "?").join(", ")} won't be scheduled until paired.
            {pairingMode !== "manual" && " An odd total player count always leaves exactly one out."}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function CourtsStep({
  courtCount,
  setCourtCount,
  playerCount,
  minPlayersNeeded,
  courtsOk,
  suggestedCourts,
  format,
  roundCount,
  onChangeRoundCount,
  recommendedRoundCount,
  roundCountTouched,
  onResetRoundCount,
  isTeamSparring,
  teamACount,
  teamBCount,
  maxCourtsByTeamBalance,
  needsUpfrontSchedule,
  isFixedPartner,
}: {
  courtCount: number;
  setCourtCount: (n: number) => void;
  playerCount: number;
  minPlayersNeeded: number;
  courtsOk: boolean;
  suggestedCourts: number;
  format: SessionFormat;
  roundCount: number;
  onChangeRoundCount: (n: number) => void;
  recommendedRoundCount: number;
  roundCountTouched: boolean;
  onResetRoundCount: () => void;
  isTeamSparring: boolean;
  teamACount: number;
  teamBCount: number;
  maxCourtsByTeamBalance: number;
  needsUpfrontSchedule: boolean;
  isFixedPartner: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray">Court count</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCourtCount(Math.max(1, courtCount - 1))}
            className="w-8 h-8 rounded-full border border-line text-ink font-semibold"
          >
            −
          </button>
          <b className="font-mono tnum text-ink">{courtCount}</b>
          <button
            onClick={() => setCourtCount(Math.min(6, courtCount + 1))}
            className="w-8 h-8 rounded-full border border-line text-ink font-semibold"
          >
            +
          </button>
        </div>
      </div>

      {isTeamSparring && (
        <div
          className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${
            courtCount <= maxCourtsByTeamBalance
              ? "border-line bg-surface-2 text-ink-2"
              : "border-gold/40 bg-gold-soft text-gold-ink"
          }`}
        >
          Team A: {teamACount} players · Team B: {teamBCount} players
          {courtCount <= maxCourtsByTeamBalance
            ? ` — enough on both sides for ${courtCount} court${courtCount > 1 ? "s" : ""}.`
            : ` — only enough for ${maxCourtsByTeamBalance} court${maxCourtsByTeamBalance === 1 ? "" : "s"} right now (a court needs 2 players from each side).`}
          {courtCount > maxCourtsByTeamBalance && maxCourtsByTeamBalance >= 1 && (
            <button
              onClick={() => setCourtCount(maxCourtsByTeamBalance)}
              className="mt-2 w-full flex items-center justify-center rounded-full px-4 py-2 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform"
            >
              Reduce to {maxCourtsByTeamBalance} court{maxCourtsByTeamBalance === 1 ? "" : "s"}
            </button>
          )}
          {maxCourtsByTeamBalance < 1 && (
            <p className="mt-2">Go back to the Players step and rebalance the teams — each side needs at least 2 players.</p>
          )}
        </div>
      )}

      {needsUpfrontSchedule && (
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray block">Rounds</span>
              <span className="text-[11px] text-warm-gray">
                {roundCountTouched
                  ? "Custom — overriding the auto-calculated schedule length."
                  : isTeamSparring
                    ? "Auto-calculated so everyone rotates through their own team's partnerships. No need to count — this is done for you."
                    : isFixedPartner
                      ? "Auto-calculated so every pair plays every other pair once. No need to count — this is done for you."
                      : "Auto-calculated so everyone partners with everyone once. No need to count — this is done for you."}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <button
                onClick={() => onChangeRoundCount(Math.max(1, roundCount - 1))}
                className="w-8 h-8 rounded-full border border-line text-ink font-semibold"
              >
                −
              </button>
              <b className="font-mono tnum text-ink">{roundCount}</b>
              <button
                onClick={() => onChangeRoundCount(Math.min(30, roundCount + 1))}
                className="w-8 h-8 rounded-full border border-line text-ink font-semibold"
              >
                +
              </button>
            </div>
          </div>
          {roundCountTouched && roundCount !== recommendedRoundCount && (
            <button onClick={onResetRoundCount} className="mt-2 text-[11px] font-semibold text-gold-ink underline">
              Reset to auto-calculated ({recommendedRoundCount})
            </button>
          )}
        </div>
      )}

      {courtsOk ? (
        <div className="rounded-2xl border border-win/30 bg-win-soft text-win text-xs font-semibold px-4 py-3">
          ✓ Enough players for {courtCount} court{courtCount > 1 ? "s" : ""} ({playerCount} active, {minPlayersNeeded} needed).
        </div>
      ) : playerCount < minPlayersNeeded ? (
        // Team Sparring's own shortfall (team imbalance with enough total
        // players) is already explained by the team-balance panel above —
        // this generic panel only covers the plain "not enough players at
        // all" case, so the two messages never contradict each other.
        <div className="rounded-2xl border border-gold/40 bg-gold-soft text-gold-ink text-xs font-semibold px-4 py-3">
          {courtCount} courts need {minPlayersNeeded} players (4 per court) — you have {playerCount}, short by{" "}
          {minPlayersNeeded - playerCount}.
          <button
            onClick={() => setCourtCount(suggestedCourts)}
            className="mt-2 w-full flex items-center justify-center rounded-full px-4 py-2 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform"
          >
            Reduce to {suggestedCourts} court{suggestedCourts > 1 ? "s" : ""}
          </button>
        </div>
      ) : null}

      <div className="space-y-2">
        {Array.from({ length: courtCount }, (_, i) => (
          <div key={i} className="flex items-center justify-between rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-ink">
            <span>Court {i + 1}</span>
            <span className="text-[11px] font-semibold text-warm-gray bg-surface-2 border border-line rounded-full px-2 py-0.5">Available</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-warm-gray">
        Renaming courts and marking them unavailable mid-session comes with the Manage menu (next build pass).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ReviewStep({
  name,
  format,
  players,
  courts,
  scoringFormat,
  rankingBasis,
  isTeamSparring,
  teamScoreMode,
  isFixedPartner,
  previewRounds,
  nameByTempId,
  courtsOk,
  minPlayersNeeded,
  suggestedCourts,
  onReduceCourts,
  onStart,
  starting,
  startError,
}: {
  name: string;
  format: SessionFormat;
  players: DraftPlayer[];
  courts: DraftCourt[];
  scoringFormat: ScoringFormat;
  rankingBasis: RankingBasis;
  isTeamSparring: boolean;
  teamScoreMode: TeamScoreMode;
  isFixedPartner: boolean;
  previewRounds: RoundResult[];
  nameByTempId: Map<string, string>;
  courtsOk: boolean;
  minPlayersNeeded: number;
  suggestedCourts: number;
  onReduceCourts: () => void;
  onStart: () => void;
  starting: boolean;
  startError: string | null;
}) {
  const formatLabel =
    (FORMAT_OPTIONS.find((f) => f.value === format)?.label ?? format) + (isFixedPartner ? " · Fixed Partner" : "");
  const scoringLabel = SCORING_OPTIONS.find((s) => s.value === scoringFormat)?.label ?? scoringFormat;
  const teamScoreModeLabel = TEAM_SCORE_MODE_OPTIONS.find((o) => o.value === teamScoreMode)?.label ?? teamScoreMode;
  const previewRound = previewRounds[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04)] px-4 py-3 text-xs leading-relaxed text-ink-2">
        <b className="text-graphite">{name || "Untitled session"}</b>
        <br />
        {formatLabel} · <span className="font-mono tnum">{players.length}</span> players · <span className="font-mono tnum">{courts.length}</span> courts
        <br />
        {scoringLabel} · {rankingBasis === "points_first" ? "Points-first" : "Wins-first"} ranking
        {isTeamSparring && (
          <>
            <br />
            Team score: {teamScoreModeLabel}
          </>
        )}
      </div>

      {!courtsOk && (
        <div className="rounded-2xl border border-loss/30 bg-loss-soft text-loss text-xs font-semibold px-4 py-3">
          {players.length < minPlayersNeeded
            ? `${courts.length} courts need ${minPlayersNeeded} players — you have ${players.length}.`
            : "Your two teams aren't balanced enough to fill every court — go back to the Players or Courts step to fix this."}{" "}
          Starting is blocked until this is fixed.
          {players.length >= minPlayersNeeded ? null : (
            <button onClick={onReduceCourts} className="mt-2 w-full flex items-center justify-center rounded-full px-4 py-2 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform">
              Reduce to {suggestedCourts} court{suggestedCourts > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-1">Draw preview — Round 1</p>
        {!previewRound || previewRound.matches.length === 0 ? (
          <p className="text-xs text-warm-gray">Add at least 4 players to see a preview.</p>
        ) : (
          <div className="space-y-2">
            {previewRound.matches.map((m, i) => (
              <div key={i} className="rounded-2xl border border-line bg-surface px-3 py-2 text-xs text-ink">
                Court {m.courtIndex + 1}: {format === "team_sparring" ? "Team A — " : ""}
                {m.teamA.map((id) => nameByTempId.get(id)).join(" & ")} vs{" "}
                {format === "team_sparring" ? "Team B — " : ""}
                {m.teamB.map((id) => nameByTempId.get(id)).join(" & ")}
              </div>
            ))}
            {previewRound.restingIds.length > 0 && (
              <p className="text-xs text-ink-2">
                Resting: {previewRound.restingIds.map((id) => nameByTempId.get(id)).join(", ")}
              </p>
            )}
            <p className="text-[11px] text-warm-gray italic">{previewRound.explanation}</p>
            {previewRounds.length > 1 && (
              <p className="text-xs font-semibold text-ink-2">
                + {previewRounds.length - 1} more round{previewRounds.length - 1 > 1 ? "s" : ""} generated automatically —
                the whole schedule is ready the moment you start.
              </p>
            )}
          </div>
        )}
      </div>

      {startError && <p className="text-[13px] text-loss">{startError}</p>}

      <button
        onClick={onStart}
        disabled={!courtsOk || previewRounds.length === 0 || starting}
        className="w-full flex items-center justify-center rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-40"
      >
        {starting ? "Starting…" : "Start Session"}
      </button>
    </div>
  );
}
