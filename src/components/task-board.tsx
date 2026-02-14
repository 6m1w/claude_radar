import React from "react";
import { Box, Text } from "ink";
import type { SessionData, TodoItem, TaskItem } from "../types.js";

const STATUS_ICON: Record<string, string> = {
  completed: "✓",
  in_progress: "▶",
  pending: "○",
};

const STATUS_COLOR: Record<string, string> = {
  completed: "green",
  in_progress: "yellow",
  pending: "gray",
};

function ItemRow({ item }: { item: TodoItem | TaskItem }) {
  const icon = STATUS_ICON[item.status] ?? "?";
  const color = STATUS_COLOR[item.status] ?? "white";
  const label =
    "subject" in item ? `#${item.id} ${item.subject}` : item.content;
  const owner = "owner" in item && item.owner ? ` (${item.owner})` : "";

  return (
    <Box>
      <Text color={color}> {icon} </Text>
      <Text color={item.status === "completed" ? "gray" : "white"} strikethrough={item.status === "completed"}>
        {label}
      </Text>
      {owner && <Text color="cyan">{owner}</Text>}
    </Box>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const width = 12;
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  const empty = width - filled;
  return (
    <Text>
      <Text color="green">{"█".repeat(filled)}</Text>
      <Text color="gray">{"░".repeat(empty)}</Text>
      <Text color="gray"> {done}/{total}</Text>
    </Text>
  );
}

function SessionCard({ session }: { session: SessionData }) {
  const total = session.items.length;
  const done = session.items.filter((i) => i.status === "completed").length;
  const timeAgo = formatTimeAgo(session.lastModified);
  const meta = session.meta;

  // Header: project name or fallback to UUID
  const title = meta?.projectName ?? session.id.slice(0, 8) + "...";
  const branch = meta?.gitBranch && meta.gitBranch !== "main" ? ` · ${meta.gitBranch}` : "";
  const typeIcon = session.source === "tasks" ? "📋" : "📝";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
      {/* Row 1: Project name + progress */}
      <Box justifyContent="space-between">
        <Box>
          <Text>{typeIcon} </Text>
          <Text bold color="cyan">{title}</Text>
          <Text color="gray">{branch}</Text>
        </Box>
        <Box>
          <ProgressBar done={done} total={total} />
          <Text color="gray"> · {timeAgo}</Text>
        </Box>
      </Box>

      {/* Row 2: Session summary or first prompt snippet */}
      {meta?.summary && (
        <Text color="gray" italic>  {meta.summary}</Text>
      )}
      {!meta?.summary && meta?.firstPrompt && (
        <Text color="gray" italic dimColor>  {meta.firstPrompt.slice(0, 60)}...</Text>
      )}

      {/* Task list */}
      <Box flexDirection="column" marginTop={1}>
        {session.items.map((item, i) => (
          <ItemRow key={i} item={item} />
        ))}
      </Box>
    </Box>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TaskBoard({ sessions }: { sessions: SessionData[] }) {
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="gray">No active tasks or todos found.</Text>
        <Text color="gray">Watching ~/.claude/todos/ and ~/.claude/tasks/ ...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {sessions.map((session) => (
        <SessionCard key={`${session.source}-${session.id}`} session={session} />
      ))}
    </Box>
  );
}
