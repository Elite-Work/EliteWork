"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  /** The resolved theme actually applied (never "system"). */
  resolvedTheme: "light" | "dark";
  /** The user's stored preference (may be "system"). */
  themePreference: Theme;
  /** Set the theme preference. "system" follows OS preference. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "amana-theme-preference";

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(pref: Theme): "light" | "dark" {
  return pref === "system" ? getSystemPreference() : pref;
}

function getStoredPreference(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazily initialized from localStorage so the correct theme is applied on
  // the first render (no flash — also applied before paint via the inline
  // script in <head> below).
  const [themePreference, setThemePreference] =
    useState<Theme>(getStoredPreference);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    resolveTheme(getStoredPreference()),
  );

  // Apply the `dark` class to <html> whenever resolvedTheme changes.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  // Listen for OS-level preference changes when the user is on "system".
  useEffect(() => {
    if (themePreference !== "system") return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [themePreference]);

  const setTheme = useCallback((theme: Theme) => {
    setThemePreference(theme);
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    localStorage.setItem(STORAGE_KEY, theme);

    // Briefly add transition class so the switch animates smoothly.
    document.documentElement.classList.add("theme-transition");
    setTimeout(() => {
      document.documentElement.classList.remove("theme-transition");
    }, 250);
  }, []);

  return (
    <ThemeContext.Provider value={{ resolvedTheme, themePreference, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for SSR or components rendered outside the provider — return
    // dark to match the default. This avoids a runtime error while the
    // provider hydrates.
    return {
      resolvedTheme: "dark",
      themePreference: "system",
      setTheme: () => {},
    };
  }
  return ctx;
}
