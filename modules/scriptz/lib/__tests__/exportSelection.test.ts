import { describe, expect, it } from "vitest";
import { pdfFilenames } from "../exportSelection";
import { t } from "../../i18n";

describe("pdfFilenames", () => {
  it("keeps every file of a multi export apart", () => {
    expect(pdfFilenames(["Vlog", "vlog", "Vlog (2)", "Vlog", "a/b"])).toEqual([
      "Vlog.pdf", "vlog (2).pdf", "Vlog (2) (2).pdf", "Vlog (3).pdf", "a_b.pdf",
    ]);
  });

  it("names untitled scripts like the single export", () => {
    const untitled = t("common.untitled");
    expect(pdfFilenames(["", " "])).toEqual([`${untitled}.pdf`, `${untitled} (2).pdf`]);
  });
});
