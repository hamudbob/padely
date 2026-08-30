import { BottomSheet } from "../shell/Sheet";
import { TIERS, tierFor } from "./playerStats";

/**
 * The tier ladder.
 *
 * Two of the six names are withheld — the bottom and the top. The bottom
 * because being shown the name of the rung below you is a worse experience
 * than not knowing there's a name at all, and the top because a prize nobody
 * can see is a better prize than one everybody can price. Your own band always
 * shows its name on your profile strip: the secret is what a band is CALLED
 * before you reach it, never where you stand.
 *
 * The bands themselves are public and exact. Hiding the maths would just make
 * the whole thing feel arbitrary, which is the opposite of what a ladder is
 * for.
 */
export default function TierSheet({
  rating,
  provisional,
  onClose,
}: {
  rating: number;
  provisional: boolean;
  onClose: () => void;
}) {
  const mine = tierFor(rating, provisional);

  return (
    <BottomSheet
      onClose={onClose}
      title="The tiers"
      subtitle="Your tier is just a name for your rating. Nothing is calculated from it."
    >

          <div className="rounded-2xl bg-surface overflow-hidden">
            {[...TIERS].reverse().map((tier) => {
              const isMine = !provisional && tier.name === mine;
              const range =
                tier.to === null ? `${tier.from}+` : tier.from === 0 ? `under ${tier.to + 1}` : `${tier.from}–${tier.to}`;
              return (
                <div
                  key={tier.name}
                  className={`flex items-center justify-between gap-3 px-4 py-3.5 border-t border-line first:border-t-0 ${
                    isMine ? "bg-gold-soft" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span
                      className={`block text-[13px] font-bold uppercase tracking-[0.09em] ${
                        tier.secret && !isMine ? "text-stone" : isMine ? "text-gold-ink" : "text-graphite"
                      }`}
                    >
                      {tier.secret && !isMine ? "? ? ?" : tier.name}
                    </span>
                    {tier.secret && !isMine && (
                      <span className="block text-[10.5px] text-warm-gray mt-1">
                        {tier.to === null ? "Get there and find out." : "Nobody needs to know."}
                      </span>
                    )}
                    {isMine && <span className="block text-[10.5px] text-gold-ink mt-1">You're here</span>}
                  </span>
                  <span className="font-mono tnum text-[13px] text-warm-gray shrink-0">{range}</span>
                </div>
              );
            })}
          </div>

          {provisional && (
            <p className="text-[12px] text-warm-gray leading-relaxed mt-3.5 px-1">
              Yours says <b className="text-gold-ink">main lagi</b> because the rating hasn't settled yet — about three
              sessions, win or lose. It isn't a rung on this ladder.
            </p>
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
