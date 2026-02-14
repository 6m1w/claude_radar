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

// Unified view model
export interface SessionData {
  id: string;
  source: "todos" | "tasks";
  lastModified: Date;
  items: (TodoItem | TaskItem)[];
  meta?: SessionMeta;
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
}
