"use client";

import { useLocaleStore, useActiveLocale } from "@/lib/i18n/localeStore";
import type { Locale } from "@/lib/i18n/config";

const LOCALE_LABELS: Partial<Record<Locale, string>> = {
  "en-NG": "English (Nigeria)",
  "en-US": "English (US)",
  fr: "Français",
};

const SELECTABLE_LOCALES = (Object.keys(LOCALE_LABELS) as Locale[]);

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const active = useActiveLocale();
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span className="sr-only">Language</span>
      <select
        value={active}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="rounded-md border border-border-default bg-transparent px-2 py-1 text-sm text-text-secondary"
        aria-label="Language"
      >
        {SELECTABLE_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
