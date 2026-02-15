import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCheckboxes, parseRoadmapFile } from "../roadmap.js";
import { discoverMarkdownFiles } from "../scanner.js";

// ─── Test helpers ────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `roadmap-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ─── parseCheckboxes ─────────────────────────────────────────

describe("parseCheckboxes", () => {
  it("should return empty for content with no checkboxes", () => {
    const result = parseCheckboxes("# Title\nSome text\n## Another heading");
    expect(result).toEqual([]);
  });

  it("should parse basic checkboxes under a heading", () => {
    const md = `## Features
- [x] Login
- [ ] Signup
- [x] Logout`;
    const sections = parseCheckboxes(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Features");
    expect(sections[0].level).toBe(2);
    expect(sections[0].done).toBe(2);
    expect(sections[0].total).toBe(3);
    expect(sections[0].items).toEqual([
      { text: "Login", done: true },
      { text: "Signup", done: false },
      { text: "Logout", done: true },
    ]);
  });

  it("should group checkboxes by section", () => {
    const md = `### v0.1
- [x] Feature A
- [x] Feature B
### v0.2
- [ ] Feature C
- [x] Feature D`;
    const sections = parseCheckboxes(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("v0.1");
    expect(sections[0].done).toBe(2);
    expect(sections[0].total).toBe(2);
    expect(sections[1].title).toBe("v0.2");
    expect(sections[1].done).toBe(1);
    expect(sections[1].total).toBe(2);
  });

  it("should handle Chinese text", () => {
    const md = `### v0.1 — 基础看板（✅ 已完成）
- [x] 扫描 \`~/.claude/todos/\` 和 \`~/.claude/tasks/\` 两套存储
- [x] 统一数据模型展示（TodoItem + TaskItem → SessionData）
- [ ] 已完成/已删除的 session 默认折叠为一行，可展开查看`;
    const sections = parseCheckboxes(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("v0.1 — 基础看板（✅ 已完成）");
    expect(sections[0].done).toBe(2);
    expect(sections[0].total).toBe(3);
  });

  it("should handle uppercase X", () => {
    const md = `## Test
- [X] Done with uppercase`;
    const sections = parseCheckboxes(md);
    expect(sections[0].items[0].done).toBe(true);
  });

  it("should handle asterisk and plus list markers", () => {
    const md = `## Tasks
- [x] dash done
* [x] asterisk done
+ [ ] plus pending
* [ ] asterisk pending`;
    const sections = parseCheckboxes(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].total).toBe(4);
    expect(sections[0].done).toBe(2);
    expect(sections[0].items[0].text).toBe("dash done");
    expect(sections[0].items[1].text).toBe("asterisk done");
    expect(sections[0].items[2].text).toBe("plus pending");
    expect(sections[0].items[2].done).toBe(false);
  });

  it("should handle indented/nested checkboxes", () => {
    const md = `## Features
- [x] Parent feature
  - [x] Sub-feature A
  - [ ] Sub-feature B`;
    const sections = parseCheckboxes(md);
    expect(sections[0].total).toBe(3);
    expect(sections[0].done).toBe(2);
  });

  it("should discard sections without checkboxes", () => {
    const md = `## Introduction
Just some text here.
## Features
- [x] Feature A
## Conclusion
More text.`;
    const sections = parseCheckboxes(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Features");
  });

  it("should handle checkboxes before any heading", () => {
    const md = `- [x] Orphan checkbox
- [ ] Another orphan`;
    const sections = parseCheckboxes(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("(untitled)");
    expect(sections[0].total).toBe(2);
  });

  it("should handle bold/formatted checkbox text", () => {
    const md = `## v0.3
- [x] **Hook 事件接收**：capture.sh + events.jsonl + consumeEvents() 已实现
- [ ] **Activity Alerts UI — 详情页**：右面板显示 alerts`;
    const sections = parseCheckboxes(md);
    expect(sections[0].items[0].text).toContain("**Hook 事件接收**");
    expect(sections[0].items[1].text).toContain("**Activity Alerts UI");
  });

  it("should handle mixed heading levels", () => {
    const md = `# Project
## v1.0
- [x] A
### Sub-section
- [ ] B
#### Deep
- [x] C`;
    const sections = parseCheckboxes(md);
    expect(sections).toHaveLength(3);
    expect(sections[0].level).toBe(2);
    expect(sections[1].level).toBe(3);
    expect(sections[2].level).toBe(4);
  });

  it("should handle empty content", () => {
    expect(parseCheckboxes("")).toEqual([]);
  });

  it("should not match partial checkbox syntax", () => {
    const md = `## Test
- [] Not a checkbox
- [y] Also not
- [x] Real checkbox`;
    const sections = parseCheckboxes(md);
    expect(sections[0].total).toBe(1);
    expect(sections[0].items[0].text).toBe("Real checkbox");
  });
});

// ─── parseRoadmapFile ────────────────────────────────────────

describe("parseRoadmapFile", () => {
  it("should parse a file and return roadmap data", () => {
    const filePath = join(testDir, "PRD.md");
    writeFileSync(filePath, `## v0.1
- [x] Done
- [ ] Pending
## v0.2
- [ ] Future`);

    const result = parseRoadmapFile(filePath, "PRD.md");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("PRD.md");
    expect(result!.totalDone).toBe(1);
    expect(result!.totalItems).toBe(3);
    expect(result!.sections).toHaveLength(2);
    expect(result!.lastModified).toBeTruthy();
  });

  it("should return null for non-existent file", () => {
    const result = parseRoadmapFile("/nonexistent/file.md", "file.md");
    expect(result).toBeNull();
  });

  it("should return null for file with no checkboxes", () => {
    const filePath = join(testDir, "README.md");
    writeFileSync(filePath, "# README\nJust text.");
    const result = parseRoadmapFile(filePath, "README.md");
    expect(result).toBeNull();
  });

  it("should handle multilingual PRD", () => {
    const filePath = join(testDir, "PRD.md");
    writeFileSync(filePath, `# プロジェクト要件
## フェーズ 1
- [x] ログイン機能
- [x] ユーザー登録
- [ ] パスワードリセット

## Phase 2 — Advanced
- [ ] OAuth integration
- [ ] Two-factor auth

## 阶段三 — 性能优化
- [x] 缓存系统
- [ ] CDN 部署`);

    const result = parseRoadmapFile(filePath, "PRD.md");
    expect(result).not.toBeNull();
    expect(result!.sections).toHaveLength(3);
    expect(result!.sections[0].title).toBe("フェーズ 1");
    expect(result!.sections[0].done).toBe(2);
    expect(result!.sections[1].title).toBe("Phase 2 — Advanced");
    expect(result!.sections[1].done).toBe(0);
    expect(result!.sections[2].title).toBe("阶段三 — 性能优化");
    expect(result!.sections[2].done).toBe(1);
    expect(result!.totalDone).toBe(3);
    expect(result!.totalItems).toBe(7);
  });

  it("should reflect real PRD-like structure", () => {
    const filePath = join(testDir, "PRD.md");
    writeFileSync(filePath, `# My App — PRD

## 背景
产品背景说明

## v0.1 — MVP
- [x] 用户注册
- [x] 用户登录
- [x] 数据展示

### 键盘交互
- [x] \`j\`/\`k\` 导航
- [ ] \`/\` 搜索

## v0.2 — Enhancement
- [ ] Dark mode
- [ ] Export CSV
- [x] Notifications

## 未来考虑
- [ ] Mobile app
- [ ] API v2`);

    const result = parseRoadmapFile(filePath, "PRD.md");
    expect(result).not.toBeNull();
    expect(result!.sections).toHaveLength(4);

    // v0.1 milestone
    expect(result!.sections[0].title).toBe("v0.1 — MVP");
    expect(result!.sections[0].done).toBe(3);
    expect(result!.sections[0].total).toBe(3);

    // sub-section with checkboxes
    expect(result!.sections[1].title).toBe("键盘交互");
    expect(result!.sections[1].level).toBe(3);

    // v0.2
    expect(result!.sections[2].done).toBe(1);
    expect(result!.sections[2].total).toBe(3);

    // overall
    expect(result!.totalDone).toBe(5);
    expect(result!.totalItems).toBe(10);
    // percentage
    expect(Math.round((result!.totalDone / result!.totalItems) * 100)).toBe(50);
  });
});

// ─── discoverMarkdownFiles ───────────────────────────────────

describe("discoverMarkdownFiles", () => {
  it("should find .md files in root", () => {
    writeFileSync(join(testDir, "README.md"), "# Readme");
    writeFileSync(join(testDir, "TODO.md"), "# Todo");
    writeFileSync(join(testDir, "index.ts"), "// not markdown");

    const files = discoverMarkdownFiles(testDir);
    expect(files).toContain("README.md");
    expect(files).toContain("TODO.md");
    expect(files).not.toContain("index.ts");
  });

  it("should find .md files in subdirectories", () => {
    mkdirSync(join(testDir, "docs"), { recursive: true });
    writeFileSync(join(testDir, "docs", "PRD.md"), "# PRD");
    writeFileSync(join(testDir, "docs", "TDD.md"), "# TDD");

    const files = discoverMarkdownFiles(testDir);
    expect(files).toContain("docs/PRD.md");
    expect(files).toContain("docs/TDD.md");
  });

  it("should skip node_modules", () => {
    mkdirSync(join(testDir, "node_modules", "some-pkg"), { recursive: true });
    writeFileSync(join(testDir, "node_modules", "some-pkg", "README.md"), "# Pkg");

    const files = discoverMarkdownFiles(testDir);
    expect(files).not.toContain("node_modules/some-pkg/README.md");
  });

  it("should skip .git directory", () => {
    mkdirSync(join(testDir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(testDir, ".git", "README.md"), "# Git internals");

    const files = discoverMarkdownFiles(testDir);
    expect(files).not.toContain(".git/README.md");
  });

  it("should skip other junk directories", () => {
    for (const dir of ["dist", "build", "coverage", "vendor", ".next"]) {
      mkdirSync(join(testDir, dir), { recursive: true });
      writeFileSync(join(testDir, dir, "README.md"), "# Junk");
    }

    const files = discoverMarkdownFiles(testDir);
    expect(files).toHaveLength(0);
  });

  it("should respect depth limit", () => {
    // depth 0: root, 1: a/, 2: a/b/, 3: a/b/c/, 4: a/b/c/d/ (too deep)
    const deep = join(testDir, "a", "b", "c", "d");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(testDir, "a", "b", "c", "d", "DEEP.md"), "# Too deep");
    writeFileSync(join(testDir, "a", "b", "c", "OK.md"), "# Depth 3");
    writeFileSync(join(testDir, "a", "SHALLOW.md"), "# Depth 1");

    const files = discoverMarkdownFiles(testDir);
    expect(files).toContain("a/SHALLOW.md");
    expect(files).toContain("a/b/c/OK.md");
    expect(files).not.toContain("a/b/c/d/DEEP.md");
  });

  it("should return empty for non-existent path", () => {
    const files = discoverMarkdownFiles("/nonexistent/path");
    expect(files).toEqual([]);
  });
});
