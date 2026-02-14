import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useWatchSessions } from "./watchers/use-watch.js";
import { Panel } from "./components/panel.js";
import { Progress } from "./components/progress.js";
import { C, I } from "./theme.js";
import { formatTimeAgo } from "./utils.js";
import type { ProjectData, TodoItem, TaskItem } from "./types.js";

// ─── View state machine ─────────────────────────────────────
type ViewState =
  | { view: "dashboard" }
  | { view: "detail"; projectPath: string }
  | { view: "kanban" };

export function App() {
  const { projects, lastUpdate } = useWatchSessions();
  const { exit } = useApp();
  const [viewState, setViewState] = useState<ViewState>({ view: "dashboard" });
  const [cursorIdx, setCursorIdx] = useState(0);
  const [taskCursorIdx, setTaskCursorIdx] = useState(0);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

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
        setCursorIdx((i) => i - 1);
      }
      if ((input === "j" || key.downArrow) && cursorIdx < projects.length - 1) {
        setCursorIdx((i) => i + 1);
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

  // Active agent+task pairs
  const activePairs: { projectName: string; agent: string; label: string; time: string }[] = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const item of s.items) {
        if (item.status !== "in_progress") continue;
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
    <Box flexDirection="column">
      {viewState.view === "dashboard" ? (
        <>
          {/* Row 1: Overview + Active Now */}
          <Box>
            <OverviewPanel
              totalProjects={totalProjects}
              totalAgents={totalAgents}
              totalTasks={totalTasks}
              totalCompleted={totalCompleted}
            />
            <ActiveNowPanel activePairs={activePairs} />
          </Box>

          {/* Row 2: Projects list + Detail preview */}
          <Box>
            <ProjectList
              projects={projects}
              cursorIdx={safeCursor}
              selectedPaths={selectedPaths}
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
}: {
  totalProjects: number;
  totalAgents: number;
  totalTasks: number;
  totalCompleted: number;
}) {
  return (
    <Panel title="OVERVIEW" flexGrow={1}>
      <Box>
        <Text color={C.text} bold>{totalProjects}</Text>
        <Text color={C.subtext}> projects  </Text>
        <Text color={C.text} bold>{totalAgents}</Text>
        <Text color={C.subtext}> agents  </Text>
        <Text color={C.text} bold>{totalTasks}</Text>
        <Text color={C.subtext}> tasks</Text>
      </Box>
      <Progress done={totalCompleted} total={totalTasks} width={20} />
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
}: {
  projects: ProjectData[];
  cursorIdx: number;
  selectedPaths: Set<string>;
}) {
  return (
    <Panel title="PROJECTS" hotkey="1" width={38}>
      {projects.length === 0 ? (
        <Text color={C.dim}>No active projects</Text>
      ) : (
        projects.map((p, i) => {
          const isCursor = i === cursorIdx;
          const isSelected = selectedPaths.has(p.projectPath);
          const icon = p.isActive
            ? I.working
            : p.completedTasks === p.totalTasks && p.totalTasks > 0
              ? I.done
              : I.idle;
          const iconColor = p.isActive
            ? C.warning
            : p.completedTasks === p.totalTasks && p.totalTasks > 0
              ? C.success
              : C.dim;
          const timeAgo = formatTimeAgo(p.lastActivity);
          const selectMark = isSelected ? I.selected : I.unselected;

          return (
            <Box key={p.projectPath}>
              <Text color={isCursor ? C.primary : C.dim}>
                {isCursor ? I.cursor : " "}{" "}
              </Text>
              <Text color={isSelected ? C.success : C.dim}>{selectMark} </Text>
              <Text color={iconColor}>{icon} </Text>
              <Text color={isCursor ? C.text : C.subtext} bold={isCursor}>
                {p.projectName.padEnd(12).slice(0, 12)}
              </Text>
              <Text color={C.dim}> </Text>
              <Progress done={p.completedTasks} total={p.totalTasks} width={8} />
              <Text color={C.dim}> {timeAgo.padStart(3)}</Text>
            </Box>
          );
        })
      )}
    </Panel>
  );
}

// ─── Detail preview (Dashboard right panel) ──────────────────
function DetailPreview({ project }: { project?: ProjectData }) {
  if (!project) {
    return (
      <Panel title="DETAIL" hotkey="2" flexGrow={1}>
        <Text color={C.dim}>Select a project</Text>
      </Panel>
    );
  }

  const allItems = project.sessions.flatMap((s) => s.items);
  const branch = project.gitBranch ? `⎇ ${project.gitBranch}` : "";
  const agentLabel = project.agents.length > 0
    ? `${project.agents.length} agent${project.agents.length > 1 ? "s" : ""}`
    : "";

  return (
    <Panel title={project.projectName.toUpperCase()} hotkey="2" flexGrow={1}>
      <Box>
        {branch && <Text color={C.accent}>{branch} </Text>}
        {agentLabel && <Text color={C.dim}>{agentLabel} </Text>}
        <Progress done={project.completedTasks} total={project.totalTasks} width={12} />
      </Box>
      <Text> </Text>
      {allItems.slice(0, 8).map((item, i) => (
        <TaskRow key={i} item={item} />
      ))}
      {allItems.length > 8 && (
        <Text color={C.dim}>  ... +{allItems.length - 8} more</Text>
      )}
    </Panel>
  );
}

// ─── Shared task row ─────────────────────────────────────────
function TaskRow({ item, isCursor }: { item: TodoItem | TaskItem; isCursor?: boolean }) {
  const isTask = "subject" in item;
  const label = isTask ? `#${item.id} ${item.subject}` : item.content;
  const icon = item.status === "completed" ? I.done
    : item.status === "in_progress" ? I.working
    : I.idle;
  const iconColor = item.status === "completed" ? C.success
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
        color={item.status === "completed" ? C.dim : isCursor ? C.text : C.subtext}
        bold={isCursor}
        strikethrough={item.status === "completed"}
      >
        {label}
      </Text>
      {owner && <Text color={C.accent}>{owner}</Text>}
    </Box>
  );
}

