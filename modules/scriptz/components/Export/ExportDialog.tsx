import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, untrack } from "solid-js";
import { api } from "../../lib/api";
import { extractBlocks, extractTeleprompterText } from "../../lib/lex";
import { getPlatformAdapter } from "@agentz/kit/platform";
import { requireSuccessfulFlush } from "@agentz/kit/lib";
import { scriptsBus } from "../../lib/scriptsBus";
import { defaultScriptzFilename } from "../../lib/scriptzFile";
import { settingsStore } from "../../stores/settings";
import { pushToast } from "@agentz/kit/stores";
import { uiStore } from "../../stores/ui";
import { t, tPlural } from "../../i18n";
import type { Script } from "../../lib/types";
import { Icon } from "@agentz/kit/ui";
import { DialogFrame } from "@agentz/kit/ui";
import { layoutPdfPreview } from "./pdfPreview";
import { pdfPageLabel, pdfTitleDetails } from "../../lib/pdfDetails";
import { library } from "../Shell/libraryData";
import "./ExportDialog.css";

type Format = "pdf" | "txt" | "scriptz";
const FORMATS: Format[] = ["pdf", "txt", "scriptz"];

/** Export dialog (⌘E). Parameterless: the script comes from
 *  `uiStore.exportScriptId()`. Left a live preview (every PDF page laid
 *  out like lib/exportPdf.ts, or the teleprompter text), right the three
 *  formats as cards and the options that belong to the chosen format. */
