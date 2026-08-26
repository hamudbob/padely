import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Padelier as a native shell around the same web app.
 *
 * Not type-checked by tsconfig.json (which includes only "src"), so the
 * @capacitor/cli import here can't break `npm run build`.
 */
const config: CapacitorConfig = {
  appId: "id.padelier.app",
  appName: "Padelier",

  // The built web app, bundled INTO the binary rather than loaded from
  // padelier.id. Two reasons. Apple reviews an app that is only a remote URL as
  // a website in a shell (guideline 4.2), and a bundled app still opens on a
  // court with no signal instead of showing a blank page.
  webDir: "dist",

  ios: {
    // Deliberately NOT a translucent/overlaying webview: every screen already
    // handles env(safe-area-inset-*) itself and would double-pad.
    contentInset: "never",
    // Bounce at the end of a scroll is iOS-native and expected; leaving it on
    // is what stops the app feeling like a web page in a box.
    scrollEnabled: true,
  },

  plugins: {
    SplashScreen: {
      // The app hides it (see dismissSplash in lib/nativeShell), so autoHide is
      // off. A fixed duration races the first paint: too short flashes white on
      // a cold start, too long holds a static logo over an app that is already
      // usable.
      launchAutoHide: false,
      backgroundColor: "#0D0D0D", // graphite, matching the mark's ground
      showSpinner: false,
    },
  },
};

export default config;
