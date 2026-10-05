import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { registerFlusher } from "@agentz/kit/lib";
import { createSerialSaver } from "@agentz/kit/lib";
import { settingsStore } from "../../../stores/settings";
import { K } from "@agentz/kit/platform";
import { t } from "../../../i18n";
import { Row, SectionHead, Switch } from "@agentz/kit/ui";
import { RangeFields } from "./parts";

function WpmField() {
  const [text, setText] = createSignal(String(settingsStore.dialogWpm()));
  let focused = false;
  // Follow the store (load, arrow keys, other windows) but never clobber
  // what the user is typing.
  createEffect(
    on(settingsStore.dialogWpm, (v) => {
      if (!focused) setText(String(v));
    }),
  );
  // Serialized so two quick commits can't land out of order; the field is
  // only rewritten to the stored (clamped) value if it still holds the text
  // that commit used.
  const saver = createSerialSaver<string, number>({
    initial: settingsStore.dialogWpm(),
    read: () => text(),
    isClean: (raw, base) => raw.trim() === String(base),
    async write(raw, base) {
      const n = Number(raw.trim());
      if (!raw.trim() || !Number.isFinite(n)) {
        if (text() === raw) setText(String(base));
        return base;
      }
      // The store clamps to its range; reflect the clamped value.
      await settingsStore.setDialogWpm(n);
      const stored = settingsStore.dialogWpm();
      if (text() === raw) setText(String(stored));
      return stored;
    },
    onError: (err) => console.warn("[scriptz] saving the WPM setting failed", err),
  });
  let disposed = false;
  const commit = async () => {
    const result = await saver.flush();
    if (disposed && result.ok) unregister();
    return result;
  };
  const unregister = registerFlusher(commit, "settings:dialog-wpm", "state");
  onCleanup(() => {
    disposed = true;
    void commit();
  });
  // Arrow keys only edit the draft and go through the same saver as typing,
  // so steps are serialized with commits and covered by flush (dialog
  // close, window close). Steps from what the field shows, not from the
  // store, which lags behind a queued save.
  const step = (delta: number) => {
    const raw = text().trim();
    const n = Number(raw);
    const from = raw && Number.isFinite(n) ? n : settingsStore.dialogWpm();
    const next = Math.max(
      settingsStore.DIALOG_WPM_MIN,
      Math.min(settingsStore.DIALOG_WPM_MAX, Math.round(from + delta)),
    );
    setText(String(next));
    saver.schedule();
  };
  return (
    <label class="num-f">
      <input
        inputMode="numeric"
        value={text()}
        aria-label={t("prefs.wpm.label")}
        onFocus={() => (focused = true)}
        onInput={(e) => {
          setText(e.currentTarget.value);
          saver.markDirty();
        }}
        onBlur={() => {
          focused = false;
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            step(e.key === "ArrowUp" ? 10 : -10);
          }
        }}
      />
      <span>{t("prefs.wpm.unit")}</span>
    </label>
  );
}

export function SettingsWriting(props: { onClose(): void }) {
  return (
    <>
      <SectionHead title={t("prefs.writing.title")} sub={t("prefs.writing.sub")} onClose={props.onClose} />
      <Row label={t("prefs.wpm.label")} help={t("prefs.wpm.help")}>
        <WpmField />
      </Row>
      <Row label={t("prefs.defaultRange.label")} help={t("prefs.defaultRange.help")}>
        <RangeFields
          label={t("prefs.defaultRange.label")}
          minSec={settingsStore.lengthMinDefaultSec()}
          maxSec={settingsStore.lengthMaxDefaultSec()}
          minPlaceholder="0:30"
          maxPlaceholder="1:00"
          onCommit={async (min, max) => {
            await settingsStore.setLengthMinDefaultSec(min);
            await settingsStore.setLengthMaxDefaultSec(max);
          }}
        />
      </Row>
      <Row label={t("prefs.quickMode.label")} help={t("prefs.quickMode.help")}>
        <Switch
          checked={settingsStore.quickModeAutoEnable()}
          onChange={(v) => void settingsStore.setQuickModeAutoEnable(v)}
          label={t("prefs.quickMode.label")}
        />
      </Row>
      <Row label={t("prefs.highlighting.label")} help={t("prefs.highlighting.help")}>
        <Switch
          checked={settingsStore.highlightingDefault()}
          onChange={(v) => void settingsStore.setHighlightingDefault(v)}
          label={t("prefs.highlighting.label")}
        />
      </Row>
      <Row label={t("prefs.exportTitlePage.label")} help={t("prefs.exportTitlePage.help")}>
        <Switch
          checked={settingsStore.exportTitlePageDefault()}
          onChange={(v) => void settingsStore.setExportTitlePageDefault(v)}
          label={t("prefs.exportTitlePage.label")}
        />
      </Row>
      <Row label={t("prefs.focus.label")} help={t("prefs.focus.help", { key: K("Mod+Shift+F") })}>
        <Switch
          checked={settingsStore.focusModeDefault()}
          onChange={(v) => void settingsStore.setFocusModeDefault(v)}
          label={t("prefs.focus.label")}
        />
      </Row>
      <Row label={t("prefs.typewriter.label")} help={t("prefs.typewriter.help")}>
        <Switch
          checked={settingsStore.focusTypewriter()}
          onChange={(v) => void settingsStore.setFocusTypewriter(v)}
          label={t("prefs.typewriter.label")}
        />
      </Row>
      <Row label={t("prefs.counter.label")} help={t("prefs.counter.help")}>
        <Switch
          checked={settingsStore.showWritingStats()}
          onChange={(v) => void settingsStore.setShowWritingStats(v)}
          label={t("prefs.counter.label")}
        />
      </Row>
    </>
  );
}
