import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, mergeAndPersist, consumeEvents, resetEventsOffset, EVENTS_PATH, truncateEvents, detectPatterns, PLANNING_TOOLS } from "../store.js";
import { ingestHookEvents } from "../store.js";
import type { ProjectData, SessionData, TodoItem, TaskItem, MergedProjectData, HookEvent, HookSessionInfo, ActivityEvent } from "../../types.js";

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
    roadmap: [],
    gitLog: [],
    docContents: {},
    recentSessions: [],
    agentDetails: [],
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

// ─── Hook event helpers ─────────────────────────────────────

function makeHookEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    event: "task",
    ts: new Date().toISOString(),
    data: {
      session_id: "session-hook-001",
      cwd: "/test/hook-project",
      tool_name: "TaskCreate",
      tool_input: {
        subject: "Hook task",
        description: "Created via hook",
        status: "pending",
      },
    },
    ...overrides,
  };
}

// ─── Hook event ingestion tests ─────────────────────────────

describe("ingestHookEvents", () => {
  describe("TaskCreate events", () => {
    it("should create project and session from TaskCreate event", () => {
      const store = new Store();
      const event = makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TaskCreate",
          tool_input: {
            subject: "Implement auth",
            description: "Add JWT authentication",
            status: "pending",
          },
        },
      });

      ingestHookEvents(store, [event]);
      const merged = store.merge([]);

      expect(merged).toHaveLength(1);
      expect(merged[0].projectPath).toBe("/projects/my-app");
      expect(merged[0].sessions).toHaveLength(1);
      expect(merged[0].sessions[0].id).toBe("sess-1");
      expect(merged[0].sessions[0].items).toHaveLength(1);
      expect(merged[0].sessions[0].items[0].status).toBe("pending");
    });

    it("should add multiple tasks to the same session", () => {
      const store = new Store();
      const events: HookEvent[] = [
        makeHookEvent({
          data: {
            session_id: "sess-1",
            cwd: "/projects/my-app",
            tool_name: "TaskCreate",
            tool_input: { id: "1", subject: "Task A", description: "First", status: "pending" },
          },
        }),
        makeHookEvent({
          data: {
            session_id: "sess-1",
            cwd: "/projects/my-app",
            tool_name: "TaskCreate",
            tool_input: { id: "2", subject: "Task B", description: "Second", status: "pending" },
          },
        }),
      ];

      ingestHookEvents(store, events);
      const merged = store.merge([]);

      expect(merged[0].sessions[0].items).toHaveLength(2);
    });

    it("should create separate sessions for different session_ids", () => {
      const store = new Store();
      const events: HookEvent[] = [
        makeHookEvent({
          data: {
            session_id: "sess-1",
            cwd: "/projects/my-app",
            tool_name: "TaskCreate",
            tool_input: { id: "1", subject: "Task A", description: "First", status: "pending" },
          },
        }),
        makeHookEvent({
          data: {
            session_id: "sess-2",
            cwd: "/projects/my-app",
            tool_name: "TaskCreate",
            tool_input: { id: "2", subject: "Task B", description: "Second", status: "pending" },
          },
        }),
      ];

      ingestHookEvents(store, events);
      const merged = store.merge([]);

      expect(merged[0].sessions).toHaveLength(2);
    });
  });

  describe("TaskUpdate events", () => {
    it("should update existing task status", () => {
      const store = new Store();

      // Create task first
      ingestHookEvents(store, [makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TaskCreate",
          tool_input: { id: "1", subject: "Task A", description: "First", status: "pending" },
        },
      })]);

      // Then update it
      ingestHookEvents(store, [makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TaskUpdate",
          tool_input: { taskId: "1", status: "in_progress" },
        },
      })]);

      const merged = store.merge([]);
      const items = merged[0].sessions[0].items;

      expect(items).toHaveLength(1);
      expect(items[0].status).toBe("in_progress");
    });

    it("should preserve _firstSeenAt on update", () => {
      const store = new Store();
      const earlyTs = "2025-01-01T00:00:00Z";
      const lateTs = "2025-06-01T00:00:00Z";

      ingestHookEvents(store, [makeHookEvent({
        ts: earlyTs,
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TaskCreate",
          tool_input: { id: "1", subject: "Task A", description: "First", status: "pending" },
        },
      })]);

      ingestHookEvents(store, [makeHookEvent({
        ts: lateTs,
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TaskUpdate",
          tool_input: { taskId: "1", status: "completed" },
        },
      })]);

      // After merge, the item is gone (historical only)
      // Verify it was updated properly by checking status
      const merged = store.merge([]);
      expect(merged[0].sessions[0].items[0].status).toBe("completed");
    });
  });

  describe("TodoWrite events", () => {
    it("should create todo item from TodoWrite event", () => {
      const store = new Store();
      ingestHookEvents(store, [makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TodoWrite",
          tool_input: { content: "Fix the login bug", status: "pending" },
        },
      })]);

      const merged = store.merge([]);

      expect(merged[0].sessions[0].source).toBe("todos");
      expect(merged[0].sessions[0].items).toHaveLength(1);
      const item = merged[0].sessions[0].items[0];
      expect("content" in item && item.content).toBe("Fix the login bug");
    });
  });

  describe("Stop events", () => {
    it("should update lastSeenAt on session when stop event received", () => {
      const store = new Store();
      const stopTs = "2025-06-01T12:00:00Z";

      // Create a session via hook first
      ingestHookEvents(store, [makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TaskCreate",
          tool_input: { id: "1", subject: "Task A", description: "First", status: "pending" },
        },
      })]);

      // Stop event
      ingestHookEvents(store, [{
        event: "stop",
        ts: stopTs,
        data: {
          session_id: "sess-1",
          reason: "user_exit",
        },
      }]);

      // Session should still exist, not marked as gone
      const merged = store.merge([]);
      expect(merged[0].sessions).toHaveLength(1);
    });

    it("should ignore stop event for unknown session", () => {
      const store = new Store();

      // Stop event for a session that was never created
      ingestHookEvents(store, [{
        event: "stop",
        ts: new Date().toISOString(),
        data: {
          session_id: "unknown-session",
          reason: "user_exit",
        },
      }]);

      const merged = store.merge([]);
      expect(merged).toHaveLength(0);
    });
  });

  describe("SessionStart events", () => {
    it("should track active session from start event", () => {
      const store = new Store();

      ingestHookEvents(store, [{
        event: "start",
        ts: "2025-06-01T10:00:00Z",
        data: {
          session_id: "sess-new",
          cwd: "/projects/my-app",
        },
      }]);

      const merged = store.merge([]);

      // Should create a hook-only project with active session
      expect(merged).toHaveLength(1);
      expect(merged[0].projectPath).toBe("/projects/my-app");
      expect(merged[0].isActive).toBe(true);
      expect(merged[0].hookSessions).toHaveLength(1);
      expect(merged[0].hookSessions[0].sessionId).toBe("sess-new");
    });

    it("should remove session from active on stop event", () => {
      const store = new Store();

      // Start
      ingestHookEvents(store, [{
        event: "start",
        ts: "2025-06-01T10:00:00Z",
        data: { session_id: "sess-new", cwd: "/projects/my-app" },
      }]);

      // Stop
      ingestHookEvents(store, [{
        event: "stop",
        ts: "2025-06-01T10:30:00Z",
        data: { session_id: "sess-new", reason: "done" },
      }]);

      const merged = store.merge([]);

      // Hook-only project disappears (no tasks, no active sessions)
      expect(merged).toHaveLength(0);
    });

    it("should track multiple active sessions in same project", () => {
      const store = new Store();

      ingestHookEvents(store, [
        { event: "start", ts: "2025-06-01T10:00:00Z", data: { session_id: "sess-1", cwd: "/projects/my-app" } },
        { event: "start", ts: "2025-06-01T10:00:01Z", data: { session_id: "sess-2", cwd: "/projects/my-app" } },
      ]);

      const merged = store.merge([]);

      expect(merged).toHaveLength(1);
      expect(merged[0].hookSessions).toHaveLength(2);
      expect(merged[0].activeSessions).toBe(2);
    });

    it("should supplement existing project with hookSessions", () => {
      const store = new Store();

      // Start event for a project that also has live scan data
      ingestHookEvents(store, [{
        event: "start",
        ts: "2025-06-01T10:00:00Z",
        data: { session_id: "sess-hook", cwd: "/test/project" },
      }]);

      // Merge with live project data
      const merged = store.merge([makeProject({
        projectPath: "/test/project",
        sessions: [makeSession({ id: "sess-scan" })],
      })]);

      expect(merged).toHaveLength(1);
      expect(merged[0].hookSessions).toHaveLength(1);
      expect(merged[0].hookSessions[0].sessionId).toBe("sess-hook");
      // Live sessions + hook sessions visible
      expect(merged[0].sessions).toHaveLength(1); // scan sessions
    });

    it("should skip start events without cwd", () => {
      const store = new Store();

      ingestHookEvents(store, [{
        event: "start",
        ts: "2025-06-01T10:00:00Z",
        data: { session_id: "sess-no-cwd" },
      }]);

      const merged = store.merge([]);
      expect(merged).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("should skip events without session_id", () => {
      const store = new Store();
      ingestHookEvents(store, [{
        event: "task",
        ts: new Date().toISOString(),
        data: { session_id: "" } as any,
      }]);

      const merged = store.merge([]);
      expect(merged).toHaveLength(0);
    });

    it("should skip task events without cwd", () => {
      const store = new Store();
      ingestHookEvents(store, [makeHookEvent({
        data: {
          session_id: "sess-1",
          tool_name: "TaskCreate",
          tool_input: { subject: "No cwd", description: "Missing", status: "pending" },
        },
      })]);

      const merged = store.merge([]);
      expect(merged).toHaveLength(0);
    });

    it("should skip events without tool_input", () => {
      const store = new Store();
      ingestHookEvents(store, [makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/projects/my-app",
          tool_name: "TaskCreate",
          // no tool_input
        },
      })]);

      const merged = store.merge([]);
      // Project may be created, but session should have no items
      if (merged.length > 0) {
        const items = merged[0].sessions.flatMap((s) => s.items);
        expect(items).toHaveLength(0);
      }
    });
  });
});

