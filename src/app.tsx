import React, { useState } from "react";
import { Box, Text, useInput, useApp, useStdout } from "ink";
import { useWatchSessions } from "./watchers/use-watch.js";
import { Panel } from "./components/panel.js";
import { Progress } from "./components/progress.js";
import { C, I } from "./theme.js";
import { formatTimeAgo } from "./utils.js";
import type { MergedProjectData, DisplayItem, TodoItem, TaskItem } from "./types.js";

// ─── View state machine ─────────────────────────────────────
type ViewState =
  | { view: "dashboard" }
  | { view: "detail"; projectPath: string }
  | { view: "kanban" };

export function App() {
  const { projects, lastUpdate } = useWatchSessions();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [viewState, setViewState] = useState<ViewState>({ view: "dashboard" });
  const [cursorIdx, setCursorIdx] = useState(0);
  const [taskCursorIdx, setTaskCursorIdx] = useState(0);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [scrollOffset, setScrollOffset] = useState(0);

  // Height calculation per DESIGN.md: Row B capped at maxMiddlePercent (50%)
  const termRows = stdout?.rows ?? 40;
  const fixedRows = 3 + 2 + 4; // overview + statusbar + borders
  const available = termRows - fixedRows;
  const maxMiddle = Math.floor(termRows * 0.5);
  const middleRows = Math.min(Math.floor(available * 0.5), maxMiddle);
  // Account for panel border (2) + title (1) = 3 rows overhead
  const maxVisibleProjects = Math.max(3, middleRows - 3);

  // Find the detail project by path (stays current as data refreshes)
  const detailProject = viewState.view === "detail"
    ? projects.find((p) => p.projectPath === viewState.projectPath)
    : undefined;

  // Keep cursors in bounds
  const safeCursor = Math.min(cursorIdx, Math.max(0, projects.length - 1));
  const currentProject = projects[safeCursor];
  const detailItems = detailProject?.sessions.flatMap((s) => s.items) ?? [];
  const safeTaskCursor = Math.min(taskCursorIdx, Math.max(0, detailItems.length - 1));

  // Keyboard input
  useInput((input, key) => {
    if (input === "q") exit();

    if (viewState.view === "dashboard") {
      if ((input === "k" || key.upArrow) && cursorIdx > 0) {
        setCursorIdx((i) => {
          const next = i - 1;
          // Scroll up if cursor goes above visible window
          if (next < scrollOffset) setScrollOffset(next);
          return next;
        });
      }
      if ((input === "j" || key.downArrow) && cursorIdx < projects.length - 1) {
        setCursorIdx((i) => {
          const next = i + 1;
          // Scroll down if cursor goes below visible window
          if (next >= scrollOffset + maxVisibleProjects) {
            setScrollOffset(next - maxVisibleProjects + 1);
          }
          return next;
        });
      }
      if (key.return && currentProject) {
        setViewState({ view: "detail", projectPath: currentProject.projectPath });
        setTaskCursorIdx(0);
      }
      // Space: toggle project selection for kanban
      if (input === " " && currentProject) {
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(currentProject.projectPath)) {
            next.delete(currentProject.projectPath);
          } else {
            next.add(currentProject.projectPath);
          }
          return next;
        });
      }
      // Tab: open kanban view
      if (key.tab) {
        setViewState({ view: "kanban" });
      }
    }

    if (viewState.view === "detail") {
      if (key.escape) {
        setViewState({ view: "dashboard" });
      }
      if ((input === "k" || key.upArrow) && taskCursorIdx > 0) {
        setTaskCursorIdx((i) => i - 1);
      }
      if ((input === "j" || key.downArrow) && taskCursorIdx < detailItems.length - 1) {
        setTaskCursorIdx((i) => i + 1);
      }
    }

    if (viewState.view === "kanban") {
      if (key.escape) {
        setViewState({ view: "dashboard" });
      }
    }
  });

  // Aggregate stats for Dashboard
  const totalProjects = projects.length;
  const totalTasks = projects.reduce((s, p) => s + p.totalTasks, 0);
  const totalCompleted = projects.reduce((s, p) => s + p.completedTasks, 0);
  const totalAgents = new Set(projects.flatMap((p) => p.agents)).size;
  // Prefer hookSessions (precise) over mtime-based activeSessions (heuristic)
  const totalActiveSessions = projects.reduce((s, p) =>
    s + Math.max(p.activeSessions, p.hookSessions.length), 0);

  // Active sessions and tasks
  const activePairs: { projectName: string; agent: string; label: string; time: string }[] = [];
  for (const p of projects) {
    const hookCount = p.hookSessions.length;
    const isActive = p.activeSessions > 0 || hookCount > 0;

    // Show hook-tracked sessions even if no in_progress tasks
    if (isActive && p.inProgressTasks === 0) {
      const sessionCount = Math.max(p.activeSessions, hookCount);
      activePairs.push({
        projectName: p.projectName,
        agent: "session",
        label: `${sessionCount} active session${sessionCount > 1 ? "s" : ""}`,
        time: formatTimeAgo(p.lastActivity),
      });
    }
    for (const s of p.sessions) {
      if (s.gone) continue; // skip archived sessions
      for (const item of s.items) {
        if (item.status !== "in_progress" || item._gone) continue;
        const label = "subject" in item ? `#${item.id} ${item.subject}` : item.content;
        const agent = "owner" in item && item.owner ? item.owner : "main";
        activePairs.push({
          projectName: p.projectName,
          agent,
          label,
          time: formatTimeAgo(s.lastModified),
        });
      }
    }
  }

  const viewLabel = viewState.view === "dashboard" ? "DASHBOARD"
    : viewState.view === "detail" ? "DETAIL"
    : "FOCUS";

  // Kanban projects: selected ones, or all active if none selected
  const kanbanProjects = selectedPaths.size > 0
    ? projects.filter((p) => selectedPaths.has(p.projectPath))
    : projects.filter((p) => p.isActive || p.totalTasks > p.completedTasks);

  return (
    <Box flexDirection="column" height={termRows}>
      {viewState.view === "dashboard" ? (
        <>
          {/* Row 1: Overview + Active Now */}
          <Box>
            <OverviewPanel
              totalProjects={totalProjects}
              totalAgents={totalAgents}
              totalTasks={totalTasks}
              totalCompleted={totalCompleted}
              totalActiveSessions={totalActiveSessions}
            />
            <ActiveNowPanel activePairs={activePairs} />
          </Box>

          {/* Row 2: Projects list + Detail preview — height capped at 50% */}
          <Box height={middleRows}>
            <ProjectList
              projects={projects}
              cursorIdx={safeCursor}
              selectedPaths={selectedPaths}
              scrollOffset={scrollOffset}
              maxVisible={maxVisibleProjects}
            />
            <DetailPreview project={currentProject} />
          </Box>

          {/* Row 3: Activity log */}
          <ActivityPanel projects={projects} />
        </>
      ) : viewState.view === "detail" ? (
        <ProjectDetailView
          project={detailProject}
          items={detailItems}
          taskCursorIdx={safeTaskCursor}
        />
      ) : (
        <KanbanView projects={kanbanProjects} />
      )}

      {/* Status bar — owns its own metrics + tick, never causes parent re-render */}
      <StatusBar
        viewLabel={viewLabel}
        viewState={viewState.view}
        hasActive={activePairs.length > 0}
        allDone={totalTasks > 0 && totalCompleted === totalTasks}
      />
    </Box>
  );
}

