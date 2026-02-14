# Claude Monitor — Design Spec

## Current Problems

1. **No true global overview** — "Global" view only shows one project's detail at a time. Cannot see all projects' progress simultaneously.
2. **Per-project only** — No way to view all active tasks across projects, or multi-select projects for side-by-side comparison.
3. **No git context** — Missing commit history, branch info is minimal. Users can't correlate task progress with actual code changes.
4. **Single theme** — Catppuccin Mocha only. No customization for different terminal backgrounds or user preferences.

## Design Principles

- **Keyboard-first** — All actions reachable via keyboard (vim-style j/k/Enter/Esc)
- **Information density** — Show maximum useful data per screen, no wasted space
- **Progressive disclosure** — Summary first, drill down for details
- **Hacker aesthetic** — ASCII art, retro progress bars, terminal-native feel

## View System

### View 1: Dashboard (default)

All-projects-at-a-glance. The "home screen".

```
╭─ OVERVIEW ──────────────────────────╮╭─ ACTIVE NOW ─────────────────────────╮
│                                      ││                                      │
│  4 projects  7 agents  23 tasks      ││  ◍ monitor/main    #4 Design UI      │
│  [===============>........] 65%      ││  ◍ outclaws/str-a  #2 Dashboard      │
│                       ○              ││  ◍ outclaws/str-b  #2 Migrations     │
│                      /|＼    ⌨       ││                                      │
│                      / ＼            ││                                      │
╰──────────────────────────────────────╯╰──────────────────────────────────────╯
╭─ PROJECTS ───────────────────────────────────────────────────────────────────╮
│                                                                              │
│  ● claude_monitor   ⎇ main   [============>........] 3/5   ◍ 1 agent  2m   │
│  ● outclaws         ⎇ main   [========>............] 4/10  ◍ 3 agents 5m   │
│  ✓ sound_effects    ⎇ main   [=====================] 3/3   ○ 1 agent  1h   │
│  ○ keyboard         ⎇ main   [===============>....] 7/8    ○ 1 agent  20d  │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ ACTIVITY ───────────────────────────────────────────────────────────────────╮
│  10:08  monitor   ▶ #4 Design hacker UI theme                                │
│  10:05  outclaws  ▶ #2 User dashboard                                        │
│  10:03  monitor   ✓ #3 Polling watcher                                       │
╰──────────────────────────────────────────────────────────────────────────────╯
 CPU ▁▃▅▇▅▃▁▃ 23% │ MEM ██████░░ 4.2/8G │ ↑ 1.2 KB/s ↓ 45.3 KB/s │ ⠋ polling
 ↑↓ nav  Enter select  Tab switch  1-3 panel  h hide done  t theme  q quit
```

Key features:
- **OVERVIEW** panel: aggregate stats + overall progress bar
- **ACTIVE NOW** panel: currently running agent+task pairs (the most important info)
- **PROJECTS** panel: one line per project with inline progress bar
- **ACTIVITY** panel: recent events timeline

Navigation: `j/k` moves cursor in PROJECTS, `Enter` drills into Project Detail view.

### View 2: Project Detail

Deep dive into a single project. Reached by pressing `Enter` on a project in Dashboard.

```
╭─ Tasks ──────────────────╮╭─ Git History ─────────────╮╭─ PRD / Docs ─────────────╮
│                           ││                           ││                           │
│  ⎇ main │ 1 agent │ 2m   ││  ● faf45fa docs: update   ││  # Claude Monitor        │
│  [==========>....] 3/5    ││  │         PRD             ││                           │
│                           ││  ● e4bc709 fix: replace    ││  TUI dashboard for       │
│  ◍ main                   ││  │         chokidar        ││  monitoring Claude Code   │
│    ✓ #1 Setup Ink + TS    ││  ● eaa40ec docs: update    ││  agent tasks and todos.  │
│    ✓ #2 Session index     ││  │         PRD             ││                           │
│    ✓ #3 Polling watcher   ││  ● ce5ef2d fix: resolve    ││  ## Tech Stack           │
│    ▶ #4 Design hacker UI  ││  │   project names         ││  - TypeScript + Ink      │
│    ○ #5 Keyboard nav      ││  ● 96e90e6 feat: add       ││  - 1s poll + snapshot    │
│                           ││      project context       ││  - Catppuccin Mocha      │
╰───────────────────────────╯╰───────────────────────────╯╰───────────────────────────╯
╭─ Task Detail ────────────────────────────────────────────────────────────────────────╮
│  ▶ #4 Design hacker UI theme                                                         │
│  owner: main │ status: active │ blocked_by: none                                     │
│  description: Implement Catppuccin Mocha palette, multi-panel layout...               │
╰──────────────────────────────────────────────────────────────────────────────────────╯
```

