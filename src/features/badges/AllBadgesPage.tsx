import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useBackNav } from "../../lib/useBackNav";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { getPublicProfile } from "../../lib/supabase/publicProfileQueries";
import { BadgeCell, BadgeGrid, OpenBadge, useBadges } from "./BadgeShelf";
import BadgeSheet from "./BadgeSheet";
import { BadgeGroup, GROUP_LABEL } from "../../lib/badges/catalog";
import { SkeletonScreen, SkeletonBlock } from "../shell/Skeleton";

/**
 * All badges, earned or not (design canvas, "All badges · Player and each
 * club"). A tab for the player's own 18, and one for each club. Public like
 * the profile: anyone can open someone's badges from a link.
 */
export default function AllBadgesPage() {
  const { userId } = useParams();
  const [params, setParams] = useSearchParams();
  const back = useBackNav(userId ? `/u/${userId}` : "/");
  const { user } = useHostSession();
  const self = !!user?.id && user.id === userId;
  const { data, loaded, shelf } = useBadges(userId);
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenBadge | null>(null);
  const tab = params.get("club") ?? "player";

  useEffect(() => {
    if (!userId) return;
    getPublicProfile(userId)
      .then((p) => setName(p?.displayName ?? null))
      .catch(() => setName(null));
  }, [userId]);

  const shell = "mx-auto max-w-sm min-h-screen bg-ivory px-5 py-6 safe-top safe-bottom anim-fade";
  const bar = (
    <div className="flex items-center justify-between mb-2">
      <button
        onClick={back}
        aria-label="Back"
        className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
      >
        ‹
      </button>
      <div className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </div>
      <div className="w-9" />
    </div>
  );

  if (!loaded)
    return (
      <div className={shell}>
        {bar}
        <SkeletonScreen label="Loading badges">
          <SkeletonBlock h={60} className="mt-6 mb-4" />
          <SkeletonBlock h={420} />
        </SkeletonScreen>
      </div>
    );
  if (!data || !shelf)
    return (
      <div className={shell}>
        {bar}
        <p className="text-[13px] text-warm-gray mt-16 text-center">Badges aren't available right now.</p>
      </div>
    );

  const club = shelf.clubs.find((c) => c.club.id === tab) ?? null;
  const groups: BadgeGroup[] = ["tiers", "milestones", "moments", "people", "hidden"];

  return (
    <div className={shell}>
      {bar}
      <h1 className="font-serif text-[27px] font-semibold text-graphite tracking-tight mt-4">All badges</h1>
      <p className="text-[12.5px] text-warm-gray mt-1">
        {name ? `${self ? "Yours" : name} · ` : ""}
        {shelf.earnedCount} of {shelf.totalCount} earned
      </p>

      {/* Player | each club */}
      <div className="flex gap-1.5 mt-4 overflow-x-auto -mx-5 px-5 pb-1" role="tablist">
        {[{ id: "player", label: `Player · ${shelf.player.length + shelf.tiers.length}` }, ...shelf.clubs.map((c) => ({ id: c.club.id, label: `${c.club.name} · ${c.badges.length}` }))].map(
          (t) => {
            const active = t.id === (club ? club.club.id : "player");
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setParams(t.id === "player" ? {} : { club: t.id }, { replace: true })}
                className={`shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                  active ? "bg-graphite text-ivory" : "bg-surface text-ink-2 shadow-[0_1px_2px_rgba(13,13,13,0.05)]"
                }`}
              >
                {t.label}
              </button>
            );
          },
        )}
      </div>

      {!club &&
        groups.map((g) => {
          const list = g === "tiers" ? shelf.tiers : shelf.player.filter((b) => b.def.group === g);
          return (
            <section key={g}>
              <h3 className="text-[13px] font-semibold text-ink-2 mt-6 mb-2 px-0.5">{GROUP_LABEL[g]}</h3>
              <div className="rounded-2xl bg-surface px-3 pt-4 pb-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
                <BadgeGrid>
                  {list.map((b) => (
                    <BadgeCell key={b.def.id} state={b} self={self} eliteSeen={data.eliteSeen} onOpen={() => setOpen({ state: b, clubName: null })} />
                  ))}
                </BadgeGrid>
              </div>
            </section>
          );
        })}

      {club && (
        <section>
          <h3 className="text-[13px] font-semibold text-ink-2 mt-6 mb-2 px-0.5">
            {club.club.name} · {club.earnedCount} of {club.badges.length}
          </h3>
          <div className="rounded-2xl bg-surface px-3 pt-4 pb-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)]">
            <BadgeGrid>
              {club.badges.map((b) => (
                <BadgeCell key={b.def.id} state={b} self={self} eliteSeen={data.eliteSeen} onOpen={() => setOpen({ state: b, clubName: club.club.name })} />
              ))}
            </BadgeGrid>
          </div>
          {!club.club.owner && (
            <p className="text-[11px] text-warm-gray mt-2 px-1">Founder is for the club's owner, so it isn't listed here.</p>
          )}
        </section>
      )}

      <p className="text-[11.5px] text-warm-gray mt-6 px-1 leading-relaxed">
        Tap any badge for what it is and how it was earned. Badges are worked out from every night played, and once earned they stay.
      </p>

      {open && (
        <BadgeSheet
          state={open.state}
          clubName={open.clubName}
          self={self}
          eliteSeen={data.eliteSeen}
          peakRating={shelf.peakRating}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
