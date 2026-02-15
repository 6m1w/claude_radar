import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { TodoItem, TaskItem, SessionData, SessionMeta, ProjectData, SessionHistoryEntry, TeamConfig, TeamMember, AgentInfo, GitCommit, RoadmapData } from "../types.js";
import { parseRoadmapFile } from "./roadmap.js";

const CLAUDE_DIR = join(homedir(), ".claude");
const TODOS_DIR = join(CLAUDE_DIR, "todos");
const TASKS_DIR = join(CLAUDE_DIR, "tasks");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const TEAMS_DIR = join(CLAUDE_DIR, "teams");

// Sessions modified within this window are considered "active"
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

// Projects with in_progress tasks but no activity within this window
// are NOT considered active (prevents stale tasks from pinning projects to top)
const STALE_TASK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// JSONL files below this size are considered "empty" sessions (e.g. accidental opens).
// They are counted in totalSessions but excluded from lastSessionActivity sorting.
const MIN_SESSION_SIZE_BYTES = 1024;

// Priority doc files (always checked first, preserved ordering)
const DOC_PRIORITY = ["CLAUDE.md", "PRD.md", "docs/PRD.md", "TDD.md", "docs/TDD.md", "README.md"];

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function getModTime(path: string): Date {
  try {
    return statSync(path).mtime;
  } catch {
    return new Date(0);
  }
}

// ─── Phase 1: Discover ALL projects from ~/.claude/projects/ ────
interface DiscoveredProject {
  claudeDir: string;        // full path to ~/.claude/projects/{dir}
  projectPath: string;      // actual filesystem path (from sessions-index or derived)
  projectName: string;
  gitBranch?: string;       // from sessions-index metadata
  sessionIds: string[];     // session UUIDs from sessions-index entries
  totalSessions: number;    // count of .jsonl files
  activeSessions: number;   // .jsonl files modified recently
  lastSessionActivity: Date;
  recentSessions: SessionHistoryEntry[];  // from sessions-index entries
}

function discoverProjects(): DiscoveredProject[] {
  const results: DiscoveredProject[] = [];
  const now = Date.now();

  try {
    const dirs = readdirSync(PROJECTS_DIR);
    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir);

      // Skip non-directories
      try {
        if (!statSync(dirPath).isDirectory()) continue;
      } catch {
        continue;
      }

      // Count .jsonl files and check their activity
      let totalSessions = 0;
      let activeSessions = 0;
      let lastSessionActivity = new Date(0);

      try {
        const files = readdirSync(dirPath);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          totalSessions++;
          const filePath = join(dirPath, file);
          let fileSize = 0;
          try {
            const st = statSync(filePath);
            fileSize = st.size;
            const mtime = st.mtime;
            // Only count substantial sessions for lastSessionActivity sorting.
            // Tiny files (< 1KB) are accidental/empty sessions that shouldn't
            // push old projects to the top of the list.
            if (fileSize >= MIN_SESSION_SIZE_BYTES && mtime > lastSessionActivity) {
              lastSessionActivity = mtime;
            }
            if (now - mtime.getTime() < ACTIVE_THRESHOLD_MS) activeSessions++;
          } catch { /* skip */ }
        }
      } catch {
        // skip
      }

      // Read sessions-index.json for metadata (if available)
      const indexPath = join(dirPath, "sessions-index.json");
      const indexData = readJson<{
        entries: Array<{
          sessionId: string;
          projectPath?: string;
          summary?: string;
          firstPrompt?: string;
          gitBranch?: string;
        }>;
      }>(indexPath);

      let projectPath: string;
      let projectName: string;
      let gitBranch: string | undefined;
      const sessionIds: string[] = [];
      const recentSessions: SessionHistoryEntry[] = [];

      if (indexData?.entries && indexData.entries.length > 0) {
        // Use sessions-index for ground truth
        const lastEntry = indexData.entries[indexData.entries.length - 1];
        projectPath = lastEntry.projectPath ?? derivePathFromDir(dir);
        projectName = basename(projectPath);
        gitBranch = lastEntry.gitBranch || undefined;

        for (const entry of indexData.entries) {
          if (entry.sessionId) sessionIds.push(entry.sessionId);
          if (entry.gitBranch) gitBranch = entry.gitBranch;
          recentSessions.push({
            sessionId: entry.sessionId,
            summary: entry.summary,
            firstPrompt: entry.firstPrompt?.slice(0, 80),
            gitBranch: entry.gitBranch,
          });
        }
      } else {
        // No sessions-index — derive from directory name
        projectPath = derivePathFromDir(dir);
        projectName = basename(projectPath);
      }

      // Skip root/home directories (too generic)
      if (projectPath === "/" || projectPath === homedir()) continue;

      results.push({
        claudeDir: dirPath,
        projectPath,
        projectName,
        gitBranch,
        sessionIds,
        totalSessions,
        activeSessions,
        lastSessionActivity,
        recentSessions: recentSessions.slice(-8), // keep last 8
      });
    }
  } catch {
    // projects dir may not exist
  }

  return results;
}

