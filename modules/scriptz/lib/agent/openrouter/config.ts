import type { AgentEffort } from "../types";

// The model the OpenRouter harness runs by default. The hosted proxy decides
// on its own (OPENROUTER_MODEL in Convex, fallback in apps/site/convex/ai.ts);
// keep both on the same id. With an own key it is the recommended choice in
// the list of all OpenRouter models.
export const OPENROUTER_MODEL = "google/gemini-3.8-flash";
export const OPENROUTER_MODEL_LABEL = "Gemini 3.8 Flash";
export const OPENROUTER_EFFORTS: AgentEffort[] = ["minimal", "low", "medium", "high"];

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

/** Web search behind the harness' `web_search` tool (real source URLs). */
export const WEB_SEARCH_PLUGIN = { id: "web", engine: "exa", max_results: 5 } as const;
