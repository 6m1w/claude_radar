# Claude Monitor

TUI dashboard for monitoring Claude Code agent tasks, sessions, and project activity in real-time.

## Tech Stack

- **Language**: TypeScript
- **TUI**: Ink (React for CLI)
- **Runtime**: Node.js / tsx (dev)
- **Build**: tsup (ESM, `NODE_ENV=production` to suppress React dev warnings)
- **Package Manager**: npm

## Project Structure

```
src/
├── index.tsx                # Entry point (renders <App /> via Ink)
├── app.tsx                  # Main App — views, navigation, all UI components
│                            #   Dashboard (Overview + ActiveNow + Projects + Activity)
│                            #   ProjectDetail (info + tasks/session history)
│                            #   KanbanView (swimlane table TODO/DOING/DONE)
│                            #   StatusBar (CPU sparkline + MEM bar + network + spinner)
├── types.ts                 # Shared types: TodoItem, TaskItem, SessionData, ProjectData
├── theme.ts                 # Catppuccin Mocha palette, Theme interface, C/I shortcuts
├── utils.ts                 # formatTimeAgo()
├── components/
│   ├── panel.tsx            # Reusable Panel with flexGrow + border + hotkey label
│   └── progress.tsx         # Progress bar (filled/empty block chars)
├── hooks/
│   └── use-metrics.ts       # System metrics: CPU, MEM, network (sequential async loop)
└── watchers/
    ├── scanner.ts           # Project-centric scanner — 5-phase pipeline
    └── use-watch.ts         # React hook: 3s polling with snapshotKey diff
docs/
├── PRD.md                   # 产品需求文档（中文）
└── DESIGN.md                # Design spec: views, wireframes, theme system, animations
```

## Data Sources (5-phase scanner pipeline)

1. **Phase 1 — Discover**: Scan ALL dirs in `~/.claude/projects/`, count `.jsonl` files, check mtimes for active sessions
2. **Phase 2 — Git**: Read `.git/HEAD` from each project's actual directory for branch info
3. **Phase 3 — Docs**: Detect `CLAUDE.md`, `PRD.md`, `TDD.md`, `README.md` in project dirs
4. **Phase 4 — Index**: Build sessionId → project mapping from `sessions-index.json` + `.jsonl` files
5. **Phase 5 — Tasks**: Scan `~/.claude/todos/` and `~/.claude/tasks/` for task/todo data, overlay onto projects

Key: Projects are discovered first, then enriched. Projects without tasks still appear (with session counts, git info, docs).

## Path Derivation

Claude encodes project paths as dir names: `/Users/x/Eng/project_foo` → `-Users-x-Eng-project-foo`. The encoding is lossy (`/` → `-`, `_` → `-`). Scanner uses `resolveSegments()` to reconstruct: greedily matches segments against actual filesystem entries, trying `_` and `-` joins.

## Performance Notes

- **Metrics polling**: 3s interval (CPU/MEM sync, network via `netstat -ib` async every 6s)
- **Data polling**: 3s interval with `snapshotKey` fingerprint — only re-renders on actual data change
- **Sequential async loop**: Prevents `netstat` process accumulation (while + await, not setInterval)
- **StatusBar isolation**: `useMetrics()` lives inside StatusBar component, not App — prevents cascading re-renders
- **Fixed-width formatting**: All numeric values use `padStart()` to prevent layout shift

## Known Limitations

- Ink rewrites the entire terminal on any component re-render (no incremental DOM like browser React)
- `derivePathFromDir()` can fail on deeply nested hyphenated paths without `sessions-index.json`
- Network stats only work on macOS (`netstat -ib`); Linux support needs `/proc/net/dev`
- Active session detection uses 5-min mtime threshold (heuristic, not process detection)

## Commands

```bash
npm run dev       # Development mode with tsx (NODE_ENV=production)
npm run build     # Build with tsup
npm run start     # Run built version
npm run typecheck # Type checking
```

## Views & Navigation

Master-Detail single-page architecture with two focus levels (no separate Detail page).

| Focus Level | Entry | Key controls |
|-------------|-------|-------------|
| Outer (projects) | Default | `↑↓`/`jk` nav projects, `Enter` inner focus, `Space` select, `Tab` kanban, `q` quit |
| Inner (tasks) | `Enter` on project | `↑↓`/`jk` nav tasks, `1/2/3` tab switch, `Esc` back to outer |
| Kanban | `Tab` from dashboard | `s` toggle layout, `h` hide done, `Esc` back |

Bottom panel is context-aware: ACTIVITY in outer focus, PRD/Docs + Project Timeline (git + task events merged) in inner focus.

Layout proportions configurable via `~/.claude-monitor/config.json` → `layout` key.

## Current Status

See `docs/PRD.md` for full feature roadmap with checkboxes.
