// Multi-script PDF export: one PDF per selected script.
//
// Desktop picks a target directory once and writes one file per script into
// it. The browser has no directory access, so it falls back to one blob
// download per script. Either way the user gets separate, individually
// laid-out PDFs (each with its own title page / A4 geometry).

import { getPlatformAdapter } from "./platform";
import { getStorageAdapter } from "./storage";
import { buildPdfBytes } from "./exportPdf";
import { t } from "../i18n";

function sanitizePdfFilename(title: string): string {
  const fallback = t("common.untitled");
  const cleaned = (title || fallback).replace(/[\\/:*?"<>|]+/g, "_").trim();
  return `${cleaned || fallback}.pdf`;
}

export interface PdfExportOptions {
  includeHighlighting: boolean;
  includeTitlePage: boolean;
}

export interface PdfExportResult {
  count: number;
  /** True when the user cancelled the directory picker (desktop). */
  cancelled: boolean;
}

export async function exportScriptsToPdf(
  scriptIds: string[],
  opts: PdfExportOptions,
): Promise<PdfExportResult> {
  if (scriptIds.length === 0) return { count: 0, cancelled: false };
  const storage = getStorageAdapter();
  const platform = getPlatformAdapter();

  const buildFor = async (id: string) => {
    const s = await storage.getScript(id);
    const bytes = await buildPdfBytes(
      { title: s.title, contentJson: s.content_json, characters: s.characters ?? [] },
      opts,
    );
    return { name: sanitizePdfFilename(s.title), bytes };
  };

  // Desktop: pick a folder once, write one file per script.
  if (platform.supportsDirectoryWrite) {
    const dir = await platform.pickDirectory();
    if (!dir) return { count: 0, cancelled: true };
    const sep = dir.includes("\\") ? "\\" : "/";
    let count = 0;
    for (const id of scriptIds) {
      const { name, bytes } = await buildFor(id);
      await platform.writeFileTo(`${dir}${sep}${name}`, bytes);
      count++;
    }
    return { count, cancelled: false };
  }

  // Browser: one blob download per script.
  let count = 0;
  for (const id of scriptIds) {
    const { name, bytes } = await buildFor(id);
    await platform.saveAs(
      {
        suggestedName: name,
        mimeType: "application/pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      },
      bytes,
    );
    count++;
  }
  return { count, cancelled: false };
}
