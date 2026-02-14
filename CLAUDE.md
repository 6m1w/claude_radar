# Claude Monitor

TUI dashboard for monitoring Claude Code agent tasks and todos in real-time.

## Tech Stack

- **Language**: TypeScript
- **TUI**: Ink (React for CLI)
- **File Watching**: Chokidar
- **Runtime**: Node.js / tsx (dev)
- **Build**: tsup
- **Package Manager**: bun

## Project Structure

```
src/
├── index.tsx              # Entry point
├── app.tsx                # Main App component
├── types.ts               # Shared type definitions
├── components/
│   └── task-board.tsx     # Task/Todo display components
└── watchers/
    ├── scanner.ts         # Scan ~/.claude/todos/ and ~/.claude/tasks/
    └── use-watch.ts       # React hook for file watching
```

## Data Sources

- `~/.claude/todos/{session}-agent-{agent}.json` — TodoWrite system (legacy)
- `~/.claude/tasks/{session-uuid}/{n}.json` — TaskCreate system (current)

## Commands

```bash
bun run dev       # Development mode with tsx
bun run build     # Build with tsup
bun run start     # Run built version
bun run typecheck # Type checking
```
