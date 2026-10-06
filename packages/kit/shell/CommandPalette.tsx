import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { K } from "../platform";
import { t } from "../i18n";
import { Icon } from "../ui";
import type { Command, CommandProvider } from "./types";
import "./CommandPalette.css";

export interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  commands: CommandProvider;
  placeholder?: string;
}

/** Keyboard/search presentation. Providers own matching, ranking, and result content. */
export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal("");
  const [items, setItems] = createSignal<Command[]>([]);
  const [active, setActive] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let returnFocus: HTMLElement | null = null;

  createEffect(on(() => props.open, (open) => {
    if (!open) return;
    const previous = document.activeElement;
    returnFocus = previous instanceof HTMLElement && previous !== document.body ? previous : null;
    setQuery("");
    setActive(0);
    queueMicrotask(() => {
      if (props.open && inputRef?.isConnected) inputRef.focus();
    });
  }));

  createEffect(() => {
    const open = props.open;
    const value = query().trim();
    const provider = props.commands;
    setActive(0);
    if (!open) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    });
    try {
      setItems(provider.immediate?.(value) ?? []);
    } catch {
      setItems([]);
    }
    setLoading(true);
    const search = () => {
      try {
        const result = provider(value, controller.signal);
        if (Array.isArray(result)) {
          if (!controller.signal.aborted) { setItems(result); setLoading(false); }
        } else {
          void result.then((next) => {
            if (!controller.signal.aborted) { setItems(next); setLoading(false); }
          }, () => {
            if (!controller.signal.aborted) setLoading(false);
          });
        }
      } catch {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    // One-character/local queries stay instant; expensive searches keep the existing delay.
    if (value.length >= 2) timer = setTimeout(search, 140);
    else search();
  });

  // Async enrichment may shorten a result list while an arrow-selected row is active.
  createEffect(() => {
    const count = items().length;
    setActive((index) => Math.max(0, Math.min(index, count - 1)));
  });

  const close = () => props.onClose();
  const dismiss = () => {
    const element = returnFocus;
    returnFocus = null;
    close();
    if (element?.isConnected) queueMicrotask(() => element.focus());
  };

  const groups = createMemo(() => {
    const out: { key: string; label?: string; items: { item: Command; index: number }[] }[] = [];
    items().forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.key === (item.group?.id ?? "")) last.items.push({ item, index });
      else out.push({ key: item.group?.id ?? "", label: item.group?.label, items: [{ item, index }] });
    });
    return out;
  });

  const runItem = (item: Command | undefined) => {
    if (!item) return;
    returnFocus = null;
    close();
    // Let the palette unmount before the command opens another dialog.
    queueMicrotask(() => { void item.run(); });
  };

  // Keep the active row in view.
  createEffect(
    on(active, (i) => {
      queueMicrotask(() => {
        listRef?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView?.({ block: "nearest" });
      });
    }),
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    const n = items().length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive((i) => (i - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(items()[active()]);
    } else if (e.key === "Tab") {
      // Single-field dialog: keep the focus in the input.
      e.preventDefault();
    }
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="scrim top pal-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) dismiss();
          }}
        >
          <div class="dlg pal" role="dialog" aria-modal="true" aria-label={t("shell.palette.aria")}>
            <div class="pal-in">
              <Icon name="search" size={16} />
              <input
                ref={inputRef}
                class="pal-input"
                type="text"
                value={query()}
                placeholder={props.placeholder ?? t("shell.palette.defaultPlaceholder")}
                autocomplete="off"
                spellcheck={false}
                role="combobox"
                aria-expanded="true"
                aria-busy={loading()}
                aria-controls="pal-list"
                aria-activedescendant={items().length > 0 ? `pal-it-${active()}` : undefined}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onKeyDown}
              />
              <kbd>esc</kbd>
            </div>
            <div class="pal-list" id="pal-list" role="listbox" ref={listRef}>
              <Show
                when={items().length > 0}
                fallback={<div class="pal-empty">{t("shell.palette.empty", { query: query().trim() })}</div>}
              >
                <For each={groups()}>
                  {(g) => (
                    <div class="pal-grp" role="group" aria-label={g.label}>
                      <Show when={g.label}><div class="menu-h">{g.label}</div></Show>
                      <For each={g.items}>
                        {({ item, index }) => (
                          <div
                            id={`pal-it-${index}`}
                            data-idx={index}
                            class="pal-it"
                            classList={{ on: active() === index }}
                            role="option"
                            aria-selected={active() === index}
                            onMouseMove={() => {
                              if (active() !== index) setActive(index);
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => runItem(item)}
                          >
                            <span class="pal-ic"><Show when={item.icon}>{(IconComponent) => <Dynamic component={IconComponent()} />}</Show></span>
                            <span class="pal-txt">
                              <span class="pal-lbl">{item.label}</span>
                              <Show
                                when={item.description}
                                fallback={
                                  <Show when={item.sub}>
                                    <small>{item.sub}</small>
                                  </Show>
                                }
                              >
                                <Dynamic component={item.description} />
                              </Show>
                            </span>
                            <Show when={item.hint}>
                              <kbd>{item.hint}</kbd>
                            </Show>
                            <span class="pal-enter" aria-hidden="true">
                              <Icon name="return" size={13} />
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </div>
            <div class="pal-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd>
                {t("shell.palette.hint.navigate")}
              </span>
              <span>
                <kbd>{K("Enter")}</kbd>
                {t("shell.palette.hint.open")}
              </span>
              <span>
                <kbd>esc</kbd>
                {t("shell.palette.hint.close")}
              </span>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