// Derive filesystem path from the Claude projects directory name
// e.g. "-Users-bonjuice-Desktop-Eng-project-claude-radar"
//    → "/Users/bonjuice/Desktop/Eng/project_claude_radar"
//
// The encoding replaces "/" with "-" (and "_" with "-" too), so it's lossy.
// Strategy: at each valid directory, list its entries and greedily match
// the longest prefix of remaining segments against actual fs entries.
function derivePathFromDir(dir: string): string {
  const segments = dir.split("-").filter(Boolean);
  return resolveSegments("", segments);
}

function resolveSegments(base: string, segments: string[]): string {
  if (segments.length === 0) return base;

  // Try to list entries in the current base directory
  let entries: string[] = [];
  const dirToList = base || "/";
  try {
    entries = readdirSync(dirToList);
  } catch {
    // Can't read dir — just join remaining with "/"
    return base + "/" + segments.join("/");
  }

  // Try matching longest prefix of segments against actual directory entries
  // e.g. segments = ["project", "claude", "monitor"]
  // Try "project_claude_radar", "project-claude-radar", "project_claude", "project-claude", "project"
  for (let len = segments.length; len >= 1; len--) {
    const chunk = segments.slice(0, len);
    // Try with underscores (most common in project names)
    const withUnderscore = chunk.join("_");
    const withHyphen = chunk.join("-");
    const asIs = chunk.join("");

    for (const candidate of [withUnderscore, withHyphen, asIs]) {
      if (entries.includes(candidate)) {
        const newBase = base + "/" + candidate;
        // If this is the last chunk, we're done
        if (len === segments.length) return newBase;
        // Otherwise, recurse with remaining segments
        try {
          if (statSync(newBase).isDirectory()) {
            return resolveSegments(newBase, segments.slice(len));
          }
        } catch {
          // not a directory, try other candidates
        }
        return newBase + "/" + segments.slice(len).join("/");
      }
    }

    // Also try the raw segment name (single segment, exact match)
    if (len === 1 && entries.includes(segments[0])) {
      const newBase = base + "/" + segments[0];
      try {
        if (statSync(newBase).isDirectory()) {
          return resolveSegments(newBase, segments.slice(1));
        }
      } catch {
        // not a directory
      }
    }
  }

  // No match found — just use slash-separated
  return base + "/" + segments.join("/");
}

