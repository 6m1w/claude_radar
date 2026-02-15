/**
 * Claude Radar — Master-Detail + Lazy Kanban TUI
 *
 * Connected to real data via useWatchSessions() hook.
 * Shows actual projects, tasks, and sessions from ~/.claude/
 */
import React, { useState } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { C, I } from "./theme.js";
import { Panel } from "./components/panel.js";
import { Progress } from "./components/progress.js";
import { useWatchSessions } from "./watchers/use-watch.js";
import { useMetrics } from "./hooks/use-metrics.js";
import type { MergedProjectData, TaskItem, TodoItem, SessionHistoryEntry, AgentInfo, TeamConfig, ActivityEvent, DisplayTask, ViewProject } from "./types.js";
import { formatDwell, formatRelativeTime } from "./utils.js";
import { KanbanView } from "./components/kanban.js";
import { RoadmapPanel } from "./components/roadmap-panel.js";

// ─── Adapter: MergedProjectData → ViewProject ───────────────
function toViewProject(p: MergedProjectData): ViewProject {
  const allItems = p.sessions.flatMap((s) => s.items);

  const tasks = allItems.map((item, i): DisplayTask => {
    const gone = !!item._gone;
    if ("subject" in item) {
      // TaskItem — has id, subject, owner, blockedBy
      const t = item as TaskItem;
      // Dynamic dependency resolution: only show blockers that aren't completed
      const unresolved = t.blockedBy?.filter((id) => {
        const blocker = allItems.find((it) => "id" in it && (it as TaskItem).id === id);
        return !blocker || blocker.status !== "completed";
      });
      return {
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner,
        blockedBy: unresolved?.length ? unresolved[0] : undefined,
        description: t.description,
        gone,
        statusChangedAt: item._statusChangedAt,
      };
    }
    // TodoItem — synthesize id from index, use content as subject
    const todo = item as TodoItem;
    return {
      id: String(i + 1),
      subject: todo.content,
      status: todo.status,
      gone,
      statusChangedAt: item._statusChangedAt,
    };
  });

  return {
    name: p.projectName,
    projectPath: p.projectPath,
    branch: p.git?.branch ?? p.gitBranch ?? "main",
    agents: p.agents,
    activeSessions: p.activeSessions,
    hookSessionCount: p.hookSessions.length,
    docs: p.docs,
    tasks,
    recentSessions: p.recentSessions,
    goneSessionCount: p.goneSessionCount,
    agentDetails: p.agentDetails,
    worktreeOf: p.git?.worktreeOf,
    team: p.team,
    gitLog: p.gitLog,
    docContents: p.docContents,
    lastActivity: p.lastActivity,
    isActive: p.isActive,
    planningLog: p.planningLog,
    activityLog: p.activityLog,
    activityAlerts: p.activityAlerts,
    roadmap: p.roadmap,
  };
}

// ─── Helper functions ───────────────────────────────────────

// Tool name → color for activity feed quick scanning
function activityColor(toolName: string, isError: boolean): string {
  if (isError) return C.error;
  if (toolName === "Write" || toolName === "Edit") return C.accent;
  if (toolName === "Bash") return C.warning;
  if (toolName === "TaskCreate" || toolName === "TaskUpdate") return C.primary;
  return C.subtext;
}

function taskStats(p: ViewProject) {
  const live = p.tasks.filter((t) => !t.gone);
  const total = live.length;
  const done = live.filter((t) => t.status === "completed").length;
  const doing = live.filter((t) => t.status === "in_progress").length;
  const goneCount = p.tasks.length - live.length;
  return { total, done, doing, goneCount };
}

// ─── View state ─────────────────────────────────────────────
type View = "dashboard" | "agent" | "roadmap";
type BottomTab = "docs" | "git" | "sessions";

