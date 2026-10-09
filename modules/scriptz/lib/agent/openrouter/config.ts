import type { AgentEffort } from "../types";

// The models the OpenRouter harness runs, hosted (AgentZ account) and with
// an own key alike: the chat model for everything, a lighter one for a fact
// check (one turn, then the chat model again). The hosted proxy decides on
// its own (OPENROUTER_MODEL and OPENROUTER_CHECK_MODEL in Convex, fallbacks
// in apps/site/convex/ai.ts); keep both sides on the same ids. Chosen with
// the agent benchmark (apps/bench). With an own key the chat model is the
// recommended choice in the list of all OpenRouter models.
export const OPENROUTER_MODEL = "openai/gpt-6.1-sol";
export const OPENROUTER_MODEL_LABEL = "GPT-6.1 Sol";
export const OPENROUTER_CHECK_MODEL = "openai/gpt-6-luna";
export const OPENROUTER_CHECK_MODEL_LABEL = "GPT-6 Luna";
export const OPENROUTER_EFFORTS: AgentEffort[] = ["minimal", "low", "medium", "high"];

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

/** Web search behind the harness' `web_search` tool (real source URLs). */
export const WEB_SEARCH_PLUGIN = { id: "web", engine: "exa", max_results: 5 } as const;
