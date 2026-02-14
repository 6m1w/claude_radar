import React from "react";
import { Box, Text } from "ink";
import { useWatchSessions } from "./watchers/use-watch.js";
import { TaskBoard } from "./components/task-board.js";

export function App() {
  const { sessions, lastUpdate } = useWatchSessions();

  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="white">
          Claude Monitor
        </Text>
        <Text color="gray">
          {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : "Loading..."} · Ctrl+C to quit
        </Text>
      </Box>

      <TaskBoard sessions={sessions} />
    </Box>
  );
}
