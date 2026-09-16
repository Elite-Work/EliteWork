import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Surface / Elevation scale ──────────────────────────────────────
        "surface-0": "var(--surface-0)",
        "surface-1": "var(--surface-1)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",

        // Legacy bg-* aliases — kept for backward-compat
        "bg-primary": "var(--bg-primary)",
        "bg-card": "var(--bg-card)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-input": "var(--bg-input)",
        "bg-overlay": "var(--bg-overlay)",

        gold: "var(--gold)",
        "gold-hover": "var(--gold-hover)",
        "gold-muted": "var(--gold-muted)",
        emerald: "var(--emerald)",
        "emerald-muted": "var(--emerald-muted)",
        "accent-emerald": "var(--emerald)",
        teal: "#14B8A6",

        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        "text-inverse": "var(--text-inverse)",

        // Skeleton / loading placeholder tokens
        "skeleton-base": "var(--skeleton-base)",
        "skeleton-sheen": "var(--skeleton-sheen)",

        // Status chip tokens
        "status-success": "var(--status-success)",
        "status-warning": "var(--status-warning)",
        "status-danger": "var(--status-danger)",
        "status-info": "var(--status-info)",
        "status-locked": "var(--status-locked)",
        "status-draft": "var(--status-draft)",

        // ── Border tokens — elevation-aware ───────────────────────────────
        "border-subtle": "var(--border-subtle)",
        "border-default": "var(--border-default)",
        "border-raised": "var(--border-raised)",
        "border-hover": "var(--border-hover)",
        "border-focus": "var(--border-focus)",
      },
      backgroundColor: {
        // Surface scale
        "surface-0": "var(--surface-0)",
        "surface-1": "var(--surface-1)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        // Legacy aliases
        primary: "var(--bg-primary)",
        card: "var(--bg-card)",
        elevated: "var(--bg-elevated)",
        input: "var(--bg-input)",
        overlay: "var(--bg-overlay)",
      },
      textColor: {
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
        inverse: "var(--text-inverse)",
      },
      borderColor: {
        subtle: "var(--border-subtle)",
        default: "var(--border-default)",
        raised: "var(--border-raised)",
        hover: "var(--border-hover)",
        focus: "var(--border-focus)",
      },
      // ── Elevation / shadow scale ─────────────────────────────────────────
      boxShadow: {
        "elev-0": "none",
        "elev-1": "var(--shadow-elev-1)",
        "elev-2": "var(--shadow-elev-2)",
        "elev-3": "var(--shadow-elev-3)",
        // Legacy aliases
        card: "var(--shadow-elev-1)",
        "card-hover": "var(--shadow-elev-2)",
        "glow-gold": "0 0 20px rgba(251,191,36,0.2)",
        "glow-emerald": "0 0 20px rgba(74,222,128,0.15)",
        modal: "var(--shadow-elev-3)",
      },
      spacing: {
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
      },
      borderRadius: {
        none: "0",
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px",
        full: "9999px",
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        manrope: ["var(--font-manrope)", "Manrope", "sans-serif"],
        mono: [
          "var(--font-geist-mono)",
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
      fontSize: {
        xs: ["12px", { lineHeight: "1.5" }],
        sm: ["14px", { lineHeight: "1.5" }],
        base: ["16px", { lineHeight: "1.5" }],
        lg: ["18px", { lineHeight: "1.6" }],
        xl: ["20px", { lineHeight: "1.4" }],
        "2xl": ["24px", { lineHeight: "1.3" }],
        "3xl": ["30px", { lineHeight: "1.25" }],
        "4xl": ["36px", { lineHeight: "1.2" }],
        "5xl": ["48px", { lineHeight: "1.15" }],
        display: ["60px", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      lineHeight: {
        tight: "1.2",
        normal: "1.5",
        relaxed: "1.75",
      },
      backgroundImage: {
        "gradient-hero":
          "linear-gradient(135deg, var(--surface-0) 0%, var(--surface-1) 50%, var(--surface-2) 100%)",
        "gradient-gold-cta":
          "linear-gradient(135deg, var(--gold) 0%, var(--gold-hover) 100%)",
        "gradient-card-glow":
          "linear-gradient(135deg, rgba(74,222,128,0.05) 0%, rgba(251,191,36,0.05) 100%)",
      },
      animation: {
        "slide-up": "slide-up 0.3s ease-out",
        "skeleton-pulse": "skeleton-pulse 1.6s ease-in-out infinite",
        "skeleton-shimmer": "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