// ─── Overview panel ──────────────────────────────────────────
function OverviewPanel({
  totalProjects,
  totalAgents,
  totalTasks,
  totalCompleted,
  totalActiveSessions,
}: {
  totalProjects: number;
  totalAgents: number;
  totalTasks: number;
  totalCompleted: number;
  totalActiveSessions: number;
}) {
  return (
    <Panel title="OVERVIEW" flexGrow={1}>
      <Box>
        <Text color={C.text} bold>{totalProjects}</Text>
        <Text color={C.subtext}> projects  </Text>
        <Text color={totalActiveSessions > 0 ? C.warning : C.text} bold>{totalActiveSessions}</Text>
        <Text color={C.subtext}> active  </Text>
        <Text color={C.text} bold>{totalTasks}</Text>
        <Text color={C.subtext}> tasks</Text>
      </Box>
      {totalTasks > 0 && <Progress done={totalCompleted} total={totalTasks} width={20} />}
    </Panel>
  );
}

// ─── Active Now panel ────────────────────────────────────────
function ActiveNowPanel({
  activePairs,
}: {
  activePairs: { projectName: string; agent: string; label: string; time: string }[];
}) {
  return (
    <Panel title="ACTIVE NOW" flexGrow={1}>
      {activePairs.length === 0 ? (
        <Text color={C.dim}>No active agents</Text>
      ) : (
        activePairs.slice(0, 4).map((pair, i) => (
          <Box key={i}>
            <Text color={C.warning}>{I.working} </Text>
            <Text color={C.subtext}>
              {pair.projectName}/{pair.agent}
            </Text>
            <Text color={C.dim}>  </Text>
            <Text color={C.text}>{pair.label}</Text>
            <Text color={C.dim}>  {pair.time}</Text>
          </Box>
        ))
      )}
    </Panel>
  );
}

