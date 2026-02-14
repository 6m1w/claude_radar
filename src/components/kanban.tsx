/**
 * Kanban View — 4-column board with swimlane and column-first layouts
 *
 * Columns: TODO → NEEDS INPUT → DOING → DONE
 * NEEDS INPUT captures tasks requiring human attention:
 *   - has unresolved blockedBy dependencies
 *   - in_progress but agent is idle/dead (waiting for permission, crashed, etc.)
 *
 * Alignment strategy: every cell uses <Box width={n}> to guarantee exact
 * column widths. <Text wrap="truncate"> handles CJK/emoji truncation.
 * Separator chars ("│ ") are outside cells, so cell widths don't drift.
 */
import React from "react";
import { Box, Text, useStdout } from "ink";
import { C } from "../theme.js";
import { Panel } from "./panel.js";
import { formatDwell } from "../utils.js";
import type { DisplayTask, ViewProject } from "../types.js";

// ─── Column classification ──────────────────────────────────

type KanbanColumn = "todo" | "needs_input" | "doing" | "done";

const ALL_COLUMNS: KanbanColumn[] = ["todo", "needs_input", "doing", "done"];

const COLUMN_CONFIG: Record<KanbanColumn, { label: string; color: string; bold: boolean }> = {
  todo: { label: "TODO", color: C.text, bold: false },
  needs_input: { label: "Your attention!", color: C.error, bold: true },
  doing: { label: "DOING", color: C.warning, bold: true },
  done: { label: "DONE", color: C.success, bold: false },
};

// Classify a task into a kanban column based on priority rules
function classifyTask(task: DisplayTask, project: ViewProject): KanbanColumn {
  if (task.status === "completed" || task.gone) return "done";
  if (task.blockedBy) return "needs_input";
  if (task.status === "in_progress" && task.owner) {
    const agent = project.agentDetails.find((a) => a.name === task.owner);
    if (agent && agent.processState !== "running") return "needs_input";
  }
  if (task.status === "in_progress") return "doing";
  return "todo";
}

// Build deduplicated buckets per column
function buildBuckets(project: ViewProject): Record<KanbanColumn, DisplayTask[]> {
  const buckets: Record<KanbanColumn, DisplayTask[]> = {
    todo: [], needs_input: [], doing: [], done: [],
  };
  const seen = new Set<string>();
  for (const task of project.tasks) {
    const key = `${task.id}-${task.gone ? "g" : "l"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    buckets[classifyTask(task, project)].push(task);
  }
  return buckets;
}

// Card accent color (left ┃ border)
function accentColor(column: KanbanColumn, task: DisplayTask): string {
  if (task.gone) return C.dim;
  switch (column) {
    case "needs_input": return C.error;
    case "doing": return C.warning;
    case "done": return C.success;
    default: return C.subtext;
  }
}

// ─── Compact Card (1-line, used in swimlane + DONE column) ───

function CompactCard({ task, column }: {
  task: DisplayTask;
  column: KanbanColumn;
}) {
  const accent = accentColor(column, task);
  const isGone = !!task.gone;
  const isDone = column === "done";
  const idStr = `#${task.id.length > 5 ? task.id.slice(0, 4) + "…" : task.id}`;

  return (
    <Text wrap="truncate">
      <Text color={accent}>┃ </Text>
      <Text
        color={isDone || isGone ? C.dim : C.text}
        bold={column === "doing"}
        dimColor={isGone}
        strikethrough={isDone || isGone}
      >
        {idStr} {task.subject}
      </Text>
    </Text>
  );
}

// ─── Rich Card (3-line, used in column-first for active tasks) ─

function RichCard({ task, column, width }: {
  task: DisplayTask;
  column: KanbanColumn;
  width: number;
}) {
  const accent = accentColor(column, task);
  const idStr = `#${task.id.length > 5 ? task.id.slice(0, 4) + "…" : task.id}`;
  const badge = task.owner ? task.owner.slice(0, 8).toUpperCase() : "";
  const dwell = formatDwell(task.statusChangedAt);
  const meta = [dwell, task.blockedBy ? `⊘#${task.blockedBy}` : ""].filter(Boolean).join("  ");

  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">
        <Text color={accent}>┃ </Text>
        <Text color={C.accent}>{idStr}</Text>
        {badge && <Text color={C.dim}>{" ".repeat(Math.max(1, width - idStr.length - badge.length - 2))}{badge}</Text>}
      </Text>
      <Text wrap="truncate">
        <Text color={accent}>┃ </Text>
        <Text color={C.text} bold={column === "doing"}>{task.subject}</Text>
      </Text>
      <Text wrap="truncate">
        <Text color={accent}>┃ </Text>
        <Text color={task.blockedBy ? C.error : C.dim}>{meta}</Text>
      </Text>
    </Box>
  );
}

