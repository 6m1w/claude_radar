# Claude Radar — Technical Design Document

## Scope

This document covers the **data capture and persistence layer** for Claude Radar:

1. **Event capture** — how we detect task/session changes (dual-layer: Plugin Hook + file polling)
2. **Persistence** — how we store accumulated history so data survives Claude Code's file cleanup
3. **Merge algorithm** — how live data, hook events, and stored history are reconciled

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

### Data Flow — Dual-Layer Capture

```
                        Layer 1: Plugin Hook (real-time)
                        ────────────────────────────────
Claude Code event ──→ hooks.json (PostToolUse, Stop, ...)
                        │
                        ▼
                  capture.sh (bash, <10ms)
                        │
                        ▼ append
              ~/.claude-radar/events.jsonl   ← transit buffer
                        │
                        ▼ Chokidar watch
                     ┌──────────────────┐
                     │                  │
                     │   store.merge()  │ ← merges hook events + live scan + history
                     │                  │
                     └──────────────────┘
                        ▲
                        │ 3s poll
                        │
                  Layer 2: File Polling (fallback)
                  ──────────────────────────────
           scanner.scanAll()  ──→  live ProjectData[]
           ~/.claude/{todos,tasks,projects}
                        │
                        ▼
                  useWatchSessions()  ──→  UI
                        │
                        ▼ write dirty
              ~/.claude-radar/projects/*.json
              (accumulated history)
```

### Why Dual-Layer?

| | Layer 1: Hook | Layer 2: Polling |
|---|---|---|
| **Latency** | ~7ms (event-driven) | 0–3000ms (interval) |
| **Coverage** | Only fires for hook-registered events | Scans full filesystem state |
| **Reliability** | Depends on Plugin being installed | Always works |
| **Missed data** | Never (Claude Code guarantees delivery) | Can miss short-lived files (<3s) |

Layer 1 solves the core problem: task files that exist for <3s get captured by the hook before Claude Code cleans them up. Layer 2 provides full filesystem context (git info, docs, session counts) that hooks don't carry, and serves as graceful degradation when the Plugin isn't installed.

### Module Responsibilities

| Module | Responsibility | Side Effects |
|--------|---------------|--------------|
| `capture.sh` | Receive hook stdin, append to events.jsonl | Writes `~/.claude-radar/events.jsonl` |
| `scanner.ts` | Read live data from `~/.claude/` | None (pure read) |
| `store.ts` | Load/save/merge historical data + consume events | Writes `~/.claude-radar/projects/*.json` |
| `use-watch.ts` | Orchestrate poll → scan → merge → render | React state updates |
| `hooks.json` | Declare Plugin hooks to Claude Code | None (declarative config) |

### Event Capture (Layer 1) — Plugin Hook

#### Hook Registration

Claude Radar ships as a Claude Code Plugin. The `hooks/hooks.json` declares which events to capture:

```json
{
  "description": "Real-time task/session event capture for Claude Radar.",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "TaskCreate|TaskUpdate|TodoWrite",
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/capture.sh task",
          "timeout": 3
        }]
      }
    ],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/capture.sh stop",
          "timeout": 3
        }]
      }
    ],
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/capture.sh start",
          "timeout": 3
        }]
      }
    ]
  }
}
```

**Why bash, not node?** Hook processes are short-lived — spawned per event, exit after writing. Node.js cold start is ~150ms (V8 init); bash is ~5ms. With a 3s timeout budget, bash keeps overhead under 10ms.

**Why `PostToolUse` with matcher?** We only care about task-related tool calls. The matcher filters to `TaskCreate`, `TaskUpdate`, and `TodoWrite` — other tools (Read, Write, Bash, etc.) are ignored, minimizing event volume.

#### capture.sh