// ─── Projects list panel ─────────────────────────────────────
function ProjectList({
  projects,
  cursorIdx,
  selectedPaths,
  scrollOffset,
  maxVisible,
}: {
  projects: MergedProjectData[];
  cursorIdx: number;
  selectedPaths: Set<string>;
  scrollOffset: number;
  maxVisible: number;
}) {
  const aboveCount = scrollOffset;
  const belowCount = Math.max(0, projects.length - scrollOffset - maxVisible);
  const visibleProjects = projects.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <Panel title={`PROJECTS (${projects.length})`} hotkey="1" width={50}>
      {projects.length === 0 ? (
        <Text color={C.dim}>No projects found</Text>
      ) : (
        <>
          {aboveCount > 0 && (
            <Text color={C.dim}>  ▲ {aboveCount} more</Text>
          )}
          {visibleProjects.map((p, vi) => {
            const i = vi + scrollOffset;
            const isCursor = i === cursorIdx;
            const isSelected = selectedPaths.has(p.projectPath);
            const hookCount = p.hookSessions.length;
            const isActive = p.activeSessions > 0 || hookCount > 0;
            const icon = isActive
              ? I.working
              : p.completedTasks === p.totalTasks && p.totalTasks > 0
                ? I.done
                : I.idle;
            const iconColor = isActive
              ? C.warning
              : p.completedTasks === p.totalTasks && p.totalTasks > 0
                ? C.success
                : C.dim;
            const timeAgo = formatTimeAgo(p.lastActivity);
            const selectMark = isSelected ? I.selected : I.unselected;
            const branch = p.git?.branch ?? p.gitBranch ?? "";

            return (
              <Box key={p.projectPath}>
                <Text color={isCursor ? C.primary : C.dim}>
                  {isCursor ? I.cursor : " "}{" "}
                </Text>
                <Text color={isSelected ? C.success : C.dim}>{selectMark} </Text>
                <Text color={iconColor}>{icon} </Text>
                <Text color={isCursor ? C.text : C.subtext} bold={isCursor}>
                  {p.projectName.padEnd(14).slice(0, 14)}
                </Text>
                {branch ? (
                  <Text color={C.accent}> ⎇{branch.padEnd(6).slice(0, 6)}</Text>
                ) : (
                  <Text color={C.dim}>        </Text>
                )}
                {hookCount > 0 ? (
                  <Text color={C.warning}> ⚡{hookCount}</Text>
                ) : (
                  <Text color={C.dim}> {String(p.totalSessions).padStart(2)}s</Text>
                )}
                <Text color={C.dim}> {timeAgo.padStart(3)}</Text>
              </Box>
            );
          })}
          {belowCount > 0 && (
            <Text color={C.dim}>  ▼ {belowCount} more</Text>
          )}
        </>
      )}
    </Panel>
  );
}

