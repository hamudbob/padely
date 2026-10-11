import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import ErrorNote from "../shell/ErrorNote";
import PersonAvatar from "../shell/PersonAvatar";
import { SkeletonScreen, SkeletonLine, SkeletonCourts } from "../shell/Skeleton";
import { tap, notify } from "../../lib/nativeShell";
import { withFallback } from "../../lib/errors";
import { fetchScorerSession } from "../../lib/offline/coHostSync";
import { ensurePushRegistered } from "../../lib/push";
import type { ScorerSession } from "../../lib/offline/coHostMerge";
import { submitCoHostScore, advanceRoundAsCoHost } from "../../lib/supabase/coHostActions";
import { isAutoFillFormat, scoreRangeForFormat, validateAndDeriveScore, ScoringFormat } from "../../lib/scoring/formats";
import { computeStandings, CompletedMatchResult, RankingBasis } from "../../lib/scoring/standings";
import { isFullyPreGeneratedFormat } from "../../lib/scheduling/initialSchedule";

/**
 * The co-host's screen. Two things on it that change anything: entering a
 * score, and starting the next round. Everything else is to read.
 *
 * It reads the server, not the phone: the session belongs to the host's
 * phone, and a co-host holding a second copy would be two phones each sure
 * they had the real one. So this needs signal, and says so when it hasn't.
 */

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  mix_mexicano: "Mix Mexicano",
  side_americano: "Fixed-Position Americano",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

type Tab = "round" | "standings";
type ServerMatch = ScorerSession["matches"][number];

