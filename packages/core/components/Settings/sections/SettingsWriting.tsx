import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { registerFlusher } from "../../../lib/saveFlush";
import { createSerialSaver } from "../../../lib/serialSave";
import { settingsStore } from "../../../stores/settings";
import { K } from "../../../lib/keys";
import { t } from "../../../i18n";
import { RangeFields, Row, SectionHead, Switch } from "./parts";

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
  const commit = () => saver.flush();
  const unregister = registerFlusher(commit);
  onCleanup(() => {
    void commit().finally(unregister);
  });
  const step = (delta: number) => {
    const next = settingsStore.dialogWpm() + delta;
    void settingsStore.setDialogWpm(next);
    setText(String(settingsStore.dialogWpm()));
    saver.resetBaseline(settingsStore.dialogWpm());
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
      <Row label={t("prefs.focus.label")} help={t("prefs.focus.help", { key: K("Mod+Shift+F") })}>
        <Switch
          checked={settingsStore.focusModeDefault()}
          onChange={(v) => void settingsStore.setFocusModeDefault(v)}
          label={t("prefs.focus.label")}
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