// ─── Detail preview (Dashboard right panel) ──────────────────
function DetailPreview({ project }: { project?: MergedProjectData }) {
  if (!project) {
    return (
      <Panel title="DETAIL" hotkey="2" flexGrow={1}>
        <Text color={C.dim}>Select a project</Text>
      </Panel>
    );
  }

  // Separate live and gone sessions
  const liveSessions = project.sessions.filter((s) => !s.gone);
  const goneSessions = project.sessions.filter((s) => s.gone);
  const liveItems = liveSessions.flatMap((s) => s.items);
  const branch = project.git?.branch ?? project.gitBranch;
  const agentLabel = project.agents.length > 0
    ? `${project.agents.length} agent${project.agents.length > 1 ? "s" : ""}`
    : "";
  const hookCount = project.hookSessions.length;

  return (
    <Panel title={project.projectName.toUpperCase()} hotkey="2" flexGrow={1}>
      {/* Git + Sessions info */}
      <Box>
        {branch && <Text color={C.accent}>⎇ {branch} </Text>}
        {agentLabel && <Text color={C.dim}>{agentLabel}  </Text>}
        <Text color={C.subtext}>{project.totalSessions} sessions</Text>
        {(project.activeSessions > 0 || hookCount > 0) && (
          <Text color={C.warning}> ({Math.max(project.activeSessions, hookCount)} active)</Text>
        )}
      </Box>

      {/* Docs */}
      {project.docs.length > 0 && (
        <Box>
          <Text color={C.subtext}>docs: </Text>
          <Text color={C.primary}>{project.docs.join("  ")}</Text>
        </Box>
      )}

      {/* Task progress */}
      {project.totalTasks > 0 && (
        <Box>
          <Text color={C.subtext}>tasks: </Text>
          <Progress done={project.completedTasks} total={project.totalTasks} width={12} />
        </Box>
      )}

      {/* Live task list */}
      {liveItems.length > 0 && <Text> </Text>}
      {liveItems.slice(0, 6).map((item, i) => (
        <TaskRow key={i} item={item} />
      ))}
      {liveItems.length > 6 && (
        <Text color={C.dim}>  ... +{liveItems.length - 6} more</Text>
      )}

      {/* Collapsed gone sessions summary */}
      {goneSessions.length > 0 && (
        <Text color={C.dim}>  ▸ {goneSessions.length} archived session{goneSessions.length > 1 ? "s" : ""}</Text>
      )}

      {/* Empty state */}
      {liveItems.length === 0 && goneSessions.length === 0 && project.totalSessions > 0 && (
        <Text color={C.dim}>No tasks (session-only project)</Text>
      )}
    </Panel>
  );
}

// ─── Shared task row ─────────────────────────────────────────
function TaskRow({ item, isCursor }: { item: DisplayItem; isCursor?: boolean }) {
  const isTask = "subject" in item;
  const isGone = !!item._gone;
  const label = isTask ? `#${item.id} ${item.subject}` : item.content;
  const icon = item.status === "completed" ? I.done
    : item.status === "in_progress" ? I.working
    : I.idle;
  // Gone items always dim, live items use status color
  const iconColor = isGone ? C.dim
    : item.status === "completed" ? C.success
    : item.status === "in_progress" ? C.warning
    : C.dim;
  const owner = isTask && item.owner ? ` (${item.owner})` : "";

  return (
    <Box>
      <Text color={isCursor ? C.primary : C.dim}>
        {isCursor ? I.cursor : " "}
      </Text>
      <Text color={iconColor}>{` ${icon} `.padEnd(4)}</Text>
      <Text
        color={isGone || item.status === "completed" ? C.dim : isCursor ? C.text : C.subtext}
        bold={!isGone && isCursor}
        dimColor={isGone}
        strikethrough={isGone || item.status === "completed"}
      >
        {label}
      </Text>
      {owner && <Text color={isGone ? C.dim : C.accent} dimColor={isGone}>{owner}</Text>}
    </Box>
  );
}

