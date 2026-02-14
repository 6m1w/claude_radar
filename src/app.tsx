import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { useWatchSessions } from "./watchers/use-watch.js";
import { Panel } from "./components/panel.js";
import { Progress } from "./components/progress.js";
import { C, I, theme } from "./theme.js";
import { formatTimeAgo } from "./utils.js";
import type { ProjectData, TodoItem, TaskItem } from "./types.js";

export function App() {
  const { projects, lastUpdate } = useWatchSessions();
  const { exit } = useApp();
  const [cursorIdx, setCursorIdx] = useState(0);

  // Keyboard: q to quit, j/k or arrows to navigate
  useInput((input, key) => {
    if (input === "q") exit();
    if ((input === "k" || key.upArrow) && cursorIdx > 0) {
      setCursorIdx((i) => i - 1);
    }
    if ((input === "j" || key.downArrow) && cursorIdx < projects.length - 1) {
      setCursorIdx((i) => i + 1);
    }
  });

  // Keep cursor in bounds when project list changes
  const safeCursor = Math.min(cursorIdx, Math.max(0, projects.length - 1));
  const currentProject = projects[safeCursor];

  return (
    <Box flexDirection="column">
      {/* Top row: Projects list + Detail panel */}
      <Box>
        <ProjectList
          projects={projects}
          cursorIdx={safeCursor}
        />
        <DetailPanel project={currentProject} />
      </Box>

      {/* Bottom row: Activity log */}
      <ActivityPanel projects={projects} />

      {/* Status bar */}
      <StatusBar lastUpdate={lastUpdate} projectCount={projects.length} />
    </Box>
  );
}

// ─── Projects list panel ─────────────────────────────────────
function ProjectList({
  projects,
  cursorIdx,
}: {
  projects: ProjectData[];
  cursorIdx: number;
}) {
  return (
    <Panel title="PROJECTS" hotkey="1" width={36}>
      {projects.length === 0 ? (
        <Text color={C.dim}>No active projects</Text>
      ) : (
        projects.map((p, i) => {
          const isCursor = i === cursorIdx;
          const icon = p.isActive ? I.working : p.completedTasks === p.totalTasks && p.totalTasks > 0 ? I.done : I.idle;
          const iconColor = p.isActive ? C.warning : p.completedTasks === p.totalTasks && p.totalTasks > 0 ? C.success : C.dim;
          const branch = p.gitBranch && p.gitBranch !== "main" ? ` ${p.gitBranch}` : "";
          const agentCount = p.agents.length;
          const timeAgo = formatTimeAgo(p.lastActivity);

          return (
            <Box key={p.projectPath}>
              <Text color={isCursor ? C.primary : C.dim}>
                {isCursor ? I.cursor : " "}{" "}
              </Text>
              <Text color={iconColor}>{icon} </Text>
              <Text color={isCursor ? C.text : C.subtext} bold={isCursor}>
                {p.projectName.padEnd(14).slice(0, 14)}
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

// ─── Detail panel (tasks of selected project) ───────────────
function DetailPanel({ project }: { project?: ProjectData }) {
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
      {/* Header: branch + agents + progress */}
      <Box>
        {branch && <Text color={C.accent}>{branch} </Text>}
        {agentLabel && <Text color={C.dim}>{agentLabel} </Text>}
        <Progress done={project.completedTasks} total={project.totalTasks} width={12} />
      </Box>
      <Text color={C.dim}> </Text>

      {/* Task list */}
      {allItems.map((item, i) => {
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
          <Box key={i}>
            <Text color={iconColor}>{` ${icon} `.padEnd(4)}</Text>
            <Text
              color={item.status === "completed" ? C.dim : C.text}
              strikethrough={item.status === "completed"}
            >
              {label}
            </Text>
            {owner && <Text color={C.accent}>{owner}</Text>}
          </Box>
        );
      })}
    </Panel>
  );
}

// ─── Activity panel (recent task events across all projects) ─
function ActivityPanel({ projects }: { projects: ProjectData[] }) {
  // Collect recent active items across all projects
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

  // Sort by time, show most recent 5
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

// ─── Status bar ──────────────────────────────────────────────
function StatusBar({
  lastUpdate,
  projectCount,
}: {
  lastUpdate: Date | null;
  projectCount: number;
}) {
  const time = lastUpdate?.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) ?? "--:--:--";

  return (
    <Box>
      <Text color={C.primary} bold> DASHBOARD </Text>
      <Text color={C.dim}> │ </Text>
      <Text color={C.success}>↑↓</Text>
      <Text color={C.subtext}> nav  </Text>
      <Text color={C.success}>q</Text>
      <Text color={C.subtext}> quit  </Text>
      <Text color={C.dim}> │ </Text>
      <Text color={C.dim}>
        {projectCount} project{projectCount !== 1 ? "s" : ""} · {time}
      </Text>
    </Box>
  );
}
