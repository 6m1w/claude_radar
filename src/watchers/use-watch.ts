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
  const prevProjectsRef = useRef<MergedProjectData[]>([]);
  const storeRef = useRef(initStore());

  // Shared refresh logic — scan + merge + diff + setState
  const refresh = useCallback(() => {
    const current = scanAll();
    const currentMerged = mergeAndPersist(current.projects, storeRef.current);

    // Anti-flicker: if a project's task count drops drastically (transient file wipe),
    // keep previous snapshot for that project. Only accept gradual decreases.
    const prev = prevProjectsRef.current;
    const stabilized = prev.length > 0 ? currentMerged.map((p) => {
      const prevP = prev.find((pp) => pp.projectPath === p.projectPath);
      if (!prevP) return p;
      const prevCount = prevP.sessions.flatMap((s) => s.items).length;
      const currCount = p.sessions.flatMap((s) => s.items).length;
      // Sudden drop from >=3 to <50% = transient wipe, keep previous tasks
      if (prevCount >= 3 && currCount < prevCount * 0.5) {
        return { ...p, sessions: prevP.sessions };
      }
      return p;
    }) : currentMerged;

    const key = snapshotKey(stabilized);
    if (key !== prevSnapshotRef.current) {
      prevSnapshotRef.current = key;
      prevProjectsRef.current = stabilized;
      setSessions(current.sessions);
      setProjects(stabilized);
      setLastUpdate(new Date());
    } else {
      prevProjectsRef.current = stabilized;
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
      const evtLen = p.events?.length ?? 0;
      const evtLast = p.events?.[evtLen - 1]?.ts ?? "";
      const alertKey = p.activityAlerts?.map((a) => `${a.type}:${a.count}`).join(",") ?? "";
      const roadmapKey = p.roadmap?.map((r) => `${r.source}:${r.totalDone}/${r.totalItems}`).join(",") ?? "";
      return `${p.projectPath}|s=${p.totalSessions}|a=${p.activeSessions}|b=${p.gitBranch ?? ""}|n=${p.bestSessionName ?? ""}|gl=${gitHead}|h=${p.hasHistory}|g=${p.goneSessionCount}|evt=${evtLen}:${evtLast}|alerts=${alertKey}|rm=${roadmapKey}|t=${taskKey}`;
    })
    .join("||");
}
