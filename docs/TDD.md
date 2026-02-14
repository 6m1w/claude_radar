# Claude Monitor — Technical Design Document

## Scope

This document covers the **local persistence layer** for Claude Monitor — the system that captures, stores, and merges task/session history so data is never lost when Claude Code deletes its task files.

Other technical topics (UI components, rendering, metrics) are covered in `DESIGN.md`.

---

## Problem Statement

Claude Code deletes task files (`~/.claude/tasks/`, `~/.claude/todos/`) when tasks are completed or sessions end. The current scanner (`scanner.ts`) reads live data only — once a file is gone, so is the data. This breaks:

1. **Kanban DONE column** — completed tasks vanish before they can be displayed
2. **Session history** — no way to review what happened in past sessions
3. **Progress tracking** — can't calculate historical completion rates

## Design Goals

- **Never lose data**: Any task/session seen by the scanner must be recoverable
- **Live-first**: Live data always takes priority over cached data
- **Non-invasive**: Read-only access to Claude Code's files — we only write to our own storage
- **Lightweight**: No database dependencies — plain JSON files
- **Extensible**: Architecture supports future lifecycle tracking (L2) without rewrite

## Architecture

### Current Data Flow (no persistence)

```
~/.claude/{todos,tasks,projects}
         │
         ▼
    scanner.scanAll()  ──→  useWatchSessions()  ──→  UI
    (pure read, no state)    (3s poll + diff)
```

### Proposed Data Flow (with persistence)

```
~/.claude/{todos,tasks,projects}
         │
         ▼
    scanner.scanAll()  ──→  store.merge()  ──→  useWatchSessions()  ──→  UI
    (pure read)              (diff + save)       (3s poll + diff)
         │                       ▲
         │                       │
         └───────────────────────┘
                          ~/.claude-monitor/projects/*.json
                          (accumulated history)
```

Key change: A new `store.ts` module sits between scanner and hook. The scanner stays pure (no side effects). The store handles:

1. Loading historical data from disk
2. Merging live data with historical data
3. Detecting disappeared items (present in history, absent from live)
4. Writing merged state back to disk

### Module Responsibilities

| Module | Responsibility | Side Effects |
|--------|---------------|--------------|
| `scanner.ts` | Read live data from `~/.claude/` | None (pure read) |
| `store.ts` | Load/save/merge historical data | Writes to `~/.claude-monitor/` |
| `use-watch.ts` | Orchestrate poll → scan → merge → render | React state updates |

## Storage Layout

```
~/.claude-monitor/
├── projects/
│   ├── {hash}.json          # Per-project accumulated history
│   ├── {hash}.json
│   └── ...
└── meta.json                # Global metadata (schema version, last scan)
```

### Project Hash

Each project file is named by a deterministic hash of the project's absolute path:

```typescript
import { createHash } from "node:crypto";

function projectHash(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
}
// "/Users/bonjuice/Desktop/Eng/project_claude_monitor" → "a3f9c1b20e47.json"
```

Why hash instead of encoded path? The Claude-style encoding (`-Users-bonjuice-...`) is lossy and long. A short hash is safe, unique, and filesystem-friendly.

### meta.json

```typescript
interface StoreMeta {
  schemaVersion: 1;
  lastScanAt: string;       // ISO timestamp
  projectCount: number;
}
```

### Project Store File

```typescript
interface ProjectStore {
  projectPath: string;
  projectName: string;
  updatedAt: string;         // ISO timestamp of last merge
  sessions: Record<string, SessionStore>;
}

interface SessionStore {
  id: string;
  source: "todos" | "tasks";
  firstSeenAt: string;       // ISO timestamp — when this session first appeared
  lastSeenAt: string;        // ISO timestamp — when last seen in live data
  gone: boolean;             // true if no longer present in live data
  goneAt?: string;           // ISO timestamp — when it disappeared
  meta?: {
    projectPath: string;
    projectName: string;
    summary?: string;
    firstPrompt?: string;
    gitBranch?: string;
  };
  items: StoredItem[];
}

// Union of TodoItem and TaskItem with tracking metadata
interface StoredItem {
  // --- Original fields (from TodoItem or TaskItem) ---
  content?: string;          // TodoItem
  id?: string;               // TaskItem
  subject?: string;          // TaskItem
  description?: string;      // TaskItem
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  owner?: string;            // TaskItem
  blocks?: string[];         // TaskItem
  blockedBy?: string[];      // TaskItem

  // --- Tracking metadata ---
  _firstSeenAt: string;      // When this item first appeared
  _lastSeenAt: string;       // When last seen in live data
  _gone: boolean;            // No longer in live data
  _goneAt?: string;          // When it disappeared
}
```

### Why `gone` instead of `deleted`?

We can't distinguish between "Claude deleted the file" and "the session ended naturally." The `gone` flag simply means "we saw it before, but it's not in live data anymore." The UI can interpret this as it wishes (dimmed, folded, labeled "archived").

## Merge Algorithm

The merge runs on every poll cycle (every 3 seconds). It must be fast — the scanner already does filesystem I/O, so the merge should add minimal overhead.

### Pseudocode

