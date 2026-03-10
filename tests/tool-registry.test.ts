import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/tool-registry.js";

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "test_tool",
      description: "A test tool",
      parameters: [],
      handler: () => "ok",
    });

    expect(reg.has("test_tool")).toBe(true);
    expect(reg.size).toBe(1);
    expect(reg.get("test_tool")?.description).toBe("A test tool");
  });

  it("rejects invalid tool names", () => {
    const reg = new ToolRegistry();
    expect(() =>
      reg.register({
        name: "has spaces",
        description: "Bad name",
        parameters: [],
        handler: () => "ok",
      }),
    ).toThrow("Invalid tool name");
  });

  it("unregisters tools", () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "temp",
      description: "Temporary",
      parameters: [],
      handler: () => "ok",
    });
    reg.unregister("temp");
    expect(reg.has("temp")).toBe(false);
    expect(reg.size).toBe(0);
  });

  it("generates correct JSON schema", () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "get_weather",
      description: "Get weather for a city",
      parameters: [
        { name: "city", type: "string", description: "City name", required: true },
        { name: "units", type: "string", description: "Temperature units", required: false, enum: ["celsius", "fahrenheit"] },
      ],
      handler: () => "ok",
    });

    const schemas = reg.toJsonSchemaAll();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe("get_weather");
    expect(schemas[0].parameters.properties.city).toEqual({
      type: "string",
      description: "City name",
    });
    expect(schemas[0].parameters.properties.units).toEqual({
      type: "string",
      description: "Temperature units",
      enum: ["celsius", "fahrenheit"],
    });
    expect(schemas[0].parameters.required).toEqual(["city"]);
  });

  describe("validateArgs", () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "test",
      description: "Test",
      parameters: [
        { name: "name", type: "string", description: "Name", required: true },
        { name: "count", type: "number", description: "Count", required: true },
        { name: "active", type: "boolean", description: "Active", required: false },
        { name: "mode", type: "string", description: "Mode", required: false, enum: ["fast", "slow"] },
      ],
      handler: () => "ok",
    });

    it("validates and coerces correct args", () => {
      const result = reg.validateArgs("test", {
        name: "hello",
        count: "42",
        active: "true",
      });
      expect(result).toEqual({ name: "hello", count: 42, active: true });
    });

    it("throws on missing required param", () => {
      expect(() => reg.validateArgs("test", { count: 1 })).toThrow(
        "Missing required parameter",
      );
    });

    it("throws on invalid number", () => {
      expect(() =>
        reg.validateArgs("test", { name: "x", count: "not-a-number" }),
      ).toThrow("must be a number");
    });

    it("throws on invalid enum value", () => {
      expect(() =>
        reg.validateArgs("test", { name: "x", count: 1, mode: "turbo" }),
      ).toThrow("must be one of");
    });

    it("throws on unknown tool", () => {
      expect(() => reg.validateArgs("nonexistent", {})).toThrow(
        "Unknown tool",
      );
    });

    it("skips optional params when absent", () => {
      const result = reg.validateArgs("test", { name: "x", count: 5 });
      expect(result).toEqual({ name: "x", count: 5 });
      expect(result.active).toBeUndefined();
    });
  });
});
