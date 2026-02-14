import { useState, useEffect, useRef } from "react";
import { scanAll } from "./scanner.js";
import type { SessionData, ProjectData } from "../types.js";

const POLL_INTERVAL_MS = 3000;

// React hook: poll ~/.claude/ for project and session data
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
    setSessions(initial.sessions);
    setProjects(initial.projects);
    setLastUpdate(new Date());
    prevSnapshotRef.current = snapshotKey(initial.projects);

    // Poll: re-scan periodically, only re-render if data actually changed
    const timer = setInterval(() => {
      const current = scanAll();
      const key = snapshotKey(current.projects);
      if (key !== prevSnapshotRef.current) {
        prevSnapshotRef.current = key;
        setSessions(current.sessions);
        setProjects(current.projects);
        setLastUpdate(new Date());
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return { sessions, projects, lastUpdate };
}

// Lightweight fingerprint to detect actual data changes
// Includes project-level info (sessions, activity) not just task status
function snapshotKey(projects: ProjectData[]): string {
  return projects
    .map((p) => {
      const taskKey = p.sessions
        .flatMap((s) => s.items)
        .map((i) => ("id" in i ? `${i.id}:${i.status}` : `${i.content}:${i.status}`))
        .join(",");
      return `${p.projectPath}|s=${p.totalSessions}|a=${p.activeSessions}|b=${p.gitBranch ?? ""}|t=${taskKey}`;
    })
    .join("||");
}
