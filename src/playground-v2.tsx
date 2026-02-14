#!/usr/bin/env node
/**
 * Design Playground v2 — Master-Detail + Lazy Kanban
 *
 * Connected to real data via useWatchSessions() hook.
 * Shows actual projects, tasks, and sessions from ~/.claude/
 *
 * Run: npx tsx src/playground-v2.tsx  (or npm run dev:v2)
 */
import React, { useState } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { C, I, theme } from "./theme.js";
import { Panel } from "./components/panel.js";
import { Progress } from "./components/progress.js";
import { useWatchSessions } from "./watchers/use-watch.js";
import { formatTimeAgo } from "./utils.js";
import type { MergedProjectData, TaskItem, TodoItem, SessionHistoryEntry } from "./types.js";

// ─── Display types (normalized from real data) ──────────────
type DisplayTask = {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  blockedBy?: string;
  description?: string;
};

// View model: mirrors old MockProject shape for minimal UI changes
type ViewProject = {
  name: string;
  branch: string;
  agents: string[];
  activeSessions: number;
  docs: string[];
  tasks: DisplayTask[];
  recentSessions: SessionHistoryEntry[];
};

// ─── Adapter: MergedProjectData → ViewProject ───────────────
function toViewProject(p: MergedProjectData): ViewProject {
  const tasks = p.sessions.flatMap((s) => s.items).map((item, i): DisplayTask => {
    if ("subject" in item) {
      // TaskItem — has id, subject, owner, blockedBy
      const t = item as TaskItem;
      return {
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner,
        blockedBy: t.blockedBy?.[0],
        description: t.description,
      };
    }
    // TodoItem — synthesize id from index, use content as subject
    const todo = item as TodoItem;
    return {
      id: String(i + 1),
      subject: todo.content,
      status: todo.status,
    };
  });

  return {
    name: p.projectName,
    branch: p.git?.branch ?? p.gitBranch ?? "main",
    agents: p.agents,
    activeSessions: p.activeSessions,
    docs: p.docs,
    tasks,
    recentSessions: p.recentSessions,
  };
}

// ─── Helper functions ───────────────────────────────────────
function taskStats(p: ViewProject) {
  const total = p.tasks.length;
  const done = p.tasks.filter((t) => t.status === "completed").length;
  const doing = p.tasks.filter((t) => t.status === "in_progress").length;
  return { total, done, doing };
}

// Build activity entries from all projects (same pattern as app.tsx ActivityPanel)
type ActivityEntry = {
  projectName: string;
  label: string;
  status: string;
  time: Date;
};

