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
- **Responsive** — Panels stretch to fill terminal width; extra space used for metrics charts
- **Performance-first** — Animations and charts must not impact responsiveness; all optional via config

## View System

The UI uses a **2-view architecture**: Dashboard (with integrated Master-Detail) and Focus/Kanban. The old standalone Project Detail view has been merged into Dashboard as an "inner focus" mode — no page navigation needed.

### View 1: Dashboard (default) — Master-Detail Single Page

All-projects-at-a-glance with integrated project drill-down. Two focus levels on one screen.

**Outer Focus** — browsing projects (`j/k` moves cursor, right panel follows):

```
╭─ OVERVIEW ──────────────────────────╮╭─ ACTIVE NOW ─────────────────────────╮
│                                      ││                                      │
│  4 projects  7 agents  23 tasks      ││  ◍ monitor/main    #4 Design UI      │
│  [===============>........] 65%      ││  ◍ outclaws/str-a  #2 Dashboard      │
│                                      ││  ◍ outclaws/str-b  #2 Migrations     │
╰──────────────────────────────────────╯╰──────────────────────────────────────╯
╭─ PROJECTS (41) ────╮╭─ DETAIL ─────────────────────────────────────────────╮
│  ▲ 3 more           ││                                                      │
│  ☑ ● sound_fx      ││  ⎇ main │ 1 agent │ 5 sessions                      │
│  ☐ ● keyboard      ││  docs: CLAUDE.md  PRD.md                             │
│▸ ☑ ● monitor  ⎇feat││  tasks: [============>........] 3/5                  │
│  ☐ ● outclaws ⎇main││                                                      │
│  ☐ ○ my_website    ││  ✓ #1 Setup Ink + TS                                │
│  ☐ ○ api_server    ││  ✓ #2 Session index                                 │
│  ▼ 32 more          ││  ✓ #3 Polling watcher                               │
│                      ││  ▶ #4 Design hacker UI                              │
│                      ││  ○ #5 Keyboard nav                                  │
│                      ││  ... +2 more                                        │
╰──────────────────────╯╰──────────────────────────────────────────────────────╯
╭─ ACTIVITY ───────────────────────────────────────────────────────────────────╮
│  10:08  monitor    › #4 Design hacker UI theme                               │
│  10:05  outclaws   › #2 User dashboard                                       │
│  10:03  monitor    ✓ #3 Polling watcher                                      │
╰──────────────────────────────────────────────────────────────────────────────╯
 ☻⌨ · │ CPU ▁▃▅▇▅▃▁▃ 23% │ MEM ██████░░ 4.2/8G │ ↑1.2 ↓45.3 KB/s │ ⠋
 DASHBOARD │ ↑↓ nav  Enter focus  Space select  Tab kanban  q quit
```

**Inner Focus** — browsing tasks within a project (`Enter` to enter, `Esc` to exit):

