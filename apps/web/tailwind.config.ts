import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// Tailwind is configured to consume NoteFlow CSS variables so theme
// switching is a single `data-theme` attribute change on <html>.
export default {
  darkMode: ["class", 'html[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--nf-bg)",
        surface1: "var(--nf-surface-1)",
        surface2: "var(--nf-surface-2)",
        surface3: "var(--nf-surface-3)",
        input: "var(--nf-surface-input)",
        text: "var(--nf-text)",
        muted: "var(--nf-text-muted)",
        subtle: "var(--nf-text-subtle)",
        accent: { DEFAULT: "var(--nf-accent)", strong: "var(--nf-accent-strong)", soft: "var(--nf-accent-soft)" },
        success: colors.emerald[400],
        warning: colors.amber[400],
        danger:  colors.rose[400],
        info:    colors.sky[300],
      },
      borderRadius: {
        sm: "var(--nf-r-sm)", md: "var(--nf-r-md)", lg: "var(--nf-r-lg)", xl: "var(--nf-r-xl)",
      },
      boxShadow: {
        sm: "var(--nf-shadow-sm)", md: "var(--nf-shadow-md)", lg: "var(--nf-shadow-lg)",
      },
      transitionTimingFunction: { nf: "cubic-bezier(0.22,0.61,0.36,1)" },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