// ─── Phase 2: Read git info from actual project directory ───────
function readGitInfo(projectPath: string): { branch: string; worktreeOf?: string } | undefined {
  try {
    const dotGit = join(projectPath, ".git");
    if (!existsSync(dotGit)) return undefined;

    let headContent: string;
    const stat = statSync(dotGit);

    if (stat.isFile()) {
      // .git is a file → this is a worktree
      // Content: "gitdir: /path/to/main-repo/.git/worktrees/<name>"
      const gitdirLine = readFileSync(dotGit, "utf-8").trim();
      const match = gitdirLine.match(/^gitdir:\s*(.+)$/);
      if (!match) return undefined;
      const gitdir = match[1];
      // Derive main repo: strip /worktrees/<name> and /.git
      const worktreesIdx = gitdir.lastIndexOf("/.git/worktrees/");
      const mainRepo = worktreesIdx >= 0 ? gitdir.slice(0, worktreesIdx) : undefined;
      // Read HEAD from the worktree's gitdir
      const headPath = join(gitdir, "HEAD");
      if (!existsSync(headPath)) return undefined;
      headContent = readFileSync(headPath, "utf-8").trim();
      const branch = headContent.startsWith("ref: refs/heads/")
        ? headContent.replace("ref: refs/heads/", "")
        : headContent.slice(0, 8);
      return { branch, worktreeOf: mainRepo };
    }

    // Normal .git directory
    const headPath = join(dotGit, "HEAD");
    if (!existsSync(headPath)) return undefined;
    headContent = readFileSync(headPath, "utf-8").trim();
    if (headContent.startsWith("ref: refs/heads/")) {
      return { branch: headContent.replace("ref: refs/heads/", "") };
    }
    // Detached HEAD — show short hash
    return { branch: headContent.slice(0, 8) };
  } catch {
    return undefined;
  }
}

// ─── Phase 3: Detect docs in project directory ──────────────────
// Merge priority candidates + recursive discovery into a single deduped list.
// Priority docs come first (stable ordering for UI), then any extras found by discovery.
function detectDocs(projectPath: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  // Priority candidates first (stable ordering)
  for (const candidate of DOC_PRIORITY) {
    if (existsSync(join(projectPath, candidate))) {
      found.push(candidate);
      seen.add(candidate);
    }
  }
  // Add any .md files found by recursive discovery that aren't already listed
  for (const md of discoverMarkdownFiles(projectPath)) {
    if (!seen.has(md)) {
      found.push(md);
      seen.add(md);
    }
  }
  return found;
}

// ─── Phase 3b: Discover all .md files + parse checkboxes ─────────
// Recursively find .md files (depth-limited, skip junk dirs), then
// parse each for `- [x]` / `- [ ]` checkboxes. Files without
// checkboxes are automatically filtered out by parseRoadmapFile().

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "vendor", "coverage", "__pycache__", ".venv", "venv", "env",
  ".turbo", ".cache", ".output", "target", "bin", "obj",
]);
const MAX_MD_DEPTH = 3;    // root=0, docs/=1, docs/api/=2, ...
const MAX_MD_FILES = 30;   // cap to avoid scanning huge monorepos

export function discoverMarkdownFiles(projectPath: string): string[] {
  const files: string[] = [];

  function walk(dir: string, depth: number, prefix: string) {
    if (depth > MAX_MD_DEPTH || files.length >= MAX_MD_FILES) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (files.length >= MAX_MD_FILES) return;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
            walk(join(dir, entry.name), depth + 1, prefix ? `${prefix}/${entry.name}` : entry.name);
          }
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    } catch {
      // permission error or symlink loop — skip
    }
  }

  walk(projectPath, 0, "");
  return files;
}

function detectRoadmap(projectPath: string): RoadmapData[] {
  const mdFiles = discoverMarkdownFiles(projectPath);
  const results: RoadmapData[] = [];
  for (const relPath of mdFiles) {
    const data = parseRoadmapFile(join(projectPath, relPath), relPath);
    if (data) results.push(data);
  }
  return results;
}

// ─── Phase 3c: Read git log from project directory ───────────────
function readGitLog(projectPath: string): GitCommit[] {
  try {
    if (!existsSync(join(projectPath, ".git"))) return [];
    const raw = execSync(
      `git log --format="%aI|||%h|||%s" -n 20`,
      { cwd: projectPath, encoding: "utf-8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }
    );
    return raw.trim().split("\n").filter(Boolean).map((line) => {
      const [authorDate, hash, subject] = line.split("|||");
      const typeMatch = subject?.match(/^(\w+)[:(]/);
      return { hash: hash ?? "", subject: subject ?? "", authorDate: authorDate ?? "", type: typeMatch?.[1] };
    });
  } catch { return []; }
}

// ─── Phase 3c: Read doc file contents ────────────────────────────
const MAX_DOC_SIZE = 50 * 1024;

function readDocContents(projectPath: string, docFiles: string[]): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const doc of docFiles) {
    try {
      const fullPath = join(projectPath, doc);
      const s = statSync(fullPath);
      if (s.size > MAX_DOC_SIZE) { contents[doc] = `[File too large: ${Math.round(s.size / 1024)}KB]`; continue; }
      contents[doc] = readFileSync(fullPath, "utf-8");
    } catch {}
  }
  return contents;
}