```
╭─ OVERVIEW ──────────────────────────╮╭─ ACTIVE NOW ─────────────────────────╮
│  4 projects  7 agents  23 tasks 65%  ││  ◍ monitor/main    #4 Design UI      │
╰──────────────────────────────────────╯╰──────────────────────────────────────╯
╭─ PROJECTS (41) ────╮╭─ TASKS ── [1:Tasks] [2:Git] [3:Docs] ────────────────╮
│  ☑ ● sound_fx      ││  ⎇ main │ 1 agent │ 5 sessions                      │
│  ☐ ● keyboard      ││  tasks: [============>........] 3/5                  │
│▸ ☑ ● monitor  ⎇feat││                                                      │
│  ☐ ● outclaws ⎇main││    ✓ #1 Setup Ink + TS                              │
│  ☐ ○ my_website    ││    ✓ #2 Session index                               │
│                      ││    ✓ #3 Polling watcher                             │
│                      ││  ▸ ▶ #4 Design hacker UI          ← task cursor    │
│                      ││    ○ #5 Keyboard nav                                │
│                      ││ ─── Task Detail ────────────────────                │
│                      ││ owner: main │ in_progress │ no blockers             │
│                      ││ Implement Catppuccin Mocha palette...               │
╰──────────────────────╯╰──────────────────────────────────────────────────────╯
╭─ PRD.md ─────────────────────────────╮╭─ Git History ────────────────────────╮
│  # Claude Monitor                     ││  ● faf45fa docs: update PRD          │
│                                       ││  │                                   │
│  TUI dashboard for monitoring Claude  ││  ● e4bc709 fix: replace chokidar    │
│  Code agent tasks and todos.          ││  │                                   │
│                                       ││  ● eaa40ec docs: update PRD          │
│  ## Tech Stack                        ││  │                                   │
│  - TypeScript + Ink                   ││  ● ce5ef2d fix: resolve project      │
╰───────────────────────────────────────╯╰──────────────────────────────────────╯
 ☻⌨ · │ CPU ▁▃▅▇▅▃▁▃ 23% │ MEM ██████░░ 4.2/8G │ ↑1.2 ↓45.3 KB/s │ ⠋
 DETAIL │ ↑↓ nav tasks  1/2/3 tab  Esc back  q quit
```

Key design decisions:
- **Master-Detail on one page**: No separate Project Detail view. Right panel follows cursor in real-time.
- **Two-level focus**: Outer = project nav, Inner = task nav. `Enter`/`Esc` transitions.
- **Context-aware bottom panel (B1)**: Outer focus → ACTIVITY; Inner focus → PRD/Docs + Git History.
- **Right panel tabs**: In inner focus, `1/2/3` switches between Tasks, Git History, Docs views.
- **Viewport scrolling**: Projects list shows only N visible rows with `▲ N more` / `▼ N more` indicators.
- **Height cap**: Projects+Detail row is capped at 50% of terminal height, ensuring bottom panels have space.

Docs panel data source: `{projectPath}/docs/PRD.md` → `{projectPath}/CLAUDE.md` → `{projectPath}/README.md` (first found). Rendered as plain text with basic markdown highlighting (headers bold, lists indented). Scrollable with `j/k` when panel focused.

Git History panel data source: `git log --oneline -N` against the project directory. Color commits by type: `feat` green, `fix` yellow, `docs` blue, `chore` dim. Show 3-5 most recent commits.

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

Access: `Tab` from Dashboard. Shows projects selected with `Space`; if none selected, shows all active.

**Planned enhancements (v0.3):**

Dependency visualization and time-in-status indicators in swimlane cells:

```
│ TODO                │ DOING               │ DONE              │
│                     │                     │                   │
│ ○ Keyboard nav      │ ▶ Design UI         │ ✓ Setup Ink       │
│   ⊘ blocked:#4     │   ↑ 2h in-doing     │                   │
│ ○ E2E tests         │ ▶ Migrations        │ ✓ DB schema       │
│   ⊘ blocked:#2     │   └ stream-b        │   └ stream-b      │
```

- **`⊘ blocked:#N`**: Shows which task is blocking this one (from `blockedBy` field)
- **`↑ Xh in-doing`**: How long the task has been in its current status (requires mtime tracking)
- No Gantt chart — task data lacks start/end timestamps; Kanban is the better fit for event-driven workflows

### View Navigation

