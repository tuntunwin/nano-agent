import type {
  AgentLoopConfig,
  AgentState,
  AgentStatus,
  ChatMessage,
  ToolCallParsed,
} from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import { parseModelOutput } from "./parser.js";
import { buildAgentSystemPrompt } from "./prompt-builder.js";
import {
  calculateBudget,
  checkContext,
  fitToContext,
  resolveContextConfig,
} from "./context-manager.js";

// ── Agent loop ──────────────────────────────────────────────────────────────

/**
 * Run the observe/think/act agent loop.
 *
 * The loop calls the LLM provider, parses tool calls from text output,
 * executes tool handlers, feeds results back, and repeats until the model
 * produces a final answer or limits are hit.
 */
export async function runAgentLoop(
  userMessage: string,
  tools: ToolRegistry,
  config: AgentLoopConfig,
): Promise<AgentState> {
  const maxIterations = config.maxIterations ?? 5;
  const maxParseRetries = config.maxParseRetries ?? 2;
  const ctxConfig = resolveContextConfig(config.contextConfig);

  // Build system prompt
  const systemPrompt = buildAgentSystemPrompt(
    tools,
    config.modelParameterSize,
    config.systemPrompt,
  );

  // Initialize message history
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  // Calculate context budget
  const budget = calculateBudget(
    config.contextWindow,
    systemPrompt,
    userMessage,
    ctxConfig,
  );

  // State
  const state: AgentState = {
    status: "idle",
    iteration: 0,
    messages: [...messages],
    toolCalls: [],
    finalAnswer: null,
    error: null,
  };

  const setState = (status: AgentStatus, patch?: Partial<AgentState>) => {
    state.status = status;
    if (patch) Object.assign(state, patch);
    state.messages = [...messages];
    config.onStateChange?.(structuredClone(state));
  };

  // If no room for even one tool round-trip, answer directly
  if (
    budget.historyBudget < ctxConfig.minHistoryBudgetForToolUse &&
    tools.size > 0
  ) {
    // Remove tool instructions — just answer directly
    messages[0] = {
      role: "system",
      content:
        "You are a helpful assistant. Answer directly and concisely.",
    };
  }

  let parseRetries = 0;
  let lastToolCallKey = "";

  for (let iter = 0; iter < maxIterations; iter++) {
    // Check for cancellation
    if (config.signal?.aborted) {
      setState("error", { error: "Aborted" });
      return state;
    }

    state.iteration = iter + 1;

    // Pre-flight context check
    const ctxCheck = checkContext(messages, budget, ctxConfig);
    if (ctxCheck.shouldForceAnswer && iter > 0) {
      // Force a final answer
      messages.push({
        role: "user",
        content: "Please provide your final answer now based on what you know.",
      });
      setState("thinking");
      const answer = await collectCompletion(messages, config);
      setState("done", { finalAnswer: answer });
      return state;
    }

    // Compress context if needed
    const { messages: fitted, pairsDropped } = fitToContext(
      messages,
      budget,
      ctxConfig,
    );
    if (pairsDropped > 0) {
      messages.length = 0;
      messages.push(...fitted);
    }

    // Call LLM
    setState("thinking");
    const response = await collectCompletion(messages, config);

    // Parse response
    const parseResult = parseModelOutput(response, tools);

    switch (parseResult.kind) {
      case "final_answer": {
        messages.push({ role: "assistant", content: response });
        setState("done", { finalAnswer: parseResult.text });
        return state;
      }

      case "parse_error": {
        messages.push({ role: "assistant", content: response });

        if (parseRetries < maxParseRetries) {
          parseRetries++;
          messages.push({
            role: "user",
            content:
              `Your response could not be parsed. Error: ${parseResult.error}\n\n` +
              'Please respond with either a valid JSON tool call: {"name": "tool_name", "arguments": {...}} ' +
              "or a plain text answer.",
          });
          continue;
        }

        // Retries exhausted — treat raw output as final answer
        setState("done", { finalAnswer: response });
        return state;
      }

      case "tool_call": {
        parseRetries = 0; // reset on successful parse
        const { call } = parseResult;

        // Truncate hallucinated continuations after the tool call JSON
        const cleanedResponse = truncateAfterToolCall(response, call.rawMatch);

        // Duplicate detection
        const callKey = JSON.stringify({ name: call.name, args: call.arguments });
        if (callKey === lastToolCallKey) {
          messages.push({ role: "assistant", content: cleanedResponse });
          messages.push({
            role: "user",
            content:
              `You already called "${call.name}" with the same arguments. ` +
              "The result was the same as before. Please try a different approach or provide your final answer.",
          });
          lastToolCallKey = "";
          continue;
        }
        lastToolCallKey = callKey;

        // Validate arguments
        let validatedArgs: Record<string, string | number | boolean>;
        try {
          validatedArgs = tools.validateArgs(call.name, call.arguments);
        } catch (err) {
          messages.push({ role: "assistant", content: cleanedResponse });
          messages.push({
            role: "user",
            content: `[Tool Result: ${call.name}]\nERROR: ${err instanceof Error ? err.message : String(err)}`,
          });
          setState("observing");
          continue;
        }

        // Execute tool
        setState("acting");
        config.onToolCall?.(call);

        let toolResult: string;
        try {
          const tool = tools.get(call.name)!;
          toolResult = await tool.handler(validatedArgs);
        } catch (err) {
          toolResult = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
        }

        config.onToolResult?.(call.name, toolResult);

        // Record
        state.toolCalls.push({
          call,
          result: toolResult,
          timestamp: Date.now(),
        });

        // Append to conversation
        messages.push({ role: "assistant", content: cleanedResponse });
        messages.push({
          role: "user",
          content: `[Tool Result: ${call.name}]\n${toolResult}`,
        });

        setState("observing");
        continue;
      }
    }
  }

  // Max iterations exhausted — force final answer
  messages.push({
    role: "user",
    content: "You have reached the maximum number of tool calls. Please provide your final answer now.",
  });
  setState("thinking");
  const finalResponse = await collectCompletion(messages, config);
  messages.push({ role: "assistant", content: finalResponse });
  setState("done", { finalAnswer: finalResponse });
  return state;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncate model output to include only content up to and including
 * the first tool call match. Discards hallucinated continuations
 * that SLMs often generate after a valid tool call.
 */
function truncateAfterToolCall(rawOutput: string, rawMatch: string): string {
  const idx = rawOutput.indexOf(rawMatch);
  if (idx === -1) return rawOutput;
  return rawOutput.slice(0, idx + rawMatch.length).trimEnd();
}

/**
 * Call the LLM provider, collect the full streamed response, and
 * forward chunks to the onStream callback.
 */
async function collectCompletion(
  messages: ChatMessage[],
  config: AgentLoopConfig,
): Promise<string> {
  let fullContent = "";

  for await (const chunk of config.provider(messages)) {
    fullContent += chunk.content;
    config.onStream?.(chunk);
  }

  return fullContent;
}
