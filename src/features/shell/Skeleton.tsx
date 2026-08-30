/**
 * Loading placeholders shaped like the thing that's coming.
 *
 * A centred "Loading…" tells you the app is busy and nothing else: the screen
 * is empty, then it is full, and the jump is the part that feels slow. A
 * skeleton makes the wait feel shorter for two reasons that are worth keeping
 * straight — the layout is already settled when the data lands, so nothing
 * moves under your thumb; and you can start reading the shape of the page
 * before you can read the page.
 *
 * So these are not generic grey bars. Each one is the silhouette of a specific
 * screen. A skeleton that doesn't match what arrives is worse than no
 * skeleton, because the page still jumps AND you were told it wouldn't — so
 * when a screen's layout changes, its skeleton has to change with it.
 *
 * The shimmer itself is the existing `.skeleton` class in index.css.
 */

type Props = { className?: string };

/** One bar. `w` and `h` are CSS lengths so call sites can be exact. */
export function SkeletonLine({ w = "100%", h = 12, r = 6 }: { w?: string; h?: number; r?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r }} />;
}

/** A card-sized slab. */
export function SkeletonBlock({ h, className = "" }: { h: number } & Props) {
  return <div className={`skeleton rounded-3xl ${className}`} style={{ height: h }} />;
}

/** The three-across figures — members/sessions/games, rating/tier/games. */
export function SkeletonStats({ className = "" }: Props) {
  return (
    <div className={`grid grid-cols-3 gap-px rounded-2xl overflow-hidden bg-line ${className}`}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-surface px-3 py-4 flex flex-col items-center gap-2">
          <SkeletonLine w="60%" h={8} />
          <SkeletonLine w="45%" h={20} />
        </div>
      ))}
    </div>
  );
}

/** A bordered list — members, the going list, a session history. */
export function SkeletonRows({ n = 5, avatar = false, className = "" }: { n?: number; avatar?: boolean } & Props) {
  return (
    <div className={`rounded-2xl border border-line bg-surface overflow-hidden ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-t border-line first:border-t-0">
          {avatar ? <span className="w-9 h-9 rounded-full skeleton shrink-0" /> : <span className="w-2 h-2 rounded-full skeleton shrink-0" />}
          <div className="flex-1 space-y-1.5">
            {/* Uneven widths on purpose: a column of identical bars reads as a
                loading graphic, and uneven ones read as names. */}
            <SkeletonLine w={`${52 - (i % 3) * 9}%`} h={11} />
            <SkeletonLine w={`${70 - (i % 4) * 7}%`} h={9} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A centred identity block: avatar, name, one line under it. */
export function SkeletonHero({ square = false, className = "" }: { square?: boolean } & Props) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className={`skeleton w-[92px] h-[92px] ${square ? "rounded-3xl" : "rounded-full"}`} />
      <SkeletonLine w="58%" h={24} />
      <SkeletonLine w="38%" h={11} />
    </div>
  );
}

/** A standings table: a header strip then ranked rows. */
export function SkeletonTable({ n = 8, className = "" }: { n?: number } & Props) {
  return (
    <div className={`rounded-2xl border border-line bg-surface overflow-hidden ${className}`}>
      <div className="px-4 py-2.5 bg-surface-2 border-b border-line">
        <SkeletonLine w="30%" h={8} />
      </div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0">
          <SkeletonLine w="14px" h={11} />
          <div className="flex-1">
            <SkeletonLine w={`${58 - (i % 4) * 8}%`} h={11} />
          </div>
          <SkeletonLine w="34px" h={13} />
        </div>
      ))}
    </div>
  );
}

/** The live round: one card per court. */
export function SkeletonCourts({ n = 3, className = "" }: { n?: number } & Props) {
  return (
    <div className={`flex flex-col gap-5 ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <div className="flex justify-end mb-2">
            <SkeletonLine w="58px" h={10} />
          </div>
          <div className="flex justify-center gap-2 -mb-3 relative z-[2]">
            <div className="skeleton w-[62px] h-[62px] rounded-2xl" />
            <div className="skeleton w-[62px] h-[62px] rounded-2xl" />
          </div>
          <div className="rounded-3xl border border-line bg-surface px-4 pt-7 pb-4 flex items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <SkeletonLine w="76%" h={11} />
              <SkeletonLine w="62%" h={11} />
            </div>
            <SkeletonLine w="16px" h={9} />
            <div className="flex-1 space-y-1.5 flex flex-col items-end">
              <SkeletonLine w="72%" h={11} />
              <SkeletonLine w="80%" h={11} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Wrap a page's skeleton in this. It carries the one thing the bars can't: a
 * screen reader has no silhouette to look at, so it gets told in words.
 */
export function SkeletonScreen({ label = "Loading", children }: { label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}