```
┌──────────────────────────────────────┐
│         Dashboard (home)              │
│                                       │
│  ┌─ Outer Focus ────────────────┐    │
│  │  j/k = nav projects          │    │
│  │  Enter = inner focus         │    │
│  │  Bottom = ACTIVITY           │    │
│  └──────────────────────────────┘    │
│         │ Enter          ▲ Esc       │
│         ▼                │           │
│  ┌─ Inner Focus ────────────────┐    │
│  │  j/k = nav tasks             │    │
│  │  1/2/3 = tab switch          │    │
│  │  Bottom = PRD/Docs + Git     │    │
│  └──────────────────────────────┘    │
│                                       │
│         │ Tab            ▲ Esc       │
│         ▼                │           │
│  ┌─ Focus / Kanban ─────────────┐    │
│  │  s = toggle layout           │    │
│  │  h = hide/show completed     │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

Note: Dashboard outer focus, inner focus, and Kanban are all within the same "Dashboard" view — there is no separate page navigation. `Enter`/`Esc` transitions between focus levels. `Tab` opens Kanban overlay.

**Outer Focus (default) — project navigation:**

| Key | Action | Notes |
|-----|--------|-------|
| `↑` `↓` (or `j` `k`) | Move project cursor | `▸` indicates current row; right panel follows |
| `Enter` | Enter inner focus | Task cursor appears in right panel; bottom → Docs+Git |
| `Space` | Toggle ☑ selection | Marks project for Kanban view |
| `Tab` | Open Focus/Kanban | Shows ☑ projects; if none ☑, shows all active |
| `Esc` | — | No-op (already at top level) |

**Inner Focus — task navigation:**

| Key | Action |
|-----|--------|
| `↑` `↓` (or `j` `k`) | Navigate tasks in right panel |
| `1` `2` `3` | Switch right panel tab: Tasks / Git History / Docs |
| `Esc` | Exit to outer focus; bottom → ACTIVITY |

**Focus/Kanban:**

| Key | Action |
|-----|--------|
| `s` | Toggle layout: By Agent ↔ Swimlane Table |
| `h` | Hide/show completed projects |
| `Esc` | Back to outer focus |

**Global keys (work in all focus levels):**

| Key | Action |
|-----|--------|
| `t` | Cycle theme |
| `/` | Search filter |
| `q` | Quit |

Key principle: **`Enter` and `Space` are independent**. `Enter` transitions focus level (outer → inner). `Space` toggles selection marks (for Kanban). The two don't interfere.

## Responsive Layout

Panels adapt to terminal size using Ink's flexbox model. The goal: **useful at 80×24, expansive at 160×50+**.

### Panel Sizing Strategy

Each panel has one of two sizing modes:

| Mode | Ink prop | Behavior |
|------|----------|----------|
| **Fixed** | `width={N}` | Always N columns. Used for compact, scannable panels (project list). |
| **Flex** | `flexGrow={1}` | Expands to fill remaining space. Used for content-heavy panels (detail, activity). |

When multiple flex panels share a row, they split the extra space equally.

Rule: A panel uses **either** `width` or `flexGrow`, never both. If neither is set, it sizes to content.

### Vertical Height Management

Terminal height is split into rows with configurable proportions:

```
Terminal rows (e.g., 40)
──────────────────────────────
 Row A: Overview + Active    → fixed ~3 rows
 Row B: Projects + Detail    → elastic, capped at maxMiddlePercent (default 50%)
 Row C: Activity / Docs+Git  → fills remaining space
 Row D: StatusBar            → fixed 2 rows
 Borders + spacing           → ~4 rows
