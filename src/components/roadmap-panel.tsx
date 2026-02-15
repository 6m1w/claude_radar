/**
 * RoadmapPanel — left-bottom panel showing roadmap progress for selected project
 *
 * Displays parsed checkbox data from PRD.md / docs with section-level progress.
 * When focused (hotkey 3): h/l switches files, j/k navigates sections,
 * Enter/Space toggles section expand (accordion behavior).
 */
import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";
import { Panel } from "./panel.js";

import { truncateToWidth } from "../utils.js";
import type { ViewProject } from "../types.js";

export function RoadmapPanel({
  project,
  height,
  focused,
  selectedIdx = 0,
  sectionIdx = 0,
  expandedSection = null,
  hotkey,
}: {
  project?: ViewProject;
  height: number;
  focused?: boolean;
  selectedIdx?: number;
  sectionIdx?: number;
  expandedSection?: number | null;
  hotkey?: string;
}) {
  // Empty state
  if (!project || project.roadmap.length === 0) {
    return (
      <Panel title="ROADMAP" height={height} hotkey={hotkey} focused={focused}>
        <Text color={C.dim}>No roadmap · add [ ] to .md</Text>
      </Panel>
    );
  }

  const roadmaps = project.roadmap;
  const safeIdx = Math.min(selectedIdx, roadmaps.length - 1);
  const selected = roadmaps[safeIdx];
  const sections = selected.sections;
  const safeSectionIdx = Math.min(sectionIdx, Math.max(0, sections.length - 1));

  // Usable lines: height - border(2) - title(1) = height - 3
  const usableLines = Math.max(2, height - 3);
  // 1 line for source header, rest for sections + items
  const contentBudget = usableLines - 1;

  // Build content lines: sections + expanded items (accordion)
  type ContentLine =
    | { type: "section"; idx: number }
    | { type: "item"; sectionIdx: number; itemIdx: number };
  const contentLines: ContentLine[] = [];
  for (let si = 0; si < sections.length; si++) {
    contentLines.push({ type: "section", idx: si });
    if (focused && expandedSection === si) {
      for (let ii = 0; ii < sections[si].items.length; ii++) {
        contentLines.push({ type: "item", sectionIdx: si, itemIdx: ii });
      }
    }
  }

  // Viewport: keep cursor section visible, center when possible
  const cursorLineIdx = contentLines.findIndex(
    (l) => l.type === "section" && l.idx === safeSectionIdx
  );
  const hasOverflow = contentLines.length > contentBudget;
  const maxVisible = hasOverflow ? contentBudget - 1 : contentBudget;

  let viewStart = 0;
  if (cursorLineIdx >= 0 && contentLines.length > maxVisible) {
    viewStart = Math.max(0, Math.min(
      cursorLineIdx - Math.floor(maxVisible / 2),
      contentLines.length - maxVisible
    ));
  }
  const visibleContent = contentLines.slice(viewStart, viewStart + maxVisible);
  const moreCount = contentLines.length - viewStart - maxVisible;

  // Header: file navigation with arrows when focused
  let sourceLabel: string;
  if (focused && roadmaps.length > 1) {
    sourceLabel = `◀ ${selected.source} ▶`;
  } else if (roadmaps.length > 1) {
    sourceLabel = `${selected.source} +${roadmaps.length - 1}`;
  } else {
    sourceLabel = selected.source;
  }

  return (
    <Panel title="ROADMAP" height={height} hotkey={hotkey} focused={focused}>
      {/* Source header with right-aligned total */}
      <Box height={1} overflow="hidden">
        <Text wrap="truncate" color={C.accent}>{sourceLabel}</Text>
        <Box flexGrow={1} />
        <Text color={selected.totalDone === selected.totalItems ? C.success : C.text}>
          {selected.totalDone}/{selected.totalItems}
        </Text>
      </Box>

      {/* Section/item lines */}
      {visibleContent.map((line, vi) => {
        if (line.type === "section") {
          const section = sections[line.idx];
          const isCursor = focused && line.idx === safeSectionIdx;
          const isExpanded = focused && expandedSection === line.idx;
          const icon = isExpanded ? "▾" : "▸";
          const titleColor = isCursor ? C.text : C.subtext;
          const countColor = section.done === section.total ? C.success : C.subtext;
          return (
            <Box key={`s-${line.idx}`} height={1} overflow="hidden">
              <Text color={isCursor ? C.primary : C.dim}>{isCursor ? icon : "▸"} </Text>
              <Text wrap="truncate" color={titleColor}>{truncateToWidth(section.title, 20)}</Text>
              <Box flexGrow={1} />
              <Text color={countColor}>{section.done}/{section.total}</Text>
            </Box>
          );
        }
        // Expanded item
        const item = sections[line.sectionIdx].items[line.itemIdx];
        const icon = item.done ? "✓" : "○";
        const color = item.done ? C.success : C.subtext;
        return (
          <Text key={`i-${line.sectionIdx}-${line.itemIdx}`} wrap="truncate">
            <Text color={C.dim}>  </Text>
            <Text color={color}>{icon} </Text>
            <Text color={color}>{truncateToWidth(item.text, 22)}</Text>
          </Text>
        );
      })}

      {/* Overflow */}
      {hasOverflow && moreCount > 0 && (
        <Text color={C.dim}>  +{moreCount} more</Text>
      )}
    </Panel>
  );
}
