import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync, unlinkSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import type {
  ProjectData,
  SessionData,
  SessionMeta,
  TodoItem,
  TaskItem,
  DisplayItem,
  MergedProjectData,
  ProjectStore,
  SessionStore,
  StoredItem,
  StoreMeta,
  HookEvent,
  HookEventData,
  HookSessionInfo,
  ActivityEvent,
  ActivityAlert,
} from "../types.js";

const STORE_DIR = join(homedir(), ".claude-radar");
const PROJECTS_DIR = join(STORE_DIR, "projects");
const META_PATH = join(STORE_DIR, "meta.json");
export const EVENTS_PATH = join(STORE_DIR, "events.jsonl");

const SCHEMA_VERSION = 1;

// ─── Helpers ─────────────────────────────────────────────────

function projectHash(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

function nowISO(): string {
  return new Date().toISOString();
}

// Get a stable identity key for matching live items to stored items
function itemKey(item: TodoItem | TaskItem): string {
  if ("id" in item && item.id) return `task:${item.id}`;
  if ("content" in item) return `todo:${item.content}`;
  return `unknown:${JSON.stringify(item)}`;
}

// Convert a live item (TodoItem | TaskItem) to StoredItem
function toStoredItem(item: TodoItem | TaskItem, now: string): StoredItem {
  const base: StoredItem = {
    status: item.status,
    activeForm: item.activeForm,
    _firstSeenAt: now,
    _lastSeenAt: now,
    _statusChangedAt: now,
    _gone: false,
  };

  if ("id" in item) {
    // TaskItem
    const task = item as TaskItem;
    base.id = task.id;
    base.subject = task.subject;
    base.description = task.description;
    base.owner = task.owner;
    base.blocks = task.blocks;
    base.blockedBy = task.blockedBy;
  } else {
    // TodoItem
    base.content = (item as TodoItem).content;
  }

  return base;
}

// Update a stored item with fresh live data (preserve tracking fields)
function updateStoredItem(stored: StoredItem, live: TodoItem | TaskItem, now: string): StoredItem {
  const updated = toStoredItem(live, now);
  updated._firstSeenAt = stored._firstSeenAt;
  updated._lastSeenAt = now;
  // Preserve statusChangedAt unless the status actually changed
  updated._statusChangedAt = stored.status !== live.status ? now : (stored._statusChangedAt ?? now);
  updated._gone = false;
  updated._goneAt = undefined;
  return updated;
}

// ─── Store class ─────────────────────────────────────────────

export class Store {
  private projects = new Map<string, ProjectStore>();
  private dirty = new Set<string>(); // projectPaths that need saving

  // Hook-tracked active sessions: projectPath → Map<sessionId, HookSessionInfo>
  // Populated by SessionStart events, cleared by Stop events.
  // Not persisted — rebuilt from events.jsonl on each TUI startup.
  private _hookActiveSessions = new Map<string, Map<string, HookSessionInfo>>();

  // In-memory activity buffer: projectPath → recent ActivityEvent[]
  // Ring buffer per project (~50 events). Not persisted — ephemeral observability.
  private _activityBuffers = new Map<string, ActivityEvent[]>();
  private static ACTIVITY_BUFFER_SIZE = 50;

  // Load all project files from disk
  load(): void {
    if (!existsSync(PROJECTS_DIR)) return;

    try {
      const files = readdirSync(PROJECTS_DIR).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const data = readJson<ProjectStore>(join(PROJECTS_DIR, file));
        if (data?.projectPath) {
          this.projects.set(data.projectPath, data);
        }
      }
    } catch {
      // Store dir may not be readable
    }
  }

  // Save only dirty project files to disk
  save(): void {
    if (this.dirty.size === 0) return;

    mkdirSync(PROJECTS_DIR, { recursive: true });

    const now = nowISO();
    for (const projectPath of this.dirty) {
      const store = this.projects.get(projectPath);
      if (!store) continue;

      store.updatedAt = now;
      const hash = projectHash(projectPath);
      writeJson(join(PROJECTS_DIR, `${hash}.json`), store);
    }

    // Update meta
    const meta: StoreMeta = {
      schemaVersion: SCHEMA_VERSION,
      lastScanAt: now,
      projectCount: this.projects.size,
    };
    writeJson(META_PATH, meta);

    this.dirty.clear();
  }

  // Merge live scanner data with stored history
  merge(liveProjects: ProjectData[]): MergedProjectData[] {
    const now = nowISO();
    const liveByPath = new Map<string, ProjectData>();
    for (const p of liveProjects) {
      liveByPath.set(p.projectPath, p);
    }

    // Track which stored projects have live data
    const seenPaths = new Set<string>();

    // Process live projects
    const merged: MergedProjectData[] = [];
    for (const liveProject of liveProjects) {
      seenPaths.add(liveProject.projectPath);
      const result = this.mergeProject(liveProject, now);
      merged.push(result);
    }

    // Mark stored-only projects as gone (no live data)
    for (const [projectPath, store] of this.projects) {
      if (seenPaths.has(projectPath)) continue;

      let changed = false;
      for (const session of Object.values(store.sessions)) {
        if (!session.gone) {
          session.gone = true;
          session.goneAt = session.goneAt ?? now;
          for (const item of session.items) {
            if (!item._gone) {
              item._gone = true;
              item._goneAt = item._goneAt ?? now;
            }
          }
          changed = true;
        }
      }
      if (changed) this.dirty.add(projectPath);

      // Build a MergedProjectData for historical-only projects
      merged.push(this.buildHistoricalProject(store));
      seenPaths.add(projectPath);
    }

    // Include hook-only projects (active sessions but no tasks/store yet)
    for (const [projectPath, sessions] of this._hookActiveSessions) {
      if (seenPaths.has(projectPath) || sessions.size === 0) continue;
      merged.push(this.buildHookOnlyProject(projectPath, [...sessions.values()]));
    }

    return merged;
  }

  private mergeProject(liveProject: ProjectData, now: string): MergedProjectData {
    let store = this.projects.get(liveProject.projectPath);
    if (!store) {
      store = {
        projectPath: liveProject.projectPath,
        projectName: liveProject.projectName,
        updatedAt: now,
        sessions: {},
      };
      this.projects.set(liveProject.projectPath, store);
    }

    const liveSessionIds = new Set<string>();

    // Merge each live session
    for (const liveSession of liveProject.sessions) {
      liveSessionIds.add(liveSession.id);
      this.mergeSession(store, liveSession, now);
    }

    // Mark stored sessions that are no longer live as gone
    for (const [sessionId, storedSession] of Object.entries(store.sessions)) {
      if (liveSessionIds.has(sessionId)) continue;
      if (!storedSession.gone) {
        storedSession.gone = true;
        storedSession.goneAt = storedSession.goneAt ?? now;
        for (const item of storedSession.items) {
          if (!item._gone) {
            item._gone = true;
            item._goneAt = item._goneAt ?? now;
          }
        }
        this.dirty.add(liveProject.projectPath);
      }
    }

    this.dirty.add(liveProject.projectPath);

    // Build merged result: live project data + gone sessions/items from store
    return this.buildMergedProject(liveProject, store);
  }

  private mergeSession(store: ProjectStore, liveSession: SessionData, now: string): void {
    const existing = store.sessions[liveSession.id];

    if (!existing) {
      // New session — store it
      store.sessions[liveSession.id] = {
        id: liveSession.id,
        source: liveSession.source,
        firstSeenAt: now,
        lastSeenAt: now,
        gone: false,
        meta: liveSession.meta,
        items: liveSession.items.map((item) => toStoredItem(item, now)),
      };
      return;
    }

    // Existing session — update it
    existing.lastSeenAt = now;
    existing.gone = false;
    existing.goneAt = undefined;
    if (liveSession.meta) existing.meta = liveSession.meta;

    // Build index of stored items by key
    const storedByKey = new Map<string, number>();
    for (let i = 0; i < existing.items.length; i++) {
      const key = storedItemKey(existing.items[i]);
      storedByKey.set(key, i);
    }

    // Merge live items
    const liveKeys = new Set<string>();
    for (const liveItem of liveSession.items) {
      const key = itemKey(liveItem);
      liveKeys.add(key);

      const storedIdx = storedByKey.get(key);
      if (storedIdx !== undefined) {
        // Update existing item
        existing.items[storedIdx] = updateStoredItem(existing.items[storedIdx], liveItem, now);
      } else {
        // New item
        existing.items.push(toStoredItem(liveItem, now));
      }
    }

    // Mark stored items not in live as gone
    for (const item of existing.items) {
      const key = storedItemKey(item);
      if (!liveKeys.has(key) && !item._gone) {
        item._gone = true;
        item._goneAt = item._goneAt ?? now;
      }
    }
  }

  private buildMergedProject(liveProject: ProjectData, store: ProjectStore): MergedProjectData {
    // Collect gone sessions from store (not in live data)
    const liveSessionIds = new Set(liveProject.sessions.map((s) => s.id));
    const goneSessions: SessionData[] = [];

    for (const [sessionId, storedSession] of Object.entries(store.sessions)) {
      if (liveSessionIds.has(sessionId)) continue;
      if (!storedSession.gone) continue;

      // Convert stored session back to SessionData for UI consumption
      goneSessions.push(storedSessionToSessionData(storedSession));
    }

    // Count gone items across all stored sessions (including within live sessions)
    let goneItemCount = 0;
    for (const storedSession of Object.values(store.sessions)) {
      goneItemCount += storedSession.items.filter((i) => i._gone).length;
    }

    // Enrich live sessions with gone items from store
    const enrichedSessions = liveProject.sessions.map((liveSession) => {
      const storedSession = store.sessions[liveSession.id];
      if (!storedSession) return liveSession;

      // Add gone items back to the live session
      const goneItems = storedSession.items
        .filter((i) => i._gone)
        .map(storedItemToDisplayItem);

      if (goneItems.length === 0) return liveSession;

      return {
        ...liveSession,
        items: [...liveSession.items, ...goneItems],
      };
    });

    // Recompute task counts including gone items
    const allItems = [...enrichedSessions, ...goneSessions].flatMap((s) => s.items);
    const totalTasks = allItems.length;
    const completedTasks = allItems.filter((i) => i.status === "completed").length;
    const inProgressTasks = allItems.filter((i) => i.status === "in_progress").length;

    return {
      ...liveProject,
      sessions: [...enrichedSessions, ...goneSessions],
      totalTasks,
      completedTasks,
      inProgressTasks,
      hasHistory: goneSessions.length > 0 || goneItemCount > 0,
      goneSessionCount: goneSessions.length,
      hookSessions: this.getHookSessions(liveProject.projectPath),
      activityLog: this.getActivityLog(liveProject.projectPath),
      activityAlerts: detectPatterns(this.getActivityLog(liveProject.projectPath)),
    };
  }

  // ─── Public helpers for hook event ingestion ───────────────

  ensureProject(projectPath: string, projectName: string): void {
    if (this.projects.has(projectPath)) return;
    this.projects.set(projectPath, {
      projectPath,
      projectName,
      updatedAt: nowISO(),
      sessions: {},
    });
    this.dirty.add(projectPath);
  }

  ensureSession(projectPath: string, sessionId: string, source: "todos" | "tasks", meta?: SessionMeta): void {
    const store = this.projects.get(projectPath);
    if (!store) return;
    if (store.sessions[sessionId]) return;

    store.sessions[sessionId] = {
      id: sessionId,
      source,
      firstSeenAt: nowISO(),
      lastSeenAt: nowISO(),
      gone: false,
      meta,
      items: [],
    };
    this.dirty.add(projectPath);
  }

  mergeHookItem(projectPath: string, sessionId: string, item: StoredItem): void {
    const store = this.projects.get(projectPath);
    if (!store) return;
    const session = store.sessions[sessionId];
    if (!session) return;

    const key = item.id ? `task:${item.id}` : item.content ? `todo:${item.content}` : null;
    if (!key) return;

    // Find existing item by key
    const existingIdx = session.items.findIndex((i) => storedItemKey(i) === key);
    if (existingIdx >= 0) {
      // Update existing — preserve _firstSeenAt, detect status change for dwell time
      const existing = session.items[existingIdx];
      const updated = { ...existing, ...item };
      updated._firstSeenAt = existing._firstSeenAt;
      updated._statusChangedAt = existing.status !== item.status
        ? item._lastSeenAt
        : (existing._statusChangedAt ?? item._lastSeenAt);
      updated._gone = false;
      updated._goneAt = undefined;
      session.items[existingIdx] = updated;
    } else {
      // New item
      session.items.push(item);
    }

    session.lastSeenAt = item._lastSeenAt;
    session.gone = false;
    session.goneAt = undefined;
    this.dirty.add(projectPath);
  }

  markSessionStopped(sessionId: string, timestamp: string): void {
    // Remove from hook active sessions
    for (const [, sessions] of this._hookActiveSessions) {
      sessions.delete(sessionId);
    }

    for (const [projectPath, store] of this.projects) {
      const session = store.sessions[sessionId];
      if (!session) continue;
      // Don't mark as gone — just update lastSeenAt
      // The polling layer will handle gone detection on the next cycle
      session.lastSeenAt = timestamp;
      this.dirty.add(projectPath);
      return;
    }
  }

  // Track a session as active via SessionStart hook event
  markSessionStarted(projectPath: string, sessionId: string, timestamp: string): void {
    let sessions = this._hookActiveSessions.get(projectPath);
    if (!sessions) {
      sessions = new Map();
      this._hookActiveSessions.set(projectPath, sessions);
    }
    sessions.set(sessionId, { sessionId, projectPath, startedAt: timestamp });
  }

  // Get hook-tracked active sessions for a project
  getHookSessions(projectPath: string): HookSessionInfo[] {
    const sessions = this._hookActiveSessions.get(projectPath);
    return sessions ? [...sessions.values()] : [];
  }

  // Add an activity event to the project's ring buffer
  addActivity(projectPath: string, event: ActivityEvent): void {
    let buf = this._activityBuffers.get(projectPath);
    if (!buf) {
      buf = [];
      this._activityBuffers.set(projectPath, buf);
    }
    buf.push(event);
    if (buf.length > Store.ACTIVITY_BUFFER_SIZE) {
      buf.splice(0, buf.length - Store.ACTIVITY_BUFFER_SIZE);
    }
  }

  // Get recent activity for a project
  getActivityLog(projectPath: string): ActivityEvent[] {
    return this._activityBuffers.get(projectPath) ?? [];
  }

  // Get all hook-tracked active sessions across all projects
  getAllHookSessions(): Map<string, HookSessionInfo[]> {
    const result = new Map<string, HookSessionInfo[]>();
    for (const [path, sessions] of this._hookActiveSessions) {
      if (sessions.size > 0) {
        result.set(path, [...sessions.values()]);
      }
    }
    return result;
  }

  private buildHookOnlyProject(projectPath: string, hookSessions: HookSessionInfo[]): MergedProjectData {
    return {
      projectPath,
      projectName: basename(projectPath),
      sessions: [],
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      agents: [],
      lastActivity: new Date(hookSessions[0]?.startedAt ?? Date.now()),
      isActive: true, // has active hook sessions
      totalSessions: 0,
      activeSessions: hookSessions.length,
      docs: [],
      gitLog: [],
      docContents: {},
      recentSessions: [],
      agentDetails: [],
      hasHistory: false,
      goneSessionCount: 0,
      hookSessions,
      activityLog: this.getActivityLog(projectPath),
      activityAlerts: detectPatterns(this.getActivityLog(projectPath)),
    };
  }

  private buildHistoricalProject(store: ProjectStore): MergedProjectData {
    const sessions = Object.values(store.sessions).map(storedSessionToSessionData);
    const allItems = sessions.flatMap((s) => s.items);

    return {
      projectPath: store.projectPath,
      projectName: store.projectName,
      sessions,
      totalTasks: allItems.length,
      completedTasks: allItems.filter((i) => i.status === "completed").length,
      inProgressTasks: 0,
      agents: [],
      lastActivity: new Date(store.updatedAt),
      isActive: false,
      totalSessions: 0,
      activeSessions: 0,
      docs: [],
      gitLog: [],
      docContents: {},
      recentSessions: [],
      agentDetails: [],
      hasHistory: true,
      goneSessionCount: sessions.length,
      hookSessions: this.getHookSessions(store.projectPath),
      activityLog: this.getActivityLog(store.projectPath),
      activityAlerts: detectPatterns(this.getActivityLog(store.projectPath)),
    };
  }
}