// ─── Phase 4: Build session index for task/todo mapping ─────────
function buildSessionIndex(projects: DiscoveredProject[]): Map<string, SessionMeta> {
  const index = new Map<string, SessionMeta>();
  for (const p of projects) {
    for (const sessionId of p.sessionIds) {
      index.set(sessionId, {
        projectPath: p.projectPath,
        projectName: p.projectName,
        gitBranch: p.gitBranch,
      });
    }
    // Also index all .jsonl files in the project dir (sessions without index entries)
    try {
      const files = readdirSync(p.claudeDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const sessionId = file.replace(".jsonl", "");
        if (!index.has(sessionId)) {
          index.set(sessionId, {
            projectPath: p.projectPath,
            projectName: p.projectName,
            gitBranch: p.gitBranch,
          });
        }
      }
    } catch {
      // skip
    }
  }
  return index;
}

// ─── Phase 5: Scan todos and tasks ─────────────────────────────
function scanTodos(sessionIndex: Map<string, SessionMeta>): SessionData[] {
  const results: SessionData[] = [];
  try {
    const files = readdirSync(TODOS_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const fullPath = join(TODOS_DIR, file);
      const items = readJson<TodoItem[]>(fullPath);
      if (items && items.length > 0) {
        const sessionId = file.split("-agent-")[0];
        results.push({
          id: sessionId,
          source: "todos",
          lastModified: getModTime(fullPath),
          items,
          meta: sessionIndex.get(sessionId),
        });
      }
    }
  } catch {
    // Directory may not exist
  }
  return results;
}

function scanTasks(sessionIndex: Map<string, SessionMeta>): SessionData[] {
  const results: SessionData[] = [];
  try {
    const dirs = readdirSync(TASKS_DIR);
    for (const dir of dirs) {
      const dirPath = join(TASKS_DIR, dir);
      try {
        const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));
        if (files.length === 0) continue;

        const items: TaskItem[] = [];
        let latestMod = new Date(0);

        for (const file of files) {
          const fullPath = join(dirPath, file);
          const task = readJson<TaskItem>(fullPath);
          if (task && task.id) {
            items.push(task);
            const mod = getModTime(fullPath);
            if (mod > latestMod) latestMod = mod;
          }
        }

        if (items.length > 0) {
          items.sort((a, b) => Number(a.id) - Number(b.id));
          results.push({
            id: dir,
            source: "tasks",
            lastModified: latestMod,
            items,
            meta: sessionIndex.get(dir),
          });
        }
      } catch {
        // Skip invalid directories
      }
    }
  } catch {
    // Directory may not exist
  }
  return results;
}

// ─── Phase 6: Scan teams ─────────────────────────────────────────
function scanTeams(): Map<string, TeamConfig> {
  const teams = new Map<string, TeamConfig>();
  try {
    const dirs = readdirSync(TEAMS_DIR);
    for (const dir of dirs) {
      const configPath = join(TEAMS_DIR, dir, "config.json");
      const config = readJson<{ members?: TeamMember[] }>(configPath);
      if (config?.members && config.members.length > 0) {
        teams.set(dir, {
          teamName: dir,
          members: config.members,
        });
      }
    }
  } catch {
    // teams dir may not exist
  }
  return teams;
}

// Check if a tasks directory name is a team (exists in ~/.claude/teams/)
function isTeamTaskDir(dirName: string, teams: Map<string, TeamConfig>): boolean {
  return teams.has(dirName);
}

// ─── Phase 7: Process detection ──────────────────────────────────

// Cached process list — refreshed once per scan cycle
let cachedProcessList: string | null = null;
let cachedProcessTime = 0;
const PROCESS_CACHE_MS = 5000;

