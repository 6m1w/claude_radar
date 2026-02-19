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

import stringWidth from "string-width";
import { formatDwell, truncateToWidth, padEndToWidth } from "../utils.js";
import type { DisplayTask, ViewProject, RoadmapSection } from "../types.js";

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
// Idle agent downgrade: in_progress + idle/dead agent → "todo" (not "doing")
function classifyTask(task: DisplayTask, project: ViewProject): KanbanColumn {
  if (task.status === "completed") return "done";
  if (task.blockedBy) return "needs_input";
  if (task.status === "in_progress") {
    // Check if owner's agent is actually running
    if (task.owner) {
      const agent = project.agentDetails.find((a) => a.name === task.owner);
      if (agent && agent.processState !== "running") return "todo";
    } else if (!project.isActive && project.activeSessions === 0) {
      // No running agent at all → downgrade
      return "todo";
    }
    return "doing";
  }
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

function Sep() {
  return <Text color={C.dim}>│ </Text>;
}

const SEP_W = 2; // display width of "│ "

// Pre-compute a section line: "│ title done/total" padded to exact width.
// Single string avoids nested <Text> width measurement issues in Ink.
function sectionLineStr(sec: RoadmapSection, totalW: number): string {
  const sep = "│ ";
  const suffix = ` ${sec.done}/${sec.total}`;
  const titleMaxW = Math.max(1, totalW - stringWidth(sep) - stringWidth(suffix));
  const title = truncateToWidth(sec.title, titleMaxW);
  return padEndToWidth(sep + title + suffix, totalW);
}

// ─── RoadmapSwimLane (L1 data — checkboxes from .md files) ───

function RoadmapSwimLane({
  projects,
  hideDone,
  colWidths,
  labelW,
  hiddenProjects,
  titleSuffix,
  totalTodo,
  totalDone,
  cursorIdx = 0,
  projectPathsRef,
  fileFilter,
}: {
  projects: ViewProject[];
  hideDone: boolean;
  colWidths: number[];
  labelW: number;
  hiddenProjects?: Set<string>;
  titleSuffix: string;
  totalTodo: number;
  totalDone: number;
  cursorIdx?: number;
  projectPathsRef?: React.MutableRefObject<string[]>;
  fileFilter?: string | null;
}) {
  // Deduplicate worktrees: keep one entry per repo group, propagate activity from worktrees
  const keptByParent = new Map<string, ViewProject>();
  const withRoadmap: ViewProject[] = [];
  for (const p of projects) {
    if (p.roadmap.length === 0 || !p.roadmap.some((r) => r.totalItems > 0)) continue;
    const parentKey = p.worktreeOf ?? p.projectPath;
    const existing = keptByParent.get(parentKey);
    if (existing) {
      // Propagate worktree activity to the kept entry
      if (p.isActive && !existing.isActive) existing.isActive = true;
      if (p.lastActivity > existing.lastActivity) existing.lastActivity = p.lastActivity;
      if (p.activeSessions > existing.activeSessions) existing.activeSessions = p.activeSessions;
    } else {
      keptByParent.set(parentKey, p);
      withRoadmap.push(p);
    }
  }
  // Preserve Dashboard sort order — projects arrive pre-sorted by tier/activity

  // Apply file filter: keep only projects that have the selected .md file
  const filtered = fileFilter
    ? withRoadmap.filter(p => p.roadmap.some(r => (r.source.split("/").pop() ?? r.source) === fileFilter))
    : withRoadmap;

  // Write effective project paths for Enter→Dashboard jump
  if (projectPathsRef) projectPathsRef.current = filtered.map(p => p.projectPath);
  const safeCursor = Math.max(0, Math.min(cursorIdx, Math.max(0, filtered.length - 1)));

  // Count projects with no roadmap data for the summary
  const allParentKeys = new Set(projects.map(p => p.worktreeOf ?? p.projectPath));
  const noRoadmapCount = allParentKeys.size - keptByParent.size;

  const fileLabel = fileFilter ? ` · ${fileFilter}` : "";

  if (filtered.length === 0) {
    return (
      <>
        <Text color={C.primary} bold>{`ROADMAP — 0 projects${fileLabel}${titleSuffix}`}</Text>
        <Text color={C.dim}>{fileFilter ? `No projects with ${fileFilter}` : "No roadmap data — add [ ] checkboxes to .md files"}</Text>
      </>
    );
  }

  return (
    <>
      <Text color={C.primary} bold>{`ROADMAP — ${filtered.length} project${filtered.length !== 1 ? "s" : ""}${fileLabel}${titleSuffix}`}</Text>
      {/* Header row — all cells padded to exact width */}
      <Box>
        <Box width={labelW} flexShrink={0}>
          <Text color={C.primary} bold>{padEndToWidth("PROJECTS", labelW)}</Text>
        </Box>
        <Sep />
        <Box width={colWidths[0]} flexShrink={0}>
          <Text>
            <Text color={C.accent} bold>{"TODO \u2610"}</Text>
            <Text color={C.dim}>{" ".repeat(Math.max(1, colWidths[0] - 7 - String(totalTodo).length))}{totalTodo}</Text>
          </Text>
        </Box>
        {!hideDone && (
          <>
            <Sep />
            <Box width={colWidths[1]} flexShrink={0}>
              <Text>
                <Text color={C.success}>{"DONE \u2611"}</Text>
                <Text color={C.dim}>{" ".repeat(Math.max(1, colWidths[1] - 7 - String(totalDone).length))}{totalDone}</Text>
              </Text>
            </Box>
          </>
        )}
      </Box>
      {filtered.flatMap((project, pi) => {
        const isHidden = hiddenProjects?.has(project.projectPath);
        const isCursor = pi === safeCursor;
        // Select roadmap file: respect filter, fall back to largest
        const primary = fileFilter
          ? (project.roadmap.find(r => (r.source.split("/").pop() ?? r.source) === fileFilter) ?? project.roadmap.reduce((best, r) => r.totalItems > best.totalItems ? r : best))
          : project.roadmap.reduce((best, r) => r.totalItems > best.totalItems ? r : best);
        // Section-level summaries: TODO = incomplete sections, DONE = complete sections
        const todoSections = primary.sections.filter((s) => s.total > 0 && s.done < s.total);
        const doneSections = primary.sections.filter((s) => s.total > 0 && s.done === s.total);

        // Skip projects with no visible sections (all done when hideDone is on)
        if (todoSections.length === 0 && (hideDone || doneSections.length === 0)) return [];

        const MAX_SECTIONS = 5;
        const todoVis = todoSections.slice(0, MAX_SECTIONS);
        const doneVis = hideDone ? [] : doneSections.slice(0, MAX_SECTIONS);
        const todoOverflow = Math.max(0, todoSections.length - MAX_SECTIONS);
        const doneOverflow = hideDone ? 0 : Math.max(0, doneSections.length - MAX_SECTIONS);
        // Per-row rendering with pre-computed single strings.
        // Avoids both nested <Text> garbling AND nested flex-column layout bugs.
        const todoLineCount = todoVis.length + (todoOverflow > 0 ? 1 : 0);
        const doneLineCount = hideDone ? 0 : (doneVis.length + (doneOverflow > 0 ? 1 : 0));
        const rowH = Math.max(2, todoLineCount, doneLineCount);
        const todoW = SEP_W + colWidths[0];
        const doneW = colWidths.length > 1 ? SEP_W + colWidths[1] : 0;

        // Left column data
        const icon = isCursor ? "\u25b8" : project.isActive ? "\u25cf" : "\u25cb"; // ▸ cursor, ● active, ○ idle
        const nameColor = isCursor ? C.primary : isHidden ? C.subtext : project.isActive ? C.warning : C.text;
        const basename = primary.source.split("/").pop() ?? primary.source;
        const sourceColor = isHidden ? C.dim : C.subtext;
        const nameStr = padEndToWidth(truncateToWidth(icon + " " + project.name, labelW), labelW);
        const sourceStr = padEndToWidth(truncateToWidth(`${basename} ${primary.totalDone}/${primary.totalItems}`, labelW), labelW);
        const emptyLeft = " ".repeat(labelW);

        return [(
          <Box key={project.projectPath} flexDirection="column">
            {/* Horizontal divider */}
            <Text color={C.dim}>
              {"─".repeat(labelW)}
              {"┼" + "─".repeat(colWidths[0] + 1)}
              {!hideDone && "┼" + "─".repeat(colWidths[1] + 1)}
            </Text>

            {/* Rows — each row is a simple horizontal <Box>, no nested flex columns */}
            {Array.from({ length: rowH }, (_, ri) => {
              // Left: row 0 = name, row 1 = source, row 2+ = empty
              const leftStr = ri === 0 ? nameStr : ri === 1 ? sourceStr : emptyLeft;
              const leftColor = ri === 0 ? nameColor : ri === 1 ? sourceColor : C.dim;

              // TODO column: section line or overflow or filler
              const todoSec = todoVis[ri];
              const isTodoOverflow = !todoSec && ri === todoVis.length && todoOverflow > 0;
              const todoStr = todoSec
                ? sectionLineStr(todoSec, todoW)
                : isTodoOverflow
                  ? padEndToWidth(`│ +${todoOverflow} more sections`, todoW)
                  : padEndToWidth("│ ", todoW);
              const todoColor = todoSec ? C.text : C.dim;

              // DONE column (if visible)
              let doneStr = "";
              let doneColor = C.dim;
              if (!hideDone) {
                const doneSec = doneVis[ri];
                const isDoneOverflow = !doneSec && ri === doneVis.length && doneOverflow > 0;
                doneStr = doneSec
                  ? sectionLineStr(doneSec, doneW)
                  : isDoneOverflow
                    ? padEndToWidth(`│ +${doneOverflow} more sections`, doneW)
                    : padEndToWidth("│ ", doneW);
                if (doneSec) doneColor = C.dim; // done sections are always dim
              }

              return (
                <Box key={ri}>
                  <Box width={labelW} flexShrink={0}>
                    <Text bold={ri === 0} color={leftColor}>{leftStr}</Text>
                  </Box>
                  <Box width={todoW} flexShrink={0}>
                    <Text color={todoColor}>{todoStr}</Text>
                  </Box>
                  {!hideDone && (
                    <Box width={doneW} flexShrink={0}>
                      <Text color={doneColor}>{doneStr}</Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )];
      })}

      {/* No-roadmap summary */}
      {noRoadmapCount > 0 && (
        <Text color={C.dim}>
          {"─".repeat(labelW)}── {noRoadmapCount} project{noRoadmapCount !== 1 ? "s" : ""} · no roadmap ──
        </Text>
      )}
    </>
  );
}

// ─── By Agent Layout (Agent → Project → Tasks hierarchy) ─────

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
        color={column === "done" ? C.dim : C.text}
        strikethrough={column === "done"}
      >
        {idPrefix}{task.subject}
      </Text>
      {task.blockedBy && <Text color={C.error}> {I.blocked}#{task.blockedBy}</Text>}
      {column !== "done" && dwell && <Text color={C.dim}> {dwell}</Text>}
    </Text>
  );
}

// Internal types for project-first grouping
type TaggedTask = { task: DisplayTask; col: KanbanColumn };
type ProjectBlock = {
  project: ViewProject;
  tasks: TaggedTask[];
  goneCount: number;
  sessionLabel: string | undefined;
  isActive: boolean;
};

function ByAgentLayout({
  projects,
  hideDone,
  cursorIdx = 0,
  viewportHeight,
  hiddenProjects,
  titleSuffix,
  projectPathsRef,
}: {
  projects: ViewProject[];
  hideDone: boolean;
  cursorIdx?: number;
  viewportHeight?: number;
  hiddenProjects?: Set<string>;
  titleSuffix: string;
  projectPathsRef?: React.MutableRefObject<string[]>;
}) {
  if (projects.length === 0) {
    return (
      <>
        <Text color={C.primary} bold>{`TASKS — 0 projects${titleSuffix}`}</Text>
        <Text color={C.dim}>No projects</Text>
      </>
    );
  }

  const MAX_TASKS = 5;

  // Build flat project blocks (project-first grouping)
  const pBlocks: ProjectBlock[] = [];
  const includedPaths = new Set<string>();
  for (const project of projects) {
    // Skip worktree projects with no tasks AND no active sessions
    if (project.worktreeOf && project.tasks.length === 0 && project.activeSessions === 0 && project.hookSessionCount === 0) continue;

    const buckets = buildBuckets(project);
    const tasks: TaggedTask[] = [];
    let goneCount = 0;
    const colEntries: [KanbanColumn, DisplayTask[]][] = [
      ["needs_input", buckets.needs_input],
      ["doing", buckets.doing],
      ["todo", buckets.todo],
    ];
    if (!hideDone && buckets.done.length > 0) {
      colEntries.push(["done", buckets.done.slice(0, 5)]);
    }
    for (const [col, colTasks] of colEntries) {
      for (const task of colTasks) {
        if (task.gone) { goneCount++; } else { tasks.push({ task, col }); }
      }
    }

    const isActive = project.isActive || project.activeSessions > 0 || project.hookSessionCount > 0;
    // Include if has tasks, archived, or active sessions
    if (tasks.length > 0 || goneCount > 0 || isActive) {
      pBlocks.push({ project, tasks, goneCount, sessionLabel: project.bestSessionName, isActive });
      includedPaths.add(project.projectPath);
    }
  }

  // Preserve Dashboard sort order — projects arrive pre-sorted by tier/activity

  // Write effective project paths for Enter→Dashboard jump
  if (projectPathsRef) projectPathsRef.current = pBlocks.map(b => b.project.projectPath);

  if (pBlocks.length === 0 && projects.length === 0) {
    return <Text color={C.dim}>No projects</Text>;
  }

  const safeCursor = Math.max(0, Math.min(cursorIdx, Math.max(0, pBlocks.length - 1)));

  // Pre-compute line height per project block for scroll math
  type ScrollBlock = { pb: ProjectBlock; height: number };
  const blocks: ScrollBlock[] = pBlocks.map((pb) => {
    let h = 1; // project header line
    const isTaskless = pb.tasks.length === 0 && pb.goneCount === 0;
    if (isTaskless) { h += 1; } // "N active sessions · no tasks"
    else {
      h += Math.min(pb.tasks.length, MAX_TASKS);
      if (pb.tasks.length > MAX_TASKS) h += 1; // overflow
      if (pb.goneCount > 0) h += 1; // archived
    }
    return { pb, height: h };
  });

  // Compute visible range: ensure safeCursor is in viewport
  let scrollStart = 0;
  if (viewportHeight) {
    while (scrollStart < safeCursor) {
      let h = 0;
      for (let i = scrollStart; i <= safeCursor; i++) {
        h += blocks[i].height + (i > scrollStart ? 1 : 0);
      }
      if (h <= viewportHeight) break;
      scrollStart++;
    }
  }

  let visibleEnd = blocks.length;
  if (viewportHeight) {
    let h = 0;
    for (let i = scrollStart; i < blocks.length; i++) {
      const bH = blocks[i].height + (i > scrollStart ? 1 : 0);
      if (h + bH > viewportHeight) { visibleEnd = i; break; }
      h += bH;
    }
  }

  const aboveCount = scrollStart;
  const belowCount = blocks.length - visibleEnd;

  // Count projects not included in blocks (no tasks, no sessions)
  const emptyCount = projects.filter(p =>
    !includedPaths.has(p.projectPath) &&
    !(p.worktreeOf && p.tasks.length === 0 && p.activeSessions === 0 && p.hookSessionCount === 0)
  ).length;

  return (
    <Box flexDirection="column">
      <Text color={C.primary} bold>{`TASKS — ${pBlocks.length} project${pBlocks.length !== 1 ? "s" : ""}${titleSuffix}`}</Text>
      {aboveCount > 0 && <Text color={C.dim}>  ▲ {aboveCount} above</Text>}

      {blocks.slice(scrollStart, visibleEnd).map(({ pb }, vi) => {
        const gi = scrollStart + vi;
        const isCursor = gi === safeCursor;
        const isHidden = hiddenProjects?.has(pb.project.projectPath);
        const isTaskless = pb.tasks.length === 0 && pb.goneCount === 0;

        // Project icon + color based on activity state
        const icon = pb.isActive ? "\u25cf" : "\u25cb"; // ● active, ○ idle
        const iconColor = isHidden ? C.dim : pb.isActive ? C.warning : C.dim;

        const visibleTasks = pb.tasks.slice(0, MAX_TASKS);
        const overflow = Math.max(0, pb.tasks.length - MAX_TASKS);

        return (
          <Box key={pb.project.projectPath} flexDirection="column">
            {vi > 0 && <Box height={1} />}

            {/* Project header: {icon} {name}  {sessionLabel}  ...  {count} */}
            <Box>
              <Text wrap="truncate">
                <Text color={isCursor ? C.primary : iconColor}>{isCursor ? "\u25b8" : icon} </Text>
                <Text color={isHidden ? C.dim : isCursor ? C.primary : C.text} bold={isCursor}>{pb.project.name}</Text>
                {pb.sessionLabel && <Text color={C.dim}>{"  "}{pb.sessionLabel}</Text>}
              </Text>
              <Box flexGrow={1} />
              <Text color={C.dim}>{pb.tasks.length}</Text>
            </Box>

            {/* Taskless active project indicator */}
            {isTaskless && pb.isActive && (
              <Text wrap="truncate" color={C.dim}>
                {"  "}{pb.project.activeSessions} active session{pb.project.activeSessions !== 1 ? "s" : ""} · no tasks
              </Text>
            )}

            {/* Tasks indented under project */}
            {visibleTasks.map(({ task, col }, ti) => (
              <Text key={`${task.id}-${ti}`} wrap="truncate">
                {"  "}<AgentTaskCard task={task} column={col} />
              </Text>
            ))}
            {overflow > 0 && (
              <Text wrap="truncate" color={C.dim}>{"  "}+{overflow} more</Text>
            )}
            {pb.goneCount > 0 && (
              <Text wrap="truncate" color={C.dim}>{"  "}▸ {pb.goneCount} archived</Text>
            )}
          </Box>
        );
      })}

      {belowCount > 0 && <Text color={C.dim}>  ▼ {belowCount} below</Text>}

      {/* Empty-state summary: projects with no tasks and no sessions */}
      {emptyCount > 0 && (
        <Text color={C.dim}>
          {"  "}── {emptyCount} project{emptyCount !== 1 ? "s" : ""} · no tasks ──
        </Text>
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
  hiddenProjects,
  projectPathsRef,
  fileFilter,
}: {
  projects: ViewProject[];
  selectedCount: number;
  layout: "swimlane" | "by_agent";
  hideDone: boolean;
  cursorIdx?: number;
  hiddenProjects?: Set<string>;
  projectPathsRef?: React.MutableRefObject<string[]>;
  fileFilter?: string | null;
}) {
  const stdout = useStdout();
  const cols = stdout.stdout?.columns ?? 120;
  const rows = stdout.stdout?.rows ?? 40;

  // No outer border (Rule 8) — only paddingX(1) each side
  const contentW = cols - 2;
  // Viewport: terminal rows - statusBar - title(1) - rowA(1)
  // TASKS view hides metrics line → statusBar is 1 row instead of 2
  const statusBarH = layout === "by_agent" ? 1 : 2;
  const viewportHeight = rows - statusBarH - 2;

  const filterLabel = selectedCount > 0 ? ` (${selectedCount} selected)` : "";
  const hideLabel = hideDone ? " \u229ADONE" : "";
  const titleSuffix = `${filterLabel}${hideLabel}`;

  if (layout === "by_agent") {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <ByAgentLayout projects={projects} hideDone={hideDone} cursorIdx={cursorIdx} viewportHeight={viewportHeight} hiddenProjects={hiddenProjects} titleSuffix={titleSuffix} projectPathsRef={projectPathsRef} />
      </Box>
    );
  }

  // ─── Swimlane layout — L1 roadmap data, 2 columns (TODO/DONE) ──
  const numCols = hideDone ? 1 : 2;

  const labelW = Math.min(26, Math.max(18, Math.floor(contentW * 0.25)));
  const colAvail = contentW - labelW - numCols * SEP_W;
  const perCol = Math.max(12, Math.floor(colAvail / numCols));
  const colWidths = Array.from({ length: numCols }, () => perCol);

  // Count L1 items across all projects
  let totalTodo = 0;
  let totalDone = 0;
  for (const p of projects) {
    for (const r of p.roadmap) {
      totalDone += r.totalDone;
      totalTodo += r.totalItems - r.totalDone;
    }
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <RoadmapSwimLane
        projects={projects}
        hideDone={hideDone}
        colWidths={colWidths}
        labelW={labelW}
        hiddenProjects={hiddenProjects}
        titleSuffix={titleSuffix}
        totalTodo={totalTodo}
        totalDone={totalDone}
        cursorIdx={cursorIdx}
        projectPathsRef={projectPathsRef}
        fileFilter={fileFilter}
      />
    </Box>
  );
}
