/**
 * i18n entry point. Import formatters and `t()` from here.
 *
 *   import { t, formatNaira, formatDate } from "@/lib/i18n";
 *   t("wallet.wrongNetworkBody", { expected: "Testnet" }); // → "Switch Freighter to Testnet…"
 */
import en from "./messages/en";
import fr from "./messages/fr";
import { pseudoLocalize } from "./pseudo";
import { resolveLocale, type Locale } from "./config";

export * from "./config";
export * from "./format";
export { pseudoLocalize } from "./pseudo";

type Messages = typeof en;

// Recursively derive dot-path keys ("wallet.connect", "common.retry", …).
type Join<K, P> = K extends string
  ? P extends string
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never
  : never;

type Paths<T> = {
  [K in keyof T]-?: T[K] extends object ? Join<K, Paths<T[K]>> : K & string;
}[keyof T];

export type MessageKey = Paths<Messages>;

// A translated catalog may lag behind the `en` source catalog (or use different
// literal values), so catalogs are typed structurally rather than as the exact
// literal shape of `en`. Missing keys fall back to English in `t()`.
type Catalog = { readonly [key: string]: string | Catalog };
const CATALOGS: Record<string, Catalog> = { "en-NG": en, "en-US": en, fr, pseudo: en };

function lookup(catalog: unknown, key: string): string | undefined {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog) as
    | string
    | undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}

export interface TranslateOptions {
  locale?: Locale;
  params?: Record<string, string | number>;
}

/** Resolve a catalog key to a localized string. Falls back to the key itself. */
export function t(key: MessageKey, params?: Record<string, string | number>): string;
export function t(key: MessageKey, options: TranslateOptions): string;
export function t(
  key: MessageKey,
  paramsOrOptions?: Record<string, string | number> | TranslateOptions,
): string {
  const isOptions =
    paramsOrOptions !== undefined &&
    ("locale" in paramsOrOptions || "params" in paramsOrOptions);
  const options = (isOptions ? paramsOrOptions : { params: paramsOrOptions }) as TranslateOptions;
  const locale = options.locale ?? resolveLocale();

  const catalog = CATALOGS[locale] ?? en;
  const raw = lookup(catalog, key) ?? lookup(en, key);
  if (raw === undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] missing message key: ${key}`);
    }
    return key;
  }

  const resolved = interpolate(raw, options.params);
  return locale === "pseudo" ? pseudoLocalize(resolved) : resolved;
}
