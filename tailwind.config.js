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
        "warm-gray": "#8A8A8A", // captions, metadata
        line: "#E2DDD4", // hairline borders
        surface: "#FFFFFF",
        "surface-2": "#FBFAF8",
        // Energy
        gold: {
          DEFAULT: "#BFA36A", // signature accent — premium / achievement / the ball. Sparingly.
          soft: "#F7F0E3",
          ink: "#8A6D33",
        },
        "court-lime": "#C4E24B", // live energy only — a match in progress / live state
        win: {
          DEFAULT: "#2E8B57", // success — a win recorded, a score confirmed (emerald)
          soft: "#E8F3EC",
        },
        loss: {
          DEFAULT: "#D36A4A", // error & loss — warm terracotta, never alarming red
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
