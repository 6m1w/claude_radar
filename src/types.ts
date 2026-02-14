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
  // v0.3: Team & agent enrichment
  team?: TeamConfig;       // team config if this project has team tasks
  agentDetails: AgentInfo[]; // enriched agent info (process state, current task)
}

// Lightweight session info from sessions-index.json
export interface SessionHistoryEntry {
  sessionId: string;
  summary?: string;
  firstPrompt?: string;
  gitBranch?: string;
}

// ─── Team types (~/.claude/teams/) ───────────────────────────

// Team member from config.json
export interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
}

// Team config from ~/.claude/teams/{team-name}/config.json
export interface TeamConfig {
  teamName: string;        // directory name
  members: TeamMember[];
}

// Agent process state (from ps detection)
export type AgentProcessState = "running" | "idle" | "dead";

// Enriched agent info combining task owner + team member + process state
export interface AgentInfo {
  name: string;
  agentType?: string;
  processState: AgentProcessState;
  currentTaskId?: string;  // id of in_progress task owned by this agent
  teamName?: string;       // team this agent belongs to
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

// ─── Hook event types (capture.sh → events.jsonl) ───────────

// Raw event line from events.jsonl
export interface HookEvent {
  event: "task" | "stop" | "start";
  ts: string; // ISO 8601
  data: HookEventData;
}

// Common fields in all hook stdin JSON
export interface HookEventData {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  // PostToolUse fields
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  // Stop fields
  reason?: string;
}
