// Language switch + translation API.
//
// Design: a Solid signal `currentLanguage` that components read
// reactively. The setting "auto" is resolved into a concrete language
// on load (navigator.language); the actual signal value is always
// "de" or "en" so t() doesn't have to resolve again. Persisted
// is the user choice ("auto" | "de" | "en") in settings.ts.
//
// Deliberately no i18next/intl-messageformat: with ~300 keys and two
// languages, a hand-written implementation is significantly smaller
// (no bundle overhead), type-safe (TS checks every key against the
// canonical DE catalog) and immediately readable without API indirection.

import { createSignal } from "solid-js";
import { de } from "./de";
import { en } from "./en";

export type Language = "de" | "en";
/** User-visible language preference incl. "auto" (follows system). */
export type LanguagePref = "auto" | Language;

type Catalog = Record<keyof typeof de, string>;

const CATALOGS: Record<Language, Catalog> = { de, en };

/** Detects the system language via navigator.language. Falls back to
 *  "de" because the app was primarily developed in German and
 *  all existing users expect German. */
export function detectSystemLanguage(): Language {
  if (typeof navigator === "undefined") return "de";
  const raw = navigator.language || (navigator as { userLanguage?: string }).userLanguage;
  if (!raw) return "de";
  return raw.toLowerCase().startsWith("de") ? "de" : "en";
}

/** Resolves the user preference to the concrete language. */
export function resolveLanguage(pref: LanguagePref): Language {
  return pref === "auto" ? detectSystemLanguage() : pref;
}

const [currentLanguage, setCurrentLanguageSignal] = createSignal<Language>(
  typeof navigator !== "undefined" ? detectSystemLanguage() : "de",
);

/** Reactive reader. Components that subscribe here automatically
 *  re-render on language change. */
export const language = currentLanguage;

/** Sets the resolved language. settings.ts calls this after every
 *  setLanguage()/load(). Idempotent. */
export function applyResolvedLanguage(lang: Language): void {
  setCurrentLanguageSignal(lang);
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang;
  }
}

type Params = Record<string, string | number>;
export type TranslationKey = keyof typeof de;

function interpolate(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (full, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name]);
    }
    return full;
  });
}

/** Reads a translation. Falls back to the DE catalog if the
 *  EN variant should be missing (TS should prevent that, but the
 *  defensive code costs us nothing). */
export function t(key: TranslationKey, params?: Params): string {
  const cat = CATALOGS[currentLanguage()];
  const raw = cat[key] ?? (de as Catalog)[key] ?? key;
  return interpolate(raw, params);
}

/** Plural selection via Intl.PluralRules. Expects existing `_one` /
 *  `_other` suffixes in the catalog (German and English plural rules
 *  both have these categories). `count` is automatically interpolated
 *  as a {count} param. */
export function tPlural(
  baseKey: string,
  count: number,
  params?: Params,
): string {
  const lang = currentLanguage();
  const rule = new Intl.PluralRules(getCurrentLocale()).select(count);
  // count first so a caller-supplied formatted
  // variant (e.g. {count: "1,234"} with thousands separator) overrides
  // the numeric default. The rule selection stays
  // numerically correct - the display is allowed to be prettier.
  const fullParams: Params = { count, ...(params ?? {}) };
  const pluralKey = `${baseKey}_${rule}` as TranslationKey;
  const otherKey = `${baseKey}_other` as TranslationKey;
  const cat = CATALOGS[lang];
  const raw =
    cat[pluralKey] ??
    cat[otherKey] ??
    (de as Catalog)[pluralKey] ??
    (de as Catalog)[otherKey] ??
    baseKey;
  return interpolate(raw, fullParams);
}

/** BCP-47 locale for Intl.* APIs (toLocaleDateString, PluralRules, ...). */
export function getCurrentLocale(): string {
  return currentLanguage() === "de" ? "de-DE" : "en-US";
}

/** Localized localeCompare for sort. */
export function localeCompare(a: string, b: string): number {
  return a.localeCompare(b, getCurrentLocale());
}