// ─── Project Detail View (full screen) ───────────────────────
function ProjectDetailView({
  project,
  items,
  taskCursorIdx,
}: {
  project?: MergedProjectData;
  items: DisplayItem[];
  taskCursorIdx: number;
}) {
  if (!project) {
    return (
      <Panel title="PROJECT" flexGrow={1}>
        <Text color={C.dim}>Project not found (may have been removed)</Text>
      </Panel>
    );
  }

  const selectedItem = items[taskCursorIdx];
  const branch = project.git?.branch ?? project.gitBranch;
  const hookCount = project.hookSessions.length;
  const liveItems = items.filter((i) => !i._gone);
  const goneItems = items.filter((i) => !!i._gone);
  const goneSessions = project.sessions.filter((s) => s.gone);

  return (
    <>
      {/* Top row: Project info + Tasks or Session history */}
      <Box>
        {/* Left: Project overview */}
        <Panel title={project.projectName.toUpperCase()} width={42}>
          {/* Git info */}
          {branch && (
            <Box>
              <Text color={C.subtext}>branch  </Text>
              <Text color={C.accent}>⎇ {branch}</Text>
            </Box>
          )}

          {/* Path */}
          <Box>
            <Text color={C.subtext}>path    </Text>
            <Text color={C.dim}>{project.projectPath}</Text>
          </Box>

          {/* Sessions */}
          <Box>
            <Text color={C.subtext}>sessions </Text>
            <Text color={C.text}>{project.totalSessions} total</Text>
            {(project.activeSessions > 0 || hookCount > 0) && (
              <Text color={C.warning}> ({Math.max(project.activeSessions, hookCount)} active)</Text>
            )}
          </Box>

          {/* Docs */}
          {project.docs.length > 0 && (
            <Box>
              <Text color={C.subtext}>docs    </Text>
              <Text color={C.primary}>{project.docs.join("  ")}</Text>
            </Box>
          )}

          {/* Task progress */}
          {project.totalTasks > 0 && (
            <Box>
              <Text color={C.subtext}>tasks   </Text>
              <Progress done={project.completedTasks} total={project.totalTasks} width={12} />
            </Box>
          )}

          {/* Agents */}
          {project.agents.length > 0 && (
            <Box>
              <Text color={C.subtext}>agents  </Text>
              <Text color={C.accent}>{project.agents.join(", ")}</Text>
            </Box>
          )}

          {/* History badge */}
          {project.hasHistory && (
            <Box>
              <Text color={C.subtext}>history </Text>
              <Text color={C.dim}>{goneItems.length} archived items</Text>
            </Box>
          )}
        </Panel>

        {/* Right: Task list or session history */}
        <Panel title={liveItems.length > 0 ? "TASKS" : "SESSION HISTORY"} flexGrow={1}>
          {liveItems.length > 0 ? (
            <>
              {liveItems.map((item, i) => (
                <TaskRow key={i} item={item} isCursor={i === taskCursorIdx} />
              ))}
              {/* Gone items rendered after live items with dim styling */}
              {goneItems.length > 0 && (
                <Text color={C.dim}>  ─── archived ───</Text>
              )}
              {goneItems.slice(0, 4).map((item, i) => (
                <TaskRow key={`gone-${i}`} item={item} />
              ))}
              {goneItems.length > 4 && (
                <Text color={C.dim}>  ... +{goneItems.length - 4} more archived</Text>
              )}
            </>
          ) : goneSessions.length > 0 ? (
            <>
              <Text color={C.dim}>▸ {goneSessions.length} archived session{goneSessions.length > 1 ? "s" : ""}</Text>
              {goneItems.slice(0, 4).map((item, i) => (
                <TaskRow key={`gone-${i}`} item={item} />
              ))}
            </>
          ) : project.recentSessions.length > 0 ? (
            project.recentSessions.slice(-8).map((s, i) => {
              const prompt = s.firstPrompt?.replace(/<[^>]*>/g, "").trim();
              const label = s.summary || prompt || s.sessionId.slice(0, 8);
              return (
                <Box key={i}>
                  <Text color={C.dim}>{s.sessionId.slice(0, 6)} </Text>
                  {s.gitBranch && <Text color={C.accent}>⎇{s.gitBranch.padEnd(6).slice(0, 6)} </Text>}
                  <Text color={C.subtext}>{label.slice(0, 50)}</Text>
                </Box>
              );
            })
          ) : (
            <Text color={C.dim}>No tasks or session history available</Text>
          )}
        </Panel>
      </Box>

      {/* Bottom row: Task detail (if task is selected) */}
      {selectedItem && (
        <Panel title="TASK DETAIL" flexGrow={1}>
          <TaskDetailContent item={selectedItem} />
        </Panel>
      )}
    </>
  );
}

