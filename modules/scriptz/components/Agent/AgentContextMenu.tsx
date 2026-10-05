import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon, type IconName } from "@agentz/kit/ui";
import { K } from "@agentz/kit/platform";
import { t, type TranslationKey } from "../../i18n";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { uiStore } from "../../stores/ui";
import { AgentAvatar } from "./AgentAvatar";
import { readSelection, type BlockSelection } from "./editorBridge";

const MENU_W = 248;
const SUB_W = 200;

interface MenuState {
  x: number;
  y: number;
  selection: BlockSelection;
}

type Action = { id: string; icon: IconName; label: TranslationKey; prompt?: TranslationKey; sub?: boolean };

const ACTIONS: Action[] = [
  { id: "talk", icon: "pen", label: "agent.ctx.talk", prompt: "agent.prompt.talk" },
  { id: "rewrite", icon: "refresh", label: "agent.ctx.rewrite", sub: true },
  { id: "variants", icon: "stack", label: "agent.ctx.variants", prompt: "agent.prompt.variants" },
  { id: "wording", icon: "check", label: "agent.ctx.wording", prompt: "agent.prompt.wording" },
  { id: "factcheck", icon: "search", label: "agent.ctx.factcheck", prompt: "agent.prompt.factcheck" },
];

const REWRITES: Array<{ id: string; label: TranslationKey; prompt?: TranslationKey }> = [
  { id: "harder", label: "agent.ctx.harder", prompt: "agent.prompt.harder" },
  { id: "shorter", label: "agent.ctx.shorter", prompt: "agent.prompt.shorter" },
  { id: "funnier", label: "agent.ctx.funnier", prompt: "agent.prompt.funnier" },
  { id: "custom", label: "agent.ctx.custom" },
];

/** Right-click on selected script text: agent actions next to "Copy". */
export function AgentContextMenu(props: { scriptId: string; canvas: () => HTMLElement | undefined }) {
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [subOpen, setSubOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;

  const close = () => { setMenu(null); setSubOpen(false); };

  onMount(() => {
    const onContext = (event: MouseEvent) => {
      const canvas = props.canvas();
      const target = event.target as Node | null;
      if (!canvas || !target || !canvas.contains(target)) return;
      if (!agentSettings.enabled() || !agentSettings.onboarded() || uiStore.anyDialogOpen()) return;
      const selection = readSelection(props.scriptId);
      if (!selection) return;
      event.preventDefault();
      const x = Math.min(event.clientX, window.innerWidth - MENU_W - 8);
      const y = Math.min(event.clientY, window.innerHeight - 260);
      setSubOpen(false);
      setMenu({ x, y, selection });
    };
    const onDown = (event: MouseEvent) => {
      if (menu() && menuRef && !menuRef.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu()) { event.preventDefault(); close(); }
    };
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    onCleanup(() => {
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
    });
  });

  const ask = (prompt: TranslationKey | undefined) => {
    const state = menu();
    close();
    if (!state) return;
    const quote = { text: state.selection.text, from: state.selection.from, to: state.selection.to };
    if (prompt) agentUi.ask({ scriptId: props.scriptId, text: t(prompt), quote, send: true });
    else agentUi.ask({ scriptId: props.scriptId, text: "", quote, send: false });
  };

  const copy = () => {
    const state = menu();
    close();
    if (state) void navigator.clipboard?.writeText(state.selection.text).catch(() => {});
  };

  const subLeft = () => {
    const state = menu();
    if (!state) return 0;
    return state.x + MENU_W + SUB_W + 8 > window.innerWidth ? -SUB_W - 4 : MENU_W + 4;
  };

  return (
    <Show when={menu()}>
      {(state) => (
        <Portal>
          <div
            ref={menuRef}
            class="ag-ctx"
            role="menu"
            style={{ left: `${state().x}px`, top: `${state().y}px` }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button type="button" class="ag-ctx-it" role="menuitem" onClick={copy}>
              <Icon name="doc" size={14} />
              {t("agent.ctx.copy")}
              <kbd>{K("Mod+C")}</kbd>
            </button>
            <div class="ag-ctx-sep" />
            <div class="ag-ctx-h">
              <AgentAvatar look={agentSettings.look()} size={16} />
              {agentSettings.displayName()}
            </div>
            <For each={ACTIONS}>
              {(action) => (
                // The submenu sits next to its button (never inside it), so
                // its entries are real, focusable buttons.
                <div class="ag-ctx-row" onMouseEnter={() => setSubOpen(!!action.sub)}>
                  <button
                    type="button"
                    class="ag-ctx-it"
                    classList={{ "is-on": action.sub && subOpen() }}
                    role="menuitem"
                    aria-haspopup={action.sub ? "menu" : undefined}
                    aria-expanded={action.sub ? subOpen() : undefined}
                    onClick={() => (action.sub ? setSubOpen(!subOpen()) : ask(action.prompt))}
                  >
                    <Icon name={action.icon} size={14} />
                    {t(action.label)}
                    <Show when={action.sub}>
                      <Icon name="right" size={12} class="ag-ctx-chev" />
                    </Show>
                  </button>
                  <Show when={action.sub && subOpen()}>
                    <div class="ag-ctx ag-ctx-sub" role="menu" style={{ left: `${subLeft()}px` }}>
                      <For each={REWRITES}>
                        {(item) => (
                          <button type="button" class="ag-ctx-it" role="menuitem" onClick={() => ask(item.prompt)}>
                            {t(item.label)}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Portal>
      )}
    </Show>
  );
}
