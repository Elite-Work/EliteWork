"use client";

/**
 * User-selected locale override (issue #49). `resolveLocale()` in
 * `config.ts` still falls back to env/pseudo for SSR and non-React
 * contexts; this store is the runtime source of truth once the app has
 * hydrated, and is what the locale switcher writes to.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from "./config";

interface LocaleState {
  locale: Locale | null;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: null,
      setLocale: (locale) => {
        if (!SUPPORTED_LOCALES.includes(locale)) return;
        set({ locale });
      },
    }),
    {
      name: "amana-locale",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** The locale to render with: user override, else the default. */
export function useActiveLocale(): Locale {
  return useLocaleStore((s) => s.locale) ?? DEFAULT_LOCALE;
}
