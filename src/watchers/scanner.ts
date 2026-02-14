import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { TodoItem, TaskItem, SessionData, SessionMeta } from "../types.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const TODOS_DIR = join(CLAUDE_DIR, "todos");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function getModTime(path: string): Date {
  try {
    return statSync(path).mtime;
  } catch {
    return new Date(0);
  }
}

// Build reverse index: sessionId → SessionMeta
// Strategy 1: Read sessions-index.json for rich metadata (has projectPath, summary, etc.)
// Strategy 2: Scan for {sessionId}.jsonl files — use projectPath from sibling entries in same dir
function buildSessionIndex(): Map<string, SessionMeta> {
  const index = new Map<string, SessionMeta>();
  // Track known projectPath per directory (from sessions-index entries)
  const dirProjectPath = new Map<string, string>();

  try {
    const projectDirs = readdirSync(PROJECTS_DIR);
    for (const dir of projectDirs) {
      const dirPath = join(PROJECTS_DIR, dir);

      // Strategy 1: sessions-index.json (has summary, firstPrompt, etc.)
      const indexPath = join(dirPath, "sessions-index.json");
      const data = readJson<{
        entries: Array<{
          sessionId: string;
          projectPath?: string;
          summary?: string;
          firstPrompt?: string;
          gitBranch?: string;
        }>;
      }>(indexPath);

      if (data?.entries) {
        for (const entry of data.entries) {
          if (!entry.sessionId) continue;
          // Remember the projectPath for this directory
          if (entry.projectPath) {
            dirProjectPath.set(dir, entry.projectPath);
          }
          const projectPath = entry.projectPath ?? dirProjectPath.get(dir) ?? dir;
          index.set(entry.sessionId, {
            projectPath,
            projectName: basename(projectPath),
            summary: entry.summary,
            firstPrompt: entry.firstPrompt?.slice(0, 80),
            gitBranch: entry.gitBranch,
          });
        }
      }

      // Strategy 2: scan for .jsonl files not yet in the index
      // Use the projectPath we learned from sessions-index entries in the same dir
      const knownPath = dirProjectPath.get(dir);
      if (!knownPath) continue;

      try {
        const files = readdirSync(dirPath);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          const sessionId = file.replace(".jsonl", "");
          if (index.has(sessionId)) continue;

          index.set(sessionId, {
            projectPath: knownPath,
            projectName: basename(knownPath),
          });
        }
      } catch {
        // skip
      }
    }
  } catch {
    // projects dir may not exist
  }
  return index;
}

// Scan ~/.claude/todos/ for non-empty todo files
function scanTodos(sessionIndex: Map<string, SessionMeta>): SessionData[] {
  const results: SessionData[] = [];
  try {
    const files = readdirSync(TODOS_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const fullPath = join(TODOS_DIR, file);
      const items = readJson<TodoItem[]>(fullPath);
      if (items && items.length > 0) {
        // Extract session ID from filename: {uuid}-agent-{uuid}.json
        const sessionId = file.split("-agent-")[0];
        results.push({
          id: sessionId,
          source: "todos",
          lastModified: getModTime(fullPath),
          items,
          meta: sessionIndex.get(sessionId),
        });
      }
    }
  } catch {
    // Directory may not exist
  }
  return results.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

// Scan ~/.claude/tasks/ for task sessions with actual task files
function scanTasks(sessionIndex: Map<string, SessionMeta>): SessionData[] {
  const results: SessionData[] = [];
  try {
    const dirs = readdirSync(TASKS_DIR);
    for (const dir of dirs) {
      const dirPath = join(TASKS_DIR, dir);
      try {
        const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
        if (files.length === 0) continue;

        const items: TaskItem[] = [];
        let latestMod = new Date(0);

        for (const file of files) {
          const fullPath = join(dirPath, file);
          const task = readJson<TaskItem>(fullPath);
          if (task && task.id) {
            items.push(task);
            const mod = getModTime(fullPath);
            if (mod > latestMod) latestMod = mod;
          }
        }

        if (items.length > 0) {
          // Sort by ID numerically
          items.sort((a, b) => Number(a.id) - Number(b.id));
          results.push({
            id: dir,
            source: "tasks",
            lastModified: latestMod,
            items,
            meta: sessionIndex.get(dir),
          });
        }
      } catch {
        // Skip invalid directories
      }
    }
  } catch {
    // Directory may not exist
  }
  return results.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

// Get the most recently active session across both systems
export function scanAll(): SessionData[] {
  const sessionIndex = buildSessionIndex();
  const todos = scanTodos(sessionIndex);
  const tasks = scanTasks(sessionIndex);
  return [...todos, ...tasks].sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
  );
}
