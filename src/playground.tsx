#!/usr/bin/env node
/**
 * Design Playground — TUI visual experiments
 * Run: npx tsx src/playground.tsx
 */
import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";

// ─── Color Palette ───────────────────────────────────────────
const C = {
  bg: "#0a0e14",
  green: "#00ff41",
  cyan: "#00d4ff",
  yellow: "#ffb800",
  red: "#ff3e3e",
  dim: "#3b4261",
  gray: "#555e70",
  white: "#c0caf5",
};

// ─── ASCII Art Header ────────────────────────────────────────
function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={C.cyan}>
        {"  ╔═══════════════════════════════════════════════════╗"}
      </Text>
      <Text color={C.cyan}>
        {"  ║"}<Text color={C.green} bold>{" ▓▓▓ CLAUDE MONITOR "}</Text><Text color={C.dim}>{"v0.2.0"}</Text><Text color={C.cyan}>{"                    ║"}</Text>
      </Text>
      <Text color={C.cyan}>
        {"  ║"}<Text color={C.dim}>{" ⣿ Agent Task Surveillance System"}</Text><Text color={C.cyan}>{"               ║"}</Text>
      </Text>
      <Text color={C.cyan}>
        {"  ╚═══════════════════════════════════════════════════╝"}
      </Text>
    </Box>
  );
}

// ─── Status Bar ──────────────────────────────────────────────
function StatusBar() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][tick % 10];
  const time = new Date().toLocaleTimeString();

  return (
    <Box justifyContent="space-between" marginBottom={1}>
      <Text>
        <Text color={C.green}>{spinner}</Text>
        <Text color={C.dim}> SCANNING </Text>
        <Text color={C.gray}>~/.claude/tasks/</Text>
      </Text>
      <Text>
        <Text color={C.dim}>UPTIME </Text>
        <Text color={C.green}>{tick}s</Text>
        <Text color={C.dim}> │ </Text>
        <Text color={C.cyan}>{time}</Text>
      </Text>
    </Box>
  );
}

// ─── Hacker-style Progress Bar ───────────────────────────────
function HackerProgress({ done, total, width = 20 }: { done: number; total: number; width?: number }) {
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const pctStr = `${Math.round(pct * 100)}%`;

  return (
    <Text>
      <Text color={C.dim}>{"["}</Text>
      <Text color={C.green}>{"█".repeat(filled)}</Text>
      <Text color={C.dim}>{"░".repeat(empty)}</Text>
      <Text color={C.dim}>{"] "}</Text>
      <Text color={pct === 1 ? C.green : C.yellow}>{pctStr}</Text>
    </Text>
  );
}

// ─── Focusable Session Card ──────────────────────────────────
function SessionCard({
  name,
  tasks,
  focused,
  expanded,
}: {
  name: string;
  tasks: Array<{ label: string; status: string }>;
  focused: boolean;
  expanded: boolean;
}) {
  const done = tasks.filter((t) => t.status === "done").length;
  const borderColor = focused ? C.green : C.dim;
  const icon: Record<string, string> = { done: "✓", active: "▶", pending: "○" };
  const color: Record<string, string> = { done: C.dim, active: C.yellow, pending: C.gray };

  if (!expanded) {
    return (
      <Box>
        <Text color={focused ? C.green : C.gray}>
          {focused ? "▸ " : "  "}
        </Text>
        <Text color={focused ? C.cyan : C.gray} bold={focused}>
          {name}
        </Text>
        <Text color={C.dim}>
          {" — "}{done}/{tasks.length} done
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text>
          <Text color={C.green}>{focused ? "▸ " : "  "}</Text>
          <Text color={C.cyan} bold>{name}</Text>
        </Text>
        <HackerProgress done={done} total={tasks.length} width={15} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {tasks.map((t, i) => (
          <Box key={i}>
            <Text color={color[t.status] ?? C.gray}>
              {"  "}{icon[t.status] ?? "?"} {t.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ─── Keyboard Help ───────────────────────────────────────────
function HelpBar() {
  return (
    <Box marginTop={1}>
      <Text color={C.dim}>
        <Text color={C.green}>↑↓</Text> navigate  <Text color={C.green}>Enter</Text> expand  <Text color={C.green}>Tab</Text> view  <Text color={C.green}>q</Text> quit
      </Text>
    </Box>
  );
}

// ─── Scan Line Effect ────────────────────────────────────────
function ScanLine() {
  const [pos, setPos] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPos((v) => (v + 1) % 3), 800);
    return () => clearInterval(t);
  }, []);

  const line = "─".repeat(55);
  const colors = [C.dim, C.gray, C.dim];
  return <Text color={colors[pos]}> {line}</Text>;
}

// ─── Main App ────────────────────────────────────────────────
const MOCK_SESSIONS = [
  {
    name: "project_claude_monitor",
    tasks: [
      { label: "#1 Setup Ink + TypeScript", status: "done" },
      { label: "#2 Add session index resolver", status: "done" },
      { label: "#3 Implement polling watcher", status: "done" },
      { label: "#4 Design hacker UI theme", status: "active" },
      { label: "#5 Add keyboard navigation", status: "pending" },
    ],
  },
  {
    name: "project_claude_sound_effects",
    tasks: [
      { label: "#1 Cross-platform audio", status: "done" },
      { label: "#2 12 theme sound packs", status: "done" },
      { label: "#3 Opencode plugin", status: "active" },
    ],
  },
  {
    name: "project_keyboard",
    tasks: [
      { label: "#1 Next.js 15 setup", status: "done" },
      { label: "#2 Blueprint wireframes", status: "done" },
      { label: "#3 i18n configuration", status: "done" },
      { label: "#4 Build & deploy", status: "pending" },
    ],
  },
];

function App() {
  const { exit } = useApp();
  const [focusIdx, setFocusIdx] = useState(0);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set([0]));

  useInput((input, key) => {
    if (input === "q") exit();
    if (key.upArrow || input === "k") setFocusIdx((v) => Math.max(0, v - 1));
    if (key.downArrow || input === "j") setFocusIdx((v) => Math.min(MOCK_SESSIONS.length - 1, v + 1));
    if (key.return) {
      setExpandedSet((prev) => {
        const next = new Set(prev);
        next.has(focusIdx) ? next.delete(focusIdx) : next.add(focusIdx);
        return next;
      });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header />
      <StatusBar />
      <ScanLine />

      <Box flexDirection="column" marginTop={1}>
        {MOCK_SESSIONS.map((session, i) => (
          <SessionCard
            key={i}
            name={session.name}
            tasks={session.tasks}
            focused={focusIdx === i}
            expanded={expandedSet.has(i)}
          />
        ))}
      </Box>

      <ScanLine />
      <HelpBar />
    </Box>
  );
}

render(<App />);
