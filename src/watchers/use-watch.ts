import { useState, useEffect, useRef, useCallback } from "react";
import { watch } from "chokidar";
import { scanAll } from "./scanner.js";
import { initStore, mergeAndPersist, EVENTS_PATH } from "./store.js";
import type { SessionData, MergedProjectData } from "../types.js";

const POLL_INTERVAL_MS = 3000;

// React hook: poll ~/.claude/ for project and session data
// Dual-layer capture: Chokidar watches events.jsonl (Layer 1) + setInterval polling (Layer 2)
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

  // Shared refresh logic — scan + merge + diff + setState
  const refresh = useCallback(() => {
    const current = scanAll();
    const currentMerged = mergeAndPersist(current.projects, storeRef.current);
    const key = snapshotKey(currentMerged);
    if (key !== prevSnapshotRef.current) {
      prevSnapshotRef.current = key;
      setSessions(current.sessions);
      setProjects(currentMerged);
      setLastUpdate(new Date());
    }
  }, []);

  useEffect(() => {
    // Initial scan + merge with stored history
    refresh();

    // Layer 1: Chokidar watches events.jsonl for hook-driven updates
    // Triggers immediate refresh when capture.sh appends new events
    const watcher = watch(EVENTS_PATH, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
    });

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onEventsChange = () => {
      // Debounce: multiple rapid hook events → single refresh
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refresh, 100);
    };

    watcher.on("change", onEventsChange);
    watcher.on("add", onEventsChange);

    // Layer 2: Periodic polling as fallback (filesystem scan)
    const timer = setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
    };
  }, [refresh]);

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
      const gitHead = p.gitLog?.[0]?.hash ?? "";
      const actLen = p.activityLog?.length ?? 0;
      const actLast = p.activityLog?.[actLen - 1]?.ts ?? "";
      const planLen = p.planningLog?.length ?? 0;
      const planLast = p.planningLog?.[planLen - 1]?.ts ?? "";
      const alertKey = p.activityAlerts?.map((a) => `${a.type}:${a.count}`).join(",") ?? "";
      return `${p.projectPath}|s=${p.totalSessions}|a=${p.activeSessions}|b=${p.gitBranch ?? ""}|gl=${gitHead}|h=${p.hasHistory}|g=${p.goneSessionCount}|act=${actLen}:${actLast}|plan=${planLen}:${planLast}|alerts=${alertKey}|t=${taskKey}`;
    })
    .join("||");
}