// ─── Pattern detection on activity log ───────────────────────

// Thresholds for pattern detection
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const CONSECUTIVE_RETRY_THRESHOLD = 4;
const LONG_TURN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Scan activity events for anomalous patterns.
 * Returns alerts for: repeated tool failures, repeated Task retries, long turns.
 */
function detectPatterns(events: ActivityEvent[]): ActivityAlert[] {
  if (events.length === 0) return [];

  const alerts: ActivityAlert[] = [];

  // Group events by session for per-session pattern detection
  const bySession = new Map<string, ActivityEvent[]>();
  for (const ev of events) {
    let arr = bySession.get(ev.sessionId);
    if (!arr) {
      arr = [];
      bySession.set(ev.sessionId, arr);
    }
    arr.push(ev);
  }

  for (const [sessionId, sessionEvents] of bySession) {
    // 1. Repeated failures: same tool fails N+ times in a row
    let failRun = 0;
    let failTool = "";
    let failLast: ActivityEvent | null = null;

    for (const ev of sessionEvents) {
      if (ev.isError && ev.toolName === failTool && failTool !== "") {
        failRun++;
        failLast = ev;
      } else if (ev.isError) {
        // New failing tool — flush previous run if it hit threshold
        if (failRun >= CONSECUTIVE_FAILURE_THRESHOLD && failLast) {
          alerts.push({
            type: "repeated_failure",
            severity: failRun >= 5 ? "error" : "warning",
            message: `${failTool} failed ${failRun} times in a row`,
            count: failRun,
            sessionId,
            projectPath: failLast.projectPath,
            ts: failLast.ts,
          });
        }
        failTool = ev.toolName;
        failRun = 1;
        failLast = ev;
      } else {
        // Success breaks the run — flush if threshold met
        if (failRun >= CONSECUTIVE_FAILURE_THRESHOLD && failLast) {
          alerts.push({
            type: "repeated_failure",
            severity: failRun >= 5 ? "error" : "warning",
            message: `${failTool} failed ${failRun} times in a row`,
            count: failRun,
            sessionId,
            projectPath: failLast.projectPath,
            ts: failLast.ts,
          });
        }
        failRun = 0;
        failTool = "";
        failLast = null;
      }
    }
    // Flush trailing run
    if (failRun >= CONSECUTIVE_FAILURE_THRESHOLD && failLast) {
      alerts.push({
        type: "repeated_failure",
        severity: failRun >= 5 ? "error" : "warning",
        message: `${failTool} failed ${failRun} times in a row`,
        count: failRun,
        sessionId,
        projectPath: failLast.projectPath,
        ts: failLast.ts,
      });
    }

    // 2. Repeated Task retries: Task tool called N+ times in a row (agent stuck in spawn loop)
    let taskRun = 0;
    let taskLast: ActivityEvent | null = null;

    for (const ev of sessionEvents) {
      if (ev.toolName === "Task") {
        taskRun++;
        taskLast = ev;
      } else {
        if (taskRun >= CONSECUTIVE_RETRY_THRESHOLD && taskLast) {
          alerts.push({
            type: "repeated_retry",
            severity: taskRun >= 6 ? "error" : "warning",
            message: `Task tool called ${taskRun} times in a row (possible retry loop)`,
            count: taskRun,
            sessionId,
            projectPath: taskLast.projectPath,
            ts: taskLast.ts,
          });
        }
        taskRun = 0;
        taskLast = null;
      }
    }
    if (taskRun >= CONSECUTIVE_RETRY_THRESHOLD && taskLast) {
      alerts.push({
        type: "repeated_retry",
        severity: taskRun >= 6 ? "error" : "warning",
        message: `Task tool called ${taskRun} times in a row (possible retry loop)`,
        count: taskRun,
        sessionId,
        projectPath: taskLast.projectPath,
        ts: taskLast.ts,
      });
    }

    // 3. Long turns: _turn_complete events with durationMs > threshold
    for (const ev of sessionEvents) {
      if (ev.toolName === "_turn_complete" && ev.durationMs && ev.durationMs > LONG_TURN_THRESHOLD_MS) {
        const mins = Math.floor(ev.durationMs / 60000);
        alerts.push({
          type: "long_turn",
          severity: ev.durationMs > 10 * 60 * 1000 ? "error" : "warning",
          message: `Turn took ${mins}+ minutes`,
          count: 1,
          sessionId,
          projectPath: ev.projectPath,
          ts: ev.ts,
        });
      }
    }
  }

  return alerts;
}