function getProcessList(): string {
  const now = Date.now();
  if (cachedProcessList && now - cachedProcessTime < PROCESS_CACHE_MS) {
    return cachedProcessList;
  }
  try {
    const { execSync } = require("node:child_process");
    cachedProcessList = execSync("ps aux", { encoding: "utf-8", timeout: 2000 }) as string;
    cachedProcessTime = now;
    return cachedProcessList;
  } catch {
    cachedProcessList = "";
    cachedProcessTime = now;
    return "";
  }
}

// Detect if a Claude Code agent process is alive
// Claude Code runs as node processes with claude-related arguments
function detectAgentProcess(agentName: string): "running" | "dead" {
  const ps = getProcessList();
  // Claude Code agent processes typically appear as node with claude args
  // Team members show up with their agent name in the process args
  if (ps.includes(agentName) || ps.includes("claude")) {
    return "running";
  }
  return "dead";
}

// Build enriched agent info for a project
function buildAgentDetails(
  sessions: SessionData[],
  team?: TeamConfig,
): AgentInfo[] {
  // Collect unique agent names from task owners
  const agentMap = new Map<string, AgentInfo>();

  for (const session of sessions) {
    for (const item of session.items) {
      if ("owner" in item && item.owner) {
        const name = item.owner;
        if (!agentMap.has(name)) {
          // Find team member info if available
          const member = team?.members.find((m) => m.name === name);
          agentMap.set(name, {
            name,
            agentType: member?.agentType,
            processState: "dead",
            teamName: team?.teamName,
          });
        }
        // Track current task (latest in_progress task for this agent)
        if (item.status === "in_progress" && "id" in item) {
          agentMap.get(name)!.currentTaskId = item.id;
          agentMap.get(name)!.processState = "running";
        }
      }
    }
  }

  // Add team members who don't have tasks yet
  if (team) {
    for (const member of team.members) {
      if (!agentMap.has(member.name)) {
        agentMap.set(member.name, {
          name: member.name,
          agentType: member.agentType,
          processState: "idle",
          teamName: team.teamName,
        });
      }
    }
  }

  return [...agentMap.values()];
}

// Match a team to a project by checking if any task session ID is a team name
function findTeamForProject(
  sessions: SessionData[],
  teams: Map<string, TeamConfig>,
): TeamConfig | undefined {
  for (const session of sessions) {
    if (session.source === "tasks" && teams.has(session.id)) {
      return teams.get(session.id);
    }
  }
  return undefined;
}

