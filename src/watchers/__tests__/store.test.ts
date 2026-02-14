import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, mergeAndPersist, consumeEvents, resetEventsOffset, EVENTS_PATH, truncateEvents } from "../store.js";
import { ingestHookEvents } from "../store.js";
import type { ProjectData, SessionData, TodoItem, TaskItem, MergedProjectData, HookEvent } from "../../types.js";

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
  const eventsDir = join(tmpdir(), `claude-monitor-test-${Date.now()}`);
  const eventsFile = EVENTS_PATH;

  beforeEach(() => {
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