export function ExportDialog() {
  const [script, setScript] = createSignal<Script | null>(null);
  const [format, setFormat] = createSignal<Format>("pdf");
  const [highlighting, setHighlighting] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);

  const open = () => uiStore.exportScriptId() !== null;

  // Load the script fresh on every open; PDF title pages follow the saved preference.
  createEffect(() => {
    const id = uiStore.exportScriptId();
    if (!id) return;
    untrack(() => reset(id));
  });
  // Live preview: follow saves (autosave, rename, colours) while open.
  createEffect(
    on(
      scriptsBus.version,
      () => {
        const id = uiStore.exportScriptId();
        if (id && script()?.id === id) void load(id, false);
      },
      { defer: true },
    ),
  );

  let loadSeq = 0;
  /** Drains buffered/in-flight saves (⌘E right after typing lands before
   *  the 250 ms autosave debounce), then reads the stored script. */
  async function load(id: string, applyScriptOptions: boolean): Promise<void> {
    const seq = ++loadSeq;
    try {
      await requireSuccessfulFlush();
      const s = await api.getScript(id);
      if (seq !== loadSeq || uiStore.exportScriptId() !== id) return;
      setScript(s);
      if (applyScriptOptions) {
        if (s.highlighting_enabled === 1) setHighlighting(true);
        else if (s.highlighting_enabled === 0) setHighlighting(false);
      }
    } catch (err) {
      if (seq !== loadSeq || uiStore.exportScriptId() !== id) return;
      pushToast(t("export.toast.failed", { message: String(err) }), "error");
      if (applyScriptOptions) uiStore.closeExport();
    }
  }

  function reset(id: string) {
    setScript(null);
    setFormat("pdf");
    setExporting(false);
    setHighlighting(settingsStore.highlightingDefault());
    void load(id, true);
  }

  const title = () => script()?.title || t("common.untitled");
  const blocks = createMemo(() => {
    const s = script();
    return s ? extractBlocks(s.content_json) : [];
  });
  // Folder, runtime and date for the title page - the same line goes
  // into the preview and the exported PDF.
  const titleDetails = createMemo(() => {
    const s = script();
    if (!s || !settingsStore.exportTitlePageDefault()) return null;
    return pdfTitleDetails({
      folder: library.folder(s.folder_id)?.name ?? null,
      contentJson: s.content_json,
      wpm: settingsStore.dialogWpm(),
      date: new Date(),
    });
  });
  const pages = createMemo(() => {
    const s = script();
    if (!s) return [];
    const names = (s.characters ?? []).map((c) => c.name);
    return layoutPdfPreview({
      title: title(),
      blocks: blocks(),
      characters: s.characters ?? [],
      includeHighlighting: highlighting(),
      includeTitlePage: settingsStore.exportTitlePageDefault(),
      castLine: names.length > 0 ? t("export.pdf.characters", { names: names.join(", ") }) : null,
      titleDetails: titleDetails(),
      pageLabel: pdfPageLabel,
    });
  });
  const teleprompter = createMemo(() => {
    const s = script();
    return s && format() === "txt" ? extractTeleprompterText(s.content_json) : "";
  });

  const fileName = () => {
    if (format() === "pdf") return `${title()}.pdf`;
    if (format() === "txt") return `${title()}.txt`;
    return defaultScriptzFilename(script()?.title ?? "");
  };

  const close = () => {
    if (!exporting()) uiStore.closeExport();
  };

  async function run() {
    const id = uiStore.exportScriptId();
    if (!id || exporting() || !script()) return;
    setExporting(true);
    try {
      // The exporters read the stored content - persist pending typing.
      await requireSuccessfulFlush();
      const fmt = format();
      const result =
        fmt === "pdf"
          ? await api.exportPdf({ scriptId: id, includeHighlighting: highlighting(), includeTitlePage: settingsStore.exportTitlePageDefault(), titleDetails: titleDetails() })
          : fmt === "txt"
            ? await api.exportPlaintext({ scriptId: id })
            : await api.exportScriptz(id);
      if (result.cancelled) return;
      if (result.path) {
        let revealed = true;
        try {
          await getPlatformAdapter().revealInFolder(result.path);
        } catch (err) {
          revealed = false;
          console.warn("[scriptz] revealInFolder failed", err);
        }
        pushToast(revealed ? t("export.toast.saved") : t("export.toast.savedAt", { path: result.path }), "ok");
      } else {
        pushToast(t("export.toast.downloaded"), "ok");
      }
      setExporting(false);
      uiStore.closeExport();
    } catch (e) {
      pushToast(t("export.toast.failed", { message: String(e) }), "error");
    } finally {
      setExporting(false);
    }
  }

  const onDialogKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    // Buttons and switches activate themselves on Enter.
    if (target instanceof HTMLButtonElement && !target.classList.contains("fmt-it")) return;
    e.preventDefault();
    void run();
  };

  const onFormatKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = FORMATS.indexOf(format());
    const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = FORMATS[(i + delta + FORMATS.length) % FORMATS.length];
    setFormat(next);
    const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-fmt="${next}"]`);
    el?.focus();
  };

  const formatTitle = (f: Format) =>
    f === "pdf" ? t("exportDialog.fmt.pdf") : f === "txt" ? t("exportDialog.fmt.txt") : t("exportDialog.fmt.scriptz");
  const formatSub = (f: Format) =>
    f === "pdf" ? t("exportDialog.fmt.pdfSub") : f === "txt" ? t("exportDialog.fmt.txtSub") : t("exportDialog.fmt.scriptzSub");

  return (
    <DialogFrame open={open()} onClose={close} label={t("exportDialog.title")} class="exp">
      <div class="exp-grid" onKeyDown={onDialogKey}>
        <div class="exp-prev" aria-hidden="true">
          <Switch>
            <Match when={format() === "pdf"}>
              {/* Every page, exactly as the PDF breaks them. */}
              <div class="pdf-pages">
                <For each={pages()}>
                  {(page) => (
                    <div class="pdf-page" data-theme="light">
                      <For each={page.lines}>
                        {(line) => (
                          <div
                            class="pdf-line"
                            classList={{ b: line.bold, it: line.italic, c: line.align === "center" }}
                            style={{
                              "--x": String(line.xMm),
                              "--w": String(line.widthMm),
                              "--y": String(line.baselineMm),
                            }}
                          >
                            <Show when={line.tint} fallback={line.text}>
                              {(tint) => (
                                <span class="pdf-tint" style={{ "--tc": tint() }}>
                                  {line.text}
                                </span>
                              )}
                            </Show>
                          </div>
                        )}
                      </For>
                      <Show when={page.footer}>
                        <div class="pdf-foot">{page.footer}</div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
              <div class="pdf-meta">
                <b>{t("exportDialog.preview.label")}</b> ·{" "}
                {t("exportDialog.preview.pages", { n: Math.max(1, pages().length) })} · A4
              </div>
            </Match>
            <Match when={format() === "txt"}>
              <div class="txt-page" data-theme="light">
                <pre>{teleprompter() || t("exportDialog.preview.emptyText")}</pre>
              </div>
              <div class="pdf-meta">
                <b>{t("exportDialog.preview.label")}</b> · {t("exportDialog.preview.plain")}
              </div>
            </Match>
            <Match when={format() === "scriptz"}>
              <div class="file-card">
                <span class="file-ic">
                  <Icon name="doc" size={30} />
                </span>
                <b>{fileName()}</b>
                <small>{tPlural("exportDialog.preview.blocks", blocks().length)}</small>
              </div>
              <p class="file-help">{t("export.help.scriptz")}</p>
            </Match>
          </Switch>
        </div>

        <div class="exp-body">
          <div class="dlg-h">
            <b>{t("exportDialog.title")}</b>
            <button type="button" class="dlg-esc" onClick={close} aria-label={t("common.close")} tabindex="-1">
              <kbd>esc</kbd>
            </button>
          </div>
          <div class="fmt" role="radiogroup" aria-label={t("exportDialog.fmt.aria")} onKeyDown={onFormatKey}>
            <For each={FORMATS}>
              {(f) => (
                <button
                  type="button"
                  class="fmt-it"
                  classList={{ on: format() === f }}
                  role="radio"
                  aria-checked={format() === f}
                  tabindex={format() === f ? 0 : -1}
                  data-fmt={f}
                  data-autofocus={format() === f ? "" : undefined}
                  onClick={() => setFormat(f)}
                >
                  <span class="rd" />
                  <span>
                    <b>{formatTitle(f)}</b>
                    <small>{formatSub(f)}</small>
                  </span>
                </button>
              )}
            </For>
          </div>

          <Show when={format() === "pdf"}>
            <div class="opts">
              <div class="srow">
                <div>
                  <b>{t("exportDialog.opt.colors")}</b>
                  <small>{t("exportDialog.opt.colorsSub")}</small>
                </div>
                <button
                  type="button"
                  class="sw-t"
                  role="switch"
                  aria-checked={highlighting()}
                  aria-label={t("exportDialog.opt.colors")}
                  onClick={() => setHighlighting(!highlighting())}
                />
              </div>
              <div class="srow">
                <div>
                  <b>{t("exportDialog.opt.titlePage")}</b>
                  <small>{t("exportDialog.opt.titlePageSub")}</small>
                </div>
                <button
                  type="button"
                  class="sw-t"
                  role="switch"
                  aria-checked={settingsStore.exportTitlePageDefault()}
                  aria-label={t("exportDialog.opt.titlePage")}
                  onClick={() => void settingsStore.setExportTitlePageDefault(!settingsStore.exportTitlePageDefault())}
                />
              </div>
            </div>
          </Show>

          <div class="exp-foot">
            <span class="fname" title={fileName()}>
              <Icon name="doc" size={13} />
              <span>{fileName()}</span>
            </span>
            <span class="sp" />
            <button type="button" class="btn ghost" onClick={close} disabled={exporting()}>
              {t("common.cancel")}
            </button>
            <button type="button" class="btn primary" onClick={() => void run()} disabled={exporting() || !script()}>
              {exporting() ? t("export.exporting") : t("export.button")}
              <Show when={!exporting()}>
                <kbd>⏎</kbd>
              </Show>
            </button>
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

export default ExportDialog;