// ─── Main: project-centric scan ─────────────────────────────────
export function scanAll(): { projects: ProjectData[]; sessions: SessionData[] } {
  // Phase 1: Discover all projects
  const discovered = discoverProjects();

  // Phase 6: Scan teams
  const teams = scanTeams();

  // Phase 2-4: Build session index, scan tasks/todos
  const sessionIndex = buildSessionIndex(discovered);
  const allTodos = scanTodos(sessionIndex);
  const allTasks = scanTasks(sessionIndex);
  const allSessions = [...allTodos, ...allTasks].sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
  );

  // Group sessions by projectPath
  const sessionsByProject = new Map<string, SessionData[]>();
  for (const session of allSessions) {
    const key = session.meta?.projectPath ?? `unknown-${session.id}`;
    const list = sessionsByProject.get(key) ?? [];
    list.push(session);
    sessionsByProject.set(key, list);
  }

  // Deduplicate discovered projects by projectPath (multiple Claude dirs can resolve to same path)
  const mergedDisc = new Map<string, DiscoveredProject>();
  for (const disc of discovered) {
    const existing = mergedDisc.get(disc.projectPath);
    if (existing) {
      // Merge: combine session counts, keep latest activity, prefer non-empty metadata
      existing.totalSessions += disc.totalSessions;
      existing.activeSessions += disc.activeSessions;
      if (disc.lastSessionActivity > existing.lastSessionActivity) {
        existing.lastSessionActivity = disc.lastSessionActivity;
      }
      existing.sessionIds.push(...disc.sessionIds);
      existing.recentSessions.push(...disc.recentSessions);
      if (!existing.gitBranch && disc.gitBranch) existing.gitBranch = disc.gitBranch;
    } else {
      mergedDisc.set(disc.projectPath, { ...disc, sessionIds: [...disc.sessionIds] });
    }
  }

  // Build project data for ALL discovered projects
  const projects: ProjectData[] = [];
  const seenPaths = new Set<string>();

  for (const disc of mergedDisc.values()) {
    seenPaths.add(disc.projectPath);
    const sessions = sessionsByProject.get(disc.projectPath) ?? [];
    const allItems = sessions.flatMap((s) => s.items);
    const total = allItems.length;
    const completed = allItems.filter((i) => i.status === "completed").length;
    const inProgress = allItems.filter((i) => i.status === "in_progress").length;

    const agentSet = new Set<string>();
    for (const item of allItems) {
      if ("owner" in item && item.owner) agentSet.add(item.owner);
    }

    // Read git info from actual project directory
    const git = readGitInfo(disc.projectPath);
    const docs = detectDocs(disc.projectPath);
    const roadmap = detectRoadmap(disc.projectPath);
    const gitLog = readGitLog(disc.projectPath);
    const docContents = readDocContents(disc.projectPath, docs);

    // Determine last activity: max of session file activity and task data
    const taskActivity = sessions.length > 0
      ? Math.max(...sessions.map((s) => s.lastModified.getTime()))
      : 0;
    const lastActivity = new Date(
      Math.max(disc.lastSessionActivity.getTime(), taskActivity)
    );

    // isActive: has active sessions, OR has in-progress tasks WITH recent activity.
    // Without the recency check, abandoned in_progress tasks would pin old projects to the top forever.
    const hasRecentActivity = (Date.now() - lastActivity.getTime()) < STALE_TASK_THRESHOLD_MS;
    const isActive = disc.activeSessions > 0 || (inProgress > 0 && hasRecentActivity);

    // Phase 6+7: Match team data and build agent details
    // Team tasks use the team name as task dir name, which maps to sessions
    const matchedTeam = findTeamForProject(sessions, teams);
    const agentDetails = buildAgentDetails(sessions, matchedTeam);

    projects.push({
      projectPath: disc.projectPath,
      projectName: disc.projectName,
      gitBranch: git?.branch ?? disc.gitBranch,
      sessions,
      totalTasks: total,
      completedTasks: completed,
      inProgressTasks: inProgress,
      agents: [...agentSet],
      lastActivity,
      isActive,
      totalSessions: disc.totalSessions,
      activeSessions: disc.activeSessions,
      git,
      docs,
      gitLog,
      docContents,
      roadmap,
      recentSessions: disc.recentSessions.slice(-8),
      team: matchedTeam,
      agentDetails,
    });
  }

  // Add orphan sessions (tasks/todos not mapped to any discovered project)
  for (const [path, sessions] of sessionsByProject) {
    if (seenPaths.has(path) || path.startsWith("unknown-")) continue;
    const allItems = sessions.flatMap((s) => s.items);
    const orphanLastActivity = new Date(Math.max(...sessions.map((s) => s.lastModified.getTime())));
    const orphanInProgress = allItems.filter((i) => i.status === "in_progress").length;
    const orphanRecent = (Date.now() - orphanLastActivity.getTime()) < STALE_TASK_THRESHOLD_MS;
    projects.push({
      projectPath: path,
      projectName: basename(path),
      sessions,
      totalTasks: allItems.length,
      completedTasks: allItems.filter((i) => i.status === "completed").length,
      inProgressTasks: orphanInProgress,
      agents: [],
      lastActivity: orphanLastActivity,
      isActive: orphanInProgress > 0 && orphanRecent,
      totalSessions: 0,
      activeSessions: 0,
      docs: [],
      roadmap: [],
      gitLog: [],
      docContents: {},
      recentSessions: [],
      agentDetails: [],
    });
  }

  // Sort: active first, then by last activity
  projects.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.lastActivity.getTime() - a.lastActivity.getTime();
  });

  return { projects, sessions: allSessions };
}

// Keep backward-compatible export for groupByProject
export function groupByProject(sessions: SessionData[]): ProjectData[] {
  // This is now handled internally by scanAll
  // Keep for API compatibility but prefer scanAll().projects
  return scanAll().projects;
}