```bash
#!/bin/bash
# Append hook event to transit buffer.
# Stdin: JSON from Claude Code (session_id, tool_name, input, output).
EVENT="$1"
EVENTS_FILE="$HOME/.claude-radar/events.jsonl"
mkdir -p "$(dirname "$EVENTS_FILE")"
STDIN=$(cat)
printf '{"event":"%s","ts":"%s","data":%s}\n' \
  "$EVENT" "$(date -u +%FT%TZ)" "$STDIN" >> "$EVENTS_FILE"
```

Safety properties:
- `>>` uses `O_APPEND` — POSIX guarantees atomic writes under PIPE_BUF (4096 bytes), safe for concurrent hooks
- File permissions: created with user's umask (typically 600)
- No parsing or processing — just capture and exit

#### events.jsonl Format

```jsonl
{"event":"task","ts":"2026-02-14T05:20:01Z","data":{"session_id":"d7d9...","tool_name":"TaskCreate","input":{"subject":"Add types","description":"..."},"output":{"id":"1"}}}
{"event":"task","ts":"2026-02-14T05:20:05Z","data":{"session_id":"d7d9...","tool_name":"TaskUpdate","input":{"taskId":"1","status":"in_progress"}}}
{"event":"stop","ts":"2026-02-14T05:38:19Z","data":{"session_id":"d7d9..."}}
```

#### Transit Buffer Lifecycle

events.jsonl is a **write-ahead log**, not permanent storage. Once the TUI consumes events and merges them into the per-project Store, the events are redundant.

Cleanup strategy:
1. TUI tracks byte offset of last consumed line
2. After consuming all events: `mv events.jsonl events.consumed && : > events.jsonl && rm events.consumed`
3. Safety cap in capture.sh: if file exceeds 10MB, truncate to last 1000 lines

Expected steady-state size: **<50KB** (events are consumed within seconds by the running TUI).

### File Polling (Layer 2) — Existing Scanner

The 5-phase scanner pipeline remains unchanged:

1. **Discover**: Scan `~/.claude/projects/` directories
2. **Git**: Read `.git/HEAD` for branch info
3. **Docs**: Detect CLAUDE.md, PRD.md, etc.
4. **Index**: Build session → project mapping
5. **Tasks**: Scan `~/.claude/todos/` and `~/.claude/tasks/`

The scanner provides the full `ProjectData[]` context that hooks don't carry (git info, docs, session counts, active session detection). Even without the Plugin hook, the scanner captures all data — just with up to 3s latency and a small risk of missing very short-lived files.

### Event Consumption in use-watch.ts

```typescript
// On each poll cycle:
const liveProjects = scanAll().projects;
const hookEvents = consumeEvents();     // read new lines from events.jsonl
const merged = store.merge(liveProjects, hookEvents);
store.save();
```

Between poll cycles, Chokidar watches `events.jsonl` — if a hook event arrives, it triggers an immediate merge without waiting for the next 3s poll.

## Storage Layout

