/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ---- Padelier brand palette (from the brand guideline) ----
        // Core
        graphite: "#0D0D0D", // ground: dark surfaces, primary text, app icon
        ink: "#141412", // near-black body text (warmed from the old slate #0f172a)
        "ink-2": "#4A4944", // secondary / supporting text
        ivory: "#F7F5F2", // primary surface — warmer than white
        stone: "#D6D3CE", // structure: dividers, tracks, quiet fills
        "warm-gray": "#6B6A66", // captions, metadata — darkened from #8A8A8A to clear WCAG AA (≥4.5:1 on ivory)
        line: "#E2DDD4", // hairline borders
        surface: "#FFFFFF",
        "surface-2": "#FBFAF8",
        // Energy
        gold: {
          DEFAULT: "#BFA36A", // signature accent — premium / achievement / the ball. Sparingly.
          soft: "#F7F0E3",
          // Darkened from #8A6D33: that value read 4.47:1 on ivory and 4.29:1
          // on gold-soft — under AA on the app's own backgrounds, across 100+
          // usages. #836529 clears it everywhere without changing the hue.
          ink: "#836529",
        },
        "court-lime": "#C4E24B", // live energy only — a match in progress / live state
        win: {
          // Was #2E8B57 (3.90:1 on ivory). Same emerald, dark enough to read.
          DEFAULT: "#27754A", // success — a win recorded, a score confirmed (emerald)
          soft: "#E8F3EC",
        },
        loss: {
          // Was #D36A4A: 3.25:1 on ivory and 3.12:1 on loss-soft, which made
          // error messages the least legible text in the app. Still warm
          // terracotta, never alarming red — just readable.
          DEFAULT: "#AE4A2A", // error & loss — warm terracotta, never alarming red
          soft: "#FBEEE9",
        },
        // ---- Legacy tokens kept so not-yet-ported screens still compile and look
        //      unchanged. Remove once every screen is on the Padelier palette. ----
        accent: {
          DEFAULT: "#0ea472",
          dark: "#0a8a60",
          soft: "#e3f7ee",
        },
      },
      fontFamily: {
        serif: ['"Fraunces"', "Georgia", "serif"], // display / headlines
        sans: ['"Inter"', "system-ui", "sans-serif"], // interface / body (app default)
        mono: ['"Space Grotesk"', "ui-monospace", "monospace"], // numerals / scores (tabular)
        wordmark: ['"Lora"', "Georgia", "serif"], // the Padelier wordmark only
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
