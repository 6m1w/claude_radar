#!/bin/bash
# Claude Radar — hook event capture.
# Appends Claude Code hook stdin JSON to a transit buffer (events.jsonl).
# Called by Claude Code plugin system; stdin is JSON with session_id, cwd, etc.
#
# Usage: capture.sh <event_type>
#   event_type: "tool" (PostToolUse), "tool_failure" (PostToolUseFailure),
#               "stop" (Stop), "start" (SessionStart),
#               "subagent_stop" (SubagentStop), "notification" (Notification)
#
# Output: one JSON line appended to ~/.claude-radar/events.jsonl
# Performance budget: <10ms total (bash startup + cat + printf + append)

EVENT="$1"
[ -z "$EVENT" ] && exit 0

EVENTS_DIR="$HOME/.claude-radar"
EVENTS_FILE="$EVENTS_DIR/events.jsonl"

# Ensure directory exists (first-run)
[ -d "$EVENTS_DIR" ] || mkdir -p "$EVENTS_DIR"

# Read stdin JSON from Claude Code
STDIN=$(cat)
[ -z "$STDIN" ] && exit 0

# Timestamp in ISO 8601 UTC
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Append as single JSONL line (O_APPEND guarantees atomicity under PIPE_BUF)
printf '{"event":"%s","ts":"%s","data":%s}\n' "$EVENT" "$TS" "$STDIN" >> "$EVENTS_FILE"

# Safety cap: truncate to last 1000 lines if over 10MB
if [ -f "$EVENTS_FILE" ]; then
  FILE_SIZE=$(stat -f%z "$EVENTS_FILE" 2>/dev/null || stat -c%s "$EVENTS_FILE" 2>/dev/null || echo 0)
  if [ "$FILE_SIZE" -gt 10485760 ]; then
    tail -1000 "$EVENTS_FILE" > "$EVENTS_FILE.tmp" && mv "$EVENTS_FILE.tmp" "$EVENTS_FILE"
  fi
fi

exit 0