Key features:
- **Left**: Task list with agent grouping
- **Center**: Git history with commit graph (3-5 recent commits, colored by type)
- **Right**: Project docs — reads `docs/PRD.md`, `CLAUDE.md`, or `README.md` from project directory
- **Bottom**: Selected task's full detail (description, owner, blockers)

PRD panel data source: `{projectPath}/docs/PRD.md` → `{projectPath}/CLAUDE.md` → `{projectPath}/README.md` (first found). Rendered as plain text with basic markdown highlighting (headers bold, lists indented). Scrollable with `j/k` when panel focused.

Navigation: `j/k` moves task cursor, `1-3` to focus panels, `Enter` shows task detail, `Esc` back to Dashboard.

### View 3: Focus / Kanban

Multi-project kanban for parallel development monitoring. Two layout modes toggled with `s`.

**Layout A: By Agent** (default) — each agent is a column, tasks listed vertically.

```
╭─ FOCUS: 2 projects, 4 agents ───────────────────────────────────────────────╮
│                                                                              │
│  ── claude_monitor ⎇ main ──────────────────────────────────────             │
│  ┌─ ◍ main ── 3/5 ─┐                                                        │
│  │ ✓ Setup Ink      │                                                        │
│  │ ✓ Session index  │                                                        │
│  │ ✓ Polling        │                                                        │
│  │ ▶ Design UI      │                                                        │
│  │ ○ Keyboard nav   │                                                        │
│  └──────────────────┘                                                        │
│                                                                              │
│  ── outclaws ⎇ main ────────────────────────────────────────────             │
│  ┌─ ◍ stream-a 1/3 ┐┌─ ◍ stream-b 1/2 ┐┌─ ○ stream-c 0/2 ┐               │
│  │ ✓ Auth module    ││ ✓ DB schema      ││ ⊘ Unit tests     │               │
│  │ ▶ User dashboard ││ ▶ Migrations     ││ ○ E2E tests      │               │
│  │ ○ API endpoints  ││                  ││                   │               │
│  └──────────────────┘└──────────────────┘└───────────────────┘               │
╰──────────────────────────────────────────────────────────────────────────────╯
```

**Layout B: Swimlane Table** — shared header row, projects as row groups. Like an Excel pivot table.

```
╭─ FOCUS ──────────────────────────────────────────────────────────────────────╮
│                                                                              │
│              │ TODO             │ DOING            │ DONE                    │
│  ────────────┼──────────────────┼──────────────────┼──────────────────────── │
│              │                  │                  │                         │
│  monitor     │ ○ Keyboard nav   │ ▶ Design UI      │ ✓ Setup Ink            │
│  ⎇ main      │                  │                  │ ✓ Session idx          │
│              │                  │                  │ ✓ Polling              │
│  ────────────┼──────────────────┼──────────────────┼──────────────────────── │
│              │                  │                  │                         │
│  outclaws    │ ○ API endpoints  │ ▶ Dashboard      │ ✓ Auth module          │
│  ⎇ main      │ ○ E2E tests     │   └ stream-a     │   └ stream-a           │
│  3 agents    │   └ stream-c    │ ▶ Migrations     │ ✓ DB schema            │
│              │ ⊘ Unit tests    │   └ stream-b     │   └ stream-b           │
│              │   └ stream-c    │                  │                         │
│  ────────────┼──────────────────┼──────────────────┼──────────────────────── │
│              │                  │                  │                         │
│  sound_fx    │                  │                  │ ✓ Cross-platform       │
│  ⎇ main      │                  │                  │ ✓ 12 theme packs      │
│              │                  │                  │ ✓ Opencode plugin     │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Key features:
- `s` toggles between agent layout and swimlane table
- Single shared header row — TODO / DOING / DONE columns span all projects
- Projects as row groups separated by horizontal dividers
- Left column shows project name, branch, agent count
- Multi-agent tasks show `└ agent-name` below the task
- Single-agent projects omit agent label (no noise)
- DONE column requires local persistence (tasks vanish from Claude Code after completion)
- Only shows projects with `status != "done"` by default (toggle with `h`)

Access: `Tab` from Dashboard, or `f` to filter which projects appear.

### View Navigation Map

```
  Dashboard ──Enter──▸ Project Detail
     │                    │
     │                    Esc
     │                    │
     Tab ◂────────────▸ Focus/Kanban
