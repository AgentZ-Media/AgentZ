import { For, Show, createEffect, createSignal, on } from "solid-js";
import { api } from "../../../lib/api";
import { runCharacterPrune } from "../../../lib/characterAutoPrune";
import { characterUsageBus } from "../../../lib/characterUsage";
import { requireSuccessfulFlush } from "@agentz/kit/lib";
import { scriptsBus } from "../../../lib/scriptsBus";
import { settingsStore } from "../../../stores/settings";
import { pushToast } from "@agentz/kit/stores";
import { localeCompare } from "@agentz/kit/i18n";
import { t, tPlural } from "../../../i18n";
import type { CharacterColorRecord } from "../../../lib/types";
import { confirmDialog } from "@agentz/kit/ui";
// TODO(integration): the colour picker lives with the editor (package D);
// follow it if it moves.
import { ColorPickerPopover } from "../../Editor/ColorPickerPopover";
import { Row, SectionHead, Switch } from "@agentz/kit/ui";


/** Names listed in the cleanup confirmation before "and N more". */
const CONFIRM_NAME_LIMIT = 12;

function nameList(names: string[]): string {
  if (names.length <= CONFIRM_NAME_LIMIT) return names.join(", ");
  return t("prefs.characters.cleanup.more", {
    names: names.slice(0, CONFIRM_NAME_LIMIT).join(", "),
    count: names.length - CONFIRM_NAME_LIMIT,
  });
}

/** App-wide character colours: every known character with its effective
 *  colour. Clicking the swatch changes it, "Zurücksetzen" drops a manual
 *  override (only shown when one exists). On top: the registry cleanup -
 *  a one-off "check now" (lists unused names, deletes after confirmation)
 *  and the switch that keeps it clean automatically. */
