#!/usr/bin/env node
/**
 * Design Playground v2 — lazygit-inspired multi-panel TUI
 * Run: npx tsx src/playground.tsx
 *
 * Two pages:
 *   [Tab] switches between Global and Focus view
 *   [j/k] navigate, [Enter] expand, [1-3] jump to panel, [q] quit
 */
import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";

// ─── Catppuccin Mocha-inspired palette (matches lazygit) ────
const C = {
  green: "#a6e3a1",
  cyan: "#89dceb",
  teal: "#94e2d5",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  mauve: "#cba6f7",
  blue: "#89b4fa",
  text: "#cdd6f4",
  subtext: "#a6adc8",
  overlay: "#6c7086",
  surface: "#45475a",
  base: "#313244",
  dim: "#585b70",
};

// ─── Reusable: Panel with header ─────────────────────────────
function Panel({
  title,
  hotkey,
  focused,
  children,
  width,
  height,
}: {
  title: string;
  hotkey?: string;
  focused?: boolean;
  children: React.ReactNode;
  width?: number | string;
  height?: number;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? C.cyan : C.dim}
      width={width}
      height={height}
      paddingX={1}
    >
      <Text>
        {hotkey && (
          <Text color={focused ? C.cyan : C.dim}>[{hotkey}]</Text>
        )}
        <Text color={focused ? C.cyan : C.subtext} bold={focused}>
          {hotkey ? " " : ""}{title}
        </Text>
      </Text>
      {children}
    </Box>
  );
}

// ─── Progress bar ────────────────────────────────────────────
function Progress({ done, total, width = 16 }: { done: number; total: number; width?: number }) {
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  return (
    <Text>
      <Text color={C.green}>{"█".repeat(filled)}</Text>
      <Text color={C.dim}>{"░".repeat(width - filled)}</Text>
      <Text color={C.subtext}> {done}/{total}</Text>
    </Text>
  );
}

// ─── Status indicators ──────────────────────────────────────
const STATUS = {
  active: { icon: "●", color: C.green },
  working: { icon: "◍", color: C.yellow },
  idle: { icon: "○", color: C.dim },
  done: { icon: "✓", color: C.green },
  error: { icon: "✗", color: C.red },
} as const;

const TASK_STATUS = {
  done: { icon: "✓", color: C.green },
  active: { icon: "›", color: C.yellow },
  pending: { icon: "○", color: C.dim },
  blocked: { icon: "⊘", color: C.red },
} as const;

// ─── Types ───────────────────────────────────────────────────
type TaskStatus = "done" | "active" | "pending" | "blocked";
type AgentStatus = "active" | "working" | "idle" | "done" | "error";
interface MockTask { id: number; label: string; status: TaskStatus }
interface MockAgent { name: string; status: AgentStatus; tasks: MockTask[] }
interface MockProject { name: string; branch: string; status: AgentStatus; lastActive: string; agents: MockAgent[] }

// ─── Mock data ───────────────────────────────────────────────
const PROJECTS: MockProject[] = [
  {
    name: "project_claude_monitor",
    branch: "main",
    status: "active" as const,
    lastActive: "2m ago",
    agents: [
      {
        name: "main",
        status: "working" as const,
        tasks: [
          { id: 1, label: "Setup Ink + TypeScript", status: "done" as const },
          { id: 2, label: "Session index resolver", status: "done" as const },
          { id: 3, label: "Polling watcher", status: "done" as const },
          { id: 4, label: "Design hacker UI theme", status: "active" as const },
          { id: 5, label: "Keyboard navigation", status: "pending" as const },
        ],
      },
    ],
  },
  {
    name: "project_outclaws",
    branch: "main",
    status: "active" as const,
    lastActive: "5m ago",
    agents: [
      {
        name: "stream-a",
        status: "working" as const,
        tasks: [
          { id: 1, label: "Auth module", status: "done" as const },
          { id: 2, label: "User dashboard", status: "active" as const },
          { id: 3, label: "API endpoints", status: "pending" as const },
        ],
      },
      {
        name: "stream-b",
        status: "working" as const,
        tasks: [
          { id: 1, label: "Database schema", status: "done" as const },
          { id: 2, label: "Migration scripts", status: "active" as const },
        ],
      },
      {
        name: "stream-c",
        status: "idle" as const,
        tasks: [
          { id: 1, label: "Unit tests", status: "blocked" as const },
          { id: 2, label: "E2E tests", status: "pending" as const },
        ],
      },
    ],
  },
  {
    name: "project_sound_effects",
    branch: "main",
    status: "done" as const,
    lastActive: "1h ago",
    agents: [
      {
        name: "main",
        status: "idle" as const,
        tasks: [
          { id: 1, label: "Cross-platform audio", status: "done" as const },
          { id: 2, label: "12 theme packs", status: "done" as const },
          { id: 3, label: "Opencode plugin", status: "done" as const },
        ],
      },
    ],
  },
  {
    name: "project_keyboard",
    branch: "main",
    status: "idle" as const,
    lastActive: "20d ago",
    agents: [
      {
        name: "main",
        status: "idle" as const,
        tasks: [
          { id: 1, label: "Next.js 15 setup", status: "done" as const },
          { id: 2, label: "Blueprint wireframes", status: "done" as const },
          { id: 3, label: "i18n + deploy", status: "pending" as const },
        ],
      },
    ],
  },
];

