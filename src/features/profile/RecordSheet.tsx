import { BottomSheet } from "../shell/Sheet";
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

  const share = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
  const shareHint = (v: number | null, games: number) =>
    v === null ? "no scores yet" : `over ${games} ${games === 1 ? "game" : "games"}`;

  // Twenty is enough to see a shape without turning the sheet into a wall.
  const recent = formAll.slice(-20);

  return (
    <BottomSheet
      onClose={onClose}
      title="Your record"
      subtitle="Every game you've finished, in every session you've played."
    >

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

          {/* ── Points won ─────────────────────────────────────────────
              The half of a result the win rate throws away: losing 19–21 all
              night is a different season from losing 6–21.
              A share, not totals. Totals mixed formats into nonsense — one
              night to 21 outweighed a month of race-to-4. Each game counts
              once here, whatever it was played to. */}
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mt-6 mb-2 px-1">Points won</p>
          <div className="rounded-2xl bg-surface overflow-hidden">
            <Line label="All time" value={share(allTime.pointsWon)} hint={shareHint(allTime.pointsWon, allTime.scoredGames)} />
            <Line label="Last 30 days" value={share(last30.pointsWon)} hint={shareHint(last30.pointsWon, last30.scoredGames)} />
          </div>
          <p className="text-[10.5px] text-warm-gray mt-2 px-1">
            Your share of the points in each game. Every game counts the same, whether it went to 21 or first to 4.
          </p>

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
    </BottomSheet>
  );
}
