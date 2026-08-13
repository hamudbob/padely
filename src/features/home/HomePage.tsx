import { Link } from "react-router-dom";

/**
 * The public landing page — and *only* that, as of v2.
 *
 * This used to be three screens in one: a marketing page for visitors, an empty
 * state for new accounts, and a dashboard for returning ones. The last two moved
 * to the Play tab, where they belong; a signed-in visit to "/" now redirects
 * there (see App.tsx). What's left is the one job this page was always best at:
 * explaining Padelier to someone who just arrived from a shared link.
 *
 * There's no tab bar here on purpose. Two of the three tabs are meaningless
 * without an account, and a bar that changes shape the moment you sign in is
 * more jarring than one that simply appears. Joining and watching by code work
 * without an account, so the code entry stays prominent — that's the one thing
 * a visitor might genuinely need before signing up.
 */

const STEPS = [
  { n: "01", t: "Create", s: "Name it, pick a format, add players." },
  { n: "02", t: "Play", s: "The app draws fair rounds; tap to score." },
  { n: "03", t: "Rank", s: "A live leaderboard, right to the last game." },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory flex flex-col safe-top safe-bottom anim-fade">
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
        <span className="font-wordmark text-[21px] font-semibold text-ink flex items-baseline leading-none">
          Padelier
          <span className="ml-[3px] w-[6px] h-[6px] rounded-full bg-gold inline-block" aria-hidden />
        </span>
        <Link
          to="/login"
          className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-2 active:scale-95 transition-transform"
        >
          Log in
        </Link>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="px-5 pt-6 pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-ink mb-3.5">Padel, run right</p>
          <h1 className="font-serif text-[40px] font-medium leading-[1.03] tracking-[-0.01em] text-ink text-balance">
            The art of a great game.
          </h1>
          <p className="text-[14px] leading-relaxed text-ink-2 mt-4 max-w-[300px]">
            Fair rounds, one-tap scores, a live leaderboard — from the first serve to the final table.
          </p>
        </div>

        {/* The one thing a visitor may need before they have an account. */}
        <div className="px-5 pt-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-2.5 px-0.5">Jump in</p>
          <Link
            to="/watch"
            className="flex items-center gap-4 rounded-3xl bg-surface border border-line px-5 py-4 shadow-[0_1px_2px_rgba(13,13,13,0.04)] active:scale-[0.99] transition-transform"
          >
            <span className="relative w-[44px] h-[44px] rounded-2xl bg-gold-soft flex items-center justify-center shrink-0">
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#8A6D33" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <path d="M14 14.5h3.5M14 18h.01M17.5 18v3M20.5 14.5v6.5" />
              </svg>
              <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center" aria-hidden>
                <span className="absolute w-2.5 h-2.5 rounded-full bg-court-lime animate-ping" />
                <span className="w-2.5 h-2.5 rounded-full bg-court-lime border-2 border-surface" />
              </span>
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-serif text-[17px] font-semibold text-graphite">Enter a code</span>
              <span className="block text-[12.5px] text-warm-gray mt-0.5">Watch live, claim your spot, or join a game</span>
            </span>
            <span className="text-stone text-[18px]" aria-hidden>›</span>
          </Link>
        </div>

        <div className="h-px bg-line mx-6 mt-8" />

        <div className="px-6 pt-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-warm-gray mb-4">How it works</p>
          <div className="flex flex-col gap-4">
            {STEPS.map((step) => (
              <div key={step.n} className="flex gap-[15px] items-baseline">
                <span className="font-mono font-semibold text-[15px] text-gold min-w-[20px]">{step.n}</span>
                <div>
                  <div className="font-serif font-semibold text-base text-ink">{step.t}</div>
                  <div className="text-[13px] leading-[1.45] text-warm-gray">{step.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-[20px]" />
        <p className="text-[12px] leading-[1.5] text-warm-gray text-center px-6 pt-7 pb-2">
          Want to host your own games?{" "}
          <Link to="/login" className="font-semibold text-gold-ink">Log in or sign up</Link>.
        </p>
        <p className="text-[12px] leading-[1.5] text-warm-gray text-center px-6 pb-2">
          <Link to="/about" className="font-semibold text-gold-ink">How it all works</Link>
        </p>
        <p className="text-[11.5px] leading-[1.5] text-warm-gray text-center px-6 pb-7">
          <Link to="/privacy" className="text-warm-gray underline underline-offset-2">Privacy</Link>
          <span className="mx-2" aria-hidden>·</span>
          <Link to="/terms" className="text-warm-gray underline underline-offset-2">Terms</Link>
        </p>
      </div>
    </div>
  );
}