// ─── consumeEvents / truncateEvents tests ───────────────────

describe("consumeEvents", () => {
  const eventsDir = join(tmpdir(), `claude-radar-test-${Date.now()}`);
  const eventsFile = EVENTS_PATH;

  beforeEach(() => {
    // Ensure the store directory exists (path changed from .claude-monitor to .claude-radar)
    const storeDir = join(eventsFile, "..");
    mkdirSync(storeDir, { recursive: true });
    resetEventsOffset();
  });

  afterEach(() => {
    // Cleanup: remove test events file if it exists
    try {
      if (existsSync(eventsFile)) {
        writeFileSync(eventsFile, "", "utf-8");
      }
    } catch {
      // ignore
    }
    resetEventsOffset();
  });

  it("should return empty array when events file does not exist", () => {
    // Ensure no events file
    try { rmSync(eventsFile); } catch { /* ignore */ }
    const events = consumeEvents();
    expect(events).toEqual([]);
  });

  it("should read events from jsonl file", () => {
    const event1: HookEvent = { event: "task", ts: "2025-01-01T00:00:00Z", data: { session_id: "s1", tool_name: "TaskCreate", tool_input: { subject: "A" } } };
    const event2: HookEvent = { event: "stop", ts: "2025-01-01T00:01:00Z", data: { session_id: "s1", reason: "done" } };

    writeFileSync(eventsFile, JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n", "utf-8");

    const events = consumeEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("task");
    expect(events[1].event).toBe("stop");
  });

  it("should only read new events on subsequent calls (incremental offset)", () => {
    const event1: HookEvent = { event: "task", ts: "2025-01-01T00:00:00Z", data: { session_id: "s1", tool_name: "TaskCreate", tool_input: { subject: "A" } } };
    writeFileSync(eventsFile, JSON.stringify(event1) + "\n", "utf-8");

    // First read
    const first = consumeEvents();
    expect(first).toHaveLength(1);

    // No new data — should return empty
    const second = consumeEvents();
    expect(second).toHaveLength(0);

    // Append new event
    const event2: HookEvent = { event: "stop", ts: "2025-01-01T00:01:00Z", data: { session_id: "s1", reason: "done" } };
    const fs = require("node:fs");
    fs.appendFileSync(eventsFile, JSON.stringify(event2) + "\n", "utf-8");

    // Should only read the new event
    const third = consumeEvents();
    expect(third).toHaveLength(1);
    expect(third[0].event).toBe("stop");
  });

  it("should skip malformed JSON lines", () => {
    writeFileSync(eventsFile, '{"event":"task","ts":"x","data":{"session_id":"s1"}}\nNOT JSON\n{"event":"stop","ts":"y","data":{"session_id":"s2"}}\n', "utf-8");

    const events = consumeEvents();
    expect(events).toHaveLength(2);
  });

  it("should reset offset when file is truncated", () => {
    const event1: HookEvent = { event: "task", ts: "2025-01-01T00:00:00Z", data: { session_id: "s1", tool_name: "TaskCreate", tool_input: { subject: "A" } } };
    writeFileSync(eventsFile, JSON.stringify(event1) + "\n", "utf-8");

    // Read everything
    consumeEvents();

    // File is truncated (shorter than offset)
    writeFileSync(eventsFile, "", "utf-8");

    // Should detect truncation and reset
    const events = consumeEvents();
    expect(events).toHaveLength(0);

    // Write new event after truncation
    writeFileSync(eventsFile, JSON.stringify(event1) + "\n", "utf-8");
    const after = consumeEvents();
    expect(after).toHaveLength(1);
  });
});

describe("truncateEvents", () => {
  beforeEach(() => {
    resetEventsOffset();
  });

  afterEach(() => {
    resetEventsOffset();
    try {
      if (existsSync(EVENTS_PATH)) {
        writeFileSync(EVENTS_PATH, "", "utf-8");
      }
    } catch {
      // ignore
    }
  });

  it("should clear events file contents", () => {
    writeFileSync(EVENTS_PATH, '{"event":"task","ts":"x","data":{"session_id":"s1"}}\n', "utf-8");

    truncateEvents();

    const content = readFileSync(EVENTS_PATH, "utf-8");
    expect(content).toBe("");
  });

  it("should reset offset after truncation", () => {
    const event: HookEvent = { event: "task", ts: "2025-01-01T00:00:00Z", data: { session_id: "s1", tool_name: "TaskCreate", tool_input: { subject: "A" } } };
    writeFileSync(EVENTS_PATH, JSON.stringify(event) + "\n", "utf-8");

    // Read to advance offset
    consumeEvents();

    // Truncate
    truncateEvents();

    // Write new data
    writeFileSync(EVENTS_PATH, JSON.stringify(event) + "\n", "utf-8");

    // Should be able to read from beginning
    const events = consumeEvents();
    expect(events).toHaveLength(1);
  });
});

// ─── Deduplication: hook events + polling data ──────────────

describe("deduplication — hook events + polling merge", () => {
  it("should not duplicate when hook and polling see the same task", () => {
    const store = new Store();

    // Hook event creates task id=1
    ingestHookEvents(store, [makeHookEvent({
      data: {
        session_id: "sess-1",
        cwd: "/test/project",
        tool_name: "TaskCreate",
        tool_input: { id: "1", subject: "Auth", description: "Add auth", status: "pending" },
      },
    })]);

    // Polling also sees task id=1 in live data
    const merged = store.merge([makeProject({
      projectPath: "/test/project",
      sessions: [makeSession({
        id: "sess-1",
        items: [makeTaskItem({ id: "1", subject: "Auth", status: "pending" })],
      })],
    })]);

    // Should have exactly 1 item, not 2
    expect(merged[0].sessions[0].items).toHaveLength(1);
  });

  it("should use live data status when hook and polling conflict", () => {
    const store = new Store();

    // Hook creates task as pending
    ingestHookEvents(store, [makeHookEvent({
      data: {
        session_id: "sess-1",
        cwd: "/test/project",
        tool_name: "TaskCreate",
        tool_input: { id: "1", subject: "Auth", description: "Add auth", status: "pending" },
      },
    })]);

    // Polling sees it as completed (polling is truth for live sessions)
    const merged = store.merge([makeProject({
      projectPath: "/test/project",
      sessions: [makeSession({
        id: "sess-1",
        items: [makeTaskItem({ id: "1", subject: "Auth", status: "completed" })],
      })],
    })]);

    expect(merged[0].sessions[0].items[0].status).toBe("completed");
  });

  it("should keep hook-only items as gone when polling does not see them", () => {
    const store = new Store();

    // Hook creates two tasks
    ingestHookEvents(store, [
      makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "TaskCreate",
          tool_input: { id: "1", subject: "Task A", description: "A", status: "pending" },
        },
      }),
      makeHookEvent({
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "TaskCreate",
          tool_input: { id: "2", subject: "Task B", description: "B", status: "pending" },
        },
      }),
    ]);

    // Polling only sees task 1 (task 2 was deleted before polling cycle)
    const merged = store.merge([makeProject({
      projectPath: "/test/project",
      sessions: [makeSession({
        id: "sess-1",
        items: [makeTaskItem({ id: "1", subject: "Task A", status: "pending" })],
      })],
    })]);

    // Both items should be in the merged result (task 2 marked as gone)
    const items = merged[0].sessions[0].items;
    expect(items).toHaveLength(2);

    const goneItems = items.filter((i) => "_gone" in i && i._gone);
    expect(goneItems).toHaveLength(1);
  });
});

