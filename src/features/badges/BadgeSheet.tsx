import { Link } from "react-router-dom";
import { BottomSheet } from "../shell/Sheet";
import BadgeIcon from "./BadgeIcon";
import { BadgeState, fullDate } from "../../lib/badges/model";

/**
 * Tap a badge: what it is, how it's earned, its levels and the nights that
 * earned it (design canvas, "Tap a badge · detail sheet").
 */
export default function BadgeSheet({
  state,
  clubName,
  self,
  eliteSeen,
  peakRating,
  onClose,
}: {
  state: BadgeState;
  clubName?: string | null;
  /** Your own profile: a rival is named only to you. */
  self: boolean;
  eliteSeen: boolean;
  peakRating?: number | null;
  onClose: () => void;
}) {
  const d = state.def;
  const secret = (d.kind === "hidden" && !state.isEarned) || (d.id === "elite" && !state.isEarned && !eliteSeen);
  const name = secret ? "???" : d.name;
  const kindLine =
    d.kind === "tier"
      ? "Tier badge · kept forever"
      : clubName
        ? `${clubName} · club badge`
        : d.kind === "hidden"
          ? "Hidden badge"
          : "Player badge";

  const recent = [...state.earned].sort((a, b) => b.earnedAt.localeCompare(a.earnedAt)).slice(0, 12);
  const toNext = state.next !== null ? state.next - state.count : null;

  return (
    <BottomSheet onClose={onClose}>
      <div className="flex flex-col items-center text-center pt-1">
        <BadgeIcon state={state} size={84} eliteSeen={eliteSeen} />
        <h2 className="font-serif text-[25px] font-semibold text-graphite mt-3.5 leading-tight">{name}</h2>
        <p className="text-[12.5px] text-gold-ink font-semibold mt-1">{kindLine}</p>
        <p className="text-[13.5px] text-ink-2 mt-2.5 leading-relaxed max-w-[300px]">
          {secret ? "Keep playing to find out." : d.how}
        </p>
        {d.kind === "tier" && peakRating !== null && peakRating !== undefined && (
          <p className="text-[12px] text-warm-gray mt-2">
            Your best settled rating: <b className="font-mono tnum text-graphite">{peakRating}</b>
          </p>
        )}
      </div>

      {d.kind === "levels" && d.levels && (
        <div className="rounded-2xl bg-surface px-3 pt-4 pb-3 mt-5">
          <p className="text-[12px] font-semibold text-warm-gray mx-1 mb-3">Levels</p>
          <div className="flex">
            {d.levels.map((lv) => {
              const got = state.earned.find((e) => e.level === lv);
              return (
                <span key={lv} className="flex-1 flex flex-col items-center gap-1.5">
                  <span
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-mono tnum font-semibold text-[13px] box-border ${
                      got
                        ? lv === d.levels![d.levels!.length - 1]
                          ? "bg-gold text-surface border-2 border-gold"
                          : "bg-gold-soft text-gold-ink border-2 border-gold"
                        : "bg-ivory text-stone border-2 border-dashed border-stone"
                    }`}
                  >
                    {lv}
                  </span>
                  <span className="text-[10.5px] text-warm-gray h-[13px]">
                    {got ? new Date(got.earnedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }) : ""}
                  </span>
                </span>
              );
            })}
          </div>
          {state.next !== null && (
            <>
              <div className="h-[5px] rounded-full bg-[#EFEBE4] mx-1.5 mt-2 overflow-hidden">
                <span className="block h-full bg-gold" style={{ width: `${Math.min(100, Math.round((state.count / state.next) * 100))}%` }} />
              </div>
              <p className="text-[12px] text-ink-2 mx-1 mt-2">
                <b className="font-mono tnum">{state.count}</b> of {state.next} {d.unit} · {toNext} more for the next level
              </p>
            </>
          )}
          {state.next === null && <p className="text-[12px] text-win font-semibold mx-1 mt-2">Every level reached.</p>}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <p className="text-[12px] font-semibold text-warm-gray mt-5 mb-2 mx-1">
            {d.kind === "levels" ? "Earned" : d.kind === "repeat" ? `Earned ${state.earned.length} ${state.earned.length === 1 ? "time" : "times"}` : "Earned"}
          </p>
          <div className="rounded-2xl bg-surface overflow-hidden">
            {recent.map((e) => {
              const detail = e.detail ?? {};
              const extra =
                d.id === "rivalry"
                  ? self && typeof detail.name === "string"
                    ? `${detail.name} · 20 games`
                    : "20 games against one opponent"
                  : typeof detail.score === "string"
                    ? detail.score
                    : typeof detail.gap === "number"
                      ? `Beat a pair rated +${detail.gap}`
                      : typeof detail.delta === "number"
                        ? `Rating +${detail.delta}`
                        : typeof detail.rating === "number"
                          ? `Rated ${detail.rating}`
                          : typeof detail.season === "number"
                            ? `Season ${detail.season}${typeof detail.pos === "number" ? ` · ${ordinal(detail.pos)}` : ""}`
                            : typeof detail.matches === "number"
                              ? `${detail.matches} matches`
                              : d.kind === "levels"
                                ? `Level ${e.level}`
                                : d.kind === "repeat"
                                  ? `×${e.level}`
                                  : "";
              const row = (
                <>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-semibold text-graphite">{fullDate(e.earnedAt)}</span>
                    {extra && <span className="block text-[11.5px] text-warm-gray truncate">{extra}</span>}
                  </span>
                  {e.sessionId && <span className="text-stone text-[16px]">›</span>}
                </>
              );
              return e.sessionId ? (
                <Link
                  key={`${e.level}-${e.earnedAt}`}
                  to={`/session/${e.sessionId}/final`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0 active:bg-surface-2"
                >
                  {row}
                </Link>
              ) : (
                <div key={`${e.level}-${e.earnedAt}`} className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0">
                  {row}
                </div>
              );
            })}
          </div>
          {state.earned.length > recent.length && (
            <p className="text-[11px] text-warm-gray mt-2 mx-1">Showing the latest {recent.length}.</p>
          )}
        </>
      )}

      <button
        onClick={onClose}
        className="w-full mt-5 h-11 rounded-full bg-surface text-ink text-[14px] font-semibold shadow-[0_1px_2px_rgba(13,13,13,0.06)]"
      >
        Close
      </button>
    </BottomSheet>
  );
}

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
