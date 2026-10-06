import { createSignal } from "solid-js";
import { kitDe } from "./de";
import { kitEn } from "./en";

export { kitDe, kitEn };
export type Language = "de" | "en";
export type LanguagePref = "auto" | Language;
export type Catalog = Readonly<Record<string, string>>;
export type Catalogs<C extends Catalog = Catalog> = {
  de: C;
  en: Record<keyof C, string>;
};
export type Params = Record<string, string | number>;
export type TranslationKey = keyof typeof kitDe;
export type PluralKey<C extends Catalog> = {
  [K in keyof C]: K extends `${infer Base}_other` ? Base : never;
}[keyof C];

/** German is the fallback for an unavailable system preference. */
export function detectSystemLanguage(): Language {
  if (typeof navigator === "undefined") return "de";
  const raw = navigator.language || (navigator as { userLanguage?: string }).userLanguage;
  if (!raw) return "de";
  return raw.toLowerCase().startsWith("de") ? "de" : "en";
}

export function resolveLanguage(pref: LanguagePref): Language {
  return pref === "auto" ? detectSystemLanguage() : pref;
}

// Reading the system preference is pure; DOM writes only happen explicitly.
const [currentLanguage, setCurrentLanguage] = createSignal<Language>(detectSystemLanguage());
export const language = currentLanguage;

export function applyResolvedLanguage(lang: Language): void {
  setCurrentLanguage(lang);
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function getCurrentLocale(): string {
  return language() === "de" ? "de-DE" : "en-US";
}

export function localeCompare(a: string, b: string): number {
  return a.localeCompare(b, getCurrentLocale());
}

// Intl formatters are expensive to construct (`toLocaleDateString` builds
// one per call, about 60x the cost of reusing one), and lists, heatmaps and
// relative times format thousands of values. One instance per locale and
// options.
const intlCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.PluralRules>();

function cachedIntl<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.PluralRules>(
  kind: string,
  options: object | undefined,
  make: (locale: string) => T,
): T {
  const locale = getCurrentLocale();
  const key = `${kind}|${locale}|${options ? JSON.stringify(options) : ""}`;
  let hit = intlCache.get(key) as T | undefined;
  if (!hit) intlCache.set(key, (hit = make(locale)));
  return hit;
}

/** Date and/or time in the active language (`Intl.DateTimeFormat`). */
export function formatDate(value: Date | number, options: Intl.DateTimeFormatOptions): string {
  const date = typeof value === "number" ? new Date(value) : value;
  // `Intl` throws on an invalid date where `toLocaleString` returned text.
  if (Number.isNaN(date.getTime())) return String(date);
  return cachedIntl("date", options, (locale) => new Intl.DateTimeFormat(locale, options)).format(date);
}

/** A number in the active language (`Intl.NumberFormat`). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return cachedIntl("number", options, (locale) => new Intl.NumberFormat(locale, options)).format(value);
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (full, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : full,
  );
}

/** An isolated, statically typed catalog sharing the active UI language.
 * Constructing translators does not register or mutate global catalogs.
 */
export function createI18n<const C extends Catalog>(catalogs: Catalogs<C>) {
  function t(key: keyof C & string, params?: Params): string {
    const catalog: Catalog = catalogs[language()];
    return interpolate(catalog[key] ?? catalogs.de[key] ?? key, params);
  }

  function tPlural(baseKey: PluralKey<C>, count: number, params?: Params): string {
    const rule = cachedIntl("plural", undefined, (locale) => new Intl.PluralRules(locale)).select(count);
    const pluralKey = `${baseKey}_${rule}`;
    const otherKey = `${baseKey}_other`;
    const catalog: Catalog = catalogs[language()];
    const raw = catalog[pluralKey] ?? catalog[otherKey] ??
      catalogs.de[pluralKey] ?? catalogs.de[otherKey] ?? baseKey;
    return interpolate(raw, { count, ...params });
  }

  return { t, tPlural };
}

/** Compose the shared labels with one module's catalog without losing keys.
 * Modules should use their own namespaces; an intentional same-key override
 * affects only this translator, never the standalone Kit translator.
 */
export function createModuleI18n<const C extends Catalog>(catalogs: Catalogs<C>) {
  return createI18n({
    de: { ...kitDe, ...catalogs.de },
    en: { ...kitEn, ...catalogs.en },
  });
}

export const { t, tPlural } = createI18n({ de: kitDe, en: kitEn });
