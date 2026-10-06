// Text bits the PDF and its preview share: the detail line of the title
// page ("Büro-Sketche · Laufzeit 1:02 · 5. Okt. 2026") and the page footer.
// Pure and translated, so lib/exportPdf.ts and the export dialog render the
// same words.

import { formatDate } from "@agentz/kit/i18n";
import { t } from "../i18n";
import { formatClock } from "./lengthGoal";
import { runtimeSeconds, runtimeStatsFromContent } from "./runtime";

export interface TitleDetailsInput {
  folder: string | null;
  contentJson: string;
  wpm: number;
  date: Date;
}

/** Folder, estimated runtime and export date, separated by middots. */
export function pdfTitleDetails(input: TitleDetailsInput): string {
  const runtime = runtimeSeconds(runtimeStatsFromContent(input.contentJson), input.wpm);
  const date = formatDate(input.date, { dateStyle: "medium" });
  return [input.folder, t("export.pdf.runtime", { time: formatClock(runtime) }), date]
    .filter((part): part is string => !!part)
    .join(" · ");
}

/** Footer of a content page; the title page carries none. */
export function pdfPageLabel(page: number, total: number): string {
  return t("export.pdf.page", { page, total });
}