// ─── Global View: Project List Panel ─────────────────────────
function ProjectList({ focusIdx, panelFocused }: { focusIdx: number; panelFocused: boolean }) {
  return (
    <Panel title="Projects" hotkey="1" focused={panelFocused} width={34}>
      <Box flexDirection="column" marginTop={1}>
        {PROJECTS.map((p, i) => {
          const s = STATUS[p.status];
          const focused = i === focusIdx;
          return (
            <Box key={i}>
              <Text color={focused ? C.cyan : C.dim}>{focused ? "▸ " : "  "}</Text>
              <Text color={s.color}>{s.icon} </Text>
              <Text color={focused ? C.text : C.subtext} bold={focused}>
                {p.name.replace("project_", "")}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Panel>
  );
}

// ─── Global View: Detail Panel ───────────────────────────────
function ProjectDetail({ project, panelFocused }: { project: MockProject; panelFocused: boolean }) {
  const allTasks = project.agents.flatMap((a) => a.tasks);
  const done = allTasks.filter((t) => t.status === "done").length;

  return (
    <Panel title={project.name.replace("project_", "")} hotkey="2" focused={panelFocused}>
      {/* Project info */}
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={C.mauve}>⎇ </Text>
          <Text color={C.text}>{project.branch}</Text>
          <Text color={C.dim}> │ </Text>
          <Text color={C.subtext}>{project.agents.length} agent{project.agents.length > 1 ? "s" : ""}</Text>
          <Text color={C.dim}> │ </Text>
          <Text color={C.subtext}>{project.lastActive}</Text>
        </Box>

        <Box marginTop={1}>
          <Progress done={done} total={allTasks.length} width={20} />
        </Box>

        {/* Agent sections */}
        {project.agents.map((agent, ai) => {
          const as_ = STATUS[agent.status];
          return (
            <Box key={ai} flexDirection="column" marginTop={1}>
              <Text>
                <Text color={as_.color}>{as_.icon} </Text>
                <Text color={C.teal} bold>{agent.name}</Text>
              </Text>
              {agent.tasks.map((t) => {
                const ts = TASK_STATUS[t.status];
                return (
                  <Box key={t.id}>
                    <Text color={ts.color}>{`  ${ts.icon} `.padEnd(5)}</Text>
                    <Text
                      color={t.status === "done" ? C.dim : C.text}
                      strikethrough={t.status === "done"}
                    >
                      #{t.id} {t.label}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
    </Panel>
  );
}

// ─── Global View: Activity Log ───────────────────────────────
function ActivityLog({ panelFocused }: { panelFocused: boolean }) {
  const logs = [
    { time: "10:08", project: "monitor", action: "›", task: "#4 Design hacker UI", color: C.yellow },
    { time: "10:05", project: "outclaws", action: "›", task: "#2 User dashboard", color: C.yellow },
    { time: "10:03", project: "monitor", action: "✓", task: "#3 Polling watcher", color: C.green },
    { time: "09:58", project: "outclaws", action: "✓", task: "#1 Auth module", color: C.green },
    { time: "09:45", project: "sound_fx", action: "✓", task: "#3 Opencode plugin", color: C.green },
  ];

  return (
    <Panel title="Activity" hotkey="3" focused={panelFocused}>
      <Box flexDirection="column" marginTop={1}>
        {logs.map((log, i) => (
          <Box key={i}>
            <Text color={C.dim}>{log.time}  </Text>
            <Text color={C.subtext}>{log.project.padEnd(10)}</Text>
            <Text color={log.color}> {log.action} </Text>
            <Text color={C.text}>{log.task}</Text>
          </Box>
        ))}
      </Box>
    </Panel>
  );
}

// ─── Mini Mascot (inline, 1-char) ────────────────────────────
const MINI_MASCOT = {
  idle:    ["☻ zzZ", "☻ zZ "],
  working: ["☻⌨ ·", "☻⌨ ··", "☻⌨···"],
  done:    ["☻♪"],
};

function miniMascotFrame(status: "idle" | "working" | "done", tick: number): string {
  const frames = MINI_MASCOT[status];
  return frames[tick % frames.length];
}

// ─── System Metrics Bar ──────────────────────────────────────
function SystemMetrics({ tick, mascotStatus }: { tick: number; mascotStatus: "idle" | "working" | "done" }) {
  // Simulated fluctuating data for demo
  const cpuBase = [12, 18, 35, 62, 45, 28, 15, 22];
  const cpuHistory = cpuBase.map((v, i) => v + ((tick + i) * 7 % 15) - 7);
  const cpuNow = Math.abs(cpuHistory[cpuHistory.length - 1]);

  const sparkChars = "▁▂▃▄▅▆▇█";
  const maxCpu = Math.max(...cpuHistory.map(Math.abs), 1);
  const spark = cpuHistory
    .map((v) => sparkChars[Math.min(Math.floor((Math.abs(v) / maxCpu) * 7), 7)])
    .join("");

  const memUsed = 4.1 + (tick % 5) * 0.2;
  const memTotal = 8;
  const memFilled = Math.round((memUsed / memTotal) * 8);

  const netUp = (0.8 + (tick * 3 % 20) / 10).toFixed(1);
  const netDown = (12.5 + (tick * 7 % 80) / 10).toFixed(1);

  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][tick % 10];

  const mascot = miniMascotFrame(mascotStatus, tick);
  const mascotColor = mascotStatus === "working" ? C.yellow : mascotStatus === "done" ? C.green : C.dim;

  return (
    <Box>
      <Text>
        <Text color={mascotColor}>{mascot}</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.subtext}>CPU </Text>
        <Text color={C.green}>{spark}</Text>
        <Text color={C.text}> {cpuNow}%</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.subtext}>MEM </Text>
        <Text color={C.blue}>{"█".repeat(memFilled)}</Text>
        <Text color={C.dim}>{"░".repeat(8 - memFilled)}</Text>
        <Text color={C.text}> {memUsed.toFixed(1)}/{memTotal}G</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.green}>↑</Text><Text color={C.text}>{netUp} </Text>
        <Text color={C.cyan}>↓</Text><Text color={C.text}>{netDown}</Text>
        <Text color={C.subtext}> KB/s</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.green}>{spinner}</Text>
      </Text>
    </Box>
  );
}

// ─── Focus View: Kanban Columns ──────────────────────────────
function KanbanBoard({ project }: { project: MockProject }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={C.mauve}>⎇ </Text>
        <Text color={C.cyan} bold>{project.name.replace("project_", "")}</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.subtext}>{project.branch}</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.subtext}>{project.agents.length} agents</Text>
      </Box>

      <Box marginTop={1} gap={1}>
        {project.agents.map((agent, ai) => {
          const as_ = STATUS[agent.status];
          const done = agent.tasks.filter((t) => t.status === "done").length;
          return (
            <Box
              key={ai}
              flexDirection="column"
              borderStyle="single"
              borderColor={agent.status === "working" ? C.green : C.dim}
              paddingX={1}
              width={28}
            >
              <Box justifyContent="space-between">
                <Text>
                  <Text color={as_.color}>{as_.icon} </Text>
                  <Text color={C.teal} bold>{agent.name}</Text>
                </Text>
                <Text color={C.dim}>{done}/{agent.tasks.length}</Text>
              </Box>
              <Box flexDirection="column" marginTop={1}>
                {agent.tasks.map((t) => {
                  const ts = TASK_STATUS[t.status];
                  return (
                    <Box key={t.id}>
                      <Text color={ts.color}>{`${ts.icon} `.padEnd(3)}</Text>
                      <Text
                        color={t.status === "done" ? C.dim : C.text}
                        strikethrough={t.status === "done"}
                      >
                        {t.label}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ─── Focus View Page ─────────────────────────────────────────
function FocusView() {
  // Show active projects only
  const active = PROJECTS.filter((p) => p.status === "active");
  return (
    <Panel title="Focus Mode" hotkey="F">
      <Box flexDirection="column" marginTop={1} gap={1}>
        {active.map((project, i) => (
          <KanbanBoard key={i} project={project} />
        ))}
      </Box>
    </Panel>
  );
}

// ─── Bottom Bar ──────────────────────────────────────────────
function BottomBar({ page }: { page: string }) {
  return (
    <Box>
      <Text color={C.cyan} bold>{` ${page === "global" ? "GLOBAL" : "FOCUS"} `}</Text>
      <Text color={C.dim}> │ </Text>
      <Text color={C.green}>↑↓</Text><Text color={C.subtext}> nav  </Text>
      <Text color={C.green}>Enter</Text><Text color={C.subtext}> detail  </Text>
      <Text color={C.green}>Space</Text><Text color={C.subtext}> select  </Text>
      <Text color={C.green}>Tab</Text><Text color={C.subtext}> kanban  </Text>
      <Text color={C.green}>h</Text><Text color={C.subtext}> hide  </Text>
      <Text color={C.green}>t</Text><Text color={C.subtext}> theme  </Text>
      <Text color={C.green}>q</Text><Text color={C.subtext}> quit</Text>
    </Box>
  );
}

// ─── Main App ────────────────────────────────────────────────
function App() {
  const { exit } = useApp();
  const [page, setPage] = useState<"global" | "focus">("global");
  const [focusIdx, setFocusIdx] = useState(0);
  const [activePanel, setActivePanel] = useState(1);
  const [hideDone, setHideDone] = useState(false);

  // Shared tick for all animations (1s interval)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const visibleProjects = hideDone ? PROJECTS.filter((p) => p.status !== "done") : PROJECTS;

  // Derive mascot state from project data
  const hasWorking = PROJECTS.some((p) => p.agents.some((a) => a.status === "working"));
  const allDone = PROJECTS.every((p) => p.status === "done");
  const mascotState = allDone ? "done" as const : hasWorking ? "working" as const : "idle" as const;

  useInput((input, key) => {
    if (input === "q") exit();
    if (key.tab) setPage((p) => (p === "global" ? "focus" : "global"));
    if (input === "h") setHideDone((v) => !v);
    if (input === "1") setActivePanel(1);
    if (input === "2") setActivePanel(2);
    if (input === "3") setActivePanel(3);
    if (key.upArrow || input === "k") setFocusIdx((v) => Math.max(0, v - 1));
    if (key.downArrow || input === "j") setFocusIdx((v) => Math.min(visibleProjects.length - 1, v + 1));
  });

  const currentProject = visibleProjects[focusIdx] ?? PROJECTS[0];

  return (
    <Box flexDirection="column">
      {page === "global" ? (
        <>
          {/* Top: Projects + Detail side by side */}
          <Box>
            <ProjectList focusIdx={focusIdx} panelFocused={activePanel === 1} />
            <ProjectDetail project={currentProject} panelFocused={activePanel === 2} />
          </Box>
          {/* Activity log */}
          <ActivityLog panelFocused={activePanel === 3} />
        </>
      ) : (
        <FocusView />
      )}
      {/* System metrics + keyboard hints */}
      <Box marginTop={1}>
        <SystemMetrics tick={tick} mascotStatus={mascotState} />
      </Box>
      <BottomBar page={page} />
    </Box>
  );
}

render(<App />);