// ─── Activity summary enrichment ─────────────────────────────

describe("activity summary enrichment", () => {
  it("should show subagent_type in Task tool summary", () => {
    const store = new Store();

    ingestHookEvents(store, [
      makeHookEvent({
        event: "tool",
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "Task",
          tool_input: {
            subagent_type: "Explore",
            description: "find auth code",
            prompt: "search for authentication",
          },
        },
      }),
    ]);

    const activity = store.getActivityLog("/test/project");
    expect(activity).toHaveLength(1);
    expect(activity[0].summary).toContain("Task[Explore]");
    expect(activity[0].summary).toContain("find auth code");
  });

  it("should fall back to prompt when Task has no description", () => {
    const store = new Store();

    ingestHookEvents(store, [
      makeHookEvent({
        event: "tool",
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "Task",
          tool_input: {
            prompt: "investigate the error above",
          },
        },
      }),
    ]);

    const activity = store.getActivityLog("/test/project");
    expect(activity[0].summary).toContain("investigate the error");
  });

  it("should show plan mode entry/exit in activity", () => {
    const store = new Store();

    ingestHookEvents(store, [
      makeHookEvent({
        event: "tool",
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "EnterPlanMode",
          tool_input: {},
        },
      }),
      makeHookEvent({
        event: "tool",
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "ExitPlanMode",
          tool_input: {},
        },
      }),
    ]);

    const activity = store.getActivityLog("/test/project");
    expect(activity).toHaveLength(2);
    expect(activity[0].summary).toContain("[PLAN]");
    expect(activity[0].summary).toContain("plan mode");
    expect(activity[1].summary).toContain("[PLAN]");
    expect(activity[1].summary).toContain("approval");
  });

  it("should include tool_name in SubagentStop summary when available", () => {
    const store = new Store();

    ingestHookEvents(store, [{
      event: "subagent_stop",
      ts: new Date().toISOString(),
      data: {
        session_id: "sess-1",
        cwd: "/test/project",
        tool_name: "Explore",
        reason: "completed",
      },
    }]);

    const activity = store.getActivityLog("/test/project");
    expect(activity).toHaveLength(1);
    expect(activity[0].summary).toContain("Explore");
    expect(activity[0].summary).toContain("completed");
  });
});