```
~/.claude-radar/
├── events.jsonl             # Transit buffer — hook events (consumed + truncated)
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
// "/Users/bonjuice/Desktop/Eng/project_claude_radar" → "a3f9c1b20e47.json"
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
// Initialize store — creates ~/.claude-radar/ if needed
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

### Hook Overhead (Layer 1)

Each hook invocation (capture.sh) adds latency to Claude Code's tool call pipeline:

| Phase | Time |
|-------|------|
| bash startup | ~5ms |
| `cat` stdin | ~1ms |
| `printf >> events.jsonl` | ~1ms |
| **Total** | **~7ms** |

Claude Code's hook timeout is set to 3s. Our ~7ms is well within budget.

### TUI Event Consumption

| Trigger | Latency | Description |
|---------|---------|-------------|
| Chokidar event | ~50ms | events.jsonl change detected, immediate merge |
| Poll interval | 3000ms | Full filesystem scan + merge (fallback) |
| Store merge | ~5ms | In-memory operation |
| React render | ~10ms | Only if snapshotKey changed |

End-to-end (hook event → UI update): **~66ms**.

### Write Frequency

- **events.jsonl**: Append-only, written by capture.sh per hook event (~7 bytes/ms)
- **projects/*.json**: Written by store.save() only when data changed (dirty tracking). Worst case: every 3s per modified project
- Only dirty project files are written — unchanged projects incur zero I/O

### Read Frequency

- Store is loaded once on startup, then kept in memory
- events.jsonl is read on Chokidar change or poll cycle (incremental — tracks byte offset)
- No repeated full-disk reads during polling

### Storage Growth

**projects/*.json** (permanent store):

- 1 session with 10 tasks ≈ 2KB
- 50 sessions ≈ 100KB per project
- 20 projects ≈ 2MB total

**events.jsonl** (transit buffer):

- ~500 bytes per event average
- Consumed and truncated within seconds when TUI is running
- Steady-state size: <50KB
- Safety cap: 10MB / 1000 lines (truncated by capture.sh)
- Worst case (TUI not running for a week, heavy user): ~2.5MB — harmless

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

### Phase 1 — Persistence Layer (✅ Done)

| Step | Description | Files | Status |
|------|-------------|-------|--------|
| 1 | Add persistence types (StoredItem, SessionStore, etc.) | `src/types.ts` | ✅ |
| 2 | Create `store.ts` with Store class, merge algorithm | `src/watchers/store.ts` | ✅ |
| 3 | Integrate store into `use-watch.ts` poll loop | `src/watchers/use-watch.ts` | ✅ |
| 4 | Add DisplayItem type to preserve `_gone` metadata for UI | `src/types.ts` | ✅ |
| 5 | Tests: merge algorithm (15 tests, all passing) | `src/watchers/__tests__/store.test.ts` | ✅ |

### Phase 2 — Plugin Hook Capture (Next)

| Step | Description | Files |
|------|-------------|-------|
| 6 | Create `hooks/hooks.json` declaring PostToolUse, Stop, SessionStart | `hooks/hooks.json` |
| 7 | Create `hooks/capture.sh` — stdin → events.jsonl append | `hooks/capture.sh` |
| 8 | Add event consumer to store.ts — parse events.jsonl, merge into Store | `src/watchers/store.ts` |
| 9 | Add Chokidar watcher for events.jsonl in use-watch.ts | `src/watchers/use-watch.ts` |
| 10 | Add transit buffer cleanup (offset tracking + truncation) | `src/watchers/store.ts` |
| 11 | Plugin packaging (`.claude-plugin/marketplace.json`, hooks dir) | `.claude-plugin/` |
| 12 | Tests: event consumption, deduplication with polling | `src/watchers/__tests__/store.test.ts` |

### Phase 3 — UI Treatment (Later, with frontend redesign)

| Step | Description | Files |
|------|-------------|-------|
| 13 | UI: dim gone items, show `[archived]` label | `src/app.tsx` |
| 14 | UI: kanban DONE column includes gone tasks | `src/app.tsx` |
| 15 | UI: activity feed includes "task disappeared" events | `src/app.tsx` |

## Resolved Decisions

1. **Gone items resurface if they reappear** — `gone` is flipped back to `false` on re-detection ✅
2. **Session-level metadata is stored** — summary, firstPrompt, gitBranch preserved for archive view ✅
3. **Unlimited sessions per project** — revisit if storage becomes an issue ✅
4. **Capture script uses bash, not node** — cold start ~5ms vs ~150ms, critical for hook timeout budget ✅
5. **events.jsonl is a transit buffer, not permanent store** — consumed + truncated by TUI ✅

## Open Questions

1. **Plugin distribution**: Ship as standalone CLI (`npx claude-radar`) with optional Plugin install? Or Plugin-first with TUI bundled inside?
2. **Event deduplication**: When both hook and polling capture the same TaskCreate, the Store merge already deduplicates by item key (`task:{id}`). But should we deduplicate at the event level too (skip events whose data is already in Store)?
3. **Shared Plugin infra with sound-fx**: Both projects use the same Claude Code Plugin hook system. Should they share a common event collector, or stay independent?
