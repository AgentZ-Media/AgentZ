import { createEffect, createSignal } from "solid-js";
import { settingsStore } from "../../../stores/settings";
import { K } from "../../../lib/keys";
import { t } from "../../../i18n";
import { RangeFields, Row, SectionHead, Switch } from "./parts";

function WpmField() {
  const [text, setText] = createSignal(String(settingsStore.dialogWpm()));
  createEffect(() => setText(String(settingsStore.dialogWpm())));
  const commit = () => {
    const n = Number(text().trim());
    if (!text().trim() || !Number.isFinite(n)) {
      setText(String(settingsStore.dialogWpm()));
      return;
    }
    // The store clamps to its range; reflect the clamped value.
    void settingsStore.setDialogWpm(n).then(() => setText(String(settingsStore.dialogWpm())));
  };
  return (
    <label class="num-f">
      <input
        inputMode="numeric"
        value={text()}
        aria-label={t("prefs.wpm.label")}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const step = e.key === "ArrowUp" ? 10 : -10;
            void settingsStore.setDialogWpm(settingsStore.dialogWpm() + step);
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
