/**
 * Kanban View — 4-column board with swimlane and column-first layouts
 *
 * Columns: TODO → NEEDS INPUT → DOING → DONE
 * NEEDS INPUT captures tasks requiring human attention:
 *   - has unresolved blockedBy dependencies
 *   - in_progress but agent is idle/dead (waiting for permission, crashed, etc.)
 *
 * Swimlane: 1-line compact cards, projects as rows
 * Column-first: 3-line rich cards (DONE always 1-line)
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
  todo: { label: "TODO", color: C.subtext, bold: false },
  needs_input: { label: "NEEDS INPUT", color: C.error, bold: true },
  doing: { label: "DOING", color: C.warning, bold: true },
  done: { label: "DONE", color: C.success, bold: false },
};

// Classify a task into a kanban column based on priority rules
function classifyTask(task: DisplayTask, project: ViewProject): KanbanColumn {
  // 1. completed or gone → DONE
  if (task.status === "completed" || task.gone) return "done";
  // 2. has unresolved blockedBy → NEEDS INPUT
  if (task.blockedBy) return "needs_input";
  // 3. in_progress + agent idle/dead → NEEDS INPUT
  if (task.status === "in_progress" && task.owner) {
    const agent = project.agentDetails.find((a) => a.name === task.owner);
    if (agent && agent.processState !== "running") return "needs_input";
  }
  // 4. in_progress → DOING
  if (task.status === "in_progress") return "doing";
  // 5. pending → TODO
  return "todo";
}

// Build deduplicated buckets: classify tasks and deduplicate by task ID
function buildBuckets(project: ViewProject): Record<KanbanColumn, DisplayTask[]> {
  const buckets: Record<KanbanColumn, DisplayTask[]> = {
    todo: [], needs_input: [], doing: [], done: [],
  };
  const seen = new Set<string>();
  for (const task of project.tasks) {
    // Dedup by task ID — first occurrence wins (live items are ordered before gone)
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

function CompactCard({
  task,
  column,
  width,
}: {
  task: DisplayTask;
  column: KanbanColumn;
  width: number;
}) {
  const accent = accentColor(column, task);
  const isGone = !!task.gone;
  const isDone = column === "done";
  const contentW = Math.max(4, width - 3); // "┃ " = 2 chars + 1 buffer

  const idStr = `#${task.id.length > 5 ? task.id.slice(0, 4) + "…" : task.id}`;
  const remainW = contentW - idStr.length - 1;
  const subject = task.subject.slice(0, Math.max(0, remainW));
  const line = `${idStr} ${subject}`;

  return (
    <Box width={width}>
      <Text color={accent}>┃ </Text>
      <Text
        color={isDone || isGone ? C.dim : C.text}
        bold={column === "doing"}
        dimColor={isGone}
        strikethrough={isDone || isGone}
      >
        {line.padEnd(contentW).slice(0, contentW)}
      </Text>
    </Box>
  );
}

// ─── Rich Card (3-line, used in column-first for active tasks) ─

function RichCard({
  task,
  column,
  width,
}: {
  task: DisplayTask;
  column: KanbanColumn;
  width: number;
}) {
  const accent = accentColor(column, task);
  const contentW = Math.max(4, width - 3);

  // Line 1: #ID + agent badge (right-aligned)
  const idStr = `#${task.id.length > 5 ? task.id.slice(0, 4) + "…" : task.id}`;
  const badge = task.owner ? task.owner.slice(0, 8).toUpperCase() : "";
  const idPad = Math.max(0, contentW - idStr.length - badge.length);

  // Line 2: Subject
  const subjectStr = task.subject.slice(0, contentW);

  // Line 3: Dwell time + dependency info
  const dwell = formatDwell(task.statusChangedAt);
  const metaParts: string[] = [];
  if (dwell) metaParts.push(dwell);
  if (task.blockedBy) metaParts.push(`⊘#${task.blockedBy}`);
  const metaStr = metaParts.join("  ").slice(0, contentW);

  return (
    <Box flexDirection="column" width={width}>
      <Box>
        <Text color={accent}>┃ </Text>
        <Text color={C.accent}>{idStr}</Text>
        <Text>{" ".repeat(idPad)}</Text>
        {badge && <Text color={C.dim}>{badge}</Text>}
      </Box>
      <Box>
        <Text color={accent}>┃ </Text>
        <Text color={C.text} bold={column === "doing"}>
          {subjectStr.padEnd(contentW).slice(0, contentW)}
        </Text>
      </Box>
      <Box>
        <Text color={accent}>┃ </Text>
        <Text color={task.blockedBy ? C.error : C.dim}>
          {metaStr.padEnd(contentW).slice(0, contentW)}
        </Text>
      </Box>
    </Box>
  );
}

// ─── KanbanHeader ────────────────────────────────────────────

function KanbanHeader({
  counts,
  activeCols,
  colWidths,
  labelW,
  isSwimLane,
}: {
  counts: Record<KanbanColumn, number>;
  activeCols: KanbanColumn[];
  colWidths: number[];
  labelW: number;
  isSwimLane: boolean;
}) {
  return (
    <Box>
      {isSwimLane && (
        <>
          <Text color={C.subtext} bold>{"PROJECTS".padEnd(labelW)}</Text>
          <Text color={C.dim}>│ </Text>
        </>
      )}
      {activeCols.map((col, i) => {
        const cfg = COLUMN_CONFIG[col];
        const w = colWidths[i];
        const countStr = String(counts[col]).padStart(3);
        const labelStr = cfg.label.padEnd(Math.max(0, w - 6));
        return (
          <React.Fragment key={col}>
            {i > 0 && <Text color={C.dim}>│ </Text>}
            <Text color={cfg.color} bold={cfg.bold}>{labelStr}</Text>
            <Text color={C.dim}>{countStr}  </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
}

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
            {/* Separator */}
            <Box>
              <Text color={C.dim}>
                {"─".repeat(labelW)}┼{activeCols.map((_, i) => "─".repeat(colWidths[i])).join("┼")}
              </Text>
            </Box>

            {/* 1 row per task slot */}
            {Array.from({ length: maxRows }, (_, ri) => {
              // Left label: row 0 = name, row 1 = branch, row 2 = agents
              let leftText = "";
              let leftColor = C.text;
              if (ri === 0) {
                leftText = project.name.length > labelW - 1
                  ? project.name.slice(0, labelW - 2) + "…"
                  : project.name;
                leftColor = isActive ? C.success : C.subtext;
              } else if (ri === 1) {
                leftText = `⎇ ${project.branch}`;
                leftColor = C.accent;
              } else if (ri === 2 && project.agentDetails.length > 0) {
                const running = project.agentDetails.filter((a) => a.processState === "running").length;
                leftText = `${running}/${project.agentDetails.length} agents`;
                leftColor = C.dim;
              }

              return (
                <Box key={ri}>
                  <Text color={leftColor} bold={ri === 0}>
                    {leftText.padEnd(labelW).slice(0, labelW)}
                  </Text>
                  <Text color={C.dim}>│ </Text>
                  {activeCols.map((col, ci) => {
                    const task = buckets[col][ri];
                    return (
                      <React.Fragment key={col}>
                        {ci > 0 && <Text color={C.dim}>│ </Text>}
                        {task ? (
                          <CompactCard task={task} column={col} width={colWidths[ci]} />
                        ) : (
                          <Text>{" ".repeat(colWidths[ci])}</Text>
                        )}
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
        const name = group.project.name.slice(0, w - 4);
        const dashW = Math.max(1, Math.floor((w - name.length - 2) / 2));
        elements.push(
          <Text key={`hdr-${group.project.projectPath}-${col}`} color={C.dim}>
            {"─".repeat(dashW)} {name} {"─".repeat(dashW)}
          </Text>
        );
      }
      for (const task of group.tasks) {
        const key = `${group.project.projectPath}-${task.id}-${col}`;
        if (isDone) {
          // DONE tasks: always compact 1-line
          elements.push(
            <CompactCard key={key} task={task} column={col} width={w} />
          );
        } else {
          // Active tasks: rich 3-line card
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
  const separatorW = numCols - 1; // "│" between columns

  // Responsive column widths (computed for activeCols only)
  let labelW = 0;
  let colWidths: number[];

  if (layout === "swimlane") {
    labelW = Math.max(12, Math.floor(cols * 0.15));
    const available = cols - labelW - separatorW * 2 - 4; // "│ " per sep = 2 chars, panel padding = 4
    const perCol = Math.max(14, Math.floor(available / numCols));
    colWidths = activeCols.map(() => perCol);
  } else {
    const available = cols - separatorW - 4;
    const perCol = Math.max(14, Math.floor(available / numCols));
    colWidths = activeCols.map(() => perCol);
  }

  // Count tasks per column (always count all 4 for header display)
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
      <KanbanHeader
        counts={counts}
        activeCols={activeCols}
        colWidths={colWidths}
        labelW={labelW}
        isSwimLane={layout === "swimlane"}
      />

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
