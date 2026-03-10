import type { ParseResult, ToolCallParsed } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";

/**
 * Parse model text output to extract a tool call or determine it's a final answer.
 *
 * Multi-strategy extraction:
 * 1. JSON inside markdown fences (```json ... ``` or ```tool_call ... ```)
 * 2. Bare JSON object with "name" field in the text
 * 3. No JSON found → final answer
 * 4. JSON-like content that fails to parse → parse error
 */
export function parseModelOutput(
  rawOutput: string,
  registry: ToolRegistry,
): ParseResult {
  const trimmed = rawOutput.trim();

  // Strategy 1: JSON in markdown fence
  const fenceResult = extractFromFence(trimmed);
  if (fenceResult) {
    return validateToolCall(fenceResult.json, fenceResult.raw, registry);
  }

  // Strategy 2: Bare JSON object with "name" key
  const bareResult = extractBareJson(trimmed);
  if (bareResult) {
    return validateToolCall(bareResult.json, bareResult.raw, registry);
  }

  // Strategy 3: Check if there's a broken JSON attempt (has { but failed to parse)
  if (looksLikeToolCallAttempt(trimmed)) {
    return {
      kind: "parse_error",
      rawOutput,
      error:
        "Found what looks like a tool call but could not parse it as valid JSON. " +
        'Please respond with a valid JSON object: {"name": "tool_name", "arguments": {...}}',
    };
  }

  // Strategy 4: Final answer — no tool call detected
  return { kind: "final_answer", text: trimmed };
}

// ── Extraction strategies ───────────────────────────────────────────────────

interface ExtractResult {
  json: unknown;
  raw: string;
}

/**
 * Extract JSON from markdown fenced code blocks.
 * Matches: ```json ... ```, ```tool_call ... ```, or bare ``` ... ```
 */
function extractFromFence(text: string): ExtractResult | null {
  const fenceRegex = /```(?:json|tool_call)?\s*\n?([\s\S]*?)```/;
  const match = text.match(fenceRegex);
  if (!match) return null;

  const raw = match[1].trim();
  try {
    const json = JSON.parse(raw);
    if (isToolCallShape(json)) {
      return { json, raw: match[0] };
    }
  } catch {
    // Fall through — content in fence wasn't valid JSON
  }
  return null;
}

/**
 * Extract a bare JSON object from the text that looks like a tool call.
 * Finds the first { that leads to a parseable object with a "name" field.
 */
function extractBareJson(text: string): ExtractResult | null {
  // Find all positions where a { starts
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1);
        try {
          const json = JSON.parse(candidate);
          if (isToolCallShape(json)) {
            return { json, raw: candidate };
          }
        } catch {
          // Not valid JSON, continue searching
        }
        start = -1;
      }
    }
  }

  return null;
}

/**
 * Check if the text looks like a failed attempt at a tool call.
 * Used to differentiate "model tried to call a tool but malformed it"
 * from "model is just responding normally."
 */
function looksLikeToolCallAttempt(text: string): boolean {
  // Must contain both { and "name" to be considered an attempt
  return text.includes("{") && /["']name["']\s*:/.test(text);
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Check if a parsed JSON object has the shape of a tool call.
 */
function isToolCallShape(obj: unknown): obj is { name: string } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "name" in obj &&
    typeof (obj as Record<string, unknown>).name === "string"
  );
}

/**
 * Validate a parsed JSON tool call against the registry.
 */
function validateToolCall(
  json: unknown,
  rawMatch: string,
  registry: ToolRegistry,
): ParseResult {
  const obj = json as Record<string, unknown>;
  const name = obj.name as string;

  if (!registry.has(name)) {
    return {
      kind: "parse_error",
      rawOutput: rawMatch,
      error: `Unknown tool "${name}". Available tools: ${registry.getAll().map((t) => t.name).join(", ")}`,
    };
  }

  const args =
    typeof obj.arguments === "object" && obj.arguments !== null
      ? (obj.arguments as Record<string, unknown>)
      : {};

  const call: ToolCallParsed = {
    name,
    arguments: args,
    rawMatch,
  };

  return { kind: "tool_call", call };
}
