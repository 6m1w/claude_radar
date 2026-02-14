// TodoWrite system (~/.claude/todos/)
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

// TaskCreate system (~/.claude/tasks/)
export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  blocks: string[];
  blockedBy: string[];
}

// Session metadata from ~/.claude/projects/*/sessions-index.json
export interface SessionMeta {
  projectPath: string;
  projectName: string;
  summary?: string;
  firstPrompt?: string;
  gitBranch?: string;
}

// Display-layer metadata attached to items after store merge
// Allows UI to distinguish live vs historical (gone) items
export type DisplayItem = (TodoItem | TaskItem) & {
  _gone?: boolean;
  _goneAt?: string;
};

// Unified view model
export interface SessionData {
  id: string;
  source: "todos" | "tasks";
  lastModified: Date;
  items: DisplayItem[];
  meta?: SessionMeta;
  gone?: boolean;        // session itself is no longer in live data
}

// Aggregated project view — groups sessions by projectPath
export interface ProjectData {
  projectPath: string;
  projectName: string;
  gitBranch?: string;
  sessions: SessionData[];
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  agents: string[];       // unique owner/agent names
  lastActivity: Date;
  isActive: boolean;      // has any in_progress task
  // New: session activity (from .jsonl file mtimes)
  totalSessions: number;
  activeSessions: number; // sessions modified within last 5 min
  // New: project enrichment (from actual project directory)
  git?: {
    branch: string;
    dirty?: boolean;
  };
  docs: string[];          // detected doc files: "PRD.md", "CLAUDE.md", etc.
  // Session history from sessions-index.json (for detail view)
  recentSessions: SessionHistoryEntry[];
}

// Lightweight session info from sessions-index.json
export interface SessionHistoryEntry {
  sessionId: string;
  summary?: string;
  firstPrompt?: string;
  gitBranch?: string;
}

// ─── Persistence layer types (store.ts) ──────────────────────

export type ItemStatus = "pending" | "in_progress" | "completed";

// Stored item: union of TodoItem/TaskItem fields + tracking metadata
export interface StoredItem {
  // Original fields (TodoItem)
  content?: string;
  // Original fields (TaskItem)
  id?: string;
  subject?: string;
  description?: string;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
  // Shared fields
  activeForm?: string;
  status: ItemStatus;
  // Tracking metadata
  _firstSeenAt: string;
  _lastSeenAt: string;
  _gone: boolean;
  _goneAt?: string;
}

// Persisted session data
export interface SessionStore {
  id: string;
  source: "todos" | "tasks";
  firstSeenAt: string;
  lastSeenAt: string;
  gone: boolean;
  goneAt?: string;
  meta?: SessionMeta;
  items: StoredItem[];
}

// Per-project persistence file
export interface ProjectStore {
  projectPath: string;
  projectName: string;
  updatedAt: string;
  sessions: Record<string, SessionStore>;
}

// Global store metadata
export interface StoreMeta {
  schemaVersion: number;
  lastScanAt: string;
  projectCount: number;
}

// Extended ProjectData with historical data from persistence
export interface MergedProjectData extends ProjectData {
  hasHistory: boolean;
  goneSessionCount: number;
}
