import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BadgeIcon from "./BadgeIcon";
import BadgeSheet from "./BadgeSheet";
import { getBadges } from "../../lib/supabase/badgeQueries";
import { BadgeState, BadgesData, Shelf, badgeCaption, buildShelf, dayMonth } from "../../lib/badges/model";

/**
 * The badge shelf on a profile (design canvas, "Profile · badge shelf"). The
 * same shelf shows on anyone's profile, whichever way it was opened: from a
 * club, the League, a Call-up or a search. Tiers first, then what's next, then
 * what's been earned: as a player, and at each club.
 */

export interface OpenBadge {
  state: BadgeState;
  clubName: string | null;
}

/** One tappable badge with its name and a short line under it. */
export function BadgeCell({
  state,
  self,
  eliteSeen,
  onOpen,
}: {
  state: BadgeState;
  self: boolean;
  eliteSeen: boolean;
  onOpen: () => void;
}) {
  const secret = (state.def.kind === "hidden" && !state.isEarned) || (state.def.id === "elite" && !state.isEarned && !eliteSeen);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col items-center text-center gap-1.5 min-w-0 active:scale-[0.97] transition-transform"
      aria-label={`${secret ? "Hidden badge" : state.def.name}${state.isEarned ? ", earned" : ", not yet"}`}
    >
      <BadgeIcon state={state} size={56} eliteSeen={eliteSeen} />
      <span className={`text-[11.5px] font-semibold leading-tight mt-0.5 ${state.isEarned ? "text-graphite" : "text-warm-gray"} line-clamp-2`}>
        {secret ? "???" : state.def.name}
      </span>
      <span className="text-[10.5px] text-warm-gray leading-tight -mt-1 line-clamp-1">{badgeCaption(state, { self })}</span>
    </button>
  );
}

export function BadgeGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-4 gap-x-2 gap-y-4">{children}</div>;
}

export function useBadges(userId: string | undefined) {
  const [data, setData] = useState<BadgesData | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    setLoaded(false);
    getBadges(userId)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [userId]);
  return { data, loaded, shelf: data ? buildShelf(data) : null };
}

export default function BadgeShelf({ userId, self }: { userId: string; self: boolean }) {
  const { data, loaded, shelf } = useBadges(userId);
  const [open, setOpen] = useState<OpenBadge | null>(null);

  // Before 0087 is on the database, or on a load error: nothing at all rather
  // than an empty box.
  if (!loaded || !data || !shelf) return null;

  return (
    <>
      <div className="flex items-baseline justify-between mt-7 mb-2 px-0.5">
        <h3 className="text-[13px] font-semibold text-ink-2">Badges</h3>
        <Link to={`/u/${userId}/badges`} className="text-[12px] font-semibold text-gold-ink">
          {shelf.earnedCount} of {shelf.totalCount} ›
        </Link>
      </div>
      <ShelfBody shelf={shelf} data={data} self={self} userId={userId} onOpen={setOpen} />
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
    </>
  );
}

