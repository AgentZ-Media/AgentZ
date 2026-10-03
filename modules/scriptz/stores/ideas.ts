import { createResource, createRoot, createSignal, type Resource } from "solid-js";
import { api } from "../lib/api";
import { ideasBus } from "../lib/ideasBus";
import type { Idea, ScriptSummary } from "../lib/types";

// Stable accessors stay empty until boot explicitly starts this shared cache.
const [resource, setResource] = createSignal<Resource<Idea[]>>();
const ideas = Object.defineProperty(
  () => resource()?.() ?? [],
  "latest",
  { get: () => resource()?.latest ?? [] },
) as (() => Idea[]) & { readonly latest: Idea[] };
let stopRuntime: (() => void) | undefined;

export function startIdeasStore(): () => void {
  if (stopRuntime) return stopRuntime;
  let active = true;
  const disposeRoot = createRoot((dispose) => {
    const [value] = createResource(
      () => ideasBus.version(),
      async () => {
        try {
          const result = await api.listIdeas();
          return active ? result : [];
        } catch (err) {
          if (active) console.warn("[scriptz] ideas load failed", err);
          return [] as Idea[];
        }
      },
      { initialValue: [] as Idea[] },
    );
    setResource(() => value);
    return dispose;
  });
  const stop = () => {
    if (!active) return;
    active = false;
    disposeRoot();
    setResource(undefined);
    stopRuntime = undefined;
  };
  stopRuntime = stop;
  return stop;
}

export const ideasStore = {
  ideas,
  refresh() {
    ideasBus.bump();
  },
  createIdea(input: { title: string; notes?: string; folderId?: string | null }): Promise<Idea> {
    return api.createIdea(input);
  },
  updateIdea(input: { id: string; title?: string; notes?: string }): Promise<Idea> {
    return api.updateIdea(input);
  },
  deleteIdea(id: string): Promise<void> {
    return api.deleteIdea(id);
  },
  moveIdea(ideaId: string, folderId: string | null): Promise<void> {
    return api.moveIdea(ideaId, folderId);
  },
  convertIdeaToScript(input: {
    ideaId: string;
    folderId?: string | null;
    notesAsAction?: boolean;
  }): Promise<{ idea: Idea; script: ScriptSummary }> {
    return api.convertIdeaToScript(input);
  },
};
