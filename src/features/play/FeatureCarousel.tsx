import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

/**
 * The slideshow on Play — five posters that lead into the feature pages.
 *
 * Why it exists: with nothing running, Play was a date, two buttons and a lot
 * of ivory. The app can do twenty-one things and the home screen advertised
 * none of them. This is the way in — each slide opens /f/<slug>, which ends in
 * the button that starts the thing it just described.
 *
 * Five, not twenty-one. A carousel you can reach the end of is a carousel
 * people finish; the last slide's "See everything" goes to the full index for
 * anyone who wants the rest.
 *
 * Three implementation choices worth keeping:
 *
 * 1. CSS scroll-snap, not a pointer handler — same reasoning as the deck
 *    further up this page. The platform's own scrolling gets momentum,
 *    rubber-banding and gesture arbitration right, and never fights the page's
 *    vertical scroll.
 *
 * 2. Auto-advance stops for good the moment you touch it. A carousel that
 *    keeps moving under a thumb that's reading is the single most irritating
 *    thing a home screen can do, and the person swiping has just told us they
 *    are steering.
 *
 * 3. It doesn't animate at all under prefers-reduced-motion, and it doesn't
 *    tick while the tab is hidden — otherwise you come back to a screen that
 *    silently walked to slide four.
 */

const ADVANCE_MS = 6500;

type Motif = "rings" | "split" | "arc" | "ladder" | "halves";

interface Slide {
  slug: string;
  /** The feature's own name — the recognisable part, so it leads. */
  eyebrow: string;
  /** The hook. Short enough to read at a glance from a bench. */
  headline: string;
  /** The substance, so the hook isn't just a slogan. */
  line: string;
  motif: Motif;
}

const SLIDES: Slide[] = [
  {
    slug: "clubs",
    eyebrow: "Clubs",
    headline: "Make it a season.",
    line: "A league table, a champions hall and a schedule for your group.",
    motif: "rings",
  },
  {
    slug: "team-sparring",
    eyebrow: "Team Sparring",
    headline: "Us against them.",
    line: "Two fixed sides, one running score.",
    motif: "split",
  },
  {
    slug: "rating",
    eyebrow: "Your rating",
    headline: "Your level, in one number.",
    line: "It moves for who you beat, not how many.",
    motif: "arc",
  },
  {
    slug: "mexicano",
    eyebrow: "Mexicano",
    headline: "The night gets tighter.",
    line: "Every round is drawn from the standings.",
    motif: "ladder",
  },
  {
    slug: "fixed-position",
    eyebrow: "Fixed Position",
    headline: "Keep your side of the court.",
    line: "Partners rotate all evening; your side doesn\u2019t.",
    motif: "halves",
  },
];

const GOLD = "#BFA36A";

/** The background drawing. Big, quiet, and bleeding off the edges — it should
 *  read as printing on the card rather than as a second illustration competing
 *  with the icon. */
function Motif({ kind, id }: { kind: Motif; id: string }) {
  return (
    <svg
      viewBox="0 0 332 187"
      className="absolute inset-0 w-full h-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FBFAF8" />
          <stop offset="100%" stopColor="#F2E9D8" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.76" cy="0.26" r="0.72">
          <stop offset="0%" stopColor={GOLD} stopOpacity="0.42" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="332" height="187" fill={`url(#${id}-bg)`} />
      <rect width="332" height="187" fill={`url(#${id}-glow)`} />

      <g fill="none" stroke={GOLD} strokeOpacity="0.46" strokeWidth="1.6">
        {kind === "rings" &&
          [46, 78, 110, 142].map((r) => <circle key={r} cx="250" cy="52" r={r} />)}

        {kind === "split" && (
          <>
            <path d="M188 -20 L108 207" strokeWidth="2" />
            <path d="M214 -20 L134 207" strokeOpacity="0.2" />
            <path d="M240 -20 L160 207" strokeOpacity="0.12" />
          </>
        )}

        {kind === "arc" && (
          <>
            <path d="M-10 176 A 150 150 0 0 1 290 176" strokeWidth="2" />
            <path d="M22 176 A 118 118 0 0 1 258 176" strokeOpacity="0.2" />
            <path d="M54 176 A 86 86 0 0 1 226 176" strokeOpacity="0.12" />
          </>
        )}

        {kind === "ladder" &&
          [0, 1, 2, 3, 4, 5].map((i) => (
            <rect
              key={i}
              x={196 - i * 26}
              y={22 + i * 27}
              width={124 + i * 22}
              height="14"
              rx="7"
              strokeOpacity={0.46 - i * 0.055}
            />
          ))}

        {kind === "halves" && (
          <>
            <rect x="26" y="-26" width="280" height="239" rx="18" strokeWidth="2" />
            <path d="M166 -26 L166 213" strokeDasharray="6 8" />
            <path d="M26 93 L306 93" strokeOpacity="0.16" />
          </>
        )}
      </g>
    </svg>
  );
}