```

## Data Capture Scope

### What IS captured (structured data)

| Source | Data | Fields |
|--------|------|--------|
| `~/.claude/todos/{session}-agent-*.json` | TodoWrite items | `content`, `status` (pending/in_progress/completed), `activeForm` |
| `~/.claude/tasks/{session}/*.json` | TaskCreate items | `id`, `subject`, `description`, `status`, `owner`, `blocks`, `blockedBy` |
| `~/.claude/projects/*/sessions-index.json` | Session metadata | `sessionId`, `projectPath`, `summary`, `gitBranch` |
| `git log` (per projectPath) | Commit history | hash, message, timestamp |
| `{projectPath}/docs/PRD.md` etc. | Project documentation | raw file content |

### What is NOT captured

| Data | Location | Why not |
|------|----------|---------|
| Claude's questions to user (AskUserQuestion) | JSONL conversation log | Not structured — mixed into full conversation stream |
| User's answers/choices | JSONL conversation log | Same — would need full JSONL parsing |
| Tool calls (Read, Edit, Bash...) | JSONL conversation log | Too granular, not useful for task-level monitoring |
| Claude's thinking/reasoning | JSONL conversation log | Internal to the model |

### Persistence Strategy

Claude Code deletes task files when tasks are completed or sessions end. To keep history:

1. **Snapshot on every poll** — when scanner finds data, save a copy to `~/.claude-monitor/snapshots/{sessionId}.json`
2. **Merge on read** — on startup, load both live data (`~/.claude/`) and snapshots, merge by sessionId
3. **DONE column** — only possible with snapshots. Without persistence, completed tasks vanish.
4. **Stale detection** — if a snapshot exists but no live data, mark session as "archived"

This is critical for the swimlane DONE column and for showing historical sessions.

## Components

### Git History Panel

Data source: Run `git log --oneline -N` against the project's directory.

```
● a1b2c3d feat: initial setup
│
● e4f5g6h fix: layout bugs
│
● i7j8k9l chore: update deps
```

- Color commits by type: `feat` green, `fix` yellow, `docs` blue, `chore` dim
- Show branch name if not main
- Show 3-5 most recent commits (scrollable with j/k when panel focused)

### Progress Bars

Two styles available per theme:

**Block style** (Catppuccin):
```
████████████░░░░░░░░ 3/5  60%
```

**ASCII style** (Retro):
```
[===============>........] 65% ACTIVE
```

### Status Badges

For build/error/deploy status (future — v0.4 hook integration):

```
[✓] BUILD:  PASSING
[!] DEPLOY: PENDING
[✗] ERROR:  DB CONNECTION
```

### Active Task Indicator

Shows what each agent is currently doing:

```
◍ monitor/main    ▶ #4 Design hacker UI    2m
◍ outclaws/str-a  ▶ #2 User dashboard      5m
```

### System Metrics Bar

Persistent status bar showing live system metrics. The constantly fluctuating numbers create a strong "alive" signal.

```
╭─ SYSTEM ─────────────────────────────────────────────────────────────────────╮
│  CPU ▁▃▅▇▅▃▁▃ 23%  │  MEM ██████░░ 4.2/8 GB  │  ↑ 1.2 KB/s  ↓ 45.3 KB/s │
╰──────────────────────────────────────────────────────────────────────────────╯
```

- **CPU**: Sparkline mini-graph (last 8 samples) + current percentage
- **MEM**: Bar + used/total
- **Network**: Upload/download rate with `↑` `↓` arrows
- Position: Bottom of screen, above the keyboard hint bar
- Data source: `os.cpus()`, `os.freemem()/totalmem()`, network via `process.cpuUsage()` or `/proc/net/dev` (macOS: `netstat`)
- Refresh: 1s (same interval as data polling — reuse the timer)

### ASCII Character (Mascot)

Animated character that reflects system state. Placed in the Dashboard OVERVIEW panel or bottom-right corner.

**Idle** (no active agents):
```
    ○
   /|＼
   / ＼
  zzZ...
```

**Working** (agents running — 2 frame loop):
```
 Frame 1:        Frame 2:
    ○                ○
   /|＼    ⌨       ＜|＼    ⌨
   / ＼             / ＼
```

**All done** (everything completed):
```
   ＼○／
    |
   / ＼
  done!
```

- Frames cycle at 500ms (2 fps)
- State auto-detects from agent status: any `working` → working animation, all `done` → celebration, else idle
- Disable with `animations: false` in config

### Animations

All animations are optional — toggled via config `{ "animations": true }` or `--no-animations` flag.

| Animation | Where | FPS | Description |
|-----------|-------|-----|-------------|
| Spinner | Activity panel, status bar | 10 | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` braille rotation |
| Active task pulse | Task list | 2 | `▶` blinks yellow/dim |
| New task flash | Task list | — | 1.5s yellow highlight on new items |
| ASCII mascot | Dashboard corner | 2 | State-dependent character animation |
| Sparkline | System metrics | 1 | CPU history graph updates each second |
| Number roll | Progress bars | — | Counter animates from old to new value on change |

```typescript
// Animation config in Theme
interface Theme {
  // ... existing fields
  animations: {
    enabled: boolean;
    spinnerFps: number;     // default 10
    pulseFps: number;       // default 2
    typewriterCps: number;  // chars per second, default 30
  };
}
```

## Theme System

### Architecture

