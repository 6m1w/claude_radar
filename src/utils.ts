import stringWidth from "string-width";

// CJK-safe truncation: truncate to N visual columns, append "…" if needed
export function truncateToWidth(str: string, maxWidth: number): string {
  if (stringWidth(str) <= maxWidth) return str;
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const charWidth = stringWidth(str[i]);
    if (width + charWidth > maxWidth - 1) {
      return str.slice(0, i) + "\u2026";
    }
    width += charWidth;
  }
  return str;
}

// CJK-safe padding: pad to N visual columns with spaces
export function padEndToWidth(str: string, targetWidth: number): string {
  const currentWidth = stringWidth(str);
  return currentWidth >= targetWidth
    ? str
    : str + " ".repeat(targetWidth - currentWidth);
}

// CJK-safe padStart: right-align to N visual columns
export function padStartToWidth(str: string, targetWidth: number): string {
  const currentWidth = stringWidth(str);
  return currentWidth >= targetWidth
    ? str
    : " ".repeat(targetWidth - currentWidth) + str;
}

// Format relative time from ISO string with seconds-level granularity
export function formatRelativeTime(isoDate: string): string {
  const elapsed = Date.now() - new Date(isoDate).getTime();
  if (elapsed < 0) return "now";
  const secs = Math.floor(elapsed / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Format dwell time: how long a task has been in current status
export function formatDwell(statusChangedAt?: string): string {
  if (!statusChangedAt) return "";
  const elapsed = Date.now() - new Date(statusChangedAt).getTime();
  if (elapsed < 0) return "";
  const mins = Math.floor(elapsed / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