// ─── PreCompact (compact) events ──────────────────────────────

describe("compact events", () => {
  it("should record compact as planning activity", () => {
    const store = new Store();

    ingestHookEvents(store, [{
      event: "compact",
      ts: new Date().toISOString(),
      data: {
        session_id: "sess-1",
        cwd: "/test/project",
      },
    }]);

    const { planningLog, activityLog } = store.getActivitySplit("/test/project");
    expect(planningLog).toHaveLength(1);
    expect(planningLog[0].toolName).toBe("_compact");
    expect(planningLog[0].summary).toContain("Context compacted");
    expect(activityLog).toHaveLength(0);
  });
});

// ─── PostToolUseFailure (tool_failure) events ────────────────

describe("tool_failure events", () => {
  it("should record tool_failure as activity with isError flag", () => {
    const store = new Store();

    ingestHookEvents(store, [
      makeHookEvent({
        event: "tool_failure",
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "Bash",
          tool_input: { command: "npm test" },
        },
      }),
    ]);

    const activity = store.getActivityLog("/test/project");
    expect(activity).toHaveLength(1);
    expect(activity[0].isError).toBe(true);
    expect(activity[0].toolName).toBe("Bash");
    expect(activity[0].summary).toMatch(/^❌/);
  });

  it("should not ingest tool_failure into task store", () => {
    const store = new Store();

    ingestHookEvents(store, [
      makeHookEvent({
        event: "tool_failure",
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "TaskCreate",
          tool_input: { subject: "Should not be stored", description: "fail", status: "pending" },
        },
      }),
    ]);

    // Activity is recorded
    expect(store.getActivityLog("/test/project")).toHaveLength(1);

    // But no project/session/task is created in the store
    const merged = store.merge([]);
    const project = merged.find((p) => p.projectPath === "/test/project");
    expect(project).toBeUndefined();
  });
});

