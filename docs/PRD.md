# Claude Monitor — 产品需求文档

## 一句话描述

终端看板工具，实时监控 Claude Code agent 的任务进度和状态。

## 背景与问题

### 痛点

1. **任务不可见**：Claude Code 用 `TaskCreate` / `TodoWrite` 创建任务后，用户找不到这些数据——文件名是 UUID，分散在 `~/.claude/todos/` 和 `~/.claude/tasks/` 两套系统中
2. **进度不透明**：多 agent 并行开发时（worktree 模式），主 agent 无法直观看到各 stream 的执行状况
3. **历史丢失**：session 结束后，之前的任务列表就「消失」了，无法回顾

### 目标用户

- 使用 Claude Code 进行日常开发的工程师
- 使用 multi-agent / worktree 并行开发模式的用户
- 希望对 AI agent 执行过程有更多可观测性的用户

## 产品愿景

一个轻量级 TUI 工具，在独立终端窗口运行，为 Claude Code 用户提供类 Asana 的任务看板体验。

## 数据源

| 来源 | 路径 | 格式 | 说明 |
|---|---|---|---|
| TodoWrite（旧） | `~/.claude/todos/{session}-agent-{agent}.json` | JSON 数组 `[{content, status, activeForm}]` | 单 agent 场景，扁平列表 |
| TaskCreate（新） | `~/.claude/tasks/{session}/{n}.json` | JSON 对象 `{id, subject, description, status, owner, blocks, blockedBy}` | 支持 team 模式，有依赖关系 |
| Team Config | `~/.claude/teams/{team}/config.json` | JSON `{members: [{name, agentId, agentType}]}` | agent 成员信息 |
| Hook Events | Claude Code hook 系统 | 事件触发 | SessionStart, Stop, Error 等 7 个生命周期事件 |
| 进程状态 | `ps` 系统调用 | 进程信息 | agent 进程是否存活 |

## 功能规划

### v0.1 — 基础看板（✅ 已完成）

- [x] 扫描 `~/.claude/todos/` 和 `~/.claude/tasks/` 两套存储
- [x] 统一数据模型展示（TodoItem + TaskItem → SessionData）
- [x] Chokidar 文件监听，变更自动刷新
- [x] 卡片式 session 展示（status icon + 进度统计 + 时间戳）
- [x] Ink (React for CLI) 渲染引擎

### v0.2 — 实用增强

- [ ] **当前 session 高亮**：自动检测最新活跃的 session，置顶并高亮显示
- [ ] **过滤模式**：只看当前 session / 只看 in_progress / 只看最近 N 天
- [ ] **看板视图切换**：列表视图 ↔ 三列看板视图（Pending | In Progress | Done）
- [ ] **Session 标签**：从 task description 推断项目名，替代 UUID 显示
- [ ] **进度条**：每个 session 显示完成百分比进度条

### v0.3 — 多 Agent 监控

- [ ] **Team 模式支持**：读取 `~/.claude/teams/` 配置，按 team 分组展示
- [ ] **Agent 标识**：显示 task owner（哪个 agent 在做哪个任务）
- [ ] **依赖可视化**：显示 `blocks` / `blockedBy` 关系
- [ ] **进程状态**：检测 agent 进程是否存活（running / idle / dead）

### v0.4 — 事件流集成

- [ ] **Hook 事件接收**：接入 Claude Code hook 系统，实时显示事件流
- [ ] **事件时间线**：底部面板显示最近的 hook 事件（start, submit, complete, error...）
- [ ] **与 Sound FX 联动**：共享 hook 基础设施（同一个 event collector）

### v0.5 — 交互与导航

- [ ] **键盘导航**：↑↓ 切换 session，Enter 展开详情，Tab 切换视图
- [ ] **Task 详情面板**：展开查看 task 的 description 全文
- [ ] **搜索 / 过滤**：按关键字搜索 task

### 未来考虑（不承诺时间）

- [ ] Web 版本（localhost dashboard）
- [ ] 历史统计（每日完成任务数、平均 session 时长）
- [ ] Claude Code 插件集成（作为 MCP resource 提供数据）
- [ ] 通知集成（task blocked 时发送系统通知）

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript | 项目规范 + 类型安全 |
| TUI 引擎 | Ink (React for CLI) | 响应式渲染，和文件 watch 的数据流天然匹配 |
| 文件监听 | Chokidar | 跨平台 fs.watch 封装，支持 debounce |
| 构建 | tsup | 零配置 TS 打包 |
| 开发 | tsx | TS 直接运行，无需编译 |
| 包管理 | npm | 项目默认 |

## 约束与限制

### Claude Code 的限制

1. **无公开 Agent 状态 API** — 无法获知 agent 是在 "规划" 还是 "执行"，只能通过 task status 间接推断
2. **Hook 事件粒度有限** — 只有 7 个生命周期事件，无法追踪每次工具调用
3. **没有 session ID 到项目的映射** — session UUID 和具体项目没有直接关联
4. **TodoWrite 和 TaskCreate 并存** — 两套存储格式不同，需要统一抽象

### 设计原则

- **只读** — 不修改任何 Claude Code 的数据文件
- **非侵入** — 不需要修改 Claude Code 配置，开箱即用
- **轻量** — 独立终端窗口运行，不影响 Claude Code 性能
- **渐进增强** — 每个版本独立可用，不依赖未实现的功能

## 使用方式

```bash
# 基础用法：在另一个终端窗口运行
npx tsx src/index.tsx

# 未来：全局安装
npm install -g claude-monitor
claude-monitor

# 未来：带参数
claude-monitor --filter active      # 只看活跃 session
claude-monitor --view kanban        # 看板视图
claude-monitor --team my-project    # 只看某个 team
```