function buildActivity(projects: MergedProjectData[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const p of projects) {
    for (const s of p.sessions) {
      for (const item of s.items) {
        const label = "subject" in item ? `#${(item as TaskItem).id} ${(item as TaskItem).subject}` : (item as TodoItem).content;
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
  return entries.slice(0, 5);
}

// ─── View state ─────────────────────────────────────────────
type FocusLevel = "outer" | "inner" | "kanban";

function PlaygroundApp() {
  const { exit } = useApp();
  const stdout = useStdout();
  const rows = stdout.stdout?.rows ?? 40;
  const { projects: rawProjects } = useWatchSessions();
  const [focus, setFocus] = useState<FocusLevel>("outer");
  const [projectIdx, setProjectIdx] = useState(0);
  const [taskIdx, setTaskIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [rightTab, setRightTab] = useState<1 | 2 | 3>(1); // 1=Tasks 2=Sessions 3=Docs
  const [panelFocus, setPanelFocus] = useState<1 | 2 | 3>(1); // outer: 1=Projects 2=Detail 3=Activity
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());

  // Convert real data → view model, sort: active first, then by task count
  const sorted = rawProjects.map(toViewProject).sort((a, b) => {
    if (a.activeSessions > 0 && b.activeSessions === 0) return -1;
    if (b.activeSessions > 0 && a.activeSessions === 0) return 1;
    return b.tasks.length - a.tasks.length;
  });

  const current = sorted[projectIdx];
  const currentTasks = current?.tasks ?? [];

  // Activity entries from real data
  const activityEntries = buildActivity(rawProjects);

  // Layout calculations (default to 40 rows if terminal size unavailable)
  const termRows = rows;
  const maxMiddleHeight = Math.floor(termRows * 0.5);
  const fixedRows = 3 + 2 + 4; // overview + statusbar + borders
  const middleAvailable = Math.max(8, Math.min(maxMiddleHeight, termRows - fixedRows - 8));
  const visibleProjects = Math.max(3, middleAvailable - 2); // -2 for panel border

  // Viewport scrolling
  const safeProjectIdx = Math.min(projectIdx, Math.max(0, sorted.length - 1));
  const ensureVisible = (idx: number) => {
    let offset = scrollOffset;
    if (idx < offset) offset = idx;
    if (idx >= offset + visibleProjects) offset = idx - visibleProjects + 1;
    return Math.max(0, Math.min(offset, sorted.length - visibleProjects));
  };

  useInput((input, key) => {
    if (input === "q") exit();

    // Tab → kanban
    if (key.tab) {
      setFocus(focus === "kanban" ? "outer" : "kanban");
      return;
    }

    if (focus === "outer") {
      // Panel focus switching (1=Projects, 2=Detail, 3=Activity)
      if (input === "1") setPanelFocus(1);
      if (input === "2") setPanelFocus(2);
      if (input === "3") setPanelFocus(3);

      // Navigate project list
      if ((input === "j" || key.downArrow) && projectIdx < sorted.length - 1) {
        const next = projectIdx + 1;
        setProjectIdx(next);
        setScrollOffset(ensureVisible(next));
        setTaskIdx(0);
        setRightTab(1);
      }
      if ((input === "k" || key.upArrow) && projectIdx > 0) {
        const next = projectIdx - 1;
        setProjectIdx(next);
        setScrollOffset(ensureVisible(next));
        setTaskIdx(0);
        setRightTab(1);
      }

      // Space → toggle multi-select for kanban
      if (input === " " && current) {
        setSelectedNames((prev) => {
          const next = new Set(prev);
          if (next.has(current.name)) {
            next.delete(current.name);
          } else {
            next.add(current.name);
          }
          return next;
        });
      }

      if (key.return && current) {
        setFocus("inner");
        setTaskIdx(0);
      }
    }

    if (focus === "inner") {
      if (key.escape) {
        setFocus("outer");
        setRightTab(1);
      }
      if ((input === "j" || key.downArrow) && taskIdx < currentTasks.length - 1) {
        setTaskIdx((i) => i + 1);
      }
      if ((input === "k" || key.upArrow) && taskIdx > 0) {
        setTaskIdx((i) => i - 1);
      }
      if (input === "1") setRightTab(1);
      if (input === "2") setRightTab(2);
      if (input === "3") setRightTab(3);
    }

    if (focus === "kanban") {
      if (key.escape) setFocus("outer");
    }
  });

  // Aggregate stats
  const totalProjects = sorted.length;
  const totalTasks = sorted.reduce((s, p) => s + p.tasks.length, 0);
  const totalDone = sorted.reduce((s, p) => s + taskStats(p).done, 0);
  const totalActive = sorted.filter((p) => p.activeSessions > 0).length;

  const viewLabel = focus === "kanban" ? "KANBAN" : focus === "inner" ? "DETAIL" : "DASHBOARD";

  if (focus === "kanban") {
    // Filter: selected projects, or all projects with tasks if none selected
    const kanbanProjects = selectedNames.size > 0
      ? sorted.filter((p) => selectedNames.has(p.name) && p.tasks.length > 0)
      : sorted.filter((p) => p.tasks.length > 0);
    return (
      <Box flexDirection="column">
        <KanbanView projects={kanbanProjects} selectedCount={selectedNames.size} />
        <StatusHints view="kanban" label={viewLabel} />
      </Box>
    );
  }

  // Visible slice of projects
  const visSlice = sorted.slice(scrollOffset, scrollOffset + visibleProjects);
  const aboveCount = scrollOffset;
  const belowCount = Math.max(0, sorted.length - scrollOffset - visibleProjects);

  return (
    <Box flexDirection="column">
      {/* Row A: Overview + Active Now */}
      <Box>
        <Panel title="OVERVIEW" flexGrow={1}>
          <Text>
            <Text color={C.text} bold>{String(totalProjects)}</Text>
            <Text color={C.subtext}> projects  </Text>
            <Text color={totalActive > 0 ? C.warning : C.text} bold>{String(totalActive)}</Text>
            <Text color={C.subtext}> active  </Text>
            <Text color={C.text} bold>{String(totalTasks)}</Text>
            <Text color={C.subtext}> tasks</Text>
          </Text>
          {totalTasks > 0 && <Progress done={totalDone} total={totalTasks} width={20} />}
        </Panel>
        <Panel title="ACTIVE NOW" flexGrow={1}>
          {sorted.filter((p) => p.activeSessions > 0).slice(0, 4).map((p, i) => {
            const doing = p.tasks.find((t) => t.status === "in_progress");
            return (
              <Box key={i}>
                <Text color={C.warning}>{I.working} </Text>
                <Text color={C.subtext}>{p.name.slice(0, 10)}/{doing?.owner ?? "session"}</Text>
                <Text color={C.dim}>  </Text>
                <Text color={C.text}>{doing ? `#${doing.id} ${doing.subject}` : `${p.activeSessions} active`}</Text>
              </Box>
            );
          })}
          {sorted.filter((p) => p.activeSessions > 0).length === 0 && (
            <Text color={C.dim}>No active agents</Text>
          )}
        </Panel>
      </Box>

      {/* Row B: Projects + Detail/Tasks */}
      <Box height={middleAvailable}>
        {/* Left: Project list with viewport scrolling */}
        <Panel title={`PROJECTS (${sorted.length})`} hotkey="1" focused={panelFocus === 1} width={34}>
          {aboveCount > 0 && (
            <Text color={C.dim}>  ▲ {aboveCount} more</Text>
          )}
          {visSlice.map((p, vi) => {
            const realIdx = scrollOffset + vi;
            const isCursor = realIdx === safeProjectIdx;
            const stats = taskStats(p);
            const icon = p.activeSessions > 0 ? I.working : stats.total > 0 && stats.done === stats.total ? I.done : I.idle;
            const iconColor = p.activeSessions > 0 ? C.warning : stats.done === stats.total && stats.total > 0 ? C.success : C.dim;
            const isSelected = selectedNames.has(p.name);
            return (
              <Box key={p.name}>
                <Text color={isCursor ? C.primary : C.dim}>
                  {isCursor ? I.cursor : " "}{" "}
                </Text>
                {/* Selection indicator (☑/☐) */}
                {selectedNames.size > 0 && (
                  <Text color={isSelected ? C.success : C.dim}>
                    {isSelected ? "☑" : "☐"}{" "}
                  </Text>
                )}
                <Text color={iconColor}>{icon} </Text>
                <Text color={isCursor ? C.text : C.subtext} bold={isCursor}>
                  {p.name.length > 20 ? p.name.slice(0, 19) + "…" : p.name.padEnd(20)}
                </Text>
                {p.branch !== "main" && (
                  <Text color={C.accent}> ⎇{p.branch.slice(0, 5)}</Text>
                )}
              </Box>
            );
          })}
          {belowCount > 0 && (
            <Text color={C.dim}>  ▼ {belowCount} more</Text>
          )}
        </Panel>

        {/* Right: Detail / Tasks / Git / Docs depending on focus + tab */}
        <RightPanel
          project={current}
          focus={focus}
          rightTab={rightTab}
          taskIdx={taskIdx}
          panelFocused={panelFocus === 2}
        />
      </Box>

      {/* Row C: Activity (outer) or Docs+Sessions (inner) */}
      {focus === "outer" ? (
        <Panel title="ACTIVITY" hotkey="3" focused={panelFocus === 3} flexGrow={1}>
          {activityEntries.length === 0 ? (
            <Text color={C.dim}>No recent activity</Text>
          ) : (
            activityEntries.map((e, i) => {
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
      ) : (
        <Box>
          <Panel title={`DOCS (${current?.name ?? ""})`} flexGrow={1}>
            {current?.docs.length ? (
              current.docs.map((doc, i) => (
                <Box key={i}>
                  <Text color={C.accent}>● </Text>
                  <Text color={C.text}>{doc}</Text>
                </Box>
              ))
            ) : (
              <Text color={C.dim}>No docs detected</Text>
            )}
          </Panel>
          <Panel title={`SESSIONS (${current?.name ?? ""})`} flexGrow={1}>
            {current?.recentSessions.length ? (
              current.recentSessions.slice(0, 7).map((s, i) => (
                <Box key={i}>
                  <Text color={C.accent}>● </Text>
                  <Text color={C.subtext}>{s.sessionId.slice(0, 8)}  </Text>
                  <Text color={C.text}>{s.summary ?? s.firstPrompt?.slice(0, 40) ?? "—"}</Text>
                  {s.gitBranch && <Text color={C.dim}> ⎇{s.gitBranch}</Text>}
                </Box>
              ))
            ) : (
              <Text color={C.dim}>No session history</Text>
            )}
          </Panel>
        </Box>
      )}

      <StatusHints view={focus} label={viewLabel} />
    </Box>
  );
}

// ─── Right panel: detail preview (outer) or full tasks (inner) ──
function RightPanel({
  project,
  focus,
  rightTab,
  taskIdx,
  panelFocused,
}: {
  project: ViewProject;
  focus: FocusLevel;
  rightTab: 1 | 2 | 3;
  taskIdx: number;
  panelFocused: boolean;
}) {
  if (!project) {
    return (
      <Panel title="DETAIL" hotkey="2" focused={panelFocused} flexGrow={1}>
        <Text color={C.dim}>Select a project</Text>
      </Panel>
    );
  }

  const stats = taskStats(project);
  const isInner = focus === "inner";

  // Tab labels for inner focus
  const tabLabel = isInner
    ? ` [${rightTab === 1 ? "●" : " "}1:Tasks] [${rightTab === 2 ? "●" : " "}2:Sessions] [${rightTab === 3 ? "●" : " "}3:Docs]`
    : "";

  const title = isInner
    ? `${project.name.toUpperCase()}${tabLabel}`
    : project.name.toUpperCase();

  // Inner focus: Docs tab
  if (isInner && rightTab === 3) {
    return (
      <Panel title={title} flexGrow={1} focused={isInner || panelFocused}>
        {project.docs.length > 0 ? (
          project.docs.map((doc, i) => (
            <Box key={i}>
              <Text color={C.accent}>● </Text>
              <Text color={C.text}>{doc}</Text>
            </Box>
          ))
        ) : (
          <Text color={C.dim}>No docs detected</Text>
        )}
      </Panel>
    );
  }

  // Inner focus: Sessions tab (replaces old Git/Timeline tab)
  if (isInner && rightTab === 2) {
    return (
      <Panel title={title} flexGrow={1} focused={isInner || panelFocused}>
        <Text color={C.subtext}>⎇ {project.branch}</Text>
        <Text> </Text>
        {project.recentSessions.length > 0 ? (
          project.recentSessions.slice(0, 8).map((s, i) => (
            <Box key={i}>
              <Text color={C.accent}>● </Text>
              <Text color={C.dim}>{s.sessionId.slice(0, 8)}  </Text>
              <Text color={C.text}>{s.summary ?? s.firstPrompt?.slice(0, 50) ?? "—"}</Text>
            </Box>
          ))
        ) : (
          <Text color={C.dim}>No session history</Text>
        )}
      </Panel>
    );
  }

  // Tab 1 (Tasks) or outer focus detail
  return (
    <Panel title={title} hotkey={isInner ? undefined : "2"} flexGrow={1} focused={isInner || panelFocused}>
      {/* Project info header */}
      <Box>
        <Text color={C.accent}>⎇ {project.branch} </Text>
        {project.agents.length > 0 && (
          <Text color={C.dim}>{project.agents.length} agent{project.agents.length > 1 ? "s" : ""}  </Text>
        )}
        {project.docs.length > 0 && (
          <Text color={C.subtext}>{project.docs.join("  ")}</Text>
        )}
      </Box>
      {stats.total > 0 && (
        <Box>
          <Text color={C.subtext}>tasks: </Text>
          <Progress done={stats.done} total={stats.total} width={14} />
        </Box>
      )}
      <Text> </Text>

      {/* Task list — grouped by agent for multi-agent projects, flat for single-agent */}
      {(() => {
        const isMultiAgent = project.agents.length > 1;
        if (isMultiAgent) {
          // Group tasks by owner
          const agents = [...new Set(project.tasks.map((t) => t.owner ?? "unassigned"))];
          let flatIdx = 0;
          return agents.map((agent) => {
            const agentTasks = project.tasks.filter((t) => (t.owner ?? "unassigned") === agent);
            const hasActive = agentTasks.some((t) => t.status === "in_progress");
            const hasBlocked = agentTasks.some((t) => t.blockedBy);
            const agentStatus = hasBlocked ? "blocked" : hasActive ? "active" : "idle";
            const agentIcon = hasBlocked ? "○" : hasActive ? I.working : "○";
            const agentColor = hasBlocked ? C.error : hasActive ? C.warning : C.dim;
            return (
              <Box key={agent} flexDirection="column">
                <Text color={agentColor}>  ── {agentIcon} {agent} ({agentStatus}) ──────────</Text>
                {agentTasks.map((t) => {
                  const thisIdx = flatIdx++;
                  const isCursor = isInner && thisIdx === taskIdx;
                  const icon = t.status === "completed" ? I.done : t.status === "in_progress" ? I.working : I.idle;
                  const iconColor = t.status === "completed" ? C.success : t.status === "in_progress" ? C.warning : C.dim;
                  return (
                    <Box key={t.id}>
                      <Text color={isCursor ? C.primary : C.dim}>
                        {isCursor ? I.cursor : " "}{" "}
                      </Text>
                      <Text color={iconColor}>{icon} </Text>
                      <Text
                        color={t.status === "completed" ? C.dim : isCursor ? C.text : C.subtext}
                        bold={isCursor}
                        strikethrough={t.status === "completed"}
                      >
                        #{t.id} {t.subject}
                      </Text>
                      {t.blockedBy && <Text color={C.error}> ⊘#{t.blockedBy}</Text>}
                    </Box>
                  );
                })}
              </Box>
            );
          });
        }

        // Single-agent: flat list with owner tag
        return project.tasks.map((t, i) => {
          const isCursor = isInner && i === taskIdx;
          const icon = t.status === "completed" ? I.done : t.status === "in_progress" ? I.working : I.idle;
          const iconColor = t.status === "completed" ? C.success : t.status === "in_progress" ? C.warning : C.dim;
          return (
            <Box key={t.id}>
              <Text color={isCursor ? C.primary : C.dim}>
                {isCursor ? I.cursor : " "}{" "}
              </Text>
              <Text color={iconColor}>{icon} </Text>
              <Text
                color={t.status === "completed" ? C.dim : isCursor ? C.text : C.subtext}
                bold={isCursor}
                strikethrough={t.status === "completed"}
              >
                #{t.id} {t.subject}
              </Text>
              {t.owner && <Text color={C.accent}> ({t.owner})</Text>}
              {t.blockedBy && <Text color={C.error}> ⊘#{t.blockedBy}</Text>}
            </Box>
          );
        });
      })()}

      {/* Task detail (inner focus, selected task) */}
      {isInner && project.tasks[taskIdx] && (
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
          </Box>
          {project.tasks[taskIdx].description && (
            <Text color={C.subtext}>{project.tasks[taskIdx].description}</Text>
          )}
        </>
      )}

      {/* Empty state */}
      {project.tasks.length === 0 && (
        <Text color={C.dim}>No tasks (session-only project)</Text>
      )}
    </Panel>
  );
}

// ─── Lazy Kanban view ───────────────────────────────────────
function KanbanView({ projects, selectedCount }: { projects: ViewProject[]; selectedCount: number }) {
  const labelW = 18;
  const colW = 24;

  const filterLabel = selectedCount > 0 ? ` (${selectedCount} selected)` : "";
  return (
    <Panel title={`KANBAN — ${projects.length} project${projects.length !== 1 ? "s" : ""}${filterLabel}`} flexGrow={1}>
      {/* Header row */}
      <Box>
        <Text color={C.subtext} bold>{"PROJECTS".padEnd(labelW)}</Text>
        <Text color={C.dim}>│ </Text>
        <Text color={C.subtext}>{"TODO".padEnd(colW - 6)}</Text>
        <Text color={C.dim}>{String(projects.reduce((s, p) => s + p.tasks.filter((t) => t.status === "pending").length, 0)).padStart(3)}  </Text>
        <Text color={C.dim}>│ </Text>
        <Text color={C.warning} bold>{"DOING".padEnd(colW - 6)}</Text>
        <Text color={C.dim}>{String(projects.reduce((s, p) => s + p.tasks.filter((t) => t.status === "in_progress").length, 0)).padStart(3)}  </Text>
        <Text color={C.dim}>│ </Text>
        <Text color={C.success} bold>{"DONE".padEnd(colW - 6)}</Text>
        <Text color={C.dim}>{String(projects.reduce((s, p) => s + p.tasks.filter((t) => t.status === "completed").length, 0)).padStart(3)}  </Text>
      </Box>

      {projects.map((project) => {
        const todo = project.tasks.filter((t) => t.status === "pending");
        const doing = project.tasks.filter((t) => t.status === "in_progress");
        const done = project.tasks.filter((t) => t.status === "completed");
        const maxRows = Math.max(1, todo.length, doing.length, done.length);

        return (
          <Box key={project.name} flexDirection="column">
            {/* Separator */}
            <Box>
              <Text color={C.dim}>{"─".repeat(labelW)}┼{"─".repeat(colW)}┼{"─".repeat(colW)}┼{"─".repeat(colW)}</Text>
            </Box>

            {/* Project rows */}
            {Array.from({ length: maxRows }, (_, ri) => {
              const todoTask = todo[ri];
              const doingTask = doing[ri];
              const doneTask = done[ri];

              // Left label
              let leftLine1 = "";
              let leftLine1Color = C.text;
              if (ri === 0) { leftLine1 = project.name; leftLine1Color = project.activeSessions > 0 ? C.success : C.subtext; }
              else if (ri === 1) { leftLine1 = `⎇ ${project.branch}`; leftLine1Color = C.accent; }
              else if (ri === 2 && project.agents.length > 0) {
                leftLine1 = project.activeSessions > 0 ? `${project.agents.length} agent${project.agents.length > 1 ? "s" : ""}` : "idle";
                leftLine1Color = C.dim;
              }

              return (
                <Box key={ri}>
                  <Text color={leftLine1Color} bold={ri === 0}>
                    {leftLine1.padEnd(labelW).slice(0, labelW)}
                  </Text>
                  <Text color={C.dim}>│ </Text>
                  <KanbanCard task={todoTask} width={colW} status="pending" />
                  <Text color={C.dim}>│ </Text>
                  <KanbanCard task={doingTask} width={colW} status="in_progress" />
                  <Text color={C.dim}>│ </Text>
                  <KanbanCard task={doneTask} width={colW} status="completed" />
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Panel>
  );
}

function KanbanCard({
  task,
  width,
  status,
}: {
  task?: DisplayTask;
  width: number;
  status: "pending" | "in_progress" | "completed";
}) {
  if (!task) {
    return <Text color={C.dim}>{" ".repeat(width)}</Text>;
  }

  // Colored left accent border
  const accentColor = task.blockedBy ? C.error
    : status === "completed" ? C.success
    : status === "in_progress" ? C.warning
    : C.dim;

  const textColor = status === "completed" ? C.dim : C.text;
  const label = `#${task.id} ${task.subject}`.slice(0, width - 4);
  const agentLine = task.owner ? `└ ${task.owner}${task.blockedBy ? " ⊘" : ""}` : "";

  if (agentLine) {
    // Two-line card: task + agent
    return (
      <Box flexDirection="column" width={width}>
        <Box>
          <Text color={accentColor}>┃ </Text>
          <Text color={textColor} bold={status === "in_progress"} strikethrough={status === "completed"}>
            {label.padEnd(width - 3).slice(0, width - 3)}
          </Text>
        </Box>
        <Box>
          <Text color={accentColor}>┃ </Text>
          <Text color={C.dim}>{agentLine.padEnd(width - 3).slice(0, width - 3)}</Text>
        </Box>
      </Box>
    );
  }

  // Single-line card
  return (
    <Box width={width}>
      <Text color={accentColor}>┃ </Text>
      <Text color={textColor} bold={status === "in_progress"} strikethrough={status === "completed"}>
        {label.padEnd(width - 3).slice(0, width - 3)}
      </Text>
    </Box>
  );
}

// ─── Status bar hints ───────────────────────────────────────
function StatusHints({ view, label }: { view: string; label: string }) {
  return (
    <Box>
      <Text color={C.primary} bold> {label} </Text>
      <Text color={C.dim}>│ </Text>
      {view === "outer" ? (
        <>
          <Text color={C.success}>↑↓</Text><Text color={C.subtext}> nav  </Text>
          <Text color={C.success}>1/2/3</Text><Text color={C.subtext}> panel  </Text>
          <Text color={C.success}>Space</Text><Text color={C.subtext}> select  </Text>
          <Text color={C.success}>Enter</Text><Text color={C.subtext}> focus  </Text>
          <Text color={C.success}>Tab</Text><Text color={C.subtext}> kanban  </Text>
          <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
        </>
      ) : view === "inner" ? (
        <>
          <Text color={C.success}>↑↓</Text><Text color={C.subtext}> nav tasks  </Text>
          <Text color={C.success}>1/2/3</Text><Text color={C.subtext}> tab  </Text>
          <Text color={C.success}>Esc</Text><Text color={C.subtext}> back  </Text>
          <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
        </>
      ) : (
        <>
          <Text color={C.success}>Esc</Text><Text color={C.subtext}> back  </Text>
          <Text color={C.success}>s</Text><Text color={C.subtext}> toggle  </Text>
          <Text color={C.success}>h</Text><Text color={C.subtext}> hide done  </Text>
          <Text color={C.success}>q</Text><Text color={C.subtext}> quit</Text>
        </>
      )}
    </Box>
  );
}

// ─── Entry point ────────────────────────────────────────────
render(<PlaygroundApp />);
