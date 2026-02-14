import { useState, useEffect, useRef } from "react";
import { watch } from "chokidar";
import { homedir } from "node:os";
import { join } from "node:path";
import { scanAll } from "./scanner.js";
import type { SessionData } from "../types.js";

const CLAUDE_DIR = join(homedir(), ".claude");

// React hook: watch ~/.claude/todos/ and ~/.claude/tasks/ for changes
export function useWatchSessions(): {
  sessions: SessionData[];
  lastUpdate: Date | null;
} {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Initial scan
    setSessions(scanAll());
    setLastUpdate(new Date());

    const watcher = watch(
      [join(CLAUDE_DIR, "todos", "*.json"), join(CLAUDE_DIR, "tasks", "**", "*.json")],
      {
        ignoreInitial: true,
        // Debounce rapid changes from Claude writing multiple task files
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      }
    );

    const refresh = () => {
      // Debounce: wait 300ms after last file change before re-scanning
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSessions(scanAll());
        setLastUpdate(new Date());
      }, 300);
    };

    watcher.on("change", refresh);
    watcher.on("add", refresh);
    watcher.on("unlink", refresh);

    return () => {
      watcher.close();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { sessions, lastUpdate };
}
