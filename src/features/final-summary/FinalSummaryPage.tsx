import PageHeader from "../shell/PageHeader";
import ErrorNote from "../shell/ErrorNote";
import { withFallback } from "../../lib/errors";
import { BottomSheet } from "../shell/Sheet";
import { useEffect, useState } from "react";
import { notify } from "../../lib/nativeShell";
import { Link, useNavigate, useParams } from "react-router-dom";
import { StandingsRow } from "../../lib/supabase/standingsQueries";
import { getPublicSessionById, PublicSessionData } from "../../lib/supabase/publicSessionQueries";
import { renderRecapCard } from "../../lib/recap/renderRecapCard";

const FORMAT_LABELS: Record<string, string> = {
  americano: "Americano",
  mexicano: "Mexicano",
  mix_americano: "Mix Americano",
  mix_mexicano: "Mix Mexicano",
  side_americano: "Fixed Position",
  fixed_partner: "Fixed Partner",
  team_sparring: "Team Sparring",
};

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
 * Champion / final-summary screen (`/session/:sessionId/final`).
 *
 * THE RULE: once a session has ended, every way into it lands here. Not a
 * different render per entry point — one podium, for the host, for the players,
 * and for whoever the link gets forwarded to. "Standings & rounds" is a button
 * on this page, not a competing destination.
 *
 * That rule is why this page now loads from get_public_session_by_id (0039)
 * instead of getSessionStandings + getRoundHistory + getHostLiveSnapshot. Those
 * three read `players` / `matches` / `rounds` directly, and every policy on
 * those tables is host-scoped — so for anyone but the host they returned an
 * empty result rather than an error, and this page rendered a podium with one
 * name in it and no standings. The RPC returns the same raw ingredients the
 * spectator view uses, fed through the same `assembleStandings`, so the podium
 * here and the board on the host's screen cannot disagree — including the
 * Fixed-Partner case, where the subject is a pair and not a player.
 */