export default function FeatureCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Set the moment the person swipes, taps or scrolls the track themselves.
  // Once they are steering, we stop — permanently, for this mount.
  const steered = useRef(false);

  const goTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const slides = track.children;
    const first = slides[0] as HTMLElement | undefined;
    const second = slides[1] as HTMLElement | undefined;
    if (!first) return;
    // Pitch from the DOM rather than from a hard-coded width: the slide is a
    // percentage of the viewport, so only the browser knows what it came to.
    const pitch = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
    track.scrollTo({ left: i * pitch, behavior: "smooth" });
  }, []);

  // Which slide is under the snap point, read back from the scroll position —
  // so the dots are right whether the move came from a swipe or from the timer.
  const onScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.children[0] as HTMLElement | undefined;
    const second = track.children[1] as HTMLElement | undefined;
    if (!first) return;
    const pitch = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
    if (pitch > 0) setIndex(Math.min(SLIDES.length - 1, Math.max(0, Math.round(track.scrollLeft / pitch))));
  }, []);

  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const id = window.setInterval(() => {
      if (steered.current || document.hidden) return;
      setIndex((i) => {
        const next = (i + 1) % SLIDES.length;
        goTo(next);
        return next;
      });
    }, ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [goTo]);

  const stop = useCallback(() => {
    steered.current = true;
  }, []);

  return (
    <section className="pt-7" aria-label="What Padelier can do">
      <div
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={stop}
        onTouchStart={stop}
        onWheel={stop}
        className="overflow-x-auto no-scrollbar snap-x snap-mandatory flex gap-3 px-5 pb-1"
      >
        {SLIDES.map((slide, i) => (
          <Link
            key={slide.slug}
            to={`/f/${slide.slug}`}
            className="snap-start shrink-0 w-[calc(100%-52px)] relative rounded-3xl overflow-hidden border border-line aspect-[16/10] active:scale-[0.99] transition-transform shadow-[0_2px_10px_-6px_rgba(13,13,13,0.18)]"
          >
            <Motif kind={slide.motif} id={`fc${i}`} />

            {/* Ivory falling away to nothing, so the words stay readable over
                whatever the drawing does behind them. It sits UNDER the icon:
                over it, it greyed out the charcoal and the whole set went
                muddy. */}
            <div className="absolute inset-0 bg-gradient-to-r from-ivory/95 via-ivory/80 to-transparent" />

            {/* The icon Hamud drew for this feature, sitting on the right where
                the text isn't, and running off the edge so the card reads as a
                crop of something bigger rather than a boxed thumbnail. */}
            <img
              src={`/features/${slide.slug}.png`}
              alt=""
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="absolute right-[-7%] top-1/2 -translate-y-1/2 w-[56%] h-[90%] object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />

            <div className="absolute inset-0 px-[18px] py-[15px] flex flex-col justify-between">
              <div>
                <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-gold-ink">{slide.eyebrow}</p>
                <div className="w-[22px] h-[2px] rounded-full bg-gold mt-1.5" />
              </div>
              <div className="pr-[40%]">
                <p className="font-serif text-[20px] leading-[1.15] font-semibold text-graphite tracking-tight">
                  {slide.headline}
                </p>
                <p className="text-[11.5px] leading-[1.35] text-ink-2 mt-1.5">{slide.line}</p>
              </div>
              <p className="text-[12px] font-semibold text-gold-ink">Learn more ›</p>
            </div>
          </Link>
        ))}

        {/* The end of the carousel is a door, not a wall. Same material as the
            slides — as a plain white card it read as the thing having broken. */}
        <Link
          to="/features"
          className="snap-start shrink-0 w-[calc(100%-52px)] relative rounded-3xl overflow-hidden border border-line aspect-[16/10] active:scale-[0.99] transition-transform shadow-[0_2px_10px_-6px_rgba(13,13,13,0.18)]"
        >
          <Motif kind="rings" id="fc-all" />
          <div className="absolute inset-0 bg-gradient-to-r from-ivory/90 via-ivory/70 to-transparent" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <span className="font-serif text-[20px] font-semibold text-graphite leading-tight">
              Everything Padelier does
            </span>
            <span className="text-[11.5px] text-warm-gray mt-1">Twenty-one features, one page</span>
            <span className="text-[12px] font-semibold text-gold-ink mt-3">Open the list ›</span>
          </div>
        </Link>
      </div>

      <div className="flex justify-center gap-1.5 pt-3" aria-hidden>
        {SLIDES.concat([{ slug: "all" } as Slide]).map((s, i) => (
          <span
            key={s.slug}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === index ? "w-4 bg-gold" : "w-1.5 bg-stone"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