```
function merge(liveProjects: ProjectData[], store: Store): MergedProjectData[]
  for each project in store.allProjects():
    liveProject = find in liveProjects by projectPath

    if liveProject exists:
      for each liveSession in liveProject.sessions:
        storedSession = store.getSession(project, liveSession.id)

        if storedSession exists:
          // UPDATE: merge items, update timestamps
          for each liveItem in liveSession.items:
            storedItem = find in storedSession.items by id/content
            if storedItem exists:
              overwrite with live data, update _lastSeenAt
            else:
              add as new item with _firstSeenAt = now

          // Mark items that disappeared from live
          for each storedItem in storedSession.items:
            if not in liveSession.items:
              storedItem._gone = true
              storedItem._goneAt = now (if not already set)

          storedSession.gone = false  // it's back (or still alive)
          storedSession.lastSeenAt = now

        else:
          // NEW SESSION: store entirely
          store.addSession(project, liveSession)

      // Mark sessions that disappeared from live
      for each storedSession in store.getSessions(project):
        if not in liveProject.sessions:
          storedSession.gone = true
          storedSession.goneAt = now (if not already set)

    else:
      // Project has no live data — mark all sessions as gone
      for each session in store.getSessions(project):
        session.gone = true

  // Add new projects from live data not yet in store
  for each liveProject not in store:
    store.addProject(liveProject)

  // Save to disk
  store.save()

  // Return merged view: live data + gone items from history
  return buildMergedView(liveProjects, store)
```

### Item Identity

How to match a live item to a stored item:

| Source | Identity Key | Rationale |
|--------|-------------|-----------|
| `tasks` (TaskItem) | `item.id` | Stable numeric ID assigned by Claude |
| `todos` (TodoItem) | `item.content` | No ID field; content is the closest unique identifier |

Note: TodoItem content matching is imperfect — if content is edited, it looks like a new item. This is an acceptable trade-off given TodoWrite is the older, less-used system.

## Public API

### store.ts

```typescript
// Initialize store — creates ~/.claude-monitor/ if needed
export function initStore(): Store;

// Merge live scanner data with stored history, persist, return merged view
export function mergeAndPersist(
  liveProjects: ProjectData[],
  store: Store
): MergedProjectData[];

// Load store from disk (called once on startup)
export function loadStore(): Store;
```

### Updated types

```typescript
// Extended ProjectData with historical items
export interface MergedProjectData extends ProjectData {
  // Sessions now include gone items from history
  // Items with _gone=true are historical (no longer in live data)
  hasHistory: boolean;        // true if any gone sessions/items exist
  goneSessionCount: number;   // count of sessions no longer in live data
}
```

### use-watch.ts changes

```typescript
export function useWatchSessions(): {
  sessions: SessionData[];
  projects: MergedProjectData[];   // ← was ProjectData[]
  lastUpdate: Date | null;
}
```

The hook initializes the store on mount, then on each poll:

```
scanAll() → mergeAndPersist(liveData, store) → setState(mergedData)
```

## UI Impact

The persistence layer enables but does not mandate specific UI changes. Suggested treatments:

| Scenario | Suggested UI | Priority |
|----------|-------------|----------|
| Task with `_gone=true` | Dim text + `[archived]` label | P0 |
| Session with `gone=true` | Collapsed to single line, expandable | P1 |
| Kanban DONE column | Show completed + gone tasks | P0 |
| Activity feed | Include "task disappeared" events | P2 |

## Performance Considerations

### Write Frequency

The store writes to disk on every poll cycle where data changed (worst case: every 3s). Mitigation:

- Only write project files that actually changed (compare before write)
- JSON.stringify is fast for small objects (a project with 50 tasks ≈ 5-10KB)
- Async write (`writeFile`) to avoid blocking the poll loop

### Read Frequency

Store is loaded once on startup, then kept in memory. No repeated disk reads during polling.

### Storage Growth

Each project file grows as sessions accumulate. Rough sizing:

- 1 session with 10 tasks ≈ 2KB
- 50 sessions ≈ 100KB per project
- 20 projects ≈ 2MB total

No cleanup needed for the foreseeable future. If needed later, add a `maxAge` config to prune sessions older than N days.

## Future Extensions (L2: Lifecycle Tracking)

The current design stores the latest known state of each item. To track lifecycle transitions:

```typescript
interface StoredItem {
  // ... existing fields ...

  // L2: Status history (append-only)
  _history?: Array<{
    status: string;
    at: string;            // ISO timestamp
  }>;
}
```

On each merge, if an item's status changed from the stored version, append to `_history`. This is a backward-compatible addition — L1 works without it, L2 enriches it.

## Implementation Plan

| Step | Description | Files |
|------|-------------|-------|
| 1 | Create `store.ts` with `initStore()`, `loadStore()`, `mergeAndPersist()` | `src/watchers/store.ts` |
| 2 | Add `MergedProjectData` and `StoredItem` types | `src/types.ts` |
| 3 | Integrate store into `use-watch.ts` poll loop | `src/watchers/use-watch.ts` |
| 4 | UI: dim gone items, show `[archived]` label | `src/app.tsx` |
| 5 | UI: kanban DONE column includes gone tasks | `src/app.tsx` |
| 6 | Tests: merge algorithm edge cases | `src/watchers/__tests__/store.test.ts` |

## Open Questions

1. **Should gone items resurface if they reappear?** (Current design: yes — `gone` is flipped back to `false`)
2. **Should we store session-level metadata (summary, firstPrompt) in the store?** (Current design: yes — useful for displaying archived sessions)
3. **Max sessions per project before rotation?** (Current design: unlimited, revisit if storage becomes an issue)
