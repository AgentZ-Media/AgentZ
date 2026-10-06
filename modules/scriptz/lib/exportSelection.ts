// Multi-script PDF export: one PDF per selected script.
//
// Desktop picks a target directory once and writes one file per script into
// it. The browser has no directory access, so it falls back to one blob
// download per script. Either way the user gets separate, individually
// laid-out PDFs (each with its own title page / A4 geometry).

import { getPlatformAdapter } from "@agentz/kit/platform";
import { getStorageAdapter } from "./storage";
import { buildPdfBytes } from "./exportPdf";
import { pdfTitleDetails } from "./pdfDetails";
import { t } from "../i18n";

function sanitizeTitle(title: string): string {
  const fallback = t("common.untitled");
  const cleaned = (title || fallback).replace(/[\\/:*?"<>|]+/g, "_").trim();
  return cleaned || fallback;
}

/** Hands out one PDF file name per title, in order. Repeated titles get
 *  " (2)", " (3)" so no file overwrites another (compared without case,
 *  like the macOS and Windows file systems). */
export function createPdfNamer(): (title: string) => string {
  const used = new Set<string>();
  return (title) => {
    const base = sanitizeTitle(title);
    let name = `${base}.pdf`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).pdf`;
    used.add(name.toLowerCase());
    return name;
  };
}

/** File names of a multi export, the same ones `exportScriptsToPdf` writes. */
export function pdfFilenames(titles: readonly string[]): string[] {
  const name = createPdfNamer();
  return titles.map(name);
}

export interface PdfExportOptions {
  includeHighlighting: boolean;
  includeTitlePage: boolean;
  /** Speaking pace for the runtime on the title page. */
  wpm: number;
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

  const folders = opts.includeTitlePage ? await storage.listFolders().catch(() => []) : [];
  const date = new Date();
  const nameFor = createPdfNamer();
  const buildFor = async (id: string) => {
    const s = await storage.getScript(id);
    const titleDetails = opts.includeTitlePage
      ? pdfTitleDetails({
          folder: folders.find((f) => f.id === s.folder_id)?.name ?? null,
          contentJson: s.content_json,
          wpm: opts.wpm,
          date,
        })
      : null;
    const bytes = await buildPdfBytes(
      { title: s.title, contentJson: s.content_json, characters: s.characters ?? [] },
      { includeHighlighting: opts.includeHighlighting, includeTitlePage: opts.includeTitlePage, titleDetails },
    );
    return { name: nameFor(s.title), bytes };
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
