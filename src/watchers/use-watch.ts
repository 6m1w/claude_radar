import { useState, useEffect, useRef } from "react";
import { scanAll, groupByProject } from "./scanner.js";
import type { SessionData, ProjectData } from "../types.js";

const POLL_INTERVAL_MS = 1000;

// React hook: poll ~/.claude/todos/ and ~/.claude/tasks/ for changes
export function useWatchSessions(): {
  sessions: SessionData[];
  projects: ProjectData[];
  lastUpdate: Date | null;
} {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const prevSnapshotRef = useRef<string>("");

  useEffect(() => {
    // Initial scan
    const initial = scanAll();
    setSessions(initial);
    setProjects(groupByProject(initial));
    setLastUpdate(new Date());
    prevSnapshotRef.current = snapshotKey(initial);

    // Poll: re-scan every second, only re-render if data actually changed
    const timer = setInterval(() => {
      const current = scanAll();
      const key = snapshotKey(current);
      if (key !== prevSnapshotRef.current) {
        prevSnapshotRef.current = key;
        setSessions(current);
        setProjects(groupByProject(current));
        setLastUpdate(new Date());
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return { sessions, projects, lastUpdate };
}

// Lightweight fingerprint to detect actual data changes
function snapshotKey(sessions: SessionData[]): string {
  return sessions
    .map((s) =>
      s.items
        .map((i) => ("id" in i ? `${i.id}:${i.status}` : `${i.content}:${i.status}`))
        .join(",")
    )
    .join("|");
}