// ─── Column separator ("│ " in content, "┼─" in divider) ─────

// Renders a vertical separator between columns
function Sep() {
  return <Text color={C.dim}>│ </Text>;
}

const SEP_W = 2; // display width of "│ "

// ─── SwimLaneLayout (1-line compact cards) ───────────────────

function SwimLaneLayout({
  projects,
  activeCols,
  colWidths,
  labelW,
}: {
  projects: ViewProject[];
  activeCols: KanbanColumn[];
  colWidths: number[];
  labelW: number;
}) {
  return (
    <>
      {projects.map((project) => {
        const buckets = buildBuckets(project);
        const maxRows = Math.max(1, ...activeCols.map((c) => buckets[c].length));
        const isActive = project.activeSessions > 0 || project.hookSessionCount > 0;

        return (
          <Box key={project.projectPath} flexDirection="column">
            {/* Horizontal divider — matches column positions exactly */}
            <Text color={C.dim}>
              {"─".repeat(labelW)}
              {activeCols.map((_, i) => "┼" + "─".repeat(colWidths[i] + 1)).join("")}
            </Text>

            {/* 1 row per task slot */}
            {Array.from({ length: maxRows }, (_, ri) => {
              let leftText = "";
              let leftColor = C.text;
              if (ri === 0) {
                leftText = project.name;
                leftColor = isActive ? C.success : C.subtext;
              } else if (ri === 1) {
                leftText = `⎇${project.branch}`;
                leftColor = C.accent;
              }

              return (
                <Box key={ri}>
                  {/* Label cell — fixed width, truncated by Box */}
                  <Box width={labelW}>
                    <Text wrap="truncate" color={leftColor} bold={ri === 0}>
                      {leftText}
                    </Text>
                  </Box>
                  {/* Data columns */}
                  {activeCols.map((col, ci) => {
                    const task = buckets[col][ri];
                    return (
                      <React.Fragment key={col}>
                        <Sep />
                        <Box width={colWidths[ci]}>
                          {task ? (
                            <CompactCard task={task} column={col} />
                          ) : null}
                        </Box>
                      </React.Fragment>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        );
      })}
    </>
  );
}

// ─── ColumnFirstLayout (rich cards for active, compact for done) ─

function ColumnFirstLayout({
  projects,
  activeCols,
  colWidths,
}: {
  projects: ViewProject[];
  activeCols: KanbanColumn[];
  colWidths: number[];
}) {
  const multiProject = projects.length > 1;

  // Collect classified tasks grouped by column → project
  const columnGroups: Record<KanbanColumn, { project: ViewProject; tasks: DisplayTask[] }[]> = {
    todo: [], needs_input: [], doing: [], done: [],
  };

  for (const project of projects) {
    const buckets = buildBuckets(project);
    for (const col of ALL_COLUMNS) {
      if (buckets[col].length > 0) {
        columnGroups[col].push({ project, tasks: buckets[col] });
      }
    }
  }

  // Build column content
  const columnElements = activeCols.map((col, ci) => {
    const w = colWidths[ci];
    const isDone = col === "done";
    const elements: React.ReactNode[] = [];

    for (const group of columnGroups[col]) {
      if (multiProject) {
        elements.push(
          <Text key={`hdr-${group.project.projectPath}-${col}`} wrap="truncate" color={C.dim}>
            {"─── "}{group.project.name}{" ───"}
          </Text>
        );
      }
      for (const task of group.tasks) {
        const key = `${group.project.projectPath}-${task.id}-${col}`;
        if (isDone) {
          elements.push(
            <Box key={key} width={w}>
              <CompactCard task={task} column={col} />
            </Box>
          );
        } else {
          elements.push(
            <RichCard key={key} task={task} column={col} width={w} />
          );
        }
      }
    }

    if (elements.length === 0) {
      elements.push(<Text key="empty" color={C.dim}>{"  —"}</Text>);
    }

    return elements;
  });

  return (
    <Box>
      {activeCols.map((col, ci) => (
        <React.Fragment key={col}>
          {ci > 0 && <Text color={C.dim}>│</Text>}
          <Box flexDirection="column" width={colWidths[ci]}>
            {columnElements[ci]}
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

// ─── KanbanView (main export) ────────────────────────────────

export function KanbanView({
  projects,
  selectedCount,
  layout,
  hideDone,
}: {
  projects: ViewProject[];
  selectedCount: number;
  layout: "swimlane" | "column_first";
  hideDone: boolean;
}) {
  const stdout = useStdout();
  const cols = stdout.stdout?.columns ?? 120;

  // Active columns: filter DONE when hidden
  const activeCols = hideDone ? ALL_COLUMNS.filter((c) => c !== "done") : ALL_COLUMNS;
  const numCols = activeCols.length;

  // Panel takes 4 chars (2 borders + 2 paddingX)
  const contentW = cols - 4;

  // Column widths — every cell, header, and divider uses these exact values
  let labelW = 0;
  let colWidths: number[];

  if (layout === "swimlane") {
    labelW = Math.min(18, Math.max(12, Math.floor(contentW * 0.15)));
    // numCols separators of SEP_W each (label│col + col│col + ...)
    const colAvail = contentW - labelW - numCols * SEP_W;
    const perCol = Math.max(12, Math.floor(colAvail / numCols));
    colWidths = activeCols.map(() => perCol);
  } else {
    // Column-first: "│" (1 char) between columns only
    const sepTotal = numCols - 1;
    const colAvail = contentW - sepTotal;
    const perCol = Math.max(12, Math.floor(colAvail / numCols));
    colWidths = activeCols.map(() => perCol);
  }

  // Count tasks per column
  const counts: Record<KanbanColumn, number> = { todo: 0, needs_input: 0, doing: 0, done: 0 };
  for (const project of projects) {
    const seen = new Set<string>();
    for (const task of project.tasks) {
      const key = `${task.id}-${task.gone ? "g" : "l"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[classifyTask(task, project)]++;
    }
  }

  const filterLabel = selectedCount > 0 ? ` (${selectedCount} selected)` : "";
  const layoutLabel = layout === "swimlane" ? "SWIM" : "COLS";
  const hideLabel = hideDone ? " ⊘DONE" : "";

  return (
    <Panel
      title={`KANBAN ${layoutLabel} — ${projects.length} project${projects.length !== 1 ? "s" : ""}${filterLabel}${hideLabel}`}
      flexGrow={1}
    >
      {/* Header row — uses identical Box widths as content cells */}
      <Box>
        {layout === "swimlane" && (
          <>
            <Box width={labelW}>
              <Text color={C.primary} bold>PROJECTS</Text>
            </Box>
            <Sep />
          </>
        )}
        {activeCols.map((col, ci) => {
          const cfg = COLUMN_CONFIG[col];
          const w = colWidths[ci];
          const countStr = String(counts[col]);
          const gap = Math.max(1, w - cfg.label.length - countStr.length);
          return (
            <React.Fragment key={col}>
              {ci > 0 && <Sep />}
              <Box width={w}>
                <Text>
                  <Text color={cfg.color} bold={cfg.bold}>{cfg.label}</Text>
                  <Text color={C.dim}>{" ".repeat(gap)}{countStr}</Text>
                </Text>
              </Box>
            </React.Fragment>
          );
        })}
      </Box>

      {layout === "swimlane" ? (
        <SwimLaneLayout
          projects={projects}
          activeCols={activeCols}
          colWidths={colWidths}
          labelW={labelW}
        />
      ) : (
        <ColumnFirstLayout
          projects={projects}
          activeCols={activeCols}
          colWidths={colWidths}
        />
      )}
    </Panel>
  );
}
