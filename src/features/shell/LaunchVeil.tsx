import { useEffect, useState } from "react";
import { isNative } from "../../lib/native";
import { dismissSplash } from "../../lib/nativeShell";

/**
 * The join between the native launch screen and the app.
 *
 * WHY THIS EXISTS AT ALL. iOS draws the launch screen from a storyboard before
 * a single line of our code runs, so it cannot be animated — Apple's own
 * guidance is that a launch screen is a static image, and there is no hook to
 * animate it. What can be animated is the handover: the first thing the web
 * app paints is this veil, pixel-for-pixel the same graphite ground and the
 * same mark, so the moment the native screen is dismissed nothing appears to
 * change. Then the veil animates away and the app is underneath.
 *
 * The mark grows as it goes rather than shrinking into place. Growing and
 * fading reads as the screen opening toward you; shrinking reads as something
 * being put away, which is the wrong feeling at the start of a session. It is
 * also the forgiving direction: the veil's mark and the native one cannot be
 * matched to the pixel across every screen aspect ratio, and a small
 * difference is invisible once it is already in motion.
 *
 * IT IS A PNG, NOT TEXT. The obvious version sets the P in Lora and puts a
 * gold dot beside it. But the fonts load from Google over the network, and
 * this app is built to open on a court with no signal — where that mark would
 * render in Georgia, half a second after everything else. The image is cut
 * from the launch screen itself, so the two cannot drift apart.
 *
 * Renders nothing in a browser, where there is no native screen to hand over
 * from and a veil would only delay the first paint.
 */

type Phase = "hold" | "leaving" | "gone";

export default function LaunchVeil() {
  const [phase, setPhase] = useState<Phase>(() => (isNative() ? "hold" : "gone"));

  useEffect(() => {
    if (phase !== "hold") return;

    let first = 0;
    let second = 0;
    let timer = 0;

    // Two frames, then hide. One is not enough: the first only guarantees the
    // veil is in the DOM, and dismissing the native screen against a veil that
    // has not painted yet is how you get the white flash this exists to avoid.
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        void dismissSplash();
        // A beat on the mark before it moves. Without it the animation starts
        // mid-handover and reads as a stutter rather than a deliberate exit.
        timer = window.setTimeout(() => setPhase("leaving"), 110);
      });
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(timer);
    };
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden="true"
      className={`launch-veil${phase === "leaving" ? " is-leaving" : ""}`}
      // Both the veil and the mark animate, and they bubble to the same
      // handler — only the veil's own end means the handover is finished.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setPhase("gone");
      }}
    >
      <img
        className="launch-veil__mark"
        src="/launch-mark@2x.png"
        srcSet="/launch-mark@2x.png 2x, /launch-mark@3x.png 3x"
        alt=""
        width={132}
        height={105}
      />
    </div>
  );
}