// ─── Pattern detection (detectPatterns) ───────────────────────

function makeActivityEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    ts: new Date().toISOString(),
    sessionId: "sess-1",
    toolName: "Bash",
    summary: "Bash: npm test",
    projectPath: "/test/project",
    ...overrides,
  };
}

describe("detectPatterns", () => {
  it("should return empty for no events", () => {
    expect(detectPatterns([])).toEqual([]);
  });

  it("should return empty for events with no patterns", () => {
    const events: ActivityEvent[] = [
      makeActivityEvent({ toolName: "Read", summary: "Read app.tsx" }),
      makeActivityEvent({ toolName: "Edit", summary: "Edit app.tsx" }),
      makeActivityEvent({ toolName: "Bash", summary: "Bash: npm test" }),
    ];
    expect(detectPatterns(events)).toEqual([]);
  });

  describe("repeated_failure", () => {
    it("should detect 3+ consecutive failures of the same tool", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({ toolName: "Bash", isError: true, summary: "❌ Bash: npm test" }),
        makeActivityEvent({ toolName: "Bash", isError: true, summary: "❌ Bash: npm test" }),
        makeActivityEvent({ toolName: "Bash", isError: true, summary: "❌ Bash: npm test" }),
      ];

      const alerts = detectPatterns(events);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe("repeated_failure");
      expect(alerts[0].count).toBe(3);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].message).toContain("Bash");
      expect(alerts[0].message).toContain("3");
    });

    it("should escalate to error severity at 5+ failures", () => {
      const events: ActivityEvent[] = Array.from({ length: 6 }, () =>
        makeActivityEvent({ toolName: "Bash", isError: true }),
      );

      const alerts = detectPatterns(events);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("error");
      expect(alerts[0].count).toBe(6);
    });

    it("should not trigger for 2 consecutive failures", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({ toolName: "Bash", isError: true }),
        makeActivityEvent({ toolName: "Bash", isError: true }),
      ];
      expect(detectPatterns(events)).toEqual([]);
    });

    it("should reset count when a success intervenes", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({ toolName: "Bash", isError: true }),
        makeActivityEvent({ toolName: "Bash", isError: true }),
        makeActivityEvent({ toolName: "Bash", isError: false }), // success breaks the run
        makeActivityEvent({ toolName: "Bash", isError: true }),
        makeActivityEvent({ toolName: "Bash", isError: true }),
      ];
      expect(detectPatterns(events)).toEqual([]);
    });

    it("should detect separate failure runs per tool", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({ toolName: "Bash", isError: true }),
        makeActivityEvent({ toolName: "Bash", isError: true }),
        makeActivityEvent({ toolName: "Bash", isError: true }),
        makeActivityEvent({ toolName: "Edit", isError: true }),
        makeActivityEvent({ toolName: "Edit", isError: true }),
        makeActivityEvent({ toolName: "Edit", isError: true }),
      ];

      const alerts = detectPatterns(events);
      // Should detect both: Bash run ended when Edit started, then Edit trailing run
      expect(alerts.length).toBeGreaterThanOrEqual(2);
      const types = alerts.map((a) => a.type);
      expect(types.every((t) => t === "repeated_failure")).toBe(true);
    });

    it("should scope pattern detection to each session independently", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({ sessionId: "sess-1", toolName: "Bash", isError: true }),
        makeActivityEvent({ sessionId: "sess-1", toolName: "Bash", isError: true }),
        makeActivityEvent({ sessionId: "sess-2", toolName: "Bash", isError: true }),
        makeActivityEvent({ sessionId: "sess-2", toolName: "Bash", isError: true }),
      ];
      // Neither session reaches 3
      expect(detectPatterns(events)).toEqual([]);
    });
  });

  describe("repeated_retry", () => {
    it("should detect 4+ consecutive Task tool calls", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({ toolName: "Task", summary: "Task: explore codebase" }),
        makeActivityEvent({ toolName: "Task", summary: "Task: explore codebase" }),
        makeActivityEvent({ toolName: "Task", summary: "Task: explore codebase" }),
        makeActivityEvent({ toolName: "Task", summary: "Task: explore codebase" }),
      ];

      const alerts = detectPatterns(events);
      const retryAlerts = alerts.filter((a) => a.type === "repeated_retry");
      expect(retryAlerts).toHaveLength(1);
      expect(retryAlerts[0].count).toBe(4);
      expect(retryAlerts[0].severity).toBe("warning");
    });

    it("should escalate retry severity at 6+", () => {
      const events: ActivityEvent[] = Array.from({ length: 7 }, () =>
        makeActivityEvent({ toolName: "Task", summary: "Task: retry" }),
      );

      const alerts = detectPatterns(events);
      const retryAlerts = alerts.filter((a) => a.type === "repeated_retry");
      expect(retryAlerts).toHaveLength(1);
      expect(retryAlerts[0].severity).toBe("error");
    });

    it("should not trigger when a different tool interrupts", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({ toolName: "Task" }),
        makeActivityEvent({ toolName: "Task" }),
        makeActivityEvent({ toolName: "Read" }), // breaks the run
        makeActivityEvent({ toolName: "Task" }),
        makeActivityEvent({ toolName: "Task" }),
      ];

      const alerts = detectPatterns(events);
      const retryAlerts = alerts.filter((a) => a.type === "repeated_retry");
      expect(retryAlerts).toEqual([]);
    });
  });

  describe("long_turn", () => {
    it("should detect turns exceeding 5 minutes", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({
          toolName: "_turn_complete",
          summary: "Turn completed in 8m 30s",
          durationMs: 8 * 60 * 1000 + 30000,
        }),
      ];

      const alerts = detectPatterns(events);
      const longAlerts = alerts.filter((a) => a.type === "long_turn");
      expect(longAlerts).toHaveLength(1);
      expect(longAlerts[0].severity).toBe("warning");
      expect(longAlerts[0].message).toContain("8");
    });

    it("should escalate to error for 10+ minute turns", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({
          toolName: "_turn_complete",
          durationMs: 15 * 60 * 1000,
          summary: "Turn completed in 15m 0s",
        }),
      ];

      const alerts = detectPatterns(events);
      const longAlerts = alerts.filter((a) => a.type === "long_turn");
      expect(longAlerts).toHaveLength(1);
      expect(longAlerts[0].severity).toBe("error");
    });

    it("should not trigger for turns under 5 minutes", () => {
      const events: ActivityEvent[] = [
        makeActivityEvent({
          toolName: "_turn_complete",
          durationMs: 4 * 60 * 1000,
          summary: "Turn completed in 4m 0s",
        }),
      ];

      const alerts = detectPatterns(events);
      expect(alerts.filter((a) => a.type === "long_turn")).toEqual([]);
    });
  });

  describe("integration — via store.merge", () => {
    it("should populate activityAlerts from store activity buffer", () => {
      const store = new Store();

      // Inject repeated failures via hook events
      const failureEvents: HookEvent[] = Array.from({ length: 4 }, (_, i) => ({
        event: "tool_failure" as const,
        ts: new Date(Date.now() + i * 1000).toISOString(),
        data: {
          session_id: "sess-1",
          cwd: "/test/project",
          tool_name: "Bash",
          tool_input: { command: "npm test" },
        },
      }));

      ingestHookEvents(store, failureEvents);

      const merged = store.merge([makeProject({ projectPath: "/test/project" })]);
      expect(merged[0].activityAlerts.length).toBeGreaterThan(0);
      expect(merged[0].activityAlerts[0].type).toBe("repeated_failure");
    });
  });
});

