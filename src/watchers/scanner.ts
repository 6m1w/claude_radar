import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { TodoItem, TaskItem, SessionData } from "../types.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const TODOS_DIR = join(CLAUDE_DIR, "todos");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");

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

// Scan ~/.claude/todos/ for non-empty todo files
export function scanTodos(): SessionData[] {
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
        });
      }
    }
  } catch {
    // Directory may not exist
  }
  return results.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

// Scan ~/.claude/tasks/ for task sessions with actual task files
export function scanTasks(): SessionData[] {
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
  const todos = scanTodos();
  const tasks = scanTasks();
  return [...todos, ...tasks].sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
  );
}
