import { For, Show, createSignal, onMount } from "solid-js";
import { api } from "../../../lib/api";
import { scriptsBus } from "../../../lib/scriptsBus";
import { pushToast } from "../../../stores/toasts";
import { localeCompare, t } from "../../../i18n";
import type { CharacterColorRecord } from "../../../lib/types";
// TODO(integration): the colour picker lives with the editor (package D);
// follow it if it moves.
import { ColorPickerPopover } from "../../Editor/ColorPickerPopover";
import { SectionHead } from "./parts";

/** App-wide character colours: every known character with its effective
 *  colour. Clicking the swatch changes it, "Zurücksetzen" drops a manual
 *  override (only shown when one exists). */
export function SettingsCharacters(props: { onClose(): void }) {
  const [records, setRecords] = createSignal<CharacterColorRecord[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [picker, setPicker] = createSignal<{ name: string; color: string; x: number; y: number } | null>(null);

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
  onMount(() => void reload());

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
