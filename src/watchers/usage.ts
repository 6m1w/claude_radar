// Usage & cost tracking — parses Claude Code session JSONL files for token usage.
// On-demand only (not part of the 3s polling loop) to avoid I/O overhead.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionUsageStats, ProjectUsageStats, ActivityEvent } from "../types.js";

// ─── Pricing table ──────────────────────────────────────────

// Base rates in $/MTok: [input, output]
// Cache rates derived via multipliers (consistent across all models):
//   cache write 5m  = input × 1.25
//   cache write 1h  = input × 2.0
//   cache read      = input × 0.1
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2.0;
const CACHE_READ_MULT = 0.1;

interface ModelPricing {
  input: number;  // $/MTok
  output: number; // $/MTok
}

// Model ID prefix → pricing. Sorted most-specific-first for prefix matching.
const MODEL_PRICING: [string, ModelPricing][] = [
  ["claude-opus-4-6",   { input: 5,    output: 25 }],
  ["claude-opus-4-5",   { input: 5,    output: 25 }],
  ["claude-opus-4-1",   { input: 15,   output: 75 }],
  ["claude-opus-4",     { input: 15,   output: 75 }],
  ["claude-opus-3",     { input: 15,   output: 75 }],
  ["claude-sonnet-4-5", { input: 3,    output: 15 }],
  ["claude-sonnet-4",   { input: 3,    output: 15 }],
  ["claude-sonnet-3",   { input: 3,    output: 15 }],
  ["claude-haiku-4-5",  { input: 1,    output: 5  }],
  ["claude-haiku-3-5",  { input: 0.80, output: 4  }],
  ["claude-haiku-3",    { input: 0.25, output: 1.25 }],
];

// Default fallback: Sonnet-tier pricing (middle ground)
const FALLBACK_PRICING: ModelPricing = { input: 3, output: 15 };

function resolveModelPricing(modelId: string): ModelPricing {
  if (!modelId) return FALLBACK_PRICING;
  for (const [prefix, pricing] of MODEL_PRICING) {
    if (modelId.startsWith(prefix)) return pricing;
  }
  return FALLBACK_PRICING;
}

// ─── Cost calculation ───────────────────────────────────────

interface TokenAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
}

function calculateCostUSD(tokens: TokenAccumulator, pricing: ModelPricing): number {
  const MTOK = 1_000_000;
  return (
    (tokens.inputTokens * pricing.input) / MTOK +
    (tokens.outputTokens * pricing.output) / MTOK +
    (tokens.cacheWrite5mTokens * pricing.input * CACHE_WRITE_5M_MULT) / MTOK +
    (tokens.cacheWrite1hTokens * pricing.input * CACHE_WRITE_1H_MULT) / MTOK +
    (tokens.cacheReadTokens * pricing.input * CACHE_READ_MULT) / MTOK
  );
}

// ─── JSONL parsing ──────────────────────────────────────────

// Minimal shape we extract from each JSONL assistant message
interface JSONLAssistantUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}

