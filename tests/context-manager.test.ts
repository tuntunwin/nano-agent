import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  calculateBudget,
  checkContext,
  fitToContext,
  resolveContextConfig,
} from "../src/context-manager.js";
import type { ChatMessage, ContextConfig } from "../src/types.js";

const defaultConfig = resolveContextConfig();

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75, ceil = 3
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("calculateBudget", () => {
  it("calculates correct budget for 4K context", () => {
    const budget = calculateBudget(
      4096,
      "You are a helpful assistant.", // ~7 tokens + 4 overhead = ~11
      "What is the weather?", // ~5 tokens + 4 overhead = ~9
      defaultConfig,
    );

    expect(budget.contextWindow).toBe(4096);
    expect(budget.systemTokens).toBeGreaterThan(0);
    expect(budget.userMessageTokens).toBeGreaterThan(0);
    expect(budget.completionReserve).toBe(512);
    expect(budget.historyBudget).toBe(
      4096 - budget.systemTokens - budget.userMessageTokens - 512,
    );
    expect(budget.historyBudget).toBeGreaterThan(0);
  });

  it("clamps historyBudget to 0 when context is too small", () => {
    const budget = calculateBudget(
      100, // tiny context
      "A".repeat(200), // 50 tokens + 4 = 54
      "B".repeat(200), // 50 tokens + 4 = 54
      defaultConfig,
    );

    expect(budget.historyBudget).toBe(0);
  });
});

describe("checkContext", () => {
  it("allows tool call when plenty of room", () => {
    const budget = calculateBudget(32768, "System prompt", "User msg", defaultConfig);
    const messages: ChatMessage[] = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "User msg" },
    ];

    const check = checkContext(messages, budget, defaultConfig);
    expect(check.fits).toBe(true);
    expect(check.shouldForceAnswer).toBe(false);
    expect(check.tokensRemaining).toBeGreaterThan(1000);
  });

  it("forces answer when context is nearly full", () => {
    const budget = calculateBudget(200, "Sys", "Usr", defaultConfig);
    const messages: ChatMessage[] = [
      { role: "system", content: "Sys" },
      { role: "user", content: "Usr" },
      // Simulate many tool rounds
      { role: "assistant", content: "A".repeat(400) },
      { role: "user", content: "[Tool Result: t]\n" + "R".repeat(400) },
    ];

    const check = checkContext(messages, budget, defaultConfig);
    expect(check.shouldForceAnswer).toBe(true);
  });
});

describe("fitToContext", () => {
  it("truncates oversized tool results", () => {
    const config: ContextConfig = {
      maxToolResultTokens: 10, // 10 tokens = ~40 chars
      completionReserve: 512,
      minHistoryBudgetForToolUse: 200,
    };
    const budget = calculateBudget(32768, "Sys", "Usr", config);

    const messages: ChatMessage[] = [
      { role: "system", content: "Sys" },
      { role: "user", content: "Usr" },
      { role: "assistant", content: '{"name":"t","arguments":{}}' },
      { role: "user", content: "[Tool Result: t]\n" + "X".repeat(500) },
    ];

    const { messages: fitted } = fitToContext(messages, budget, config);
    // The tool result should be truncated
    expect(fitted[3].content.length).toBeLessThan(messages[3].content.length);
    expect(fitted[3].content).toContain("[truncated");
  });

  it("drops oldest tool pairs when over budget", () => {
    const config: ContextConfig = {
      maxToolResultTokens: 500,
      completionReserve: 50,
      minHistoryBudgetForToolUse: 200,
    };
    // Very small context window
    const budget = calculateBudget(150, "Sys", "Usr", config);

    const messages: ChatMessage[] = [
      { role: "system", content: "Sys" },
      { role: "user", content: "Usr" },
      // Pair 1 (oldest — should be dropped)
      { role: "assistant", content: "A".repeat(100) },
      { role: "user", content: "[Tool Result: t1]\n" + "R".repeat(100) },
      // Pair 2 (most recent — should be kept)
      { role: "assistant", content: "B".repeat(100) },
      { role: "user", content: "[Tool Result: t2]\n" + "R".repeat(100) },
    ];

    const { messages: fitted, pairsDropped } = fitToContext(
      messages,
      budget,
      config,
    );

    expect(pairsDropped).toBeGreaterThan(0);
    // Should still have system + user + at least the most recent pair
    expect(fitted.length).toBeLessThan(messages.length);
    expect(fitted[0].role).toBe("system");
    expect(fitted[1].role).toBe("user");
  });

  it("does not drop anything when within budget", () => {
    const budget = calculateBudget(32768, "Sys", "Usr", defaultConfig);
    const messages: ChatMessage[] = [
      { role: "system", content: "Sys" },
      { role: "user", content: "Usr" },
      { role: "assistant", content: "Short response" },
      { role: "user", content: "[Tool Result: t]\nShort result" },
    ];

    const { messages: fitted, pairsDropped } = fitToContext(
      messages,
      budget,
      defaultConfig,
    );
    expect(pairsDropped).toBe(0);
    expect(fitted).toEqual(messages);
  });
});
