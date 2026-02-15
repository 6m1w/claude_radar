// roadmap.ts — Parse markdown checkboxes from PRD / doc files
// Extracts `- [x]` / `- [ ]` items grouped by section headings.
// Language-agnostic: works with Chinese, English, or any language.

import { readFileSync, statSync } from "node:fs";
import type { RoadmapData, RoadmapSection, RoadmapItem } from "../types.js";

// ─── Regex patterns ──────────────────────────────────────────

// Markdown heading: "## Foo" or "### Bar — Baz"
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

// Checkbox: "- [x] done item" or "- [ ] pending item"
// Also handles indented checkboxes (nested lists)
// Supports all three Markdown list markers: - * +
const CHECKBOX_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/;

// ─── Parser ──────────────────────────────────────────────────

/**
 * Parse markdown content for checkbox items grouped by section headings.
 *
 * Algorithm:
 * 1. Walk lines top-to-bottom
 * 2. Track current section from heading lines
 * 3. Collect checkboxes into the current section
 * 4. Sections without checkboxes are discarded
 */
export function parseCheckboxes(content: string): RoadmapSection[] {
  const lines = content.split("\n");
  const sections: RoadmapSection[] = [];

  // Accumulator for the current section
  let currentTitle = "";
  let currentLevel = 0;
  let currentItems: RoadmapItem[] = [];

  function flushSection() {
    if (currentItems.length > 0) {
      const done = currentItems.filter((i) => i.done).length;
      sections.push({
        title: currentTitle || "(untitled)",
        level: currentLevel || 1,
        items: currentItems,
        done,
        total: currentItems.length,
      });
    }
    currentItems = [];
  }

  for (const line of lines) {
    // Check for heading
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushSection();
      currentLevel = headingMatch[1].length;
      currentTitle = headingMatch[2].trim();
      continue;
    }

    // Check for checkbox
    const cbMatch = line.match(CHECKBOX_RE);
    if (cbMatch) {
      const done = cbMatch[1].toLowerCase() === "x";
      const text = cbMatch[2].trim();
      currentItems.push({ text, done });
    }
  }

  // Flush last section
  flushSection();

  return sections;
}

// ─── File-level parser ───────────────────────────────────────

/**
 * Parse a markdown file for roadmap data.
 * Returns null if the file can't be read or has no checkboxes.
 */
export function parseRoadmapFile(
  filePath: string,
  source: string,
): RoadmapData | null {
  let content: string;
  let mtime: Date;

  try {
    content = readFileSync(filePath, "utf-8");
    mtime = statSync(filePath).mtime;
  } catch {
    return null;
  }

  const sections = parseCheckboxes(content);
  if (sections.length === 0) return null;

  const totalDone = sections.reduce((sum, s) => sum + s.done, 0);
  const totalItems = sections.reduce((sum, s) => sum + s.total, 0);

  return {
    source,
    sections,
    totalDone,
    totalItems,
    lastModified: mtime.toISOString(),
  };
}
