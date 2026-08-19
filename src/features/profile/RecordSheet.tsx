import Sheet from "../shell/Sheet";
import { FormPill } from "./playerStats";
import { PlayerInsights } from "../../lib/supabase/insightsQueries";

/**
 * The record, opened up.
 *
 * The card on the profile answers "how am I doing" in one number. This answers
 * the questions that follow it, and they're all questions about context rather
 * than more numbers: is that win rate recent or historical, do I win close
 * games or get thrashed, and am I on a run right now.
 *
 * It's a sheet rather than a page because it's a detour, not a destination —
 * you look, you close, you're back where you were. Everything in it is
 * computed from data the profile already fetched, so opening it costs nothing.
 */

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** One of the two record columns. */
function Column({
  title,
  caption,
  wins,
  losses,
  draws,
  matches,
  winRate,
  muted,
}: {
  title: string;
  caption: string;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  winRate: number;
  muted?: boolean;
}) {
  return (
    <div className={`flex-1 rounded-2xl bg-surface px-4 py-3.5 ${muted ? "opacity-60" : ""}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-warm-gray">{title}</p>
      <p className="font-mono tnum text-[26px] font-semibold text-graphite leading-none mt-2">
        {matches > 0 ? Math.round(winRate * 100) : "–"}
        {matches > 0 && <span className="text-[13px] text-warm-gray font-semibold">%</span>}
      </p>
      <p className="font-mono tnum text-[13px] font-semibold mt-2 leading-none">
        <span className="text-win">{wins}</span>
        <span className="text-stone"> · </span>
        <span className="text-loss">{losses}</span>
        <span className="text-stone"> · </span>
        <span className="text-warm-gray">{draws}</span>
      </p>
      <p className="text-[10.5px] text-warm-gray mt-2">{caption}</p>
    </div>
  );
}

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-t border-line first:border-t-0">
      <span className="text-[13px] text-ink-2">{label}</span>
      <span className="text-right">
        <span className="font-mono tnum text-[14px] font-semibold text-graphite">{value}</span>
        {hint && <span className="block text-[10.5px] text-warm-gray mt-0.5">{hint}</span>}
      </span>
    </div>
  );
}

const STREAK_WORD: Record<"W" | "L" | "D", string> = {
  W: "wins in a row",
  L: "losses in a row",
  D: "draws in a row",
};

export default function RecordSheet({
  insights,
  onClose,
}: {
  insights: PlayerInsights;
  onClose: () => void;
}) {
  const { allTime, last30, currentStreak, bestWinStreak, worstLossStreak, formAll } = insights;

  // Points only exist for matches whose score was actually entered, so this
  // is an average over games played rather than a per-game guarantee.
  const avgFor = allTime.matches > 0 ? allTime.pointsFor / allTime.matches : 0;
  const avgAgainst = allTime.matches > 0 ? allTime.pointsAgainst / allTime.matches : 0;
  const diff = allTime.pointsFor - allTime.pointsAgainst;

  // Twenty is enough to see a shape without turning the sheet into a wall.
  const recent = formAll.slice(-20);

  return (
    <Sheet>
      <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-graphite/55 anim-fade" onClick={onClose} />
        <div className="relative w-full max-w-sm bg-ivory rounded-t-[26px] px-5 pt-2.5 pb-7 anim-rise shadow-[0_-8px_40px_rgba(13,13,13,0.3)] max-h-[92vh] overflow-y-auto">
          <div className="w-9 h-[5px] rounded-full bg-stone/70 mx-auto mb-3.5" />
          <h4 className="font-serif text-[20px] font-semibold text-graphite text-center">Your record</h4>
          <p className="text-[12px] text-warm-gray text-center mt-1 mb-4">
            Every game you've finished, in every session you've played.
          </p>

          <div className="flex gap-2.5">
            <Column
              title="All time"
              caption={`${allTime.matches} ${allTime.matches === 1 ? "game" : "games"}`}
              wins={allTime.wins}
              losses={allTime.losses}
              draws={allTime.draws}
              matches={allTime.matches}
              winRate={allTime.winRate}
            />
            <Column
              title="Last 30 days"
              caption={last30.matches > 0 ? `${last30.matches} ${last30.matches === 1 ? "game" : "games"}` : "nothing yet"}
              wins={last30.wins}
              losses={last30.losses}
              draws={last30.draws}
              matches={last30.matches}
              winRate={last30.winRate}
              muted={last30.matches === 0}
            />
          </div>
          <p className="text-[10.5px] text-warm-gray text-center mt-2">W · L · D</p>

          {/* ── Points ──────────────────────────────────────────────────
              The half of a result the win rate throws away: losing 19–21 all
              night is a different season from losing 6–21. */}
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-6 mb-2 px-1">Points</p>
          <div className="rounded-2xl bg-surface overflow-hidden">
            <Line
              label="Scored"
              value={allTime.pointsFor.toLocaleString()}
              hint={allTime.matches > 0 ? `${avgFor.toFixed(1)} a game` : undefined}
            />
            <Line
              label="Conceded"
              value={allTime.pointsAgainst.toLocaleString()}
              hint={allTime.matches > 0 ? `${avgAgainst.toFixed(1)} a game` : undefined}
            />
            <Line
              label="Difference"
              value={`${diff > 0 ? "+" : ""}${diff.toLocaleString()}`}
              hint={diff === 0 ? "level" : diff > 0 ? "you score more than you concede" : "you concede more than you score"}
            />
          </div>

          {/* ── Streaks ─────────────────────────────────────────────── */}
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-6 mb-2 px-1">Streaks</p>
          <div className="rounded-2xl bg-surface overflow-hidden">
            <Line
              label="Right now"
              value={currentStreak ? `${currentStreak.count}` : "–"}
              hint={currentStreak ? STREAK_WORD[currentStreak.kind] : "no games yet"}
            />
            <Line label="Best winning run" value={`${bestWinStreak}`} hint={bestWinStreak === 1 ? "game" : "games"} />
            <Line label="Longest losing run" value={`${worstLossStreak}`} hint={worstLossStreak === 1 ? "game" : "games"} />
          </div>

          {/* ── Form ────────────────────────────────────────────────────
              The card shows five. This shows twenty, which is where a bad
              night stops looking like a decline. */}
          {recent.length > 0 && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-6 mb-2 px-1">
                Last {recent.length} {recent.length === 1 ? "game" : "games"}
              </p>
              <div className="rounded-2xl bg-surface px-4 py-4">
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((r, i) => (
                    <FormPill key={i} r={r} />
                  ))}
                </div>
                <p className="text-[10.5px] text-warm-gray mt-3">Oldest first · {pct(allTime.winRate)} of everything won</p>
              </div>
            </>
          )}

          <button
            onClick={onClose}
            className="w-full mt-6 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
          >
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