// ─── Task detail content ─────────────────────────────────────
function TaskDetailContent({ item }: { item: DisplayItem }) {
  const isTask = "subject" in item;

  if (!isTask) {
    // TodoItem — minimal info
    return (
      <Box flexDirection="column">
        <Text color={C.text} bold>{item.content}</Text>
        <Text> </Text>
        <Box>
          <Text color={C.subtext}>Status: </Text>
          <Text color={item.status === "completed" ? C.success : item.status === "in_progress" ? C.warning : C.dim}>
            {item.status}
          </Text>
        </Box>
        {item.activeForm && (
          <Box>
            <Text color={C.subtext}>Active: </Text>
            <Text color={C.text}>{item.activeForm}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // TaskItem — full detail
  return (
    <Box flexDirection="column">
      <Text color={C.text} bold>#{item.id} {item.subject}</Text>
      <Text> </Text>

      <Box>
        <Text color={C.subtext}>Status: </Text>
        <Text color={item.status === "completed" ? C.success : item.status === "in_progress" ? C.warning : C.dim}>
          {item.status}
        </Text>
      </Box>
      {item.owner && (
        <Box>
          <Text color={C.subtext}>Owner:  </Text>
          <Text color={C.accent}>{item.owner}</Text>
        </Box>
      )}
      {item.activeForm && (
        <Box>
          <Text color={C.subtext}>Active: </Text>
          <Text color={C.warning}>{item.activeForm}</Text>
        </Box>
      )}
      {item.blockedBy.length > 0 && (
        <Box>
          <Text color={C.subtext}>Blocked by: </Text>
          <Text color={C.error}>{item.blockedBy.join(", ")}</Text>
        </Box>
      )}
      {item.blocks.length > 0 && (
        <Box>
          <Text color={C.subtext}>Blocks: </Text>
          <Text color={C.warning}>{item.blocks.join(", ")}</Text>
        </Box>
      )}
      {item.description && (
        <>
          <Text> </Text>
          <Text color={C.subtext}>{item.description.slice(0, 200)}</Text>
        </>
      )}
    </Box>
  );
}

// ─── Kanban / Focus view (swimlane table) ────────────────────
function KanbanView({ projects }: { projects: MergedProjectData[] }) {
  // Column widths
  const labelW = 14;
  const colW = 22;

  // Categorize tasks per project into TODO / DOING / DONE
  type Bucket = { label: string; agent?: string; gone?: boolean }[];

  return (
    <Panel title={`FOCUS — ${projects.length} project${projects.length !== 1 ? "s" : ""}`} flexGrow={1}>
      {/* Shared header row */}
      <Box>
        <Text color={C.dim}>{" ".repeat(labelW)}</Text>
        <Text color={C.dim}>│ </Text>
        <Text color={C.subtext} bold>{"TODO".padEnd(colW)}</Text>
        <Text color={C.dim}>│ </Text>
        <Text color={C.warning} bold>{"DOING".padEnd(colW)}</Text>
        <Text color={C.dim}>│ </Text>
        <Text color={C.success} bold>{"DONE".padEnd(colW)}</Text>
      </Box>

      {projects.map((project, pi) => {
        const allItems = project.sessions.flatMap((s) => s.items);
        const todo: Bucket = [];
        const doing: Bucket = [];
        const done: Bucket = [];

        for (const item of allItems) {
          const isGone = !!item._gone;
          const label = "subject" in item
            ? `${item.subject}`.slice(0, colW - 4)
            : item.content.slice(0, colW - 4);
          const agent = "owner" in item && item.owner ? item.owner : undefined;
          // Gone items always go to DONE column regardless of their status
          if (isGone) {
            done.push({ label, agent, gone: true });
          } else if (item.status === "completed") {
            done.push({ label, agent });
          } else if (item.status === "in_progress") {
            doing.push({ label, agent });
          } else {
            todo.push({ label, agent });
          }
        }

        const maxRows = Math.max(1, todo.length, doing.length, done.length);
        const branch = project.gitBranch ? `⎇ ${project.gitBranch}` : "";

        return (
          <Box key={project.projectPath} flexDirection="column">
            {/* Separator */}
            <Box>
              <Text color={C.dim}>{"─".repeat(labelW)}┼{"─".repeat(colW + 1)}┼{"─".repeat(colW + 1)}┼{"─".repeat(colW)}</Text>
            </Box>

            {/* Project rows */}
            {Array.from({ length: maxRows }, (_, ri) => {
              const todoItem = todo[ri];
              const doingItem = doing[ri];
              const doneItem = done[ri];

              // Left label: project name on first row, branch on second
              let leftLabel = "";
              if (ri === 0) leftLabel = project.projectName;
              else if (ri === 1 && branch) leftLabel = branch;
              else if (ri === 1 && project.agents.length > 1) {
                leftLabel = `${project.agents.length} agents`;
              }

              return (
                <Box key={ri}>
                  <Text color={ri === 0 ? C.text : C.dim} bold={ri === 0}>
                    {leftLabel.padEnd(labelW).slice(0, labelW)}
                  </Text>
                  <Text color={C.dim}>│ </Text>
                  <KanbanCell item={todoItem} width={colW} status="pending" />
                  <Text color={C.dim}>│ </Text>
                  <KanbanCell item={doingItem} width={colW} status="in_progress" />
                  <Text color={C.dim}>│ </Text>
                  <KanbanCell item={doneItem} width={colW} status="completed" />
                </Box>
              );
            })}
          </Box>
        );
      })}

      {projects.length === 0 && (
        <Text color={C.dim}>No projects to display. Select projects with Space on Dashboard.</Text>
      )}
    </Panel>
  );
}

function KanbanCell({
  item,
  width,
  status,
}: {
  item?: { label: string; agent?: string; gone?: boolean };
  width: number;
  status: "pending" | "in_progress" | "completed";
}) {
  if (!item) {
    return <Text color={C.dim}>{" ".repeat(width)}</Text>;
  }

  const isGone = !!item.gone;
  const icon = status === "completed" ? I.done
    : status === "in_progress" ? I.working
    : I.idle;
  const iconColor = isGone ? C.dim
    : status === "completed" ? C.success
    : status === "in_progress" ? C.warning
    : C.dim;
  const textColor = isGone ? C.dim : status === "completed" ? C.dim : C.text;

  return (
    <Text color={textColor}>
      <Text color={iconColor} dimColor={isGone}>{icon}</Text>
      <Text color={textColor} dimColor={isGone} strikethrough={isGone}>
        {" "}{item.label.padEnd(width - 2).slice(0, width - 2)}
      </Text>
    </Text>
  );
}

// ─── Activity panel ──────────────────────────────────────────
function ActivityPanel({ projects }: { projects: MergedProjectData[] }) {
  type ActivityEntry = {
    projectName: string;
    label: string;
    status: string;
    time: Date;
  };

  const entries: ActivityEntry[] = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      if (s.gone) continue; // skip archived sessions from activity feed
      for (const item of s.items) {
        if (item._gone) continue; // skip archived items
        const label = "subject" in item ? `#${item.id} ${item.subject}` : item.content;
        entries.push({
          projectName: p.projectName,
          label,
          status: item.status,
          time: s.lastModified,
        });
      }
    }
  }

  entries.sort((a, b) => b.time.getTime() - a.time.getTime());
  const recent = entries.slice(0, 5);

  return (
    <Panel title="ACTIVITY" hotkey="3" flexGrow={1}>
      {recent.length === 0 ? (
        <Text color={C.dim}>No recent activity</Text>
      ) : (
        recent.map((e, i) => {
          const icon = e.status === "completed" ? I.done
            : e.status === "in_progress" ? "›"
            : I.idle;
          const iconColor = e.status === "completed" ? C.success
            : e.status === "in_progress" ? C.warning
            : C.dim;
          const timeStr = e.time.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });

          return (
            <Box key={i}>
              <Text color={C.dim}>{timeStr}  </Text>
              <Text color={C.subtext}>{e.projectName.padEnd(12).slice(0, 12)} </Text>
              <Text color={iconColor}>{icon} </Text>
              <Text color={C.text}>{e.label}</Text>
            </Box>
          );
        })
      )}
    </Panel>
  );
}

