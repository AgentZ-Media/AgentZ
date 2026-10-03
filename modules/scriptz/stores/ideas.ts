import { createResource } from "solid-js";
import { api } from "../lib/api";
import { ideasBus } from "../lib/ideasBus";
import type { Idea, ScriptSummary } from "../lib/types";

// Global resource slot for the ideas list. Subscribers (drawer,
// toggle counter, possibly quick capture) share the same cache.
const [ideas] = createResource(
  () => ideasBus.version(),
  async () => {
    try {
      return await api.listIdeas();
    } catch (err) {
      console.warn("[scriptz] ideas load failed", err);
      return [] as Idea[];
    }
  },
  { initialValue: [] },
);

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
