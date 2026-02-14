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
│                                      ││  ◍ outclaws/str-b  #2 Migrations     │
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
╭─ claude_monitor ─────────────────────╮╭─ GIT HISTORY ────────────────────────╮
│                                      ││                                      │
│  ⎇ main │ 1 agent │ 2m ago          ││  ● faf45fa docs: update PRD          │
│  [============>........] 3/5  60%    ││  │                                   │
│                                      ││  ● e4bc709 fix: replace chokidar    │
│  ◍ main                              ││  │                                   │
│    ✓ #1 Setup Ink + TypeScript       ││  ● eaa40ec docs: update PRD          │
│    ✓ #2 Session index resolver       ││  │                                   │
│    ✓ #3 Polling watcher              ││  ● ce5ef2d fix: resolve project      │
│    ▶ #4 Design hacker UI theme       ││  │   names for unindexed sessions    │
│    ○ #5 Keyboard navigation          ││  │                                   │
│                                      ││  ● 96e90e6 feat: add project         │
│                                      ││      context via sessions-index      │
╰──────────────────────────────────────╯╰──────────────────────────────────────╯
╭─ TASK DETAIL ────────────────────────────────────────────────────────────────╮
│  ▶ #4 Design hacker UI theme                                                 │
│  owner: main │ status: active │ blocked_by: none                             │
│  description: Implement Catppuccin Mocha palette, multi-panel layout...      │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Key features:
- **Left**: Task list with agent grouping (same as current)
- **Right**: Git history with commit graph (vertical line + dots)
- **Bottom**: Selected task's full detail (description, owner, blockers)

Navigation: `j/k` moves task cursor, `Enter` shows task detail, `Esc` back to Dashboard.

### View 3: Focus / Kanban

Multi-project kanban for parallel development monitoring. Shows agents as columns.

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
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Key features:
- Agents as side-by-side columns within each project
- Projects stacked vertically
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
- Limit to 8-10 most recent commits (scrollable with j/k when panel focused)

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
| P3 | Local snapshot persistence | All | Medium |
| P3 | Status badges (build/deploy) | Dashboard | Low (needs hooks) |

## Open Questions

1. **Terminal size**: Minimum supported terminal width? 80 cols? 120 cols?
2. **Refresh rate**: Keep 1s polling or make configurable?
3. **Git history depth**: How many commits to show? Performance concern for large repos.
4. **Multi-select in Focus**: Free selection or preset groups (e.g., "all active")?