// ─── Status bar — fully self-contained, single 1fps timer ───
import { useMetrics } from "./hooks/use-metrics.js";

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const SPARK = "▁▂▃▄▅▆▇█";
const MASCOT = {
  idle: "☻ zzZ",
  working: "☻⌨",
  done: "☻♪",
};

function sparkline(values: number[], max = 100): string {
  return values
    .map((v) => SPARK[Math.max(0, Math.min(7, Math.floor((v / max) * 8)))])
    .join("");
}

function StatusBar({
  viewLabel,
  viewState,
  hasActive,
  allDone,
}: {
  viewLabel: string;
  viewState: "dashboard" | "detail" | "kanban";
  hasActive: boolean;
  allDone: boolean;
}) {
  // Single data source: useMetrics fires 1/s, includes tick counter.
  // No separate tick timer — exactly 1 re-render per second.
  const metrics = useMetrics();
  const tick = metrics.tick;

  const mascotFrame = allDone ? MASCOT.done : hasActive ? MASCOT.working : MASCOT.idle;
  const spinnerChar = SPINNER[tick % SPINNER.length];
  const cpuSpark = sparkline(metrics.cpuHistory);
  const memBarLen = 8;
  const memFilled = Math.round((metrics.memPercent / 100) * memBarLen);
  const memBar = "█".repeat(memFilled) + "░".repeat(memBarLen - memFilled);
  // Fixed-width formatting prevents layout shifts between renders
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

      {/* Keyboard hints (context-dependent) */}
      <Box>
        <Text color={C.primary} bold> {viewLabel} </Text>
        <Text color={C.dim}>│ </Text>
        {viewState === "dashboard" ? (
          <>
            <Text color={C.success}>↑↓</Text>
            <Text color={C.subtext}> nav  </Text>
            <Text color={C.success}>Enter</Text>
            <Text color={C.subtext}> detail  </Text>
            <Text color={C.success}>Space</Text>
            <Text color={C.subtext}> select  </Text>
            <Text color={C.success}>Tab</Text>
            <Text color={C.subtext}> kanban  </Text>
            <Text color={C.success}>q</Text>
            <Text color={C.subtext}> quit</Text>
          </>
        ) : viewState === "detail" ? (
          <>
            <Text color={C.success}>↑↓</Text>
            <Text color={C.subtext}> nav tasks  </Text>
            <Text color={C.success}>Esc</Text>
            <Text color={C.subtext}> back  </Text>
            <Text color={C.success}>q</Text>
            <Text color={C.subtext}> quit</Text>
          </>
        ) : (
          <>
            <Text color={C.success}>Esc</Text>
            <Text color={C.subtext}> back  </Text>
            <Text color={C.success}>q</Text>
            <Text color={C.subtext}> quit</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
