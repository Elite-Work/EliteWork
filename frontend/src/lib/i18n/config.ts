/**
 * i18n configuration. Core market is Nigeria, so `en-NG` / NGN are the defaults
 * for every locale-aware formatter and the base message catalog.
 */
export const DEFAULT_LOCALE = "en-NG";
export const DEFAULT_CURRENCY = "NGN";

export const SUPPORTED_LOCALES = ["en-NG", "en-US", "fr", "pseudo"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Pseudo-localization surfaces hardcoded strings (they stay ASCII while
 * catalog strings become accented + padded). Enabled at build/run time with
 * `NEXT_PUBLIC_PSEUDO_LOCALE=1` or by passing `locale: "pseudo"` explicitly.
 */
export function isPseudoLocaleEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_PSEUDO_LOCALE === "1" ||
    process.env.NEXT_PUBLIC_PSEUDO_LOCALE === "true"
  );
}

export function resolveLocale(explicit?: Locale): Locale {
  if (explicit) return explicit;
  if (isPseudoLocaleEnabled()) return "pseudo";
  const env = process.env.NEXT_PUBLIC_LOCALE as Locale | undefined;
  if (env && SUPPORTED_LOCALES.includes(env)) return env;
  return DEFAULT_LOCALE;
}

/** Locale actually handed to `Intl` — "pseudo" has no CLDR data, fall back to en-NG. */
export function intlLocale(locale: Locale): string {
  return locale === "pseudo" ? DEFAULT_LOCALE : locale;
}