// ─── Event consumption (Layer 1: Hook events) ───────────────

// Byte offset tracker for incremental reads
let eventsOffset = 0;

// Read new lines from events.jsonl since last offset
export function consumeEvents(): HookEvent[] {
  if (!existsSync(EVENTS_PATH)) return [];

  try {
    const stat = statSync(EVENTS_PATH);
    if (stat.size <= eventsOffset) {
      // File was truncated or no new data
      if (stat.size < eventsOffset) eventsOffset = 0;
      return [];
    }

    const bytesToRead = stat.size - eventsOffset;
    const buf = Buffer.alloc(bytesToRead);
    const fd = openSync(EVENTS_PATH, "r");
    readSync(fd, buf, 0, bytesToRead, eventsOffset);
    closeSync(fd);

    eventsOffset = stat.size;

    const lines = buf.toString("utf-8").split("\n").filter((l) => l.trim());
    const events: HookEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

// Truncate events.jsonl after successful consumption
export function truncateEvents(): void {
  if (!existsSync(EVENTS_PATH)) return;

  try {
    const consumed = EVENTS_PATH + ".consumed";
    renameSync(EVENTS_PATH, consumed);
    writeFileSync(EVENTS_PATH, "", "utf-8");
    unlinkSync(consumed);
    eventsOffset = 0;
  } catch {
    // Race condition with capture.sh — safe to ignore
  }
}

// Reset offset (for testing)
export function resetEventsOffset(): void {
  eventsOffset = 0;
}

// Derive projectPath from cwd (hook events carry cwd, not projectPath)
function cwdToProjectPath(cwd: string): string {
  return cwd;
}

// Build a human-readable summary for an activity event
function buildActivitySummary(data: HookEventData): string {
  const tool = data.tool_name ?? "unknown";
  const input = data.tool_input;

  if (!input) return tool;

  switch (tool) {
    case "Write":
    case "Read":
    case "Edit":
      return `${tool} ${shortenPath(input.file_path as string | undefined)}`;
    case "Bash":
      return `Bash: ${truncate(input.command as string | undefined, 60)}`;
    case "Grep":
      return `Grep: ${truncate(input.pattern as string | undefined, 40)}`;
    case "Glob":
      return `Glob: ${truncate(input.pattern as string | undefined, 40)}`;
    case "SendMessage":
      return `SendMessage → ${input.recipient ?? "broadcast"}`;
    case "TaskCreate":
      return `TaskCreate: ${truncate(input.subject as string | undefined, 50)}`;
    case "TaskUpdate":
      return `TaskUpdate #${input.taskId ?? "?"} → ${input.status ?? ""}`;
    case "TodoWrite":
      return "TodoWrite";
    case "Task": {
      const agentType = input.subagent_type as string | undefined;
      const desc = (input.description as string | undefined) ?? (input.prompt as string | undefined);
      return agentType
        ? `Task[${agentType}]: ${truncate(desc, 40)}`
        : `Task: ${truncate(desc, 50)}`;
    }
    case "EnterPlanMode":
      return "[PLAN] Entered plan mode";
    case "ExitPlanMode":
      return "[PLAN] Plan ready for approval";
    case "TaskList":
      return "TaskList";
    case "TaskGet":
      return `TaskGet #${input.taskId ?? "?"}`;
    default:
      return tool;
  }
}

// Shorten an absolute path to basename (or last 2 segments)
function shortenPath(p: string | undefined): string {
  if (!p) return "?";
  const parts = p.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : parts[parts.length - 1];
}

// Truncate a string with ellipsis
function truncate(s: string | undefined, max: number): string {
  if (!s) return "?";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Task-related tool names that get ingested into the store (not just activity)
const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TodoWrite"]);

// Convert a hook event into a StoredItem to merge into the store
function hookEventToStoredItem(data: HookEventData, now: string): StoredItem | null {
  const input = data.tool_input;
  if (!input) return null;

  const toolName = data.tool_name;

  if (toolName === "TaskCreate") {
    return {
      id: (input.id as string) ?? String(Date.now()),
      subject: (input.subject as string) ?? "",
      description: (input.description as string) ?? "",
      activeForm: input.activeForm as string | undefined,
      status: (input.status as StoredItem["status"]) ?? "pending",
      owner: input.owner as string | undefined,
      blocks: (input.blocks as string[]) ?? [],
      blockedBy: (input.blockedBy as string[]) ?? [],
      _firstSeenAt: now,
      _lastSeenAt: now,
      _statusChangedAt: now,
      _gone: false,
    };
  }

  if (toolName === "TaskUpdate") {
    // TaskUpdate only carries changed fields — create a partial item
    // The merge algorithm will match by id and update
    const taskId = input.taskId as string;
    if (!taskId) return null;
    return {
      id: taskId,
      subject: input.subject as string | undefined,
      description: input.description as string | undefined,
      activeForm: input.activeForm as string | undefined,
      status: (input.status as StoredItem["status"]) ?? "pending",
      owner: input.owner as string | undefined,
      _firstSeenAt: now,
      _lastSeenAt: now,
      _statusChangedAt: now,
      _gone: false,
    };
  }

  if (toolName === "TodoWrite") {
    // TodoWrite typically writes the full todo list, extract items
    // The tool_input might contain content and status
    return {
      content: (input.content as string) ?? (input.subject as string) ?? "",
      status: (input.status as StoredItem["status"]) ?? "pending",
      activeForm: input.activeForm as string | undefined,
      _firstSeenAt: now,
      _lastSeenAt: now,
      _statusChangedAt: now,
      _gone: false,
    };
  }

  return null;
}

// Ingest hook events into the Store
// Called by merge() — hook events are folded into stored sessions + activity buffer
export function ingestHookEvents(store: Store, events: HookEvent[]): void {
  const now = nowISO();

  for (const event of events) {
    const data = event.data;
    if (!data?.session_id) continue;

    const sessionId = data.session_id;
    const cwd = data.cwd;

    // "tool" = new format (all PostToolUse), "tool_failure" = PostToolUseFailure,
    // "task" = legacy format (matched PostToolUse)
    if ((event.event === "tool" || event.event === "tool_failure" || event.event === "task") && data.tool_name) {
      const isFailure = event.event === "tool_failure";
      const projectPath = cwd ? cwdToProjectPath(cwd) : undefined;
      if (!projectPath) continue;

      // Activity log: ALL tool calls get recorded
      const summary = isFailure
        ? `❌ ${buildActivitySummary(data)}`
        : buildActivitySummary(data);
      store.addActivity(projectPath, {
        ts: event.ts || now,
        sessionId,
        toolName: data.tool_name,
        summary,
        projectPath,
        ...(isFailure && { isError: true }),
      });

      // Task ingestion: only task-related tools get merged into store (skip failures)
      if (!isFailure && TASK_TOOLS.has(data.tool_name)) {
        const item = hookEventToStoredItem(data, event.ts || now);
        if (!item) continue;

        store.ensureProject(projectPath, basename(projectPath));

        const source = data.tool_name === "TodoWrite" ? "todos" as const : "tasks" as const;
        store.ensureSession(projectPath, sessionId, source, {
          projectPath,
          projectName: basename(projectPath),
        });

        store.mergeHookItem(projectPath, sessionId, item);
      }
    }

    if (event.event === "start") {
      const projectPath = cwd ? cwdToProjectPath(cwd) : undefined;
      if (projectPath) {
        store.markSessionStarted(projectPath, sessionId, event.ts || now);
      }
    }

    if (event.event === "stop") {
      store.markSessionStopped(sessionId, event.ts || now);
    }

    // Subagent/notification events → activity log only
    if ((event.event === "subagent_stop" || event.event === "notification") && cwd) {
      const projectPath = cwdToProjectPath(cwd);
      const summary = event.event === "subagent_stop"
        ? `SubagentStop: ${data.tool_name ? `${data.tool_name} ` : ""}${data.reason ?? "completed"}`
        : `Notification: ${truncate(data.reason, 50)}`;
      store.addActivity(projectPath, {
        ts: event.ts || now,
        sessionId,
        toolName: event.event,
        summary,
        projectPath,
      });
    }
  }
}

// ─── Conversion helpers ──────────────────────────────────────

// Get identity key from a stored item
function storedItemKey(item: StoredItem): string {
  if (item.id) return `task:${item.id}`;
  if (item.content) return `todo:${item.content}`;
  return `unknown:${JSON.stringify(item)}`;
}

// Convert StoredItem back to DisplayItem for UI consumption
// Preserves _gone metadata so the UI can distinguish live vs historical items
function storedItemToDisplayItem(item: StoredItem): DisplayItem {
  const base: DisplayItem = item.id
    ? {
        id: item.id,
        subject: item.subject ?? "",
        description: item.description ?? "",
        activeForm: item.activeForm,
        status: item.status,
        owner: item.owner,
        blocks: item.blocks ?? [],
        blockedBy: item.blockedBy ?? [],
      } as DisplayItem
    : {
        content: item.content ?? "",
        status: item.status,
        activeForm: item.activeForm,
      } as DisplayItem;

  if (item._gone) {
    base._gone = true;
    base._goneAt = item._goneAt;
  }
  if (item._statusChangedAt) {
    base._statusChangedAt = item._statusChangedAt;
  }
  return base;
}

// Convert SessionStore to SessionData for UI consumption
function storedSessionToSessionData(stored: SessionStore): SessionData {
  return {
    id: stored.id,
    source: stored.source,
    lastModified: new Date(stored.lastSeenAt),
    items: stored.items.map(storedItemToDisplayItem),
    meta: stored.meta,
    gone: stored.gone,
  };
}

// ─── Public API ──────────────────────────────────────────────

export function initStore(): Store {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  const store = new Store();
  store.load();
  return store;
}

export function loadStore(): Store {
  const store = new Store();
  store.load();
  return store;
}

export function mergeAndPersist(
  liveProjects: ProjectData[],
  store: Store
): MergedProjectData[] {
  // Layer 1: Ingest any pending hook events first
  const events = consumeEvents();
  if (events.length > 0) {
    ingestHookEvents(store, events);
  }

  // Layer 2: Merge live scanner data with stored history
  const merged = store.merge(liveProjects);
  store.save();

  // Truncate events.jsonl periodically (when TUI has consumed all events)
  if (events.length > 0) {
    truncateEvents();
  }

  return merged;
}

// Exported for testing
export { detectPatterns };
