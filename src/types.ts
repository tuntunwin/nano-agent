// ── Chat primitives ─────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface StreamChunk {
  /** Text delta (empty string when this chunk only carries usage). */
  content: string;
  /** Present only on the very last chunk (optional). */
  usage?: StreamUsage;
}

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ── Tool definition ─────────────────────────────────────────────────────────

export type ParamType = "string" | "number" | "boolean";

export interface ToolParameter {
  name: string;
  type: ParamType;
  description: string;
  required: boolean;
  /** Rendered as "one of: a, b, c" constraint. */
  enum?: string[];
}

export interface ToolDefinition {
  /** Unique tool name — alphanumeric + underscores, no spaces. */
  name: string;
  /** One-line description shown to the model. */
  description: string;
  /** Parameter definitions. */
  parameters: ToolParameter[];
  /**
   * The handler function. Receives parsed arguments.
   * Returns a string result (or throws on error).
   */
  handler: (
    args: Record<string, string | number | boolean>,
  ) => Promise<string> | string;
}

// ── Parser output ───────────────────────────────────────────────────────────

export interface ToolCallParsed {
  name: string;
  arguments: Record<string, unknown>;
  /** The raw text span that was matched, for debugging. */
  rawMatch: string;
}

export type ParseResult =
  | { kind: "tool_call"; call: ToolCallParsed }
  | { kind: "final_answer"; text: string }
  | { kind: "parse_error"; rawOutput: string; error: string };

// ── Context management ──────────────────────────────────────────────────────

export interface ContextBudget {
  contextWindow: number;
  systemTokens: number;
  userMessageTokens: number;
  completionReserve: number;
  /** Tokens available for tool call/result history. */
  historyBudget: number;
}

export interface ContextConfig {
  /** Max tokens for a single tool result before truncation. Default: 500 */
  maxToolResultTokens: number;
  /** Tokens reserved for the model's completion. Default: 512 */
  completionReserve: number;
  /** Minimum history budget to allow a tool call. Default: 200 */
  minHistoryBudgetForToolUse: number;
}

export interface ContextCheck {
  fits: boolean;
  tokensUsed: number;
  tokensRemaining: number;
  pairsDropped: number;
  shouldForceAnswer: boolean;
}

// ── Agent loop ──────────────────────────────────────────────────────────────

export type AgentStatus =
  | "idle"
  | "thinking"
  | "acting"
  | "observing"
  | "done"
  | "error";

export interface AgentState {
  status: AgentStatus;
  iteration: number;
  messages: ChatMessage[];
  toolCalls: Array<{
    call: ToolCallParsed;
    result: string;
    timestamp: number;
  }>;
  finalAnswer: string | null;
  error: string | null;
}

/**
 * Engine-agnostic LLM interface.
 * The consumer passes in a function that takes messages and yields text chunks.
 */
export type ChatCompletionProvider = (
  messages: ChatMessage[],
) => AsyncGenerator<StreamChunk, void, unknown>;

export interface AgentLoopConfig {
  /** Engine-agnostic LLM streaming interface. */
  provider: ChatCompletionProvider;
  /** Context window size in tokens (from model config). */
  contextWindow: number;
  /** Maximum tool-call iterations. Default: 5 */
  maxIterations?: number;
  /** Maximum consecutive parse retries. Default: 2 */
  maxParseRetries?: number;
  /** Model size in billions, for prompt tuning. */
  modelParameterSize?: number;
  /** Custom system prompt (e.g. few-shot examples for SLMs). Appended after the agent's internal instructions. */
  systemPrompt?: string;
  /** Context management configuration. */
  contextConfig?: Partial<ContextConfig>;
  /** Called on each state transition. */
  onStateChange?: (state: AgentState) => void;
  /** Called for each streaming text chunk. */
  onStream?: (chunk: StreamChunk) => void;
  /** Called when a tool is about to be executed. */
  onToolCall?: (call: ToolCallParsed) => void;
  /** Called when a tool returns a result. */
  onToolResult?: (name: string, result: string) => void;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}
