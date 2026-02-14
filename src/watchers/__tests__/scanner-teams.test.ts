import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { TeamConfig, TeamMember, AgentInfo, SessionData, TaskItem, DisplayItem } from "../../types.js";

// Since scanner reads from well-known paths (~/.claude/teams/),
// we can't easily mock it without touching the real filesystem.
// Instead, test the pure functions by extracting them.
// For now, test the team/agent logic directly with unit helpers.

// ─── Replicate scanner helpers for pure unit testing ────────

function buildAgentDetails(
  sessions: SessionData[],
  team?: TeamConfig,
): AgentInfo[] {
  const agentMap = new Map<string, AgentInfo>();

  for (const session of sessions) {
    for (const item of session.items) {
      if ("owner" in item && item.owner) {
        const name = item.owner;
        if (!agentMap.has(name)) {
          const member = team?.members.find((m) => m.name === name);
          agentMap.set(name, {
            name,
            agentType: member?.agentType,
            processState: "dead",
            teamName: team?.teamName,
          });
        }
        if (item.status === "in_progress" && "id" in item) {
          agentMap.get(name)!.currentTaskId = item.id;
          agentMap.get(name)!.processState = "running";
        }
      }
    }
  }

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

// ─── Test helpers ───────────────────────────────────────────

function makeTask(overrides: Partial<TaskItem> = {}): DisplayItem {
  return {
    id: "1",
    subject: "Test task",
    description: "A test task",
    status: "pending",
    blocks: [],
    blockedBy: [],
    ...overrides,
  } as DisplayItem;
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: "session-001",
    source: "tasks",
    lastModified: new Date(),
    items: [makeTask()],
    ...overrides,
  };
}

function makeTeam(name: string, members: TeamMember[]): TeamConfig {
  return { teamName: name, members };
}

// ─── Tests ──────────────────────────────────────────────────

describe("Team Scanner", () => {
  describe("findTeamForProject", () => {
    it("should match team when session id equals team name", () => {
      const team = makeTeam("my-project", [
        { name: "lead", agentId: "a1", agentType: "general-purpose" },
      ]);
      const teams = new Map([["my-project", team]]);

      const sessions = [makeSession({ id: "my-project", source: "tasks" })];
      const result = findTeamForProject(sessions, teams);

      expect(result).toBeDefined();
      expect(result!.teamName).toBe("my-project");
    });

    it("should return undefined when no session matches a team", () => {
      const team = makeTeam("my-project", [
        { name: "lead", agentId: "a1", agentType: "general-purpose" },
      ]);
      const teams = new Map([["my-project", team]]);

      // UUID session — not a team
      const sessions = [makeSession({ id: "abc-123-def", source: "tasks" })];
      const result = findTeamForProject(sessions, teams);

      expect(result).toBeUndefined();
    });

    it("should not match todo sessions even if id matches team name", () => {
      const team = makeTeam("my-project", [
        { name: "lead", agentId: "a1", agentType: "general-purpose" },
      ]);
      const teams = new Map([["my-project", team]]);

      const sessions = [makeSession({ id: "my-project", source: "todos" })];
      const result = findTeamForProject(sessions, teams);

      expect(result).toBeUndefined();
    });
  });

  describe("buildAgentDetails", () => {
    it("should extract agents from task owners", () => {
      const sessions = [makeSession({
        items: [
          makeTask({ id: "1", owner: "researcher", status: "in_progress" }),
          makeTask({ id: "2", owner: "coder", status: "pending" }),
        ],
      })];

      const agents = buildAgentDetails(sessions);

      expect(agents).toHaveLength(2);
      const researcher = agents.find((a) => a.name === "researcher");
      expect(researcher).toBeDefined();
      expect(researcher!.processState).toBe("running");
      expect(researcher!.currentTaskId).toBe("1");

      const coder = agents.find((a) => a.name === "coder");
      expect(coder).toBeDefined();
      expect(coder!.processState).toBe("dead"); // no in_progress task
    });

    it("should enrich agents with team member info", () => {
      const team = makeTeam("my-project", [
        { name: "researcher", agentId: "a1", agentType: "Explore" },
        { name: "coder", agentId: "a2", agentType: "general-purpose" },
      ]);

      const sessions = [makeSession({
        items: [
          makeTask({ id: "1", owner: "researcher", status: "in_progress" }),
        ],
      })];

      const agents = buildAgentDetails(sessions, team);

      expect(agents).toHaveLength(2);

      const researcher = agents.find((a) => a.name === "researcher");
      expect(researcher!.agentType).toBe("Explore");
      expect(researcher!.teamName).toBe("my-project");

      // Coder is in team but has no tasks → idle
      const coder = agents.find((a) => a.name === "coder");
      expect(coder!.agentType).toBe("general-purpose");
      expect(coder!.processState).toBe("idle");
    });

    it("should include team members without tasks as idle", () => {
      const team = makeTeam("my-project", [
        { name: "lead", agentId: "a1", agentType: "general-purpose" },
        { name: "tester", agentId: "a2", agentType: "unit-test-tony" },
      ]);

      // No tasks at all
      const sessions: SessionData[] = [];
      const agents = buildAgentDetails(sessions, team);

      expect(agents).toHaveLength(2);
      expect(agents.every((a) => a.processState === "idle")).toBe(true);
    });

    it("should return empty array when no agents and no team", () => {
      const sessions = [makeSession({
        items: [makeTask({ owner: undefined })],
      })];

      const agents = buildAgentDetails(sessions);
      expect(agents).toHaveLength(0);
    });

    it("should track latest in_progress task per agent", () => {
      const sessions = [makeSession({
        items: [
          makeTask({ id: "1", owner: "dev", status: "completed" }),
          makeTask({ id: "2", owner: "dev", status: "in_progress" }),
          makeTask({ id: "3", owner: "dev", status: "pending" }),
        ],
      })];

      const agents = buildAgentDetails(sessions);
      const dev = agents.find((a) => a.name === "dev");
      expect(dev!.currentTaskId).toBe("2");
      expect(dev!.processState).toBe("running");
    });
  });
});
