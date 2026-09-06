import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme-aware — driven by CSS variables in globals.css, flip with
        // the `.dark` class on <html>.
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "sky-soft": "rgb(var(--color-sky-soft) / <alpha-value>)",
        sky: "rgb(var(--color-sky) / <alpha-value>)",
        navy: "rgb(var(--color-navy) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          soft: "rgb(var(--color-ink-soft) / <alpha-value>)",
        },
        line: "rgb(var(--color-line) / <alpha-value>)",

        // Constant brand accents — same in both themes.
        "brand-navy": "#0B2E5C",
        blue: {
          DEFAULT: "#2F6FED",
          deep: "#1B4FC4",
        },
        success: "#1B9C63",
        amber: "#E58A2A",
      },
      fontFamily: {
        display: ["var(--font-manrope)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
      borderRadius: {
        card: "18px",
        pill: "999px",
      },
    },
  },
  plugins: [],
};

export default config;
