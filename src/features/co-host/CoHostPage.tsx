import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../shell/PageHeader";
import ErrorNote from "../shell/ErrorNote";
import PersonAvatar from "../shell/PersonAvatar";
import { BottomSheet } from "../shell/Sheet";
import { SkeletonScreen, SkeletonLine, SkeletonCourts } from "../shell/Skeleton";
import { tap, notify } from "../../lib/nativeShell";
import { withFallback } from "../../lib/errors";
import { fetchScorerSession } from "../../lib/offline/coHostSync";
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

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory px-4 safe-top safe-bottom relative anim-fade">
      <PageHeader className="mb-3" fallback="/play" />

      <div className="flex items-center gap-2.5 mb-1">
        <h1 className="font-serif text-[24px] font-semibold text-graphite tracking-tight leading-tight truncate">{session.name}</h1>
        <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold rounded-full px-2.5 py-1 bg-gold-soft text-gold-ink border border-gold/30">
          CO-HOST
        </span>
      </div>
      <p className="text-[12px] text-warm-gray mb-4">
        {FORMAT_LABELS[session.format] ?? session.format}
        {session.host_name ? ` · Host: ${session.host_name}` : ""}
      </p>

      {!live && (
        <div className="rounded-2xl border border-line bg-surface px-4 py-3 mb-4">
          <p className="text-[14px] font-semibold text-graphite">This session has ended.</p>
          <Link to={`/session/${session.id}/final`} className="text-[13px] text-ink-2 underline underline-offset-2">
            See the final standings
          </Link>
        </div>
      )}

      {offline && (
        <p className="rounded-xl bg-gold-soft/60 border border-gold/25 px-3 py-2 text-[12px] text-gold-ink mb-3">
          No signal. Scores you enter as co-host go straight to the server, so they'll work again once you're back online.
        </p>
      )}

      <div className="flex rounded-full bg-surface border border-line p-1 mb-4">
        {(["round", "standings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-2 text-[13px] font-semibold ${tab === t ? "bg-graphite text-ivory" : "text-warm-gray"}`}
          >
            {t === "round" ? "Rounds" : "Standings"}
          </button>
        ))}
      </div>

      {tab === "round" && viewed && (
        <>
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => browse(-1)}
              disabled={viewedIdx <= 0}
              aria-label="Previous round"
              className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 disabled:opacity-30"
            >
              ‹
            </button>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-graphite">Round {viewed.sequence}</p>
              <p className="text-[11px] text-warm-gray">{isCurrent ? "Now playing" : roundDone ? "Finished" : "Coming up"}</p>
            </div>
            <button
              onClick={() => browse(1)}
              disabled={isLast}
              aria-label="Next round"
              className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 disabled:opacity-30"
            >
              ›
            </button>
          </div>

          <div className="space-y-2.5">
            {viewedMatches.map((m) => {
              const final = m.status === "final";
              return (
                <div key={m.id} className="rounded-2xl border border-line bg-surface p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2">
                    {courtName.get(m.court_id) ?? "Court"}
                    {m.status === "cancelled" ? " · cancelled" : ""}
                  </p>
                  {(["A", "B"] as const).map((s) => {
                    const ids = side(m, s);
                    const val = s === "A" ? m.score_a : m.score_b;
                    const won = (s === "A" && m.outcome === "win_a") || (s === "B" && m.outcome === "win_b");
                    return (
                      <button
                        key={s}
                        onClick={() => openPicker(m, s)}
                        disabled={!live || m.status === "cancelled"}
                        className="w-full flex items-center gap-2 py-1.5 text-left disabled:cursor-default"
                      >
                        <span className="flex -space-x-1.5 shrink-0">
                          {ids.map((id) => {
                            const p = playerOf.get(id);
                            return (
                              <PersonAvatar key={id} name={p?.display_name ?? "?"} avatarUrl={p?.avatar_url ?? null} linked={!!p?.linked_user_id} size={24} />
                            );
                          })}
                        </span>
                        <span className={`flex-1 min-w-0 truncate text-[14px] ${won ? "font-semibold text-graphite" : "text-ink-2"}`}>
                          {ids.map((id) => nameOf.get(id) ?? "Player").join(" & ")}
                        </span>
                        <span
                          className={`tnum min-w-[2.6rem] text-center rounded-lg px-2 py-1 text-[16px] font-semibold ${
                            final ? (won ? "bg-graphite text-ivory" : "bg-surface-2 text-ink-2") : "border border-dashed border-line text-warm-gray"
                          }`}
                        >
                          {final ? val : "–"}
                        </span>
                      </button>
                    );
                  })}
                  {live && !final && m.status !== "cancelled" && (
                    <p className="text-[11px] text-warm-gray mt-1">Tap a team to enter the score.</p>
                  )}
                </div>
              );
            })}
          </div>

          {resting.length > 0 && (
            <p className="text-[12px] text-warm-gray mt-3">
              <span className="font-semibold text-ink-2">Resting:</span> {resting.join(", ")}
            </p>
          )}

          {live && isLast && !preGenerated && (
            <div className="mt-5">
              <button
                onClick={nextRound}
                disabled={!canAdvance || advancing}
                className="w-full rounded-full bg-graphite text-ivory text-[14px] font-semibold py-3 disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                {advancing ? "Drawing…" : `Start round ${viewed.sequence + 1}`}
              </button>
              {!canAdvance && (
                <p className="text-[11px] text-warm-gray text-center mt-1.5">Score every court first.</p>
              )}
              <ErrorNote error={advanceError} where="CoHostPage.nextRound" className="mt-2" />
            </div>
          )}
          {live && preGenerated && isLast && roundDone && (
            <p className="text-[12px] text-warm-gray text-center mt-5">Every round is scored. The host ends the session.</p>
          )}
        </>
      )}

      {tab === "standings" && (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden">
          <div className="grid grid-cols-[1.4rem_minmax(0,1fr)_2rem_1.8rem_1.6rem_2.7rem] gap-1.5 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-warm-gray border-b border-line">
            <span>#</span><span>Player</span><span className="text-right">GP</span><span className="text-right">W</span><span className="text-right">L</span><span className="text-right">PTS</span>
          </div>
          {standings.map((r) => {
            const p = playerOf.get(r.subjectId);
            return (
              <div key={r.subjectId} className="grid grid-cols-[1.4rem_minmax(0,1fr)_2rem_1.8rem_1.6rem_2.7rem] gap-1.5 items-center px-3.5 py-2 border-b border-line last:border-b-0">
                <span className="tnum text-[12px] text-warm-gray">{r.rank}</span>
                <span className="flex items-center gap-2 min-w-0">
                  <PersonAvatar name={p?.display_name ?? "?"} avatarUrl={p?.avatar_url ?? null} linked={!!p?.linked_user_id} size={22} />
                  <span className="truncate text-[13px] text-graphite">{p?.display_name ?? "Player"}</span>
                </span>
                <span className="tnum text-right text-[12px] text-ink-2">{r.matchesPlayed}</span>
                <span className="tnum text-right text-[12px] text-ink-2">{r.wins}</span>
                <span className="tnum text-right text-[12px] text-ink-2">{r.losses}</span>
                <span className="tnum text-right text-[13px] font-semibold text-graphite">{r.totalPoints}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-warm-gray text-center mt-6 mb-8 leading-snug">
        As co-host you can enter scores and start the next round. Players, courts and settings stay with the host.
      </p>

      {pickerMatch && (
        <BottomSheet
          onClose={() => !saving && setPickerMatch(null)}
          title={autoFill ? `Score for ${pickerSide === "A" ? activeA : activeB}` : pickerSide === "A" ? activeA : activeB}
          subtitle={
            autoFill
              ? `The other team gets ${range.max} minus this.`
              : pickerSide === "A"
                ? `Their score, then ${activeB}'s.`
                : `${activeA} has ${pendingA}. Now ${activeB}.`
          }
        >
          <div className="grid grid-cols-6 gap-2 pb-2">
            {Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i).map((n) => (
              <button
                key={n}
                onClick={() => pick(n)}
                disabled={saving}
                className="tnum aspect-square rounded-xl border border-line bg-surface text-[16px] font-semibold text-graphite active:bg-graphite active:text-ivory disabled:opacity-50"
              >
                {n}
              </button>
            ))}
          </div>
          {saving && <p className="text-[12px] text-warm-gray text-center">Saving…</p>}
          <ErrorNote error={saveError} where="CoHostPage.save" className="mt-2" />
        </BottomSheet>
      )}
    </div>
  );
}
