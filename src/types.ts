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
  _statusChangedAt?: string;
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

// Git commit entry from `git log`
export interface GitCommit {
  hash: string;
  subject: string;
  authorDate: string;
  type?: string; // conventional commit type: feat, fix, docs, etc.
}

// Aggregated project view — groups sessions by projectPath
export interface ProjectData {
  projectPath: string;
  projectName: string;
  claudeDir: string;      // ~/.claude/projects/{dir} — for JSONL scanning
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
    worktreeOf?: string; // if this is a worktree, the main repo path
  };
  docs: string[];          // detected doc files: "PRD.md", "CLAUDE.md", etc.
  gitLog: GitCommit[];     // recent git commits
  docContents: Record<string, string>; // filename → content
  roadmap: RoadmapData[];  // parsed checkboxes from PRD.md etc.
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
  _statusChangedAt: string; // when status last changed (for dwell time)
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

// Active session info from hook events (SessionStart/Stop)
export interface HookSessionInfo {
  sessionId: string;
  projectPath: string;
  startedAt: string;   // ISO timestamp from SessionStart event
}

// Extended ProjectData with historical data from persistence
export interface MergedProjectData extends ProjectData {
  hasHistory: boolean;
  goneSessionCount: number;
  hookSessions: HookSessionInfo[]; // active sessions known from hooks (even without tasks)
  planningLog: ActivityEvent[];    // L2: agent planning events (EnterPlanMode, Task, TaskCreate, etc.)
  activityLog: ActivityEvent[];     // L3: execution activity (Read, Write, Bash, etc.)
  activityAlerts: ActivityAlert[];  // pattern-detected alerts (repeated failures, etc.)
}

// ─── Activity tracking (tool-level observability) ────────────

// Lightweight event for the activity feed in project detail panel
// Derived from HookEvent by store.ts — not persisted to disk
export interface ActivityEvent {
  ts: string;            // ISO 8601
  sessionId: string;
  toolName: string;      // Write, Edit, Bash, Read, TaskCreate, _turn_complete, etc.
  summary: string;       // human-readable: "Write app.tsx", "Bash: tsc --noEmit ✓"
  projectPath: string;
  isError?: boolean;     // true if tool failed (PostToolUseFailure)
  durationMs?: number;   // turn duration (from JSONL turn_duration events)
}

// Alert generated by pattern detection on activity log
export interface ActivityAlert {
  type: "repeated_failure" | "repeated_retry" | "long_turn" | "context_compact";
  severity: "warning" | "error";
  message: string;       // human-readable: "Bash failed 5 times in a row"
  count: number;         // how many occurrences triggered this alert
  sessionId: string;
  projectPath: string;
  ts: string;            // timestamp of latest occurrence
}

// ─── Display types (normalized from real data for UI) ────────

// Normalized task for display (from TodoItem/TaskItem after store merge)
export type DisplayTask = {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;
  blockedBy?: string;
  description?: string;
  gone?: boolean; // historical item preserved by store after Claude Code deletion
  statusChangedAt?: string; // ISO timestamp for dwell time calculation
};

// View model: mirrors ProjectData shape for UI components
export type ViewProject = {
  name: string;
  projectPath: string;
  branch: string;
  agents: string[];
  activeSessions: number;
  hookSessionCount: number; // active sessions from hook events
  docs: string[];
  tasks: DisplayTask[];
  recentSessions: SessionHistoryEntry[];
  goneSessionCount: number;
  agentDetails: AgentInfo[];
  worktreeOf?: string; // main repo path if this is a worktree
  team?: TeamConfig;
  gitLog: GitCommit[];
  docContents: Record<string, string>;
  lastActivity: Date;
  planningLog: ActivityEvent[];
  activityLog: ActivityEvent[];
  activityAlerts: ActivityAlert[];
  roadmap: RoadmapData[];
};

// ─── Roadmap (parsed from PRD.md / doc checkboxes) ────────────

// A single checkbox item from a markdown document
export interface RoadmapItem {
  text: string;          // raw checkbox text (after "- [x] " or "- [ ] ")
  done: boolean;
}

// A group of checkboxes under a section heading
export interface RoadmapSection {
  title: string;         // heading text: "v0.4 — Activity Track"
  level: number;         // heading depth (2 = ##, 3 = ###)
  items: RoadmapItem[];
  done: number;          // count of checked items
  total: number;         // count of all items
}

// Full roadmap extracted from a document
export interface RoadmapData {
  source: string;        // filename: "PRD.md" or "docs/PRD.md"
  sections: RoadmapSection[];
  totalDone: number;
  totalItems: number;
  lastModified?: string; // ISO 8601 mtime of source file
}

// ─── Usage / cost tracking (parsed from session JSONL) ───────

// Token breakdown for a single session
export interface SessionUsageStats {
  sessionId: string;
  model: string;               // primary model (most frequent)
  messageCount: number;        // assistant messages with usage data
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  costUSD: number;             // estimated cost based on model pricing
}

// Aggregated usage across all sessions in a project
export interface ProjectUsageStats {
  sessions: SessionUsageStats[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheWriteTokens: number;
  totalCacheReadTokens: number;
  totalCostUSD: number;
  totalMessages: number;
}

// ─── Hook event types (capture.sh → events.jsonl) ───────────

// Raw event line from events.jsonl
// event types: "tool" (PostToolUse, all tools), "tool_failure" (PostToolUseFailure),
//   "stop", "start", "task" (legacy — old PostToolUse with matcher),
//   "subagent_stop", "notification"
export interface HookEvent {
  event: "tool" | "tool_failure" | "task" | "stop" | "start" | "subagent_stop" | "notification" | "compact";
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
