/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // matches the wireframe's palette (padel_wireframe.html) — swap here, not per-component
        accent: {
          DEFAULT: "#0ea472",
          dark: "#0a8a60",
          soft: "#e3f7ee",
        },
        ink: "#0f172a",
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
