import { describe, it, expect } from "vitest";
import { parseModelOutput } from "../src/parser.js";
import { ToolRegistry } from "../src/tool-registry.js";

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register({
    name: "get_weather",
    description: "Get weather",
    parameters: [
      { name: "city", type: "string", description: "City", required: true },
      { name: "units", type: "string", description: "Units", required: false, enum: ["celsius", "fahrenheit"] },
    ],
    handler: () => "Sunny",
  });
  reg.register({
    name: "calculate",
    description: "Calculate",
    parameters: [
      { name: "expression", type: "string", description: "Math expression", required: true },
    ],
    handler: () => "42",
  });
  return reg;
}

describe("parseModelOutput", () => {
  const registry = makeRegistry();

  // ── Final answer ────────────────────────────────────────────────────

  it("returns final_answer for plain text", () => {
    const result = parseModelOutput("The weather is nice today.", registry);
    expect(result.kind).toBe("final_answer");
    if (result.kind === "final_answer") {
      expect(result.text).toBe("The weather is nice today.");
    }
  });

  it("returns final_answer for empty string", () => {
    const result = parseModelOutput("", registry);
    expect(result.kind).toBe("final_answer");
  });

  // ── JSON in markdown fence ──────────────────────────────────────────

  it("parses JSON in ```json fence", () => {
    const output = `I'll check the weather.

\`\`\`json
{"name": "get_weather", "arguments": {"city": "San Francisco"}}
\`\`\``;
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("tool_call");
    if (result.kind === "tool_call") {
      expect(result.call.name).toBe("get_weather");
      expect(result.call.arguments).toEqual({ city: "San Francisco" });
    }
  });

  it("parses JSON in ```tool_call fence", () => {
    const output = `\`\`\`tool_call
{"name": "calculate", "arguments": {"expression": "2 + 2"}}
\`\`\``;
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("tool_call");
    if (result.kind === "tool_call") {
      expect(result.call.name).toBe("calculate");
    }
  });

  it("parses JSON in bare ``` fence", () => {
    const output = `\`\`\`
{"name": "get_weather", "arguments": {"city": "Tokyo"}}
\`\`\``;
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("tool_call");
    if (result.kind === "tool_call") {
      expect(result.call.name).toBe("get_weather");
      expect(result.call.arguments).toEqual({ city: "Tokyo" });
    }
  });

  // ── Bare JSON ──────────────────────────────────────────────────────

  it("parses bare JSON object", () => {
    const output = '{"name": "get_weather", "arguments": {"city": "London"}}';
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("tool_call");
    if (result.kind === "tool_call") {
      expect(result.call.name).toBe("get_weather");
      expect(result.call.arguments).toEqual({ city: "London" });
    }
  });

  it("parses JSON embedded in surrounding text", () => {
    const output = 'Let me check that for you. {"name": "get_weather", "arguments": {"city": "Paris"}} I will get the weather.';
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("tool_call");
    if (result.kind === "tool_call") {
      expect(result.call.name).toBe("get_weather");
      expect(result.call.arguments).toEqual({ city: "Paris" });
    }
  });

  it("handles JSON with no arguments field", () => {
    const output = '{"name": "calculate"}';
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("tool_call");
    if (result.kind === "tool_call") {
      expect(result.call.arguments).toEqual({});
    }
  });

  // ── Unknown tool ──────────────────────────────────────────────────

  it("returns parse_error for unknown tool name", () => {
    const output = '{"name": "unknown_tool", "arguments": {}}';
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("parse_error");
    if (result.kind === "parse_error") {
      expect(result.error).toContain("Unknown tool");
      expect(result.error).toContain("get_weather");
    }
  });

  // ── Malformed JSON ────────────────────────────────────────────────

  it("returns parse_error for broken JSON with name field", () => {
    const output = '{"name": "get_weather", "arguments": {"city": "Berl';
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("parse_error");
    if (result.kind === "parse_error") {
      expect(result.error).toContain("could not parse");
    }
  });

  it("treats JSON without name field as final answer", () => {
    const output = 'Here is the data: {"temperature": 72, "humidity": 45}';
    const result = parseModelOutput(output, registry);
    // The JSON object has no "name" field, so it's not a tool call
    expect(result.kind).toBe("final_answer");
  });

  // ── Mixed content ─────────────────────────────────────────────────

  it("extracts tool call from thinking + JSON", () => {
    const output = `Let me think about this...
I need to check the weather for Berlin.

{"name": "get_weather", "arguments": {"city": "Berlin", "units": "celsius"}}`;
    const result = parseModelOutput(output, registry);
    expect(result.kind).toBe("tool_call");
    if (result.kind === "tool_call") {
      expect(result.call.name).toBe("get_weather");
      expect(result.call.arguments).toEqual({ city: "Berlin", units: "celsius" });
    }
  });
});
