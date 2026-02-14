import { useState, useEffect, useRef } from "react";
import { scanAll } from "./scanner.js";
import { initStore, mergeAndPersist } from "./store.js";
import type { SessionData, MergedProjectData } from "../types.js";

const POLL_INTERVAL_MS = 3000;

// React hook: poll ~/.claude/ for project and session data
// Integrates persistence layer — merges live data with stored history
export function useWatchSessions(): {
  sessions: SessionData[];
  projects: MergedProjectData[];
  lastUpdate: Date | null;
} {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [projects, setProjects] = useState<MergedProjectData[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const prevSnapshotRef = useRef<string>("");
  const storeRef = useRef(initStore());

  useEffect(() => {
    // Initial scan + merge with stored history
    const initial = scanAll();
    const merged = mergeAndPersist(initial.projects, storeRef.current);
    setSessions(initial.sessions);
    setProjects(merged);
    setLastUpdate(new Date());
    prevSnapshotRef.current = snapshotKey(merged);

    // Poll: re-scan periodically, only re-render if data actually changed
    const timer = setInterval(() => {
      const current = scanAll();
      const currentMerged = mergeAndPersist(current.projects, storeRef.current);
      const key = snapshotKey(currentMerged);
      if (key !== prevSnapshotRef.current) {
        prevSnapshotRef.current = key;
        setSessions(current.sessions);
        setProjects(currentMerged);
        setLastUpdate(new Date());
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return { sessions, projects, lastUpdate };
}

// Lightweight fingerprint to detect actual data changes
// Includes project-level info (sessions, activity) not just task status
function snapshotKey(projects: MergedProjectData[]): string {
  return projects
    .map((p) => {
      const taskKey = p.sessions
        .flatMap((s) => s.items)
        .map((i) => ("id" in i ? `${i.id}:${i.status}` : `${i.content}:${i.status}`))
        .join(",");
      return `${p.projectPath}|s=${p.totalSessions}|a=${p.activeSessions}|b=${p.gitBranch ?? ""}|h=${p.hasHistory}|g=${p.goneSessionCount}|t=${taskKey}`;
    })
    .join("||");
}
