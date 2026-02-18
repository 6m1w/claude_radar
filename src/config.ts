/**
 * Config utility — reads/writes ~/.claude-radar/config.json
 *
 * Shares the same config file as scanner.ts (which reads `scan` settings).
 * We add `hiddenProjects: string[]` at the top level.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".claude-radar");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface RadarConfig {
  hiddenProjects?: string[];
  [key: string]: unknown; // preserve other keys (scan, layout, etc.)
}

function readConfig(): RadarConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfig(config: RadarConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/** Return the set of hidden project paths from config */
export function getHiddenProjects(): Set<string> {
  const config = readConfig();
  if (!Array.isArray(config.hiddenProjects)) return new Set();
  return new Set(config.hiddenProjects);
}

/** Toggle a project's hidden state. Returns true if now hidden. */
export function toggleHiddenProject(path: string): boolean {
  const config = readConfig();
  const list = Array.isArray(config.hiddenProjects) ? config.hiddenProjects : [];
  const idx = list.indexOf(path);
  if (idx >= 0) {
    list.splice(idx, 1);
    config.hiddenProjects = list;
    writeConfig(config);
    return false;
  }
  list.push(path);
  config.hiddenProjects = list;
  writeConfig(config);
  return true;
}