export function SettingsCharacters(props: { onClose(): void }) {
  const [records, setRecords] = createSignal<CharacterColorRecord[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [picker, setPicker] = createSignal<{ name: string; color: string; x: number; y: number } | null>(null);
  const [checking, setChecking] = createSignal(false);
  // Result of the last check: names marked "nicht verwendet" in the list.
  const [unused, setUnused] = createSignal<Set<string>>(new Set());

  async function reload() {
    try {
      const all = await api.listCharacterColors();
      setRecords(
        all
          .filter((r) => (r.override_color ?? r.default_color) !== null)
          .sort((a, b) => localeCompare(a.name, b.name)),
      );
    } catch {
      setRecords([]);
    } finally {
      setLoaded(true);
    }
  }
  // Initial load plus every registry cleanup (manual or automatic).
  createEffect(on(characterUsageBus.registryVersion, () => void reload()));

  const failed = (err: unknown) =>
    pushToast(t("prefs.characters.cleanup.failed", { message: (err as Error)?.message ?? String(err) }), "error");

  async function checkUnused() {
    if (checking()) return;
    setChecking(true);
    try {
      // Pending editor saves first, so a name typed a moment ago counts.
      await requireSuccessfulFlush();
      const [names, all] = await Promise.all([api.findUnusedCharacterNames(), api.listCharacterColors()]);
      setUnused(new Set(names));
      if (names.length === 0) {
        pushToast(t("prefs.characters.cleanup.allUsed"), "ok");
        return;
      }
      const ok = await confirmDialog({
        title: tPlural("prefs.characters.cleanup.title", names.length),
        body: t("prefs.characters.cleanup.body", {
          used: tPlural("prefs.characters.cleanup.used", Math.max(0, all.length - names.length)),
          names: nameList(names),
        }),
        confirmLabel: t("prefs.characters.cleanup.confirm"),
        danger: true,
      });
      if (!ok) return;
      await requireSuccessfulFlush();
      const removed = await api.pruneUnusedCharacterNames(names);
      setUnused(new Set<string>());
      pushToast(tPlural("prefs.characters.cleanup.done", removed.length), "ok");
    } catch (err) {
      failed(err);
    } finally {
      setChecking(false);
    }
  }

  async function setAutoPrune(enabled: boolean) {
    try {
      await settingsStore.setPruneUnusedCharacters(enabled);
    } catch (err) {
      failed(err);
      return;
    }
    if (!enabled) return;
    // Switching it on cleans up right away - what "only keep names in use"
    // promises. Later drops are handled in the background.
    try {
      await requireSuccessfulFlush();
      const removed = await runCharacterPrune();
      setUnused(new Set<string>());
      if (removed.length > 0) pushToast(tPlural("prefs.characters.cleanup.done", removed.length), "ok");
    } catch (err) {
      failed(err);
    }
  }

  const colorOf = (r: CharacterColorRecord) => r.override_color ?? r.default_color ?? "";

  async function pick(color: string) {
    const p = picker();
    setPicker(null);
    if (!p) return;
    try {
      await api.setCharacterColor(p.name, color);
      scriptsBus.bump();
      await reload();
    } catch (err) {
      pushToast(t("settings.toast.colorFailed", { message: (err as Error)?.message ?? String(err) }), "error");
    }
  }

  async function reset(name: string) {
    setPicker(null);
    try {
      await api.clearCharacterColor(name);
      scriptsBus.bump();
      await reload();
    } catch (err) {
      pushToast(t("settings.toast.resetFailed", { message: (err as Error)?.message ?? String(err) }), "error");
    }
  }

  return (
    <>
      <SectionHead title={t("prefs.characters.title")} sub={t("prefs.characters.sub")} onClose={props.onClose} />
      <Row label={t("prefs.characters.autoPrune.label")} help={t("prefs.characters.autoPrune.help")}>
        <Switch
          checked={settingsStore.pruneUnusedCharacters()}
          onChange={(v) => void setAutoPrune(v)}
          label={t("prefs.characters.autoPrune.label")}
        />
      </Row>
      <Row label={t("prefs.characters.cleanup.label")} help={t("prefs.characters.cleanup.help")}>
        <button
          type="button"
          class="btn sm"
          disabled={checking() || records().length === 0}
          aria-busy={checking()}
          onClick={() => void checkUnused()}
        >
          {checking() ? t("prefs.characters.cleanup.busy") : t("prefs.characters.cleanup.button")}
        </button>
      </Row>
      <Show
        when={records().length > 0}
        fallback={
          <Show when={loaded()}>
            <p class="set-empty">{t("prefs.characters.empty")}</p>
          </Show>
        }
      >
        <div class="set-chars">
          <For each={records()}>
            {(rec) => (
              <div class="srow set-char">
                <div class="set-char-who">
                  <button
                    type="button"
                    class="set-swatch scriptz-color-picker-trigger"
                    style={{ "--dot": colorOf(rec) }}
                    aria-label={t("settings.characters.colorAria", { name: rec.name })}
                    title={t("settings.characters.colorAria", { name: rec.name })}
                    onClick={(ev) => {
                      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                      setPicker({ name: rec.name, color: colorOf(rec), x: r.right + 8, y: r.top });
                    }}
                  />
                  <span class="set-char-name">{rec.name}</span>
                  <Show when={rec.override_color}>
                    <span class="set-char-tag">{t("prefs.characters.custom")}</span>
                  </Show>
                  <Show when={unused().has(rec.name)}>
                    <span class="set-char-tag">{t("prefs.characters.unused")}</span>
                  </Show>
                </div>
                <Show when={rec.override_color}>
                  <button type="button" class="btn sm" onClick={() => void reset(rec.name)}>
                    {t("settings.characters.reset")}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <ColorPickerPopover
        open={picker() !== null}
        x={picker()?.x ?? 0}
        y={picker()?.y ?? 0}
        characterName={picker()?.name ?? ""}
        currentColor={picker()?.color ?? ""}
        onPick={(c) => void pick(c)}
        onReset={() => void reset(picker()?.name ?? "")}
        onClose={() => setPicker(null)}
      />
    </>
  );
}