function extractUsage(line: string): JSONLAssistantUsage | null {
  // Fast pre-check to avoid JSON.parse on non-assistant lines
  if (!line.includes('"assistant"')) return null;

  try {
    const obj = JSON.parse(line);
    if (obj.type !== "assistant") return null;

    const msg = obj.message;
    if (!msg?.usage) return null;

    const u = msg.usage;
    const cc = u.cache_creation ?? {};

    return {
      model: msg.model ?? "",
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      ephemeral_5m_input_tokens: cc.ephemeral_5m_input_tokens ?? 0,
      ephemeral_1h_input_tokens: cc.ephemeral_1h_input_tokens ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a single session JSONL file for usage stats.
 */
export function parseSessionUsage(jsonlPath: string, sessionId: string): SessionUsageStats | null {
  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  const tokens: TokenAccumulator = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
  };

  const modelCounts = new Map<string, number>();
  let messageCount = 0;

  for (const line of lines) {
    if (!line) continue;
    const u = extractUsage(line);
    if (!u) continue;

    messageCount++;
    tokens.inputTokens += u.input_tokens;
    tokens.outputTokens += u.output_tokens;
    tokens.cacheReadTokens += u.cache_read_input_tokens;

    // Use the 5m/1h breakdown if available, otherwise assume all cache writes are 1h
    if (u.ephemeral_5m_input_tokens || u.ephemeral_1h_input_tokens) {
      tokens.cacheWrite5mTokens += u.ephemeral_5m_input_tokens;
      tokens.cacheWrite1hTokens += u.ephemeral_1h_input_tokens;
    } else {
      tokens.cacheWrite1hTokens += u.cache_creation_input_tokens;
    }

    if (u.model) {
      modelCounts.set(u.model, (modelCounts.get(u.model) ?? 0) + 1);
    }
  }

  if (messageCount === 0) return null;

  // Primary model = most frequent
  let primaryModel = "";
  let maxCount = 0;
  for (const [model, count] of modelCounts) {
    if (count > maxCount) {
      primaryModel = model;
      maxCount = count;
    }
  }

  const pricing = resolveModelPricing(primaryModel);

  return {
    sessionId,
    model: primaryModel,
    messageCount,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheWrite5mTokens: tokens.cacheWrite5mTokens,
    cacheWrite1hTokens: tokens.cacheWrite1hTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    costUSD: calculateCostUSD(tokens, pricing),
  };
}

/**
 * Get aggregated usage stats for a project by scanning its JSONL directory.
 * On-demand — call when user views project detail, not in polling loop.
 */
export function getProjectUsage(claudeProjectDir: string): ProjectUsageStats | null {
  let entries: string[];
  try {
    entries = readdirSync(claudeProjectDir);
  } catch {
    return null;
  }

  const sessions: SessionUsageStats[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;
  let totalCost = 0;
  let totalMessages = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const sessionId = entry.replace(".jsonl", "");
    const stats = parseSessionUsage(join(claudeProjectDir, entry), sessionId);
    if (!stats) continue;

    sessions.push(stats);
    totalInput += stats.inputTokens;
    totalOutput += stats.outputTokens;
    totalCacheWrite += stats.cacheWrite5mTokens + stats.cacheWrite1hTokens;
    totalCacheRead += stats.cacheReadTokens;
    totalCost += stats.costUSD;
    totalMessages += stats.messageCount;
  }

  if (sessions.length === 0) return null;

  return {
    sessions,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheWriteTokens: totalCacheWrite,
    totalCacheReadTokens: totalCacheRead,
    totalCostUSD: totalCost,
    totalMessages,
  };
}

// ─── Turn duration parsing ──────────────────────────────────

// Long turn threshold: turns exceeding this are flagged
const LONG_TURN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface TurnDuration {
  ts: string;           // ISO 8601
  sessionId: string;
  durationMs: number;
}

function extractTurnDuration(line: string): TurnDuration | null {
  if (!line.includes('"turn_duration"')) return null;

  try {
    const obj = JSON.parse(line);
    if (obj.type !== "system" || obj.subtype !== "turn_duration") return null;
    if (!obj.durationMs || !obj.sessionId) return null;

    return {
      ts: obj.timestamp ?? "",
      sessionId: obj.sessionId,
      durationMs: obj.durationMs,
    };
  } catch {
    return null;
  }
}

/**
 * Parse turn_duration events from a session JSONL file.
 * Returns ActivityEvent[] entries that can be merged into the activity log.
 */
export function parseTurnDurations(jsonlPath: string, projectPath: string): ActivityEvent[] {
  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf-8");
  } catch {
    return [];
  }

  const events: ActivityEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line) continue;
    const td = extractTurnDuration(line);
    if (!td) continue;

    const secs = Math.round(td.durationMs / 1000);
    const formatted = secs >= 60
      ? `${Math.floor(secs / 60)}m ${secs % 60}s`
      : `${secs}s`;

    events.push({
      ts: td.ts,
      sessionId: td.sessionId,
      toolName: "_turn_complete",
      summary: `Turn completed in ${formatted}`,
      projectPath,
      durationMs: td.durationMs,
      ...(td.durationMs > LONG_TURN_THRESHOLD_MS && { isError: true }),
    });
  }

  return events;
}

/**
 * Get turn durations for all sessions in a project's Claude directory.
 * On-demand — call when user views project detail.
 */
export function getProjectTurnDurations(claudeProjectDir: string, projectPath: string): ActivityEvent[] {
  let entries: string[];
  try {
    entries = readdirSync(claudeProjectDir);
  } catch {
    return [];
  }

  const events: ActivityEvent[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    events.push(...parseTurnDurations(join(claudeProjectDir, entry), projectPath));
  }

  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

// Exported for testing
export { resolveModelPricing, calculateCostUSD, FALLBACK_PRICING, LONG_TURN_THRESHOLD_MS };
export type { ModelPricing, TokenAccumulator, TurnDuration };