──────────────────────────────
```

**Height calculation:**

```typescript
const { rows } = useStdout();
const fixedRows = 3 + 2 + 4; // overview + statusbar + borders
const available = rows - fixedRows;
const maxMiddle = Math.floor(rows * layout.maxMiddlePercent);
const middleRows = Math.min(available * 0.5, maxMiddle);
const bottomRows = available - middleRows;
```

**Viewport scrolling for project list:**

The project list renders at most `middleRows - borders` visible items. When cursor moves beyond the visible window, `scrollOffset` adjusts to keep cursor in view.

```
╭─ PROJECTS (41) ─────╮
│  ▲ 3 more            │   ← scrollOffset > 0
│  sound_fx            │
│  keyboard            │
│▸ monitor        ⎇feat│   ← cursorIdx (always visible)
│  outclaws       ⎇main│
│  my_website          │
│  ▼ 32 more           │   ← more items below
╰──────────────────────╯
```

### Dashboard Layout — Outer Focus

**Standard terminal (80+ cols):**

```
┌─ Overview (flexGrow) ──────┐┌─ Active Now (flexGrow) ─────┐  Row A (fixed)
└────────────────────────────┘└─────────────────────────────┘
┌─ Projects (fixed W) ──┐┌─ Detail (flexGrow) ──────────────┐  Row B (capped 50%)
│  viewport scrolling    ││  summary + truncated tasks       │
└────────────────────────┘└──────────────────────────────────┘
┌─ Activity (flexGrow) ─────────────────────────────────────┐  Row C (remaining)
└───────────────────────────────────────────────────────────┘
```

**Wide terminal (120+ cols):**

```
┌─ Overview ─────────────────┐┌─ Active Now ────────────────┐  Row A
└────────────────────────────┘└─────────────────────────────┘
┌─ Projects (fixed) ────┐┌─ Detail (flexGrow) ──────────────┐  Row B
└────────────────────────┘└──────────────────────────────────┘
┌─ Activity (flexGrow) ──────────┐┌─ Metrics Chart (flexGrow) ┐  Row C
└────────────────────────────────┘└────────────────────────────┘
```

The `Metrics Chart` panel appears when terminal width exceeds ~120 cols.

### Dashboard Layout — Inner Focus

Bottom row transforms from Activity to project-contextual panels:

```
┌─ Overview (flexGrow) ──────┐┌─ Active Now (flexGrow) ─────┐  Row A (fixed)
└────────────────────────────┘└─────────────────────────────┘
┌─ Projects (fixed W) ──┐┌─ Tasks [1:Tasks 2:Git 3:Docs] ──┐  Row B (capped 50%)
│  viewport scrolling    ││  full task list + task detail     │
└────────────────────────┘└──────────────────────────────────┘
┌─ PRD/Docs (flexGrow) ─────────┐┌─ Git History (flexGrow) ──┐  Row C (remaining)
└────────────────────────────────┘└────────────────────────────┘
```

### Small Screen Fallback

When terminal height < 30 rows:
- Bottom panel (Row C) is hidden entirely
- Overview + Active collapses to single line
- Dashboard degrades to a compact 2-row layout

### Layout Configuration

All layout proportions are configurable via `~/.claude-monitor/config.json`:

```json
{
  "layout": {
    "maxMiddlePercent": 0.5,
    "projectListWidth": 24,
    "bottomPanelSplit": 0.5,
    "showMetricsPanel": "auto",
    "compactThreshold": 30
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `maxMiddlePercent` | `0.5` | Max fraction of terminal height for Row B (Projects+Detail) |
| `projectListWidth` | `24` | Fixed column width for the project list panel |
| `bottomPanelSplit` | `0.5` | Left/right ratio for bottom row (Docs vs Git, Activity vs Metrics) |
| `showMetricsPanel` | `"auto"` | `"auto"` = show when width > 120; `"always"` / `"never"` to override |
| `compactThreshold` | `30` | Terminal rows below which compact mode activates |

### Panel Component

```typescript
function Panel({ title, children, width, flexGrow, maxHeight }: {
  title: string;
  children: React.ReactNode;
  width?: number | string;  // fixed sizing
  flexGrow?: number;        // flex sizing (1 = fill available space)
  maxHeight?: number;       // max rows (for viewport-managed panels)
}) {
  return (
    <Box flexDirection="column" borderStyle="round"
      width={width} flexGrow={flexGrow} paddingX={1}>
      {/* ... */}
    </Box>
  );
}
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

### System Metrics + Mascot (Status Bar)

Single-line status bar combining system metrics and mini mascot. Position: bottom of screen, above keyboard hints.

```
☻⌨ · │ CPU ▁▃▅▇▅▃▁▃ 23% │ MEM ██████░░ 4.2/8G │ ↑ 1.2 KB/s ↓ 45.3 KB/s │ ⠋ polling
```

**Mini Mascot** (leftmost, inline):

| State | Frames | Trigger |
|-------|--------|---------|
| idle | `☻ zzZ` ↔ `☻ zZ ` | No active agents |
| working | `☻⌨ ·` → `☻⌨ ··` → `☻⌨···` | Any agent working |
| done | `☻♪` | All projects completed |

**System Metrics**:
- **CPU**: Sparkline (8 samples) + percentage. Data: `os.cpus()`
- **MEM**: Bar (8 chars) + used/total. Data: `os.freemem()/totalmem()`
- **Network**: `↑` upload `↓` download rates. Data: macOS `netstat` / Linux `/proc/net/dev`
- **Spinner**: Braille rotation indicating active polling

Refresh: 1s (shared timer with data polling).

### Metrics Chart Panel (Dashboard [4])

Visible on wide terminals (120+ cols). Shows 30-point sparkline history for each metric, updated every poll tick.

```
╭─ Metrics ──── 4 ─────────────────────────╮
│                                           │
│  CPU  ▁▂▃▅▇▅▃▂▁▂▃▄▅▆▇▆▅▃▂▁▂▃▅▇▅▃▂▁  23% │
│  MEM  ▅▅▅▅▅▅▅▅▅▅▅▅▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆  52% │
│  NET  ▁▁▁▂▅▇▃▁▁▁▁▂▃▇▅▂▁▁▁▁▃▅▇▃▁▁▁▁▂▃  ↓45K │
│                                           │
╰───────────────────────────────────────────╯
```

**Data**:
- Circular buffer of 30 samples per metric (30 seconds of history at 1s poll)
- Sparkline chars: `▁▂▃▄▅▆▇█` — value mapped to 0-7 index based on min/max range
- CPU: `os.cpus()` user+system time delta between ticks
- MEM: `os.freemem() / os.totalmem()` percentage
- NET: delta bytes from `netstat` (macOS) or `/proc/net/dev` (Linux)

**Sizing**: `flexGrow={1}` — fills remaining horizontal space alongside Activity panel. On narrow terminals, this panel is hidden entirely.

**Expandable metrics (future)**: Press `m` to open full-screen metrics panel with larger braille line charts showing CPU/MEM/NET history over time. Uses braille characters `⠀⡀⣀⣄⣤⣦⣶⣷⣿` for 2×4 sub-character resolution per cell.

```
CPU History (1 min) ────────────────────────────────────
⡇⠀⠀⠀⠀⠀⢀⡀⠀⠀⠀⠀⣠⠤⡄⠀⠀⠀⠀⠀⠀⢀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⠤⠒⠒⠤⣄
⡇⣀⣀⣀⣀⡴⠋⠙⠲⣄⣴⠋⠀⠀⠙⠲⣄⣤⣀⣤⠞⠉⠀⠙⠲⣄⣀⣀⣀⣀⣀⣤⠴⠊⠁⠀⠀⠀⠀⠀
```

### Animations (v0.4+)

All animations are low priority — implement after core views and data layer are solid. Toggled via config `{ "animations": true }` or `--no-animations` CLI flag.

**Phase 1 — Subtle indicators** (low effort):

| Animation | Where | FPS | Description |
|-----------|-------|-----|-------------|
| Spinner | Status bar | 10 | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` braille rotation |
| Active task pulse | Task list | 2 | `▶` blinks yellow/dim |
| Sparkline | Status bar | 1 | CPU history updates each second |
| Mascot state | Status bar | 1 | `☻⌨` / `☻zzZ` / `☻♪` based on agent state |

**Phase 2 — Transition effects** (medium effort):

| Animation | Where | Description |
|-----------|-------|-------------|
| New task flash | Task list | 1.5s yellow highlight when new task appears |
| Number roll | Progress bars | Counter animates from old value to new |
| View transition | All | Brief fade/slide when switching views |

**Phase 3 — Character animation** (high effort, stretch goal):

Mascot with movement and interaction effects:
- Horizontal running across the status bar (marginLeft animation)
- "Fetching data" sequence: mascot runs toward `[DATA]`, collision spark `💥`, data refreshes
- Jump/fall: parabolic y-coordinate for jump, gravity for fall
- Implementation: dedicated animation layer with `{x, y, state}` tracked per frame at 5-8 fps

Feasibility notes:
- Ink uses Flexbox, not Canvas — movement simulated via `marginLeft`/padding or fixed-width string padding
- Ink's React reconciler diffs output, so only changed characters redraw — low perf cost for small animations
- Keep animated region to 1-2 lines max to avoid full-screen flicker at high frame rates
- All animations must be disableable for performance-sensitive environments

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

## Keyboard Map

See **View Navigation** section above for the full key reference per focus level.

Summary: `↑↓` navigate, `Enter` enter inner focus, `Esc` exit inner focus, `1/2/3` switch right panel tab, `Space` toggle ☑ selection, `Tab` open Kanban (shows ☑ projects), `s` toggle kanban layout, `t` theme, `h` hide done, `q` quit.

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

| Priority | Component | Scope | Complexity |
|----------|-----------|-------|------------|
| P0 | Master-Detail merge (remove separate Detail view) | Dashboard | Medium |
| P0 | Two-level focus (outer/inner + Enter/Esc transitions) | Dashboard | Medium |
| P0 | Viewport scrolling for project list | Dashboard | Low |
| P0 | Adaptive height + configurable layout | Dashboard | Medium |
| P1 | Context-aware bottom panel (B1: Activity ↔ Docs+Git) | Dashboard | Medium |
| P1 | Right panel tab system (1/2/3 → Tasks/Git/Docs) | Dashboard | Medium |
| P1 | Git history panel (git log integration) | Dashboard | Medium |
| P1 | Docs panel (PRD/CLAUDE.md reader) | Dashboard | Low |
| P1 | Focus/Kanban view | Kanban | Low (exists) |
| P2 | Theme system + 3 themes | All | Medium |
| P2 | Kanban dependency visualization (`⊘ blocked:#N`) | Kanban | Low |
| P2 | Kanban time-in-status indicators | Kanban | Low |
| P2 | Search/filter | All | Low |
| P2 | Animation system (pulse, flash, sparkline) | All | Medium |
| P3 | Local snapshot persistence | All | Medium |
| P3 | Small screen compact fallback | Dashboard | Low |
| P3 | Status badges (build/deploy) | Dashboard | Low (needs hooks) |

## Resolved Decisions

1. **Terminal size**: Minimum 80 cols × 24 rows (13" screen half-width). Panels reflow at narrow widths.
2. **Refresh rate**: 1s polling for now. May make configurable later.
3. **Git history depth**: 3-5 most recent commits. Keeps panel compact, avoids perf issues on large repos.
4. **Multi-select in Focus**: Default shows all active projects. `f` opens filter to toggle individual projects on/off.
5. **Dashboard + Detail merged**: Standalone Project Detail view removed. Replaced with Master-Detail single-page layout with two focus levels (outer = projects, inner = tasks). Reduces cognitive load of page navigation.
6. **Context-aware bottom panel (B1)**: Bottom row shows ACTIVITY in outer focus, switches to PRD/Docs + Git History in inner focus. Rationale: when drilling into a project, project context (docs/git) is more valuable than global activity feed.
7. **No Gantt chart**: Task data lacks start/end timestamps. Kanban with dependency indicators (`⊘ blocked:#N`) and time-in-status (`↑ 2h`) is a better fit for Claude Code's event-driven workflow.
8. **Project list viewport**: With 40+ projects, list uses scrolling viewport capped at 50% terminal height. Active projects sort to top, cursor drives scroll window.
9. **Layout proportions configurable**: All layout ratios (middle panel height cap, project list width, bottom panel split) stored in `~/.claude-monitor/config.json` under `layout` key. Allows tuning for different screen sizes without code changes.
