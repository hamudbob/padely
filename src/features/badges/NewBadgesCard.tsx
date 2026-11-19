import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BadgeIcon from "./BadgeIcon";
import BadgeSheet from "./BadgeSheet";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getBadges, refreshMyBadges } from "../../lib/supabase/badgeQueries";
import { BadgeState, BadgesData, buildShelf, earnedOnNight } from "../../lib/badges/model";
import { shareUrl } from "../../lib/shareLink";

/**
 * "New badges" on the results screen (design canvas, "Results screen · new
 * badges"): what the signed-in player earned on this night. Shown only to
 * someone who earned something; everyone else sees the results as before.
 */
export default function NewBadgesCard({ sessionId }: { sessionId: string }) {
  const { user } = useHostSession();
  const [data, setData] = useState<BadgesData | null>(null);
  const [open, setOpen] = useState<BadgeState | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let live = true;
    // Work them out now rather than wait for the nightly run: the session's
    // own end usually did it already, and this is cheap if nothing changed.
    refreshMyBadges()
      .catch(() => 0)
      .then(() => getBadges(user.id))
      .then((d) => live && setData(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user?.id, sessionId]);

  if (!user?.id || !data) return null;
  const tonight = earnedOnNight(data, sessionId);
  if (tonight.length === 0) return null;
  const recent = tonight.some((t) => t.state.earned.some((e) => e.sessionId === sessionId && Date.now() - Date.parse(e.earnedAt) < 2 * 86400000));
  const clubName = (id: string | null) => (id ? data.clubs.find((c) => c.id === id)?.name ?? null : null);
  const peak = buildShelf(data).peakRating;

  async function share() {
    const out = await shareUrl(`/u/${user!.id}/badges`, "My Padelier badges");
    if (out === "copied") {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    }
  }

  return (
    <div className="rounded-[22px] bg-surface border-[1.5px] border-gold px-4 pt-4 pb-4 mt-4 text-left shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-[20px] font-semibold text-graphite">{recent ? "New badges" : "Badges from this night"}</h2>
        <span className="text-[11.5px] font-semibold text-gold-ink">
          {tonight.length} {recent ? "tonight" : ""}
        </span>
      </div>
      <div className="mt-2">
        {tonight.map(({ state, level }) => {
          const d = state.def;
          const club = clubName(state.clubId);
          const line =
            d.kind === "levels"
              ? `${level} ${d.unit}${club ? ` at ${club}` : ""}${state.next ? ` · next: ${state.next}` : ""}`
              : d.kind === "repeat"
                ? `${level === 1 ? "First time" : `${level} times`}${club ? ` at ${club}` : ""}`
                : club
                  ? club
                  : d.how;
          return (
            <button
              key={`${state.clubId}-${d.id}`}
              type="button"
              onClick={() => setOpen(state)}
              className="w-full flex items-center gap-3.5 py-3 border-t border-line first:border-t-0 text-left active:bg-surface-2"
            >
              <BadgeIcon state={state} size={54} />
              <span className="flex-1 min-w-0">
                <span className="block text-[14.5px] font-bold text-graphite">
                  {d.name}
                  {d.kind === "levels" ? ` · ${level}` : ""}
                </span>
                <span className="block text-[12px] text-warm-gray mt-0.5 line-clamp-2">{line}</span>
              </span>
              <span className="text-stone text-[18px]">›</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={share} className="flex-1 h-11 rounded-full bg-graphite text-ivory text-[13.5px] font-semibold active:scale-[0.99] transition-transform">
          {shared ? "Link copied ✓" : "Share"}
        </button>
        <Link
          to={`/u/${user.id}/badges`}
          className="flex-1 h-11 rounded-full bg-gold-soft text-gold-ink text-[13.5px] font-semibold flex items-center justify-center"
        >
          See all my badges
        </Link>
      </div>
      {open && (
        <BadgeSheet
          state={open}
          clubName={clubName(open.clubId)}
          self
          eliteSeen={data.eliteSeen}
          peakRating={peak}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
