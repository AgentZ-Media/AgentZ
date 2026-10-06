import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, createComputed } from "solid-js";
import {
  applyResolvedLanguage, createI18n, createModuleI18n, detectSystemLanguage, formatDate, formatNumber,
  getCurrentLocale, kitDe, kitEn, language, resolveLanguage, t,
} from "../index";

afterEach(() => {
  vi.restoreAllMocks();
  applyResolvedLanguage("de");
});

describe("Kit catalogs", () => {
  it("contains exactly the same keys and placeholders in both languages", () => {
    expect(Object.keys(kitEn).sort()).toEqual(Object.keys(kitDe).sort());
    for (const key of Object.keys(kitDe) as Array<keyof typeof kitDe>) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      expect(placeholders(kitEn[key]), key).toEqual(placeholders(kitDe[key]));
    }
  });

  it("shares one reactive language across independently composed catalogs", () => {
    const a = createModuleI18n({ de: { "demo.label": "Hallo" }, en: { "demo.label": "Hello" } });
    const b = createI18n({ de: { label: "Welt" }, en: { label: "World" } });
    const rendered: string[] = [];
    applyResolvedLanguage("de");
    createRoot(dispose => {
      createComputed(() => rendered.push(`${t("common.cancel")} ${a.t("demo.label")} ${b.t("label")}`));
      applyResolvedLanguage("en");
      expect(rendered).toEqual(["Abbrechen Hallo Welt", "Cancel Hello World"]);
      expect(language()).toBe("en");
      expect(document.documentElement.lang).toBe("en");
      expect(getCurrentLocale()).toBe("en-US");
      dispose();
    });
  });

  it("does not let module overrides modify the Kit catalog or other modules", () => {
    applyResolvedLanguage("de");
    const custom = createModuleI18n({ de: { "common.cancel": "Zurück" }, en: { "common.cancel": "Back" } });
    expect(custom.t("common.cancel")).toBe("Zurück");
    expect(t("common.cancel")).toBe("Abbrechen");
  });

  it("interpolates own parameters while preserving unknown placeholders", () => {
    const translator = createI18n({ de: { greeting: "{name}: {count} {missing} {toString}" }, en: { greeting: "{name}: {count} {missing} {toString}" } });
    expect(translator.t("greeting", { name: "Ada", count: 0 })).toBe("Ada: 0 {missing} {toString}");
  });

  it("selects plurals numerically and permits formatted display counts", () => {
    const translator = createI18n({
      de: { items_one: "{count} Eintrag", items_other: "{count} Einträge" },
      en: { items_one: "{count} item", items_other: "{count} items" },
    });
    applyResolvedLanguage("en");
    expect(translator.tPlural("items", 1)).toBe("1 item");
    expect(translator.tPlural("items", 1000, { count: "1,000" })).toBe("1,000 items");
    applyResolvedLanguage("de");
    expect(translator.tPlural("items", 0)).toBe("0 Einträge");
  });

  it("falls back to the canonical catalog when external runtime data is incomplete", () => {
    const translator = createI18n({ de: { label: "Wert", items_other: "{count} Einträge" }, en: {} as Record<"label" | "items_other", string> });
    applyResolvedLanguage("en");
    expect(translator.t("label")).toBe("Wert");
    expect(translator.tPlural("items", 2)).toBe("2 Einträge");
  });

  it("resolves explicit and system preferences with the original fallback", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-AT");
    expect(detectSystemLanguage()).toBe("de");
    expect(resolveLanguage("en")).toBe("en");
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    expect(resolveLanguage("auto")).toBe("en");
    vi.spyOn(navigator, "language", "get").mockReturnValue("");
    expect(detectSystemLanguage()).toBe("de");
  });
});

// These checks are included in tsc as well as the executable suite.
function assertTypedKeys() {
  const translator = createModuleI18n({ de: { "demo.label": "Hallo", "demo.items_other": "Einträge" }, en: { "demo.label": "Hello", "demo.items_other": "Items" } });
  translator.t("common.cancel");
  translator.t("demo.label");
  translator.tPlural("demo.items", 2);
  // @ts-expect-error Unknown keys must remain compile-time errors.
  translator.t("demo.typo");
  // @ts-expect-error Plurals also require a real plural base.
  translator.tPlural("demo.label", 2);
}
void assertTypedKeys;

describe("cached Intl formatting", () => {
  it("matches the uncached formatters and follows the language", () => {
    const date = new Date(2026, 9, 6, 14, 5);
    const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
    applyResolvedLanguage("de");
    expect(formatDate(date, options)).toBe(date.toLocaleString("de-DE", options));
    expect(formatNumber(12345.5)).toBe((12345.5).toLocaleString("de-DE"));
    applyResolvedLanguage("en");
    expect(formatDate(date, options)).toBe(date.toLocaleString("en-US", options));
    expect(formatNumber(0.42, { style: "percent" })).toBe((0.42).toLocaleString("en-US", { style: "percent" }));
  });
});
