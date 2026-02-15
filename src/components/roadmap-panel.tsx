/**
 * RoadmapPanel — left-bottom panel showing roadmap progress for selected project
 *
 * Displays parsed checkbox data from PRD.md / docs with section-level progress.
 * When focused (hotkey 3), j/k switches between .md files.
 */
import React from "react";
import { Text } from "ink";
import { C } from "../theme.js";
import { Panel } from "./panel.js";

import { formatRelativeTime } from "../utils.js";
import type { ViewProject } from "../types.js";

export function RoadmapPanel({
  project,
  height,
  focused,
  selectedIdx = 0,
  hotkey,
}: {
  project?: ViewProject;
  height: number;
  focused?: boolean;
  selectedIdx?: number;
  hotkey?: string;
}) {
  // Empty state: no project selected or no roadmap data
  if (!project || project.roadmap.length === 0) {
    return (
      <Panel title="ROADMAP" height={height} hotkey={hotkey} focused={focused}>
        <Text color={C.dim}>No roadmap {"\u00b7"} add [ ] to .md</Text>
      </Panel>
    );
  }

  const roadmaps = project.roadmap;
  const safeIdx = Math.min(selectedIdx, roadmaps.length - 1);
  const selected = roadmaps[safeIdx];

  // Overall percentage for selected file
  const pct = selected.totalItems > 0
    ? Math.round((selected.totalDone / selected.totalItems) * 100)
    : 0;
  const timeAgo = selected.lastModified
    ? formatRelativeTime(selected.lastModified)
    : "";

  // Usable lines: height - border(2) - paddingY(2) - title(1) = height - 5
  const usableLines = Math.max(2, height - 5);

  if (focused && roadmaps.length > 1) {
    // Focused mode: file list with cursor for switching, then sections below
    const fileListLines = roadmaps.length;
    const sectionSlots = Math.max(0, usableLines - fileListLines);

    return (
      <Panel title="ROADMAP" height={height} hotkey={hotkey} focused={focused}>
        {/* File list with cursor */}
        {roadmaps.map((r, i) => {
          const isCurrent = i === safeIdx;
          const rPct = r.totalItems > 0 ? Math.round((r.totalDone / r.totalItems) * 100) : 0;
          return (
            <Text key={i} wrap="truncate">
              <Text color={isCurrent ? C.primary : C.dim}>{isCurrent ? "\u25b8" : " "} </Text>
              <Text color={isCurrent ? C.accent : C.subtext}>{r.source}</Text>
              <Text color={C.dim}> {"\u00b7"} </Text>
              <Text color={rPct === 100 ? C.success : C.text}>{rPct}%</Text>
              <Text color={C.subtext}> {r.totalDone}/{r.totalItems}</Text>
            </Text>
          );
        })}
        {/* Sections of selected file */}
        {selected.sections.slice(0, sectionSlots).map((section, i) => {
          const maxTitleLen = 13;
          const title = section.title.length > maxTitleLen
            ? section.title.slice(0, maxTitleLen - 1) + "\u2026"
            : section.title;
          return (
            <Text key={`s-${i}`} wrap="truncate">
              <Text color={C.subtext}>  {"\u25b8"} {title.padEnd(maxTitleLen)} </Text>
              <Text color={C.subtext}>{section.done}/{section.total}</Text>
            </Text>
          );
        })}
      </Panel>
    );
  }

  // Default: source line + section progress for selected file
  const sectionSlots = usableLines - 1;
  const sourceLabel = selected.source + (roadmaps.length > 1 ? ` +${roadmaps.length - 1}` : "");

  return (
    <Panel title="ROADMAP" height={height} hotkey={hotkey} focused={focused}>
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

      {/* Section lines */}
      {selected.sections.slice(0, sectionSlots).map((section, i) => {
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
      {selected.sections.length > sectionSlots && (
        <Text color={C.dim}>  +{selected.sections.length - sectionSlots} more</Text>
      )}
    </Panel>
  );
}
