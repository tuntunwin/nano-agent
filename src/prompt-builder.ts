import type { ToolRegistry } from "./tool-registry.js";

/**
 * Build the full system prompt for the agent, including tool catalog
 * and format instructions.
 */
export function buildAgentSystemPrompt(
  tools: ToolRegistry,
  modelParameterSize?: number,
): string {
  const sections: string[] = [];

  // Section 1: Role and behavior
  sections.push(
    "You are a helpful assistant with access to tools. " +
      "Answer the user directly when you can. Use a tool only when needed to answer the question. " +
      "After receiving a tool result, give a short plain-language answer.",
  );

  // Section 2: Tool catalog
  if (tools.size > 0) {
    sections.push(buildToolCatalog(tools));
  }

  // Section 3: Format instructions
  sections.push(buildFormatInstructions(tools));

  // Section 4: Model-size guardrails
  if (modelParameterSize !== undefined && modelParameterSize <= 1) {
    sections.push(SMALL_MODEL_ADDENDUM);
  }

  return sections.join("\n\n");
}

function buildToolCatalog(tools: ToolRegistry): string {
  const schemas = tools.toJsonSchemaAll();
  const lines = ["Available tools:"];

  for (const schema of schemas) {
    lines.push("");
    lines.push(JSON.stringify(schema, null, 2));
  }

  return lines.join("\n");
}

function buildFormatInstructions(tools: ToolRegistry): string {
  if (tools.size === 0) {
    return "Respond directly in plain text.";
  }

  return `When you need to use a tool, respond with ONLY a JSON object in this exact format:

{"name": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}

Rules:
- Output ONLY the JSON object when calling a tool, nothing else.
- Use exactly one tool call per response.
- Use the exact tool names listed above.
- When you have enough information to answer, respond with plain text (no JSON).`;
}

const SMALL_MODEL_ADDENDUM = `Important — you are a small model:
- You MUST use the exact tool names listed above. Do NOT invent tool names.
- If unsure which tool to use, answer directly without a tool.
- Keep your answer under 3 sentences.
- Do NOT repeat previous answers.`;
