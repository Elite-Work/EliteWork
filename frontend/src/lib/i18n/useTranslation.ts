"use client";

/**
 * React-bound `t()` — resolves the user's selected locale from
 * `localeStore` (issue #49) so components re-render when it changes, and
 * exposes the active locale for locale-aware formatters that don't take
 * an explicit `locale` option.
 */
import { useCallback } from "react";
import { t as translate, type MessageKey } from "./index";
import { useActiveLocale } from "./localeStore";

export function useTranslation() {
  const locale = useActiveLocale();

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) =>
      translate(key, { locale, params }),
    [locale],
  );

  return { t, locale };
}
