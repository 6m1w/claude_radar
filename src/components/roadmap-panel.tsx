/**
 * RoadmapPanel — left-bottom panel showing roadmap progress for selected project
 *
 * Displays parsed checkbox data from PRD.md / docs with section-level progress bars.
 * Follows the selected project and updates in real-time.
 */
import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";
import { Panel } from "./panel.js";

import { formatRelativeTime } from "../utils.js";
import type { ViewProject, RoadmapData } from "../types.js";

export function RoadmapPanel({
  project,
  height,
}: {
  project?: ViewProject;
  height: number;
}) {
  // Empty state: no project selected or no roadmap data
  if (!project || project.roadmap.length === 0) {
    return (
      <Panel title="ROADMAP" height={height}>
        <Text color={C.dim}>No roadmap {"\u00b7"} add [ ] to .md</Text>
      </Panel>
    );
  }

  const roadmaps = project.roadmap;

  // Pick primary file (most items) for display
  const primary = roadmaps.reduce((best, r) =>
    r.totalItems > best.totalItems ? r : best
  );
  const otherCount = roadmaps.length - 1;

  // Source line: "{source} · {pct}% · {timeAgo}"
  const pct = primary.totalItems > 0
    ? Math.round((primary.totalDone / primary.totalItems) * 100)
    : 0;
  const timeAgo = primary.lastModified
    ? formatRelativeTime(primary.lastModified)
    : "";
  const sourceLabel = primary.source + (otherCount > 0 ? ` +${otherCount}` : "");

  // Usable lines: height - border(2) - paddingY(2) - title(1) = height - 5
  const usableLines = Math.max(2, height - 5);
  // Line 0 = source line, remaining for sections
  const sectionSlots = usableLines - 1;

  // Collect all sections across all roadmap files for display
  const allSections = roadmaps.flatMap((r) => r.sections);

  return (
    <Panel title="ROADMAP" height={height}>
      {/* Source line */}
      <Text wrap="truncate">
        <Text color={C.accent}>{sourceLabel}</Text>
        <Text color={C.dim}> {"\u00b7"} </Text>
        <Text color={pct === 100 ? C.success : C.text}>{pct}%</Text>
        {timeAgo && (
          <>
            <Text color={C.dim}> {"\u00b7"} </Text>
            <Text color={C.dim}>{timeAgo}</Text>
          </>
        )}
      </Text>

      {/* Section lines with progress bars */}
      {allSections.slice(0, sectionSlots).map((section, i) => {
        // Truncate title to fit: "▸ {title}  <Progress> {done}/{total}"
        const maxTitleLen = 13;
        const title = section.title.length > maxTitleLen
          ? section.title.slice(0, maxTitleLen - 1) + "\u2026"
          : section.title;

        return (
          <Text key={i} wrap="truncate">
            <Text color={C.subtext}>{"\u25b8"} {title.padEnd(maxTitleLen)} </Text>
            <Text color={C.subtext}>{section.done}/{section.total}</Text>
          </Text>
        );
      })}

      {/* Overflow indicator */}
      {allSections.length > sectionSlots && (
        <Text color={C.dim}>  +{allSections.length - sectionSlots} more</Text>
      )}
    </Panel>
  );
}
