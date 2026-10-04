// Provider-neutral agent types.
//
// Everything above the provider layer (chat store, tools, learning, UI)
// speaks only these types. A provider (today: Codex app-server, later e.g.
// OpenRouter or a local model) maps its own wire protocol onto them, so a
// new provider never touches the chat, the tools or the memory.

/** Reasoning effort. Providers expose the subset a model supports. */
export type AgentEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const EFFORT_ORDER: readonly AgentEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
export const DEFAULT_EFFORT: AgentEffort = "medium";

export function isAgentEffort(value: unknown): value is AgentEffort {
  return typeof value === "string" && (EFFORT_ORDER as readonly string[]).includes(value);
}

export interface AgentModel {
  id: string;
  label: string;
  description: string;
  efforts: AgentEffort[];
  defaultEffort: AgentEffort;
  /** The provider's recommended default model. */
  isDefault: boolean;
}

export type ProviderState =
  | { state: "ready"; account: string | null }
  | { state: "missing" }
  | { state: "logged-out" }
  | { state: "error"; message: string };

/** JSON schema subset used for tool parameters. */
export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  additionalProperties?: boolean;
};

export interface ToolResult {
  /** Text handed back to the model (usually JSON). */
  output: string;
  ok: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  run(args: unknown): Promise<ToolResult>;
}

/** Normalized stream of what happens during one turn. */
export type AgentEvent =
  | { type: "message-delta"; itemId: string; delta: string; commentary?: boolean }
  | { type: "message"; itemId: string; text: string; commentary?: boolean }
  | { type: "reasoning-delta"; itemId: string; delta: string }
  | { type: "reasoning"; itemId: string; text: string }
  | { type: "tool-start"; itemId: string; tool: string; args: unknown }
  | { type: "tool-end"; itemId: string; tool: string; args: unknown; ok: boolean }
  | { type: "web-search"; itemId: string; query: string; status: "running" | "done" }
  | { type: "blocked"; itemId: string; what: string }
  | { type: "error"; message: string };

export interface TurnOptions {
  model: string;
  effort: AgentEffort;
}

export interface TurnResult {
  status: "completed" | "interrupted" | "failed";
  error?: string;
}

/** `TurnResult.error` when the provider process died mid-turn; the UI shows
 *  a translated hint instead of the raw code. */
export const AGENT_PROCESS_EXITED = "agent-process-exited";

export interface AgentThread {
  /** Provider thread id, stored to resume the chat later. */
  readonly id: string;
  run(input: string, options: TurnOptions, onEvent: (event: AgentEvent) => void): Promise<TurnResult>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenThreadOptions {
  instructions: string;
  tools: AgentTool[];
  /** Resume an earlier provider thread; falls back to a new one. */
  resumeId?: string | null;
  /** Background work (learning): not listed in the provider's history. */
  ephemeral?: boolean;
}

export interface AgentProvider {
  readonly id: string;
  check(): Promise<ProviderState>;
  listModels(): Promise<AgentModel[]>;
  openThread(options: OpenThreadOptions): Promise<AgentThread>;
  dispose(): Promise<void>;
}
