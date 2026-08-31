import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "./native";

/**
 * The small native behaviours that decide whether this reads as an app or as a
 * website in a box — which is not only taste. App Store guideline 4.2 rejects
 * apps that are "simply a website bundled as an app", and a reviewer forms that
 * judgement in the first ten seconds, from the launch and the first tap.
 *
 * Everything here is a no-op in a browser, so the web build is unchanged.
 */

/** Called once at startup, before React renders. */
export async function initNativeShell(): Promise<void> {
  if (!isNative()) return;

  try {
    // The app is ivory-on-light everywhere, so the clock and battery must be
    // dark. Default is light-on-transparent, which on our background is
    // invisible — the top of the screen simply loses its status bar.
    await StatusBar.setStyle({ style: Style.Light });
    // Not overlaying: every screen already pads for env(safe-area-inset-top),
    // and an overlaid bar on top of that puts content under the clock.
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: "#F7F5F2" });
  } catch {
    /* status bar styling is cosmetic — never worth failing a launch over */
  }
}

/**
 * Hide the launch screen once the app has actually painted something.
 *
 * Deliberately called from the app rather than left to Capacitor's timer: a
 * fixed duration either flashes white before React is ready, or holds a static
 * logo after the app is usable. Hiding it when the first screen exists is the
 * only version that's right on both a fast phone and a cold start.
 */
export async function dismissSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide();
  } catch {
    /* already gone */
  }
}

/**
 * A physical tap.
 *
 * `navigator.vibrate` — which the score pad used — does not exist in Safari or
 * in an iOS webview, so every score entered on an iPhone was silent. The
 * Taptic Engine is one of the few things a wrapped app can do that a website
 * flatly cannot, and score entry is where it belongs: you are looking at the
 * court, not the phone, and the buzz is how you know the number landed.
 */
export async function tap(weight: "light" | "medium" = "light"): Promise<void> {
  if (isNative()) {
    try {
      await Haptics.impact({ style: weight === "light" ? ImpactStyle.Light : ImpactStyle.Medium });
      return;
    } catch {
      /* fall through to the web path */
    }
  }
  // Android browsers and desktop Chrome. Silent on iOS Safari, which has no
  // vibration API at all — nothing to be done there.
  navigator.vibrate?.(weight === "light" ? 8 : 18);
}

/**
 * The other kind of haptic: an outcome, not a touch.
 *
 * `impact` is the feel of a button under your thumb. `notification` is iOS
 * telling you how something turned out — success is two rising taps, warning
 * is two falling ones, and people know the difference without being taught,
 * because every native app on the phone uses them the same way.
 *
 * Kept deliberately scarce. A phone that buzzes at everything is a phone
 * whose buzzing means nothing, and the score pad only earns its tap because
 * you are looking at the court instead of the screen.
 */
export async function notify(kind: "success" | "warning" | "error" = "success"): Promise<void> {
  if (isNative()) {
    try {
      await Haptics.notification({
        type:
          kind === "success"
            ? NotificationType.Success
            : kind === "warning"
              ? NotificationType.Warning
              : NotificationType.Error,
      });
      return;
    } catch {
      /* fall through */
    }
  }
  // Android has no notification haptic, so approximate the shape: two short
  // pulses rising, three for an error. Silent on iOS Safari either way.
  navigator.vibrate?.(kind === "error" ? [12, 40, 12, 40, 12] : [10, 50, 16]);
}