export default function CoHostPage() {
  const { sessionId } = useParams();
  const [data, setData] = useState<ScorerSession | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>("round");
  const [viewedSeq, setViewedSeq] = useState<number | null>(null);

  const [pickerMatch, setPickerMatch] = useState<ServerMatch | null>(null);
  const [pickerSide, setPickerSide] = useState<"A" | "B">("A");
  const [pendingA, setPendingA] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<unknown>(null);
  const followLatest = useRef(true);

  function load() {
    if (!sessionId) return;
    fetchScorerSession(sessionId)
      .then((d) => {
        setData(d);
        setLoadError(null);
        setOffline(false);
      })
      .catch((err) => {
        // Keep showing what we have; only a first load with nothing is an error.
        const isNetwork = typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine;
        if (isNetwork) setOffline(true);
        else setLoadError(withFallback(err, "Could not load this session."));
      });
  }

  useEffect(load, [sessionId]);
  // Someone who just became a co-host wants to hear next time they're made one.
  useEffect(() => {
    void ensurePushRegistered();
  }, []);

  // The host, and any other co-host, are changing this too. Keep current.
  useEffect(() => {
    if (!sessionId) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible" && !pickerMatch && !advancing) load();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pickerMatch, advancing]);

  const derived = useMemo(() => {
    if (!data) return null;
    const rounds = data.rounds.filter((r) => r.status !== "superseded").slice().sort((a, b) => a.sequence - b.sequence);
    const matchesByRound = new Map<string, ServerMatch[]>();
    for (const m of data.matches) {
      const list = matchesByRound.get(m.round_id) ?? [];
      list.push(m);
      matchesByRound.set(m.round_id, list);
    }
    const preGenerated = isFullyPreGeneratedFormat(data.session.format, data.session.fixed_partner_style);
    // The round being played: for a draw-as-you-go format, the newest; for a
    // laid-out schedule, the first one with a court still open.
    const unfinished = rounds.find((r) => (matchesByRound.get(r.id) ?? []).some((m) => m.status !== "final" && m.status !== "cancelled"));
    const current = preGenerated ? unfinished ?? rounds[rounds.length - 1] : rounds[rounds.length - 1];
    return { rounds, matchesByRound, preGenerated, current };
  }, [data]);

  // Follow the round being played unless the co-host has browsed away.
  useEffect(() => {
    if (!derived?.current) return;
    if (followLatest.current || viewedSeq === null) setViewedSeq(derived.current.sequence);
  }, [derived?.current?.sequence]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every hook above this line (see HostLivePage: React error #310).
  if (loadError && !data) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-4 safe-top">
        <PageHeader className="mb-3" fallback="/play" />
        <ErrorNote error={loadError} where="CoHostPage.load" />
        <p className="text-[13px] text-ink-2 mt-3 leading-relaxed">
          If the host removed you as a co-host, or the session has ended, there's nothing to score here.
        </p>
        <Link to="/play" className="inline-block mt-4 rounded-full bg-graphite text-ivory text-[13px] font-semibold px-4 py-2">
          Back to Play
        </Link>
      </div>
    );
  }
  if (!data || !derived) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-4 py-8 safe-top">
        <SkeletonScreen label="Loading this session">
          <SkeletonLine w="62%" h={26} />
          <div className="mt-2 mb-5"><SkeletonLine w="44%" h={11} /></div>
          <SkeletonCourts n={2} />
        </SkeletonScreen>
      </div>
    );
  }

  const session = data.session;
  const format = session.scoring_format as ScoringFormat;
  const range = scoreRangeForFormat(format);
  const autoFill = isAutoFillFormat(format);
  const live = session.status === "live";
  const nameOf = new Map(data.players.map((p) => [p.id, p.display_name]));
  const playerOf = new Map(data.players.map((p) => [p.id, p]));
  const courtName = new Map(data.courts.map((c) => [c.id, c.display_name]));
  const courtOrdinal = new Map(data.courts.map((c) => [c.id, c.ordinal]));

  const { rounds, matchesByRound, preGenerated, current } = derived;
  const viewed = rounds.find((r) => r.sequence === viewedSeq) ?? current;
  const viewedMatches = (viewed ? matchesByRound.get(viewed.id) ?? [] : [])
    .slice()
    .sort((a, b) => (courtOrdinal.get(a.court_id) ?? 0) - (courtOrdinal.get(b.court_id) ?? 0));
  const resting = viewed ? data.round_rests.filter((r) => r.round_id === viewed.id).map((r) => nameOf.get(r.player_id) ?? "Player") : [];
  const viewedIdx = viewed ? rounds.findIndex((r) => r.id === viewed.id) : -1;
  const isCurrent = viewed?.id === current?.id;
  const isLast = viewedIdx === rounds.length - 1;
  const roundDone = viewedMatches.length > 0 && viewedMatches.every((m) => m.status === "final" || m.status === "cancelled");
  const canAdvance = live && !preGenerated && isLast && roundDone;

  function side(m: ServerMatch, s: "A" | "B") {
    return m.participants.filter((p) => p.side === s).map((p) => p.player_id);
  }

  function openPicker(m: ServerMatch, s: "A" | "B") {
    if (!live || m.status === "cancelled") return;
    setPickerMatch(m);
    setPickerSide(autoFill ? s : "A");
    setPendingA(null);
    setSaveError(null);
  }

  async function save(m: ServerMatch, a: number, b: number) {
    const v = validateAndDeriveScore(format, { scoreA: a, scoreB: b });
    if (!v.valid) {
      setSaveError(v.error ?? "Invalid score.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await submitCoHostScore(session.id, m.id, a, b);
      void tap("medium");
      setPickerMatch(null);
      load();
    } catch (err) {
      setSaveError(withFallback(err, "Could not save the score. Check your signal and try again."));
      void notify("warning");
    } finally {
      setSaving(false);
    }
  }

  async function pick(value: number) {
    if (!pickerMatch || saving) return;
    void tap("light");
    if (autoFill) {
      const other = range.max - value;
      if (pickerSide === "A") await save(pickerMatch, value, other);
      else await save(pickerMatch, other, value);
      return;
    }
    if (pickerSide === "A") {
      setPendingA(value);
      setPickerSide("B");
      return;
    }
    if (pendingA !== null) await save(pickerMatch, pendingA, value);
  }

  async function nextRound() {
    setAdvancing(true);
    setAdvanceError(null);
    try {
      await advanceRoundAsCoHost(session.id);
      followLatest.current = true;
      void tap("medium");
      load();
    } catch (err) {
      setAdvanceError(withFallback(err, "Could not start the next round."));
      void notify("warning");
      load(); // someone else may have started it already
    } finally {
      setAdvancing(false);
    }
  }

  function browse(delta: number) {
    const next = rounds[viewedIdx + delta];
    if (!next) return;
    followLatest.current = next.id === current?.id;
    setViewedSeq(next.sequence);
  }

  // ── Standings: the same computeStandings the host's table uses ─────────
  const finals: CompletedMatchResult[] = data.matches
    .filter((m) => m.status === "final" && m.outcome && m.outcome !== "cancelled")
    .map((m) => ({
      matchId: m.id,
      sideA: side(m, "A"),
      sideB: side(m, "B"),
      scoreA: m.score_a ?? 0,
      scoreB: m.score_b ?? 0,
      outcome: m.outcome as "win_a" | "win_b" | "draw",
    }));
  const everPlayed = new Set(data.matches.flatMap((m) => m.participants.map((p) => p.player_id)));
  const roster = data.players.filter((p) => p.status !== "left" || everPlayed.has(p.id)).map((p) => p.id);
  const standings = computeStandings(
    roster,
    finals,
    data.adjustments.filter((a) => a.player_id).map((a) => ({ subjectId: a.player_id as string, amount: a.amount })),
    session.ranking_basis as RankingBasis,
    Math.floor(range.max / 2),
  );

  const activeA = pickerMatch ? side(pickerMatch, "A").map((id) => nameOf.get(id) ?? "Player").join(" & ") : "";
  const activeB = pickerMatch ? side(pickerMatch, "B").map((id) => nameOf.get(id) ?? "Player").join(" & ") : "";

  const isTeamSparring = session.format === "team_sparring";
  const allScoredHere = isCurrent && roundDone;
  // The forward arrow lights up and draws the next round — exactly as on the
  // host's screen — when the round is done and this format draws one at a time.
  const advanceAvailable = canAdvance && !advancing;
  const showTies = format === "fixed_4_games";
  const gridCols = ["1.4rem", "minmax(0,1fr)", "2.9rem", "1.8rem", "1.6rem", showTies ? "1.5rem" : null, "2.7rem"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-4 safe-top safe-bottom relative anim-fade">
      <PageHeader className="mb-3" fallback="/play" />

      {/* Session title + status — the host's header, minus the menu */}
      <div className="flex items-center gap-2.5 mb-1">
        <h1 className="font-serif text-[24px] font-semibold text-graphite tracking-tight leading-tight truncate">{session.name}</h1>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold rounded-full px-2.5 py-1 ${
            live ? "bg-graphite text-ivory" : "bg-surface-2 text-warm-gray border border-line"
          }`}
        >
          {live && <span className="w-1.5 h-1.5 rounded-full bg-court-lime" aria-hidden />}
          {live ? "LIVE" : "ENDED"}
        </span>
      </div>
      <p className="text-[12px] text-warm-gray mb-4">
        {FORMAT_LABELS[session.format] ?? session.format}
        {session.fixed_partner_style ? " · Fixed Partner" : ""}
        {" · "}
        <span className="text-gold-ink font-semibold">Co-host</span>
        {session.host_name ? <> for {session.host_name}</> : null}
      </p>

      {!live && (
        <div className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3">
          <p className="text-[13.5px] font-semibold text-graphite">This session has ended. Scores are locked.</p>
          <Link to={`/session/${session.id}/final`} className="text-[12.5px] text-gold-ink font-semibold">
            See the final standings ›
          </Link>
        </div>
      )}

      {offline && (
        <p className="mb-4 rounded-2xl bg-gold-soft/60 border border-gold/25 px-3.5 py-2.5 text-[12px] text-gold-ink leading-snug">
          No signal. Co-host scores go straight to the server, so they'll work again once you're back online.
        </p>
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

      {tab === "round" && viewed && (
        <>
          {/* Round navigator — the host's, with the same lit › to advance */}
          <div className="flex items-center gap-2 mb-3.5">
            <button
              onClick={() => browse(-1)}
              disabled={viewedIdx <= 0}
              aria-label="Previous round"
              className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ‹
            </button>
            <div className="flex-1 text-center min-w-0">
              <b className="font-serif text-[16px] font-semibold text-graphite">
                Round <span className="font-mono tnum">{viewed.sequence}</span>
              </b>
              <span className={`block text-[10px] mt-0.5 ${advanceAvailable ? "text-win font-semibold" : "text-warm-gray"}`}>
                {advancing
                  ? "Drawing the next round…"
                  : advanceAvailable
                    ? "All scored — tap › for the next round"
                    : preGenerated
                      ? `Round ${viewed.sequence} of ${rounds.length}${!live ? " · session ended" : ""}`
                      : isCurrent && live
                        ? "Current round"
                        : isCurrent
                          ? "Final round · session ended"
                          : `Viewing history${roundDone ? " · scored" : ""}`}
              </span>
            </div>
            <button
              onClick={advanceAvailable ? nextRound : () => browse(1)}
              disabled={advanceAvailable ? advancing : isLast}
              aria-label={advanceAvailable ? "Start next round" : "Next round"}
              className={`w-9 h-9 rounded-full flex items-center justify-center text-[17px] shrink-0 transition-colors ${
                advanceAvailable
                  ? "bg-graphite text-gold disabled:opacity-40"
                  : `bg-surface border border-line text-ink-2 ${isLast ? "opacity-30 cursor-not-allowed" : ""}`
              }`}
            >
              ›
            </button>
          </div>

          {/* Match blocks — score tiles floating over a names card */}
          {viewedMatches.map((m) => {
            const final = m.status === "final" && m.score_a !== null && m.score_b !== null;
            const aWon = final && (m.score_a as number) > (m.score_b as number);
            const bWon = final && (m.score_b as number) > (m.score_a as number);
            const names = (s: "A" | "B") => side(m, s).map((id) => nameOf.get(id) ?? "Player");
            const tile = (s: "A" | "B") => {
              const val = s === "A" ? m.score_a : m.score_b;
              const won = s === "A" ? aWon : bWon;
              return (
                <button
                  onClick={() => openPicker(m, s)}
                  disabled={!live || m.status === "cancelled"}
                  aria-label={`Score for ${names(s).join(" & ")}`}
                  className={`relative w-[62px] h-[54px] rounded-[14px] bg-graphite flex items-center justify-center font-mono tnum text-[25px] font-bold shadow-[0_9px_20px_-13px_rgba(13,13,13,0.5)] disabled:cursor-default ${
                    val === null ? "text-stone" : "text-ivory"
                  }`}
                >
                  {won && <span aria-hidden className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-gold" />}
                  {val ?? "–"}
                </button>
              );
            };
            return (
              <div key={m.id} className="mb-6">
                <div className="text-right text-[13px] font-semibold text-warm-gray mb-2.5">
                  {courtName.get(m.court_id) ?? "Court"}
                  {m.status === "cancelled" ? " · cancelled" : ""}
                </div>
                <div className="flex justify-center gap-3 relative z-[2] -mb-6">
                  {tile("A")}
                  {tile("B")}
                </div>
                <div className="rounded-[18px] border border-line bg-surface px-[18px] pt-8 pb-4 flex items-center justify-between gap-2.5">
                  <div className="flex flex-col min-w-0">
                    {isTeamSparring && <span className="text-[10px] font-bold text-graphite">TEAM A</span>}
                    {names("A").map((n, i) => (
                      <span key={i} className="text-[14.5px] font-semibold text-ink leading-[1.3]">{n}</span>
                    ))}
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-warm-gray shrink-0">vs</span>
                  <div className="flex flex-col items-end text-right min-w-0">
                    {isTeamSparring && <span className="text-[10px] font-bold text-gold-ink">TEAM B</span>}
                    {names("B").map((n, i) => (
                      <span key={i} className="text-[14.5px] font-semibold text-ink leading-[1.3]">{n}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {resting.length > 0 && (
            <p className="mt-3.5 flex gap-2 items-start text-[12px] text-ink-2 leading-relaxed">
              <span className="text-win font-semibold shrink-0">Resting</span>
              <span>{resting.join(", ")} this round — back on court next.</span>
            </p>
          )}

          {live && isCurrent && !roundDone && (
            <p className="text-[10px] text-warm-gray text-center mt-3">
              {preGenerated
                ? "Tap a score tile to enter the result."
                : "Finish scoring every match this round to unlock the next round."}
            </p>
          )}
          {live && preGenerated && isLast && allScoredHere && (
            <p className="text-[10px] text-warm-gray text-center mt-3">Every round is scored. The host ends the session.</p>
          )}
          <ErrorNote error={advanceError} where="CoHostPage.nextRound" className="mt-2" />
        </>
      )}

      {tab === "standings" && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-3">Standings</p>
          <div className="rounded-2xl border border-line bg-surface overflow-hidden">
            <div
              className="grid items-center gap-1.5 px-3 py-2 bg-surface-2 border-b border-line text-[9.5px] font-bold uppercase tracking-wide text-warm-gray"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span className="text-center">#</span>
              <span>Name</span>
              <span className="text-center">GP</span>
              <span className="text-center">W</span>
              <span className="text-center">L</span>
              {showTies && <span className="text-center">T</span>}
              <span className="text-center text-gold-ink">PTS</span>
            </div>
            {standings.map((r) => {
              const p = playerOf.get(r.subjectId);
              const isLeader = r.rank === 1 && finals.length > 0;
              return (
                <div
                  key={r.subjectId}
                  className={`grid items-center gap-1.5 px-3 py-2.5 border-t border-line first:border-t-0 ${isLeader ? "bg-gold-soft/50" : ""}`}
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <span className={`text-center font-mono tnum text-[12px] ${isLeader ? "text-gold-ink font-bold" : "text-warm-gray"}`}>{r.rank}</span>
                  <span className="min-w-0 flex items-center gap-1.5">
                    <PersonAvatar
                      name={p?.display_name ?? "?"}
                      avatarUrl={p?.avatar_url ?? null}
                      linked={!!p?.linked_user_id}
                      size={22}
                      className="ring-2 ring-surface shrink-0"
                    />
                    <span className="min-w-0 flex flex-col leading-tight">
                      <span className="truncate text-[13px] font-semibold text-graphite">{p?.display_name ?? "Player"}</span>
                      {p && !p.linked_user_id && <span className="text-[10px] text-warm-gray">no account</span>}
                    </span>
                    {isTeamSparring && p?.team_side && (
                      <span
                        className={`shrink-0 text-[9px] font-bold rounded px-1 py-0.5 ${
                          p.team_side === "A" ? "bg-graphite text-ivory" : "bg-gold-soft text-gold-ink border border-gold/30"
                        }`}
                      >
                        {p.team_side}
                      </span>
                    )}
                  </span>
                  <span className="text-center font-mono tnum text-[12.5px] text-ink-2">{r.matchesPlayed}</span>
                  <span className="text-center font-mono tnum text-[13px] text-ink-2">{r.wins}</span>
                  <span className="text-center font-mono tnum text-[13px] text-ink-2">{r.losses}</span>
                  {showTies && <span className="text-center font-mono tnum text-[13px] text-ink-2">{r.draws}</span>}
                  <span className="text-center font-mono tnum text-[13px] whitespace-nowrap font-bold text-graphite">
                    {r.totalPoints}
                    {r.restCompensation > 0 && (
                      <span className="align-top text-[8.5px] font-bold text-gold-ink ml-0.5">+{r.restCompensation}</span>
                    )}
                  </span>
                </div>
              );
            })}
            {finals.length === 0 && (
              <p className="text-sm text-warm-gray px-4 py-3">No finished matches yet — standings will fill in as scores come in.</p>
            )}
          </div>
        </div>
      )}

      <p className="text-[10.5px] text-warm-gray text-center mt-8 mb-8 leading-snug px-4">
        As co-host you enter scores and start the next round. Players, courts and settings stay with the host.
      </p>

      {/* Score picker — the host's sheet */}
      {pickerMatch && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-40" onClick={() => !saving && setPickerMatch(null)}>
          <div className="w-full max-w-sm bg-ivory rounded-t-2xl p-4 safe-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1">
              <b className="text-sm text-ink">{courtName.get(pickerMatch.court_id) ?? "Court"}</b>
              <button
                onClick={() => !saving && setPickerMatch(null)}
                className="w-7 h-7 rounded-full bg-surface border border-line text-warm-gray text-xs"
              >
                ✕
              </button>
            </div>
            <p className="text-sm font-semibold text-ink mb-1">
              Entering score for: {isTeamSparring && `Team ${pickerSide} — `}
              {pickerSide === "A" ? activeA : activeB}
            </p>
            {!autoFill && (
              <p className="text-[11px] text-warm-gray mb-2">
                {pickerSide === "B" && pendingA !== null ? (
                  <>
                    {activeA} scored <span className="font-mono tnum">{pendingA}</span>. Now pick {activeB}'s score.
                  </>
                ) : (
                  `Next you'll be asked for ${activeB}'s score.`
                )}
              </p>
            )}
            <p className="text-[11px] text-warm-gray mb-2">
              Valid range <span className="font-mono tnum">{range.min}-{range.max}</span>
              {autoFill ? (
                <>
                  {" "}(opponent auto-fills as <span className="font-mono tnum">{range.max}</span> − this score).
                </>
              ) : (
                "."
              )}
            </p>
            <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto">
              {Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i).map((n) => (
                <button
                  key={n}
                  onClick={() => pick(n)}
                  disabled={saving}
                  className="aspect-square rounded-xl border border-line bg-surface font-mono tnum font-semibold text-graphite active:bg-graphite active:text-ivory disabled:opacity-40"
                >
                  {n}
                </button>
              ))}
            </div>
            <ErrorNote error={saveError} where="CoHostPage.save" className="mt-2" />
            {saving && <p className="text-xs text-warm-gray mt-2">Saving…</p>}
          </div>
        </div>
      )}
    </div>
  );
}