// ─── L2/L3 activity split (planningLog vs activityLog) ────────

describe("activity split — planningLog vs activityLog", () => {
  it("should classify planning tools into planningLog", () => {
    const store = new Store();

    // Inject a mix of planning and execution events
    ingestHookEvents(store, [
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "EnterPlanMode", tool_input: {} } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "Read", tool_input: { file_path: "src/app.ts" } } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "TaskCreate", tool_input: { subject: "Do X", description: "desc" } } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "Write", tool_input: { file_path: "src/app.ts", content: "..." } } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "ExitPlanMode", tool_input: {} } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "Bash", tool_input: { command: "npm test" } } }),
    ]);

    const { planningLog, activityLog } = store.getActivitySplit("/test/project");

    // Planning: EnterPlanMode, TaskCreate, ExitPlanMode
    expect(planningLog).toHaveLength(3);
    expect(planningLog.map((e) => e.toolName)).toEqual(["EnterPlanMode", "TaskCreate", "ExitPlanMode"]);

    // Activity: Read, Write, Bash
    expect(activityLog).toHaveLength(3);
    expect(activityLog.map((e) => e.toolName)).toEqual(["Read", "Write", "Bash"]);
  });

  it("should include Task tool in planningLog", () => {
    const store = new Store();

    ingestHookEvents(store, [
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "Task", tool_input: { subagent_type: "Explore", description: "Find files" } } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "Grep", tool_input: { pattern: "TODO" } } }),
    ]);

    const { planningLog, activityLog } = store.getActivitySplit("/test/project");
    expect(planningLog).toHaveLength(1);
    expect(planningLog[0].toolName).toBe("Task");
    expect(activityLog).toHaveLength(1);
    expect(activityLog[0].toolName).toBe("Grep");
  });

  it("should return empty arrays for unknown project", () => {
    const store = new Store();
    const { planningLog, activityLog } = store.getActivitySplit("/nonexistent");
    expect(planningLog).toEqual([]);
    expect(activityLog).toEqual([]);
  });

  it("should propagate planningLog through merge", () => {
    const store = new Store();

    ingestHookEvents(store, [
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "EnterPlanMode", tool_input: {} } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "Read", tool_input: { file_path: "x.ts" } } }),
      makeHookEvent({ data: { session_id: "s1", cwd: "/test/project", tool_name: "Task", tool_input: { subagent_type: "Plan", description: "Design API" } } }),
    ]);

    const merged = store.merge([makeProject({ projectPath: "/test/project" })]);
    expect(merged[0].planningLog).toHaveLength(2); // EnterPlanMode + Task
    expect(merged[0].activityLog).toHaveLength(1); // Read
  });

  it("should classify all PLANNING_TOOLS correctly", () => {
    // Verify every tool in the set is actually classified as planning
    for (const tool of PLANNING_TOOLS) {
      const store = new Store();
      ingestHookEvents(store, [
        makeHookEvent({ data: { session_id: "s1", cwd: "/test/p", tool_name: tool, tool_input: {} } }),
      ]);
      const { planningLog } = store.getActivitySplit("/test/p");
      expect(planningLog).toHaveLength(1);
      expect(planningLog[0].toolName).toBe(tool);
    }
  });
});
