import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { api } from "../../../lib/api";
import { scriptsBus } from "../../../lib/scriptsBus";
import {
  MAX_STAGES,
  MAX_STAGE_LABEL,
  MIN_STAGES,
  defaultStageLabel,
  newStageId,
  scriptStages,
  stageLabel,
  type StageDef,
} from "../../../lib/stages";
import { settingsStore } from "../../../stores/settings";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../../i18n";
import { Icon, SectionHead, confirmDialog } from "@agentz/kit/ui";
import { StageGlyph } from "../../Common/StageGlyph";

/** Editable pipeline: rename, reorder, add and remove stages. The last
 *  stage is "done". Removing a stage first moves its scripts (trash
 *  included) to the neighbouring stage, so no script loses its place. */
export function SettingsStages(props: { onClose(): void }) {
  const [busy, setBusy] = createSignal(false);
  // Id of a freshly added stage: its name field takes focus once.
  const [focusId, setFocusId] = createSignal<string | null>(null);
  const ids = () => scriptStages().map((s) => s.id);
  const count = () => scriptStages().length;

  const failed = (err: unknown) =>
    pushToast(t("prefs.stages.failed", { message: (err as Error)?.message ?? String(err) }), "error");

  async function save(next: StageDef[]): Promise<boolean> {
    try {
      await settingsStore.setScriptStages(next);
      return true;
    } catch (err) {
      failed(err);
      return false;
    }
  }

  function rename(id: string, raw: string) {
    const label = raw.trim().slice(0, MAX_STAGE_LABEL);
    const fallback = defaultStageLabel(id);
    const list = scriptStages();
    const cur = list.find((s) => s.id === id);
    if (!cur) return;
    // Built-in stages without an own name follow the app language.
    const nextLabel = !label || label === fallback ? undefined : label;
    if (!nextLabel && fallback === null) return; // custom stages keep a name
    if (nextLabel === cur.label) return;
    void save(list.map((s) => (s.id === id ? (nextLabel ? { id, label: nextLabel } : { id }) : s)));
  }

  function move(id: string, dir: -1 | 1) {
    const list = [...scriptStages()];
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void save(list);
  }

  function add() {
    const list = scriptStages();
    if (list.length >= MAX_STAGES) return;
    const id = newStageId();
    setFocusId(id);
    void save([...list, { id, label: t("prefs.stages.newName") }]);
  }

  async function remove(id: string) {
    if (busy()) return;
    setBusy(true);
    try {
      const list = scriptStages();
      const i = list.findIndex((s) => s.id === id);
      if (i < 0 || list.length <= MIN_STAGES) return;
      // Scripts move one stage back; the first stage hands them forward.
      const target = list[i > 0 ? i - 1 : 1].id;
      const n = await api.countScriptsWithStatus(id);
      if (n > 0) {
        const ok = await confirmDialog({
          title: t("prefs.stages.removeTitle", { stage: stageLabel(id) }),
          body: tPlural("prefs.stages.removeBody", n, { target: stageLabel(target) }),
          confirmLabel: t("prefs.stages.removeConfirm"),
          danger: true,
        });
        if (!ok) return;
      }
      // The list may have changed while the dialog was open.
      const current = scriptStages();
      if (!current.some((s) => s.id === id) || !current.some((s) => s.id === target)) return;
      if (current.length <= MIN_STAGES) return;
      const moved = await api.reassignScriptStatus(id, target);
      const targetName = stageLabel(target);
      const saved = await save(current.filter((s) => s.id !== id));
      if (moved > 0) {
        scriptsBus.bump();
        if (saved) pushToast(tPlural("prefs.stages.moved", moved, { target: targetName }), "ok");
      }
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHead title={t("prefs.stages.title")} sub={t("prefs.stages.sub")} onClose={props.onClose} />
      <ol class="set-stages">
        <For each={ids()}>
          {(id, i) => (
            <li class="set-stage">
              <StageGlyph stage={id} />
              <StageName
                id={id}
                index={i()}
                autofocus={focusId() === id}
                onFocused={() => setFocusId(null)}
                onCommit={(v) => rename(id, v)}
              />
              <Show when={i() === count() - 1}>
                <span class="set-stage-tag">{t("prefs.stages.done")}</span>
              </Show>
              <div class="set-stage-acts">
                <button
                  type="button"
                  class="btn icon sm"
                  disabled={busy() || i() === 0}
                  title={t("prefs.stages.up")}
                  aria-label={`${t("prefs.stages.up")}: ${stageLabel(id)}`}
                  onClick={() => move(id, -1)}
                >
                  <Icon name="up" size={13} />
                </button>
                <button
                  type="button"
                  class="btn icon sm"
                  disabled={busy() || i() === count() - 1}
                  title={t("prefs.stages.down")}
                  aria-label={`${t("prefs.stages.down")}: ${stageLabel(id)}`}
                  onClick={() => move(id, 1)}
                >
                  <Icon name="down" size={13} />
                </button>
                <button
                  type="button"
                  class="btn icon sm"
                  disabled={busy() || count() <= MIN_STAGES}
                  title={t("prefs.stages.remove")}
                  aria-label={`${t("prefs.stages.remove")}: ${stageLabel(id)}`}
                  onClick={() => void remove(id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </li>
          )}
        </For>
      </ol>
      <div class="set-stages-foot">
        <button type="button" class="btn sm" disabled={busy() || count() >= MAX_STAGES} onClick={add}>
          <Icon name="plus" size={12} />
          {t("prefs.stages.add")}
        </button>
        <small>{t("prefs.stages.limit", { count: count(), max: MAX_STAGES, min: MIN_STAGES })}</small>
      </div>
    </>
  );
}

/** Name field of one stage. Commits on blur, Enter and unmount; Escape
 *  restores the stored name. Built-in stages show their translated name. */
function StageName(props: {
  id: string;
  index: number;
  autofocus: boolean;
  onFocused(): void;
  onCommit(value: string): void;
}) {
  let inputRef: HTMLInputElement | undefined;
  let dirty = false;
  // Memo: other stages changing must not rewrite this field while typing.
  const stored = createMemo(() => stageLabel(props.id));

  const commit = () => {
    if (!dirty || !inputRef) return;
    dirty = false;
    props.onCommit(inputRef.value);
    // Show the effective name (empty built-in name = translated default).
    inputRef.value = stored();
  };
  onCleanup(commit);

  return (
    <input
      ref={(el) => {
        inputRef = el;
        if (props.autofocus) {
          requestAnimationFrame(() => {
            el.focus();
            el.select();
            props.onFocused();
          });
        }
      }}
      type="text"
      class="field set-stage-name"
      value={stored()}
      placeholder={defaultStageLabel(props.id) ?? ""}
      maxLength={MAX_STAGE_LABEL}
      spellcheck={false}
      aria-label={t("prefs.stages.nameAria", { n: props.index + 1 })}
      onInput={() => (dirty = true)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape" && dirty) {
          // Only swallow Escape while there is something to discard;
          // otherwise it closes the dialog as usual.
          e.preventDefault();
          e.stopPropagation();
          dirty = false;
          e.currentTarget.value = stored();
        }
      }}
    />
  );
}
