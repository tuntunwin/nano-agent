import type {
  ChatMessage,
  ContextBudget,
  ContextCheck,
  ContextConfig,
} from "./types.js";

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxToolResultTokens: 500,
  completionReserve: 512,
  minHistoryBudgetForToolUse: 200,
};

export function resolveContextConfig(
  partial?: Partial<ContextConfig>,
): ContextConfig {
  return { ...DEFAULT_CONTEXT_CONFIG, ...partial };
}

// ── Token estimation ────────────────────────────────────────────────────────

/** Rough token estimate: ~4 characters per token for English text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens overhead per message (role, delimiters)
    total += 4 + estimateTokens(msg.content);
  }
  return total;
}

// ── Budget calculation ──────────────────────────────────────────────────────

/**
 * Calculate the token budget for an agent loop, determining how many
 * tokens are available for conversation history (tool calls + results).
 */
export function calculateBudget(
  contextWindow: number,
  systemPrompt: string,
  userMessage: string,
  config: ContextConfig,
): ContextBudget {
  const systemTokens = estimateTokens(systemPrompt) + 4; // +4 for message overhead
  const userMessageTokens = estimateTokens(userMessage) + 4;
  const historyBudget =
    contextWindow - systemTokens - userMessageTokens - config.completionReserve;

  return {
    contextWindow,
    systemTokens,
    userMessageTokens,
    completionReserve: config.completionReserve,
    historyBudget: Math.max(0, historyBudget),
  };
}

// ── Pre-flight check ────────────────────────────────────────────────────────

/**
 * Check whether we can fit another agent iteration within the context budget.
 * Call this before each LLM request.
 */
export function checkContext(
  messages: ChatMessage[],
  budget: ContextBudget,
  config: ContextConfig,
): ContextCheck {
  const tokensUsed = estimateMessagesTokens(messages);
  const tokensRemaining = budget.contextWindow - tokensUsed;

  // Count how many tool pairs could be dropped
  const droppable = countDroppablePairs(messages);

  // Need enough room for: completion reserve + minimum history for a round-trip
  // A round-trip ≈ assistant tool call (~80 tok) + tool result (~200 tok) = ~280 tok
  const ESTIMATED_ROUND_TRIP = 300;
  const fits = tokensRemaining >= config.completionReserve + ESTIMATED_ROUND_TRIP;
  const shouldForceAnswer =
    !fits ||
    tokensRemaining - config.completionReserve < config.minHistoryBudgetForToolUse;

  return {
    fits,
    tokensUsed,
    tokensRemaining,
    pairsDropped: 0,
    shouldForceAnswer,
  };
}

// ── Context compression ─────────────────────────────────────────────────────

/**
 * Fit messages into the context budget by truncating tool results and
 * dropping oldest tool call/result pairs.
 *
 * Returns a new array (does not mutate the input).
 */
export function fitToContext(
  messages: ChatMessage[],
  budget: ContextBudget,
  config: ContextConfig,
): { messages: ChatMessage[]; pairsDropped: number } {
  let result = [...messages];
  let pairsDropped = 0;

  // Step 1: Truncate oversized tool results
  result = truncateToolResults(result, config.maxToolResultTokens);

  // Step 2: Drop oldest tool call/result pairs if still over budget
  const maxTokens = budget.contextWindow - config.completionReserve;

  while (estimateMessagesTokens(result) > maxTokens) {
    const dropped = dropOldestPair(result);
    if (!dropped) break; // nothing left to drop
    result = dropped;
    pairsDropped++;
  }

  return { messages: result, pairsDropped };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncate tool result messages that exceed the token limit.
 * Tool results are user messages starting with "[Tool Result:".
 */
function truncateToolResults(
  messages: ChatMessage[],
  maxTokens: number,
): ChatMessage[] {
  const maxChars = maxTokens * 4; // reverse the estimation

  return messages.map((msg) => {
    if (msg.role !== "user" || !msg.content.startsWith("[Tool Result:")) {
      return msg;
    }

    if (msg.content.length <= maxChars) return msg;

    const truncated =
      msg.content.slice(0, maxChars) +
      `\n... [truncated, ${msg.content.length - maxChars} chars removed]`;

    return { ...msg, content: truncated };
  });
}

/**
 * Drop the oldest tool call/result pair from the messages.
 * A pair is: an assistant message followed by a user "[Tool Result:" message.
 *
 * Never drops:
 * - The system message (index 0)
 * - The original user message (index 1)
 * - The most recent assistant/tool pair
 *
 * Returns null if nothing can be dropped.
 */
function dropOldestPair(messages: ChatMessage[]): ChatMessage[] | null {
  // Find the first assistant message after the system+user prefix (index >= 2)
  // that is followed by a tool result — and is NOT the most recent pair.
  for (let i = 2; i < messages.length - 2; i++) {
    if (
      messages[i].role === "assistant" &&
      i + 1 < messages.length &&
      messages[i + 1].role === "user" &&
      messages[i + 1].content.startsWith("[Tool Result:")
    ) {
      // Drop this pair
      const result = [...messages];
      result.splice(i, 2);
      return result;
    }
  }

  return null;
}

/**
 * Count how many tool call/result pairs can be dropped
 * (all except the most recent pair).
 */
function countDroppablePairs(messages: ChatMessage[]): number {
  let count = 0;
  for (let i = 2; i < messages.length - 2; i++) {
    if (
      messages[i].role === "assistant" &&
      i + 1 < messages.length &&
      messages[i + 1].role === "user" &&
      messages[i + 1].content.startsWith("[Tool Result:")
    ) {
      count++;
    }
  }
  return count;
}