Themes are plain objects mapping semantic names to colors/characters:

```typescript
interface Theme {
  name: string;
  colors: {
    primary: string;    // focus borders, active items
    success: string;    // done, passing
    warning: string;    // in-progress, pending
    error: string;      // blocked, failed
    text: string;       // primary text
    subtext: string;    // secondary text
    dim: string;        // disabled, borders
    accent: string;     // branch names, highlights
  };
  progress: {
    filled: string;     // e.g. "█" or "="
    empty: string;      // e.g. "░" or "."
    head: string;       // e.g. "" or ">"
    left: string;       // e.g. "" or "["
    right: string;      // e.g. "" or "]"
  };
  border: "round" | "single" | "double" | "bold";
  icons: {
    active: string;     // e.g. "●" or "*"
    working: string;    // e.g. "◍" or "~"
    idle: string;       // e.g. "○" or "-"
    done: string;       // e.g. "✓" or "+"
    error: string;      // e.g. "✗" or "x"
  };
}
```

### Theme 1: Catppuccin Mocha (default)

The lazygit-inspired palette. Clean, modern, easy on the eyes.

```
Colors: cyan primary, green success, yellow warning, red error
Progress: ████████░░░░ 3/5
Border: round (╭╮╰╯)
Icons: ● ◍ ○ ✓ ✗
```

### Theme 2: Retro Terminal

Classic green-on-black, ASCII-only. Maximum hacker aesthetic.

```
Colors: #00ff00 primary, #00ff00 success, #ffff00 warning, #ff0000 error
Progress: [============>..........] 65%
Border: single (┌┐└┘) or ASCII (+--+)
Icons: [*] [~] [-] [+] [x]
```

### Theme 3: Cyberpunk

Neon pink/cyan with bold borders. High contrast.

```
Colors: #ff00ff primary, #00ffff success, #ffff00 warning, #ff0000 error
Progress: ▓▓▓▓▓▓▓▓░░░░ 3/5
Border: double (╔╗╚╝)
Icons: ◆ ◈ ◇ ✦ ✧
```

### Theme Switching

- Config file: `~/.claude-monitor/config.json` → `{ "theme": "catppuccin" }`
- Runtime toggle: `t` key cycles themes
- CLI flag: `claude-monitor --theme retro`

## Keyboard Map (Full)

```
Global:
  q           Quit
  Tab         Cycle views: Dashboard → Focus → Dashboard
  t           Cycle theme
  /           Search filter (fuzzy match project/task names)
  h           Hide/show completed projects
  ?           Show help overlay

Navigation:
  j / ↓       Move cursor down
  k / ↑       Move cursor up
  Enter       Drill in (Dashboard → Project Detail, or expand task)
  Esc         Back / close overlay
  1-3         Jump to panel (when view has numbered panels)

Focus view:
  f           Filter: choose which projects to show
  Space       Toggle project selection (multi-select in filter mode)
```

## Data Flow

```
~/.claude/todos/*          ──┐
~/.claude/tasks/*          ──┤
~/.claude/projects/*/      ──┤──▸ Scanner ──▸ SessionData[] ──▸ React State
  sessions-index.json      ──┤       │                              │
  *.jsonl (fallback)       ──┘       │                              ▼
                                     │                         Ink Render
git log (per project dir)  ──────────┘                              │
                                                                    ▼
~/.claude-monitor/                                             Terminal
  config.json (theme)
  snapshots/ (persistence)
```

## Implementation Priority

| Priority | Component | View | Complexity |
|----------|-----------|------|------------|
| P0 | Dashboard view (all-projects summary) | Dashboard | Medium |
| P0 | Keyboard navigation (j/k/Enter/Esc) | All | Medium |
| P1 | Project Detail view with task list | Detail | Low (exists) |
| P1 | Git history panel | Detail | Medium |
| P1 | Focus/Kanban view | Focus | Low (exists) |
| P2 | Theme system + 3 themes | All | Medium |
| P2 | Search/filter | All | Low |
| P2 | Task detail expansion | Detail | Low |
| P2 | System metrics bar (CPU/MEM/NET) | All (bottom) | Low |
| P2 | ASCII mascot animation | Dashboard | Low |
| P2 | Animation system (pulse, flash, sparkline) | All | Medium |
| P3 | Local snapshot persistence | All | Medium |
| P3 | Status badges (build/deploy) | Dashboard | Low (needs hooks) |

## Resolved Decisions

1. **Terminal size**: Minimum 80 cols × 24 rows (13" screen half-width). Panels reflow at narrow widths.
2. **Refresh rate**: 1s polling for now. May make configurable later.
3. **Git history depth**: 3-5 most recent commits. Keeps panel compact, avoids perf issues on large repos.
4. **Multi-select in Focus**: Default shows all active projects. `f` opens filter to toggle individual projects on/off.