export function App() {
  const { exit } = useApp();
  const stdout = useStdout();
  const rows = stdout.stdout?.rows ?? 40;
  const { projects: rawProjects } = useWatchSessions();
  const [view, setView] = useState<View>("dashboard");
  const [innerFocus, setInnerFocus] = useState(false);
  const [projectIdx, setProjectIdx] = useState(0);
  const [taskIdx, setTaskIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());

  // Bottom tabbed panel state
  const [bottomTab, setBottomTab] = useState<BottomTab>("git");
  const [bottomDocIdx, setBottomDocIdx] = useState(0);
  const [bottomScrollY, setBottomScrollY] = useState(0);
  const [bottomFocused, setBottomFocused] = useState(false);

  // Kanban state (shared across agent/swimlane views)
  const [kanbanHideDone, setKanbanHideDone] = useState(true);

  // Convert real data → view model, group worktrees with their main repo
  const viewProjects = rawProjects.map(toViewProject);
  const sorted = (() => {
    // Phase 1: Group projects — main repo + its worktrees share a group key
    const groupMap = new Map<string, ViewProject[]>();
    for (const p of viewProjects) {
      const groupKey = p.worktreeOf ?? p.projectPath;
      const group = groupMap.get(groupKey) ?? [];
      group.push(p);
      groupMap.set(groupKey, group);
    }

    // Phase 2: Sort within each group — main repo first, then worktrees by activity
    for (const [, group] of groupMap) {
      group.sort((a, b) => {
        if (!a.worktreeOf && b.worktreeOf) return -1;
        if (a.worktreeOf && !b.worktreeOf) return 1;
        return b.lastActivity.getTime() - a.lastActivity.getTime();
      });
    }

    // Phase 3: Sort groups with tiered decay
    // Tier 0: live sessions / recent in_progress (isActive from scanner)
    // Tier 1: activity within 1 hour
    // Tier 2: activity within 24 hours
    // Tier 3: stale (>24h) — sort by lastActivity desc
    // Within tier 3, no pending-task boost: stale in_progress tasks are effectively dead
    const now = Date.now();
    const HOUR = 3_600_000;
    const DAY = 86_400_000;
    const groupTier = (group: ViewProject[]): number => {
      if (group.some((p) => p.isActive)) return 0;
      const maxAge = Math.min(...group.map((p) => now - p.lastActivity.getTime()));
      if (maxAge < HOUR) return 1;
      if (maxAge < DAY) return 2;
      return 3;
    };
    const groupEntries = [...groupMap.entries()].sort(([, a], [, b]) => {
      const tierDiff = groupTier(a) - groupTier(b);
      if (tierDiff !== 0) return tierDiff;
      const aMax = Math.max(...a.map((p) => p.lastActivity.getTime()));
      const bMax = Math.max(...b.map((p) => p.lastActivity.getTime()));
      return bMax - aMax;
    });

    return groupEntries.flatMap(([, group]) => group);
  })();

  const current = sorted[projectIdx];
  const currentTasks = current?.tasks ?? [];

  // Layout calculation
  // Ink flex handles borders internally — only count truly fixed-height elements
  const termRows = rows;
  const ROADMAP_HEIGHT = 7;
  const overhead = 1 + 2 + 2; // paddingBottom(1) + rowA(2) + statusBar(2)
  const panelChrome = 3;       // each Panel eats: border(2) + title line(1)

  // Bottom panel: always 1/4 of terminal (min 6)
  const bottomHeight = Math.max(6, Math.floor(termRows / 4));
  // Row B (middle section) gets everything else
  const rowBHeight = termRows - overhead - bottomHeight;
  // Try fitting roadmap: need at least 3 visible projects
  const projectsWithRoadmap = rowBHeight - ROADMAP_HEIGHT - panelChrome;
  const showRoadmap = projectsWithRoadmap >= 3;
  const visibleProjects = showRoadmap
    ? Math.max(3, projectsWithRoadmap)
    : Math.max(3, rowBHeight - panelChrome);

  // Viewport scrolling
  const safeProjectIdx = Math.min(projectIdx, Math.max(0, sorted.length - 1));
  const ensureVisible = (idx: number) => {
    let offset = scrollOffset;
    if (idx < offset) offset = idx;
    if (idx >= offset + visibleProjects) offset = idx - visibleProjects + 1;
    return Math.max(0, Math.min(offset, sorted.length - visibleProjects));
  };

  // Helper: switch bottom tab with scroll reset
  const switchBottomTab = (tab: BottomTab) => {
    setBottomTab(tab);
    setBottomScrollY(0);
    if (tab === "docs") setBottomDocIdx(0);
  };

  useInput((input, key) => {
    if (input === "q") exit();

    // Tab → cycle views: dashboard → agent → swimlane → dashboard
    if (key.tab) {
      const cycle: View[] = ["dashboard", "agent", "roadmap"];
      const idx = cycle.indexOf(view);
      setView(cycle[(idx + 1) % cycle.length]);
      setInnerFocus(false);
      setBottomFocused(false);
      return;
    }

    // Agent / Swimlane views
    if (view === "agent" || view === "roadmap") {
      if (key.escape) { setView("dashboard"); return; }
      if (input === "h") setKanbanHideDone((h) => !h);
      return;
    }

    // Dashboard view
    if (view === "dashboard") {
      if (bottomFocused) {
        // Bottom panel focused: j/k scroll, h/l switch doc files, d/g/s switch tabs
        if (key.escape) { setBottomFocused(false); return; }
        if (input === "j" || key.downArrow) setBottomScrollY((y) => y + 1);
        if (input === "k" || key.upArrow) setBottomScrollY((y) => Math.max(0, y - 1));
        if (input === "d") switchBottomTab("docs");
        if (input === "g") switchBottomTab("git");
        if (input === "s") switchBottomTab("sessions");
        if (bottomTab === "docs" && current) {
          const docKeys = Object.keys(current.docContents);
          if (input === "h" || key.leftArrow) {
            setBottomDocIdx((i) => Math.max(0, i - 1));
            setBottomScrollY(0);
          }
          if (input === "l" || key.rightArrow) {
            setBottomDocIdx((i) => Math.min(docKeys.length - 1, i + 1));
            setBottomScrollY(0);
          }
        }
        return;
      }

      if (innerFocus) {
        // Inner focus: task navigation
        if (key.escape) { setInnerFocus(false); return; }
        if ((input === "j" || key.downArrow) && taskIdx < currentTasks.length - 1) {
          setTaskIdx((i) => i + 1);
        }
        if ((input === "k" || key.upArrow) && taskIdx > 0) {
          setTaskIdx((i) => i - 1);
        }
        if (input === "d") { switchBottomTab("docs"); setBottomFocused(true); }
        if (input === "g") { switchBottomTab("git"); setBottomFocused(true); }
        if (input === "s") { switchBottomTab("sessions"); setBottomFocused(true); }
        return;
      }

      // Outer focus: project navigation
      if ((input === "j" || key.downArrow) && projectIdx < sorted.length - 1) {
        const next = projectIdx + 1;
        setProjectIdx(next);
        setScrollOffset(ensureVisible(next));
        setTaskIdx(0);
      }
      if ((input === "k" || key.upArrow) && projectIdx > 0) {
        const next = projectIdx - 1;
        setProjectIdx(next);
        setScrollOffset(ensureVisible(next));
        setTaskIdx(0);
      }

      // Space → toggle multi-select for kanban
      if (input === " " && current) {
        setSelectedNames((prev) => {
          const next = new Set(prev);
          if (next.has(current.projectPath)) {
            next.delete(current.projectPath);
          } else {
            next.add(current.projectPath);
          }
          return next;
        });
      }

      // d/g/s → switch bottom tab + focus bottom
      if (input === "d") { switchBottomTab("docs"); setBottomFocused(true); }
      if (input === "g") { switchBottomTab("git"); setBottomFocused(true); }
      if (input === "s") { switchBottomTab("sessions"); setBottomFocused(true); }

      if (key.return && current) {
        setInnerFocus(true);
        setTaskIdx(0);
        setBottomFocused(false);
      }
    }
  });

  // Aggregate stats
  const totalProjects = sorted.length;
  const totalTasks = sorted.reduce((s, p) => s + p.tasks.length, 0);
  const totalDone = sorted.reduce((s, p) => s + taskStats(p).done, 0);
  const totalActive = sorted.filter((p) => p.isActive).length;

  const viewLabel = view === "agent" ? "AGENT"
    : view === "roadmap" ? "ROADMAP"
    : bottomFocused ? "BOTTOM"
    : innerFocus ? "DETAIL"
    : "DASHBOARD";

  if (view === "agent" || view === "roadmap") {
    // Filter: selected projects, or all with relevant data if none selected
    const kanbanProjects = selectedNames.size > 0
      ? sorted.filter((p) => selectedNames.has(p.projectPath) && (view === "roadmap" ? p.roadmap.length > 0 : p.tasks.length > 0))
      : view === "roadmap"
        ? sorted.filter((p) => p.roadmap.length > 0)
        : sorted.filter((p) => p.tasks.length > 0);
    return (
      <Box flexDirection="column" height={termRows} paddingBottom={1}>
        <KanbanView
          projects={kanbanProjects}
          selectedCount={selectedNames.size}
          layout={view === "agent" ? "by_agent" : "roadmap"}
          hideDone={kanbanHideDone}
        />
        <StatusBar view={view} label={viewLabel} hasActive={totalActive > 0} allDone={totalTasks > 0 && totalDone === totalTasks} bottomFocused={false} hideDone={kanbanHideDone} />
      </Box>
    );
  }

  // Visible slice of projects
  const visSlice = sorted.slice(scrollOffset, scrollOffset + visibleProjects);
  const aboveCount = scrollOffset;
  const belowCount = Math.max(0, sorted.length - scrollOffset - visibleProjects);

  // Active agents summary for Row A
  const activeProjects = sorted.filter((p) => p.isActive);

  return (
    <Box flexDirection="column" height={termRows} paddingBottom={1}>
      {/* Row A: Compressed overview bar */}
      <Box paddingX={1} height={2}>
        <Text wrap="truncate">
          <Text color={C.text} bold>{String(totalProjects)}</Text>
          <Text color={C.subtext}> projects  </Text>
          <Text color={totalActive > 0 ? C.warning : C.text} bold>{String(totalActive)}</Text>
          <Text color={C.subtext}> active  </Text>
          <Text color={C.text} bold>{String(totalTasks)}</Text>
          <Text color={C.subtext}> tasks  </Text>
          {totalTasks > 0 && <Progress done={totalDone} total={totalTasks} width={12} />}
          {/* Active project summaries */}
          {activeProjects.length > 0 && (
            <>
              <Text color={C.dim}>  │ </Text>
              {activeProjects.slice(0, 3).map((p, i) => {
                const doing = p.tasks.find((t) => t.status === "in_progress");
                const name = p.name.length > 16 ? p.name.slice(0, 15) + "…" : p.name;
                return (
                  <Text key={i}>
                    {i > 0 && <Text color={C.dim}> </Text>}
                    <Text color={C.warning}>{I.working}</Text>
                    <Text color={C.subtext}>{name}</Text>
                    {doing && <Text color={C.text}> #{doing.id}</Text>}
                  </Text>
                );
              })}
              {activeProjects.length > 3 && (
                <Text color={C.dim}> +{activeProjects.length - 3}</Text>
              )}
            </>
          )}
          {activeProjects.length === 0 && totalProjects > 0 && (
            <Text color={C.dim}>  │  all idle</Text>
          )}
        </Text>
      </Box>

      {/* Row B: Projects + Tasks — fills remaining space */}
      <Box flexGrow={1}>
        {/* Left column: Project list + Roadmap panel */}
        <Box flexDirection="column" width={34}>
          <Panel title={`PROJECTS (${sorted.length})`} flexGrow={1}>
            {aboveCount > 0 && (
              <Text color={C.dim}>  ▲ {aboveCount} more</Text>
            )}
            {visSlice.map((p, vi) => {
              const realIdx = scrollOffset + vi;
              const isCursor = realIdx === safeProjectIdx;
              const stats = taskStats(p);
              const isActive = p.isActive;
              const icon = isActive ? I.working : stats.total > 0 && stats.done === stats.total ? I.done : I.idle;
              const iconColor = isActive ? C.warning : stats.done === stats.total && stats.total > 0 ? C.success : C.dim;
              const isSelected = selectedNames.has(p.projectPath);
              const isWorktree = !!p.worktreeOf;
              // Check if this is the last worktree in a consecutive group
              const nextP = visSlice[vi + 1];
              const isLastWorktree = isWorktree && (!nextP || !nextP.worktreeOf || nextP.worktreeOf !== p.worktreeOf);
              const treePrefix = isWorktree ? (isLastWorktree ? "└" : "├") : " ";
              // Truncate name to fit within panel (inner width ~30)
              const maxName = p.branch !== "main" ? 14 : 20;
              const displayName = p.name.length > maxName ? p.name.slice(0, maxName - 1) + "…" : p.name;
              return (
                <Text key={p.projectPath} wrap="truncate">
                  <Text color={isCursor ? C.primary : C.dim}>
                    {isCursor ? I.cursor : " "}
                  </Text>
                  <Text color={C.dim}>{treePrefix}</Text>
                  {/* Selection indicator (☑/☐) */}
                  {selectedNames.size > 0 && (
                    <Text color={isSelected ? C.success : C.dim}>
                      {isSelected ? "☑" : "☐"}{" "}
                    </Text>
                  )}
                  <Text color={iconColor}>{icon} </Text>
                  <Text color={isCursor ? C.text : C.subtext} bold={isCursor}>
                    {displayName}
                  </Text>
                  {p.branch !== "main" && (
                    <Text color={C.accent}> ⎇{p.branch.length > 12 ? p.branch.slice(0, 11) + "…" : p.branch}</Text>
                  )}
                  {p.agentDetails.length > 0 && (
                    <Text color={C.dim}>{" "}
                      {p.agentDetails.map((a) =>
                        a.processState === "running" ? `●` : a.processState === "idle" ? `○` : `✕`
                      ).join("")}
                    </Text>
                  )}
                </Text>
              );
            })}
            {belowCount > 0 && (
              <Text color={C.dim}>  ▼ {belowCount} more</Text>
            )}
          </Panel>
          {showRoadmap && <RoadmapPanel project={current} height={ROADMAP_HEIGHT} />}
        </Box>

        {/* Right: Tasks only (simplified — no tab switching) */}
        <RightPanel
          project={current}
          isInner={innerFocus}
          taskIdx={taskIdx}
          bottomFocused={bottomFocused}
        />
      </Box>

      {/* Row C: Bottom tabbed panel */}
      <BottomPanel
        project={current}
        tab={bottomTab}
        docIdx={bottomDocIdx}
        scrollY={bottomScrollY}
        focused={bottomFocused}
        height={bottomHeight}
      />

      <StatusBar
        view={view}
        label={viewLabel}
        hasActive={totalActive > 0}
        allDone={totalTasks > 0 && totalDone === totalTasks}
        bottomFocused={bottomFocused}
      />
    </Box>
  );
}

// ─── Right panel: tasks only (simplified) ────────────────────
function RightPanel({
  project,
  isInner,
  taskIdx,
  bottomFocused,
}: {
  project: ViewProject;
  isInner: boolean;
  taskIdx: number;
  bottomFocused: boolean;
}) {
  if (!project) {
    return (
      <Panel title="TASKS" flexGrow={1}>
        <Text color={C.dim}>Select a project</Text>
      </Panel>
    );
  }

  const stats = taskStats(project);
  const title = project.name.toUpperCase();

  return (
    <Panel title={title} flexGrow={1} focused={isInner && !bottomFocused}>
      {/* Worktree lineage — show parent project prominently */}
      {project.worktreeOf && (
        <Text wrap="truncate">
          <Text color={C.dim}>↳ </Text>
          <Text color={C.subtext}>{project.worktreeOf.split("/").pop()}</Text>
        </Text>
      )}
      {/* Project info header */}
      <Text wrap="truncate">
        <Text color={C.accent}>⎇ {project.branch} </Text>
        {project.team ? (
          <Text color={C.warning}>⚑ {project.team.teamName} </Text>
        ) : null}
        {project.agentDetails.length > 0 ? (
          <Text color={C.dim}>
            {project.agentDetails.map((a) => {
              const icon = a.processState === "running" ? I.active : a.processState === "idle" ? I.idle : "✕";
              return `${icon}${a.name}`;
            }).join(" ")}
          </Text>
        ) : project.agents.length > 0 ? (
          <Text color={C.dim}>{project.agents.length} agent{project.agents.length > 1 ? "s" : ""}</Text>
        ) : null}
      </Text>
      {/* Team member list with process states */}
      {project.team && project.agentDetails.length > 0 && (
        <Box>
          {project.agentDetails.map((a, i) => {
            const icon = a.processState === "running" ? I.active : a.processState === "idle" ? I.idle : "✕";
            const color = a.processState === "running" ? C.warning : a.processState === "idle" ? C.dim : C.error;
            return (
              <Text key={i} color={color}>
                {i > 0 ? "  " : ""}{icon} {a.name}{a.currentTaskId ? ` #${a.currentTaskId}` : ""}
              </Text>
            );
          })}
        </Box>
      )}
      {stats.total > 0 && (
        <Box>
          <Text color={C.subtext}>tasks: </Text>
          <Progress done={stats.done} total={stats.total} width={14} />
        </Box>
      )}

      {/* Alerts — pattern-detected issues */}
      {project.activityAlerts.length > 0 && (
        <>
          {project.activityAlerts.map((alert, i) => {
            const icon = alert.severity === "error" ? "▲" : "△";
            const color = alert.severity === "error" ? C.error : C.warning;
            return (
              <Text key={`alert-${i}`} wrap="truncate">
                <Text color={color}> {icon} </Text>
                <Text color={color}>{alert.message}</Text>
                <Text color={C.dim}> {formatRelativeTime(alert.ts)}</Text>
              </Text>
            );
          })}
        </>
      )}

      {/* Task list — grouped by agent for multi-agent projects, flat for single-agent */}
      {(() => {
        const liveTasks = project.tasks.filter((t) => !t.gone);
        const goneTasks = project.tasks.filter((t) => t.gone);
        const isMultiAgent = project.agents.length > 1;

        // Compute max ID width from live tasks only (gone tasks have their own alignment)
        const liveIdLen = liveTasks.length > 0
          ? Math.min(4, Math.max(...liveTasks.map((t) => t.id.length), 1))
          : 1;
        const goneIdLen = goneTasks.length > 0
          ? Math.min(4, Math.max(...goneTasks.map((t) => t.id.length), 1))
          : 1;

        const renderTask = (t: DisplayTask, idx: number, maxIdWidth: number) => {
          const isCursor = isInner && !bottomFocused && idx === taskIdx;
          const isGone = !!t.gone;
          const icon = t.status === "completed" ? I.done : t.status === "in_progress" ? I.working : I.idle;
          const iconColor = isGone ? C.dim
            : t.status === "completed" ? C.success
            : t.status === "in_progress" ? C.warning : C.dim;
          // Truncate long IDs and pad for alignment within group
          const displayId = t.id.length > maxIdWidth ? t.id.slice(0, maxIdWidth - 1) + "…" : t.id.padStart(maxIdWidth);
          return (
            <Text key={`${t.id}-${isGone ? "g" : "l"}`} wrap="truncate">
              <Text color={isCursor ? C.primary : C.dim}>
                {isCursor ? I.cursor : " "}{" "}
              </Text>
              <Text color={iconColor} dimColor={isGone}>{icon} </Text>
              <Text color={isGone ? C.dim : C.subtext} dimColor={isGone}>#{displayId} </Text>
              <Text
                color={isGone ? C.dim : t.status === "completed" ? C.dim : isCursor ? C.text : C.subtext}
                bold={!isGone && isCursor}
                dimColor={isGone}
                strikethrough={isGone || t.status === "completed"}
              >
                {t.subject}
              </Text>
              {!isGone && t.owner && <Text color={C.accent}> ({t.owner})</Text>}
              {!isGone && t.blockedBy && <Text color={C.error}> ⊘#{t.blockedBy}</Text>}
              {!isGone && t.status !== "completed" && t.statusChangedAt && (
                <Text color={C.dim}> ↑{formatDwell(t.statusChangedAt)}</Text>
              )}
            </Text>
          );
        };

        let elements: React.ReactNode[] = [];

        if (isMultiAgent) {
          const agents = [...new Set(liveTasks.map((t) => t.owner ?? "unassigned"))];
          let flatIdx = 0;
          for (const agent of agents) {
            const agentTasks = liveTasks.filter((t) => (t.owner ?? "unassigned") === agent);
            // Use real process state from scanner when available, fall back to task inference
            const detail = project.agentDetails.find((a) => a.name === agent);
            const processState = detail?.processState;
            const hasActive = agentTasks.some((t) => t.status === "in_progress");
            const hasBlocked = agentTasks.some((t) => t.blockedBy);
            const agentStatus = processState
              ? processState
              : hasBlocked ? "blocked" : hasActive ? "active" : "idle";
            const agentIcon = processState === "running" ? I.active
              : processState === "idle" ? I.idle
              : processState === "dead" ? "✕"
              : hasBlocked ? I.blocked : hasActive ? I.working : I.idle;
            const agentColor = agentStatus === "running" || agentStatus === "active" ? C.warning
              : agentStatus === "blocked" ? C.error
              : agentStatus === "dead" ? C.error
              : C.dim;
            elements.push(
              <Box key={agent} flexDirection="column">
                <Text color={agentColor}>  ── {agentIcon} {agent} ({agentStatus}) ──────────</Text>
                {agentTasks.map((t) => renderTask(t, flatIdx++, liveIdLen))}
              </Box>
            );
          }
        } else {
          elements = liveTasks.map((t, i) => renderTask(t, i, liveIdLen));
        }

        // Append gone tasks with separator (compact: no extra blank line)
        if (goneTasks.length > 0) {
          const goneStartIdx = liveTasks.length;
          elements.push(
            <Box key="gone-sep" flexDirection="column">
              <Text color={C.dim}> ── archived ──</Text>
              {goneTasks.slice(0, 4).map((t, i) => renderTask(t, goneStartIdx + i, goneIdLen))}
              {goneTasks.length > 4 && (
                <Text color={C.dim}>  ... +{goneTasks.length - 4} more</Text>
              )}
            </Box>
          );
        }

        return elements;
      })()}

      {/* Gone sessions summary */}
      {project.goneSessionCount > 0 && project.tasks.filter((t) => !t.gone).length === 0 && (
        <Text color={C.dim}>▸ {project.goneSessionCount} archived session{project.goneSessionCount > 1 ? "s" : ""}</Text>
      )}

      {/* Task detail (inner focus, selected task) */}
      {isInner && !bottomFocused && project.tasks[taskIdx] && !project.tasks[taskIdx].gone && (
        <>
          <Text> </Text>
          <Text color={C.dim}>─── Task Detail ─────────────────────</Text>
          <Box>
            <Text color={C.subtext}>status: </Text>
            <Text color={project.tasks[taskIdx].status === "in_progress" ? C.warning : project.tasks[taskIdx].status === "completed" ? C.success : C.dim}>
              {project.tasks[taskIdx].status}
            </Text>
            {project.tasks[taskIdx].owner && (
              <>
                <Text color={C.subtext}> │ owner: </Text>
                <Text color={C.accent}>{project.tasks[taskIdx].owner}</Text>
              </>
            )}
            {project.tasks[taskIdx].blockedBy && (
              <>
                <Text color={C.subtext}> │ blocked by: </Text>
                <Text color={C.error}>#{project.tasks[taskIdx].blockedBy}</Text>
              </>
            )}
            {project.tasks[taskIdx].statusChangedAt && (
              <>
                <Text color={C.subtext}> │ in status: </Text>
                <Text color={C.dim}>↑{formatDwell(project.tasks[taskIdx].statusChangedAt)}</Text>
              </>
            )}
          </Box>
          {project.tasks[taskIdx].description && (
            <Text color={C.subtext}>{project.tasks[taskIdx].description}</Text>
          )}
        </>
      )}

      {/* Planning log (L2) — agent planning events */}
      {project.planningLog.length > 0 && (
        <>
          <Text> </Text>
          <Text color={C.dim}>─── Planning ─────────────────────</Text>
          {project.planningLog.slice().reverse().slice(0, 4).map((evt, i) => (
            <Text key={`p-${i}`} wrap="truncate">
              <Text color={C.dim}>{formatRelativeTime(evt.ts).padStart(4)}</Text>
              <Text color={C.primary}>  {evt.summary}</Text>
            </Text>
          ))}
        </>
      )}

      {/* Activity feed (L3) — recent tool calls from hook events */}
      {project.activityLog.length > 0 && (
        <>
          <Text> </Text>
          <Text color={C.dim}>─── Activity ─────────────────────</Text>
          {project.activityLog
            .slice()
            .reverse()
            .slice(0, 8)
            .map((evt, i) => (
              <Text key={i} wrap="truncate">
                <Text color={evt.isError ? C.error : C.dim}>
                  {formatRelativeTime(evt.ts).padStart(4)}
                </Text>
                <Text color={C.dim}>  </Text>
                <Text color={activityColor(evt.toolName, !!evt.isError)}>
                  {evt.summary}
                </Text>
              </Text>
            ))}
        </>
      )}

      {/* Empty state */}
      {project.tasks.length === 0 && project.activityLog.length === 0 && (
        <Text color={C.dim}>No tasks (session-only project)</Text>
      )}
    </Panel>
  );
}

// ─── Bottom tabbed panel ─────────────────────────────────────

// Commit type → color mapping for git log
const COMMIT_TYPE_COLORS: Record<string, string> = {
  feat: C.success,
  fix: C.error,
  refactor: C.accent,
  docs: C.primary,
  test: C.warning,
  chore: C.dim,
  style: C.dim,
  perf: C.warning,
};

function BottomPanel({
  project,
  tab,
  docIdx,
  scrollY,
  focused,
  height,
}: {
  project: ViewProject;
  tab: BottomTab;
  docIdx: number;
  scrollY: number;
  focused: boolean;
  height: number;
}) {
  // Tab header with active indicator
  const tabItems: { key: BottomTab; label: string; hotkey: string }[] = [
    { key: "docs", label: "Docs", hotkey: "d" },
    { key: "git", label: "Git Log", hotkey: "g" },
    { key: "sessions", label: "Sessions", hotkey: "s" },
  ];

  const tabHeader = tabItems.map((t) => {
    const isActive = tab === t.key;
    return (
      <Text key={t.key}>
        <Text color={isActive ? C.primary : C.dim}>{isActive ? "[" : " "}</Text>
        <Text color={isActive ? C.primary : C.subtext} bold={isActive}>
          {t.hotkey}:{t.label}
        </Text>
        <Text color={isActive ? C.primary : C.dim}>{isActive ? "]" : " "}</Text>
        <Text>  </Text>
      </Text>
    );
  });

  // Content area: panel border(2) + tab header row(1) = 3 lines of chrome
  const contentHeight = Math.max(3, height - 3);

  return (
    <Panel title="" focused={focused} height={height}>
      <Box>{tabHeader}</Box>
      <Box flexDirection="column" height={contentHeight}>
        {tab === "docs" && (
          <DocsContent
            project={project}
            docIdx={docIdx}
            scrollY={scrollY}
            contentHeight={contentHeight}
          />
        )}
        {tab === "git" && (
          <GitLogContent
            project={project}
            scrollY={scrollY}
            contentHeight={contentHeight}
          />
        )}
        {tab === "sessions" && (
          <SessionsContent
            project={project}
            scrollY={scrollY}
            contentHeight={contentHeight}
          />
        )}
      </Box>
    </Panel>
  );
}

// ─── Docs tab content ───────────────────────────────────────
function DocsContent({
  project,
  docIdx,
  scrollY,
  contentHeight,
}: {
  project: ViewProject;
  docIdx: number;
  scrollY: number;
  contentHeight: number;
}) {
  if (!project) {
    return <Text color={C.dim}>Select a project to view docs</Text>;
  }

  const docKeys = Object.keys(project.docContents);
  if (docKeys.length === 0) {
    return <Text color={C.dim}>No docs detected in {project.name}</Text>;
  }

  const safeIdx = Math.min(docIdx, docKeys.length - 1);
  const activeDoc = docKeys[safeIdx];
  const content = project.docContents[activeDoc] ?? "";

  // File selector row
  const fileTabs = docKeys.map((name, i) => (
    <Text key={name}>
      <Text color={i === safeIdx ? C.primary : C.dim} bold={i === safeIdx}>
        {i === safeIdx ? "▸" : " "} {name}
      </Text>
      <Text>  </Text>
    </Text>
  ));

  // Basic markdown rendering: split into lines and apply styling
  const lines = content.split("\n");
  const visibleLines = lines.slice(scrollY, scrollY + contentHeight - 1);

  return (
    <>
      <Box>{fileTabs}</Box>
      {visibleLines.map((line, i) => {
        const lineNum = scrollY + i;
        // Heading detection
        if (line.startsWith("# ")) {
          return <Text key={lineNum} color={C.text} bold>{line}</Text>;
        }
        if (line.startsWith("## ") || line.startsWith("### ")) {
          return <Text key={lineNum} color={C.accent} bold>{line}</Text>;
        }
        // Checkbox detection
        if (line.match(/^\s*- \[x\]/i)) {
          return <Text key={lineNum} color={C.success}>{line}</Text>;
        }
        if (line.match(/^\s*- \[ \]/)) {
          return <Text key={lineNum} color={C.subtext}>{line}</Text>;
        }
        // Code block markers
        if (line.startsWith("```")) {
          return <Text key={lineNum} color={C.accent}>{line}</Text>;
        }
        // Default
        return <Text key={lineNum} color={C.subtext}>{line}</Text>;
      })}
      {scrollY + contentHeight - 1 < lines.length && (
        <Text color={C.dim}>  ▼ {lines.length - scrollY - contentHeight + 1} more lines</Text>
      )}
    </>
  );
}

// ─── Git Log tab content ────────────────────────────────────
function GitLogContent({
  project,
  scrollY,
  contentHeight,
}: {
  project: ViewProject;
  scrollY: number;
  contentHeight: number;
}) {
  // Always show selected project's git log
  const commits = project ? project.gitLog : [];

  if (commits.length === 0) {
    return <Text color={C.dim}>No git history for {project?.name ?? "project"}</Text>;
  }

  const visibleCommits = commits.slice(scrollY, scrollY + contentHeight);

  return (
    <>
      {visibleCommits.map((commit, i) => {
        const idx = scrollY + i;
        const typeColor = commit.type ? (COMMIT_TYPE_COLORS[commit.type] ?? C.subtext) : C.subtext;
        // Format date as relative
        const dateStr = formatCommitDate(commit.authorDate);
        const typeStr = commit.type ? commit.type.padEnd(9).slice(0, 9) : "".padEnd(9);

        return (
          <Text key={`${commit.hash}-${idx}`} wrap="truncate">
            <Text color={C.dim}>{dateStr.padEnd(8)}</Text>
            <Text color={C.accent}> {commit.hash} </Text>
            <Text color={typeColor} bold={!!commit.type}>{typeStr}</Text>
            <Text color={C.text}>{commit.subject.replace(/^(\w+)[:(]\s*/, "")}</Text>
          </Text>
        );
      })}
      {scrollY + contentHeight < commits.length && (
        <Text color={C.dim}>  ▼ {commits.length - scrollY - contentHeight} more commits</Text>
      )}
    </>
  );
}

// Format ISO date to short relative string
function formatCommitDate(isoDate: string): string {
  const elapsed = Date.now() - new Date(isoDate).getTime();
  if (elapsed < 0) return "now";
  const mins = Math.floor(elapsed / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// ─── Sessions tab content ───────────────────────────────────
function SessionsContent({
  project,
  scrollY,
  contentHeight,
}: {
  project: ViewProject;
  scrollY: number;
  contentHeight: number;
}) {
  if (!project) {
    return <Text color={C.dim}>Select a project to view sessions</Text>;
  }

  if (project.recentSessions.length === 0) {
    return <Text color={C.dim}>No session history for {project.name}</Text>;
  }

  const sessions = project.recentSessions;
  const visible = sessions.slice(scrollY, scrollY + contentHeight);

  return (
    <>
      <Text color={C.subtext}>⎇ {project.branch}  │  {sessions.length} session{sessions.length !== 1 ? "s" : ""}</Text>
      {visible.map((s, i) => (
        <Box key={scrollY + i}>
          <Text color={C.accent}>● </Text>
          <Text color={C.dim}>{s.sessionId.slice(0, 8)}  </Text>
          <Text color={C.text}>{s.summary ?? s.firstPrompt?.slice(0, 50) ?? "—"}</Text>
          {s.gitBranch && <Text color={C.dim}> ⎇{s.gitBranch}</Text>}
        </Box>
      ))}
      {scrollY + contentHeight < sessions.length && (
        <Text color={C.dim}>  ▼ {sessions.length - scrollY - contentHeight} more</Text>
      )}
    </>
  );
}

// ─── Status bar: system metrics + keyboard hints ────────────
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const SPARK = "▁▂▃▄▅▆▇█";
const MASCOT = { idle: "☻ zzZ", working: "☻⌨", done: "☻♪" };

function sparkline(values: number[], max = 100): string {
  return values
    .map((v) => SPARK[Math.max(0, Math.min(7, Math.floor((v / max) * 8)))])
    .join("");
}

function StatusBar({ view, label, hasActive, allDone, bottomFocused, hideDone }: {
  view: View; label: string; hasActive: boolean; allDone: boolean; bottomFocused: boolean; hideDone?: boolean;
}) {
  const metrics = useMetrics();
  const tick = metrics.tick;

  const mascotFrame = allDone ? MASCOT.done : hasActive ? MASCOT.working : MASCOT.idle;
  const spinnerChar = SPINNER[tick % SPINNER.length];
  const cpuSpark = sparkline(metrics.cpuHistory);
  const memBarLen = 8;
  const memFilled = Math.round((metrics.memPercent / 100) * memBarLen);
  const memBar = "█".repeat(memFilled) + "░".repeat(memBarLen - memFilled);
  const netUp = metrics.netUp > 1024
    ? `${(metrics.netUp / 1024).toFixed(1)}M`
    : `${String(Math.round(metrics.netUp)).padStart(4)}K`;
  const netDown = metrics.netDown > 1024
    ? `${(metrics.netDown / 1024).toFixed(1)}M`
    : `${String(Math.round(metrics.netDown)).padStart(4)}K`;

  return (
    <Box flexDirection="column">
      {/* Metrics line */}
      <Box>
        <Text color={C.warning}> {mascotFrame} </Text>
        <Text color={C.dim}>│ </Text>
        <Text color={C.subtext}>CPU </Text>
        <Text color={C.success}>{cpuSpark}</Text>
        <Text color={C.text}> {String(metrics.cpuPercent).padStart(3)}%</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.subtext}>MEM </Text>
        <Text color={C.primary}>{memBar}</Text>
        <Text color={C.text}> {metrics.memUsedGB}/{metrics.memTotalGB}G</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.success}>↑</Text>
        <Text color={C.subtext}>{netUp} </Text>
        <Text color={C.primary}>↓</Text>
        <Text color={C.subtext}>{netDown}</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.primary}>{spinnerChar}</Text>
      </Box>

      {/* Keyboard hints — context-aware */}
      <Box>
        <Text color={C.primary} bold> {label} </Text>
        <Text color={C.dim}>│ </Text>
        {view === "agent" ? (
          <>
            <Text color={C.success}>Tab</Text><Text color={C.subtext}> →roadmap  </Text>
            <Text color={C.success}>h</Text><Text color={C.subtext}> {hideDone ? "show done" : "hide done"}  </Text>
            <Text color={C.success}>Esc</Text><Text color={C.subtext}> dashboard  </Text>
            <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
          </>
        ) : view === "roadmap" ? (
          <>
            <Text color={C.success}>Tab</Text><Text color={C.subtext}> →dashboard  </Text>
            <Text color={C.success}>h</Text><Text color={C.subtext}> {hideDone ? "show done" : "hide done"}  </Text>
            <Text color={C.success}>Esc</Text><Text color={C.subtext}> dashboard  </Text>
            <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
          </>
        ) : bottomFocused ? (
          <>
            <Text color={C.success}>↑↓</Text><Text color={C.subtext}> scroll  </Text>
            <Text color={C.success}>h/l</Text><Text color={C.subtext}> file  </Text>
            <Text color={C.success}>d/g/s</Text><Text color={C.subtext}> tab  </Text>
            <Text color={C.success}>Esc</Text><Text color={C.subtext}> back  </Text>
            <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
          </>
        ) : label === "DETAIL" ? (
          <>
            <Text color={C.success}>↑↓</Text><Text color={C.subtext}> nav tasks  </Text>
            <Text color={C.success}>d/g/s</Text><Text color={C.subtext}> bottom  </Text>
            <Text color={C.success}>Esc</Text><Text color={C.subtext}> back  </Text>
            <Text color={C.success}>Tab</Text><Text color={C.subtext}> →agent  </Text>
            <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
          </>
        ) : (
          <>
            <Text color={C.success}>↑↓</Text><Text color={C.subtext}> nav  </Text>
            <Text color={C.success}>d/g/s</Text><Text color={C.subtext}> bottom  </Text>
            <Text color={C.success}>Space</Text><Text color={C.subtext}> select  </Text>
            <Text color={C.success}>Enter</Text><Text color={C.subtext}> focus  </Text>
            <Text color={C.success}>Tab</Text><Text color={C.subtext}> →agent  </Text>
            <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
