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
import { C, I } from "../theme.js";
import { Panel } from "./panel.js";

import { formatDwell, truncateToWidth } from "../utils.js";
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
  if (task.status === "completed") return "done";
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
  const idPrefix = task.id.length <= 5 ? `#${task.id} ` : "";

  return (
    <Text wrap="truncate">
      <Text color={accent}>┃ </Text>
      <Text
        color={isDone || isGone ? C.dim : C.text}
        bold={column === "doing"}
        dimColor={isGone}
        strikethrough={isDone}
      >
        {idPrefix}{task.subject}
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
  const idStr = task.id.length <= 5 ? `#${task.id}` : "";
  const badge = task.owner ? truncateToWidth(task.owner.toUpperCase(), 8) : "";
  const dwell = formatDwell(task.statusChangedAt);
  const meta = [dwell, task.blockedBy ? `${I.blocked}#${task.blockedBy}` : ""].filter(Boolean).join("  ");

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Text wrap="truncate">
        <Text color={accent}>┃ </Text>
        {idStr && <Text color={C.accent}>{idStr}</Text>}
        {badge && <Text color={C.dim}>{" ".repeat(Math.max(1, width - (idStr ? idStr.length : 0) - badge.length - 2))}{badge}</Text>}
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
        // Merge non-displayed columns into todo for binary swimlane
        for (const col of (["needs_input", "doing"] as KanbanColumn[])) {
          if (!activeCols.includes(col)) {
            buckets.todo.push(...buckets[col]);
            buckets[col] = [];
          }
        }
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
                  const src = truncateToWidth(primary.source, 8);
                  leftText = `${src} ${primary.totalDone}/${primary.totalItems}`;
                  leftColor = C.subtext;
                } else {
                  leftText = `⎇${project.branch}`;
                  leftColor = C.accent;
                }
              }

              return (
                <Box key={ri}>
                  {/* Label cell — fixed width, truncated by Box */}
                  <Box width={labelW} flexShrink={0}>
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
                        <Box width={colWidths[ci]} flexShrink={0}>
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
  const icon = column === "done" ? "✓" : column === "doing" ? "◍" : column === "needs_input" ? I.blocked : "○";
  const iconColor = column === "done" ? C.success : column === "doing" ? C.warning : column === "needs_input" ? C.error : C.dim;
  const idPrefix = task.id.length <= 5 ? `#${task.id} ` : "";
  const dwell = formatDwell(task.statusChangedAt);

  return (
    <Text wrap="truncate">
      <Text color={iconColor}>{icon} </Text>
      <Text
        color={column === "done" || task.gone ? C.dim : C.text}
        strikethrough={column === "done"}
      >
        {idPrefix}{task.subject}
      </Text>
      {task.owner && <Text color={C.accent}> ({task.owner})</Text>}
      {task.blockedBy && <Text color={C.error}> {I.blocked}#{task.blockedBy}</Text>}
      {column !== "done" && dwell && <Text color={C.dim}> {dwell}</Text>}
    </Text>
  );
}

function ByAgentLayout({
  projects,
  hideDone,
  cursorIdx = 0,
  viewportHeight,
}: {
  projects: ViewProject[];
  hideDone: boolean;
  cursorIdx?: number;
  viewportHeight?: number;
}) {
  if (projects.length === 0) {
    return <Text color={C.dim}>No active agents</Text>;
  }

  // Separate projects: skip worktree-no-task, collapse all-done
  const activeProjects: ViewProject[] = [];
  const allDoneProjects: ViewProject[] = [];
  for (const p of projects) {
    // Hide worktree projects with no tasks (noise in task-focused view)
    if (p.worktreeOf && p.tasks.length === 0) continue;
    const buckets = buildBuckets(p);
    const remaining = buckets.todo.length + buckets.needs_input.length + buckets.doing.length;
    if (remaining === 0 && buckets.done.length > 0) {
      allDoneProjects.push(p);
    } else {
      activeProjects.push(p);
    }
  }

  const safeCursor = Math.max(0, Math.min(cursorIdx, activeProjects.length - 1));

  // Pre-compute line height per project for scroll math
  const MAX_TASKS = 5;
  type ProjectBlock = {
    project: ViewProject;
    height: number; // lines this project occupies (excl. separator)
  };
  const blocks: ProjectBlock[] = activeProjects.map((project) => {
    const buckets = buildBuckets(project);
    const allGroups = [buckets.needs_input, buckets.doing, buckets.todo];
    if (!hideDone) allGroups.push(buckets.done.slice(0, 5));
    const taskCount = allGroups.reduce((s, b) => s + b.length, 0);
    const visible = Math.min(taskCount, MAX_TASKS);
    const overflow = taskCount > MAX_TASKS ? 1 : 0;
    return { project, height: 1 + visible + overflow }; // header + tasks + overflow
  });

  // Compute visible range: ensure safeCursor is in viewport
  let scrollStart = 0;
  if (viewportHeight) {
    // Scroll forward until cursor fits in viewport
    while (scrollStart < safeCursor) {
      let h = 0;
      for (let i = scrollStart; i <= safeCursor; i++) {
        h += blocks[i].height + (i > scrollStart ? 1 : 0); // +1 separator
      }
      if (h <= viewportHeight) break;
      scrollStart++;
    }
  }

  // Determine how many projects fit from scrollStart
  let visibleEnd = blocks.length;
  if (viewportHeight) {
    let h = 0;
    for (let i = scrollStart; i < blocks.length; i++) {
      const projH = blocks[i].height + (i > scrollStart ? 1 : 0);
      if (h + projH > viewportHeight) { visibleEnd = i; break; }
      h += projH;
    }
  }

  const aboveCount = scrollStart;
  const belowCount = blocks.length - visibleEnd;

  return (
    <Box flexDirection="column">
      {aboveCount > 0 && <Text color={C.dim}>  ▲ {aboveCount} above</Text>}

      {blocks.slice(scrollStart, visibleEnd).map(({ project }, vi) => {
        const pi = scrollStart + vi;
        const isCursor = pi === safeCursor;
        const buckets = buildBuckets(project);

        // Agent process state
        const primaryAgent = project.agentDetails[0];
        const processState = primaryAgent?.processState
          ?? (project.isActive ? "running" : project.activeSessions > 0 ? "idle" : undefined);
        const stateIcon = processState === "running" ? "\u25CF" : "\u25CB";
        const stateColor = processState === "running" ? C.warning : C.dim;

        // Progress
        const remaining = buckets.todo.length + buckets.needs_input.length + buckets.doing.length;
        const attention = buckets.needs_input.length;
        const progressStr = remaining > 0
          ? `${remaining} remaining${attention > 0 ? ` \u00b7 ${attention}!` : ""}`
          : "all done";
        const branchStr = truncateToWidth(project.branch, 18);

        // Collect all tasks in priority order, cap at MAX_TASKS
        type TaggedTask = { task: DisplayTask; col: KanbanColumn };
        const allTasks: TaggedTask[] = [];
        for (const [col, tasks] of [
          ["needs_input", buckets.needs_input],
          ["doing", buckets.doing],
          ["todo", buckets.todo],
          ...(!hideDone && buckets.done.length > 0 ? [["done", buckets.done.slice(0, 5)]] : []),
        ] as [KanbanColumn, DisplayTask[]][]) {
          for (const task of tasks) allTasks.push({ task, col });
        }
        const visibleTasks = allTasks.slice(0, MAX_TASKS);
        const overflow = Math.max(0, allTasks.length - MAX_TASKS);

        return (
          <Box key={project.projectPath} flexDirection="column">
            {vi > 0 && <Text>{" "}</Text>}

            {/* Project header with cursor */}
            <Text wrap="truncate">
              <Text color={isCursor ? C.primary : stateColor}>{isCursor ? "\u25b8" : stateIcon} </Text>
              <Text color={project.isActive ? C.warning : C.text} bold={isCursor}>{project.name}</Text>
              <Text color={C.accent}>  ⎇{branchStr}</Text>
              <Text color={C.dim}>  </Text>
              <Text color={attention > 0 ? C.error : C.subtext}>{progressStr}</Text>
            </Text>

            {/* Task list — flat, no group headers */}
            {visibleTasks.map(({ task, col }, ti) => (
              <Text key={`${task.id}-${ti}`} wrap="truncate">
                <Text>  </Text>
                <AgentTaskCard task={task} column={col} />
              </Text>
            ))}
            {overflow > 0 && (
              <Text wrap="truncate" color={C.dim}>  +{overflow} more</Text>
            )}
          </Box>
        );
      })}

      {belowCount > 0 && <Text color={C.dim}>  ▼ {belowCount} below</Text>}

      {/* Collapsed all-done projects */}
      {allDoneProjects.length > 0 && (
        <>
          {(scrollStart < blocks.length || aboveCount > 0) && <Text>{" "}</Text>}
          <Text color={C.dim}>  + {allDoneProjects.length} project{allDoneProjects.length > 1 ? "s" : ""} (all done)</Text>
        </>
      )}
    </Box>
  );
}

// ─── KanbanView (main export) ────────────────────────────────

export function KanbanView({
  projects,
  selectedCount,
  layout,
  hideDone,
  cursorIdx = 0,
}: {
  projects: ViewProject[];
  selectedCount: number;
  layout: "swimlane" | "by_agent";
  hideDone: boolean;
  cursorIdx?: number;
}) {
  const stdout = useStdout();
  const cols = stdout.stdout?.columns ?? 120;
  const rows = stdout.stdout?.rows ?? 40;

  // Panel takes 4 chars (2 borders + 2 paddingX)
  const contentW = cols - 4;
  // Viewport: terminal rows - statusBar(2) - panelChrome(3)
  const viewportHeight = rows - 5;

  const filterLabel = selectedCount > 0 ? ` (${selectedCount} selected)` : "";
  const layoutLabel = layout === "swimlane" ? "ROADMAP" : "TASKS";
  const hideLabel = hideDone ? " \u229ADONE" : "";

  if (layout === "by_agent") {
    return (
      <Panel
        title={`${layoutLabel} — ${projects.length} project${projects.length !== 1 ? "s" : ""}${filterLabel}${hideLabel}`}
        flexGrow={1}
      >
        <ByAgentLayout projects={projects} hideDone={hideDone} cursorIdx={cursorIdx} viewportHeight={viewportHeight} />
      </Panel>
    );
  }

  // ─── Swimlane layout — 2 columns for binary L1 data ─────────
  const SWIMLANE_COLS: KanbanColumn[] = ["todo", "done"];
  const activeCols = hideDone ? SWIMLANE_COLS.filter((c) => c !== "done") : SWIMLANE_COLS;
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
  // Merge needs_input/doing into todo for binary swimlane display
  counts.todo += counts.needs_input + counts.doing;

  return (
    <Panel
      title={`${layoutLabel} — ${projects.length} project${projects.length !== 1 ? "s" : ""}${filterLabel}${hideLabel}`}
      flexGrow={1}
    >
      {/* Header row — uses identical Box widths as content cells */}
      <Box>
        <Box width={labelW} flexShrink={0}>
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
              <Box width={w} flexShrink={0}>
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
