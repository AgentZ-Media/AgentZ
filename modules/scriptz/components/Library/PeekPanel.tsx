import { ErrorBoundary, Show, Suspense, createEffect, onCleanup, onMount } from "solid-js";
import { peekStore } from "../../stores/peek";
import { uiStore } from "../../stores/ui";
import { t } from "../../i18n";
import { ScriptScreen } from "../Script/ScriptScreen";
import { library } from "../Shell/libraryData";

/**
 * Side panel of the list pages: the script from `peekStore` in a full
 * editor right of the list. No backdrop - the list stays usable and a
 * click on another row swaps the panel's script. Esc closes, the expand
 * button opens the full script view. Closes with the page.
 */
export function PeekPanel() {
  onCleanup(() => peekStore.close());

  // A script that was trashed or deleted meanwhile closes the panel.
  createEffect(() => {
    const id = peekStore.scriptId();
    if (id && library.loaded() && library.scriptsReady() && !library.script(id)) peekStore.close();
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !peekStore.scriptId()) return;
      if (uiStore.anyDialogOpen() || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      peekStore.close();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={peekStore.scriptId()} keyed>
      {(scriptId) => (
        <aside class="peek" aria-label={t("script.peek.aria")}>
          <ErrorBoundary fallback={(error) => <div class="error-pane">{t("boot.error", { message: String(error) })}</div>}>
            <Suspense fallback={<div class="loading-pane">{t("boot.loadingScript")}</div>}>
              <ScriptScreen
                scriptId={scriptId}
                peek={{
                  onExpand: () => void peekStore.expand(scriptId, library.script(scriptId)?.title),
                  onClose: () => peekStore.close(),
                }}
              />
            </Suspense>
          </ErrorBoundary>
        </aside>
      )}
    </Show>
  );
}
