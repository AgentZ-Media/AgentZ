import { afterEach, describe, expect, it } from "vitest";
import { kitDe, applyResolvedLanguage } from "@agentz/kit/i18n";
import { de } from "../de";
import { en } from "../en";
import { t, tPlural } from "../index";

afterEach(() => applyResolvedLanguage("de"));

describe("ScriptZ catalogs", () => {
  it("has matching language keys and placeholders", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const key of Object.keys(de) as Array<keyof typeof de>) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      expect(placeholders(en[key]), key).toEqual(placeholders(de[key]));
    }
  });

  it("keeps product and Kit catalogs disjoint", () => {
    expect(Object.keys(de).filter(key => key in kitDe)).toEqual([]);
  });

  it("composes shared buttons with product labels and plurals", () => {
    applyResolvedLanguage("de");
    expect(t("common.cancel")).toBe("Abbrechen");
    expect(t("boot.error.title")).toBe("ScriptZ konnte nicht starten");
    expect(tPlural("units.scripts", 2)).toBe("2 Skripte");
    applyResolvedLanguage("en");
    expect(t("common.cancel")).toBe("Cancel");
    expect(t("boot.error.title")).toBe("ScriptZ could not start");
    expect(tPlural("units.scripts", 2)).toBe("2 scripts");
  });
});
