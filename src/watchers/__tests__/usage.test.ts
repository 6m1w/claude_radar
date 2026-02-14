import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  resolveModelPricing,
  calculateCostUSD,
  parseSessionUsage,
  getProjectUsage,
  FALLBACK_PRICING,
} from "../usage.js";
import type { TokenAccumulator } from "../usage.js";

// ─── Model pricing resolution ───────────────────────────────

describe("resolveModelPricing", () => {
  it("should resolve exact model IDs", () => {
    expect(resolveModelPricing("claude-opus-4-6")).toEqual({ input: 5, output: 25 });
    expect(resolveModelPricing("claude-sonnet-4-5")).toEqual({ input: 3, output: 15 });
    expect(resolveModelPricing("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
  });

  it("should resolve model IDs with date suffixes via prefix match", () => {
    expect(resolveModelPricing("claude-sonnet-4-5-20250929")).toEqual({ input: 3, output: 15 });
    expect(resolveModelPricing("claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5 });
    expect(resolveModelPricing("claude-opus-4-6-20260101")).toEqual({ input: 5, output: 25 });
  });

  it("should resolve older opus models with higher pricing", () => {
    expect(resolveModelPricing("claude-opus-4-1")).toEqual({ input: 15, output: 75 });
    expect(resolveModelPricing("claude-opus-4")).toEqual({ input: 15, output: 75 });
  });

  it("should return fallback for unknown models", () => {
    expect(resolveModelPricing("unknown-model")).toEqual(FALLBACK_PRICING);
    expect(resolveModelPricing("")).toEqual(FALLBACK_PRICING);
    expect(resolveModelPricing("<synthetic>")).toEqual(FALLBACK_PRICING);
  });
});

// ─── Cost calculation ───────────────────────────────────────

describe("calculateCostUSD", () => {
  it("should calculate cost for simple input/output", () => {
    const tokens: TokenAccumulator = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0,
    };
    // Opus 4.6: $5/MTok input + $25/MTok output = $30
    const cost = calculateCostUSD(tokens, { input: 5, output: 25 });
    expect(cost).toBeCloseTo(30, 2);
  });

  it("should apply cache pricing multipliers correctly", () => {
    const tokens: TokenAccumulator = {
      inputTokens: 0,
      outputTokens: 0,
      cacheWrite5mTokens: 1_000_000,
      cacheWrite1hTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    };
    // Opus 4.6 (input=$5):
    //   5m write: $5 × 1.25 = $6.25
    //   1h write: $5 × 2.0  = $10.00
    //   read:     $5 × 0.1  = $0.50
    //   total = $16.75
    const cost = calculateCostUSD(tokens, { input: 5, output: 25 });
    expect(cost).toBeCloseTo(16.75, 2);
  });

  it("should handle typical Claude Code session (heavy cache read)", () => {
    const tokens: TokenAccumulator = {
      inputTokens: 117,
      outputTokens: 3_520,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 151_877,
      cacheReadTokens: 5_909_643,
    };
    // Opus 4.6:
    //   input:    117 × $5 / 1M     = $0.000585
    //   output:   3520 × $25 / 1M   = $0.088
    //   1h write: 151877 × $10 / 1M = $1.51877
    //   read:     5909643 × $0.5 / 1M = $2.954822
    //   total ≈ $4.56
    const cost = calculateCostUSD(tokens, { input: 5, output: 25 });
    expect(cost).toBeGreaterThan(4);
    expect(cost).toBeLessThan(5);
  });
});

// ─── JSONL parsing ──────────────────────────────────────────

const TMP_DIR = join(import.meta.dirname ?? __dirname, "__tmp_usage_test__");

function makeAssistantLine(
  model: string,
  input: number,
  output: number,
  cacheCreate: number,
  cacheRead: number,
  cache5m = 0,
  cache1h = cacheCreate,
): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: cacheRead,
        cache_creation: {
          ephemeral_5m_input_tokens: cache5m,
          ephemeral_1h_input_tokens: cache1h,
        },
      },
    },
  });
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("parseSessionUsage", () => {
  it("should parse a JSONL file with assistant messages", () => {
    const jsonlPath = join(TMP_DIR, "sess-1.jsonl");
    const lines = [
      JSON.stringify({ type: "user", content: "hello" }),
      makeAssistantLine("claude-opus-4-6", 100, 500, 5000, 20000),
      JSON.stringify({ type: "progress", data: {} }),
      makeAssistantLine("claude-opus-4-6", 50, 300, 3000, 30000),
    ].join("\n");
    writeFileSync(jsonlPath, lines);

    const stats = parseSessionUsage(jsonlPath, "sess-1");
    expect(stats).not.toBeNull();
    expect(stats!.sessionId).toBe("sess-1");
    expect(stats!.model).toBe("claude-opus-4-6");
    expect(stats!.messageCount).toBe(2);
    expect(stats!.inputTokens).toBe(150);
    expect(stats!.outputTokens).toBe(800);
    expect(stats!.cacheWrite1hTokens).toBe(8000);
    expect(stats!.cacheReadTokens).toBe(50000);
    expect(stats!.costUSD).toBeGreaterThan(0);
  });

  it("should pick primary model by frequency", () => {
    const jsonlPath = join(TMP_DIR, "multi-model.jsonl");
    const lines = [
      makeAssistantLine("claude-opus-4-6", 100, 500, 0, 0),
      makeAssistantLine("claude-haiku-4-5", 100, 500, 0, 0),
      makeAssistantLine("claude-haiku-4-5", 100, 500, 0, 0),
    ].join("\n");
    writeFileSync(jsonlPath, lines);

    const stats = parseSessionUsage(jsonlPath, "multi");
    expect(stats!.model).toBe("claude-haiku-4-5");
  });

  it("should return null for empty or non-existent files", () => {
    expect(parseSessionUsage("/nonexistent/path.jsonl", "x")).toBeNull();

    const emptyPath = join(TMP_DIR, "empty.jsonl");
    writeFileSync(emptyPath, "");
    expect(parseSessionUsage(emptyPath, "x")).toBeNull();
  });

  it("should handle JSONL with no assistant messages", () => {
    const jsonlPath = join(TMP_DIR, "no-assistant.jsonl");
    writeFileSync(jsonlPath, JSON.stringify({ type: "user", content: "hello" }));
    expect(parseSessionUsage(jsonlPath, "x")).toBeNull();
  });

  it("should fallback cache writes to 1h when breakdown is missing", () => {
    const jsonlPath = join(TMP_DIR, "no-breakdown.jsonl");
    // Simulate older JSONL without cache_creation breakdown
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-6",
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_creation_input_tokens: 5000,
          cache_read_input_tokens: 10000,
          // no cache_creation sub-object
        },
      },
    });
    writeFileSync(jsonlPath, line);

    const stats = parseSessionUsage(jsonlPath, "old-format");
    expect(stats!.cacheWrite1hTokens).toBe(5000);
    expect(stats!.cacheWrite5mTokens).toBe(0);
  });
});

describe("getProjectUsage", () => {
  it("should aggregate usage across multiple session JSONL files", () => {
    const projectDir = join(TMP_DIR, "project");
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(projectDir, "sess-1.jsonl"),
      makeAssistantLine("claude-opus-4-6", 100, 500, 5000, 20000),
    );
    writeFileSync(
      join(projectDir, "sess-2.jsonl"),
      makeAssistantLine("claude-opus-4-6", 200, 1000, 3000, 30000),
    );
    // Non-JSONL files should be ignored
    writeFileSync(join(projectDir, "sessions-index.json"), "{}");

    const usage = getProjectUsage(projectDir);
    expect(usage).not.toBeNull();
    expect(usage!.sessions).toHaveLength(2);
    expect(usage!.totalInputTokens).toBe(300);
    expect(usage!.totalOutputTokens).toBe(1500);
    expect(usage!.totalMessages).toBe(2);
    expect(usage!.totalCostUSD).toBeGreaterThan(0);
  });

  it("should return null for non-existent directory", () => {
    expect(getProjectUsage("/nonexistent/dir")).toBeNull();
  });
});