// ─── Project Detail View (full screen) ───────────────────────
function ProjectDetailView({
  project,
  items,
  taskCursorIdx,
}: {
  project?: ProjectData;
  items: (TodoItem | TaskItem)[];
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
  const branch = project.gitBranch ? `⎇ ${project.gitBranch}` : "";
  const agentLabel = `${project.agents.length} agent${project.agents.length > 1 ? "s" : ""}`;

  return (
    <>
      {/* Top row: Task list + Task detail */}
      <Box>
        <Panel title={`${project.projectName.toUpperCase()} — Tasks`} width={40}>
          <Box>
            {branch && <Text color={C.accent}>{branch} </Text>}
            <Text color={C.dim}>{agentLabel} </Text>
            <Progress done={project.completedTasks} total={project.totalTasks} width={10} />
          </Box>
          <Text> </Text>
          {items.map((item, i) => (
            <TaskRow key={i} item={item} isCursor={i === taskCursorIdx} />
          ))}
        </Panel>

        <Panel title="TASK DETAIL" flexGrow={1}>
          {selectedItem ? (
            <TaskDetailContent item={selectedItem} />
          ) : (
            <Text color={C.dim}>No tasks</Text>
          )}
        </Panel>
      </Box>
    </>
  );
}

// ─── Task detail content ─────────────────────────────────────
function TaskDetailContent({ item }: { item: TodoItem | TaskItem }) {
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
function KanbanView({ projects }: { projects: ProjectData[] }) {
  // Column widths
  const labelW = 14;
  const colW = 22;

  // Categorize tasks per project into TODO / DOING / DONE
  type Bucket = { label: string; agent?: string }[];

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
          const label = "subject" in item
            ? `${item.subject}`.slice(0, colW - 4)
            : item.content.slice(0, colW - 4);
          const agent = "owner" in item && item.owner ? item.owner : undefined;
          if (item.status === "completed") {
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
  item?: { label: string; agent?: string };
  width: number;
  status: "pending" | "in_progress" | "completed";
}) {
  if (!item) {
    return <Text color={C.dim}>{" ".repeat(width)}</Text>;
  }

  const icon = status === "completed" ? I.done
    : status === "in_progress" ? I.working
    : I.idle;
  const iconColor = status === "completed" ? C.success
    : status === "in_progress" ? C.warning
    : C.dim;
  const textColor = status === "completed" ? C.dim : C.text;
  const agentSuffix = item.agent ? ` ${item.agent}` : "";
  const content = `${icon} ${item.label}${agentSuffix}`;

  return (
    <Text color={textColor}>
      <Text color={iconColor}>{icon}</Text>
      <Text color={textColor}> {item.label.padEnd(width - 2).slice(0, width - 2)}</Text>
    </Text>
  );
}

// ─── Activity panel ──────────────────────────────────────────
function ActivityPanel({ projects }: { projects: ProjectData[] }) {
  type ActivityEntry = {
    projectName: string;
    label: string;
    status: string;
    time: Date;
  };

  const entries: ActivityEntry[] = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const item of s.items) {
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
