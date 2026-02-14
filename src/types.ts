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

// Unified view model
export interface SessionData {
  id: string;
  source: "todos" | "tasks";
  lastModified: Date;
  items: (TodoItem | TaskItem)[];
}
