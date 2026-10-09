import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon, dismissOnDialog } from "@agentz/kit/ui";
import { t } from "../../i18n";
import { agentStore } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { uiStore } from "../../stores/ui";

// Model picker of the agent settings: a field-like trigger plus a `.menu`
// popover. Long lists (all OpenRouter models) get a search field on top.
// The empty value is the connection's recommended model (or, with
// `sameLabel`, "same as the default model"). Keyboard: ↑/↓ move, ⏎ picks,
// esc closes (and marks the event handled so the settings stay open).

/** From this many entries on, the popover has a search field. */
const SEARCH_FROM = 9;
const WIDTH = 300;

interface Option {
  id: string;
  label: string;
  recommended: boolean;
}

let lists = 0;

export function ModelSelect(props: {
  value: string;
  onChange(v: string): void;
  label: string;
  sameLabel?: string;
  /** Shows the button that reloads the list (default true). */
  refresh?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const [pos, setPos] = createSignal<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const listId = `ag-model-list-${++lists}`;
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  let list: HTMLDivElement | undefined;
  let search: HTMLInputElement | undefined;

  const models = () => agentStore.models();
  const fallback = () => models().find((m) => m.isDefault) ?? models()[0];
  const options = createMemo((): Option[] => {
    const first = fallback();
    if (!first) return [];
    // Without `sameLabel` the empty value is the recommended model itself,
    // so it is not listed twice.
    const head: Option = props.sameLabel
      ? { id: "", label: props.sameLabel, recommended: false }
      : { id: "", label: first.label, recommended: true };
    const rest = models()
      .filter((m) => props.sameLabel || m.id !== first.id)
      .map((m) => ({ id: m.id, label: m.label, recommended: m.isDefault }));
    return [head, ...rest];
  });
  const searchable = () => options().length >= SEARCH_FROM;
  const shown = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options();
    const first = fallback();
    return options().filter((o) => {
      const text = `${o.label} ${o.id || (props.sameLabel ? "" : first?.id ?? "")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });
  const selected = (o: Option) => o.id === props.value || (!o.id && !props.sameLabel && props.value === fallback()?.id);
  const current = () => {
    if (!options().length) return t(agentStore.modelsLoading() ? "agent.prefs.model.loading" : "agent.prefs.model.auto");
    return (options().find((o) => o.id === props.value) ?? options()[0]).label;
  };

  function place() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const height = Math.min(360, options().length * 32 + (searchable() ? 52 : 12));
    const left = Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8));
    if (r.bottom + 6 + height > window.innerHeight - 8 && r.top - 6 - height > 8) {
      setPos({ left, bottom: window.innerHeight - r.top + 6 });
    } else {
      setPos({ left, top: r.bottom + 6 });
    }
  }

  function openMenu() {
    if (!options().length) return;
    place();
    setQuery("");
    setActive(Math.max(0, options().findIndex(selected)));
    setOpen(true);
    queueMicrotask(() => (search ?? menu)?.focus());
  }
  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger?.focus();
  }
  function pick(index: number) {
    const option = shown()[index];
    if (!option) return;
    close();
    if (!selected(option)) props.onChange(option.id);
  }

  // The active entry stays in view while moving through the list. Scrolls
  // only the list, never the settings behind it.
  createEffect(() => {
    if (!open() || !list) return;
    const item = list.querySelector<HTMLElement>(`[data-idx="${active()}"]`);
    if (!item) return;
    const top = item.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight;
  });

  function onMenuKey(e: KeyboardEvent) {
    const n = shown().length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive((i) => (i - 1 + n) % n);
    } else if (e.key === "Enter" || (e.key === " " && !searchable())) {
      e.preventDefault();
      e.stopPropagation();
      pick(active());
    } else if (e.key === "Escape") {
      // preventDefault marks it handled for DialogFrame; stopPropagation
      // keeps page-level handlers out.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      close();
    }
  }

  // A dialog opening on top closes the popover instead of leaving it open
  // (and focusable) behind the scrim.
  dismissOnDialog({
    dialogOpen: uiStore.anyDialogOpen,
    open,
    inside: (node) => !!(trigger?.contains(node) || menu?.contains(node)),
    dismiss: () => close(false),
  });

  const onDocDown = (e: MouseEvent) => {
    if (!open()) return;
    const target = e.target as Node;
    if (trigger?.contains(target) || menu?.contains(target)) return;
    close(false);
  };
  // The popover is fixed: scrolling the settings or resizing would detach it.
  const onReflow = (e: Event) => {
    if (open() && !(e.target instanceof Node && menu?.contains(e.target))) close(false);
  };
  document.addEventListener("mousedown", onDocDown, true);
  window.addEventListener("resize", onReflow);
  window.addEventListener("scroll", onReflow, true);
  onCleanup(() => {
    document.removeEventListener("mousedown", onDocDown, true);
    window.removeEventListener("resize", onReflow);
    window.removeEventListener("scroll", onReflow, true);
  });

  return (
    <span class="ag-model-ctl">
      <button
        ref={trigger}
        type="button"
        class="ag-mp-trigger"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={props.label}
        disabled={options().length === 0}
        onClick={() => (open() ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <span class="ag-mp-cur">{current()}</span>
        <Icon name="down" size={13} />
      </button>
      <Show when={props.refresh !== false}>
        <button
          type="button"
          class="btn icon"
          title={t("agent.prefs.model.refresh")}
          aria-label={t("agent.prefs.model.refresh")}
          // Off means off: reloading would start the provider.
          disabled={agentStore.modelsLoading() || !agentSettings.enabled()}
          onClick={() => void agentStore.refreshModels().catch(() => {})}
        >
          <Icon name="refresh" size={14} />
        </button>
      </Show>
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            class="menu ag-mp-menu"
            data-dialog-dismiss-layer
            tabindex="-1"
            style={{
              left: `${pos().left}px`,
              width: `${WIDTH}px`,
              top: pos().top !== undefined ? `${pos().top}px` : undefined,
              bottom: pos().bottom !== undefined ? `${pos().bottom}px` : undefined,
            }}
            onKeyDown={onMenuKey}
          >
            <Show when={searchable()}>
              <label class="field-box ag-mp-search">
                <Icon name="search" size={13} />
                <input
                  ref={search}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={shown().length ? `${listId}-${active()}` : undefined}
                  aria-label={t("agent.prefs.model.search")}
                  placeholder={t("agent.prefs.model.search")}
                  autocomplete="off"
                  spellcheck={false}
                  value={query()}
                  onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    setActive(0);
                  }}
                />
              </label>
            </Show>
            <div ref={list} id={listId} class="ag-mp-list" role="listbox" aria-label={props.label}>
              <For each={shown()} fallback={<div class="ag-mp-empty">{t("agent.prefs.model.none")}</div>}>
                {(option, i) => (
                  <div
                    id={`${listId}-${i()}`}
                    data-idx={i()}
                    class="menu-it"
                    classList={{ on: i() === active() }}
                    role="option"
                    aria-selected={selected(option)}
                    onMouseEnter={() => setActive(i())}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(i());
                    }}
                  >
                    <span class="lbl">{option.label}</span>
                    <Show when={option.recommended}>
                      <span class="ag-mp-rec">{t("agent.prefs.model.recommended")}</span>
                    </Show>
                    <Show when={selected(option)}>
                      <span class="ck">
                        <Icon name="check" size={13} />
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </span>
  );
}
