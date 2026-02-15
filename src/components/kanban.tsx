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
  todo: { label: "TODO", color: C.accent, bold: true },
  needs_input: { label: "Attention!", color: C.error, bold: true },
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
        const isActive = project.isActive;

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
                leftColor = isActive ? C.warning : C.text;
              } else if (ri === 1) {
                // Milestone summary if available, otherwise branch
                const primary = project.roadmap.length > 0
                  ? project.roadmap.reduce((best, r) => r.totalItems > best.totalItems ? r : best)
                  : null;
                if (primary && primary.totalItems > 0) {
                  const pct = Math.round((primary.totalDone / primary.totalItems) * 100);
                  const barW = 4;
                  const filled = Math.round((pct / 100) * barW);
                  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barW - filled);
                  const src = primary.source.length > 8 ? primary.source.slice(0, 7) + "\u2026" : primary.source;
                  leftText = `${src} ${bar} ${pct}%`;
                  leftColor = C.subtext;
                } else {
                  leftText = `\u23C7${project.branch}`;
                  leftColor = C.accent;
                }
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

// ─── By Agent Layout (vertical list, grouped by project) ─────

// Task card with status icon for list view
function AgentTaskCard({ task, column }: {
  task: DisplayTask;
  column: KanbanColumn;
}) {
  const icon = column === "done" ? "✓" : column === "doing" ? "◍" : column === "needs_input" ? "⊘" : "○";
  const iconColor = column === "done" ? C.success : column === "doing" ? C.warning : column === "needs_input" ? C.error : C.dim;
  const idStr = `#${task.id.length > 5 ? task.id.slice(0, 4) + "…" : task.id}`;
  const dwell = formatDwell(task.statusChangedAt);

  return (
    <Text wrap="truncate">
      <Text color={iconColor}>{icon} </Text>
      <Text
        color={column === "done" || task.gone ? C.dim : C.text}
        strikethrough={column === "done" || !!task.gone}
      >
        {idStr} {task.subject}
      </Text>
      {task.owner && <Text color={C.accent}> ({task.owner})</Text>}
      {task.blockedBy && <Text color={C.error}> ⊘#{task.blockedBy}</Text>}
      {column !== "done" && dwell && <Text color={C.dim}> {dwell}</Text>}
    </Text>
  );
}

function ByAgentLayout({
  projects,
  hideDone,
}: {
  projects: ViewProject[];
  hideDone: boolean;
}) {
  if (projects.length === 0) {
    return <Text color={C.dim}>No active agents</Text>;
  }

  return (
    <Box flexDirection="column">
      {projects.map((project, pi) => {
        const buckets = buildBuckets(project);
        // Order: doing → needs_input → todo → done
        const ordered: { task: DisplayTask; col: KanbanColumn }[] = [
          ...buckets.doing.map((t) => ({ task: t, col: "doing" as KanbanColumn })),
          ...buckets.needs_input.map((t) => ({ task: t, col: "needs_input" as KanbanColumn })),
          ...buckets.todo.map((t) => ({ task: t, col: "todo" as KanbanColumn })),
          ...(hideDone ? [] : buckets.done.map((t) => ({ task: t, col: "done" as KanbanColumn }))),
        ];

        // Agent process state
        const primaryAgent = project.agentDetails[0];
        const processState = primaryAgent?.processState
          ?? (project.isActive ? "running" : project.activeSessions > 0 ? "idle" : undefined);
        const stateIcon = processState === "running" ? "●" : "○";
        const stateColor = processState === "running" ? C.warning : C.dim;

        // Task counts
        const total = buckets.todo.length + buckets.needs_input.length + buckets.doing.length + buckets.done.length;
        const done = buckets.done.length;

        // Branch display
        const branchStr = project.branch.length > 18
          ? project.branch.slice(0, 17) + "…"
          : project.branch;

        return (
          <Box key={project.projectPath} flexDirection="column">
            {/* Blank line between projects for consistent spacing */}
            {pi > 0 && <Text>{" "}</Text>}

            {/* Project header: state + name + branch + count */}
            <Text wrap="truncate">
              <Text color={stateColor}>{stateIcon} </Text>
              <Text color={project.isActive ? C.warning : C.text} bold>{project.name}</Text>
              <Text color={C.accent}>  ⎇{branchStr}</Text>
              {total > 0 && (
                <>
                  <Text color={C.dim}>  </Text>
                  <Text color={C.subtext}>{done}/{total}</Text>
                </>
              )}
              {/* Multi-agent indicator */}
              {project.agentDetails.length > 1 && (
                <Text color={C.dim}>  {project.agentDetails.map((a) =>
                  a.processState === "running" ? "●" : "○"
                ).join("")}</Text>
              )}
            </Text>

            {/* Tasks — flat list with indentation */}
            {ordered.map(({ task, col }, ti) => (
              <Text key={`${task.id}-${ti}`} wrap="truncate">
                <Text>    </Text>
                <AgentTaskCard task={task} column={col} />
              </Text>
            ))}
          </Box>
        );
      })}
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
  layout: "swimlane" | "by_agent";
  hideDone: boolean;
}) {
  const stdout = useStdout();
  const cols = stdout.stdout?.columns ?? 120;

  // Panel takes 4 chars (2 borders + 2 paddingX)
  const contentW = cols - 4;

  const filterLabel = selectedCount > 0 ? ` (${selectedCount} selected)` : "";
  const layoutLabel = layout === "swimlane" ? "SWIM" : "AGENT";
  const hideLabel = hideDone ? " \u229ADONE" : "";

  if (layout === "by_agent") {
    return (
      <Panel
        title={`KANBAN ${layoutLabel} — ${projects.length} project${projects.length !== 1 ? "s" : ""}${filterLabel}${hideLabel}`}
        flexGrow={1}
      >
        <ByAgentLayout projects={projects} hideDone={hideDone} />
      </Panel>
    );
  }

  // ─── Swimlane layout ────────────────────────────────────────
  const activeCols = hideDone ? ALL_COLUMNS.filter((c) => c !== "done") : ALL_COLUMNS;
  const numCols = activeCols.length;

  const labelW = Math.min(18, Math.max(12, Math.floor(contentW * 0.15)));
  const colAvail = contentW - labelW - numCols * SEP_W;
  const perCol = Math.max(12, Math.floor(colAvail / numCols));
  const colWidths = activeCols.map(() => perCol);

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

  return (
    <Panel
      title={`KANBAN ${layoutLabel} — ${projects.length} project${projects.length !== 1 ? "s" : ""}${filterLabel}${hideLabel}`}
      flexGrow={1}
    >
      {/* Header row — uses identical Box widths as content cells */}
      <Box>
        <Box width={labelW}>
          <Text color={C.primary} bold>PROJECTS</Text>
        </Box>
        <Sep />
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

      <SwimLaneLayout
        projects={projects}
        activeCols={activeCols}
        colWidths={colWidths}
        labelW={labelW}
      />
    </Panel>
  );
}
