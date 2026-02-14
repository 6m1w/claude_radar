import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, mergeAndPersist } from "../store.js";
import type { ProjectData, SessionData, TodoItem, TaskItem, MergedProjectData } from "../../types.js";

// ─── Test helpers ────────────────────────────────────────────

let testDir: string;
let projectsDir: string;

// Patch STORE_DIR and PROJECTS_DIR to use temp directory
// We access private members via prototype patching for isolation
function createIsolatedStore(): Store {
  const store = new Store();
  // Override internal paths by patching the module-level constants
  // Since we can't easily mock module constants, we test via the Store class directly
  return store;
}

function makeTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "1",
    subject: "Test task",
    description: "A test task",
    status: "pending",
    blocks: [],
    blockedBy: [],
    ...overrides,
  };
}

function makeTodoItem(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    content: "Test todo",
    status: "pending",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: "session-001",
    source: "tasks",
    lastModified: new Date(),
    items: [makeTaskItem()],
    meta: {
      projectPath: "/test/project",
      projectName: "project",
    },
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    projectPath: "/test/project",
    projectName: "project",
    sessions: [makeSession()],
    totalTasks: 1,
    completedTasks: 0,
    inProgressTasks: 0,
    agents: [],
    lastActivity: new Date(),
    isActive: false,
    totalSessions: 1,
    activeSessions: 0,
    docs: [],
    recentSessions: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe("Store", () => {
  describe("merge — new data", () => {
    it("should add new project to empty store", () => {
      const store = new Store();
      const project = makeProject();

      const merged = store.merge([project]);

      expect(merged).toHaveLength(1);
      expect(merged[0].projectPath).toBe("/test/project");
      expect(merged[0].hasHistory).toBe(false);
      expect(merged[0].goneSessionCount).toBe(0);
    });

    it("should add new session to existing project", () => {
      const store = new Store();
      const project1 = makeProject();
      store.merge([project1]);

      const project2 = makeProject({
        sessions: [
          makeSession(),
          makeSession({ id: "session-002", items: [makeTaskItem({ id: "2", subject: "Task 2" })] }),
        ],
      });

      const merged = store.merge([project2]);

      expect(merged).toHaveLength(1);
      expect(merged[0].sessions).toHaveLength(2);
    });

    it("should add new task item to existing session", () => {
      const store = new Store();
      const project1 = makeProject({
        sessions: [makeSession({ items: [makeTaskItem({ id: "1" })] })],
      });
      store.merge([project1]);

      const project2 = makeProject({
        sessions: [makeSession({ items: [makeTaskItem({ id: "1" }), makeTaskItem({ id: "2", subject: "New task" })] })],
      });

      const merged = store.merge([project2]);
      const items = merged[0].sessions[0].items;
      expect(items).toHaveLength(2);
    });
  });

  describe("merge — gone detection", () => {
    it("should mark session as gone when it disappears from live data", () => {
      const store = new Store();
      const project1 = makeProject({
        sessions: [
          makeSession({ id: "session-001" }),
          makeSession({ id: "session-002", items: [makeTaskItem({ id: "2" })] }),
        ],
      });
      store.merge([project1]);

      // Second scan: session-002 is gone
      const project2 = makeProject({
        sessions: [makeSession({ id: "session-001" })],
      });
      const merged = store.merge([project2]);

      expect(merged[0].hasHistory).toBe(true);
      expect(merged[0].goneSessionCount).toBe(1);
      // Gone session should still appear in sessions list
      expect(merged[0].sessions).toHaveLength(2);
    });

    it("should mark task item as gone when it disappears from live session", () => {
      const store = new Store();
      const project1 = makeProject({
        sessions: [makeSession({
          items: [makeTaskItem({ id: "1" }), makeTaskItem({ id: "2", subject: "Will disappear" })],
        })],
      });
      store.merge([project1]);

      // Second scan: task 2 is gone
      const project2 = makeProject({
        sessions: [makeSession({ items: [makeTaskItem({ id: "1" })] })],
      });
      const merged = store.merge([project2]);

      // Gone item should be added back from store
      const items = merged[0].sessions[0].items;
      expect(items).toHaveLength(2);
    });

    it("should mark project sessions as gone when project disappears", () => {
      const store = new Store();
      store.merge([makeProject()]);

      // Second scan: no live projects
      const merged = store.merge([]);

      // Historical project should still appear
      expect(merged).toHaveLength(1);
      expect(merged[0].hasHistory).toBe(true);
      expect(merged[0].isActive).toBe(false);
    });
  });

  describe("merge — resurrection", () => {
    it("should un-mark session when it reappears in live data", () => {
      const store = new Store();
      store.merge([makeProject()]);

      // Disappear
      store.merge([makeProject({ sessions: [] })]);

      // Reappear
      const merged = store.merge([makeProject()]);

      // Session should be back and not marked as gone
      expect(merged[0].sessions).toHaveLength(1);
      expect(merged[0].goneSessionCount).toBe(0);
    });

    it("should un-mark item when it reappears in live session", () => {
      const store = new Store();
      const fullSession = makeSession({
        items: [makeTaskItem({ id: "1" }), makeTaskItem({ id: "2" })],
      });
      store.merge([makeProject({ sessions: [fullSession] })]);

      // Task 2 disappears
      const partialSession = makeSession({ items: [makeTaskItem({ id: "1" })] });
      store.merge([makeProject({ sessions: [partialSession] })]);

      // Task 2 reappears
      const merged = store.merge([makeProject({ sessions: [fullSession] })]);

      const items = merged[0].sessions[0].items;
      expect(items).toHaveLength(2);
      // Both should be from live data (not gone)
    });
  });

  describe("merge — status updates", () => {
    it("should update task status from live data", () => {
      const store = new Store();
      store.merge([makeProject({
        sessions: [makeSession({ items: [makeTaskItem({ id: "1", status: "pending" })] })],
      })]);

      const merged = store.merge([makeProject({
        sessions: [makeSession({ items: [makeTaskItem({ id: "1", status: "completed" })] })],
      })]);

      const items = merged[0].sessions[0].items;
      expect(items[0].status).toBe("completed");
    });

    it("should recompute task counts including gone items", () => {
      const store = new Store();
      store.merge([makeProject({
        sessions: [makeSession({
          items: [
            makeTaskItem({ id: "1", status: "completed" }),
            makeTaskItem({ id: "2", status: "completed" }),
            makeTaskItem({ id: "3", status: "pending" }),
          ],
        })],
      })]);

      // Tasks 2 and 3 disappear from live
      const merged = store.merge([makeProject({
        sessions: [makeSession({
          items: [makeTaskItem({ id: "1", status: "completed" })],
        })],
      })]);

      // Counts should include gone items
      expect(merged[0].totalTasks).toBe(3);
      expect(merged[0].completedTasks).toBe(2);
    });
  });

  describe("merge — TodoItem matching", () => {
    it("should match TodoItems by content", () => {
      const store = new Store();
      store.merge([makeProject({
        sessions: [makeSession({
          source: "todos",
          items: [makeTodoItem({ content: "Fix bug", status: "pending" })],
        })],
      })]);

      const merged = store.merge([makeProject({
        sessions: [makeSession({
          source: "todos",
          items: [makeTodoItem({ content: "Fix bug", status: "completed" })],
        })],
      })]);

      const items = merged[0].sessions[0].items;
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe("completed");
    });

    it("should treat different content as different items", () => {
      const store = new Store();
      store.merge([makeProject({
        sessions: [makeSession({
          source: "todos",
          items: [makeTodoItem({ content: "Fix bug A" })],
        })],
      })]);

      const merged = store.merge([makeProject({
        sessions: [makeSession({
          source: "todos",
          items: [makeTodoItem({ content: "Fix bug A" }), makeTodoItem({ content: "Fix bug B" })],
        })],
      })]);

      const items = merged[0].sessions[0].items;
      expect(items).toHaveLength(2);
    });
  });

  describe("merge — multiple projects", () => {
    it("should handle multiple live projects independently", () => {
      const store = new Store();
      const projectA = makeProject({ projectPath: "/test/a", projectName: "a" });
      const projectB = makeProject({
        projectPath: "/test/b",
        projectName: "b",
        sessions: [makeSession({ id: "session-b", items: [makeTaskItem({ id: "10" })] })],
      });

      const merged = store.merge([projectA, projectB]);

      expect(merged).toHaveLength(2);
      expect(merged.map((p) => p.projectPath).sort()).toEqual(["/test/a", "/test/b"]);
    });

    it("should keep historical project when another project disappears", () => {
      const store = new Store();
      store.merge([
        makeProject({ projectPath: "/test/a", projectName: "a" }),
        makeProject({ projectPath: "/test/b", projectName: "b" }),
      ]);

      // Only project A remains live
      const merged = store.merge([
        makeProject({ projectPath: "/test/a", projectName: "a" }),
      ]);

      expect(merged).toHaveLength(2);
      const projectB = merged.find((p) => p.projectPath === "/test/b");
      expect(projectB).toBeDefined();
      expect(projectB!.hasHistory).toBe(true);
    });
  });

  describe("merge — session metadata", () => {
    it("should update session meta from live data", () => {
      const store = new Store();
      store.merge([makeProject({
        sessions: [makeSession({
          meta: { projectPath: "/test/project", projectName: "project", gitBranch: "main" },
        })],
      })]);

      const merged = store.merge([makeProject({
        sessions: [makeSession({
          meta: { projectPath: "/test/project", projectName: "project", gitBranch: "feature/new" },
        })],
      })]);

      expect(merged[0].sessions[0].meta?.gitBranch).toBe("feature/new");
    });
  });
});
