// ── Types ────────────────────────────────────────────────────────────────────
export type {
  ChatRole,
  ChatMessage,
  StreamChunk,
  StreamUsage,
  ParamType,
  ToolParameter,
  ToolDefinition,
  ToolCallParsed,
  ParseResult,
  ContextBudget,
  ContextConfig,
  ContextCheck,
  AgentStatus,
  AgentState,
  ChatCompletionProvider,
  AgentLoopConfig,
} from "./types.js";

// ── Tool registry ────────────────────────────────────────────────────────────
export { ToolRegistry } from "./tool-registry.js";
export type { ToolJsonSchema } from "./tool-registry.js";

// ── Parser ───────────────────────────────────────────────────────────────────
export { parseModelOutput } from "./parser.js";

// ── Prompt builder ───────────────────────────────────────────────────────────
export { buildAgentSystemPrompt } from "./prompt-builder.js";

// ── Context management ──────────────────────────────────────────────────────
export {
  estimateTokens,
  calculateBudget,
  checkContext,
  fitToContext,
  resolveContextConfig,
} from "./context-manager.js";

// ── Agent loop ──────────────────────────────────────────────────────────────
export { runAgentLoop } from "./agent-loop.js";