export default function FinalSummaryPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Shareable recap card. The image is rendered first and previewed, so the
  // actual share tap is a fresh user gesture — iOS refuses navigator.share()
  // if the gesture that started it has already been spent on a long await.
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapUrl, setRecapUrl] = useState<string | null>(null);
  const [recapBlob, setRecapBlob] = useState<Blob | null>(null);
  const [recapError, setRecapError] = useState<unknown>(null);

  useEffect(() => () => { if (recapUrl) URL.revokeObjectURL(recapUrl); }, [recapUrl]);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    getPublicSessionById(sessionId)
      .then((d) => {
        if (!d) {
          setError("That session isn't available — it may have been deleted, or never started.");
          return;
        }
        setData(d);
        // The podium landing is the one moment in the app that deserves a
        // flourish, and it is the only success haptic in the whole thing.
        // Fired once, on arrival, not on every re-render — the effect is keyed
        // to the session id.
        void notify("success");
      })
      .catch((err) => setError(withFallback(err, "Couldn't load the results. Check your connection and try again.")))
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

  /** Build the 1080×1920 recap image and show it for review. */
  async function buildRecap() {
    if (!sessionId || !data) return;
    setRecapBusy(true);
    setRecapError(null);
    try {
      const top = data.standings.slice(0, 3);
      const blob = await renderRecapCard({
        sessionName: data.session.name || "Padel session",
        clubName: data.clubName ?? null,
        // renderRecapCard formats this itself (and yields "" for anything it
        // can't parse), so hand it the raw ISO value rather than pre-formatting.
        date: data.sessionDate ?? "",
        formatLabel: FORMAT_LABELS[data.session.format] ?? "",
        playerCount: data.standings.length,
        roundCount: data.rounds.length,
        podium: top.map((r) => ({
          name: r.playerName,
          points: Math.round(r.totalPoints),
          // In Fixed Partner the subject is a pair, so there's no single face to
          // show — the pair's name carries it instead.
          avatarUrl: data.avatarByPlayerId?.get(r.subjectId) ?? null,
        })),
        liveUrl: data.publicToken
          ? `${window.location.origin}/live/${data.publicToken}`
          : window.location.origin,
      });
      if (recapUrl) URL.revokeObjectURL(recapUrl);
      setRecapBlob(blob);
      setRecapUrl(URL.createObjectURL(blob));
    } catch (err) {
      setRecapError(withFallback(err, "Couldn't create the recap image."));
    } finally {
      setRecapBusy(false);
    }
  }

  const recapFileName = `padelier-${(data?.session.name ?? "session").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;

  async function shareRecap() {
    if (!recapBlob) return;
    const file = new File([recapBlob], recapFileName, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: data?.session.name ?? "Padelier" });
        return;
      } catch {
        return; // user dismissed the sheet — not an error worth surfacing
      }
    }
    downloadRecap();
  }

  function downloadRecap() {
    if (!recapUrl) return;
    const a = document.createElement("a");
    a.href = recapUrl;
    a.download = recapFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-10 text-center safe-top safe-bottom anim-fade";

  if (loading) {
    return (
      <div className={shell}>
        <p className="text-[13px] text-warm-gray mt-16">Tallying the final standings…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={shell}>
        <ErrorNote error={error} where="FinalSummaryPage" className="mt-2" />
        <Link to="/" className="inline-block mt-6 text-[13px] font-semibold text-ink-2 underline">
          Back to sessions
        </Link>
      </div>
    );
  }

  const rows: StandingsRow[] = data?.standings ?? [];

  if (rows.length === 0) {
    return (
      <div className={shell}>
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-ink">Session complete</p>
        <h1 className="font-serif text-[34px] font-semibold tracking-tight leading-[1.05] text-graphite mt-2">Well played.</h1>
        <p className="text-[12.5px] text-warm-gray mt-3">This session has no results yet.</p>
        <Link to="/" className="inline-block mt-6 text-[13px] font-semibold text-ink-2 underline">
          Back to sessions
        </Link>
      </div>
    );
  }

  const winner = rows[0];
  const podium = rows.slice(0, 3);
  // The full board, not rows.slice(3). The podium is a summary, not a
  // substitute: with three or fewer subjects a slice(3) table is empty, and in
  // Fixed Partner the subject is a PAIR — so a six-player session has three
  // pairs and the "rest" was nothing at all. Rank 1 appearing both on the
  // podium and at the top of the table is the same thing the spectator view
  // does, and it reads as a summary followed by the detail.
  const rest = rows;
  const roundCount = data?.rounds.length ?? 0;
  const matchCount = data?.matches.filter((m) => m.status === "final").length ?? 0;
  const playerCount = rows.length;
  const sessionName = data?.session.name || "This session";

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
      {/* This screen had no header at all. It's a place, not a task — the
          scores are already saved and you're here to read and share — so it
          gets the tab bar from SubShell and a way back like everything else.
          text-left because `shell` centres everything, which a header must
          not inherit. */}
      <PageHeader className="mb-6 text-left" fallback="/play" />
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-ink">Session complete</p>
      <h1 className="font-serif text-[34px] font-semibold tracking-tight leading-[1.05] text-graphite mt-2">
        Well played, <span className="italic text-gold-ink">{firstNameOf(winner.playerName)}</span>.
      </h1>
      <p className="text-[12.5px] text-warm-gray mb-6">
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
                  : "w-[52px] h-[52px] bg-surface-2 border border-line text-ink-2 text-[15px]"
              }`}
            >
              {initialsOf(row.playerName)}
            </div>
            <p className="text-[12px] font-semibold text-graphite mt-2">{firstNameOf(row.playerName)}</p>
            <p className="font-mono tnum text-[14px] font-bold text-gold-ink">{row.totalPoints}</p>
            <div
              className={`mt-2.5 border border-b-0 rounded-t-xl flex justify-center pt-2 font-mono font-bold ${
                place === 1
                  ? "h-[76px] bg-gold-soft border-gold/30 text-gold-ink"
                  : place === 2
                    ? "h-[54px] bg-surface-2 border-line text-stone"
                    : "h-[40px] bg-surface-2 border-line text-stone"
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
          <div key={stat.label} className="flex-1 bg-surface border border-line rounded-2xl px-2.5 py-3 text-center shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            <b className="font-mono tnum text-[20px] font-semibold text-graphite block">{stat.value}</b>
            <span className="text-[9.5px] uppercase tracking-wide text-warm-gray">{stat.label}</span>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface overflow-hidden shadow-[0_1px_2px_rgba(13,13,13,0.04)] mt-2">
          {rest.map((row) => (
            <div key={row.subjectId} className="flex items-center justify-between px-4 py-2.5 text-[12.5px] text-ink border-t border-line first:border-t-0">
              <span className="text-left">
                <span className="font-mono tnum text-warm-gray w-5 inline-block">{row.rank}</span>
                {row.playerName}
              </span>
              <span className="font-mono tnum text-gold-ink font-semibold">{row.totalPoints}</span>
            </div>
          ))}
        </div>
      )}

      <div className="h-5" />
      <button
        onClick={buildRecap}
        disabled={recapBusy}
        className="w-full rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform disabled:opacity-50"
      >
        {recapBusy ? "Making the recap…" : "Share recap"}
      </button>
      <ErrorNote error={recapError} where="FinalSummaryPage.recap" className="mt-2" />
      <button
        onClick={handleShare}
        className="w-full mt-2.5 rounded-full px-4 py-3.5 font-semibold border-[1.5px] border-line text-ink-2 bg-surface active:scale-[0.99] transition-transform"
      >
        Share link instead
      </button>
      {/* Points at the read-only spectator view, not /host. The host screen is
          gated to the host, so for a player this button used to be a login
          wall on a session they played in. That view has every round, every
          court and the full board, and it works for anyone with the link. */}
      {data?.publicToken && (
        <Link
          to={`/live/${data.publicToken}`}
          className="block w-full mt-2.5 rounded-full px-4 py-3.5 font-semibold border-[1.5px] border-graphite text-graphite bg-surface active:scale-[0.99] transition-transform"
        >
          Standings &amp; rounds
        </Link>
      )}
      <button
        onClick={() => navigate("/")}
        className="w-full mt-2.5 rounded-full px-4 py-3.5 font-semibold text-warm-gray bg-transparent active:opacity-70"
      >
        Back to sessions
      </button>

      {/* Recap preview — review it, then share with a fresh tap */}
      {recapUrl && (
        // Portalled to <body> — nested here it would sit under the tab bar, the
        // same way the club invite sheet did. See features/shell/Sheet.tsx.
        <BottomSheet
          onClose={() => setRecapUrl(null)}
          title="Your recap"
          subtitle="Ready for WhatsApp or Stories — the QR opens the live view."
        >
            <img
              src={recapUrl}
              alt="Session recap card"
              className="w-full rounded-2xl border border-line shadow-[0_1px_2px_rgba(13,13,13,0.06)]"
            />
            <button
              onClick={shareRecap}
              className="w-full mt-4 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
            >
              Share image
            </button>
            <button
              onClick={downloadRecap}
              className="w-full mt-2.5 rounded-full px-4 py-3 font-semibold text-[14px] border-[1.5px] border-line text-ink-2 bg-surface active:scale-[0.99] transition-transform"
            >
              Save to photos
            </button>
            <button
              onClick={() => setRecapUrl(null)}
              className="w-full text-[13.5px] font-semibold text-warm-gray py-3 mt-1 active:opacity-70"
            >
              Done
            </button>
        </BottomSheet>
      )}
    </div>
  );
}