function ShelfBody({
  shelf,
  data,
  self,
  userId,
  onOpen,
}: {
  shelf: Shelf;
  data: BadgesData;
  self: boolean;
  userId: string;
  onOpen: (b: OpenBadge) => void;
}) {
  const card = "rounded-2xl bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04)]";
  const latestFirst = (a: BadgeState, b: BadgeState) => (b.lastEarnedAt ?? "").localeCompare(a.lastEarnedAt ?? "");
  const playerEarned = shelf.player.filter((b) => b.isEarned).sort(latestFirst);
  const clubs = shelf.clubs.filter((c) => c.earnedCount > 0);

  return (
    <div className="space-y-2.5">
      {/* Tiers reached */}
      <div className={`${card} px-4 pt-3.5 pb-3`}>
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-semibold text-warm-gray">Tiers reached</p>
          {shelf.peakRating !== null && (
            <p className="text-[11.5px] text-warm-gray">
              Peak <b className="font-mono tnum text-graphite">{shelf.peakRating}</b>
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2.5">
          {shelf.tiers.map((t) => {
            const unseen = t.def.id === "elite" && !t.isEarned && !data.eliteSeen;
            return (
              <button
                key={t.def.id}
                type="button"
                onClick={() => onOpen({ state: t, clubName: null })}
                className="flex flex-col items-center gap-1 active:scale-[0.97] transition-transform"
                aria-label={`${unseen ? "The top tier" : t.def.name}${t.isEarned ? ", reached" : ", not yet"}`}
              >
                <BadgeIcon state={t} size={52} eliteSeen={data.eliteSeen} />
                <span className={`text-[12px] font-semibold ${t.isEarned ? "text-graphite" : "text-warm-gray"}`}>{unseen ? "???" : t.def.name}</span>
                <span className="text-[10.5px] text-warm-gray -mt-0.5">{t.isEarned ? `Since ${dayMonth(t.earned[0].earnedAt)}` : "Not yet"}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Next up */}
      {self && shelf.nextUp && shelf.nextUp.next !== null && (
        <button
          type="button"
          onClick={() => onOpen({ state: shelf.nextUp!, clubName: shelf.clubs.find((c) => c.club.id === shelf.nextUp!.clubId)?.club.name ?? null })}
          className={`${card} w-full flex items-center gap-3.5 px-4 py-3 text-left active:bg-surface-2`}
        >
          <BadgeIcon state={shelf.nextUp} size={46} chip={String(shelf.nextUp.next)} stage="locked" />
          <span className="flex-1 min-w-0">
            <span className="block text-[13.5px] font-semibold text-graphite">
              Next up · {shelf.nextUp.def.name} {shelf.nextUp.next}
            </span>
            <span className="block h-[5px] rounded-full bg-[#EFEBE4] mt-1.5 overflow-hidden">
              <span className="block h-full bg-gold" style={{ width: `${Math.round((shelf.nextUp.count / shelf.nextUp.next) * 100)}%` }} />
            </span>
            <span className="block text-[11px] text-warm-gray mt-1">
              {shelf.nextUp.count} of {shelf.nextUp.next} · {shelf.nextUp.next - shelf.nextUp.count} more {shelf.nextUp.def.unit}
            </span>
          </span>
          <span className="text-stone text-[16px]">›</span>
        </button>
      )}

      {/* As a player */}
      <div className={`${card} px-3 pt-3.5 pb-4`}>
        <p className="text-[12px] font-semibold text-warm-gray mx-1 mb-3">
          Player · {playerEarned.length} of {shelf.player.length}
        </p>
        {playerEarned.length === 0 ? (
          <p className="text-[12.5px] text-warm-gray mx-1">{self ? "Play a night and your first badges show up here." : "No badges yet."}</p>
        ) : (
          <BadgeGrid>
            {playerEarned.slice(0, 8).map((b) => (
              <BadgeCell key={b.def.id} state={b} self={self} eliteSeen={data.eliteSeen} onOpen={() => onOpen({ state: b, clubName: null })} />
            ))}
          </BadgeGrid>
        )}
      </div>

      {/* At each club */}
      {clubs.map(({ club, badges, earnedCount }) => {
        const earned = badges.filter((b) => b.isEarned).sort(latestFirst);
        return (
          <div key={club.id} className={`${card} px-3 pt-3 pb-4`}>
            <div className="flex items-center gap-2.5 mx-1 mb-3">
              <span className="w-7 h-7 rounded-lg bg-gold-soft text-gold-ink flex items-center justify-center font-serif font-semibold text-[13px] overflow-hidden shrink-0">
                {club.logoUrl ? <img src={club.logoUrl} alt="" className="w-full h-full object-cover" /> : club.name.charAt(0).toUpperCase()}
              </span>
              <b className="flex-1 min-w-0 text-[13.5px] font-semibold text-graphite truncate">{club.name}</b>
              <span className="text-[11.5px] text-warm-gray">
                {earnedCount} of {badges.length}
              </span>
            </div>
            <BadgeGrid>
              {earned.slice(0, 4).map((b) => (
                <BadgeCell key={b.def.id} state={b} self={self} eliteSeen={data.eliteSeen} onOpen={() => onOpen({ state: b, clubName: club.name })} />
              ))}
            </BadgeGrid>
          </div>
        );
      })}

      <Link
        to={`/u/${userId}/badges`}
        className="block text-center rounded-full bg-gold-soft text-gold-ink text-[13px] font-semibold py-2.5 active:scale-[0.99] transition-transform"
      >
        See all badges
      </Link>
    </div>
  );
}
