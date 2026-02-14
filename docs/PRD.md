# Claude Monitor — 产品需求文档

## 一句话描述

终端看板工具，实时监控 Claude Code agent 的任务进度和状态。黑客风格 TUI。

## 背景与问题

### 痛点

1. **任务不可见**：Claude Code 用 `TaskCreate` / `TodoWrite` 创建任务后，用户找不到这些数据——文件名是 UUID，分散在 `~/.claude/todos/` 和 `~/.claude/tasks/` 两套系统中
2. **进度不透明**：多 agent 并行开发时（worktree 模式），主 agent 无法直观看到各 stream 的执行状况
3. **历史丢失**：session 结束后，之前的任务列表就「消失」了，无法回顾
4. **删除即消失**：Claude Code 删除/完成 task 后，JSON 文件被清理，历史记录无法追溯

### 目标用户

- 使用 Claude Code 进行日常开发的工程师
- 使用 multi-agent / worktree 并行开发模式的用户
- 希望对 AI agent 执行过程有更多可观测性的用户

## 产品愿景

一个轻量级 TUI 工具，在独立终端窗口运行，为 Claude Code 用户提供类 Asana 的任务看板体验。黑客美学设计风格，键盘驱动交互。

## 数据源

| 来源 | 路径 | 格式 | 状态 |
|---|---|---|---|
| TodoWrite（旧） | `~/.claude/todos/{session}-agent-{agent}.json` | JSON 数组 `[{content, status, activeForm}]` | ✅ 已接入 |
| TaskCreate（新） | `~/.claude/tasks/{session}/{n}.json` | JSON 对象 `{id, subject, description, status, owner, blocks, blockedBy}` | ✅ 已接入 |
| Session Index | `~/.claude/projects/*/sessions-index.json` | JSON `{entries: [{sessionId, projectPath, summary, gitBranch}]}` | ✅ 已接入 |
| Session JSONL | `~/.claude/projects/*/{sessionId}.jsonl` | 会话记录 | ✅ 用于 fallback 匹配 |
| 本地快照 | `~/.claude-monitor/snapshots/{sessionId}.json` | TUI 自己的持久化副本 | 🔜 v0.2 |
| Team Config | `~/.claude/teams/{team}/config.json` | JSON `{members: [{name, agentId, agentType}]}` | 🔜 v0.3 |
| Hook Events | Claude Code hook 系统 | 事件触发 | 🔜 v0.4 |
| 进程状态 | `ps` 系统调用 | 进程信息 | 🔜 v0.3 |

## 功能规划

### v0.1 — 基础看板（✅ 已完成）

- [x] 扫描 `~/.claude/todos/` 和 `~/.claude/tasks/` 两套存储
- [x] 统一数据模型展示（TodoItem + TaskItem → SessionData）
- [x] 1 秒轮询实时刷新 + snapshotKey 指纹对比（仅数据变化时 re-render）
- [x] 卡片式 session 展示（status icon + 进度统计 + 时间戳）
- [x] Ink (React for CLI) 渲染引擎
- [x] 项目名解析：sessions-index.json 反向索引 + jsonl fallback
- [x] Session 摘要 / firstPrompt 显示
- [x] Git 分支显示（非 main 分支时）
- [x] 进度条（每个 session 的完成百分比）

### v0.2 — 持久化 + 交互 + 设计

#### 本地快照持久化
- [ ] 每次 poll 发现新数据时，快照到 `~/.claude-monitor/snapshots/`
- [ ] Claude Code 删除 task 后，TUI 仍保留历史记录
- [ ] 已完成/已删除的 session 默认折叠为一行，可展开查看

#### 键盘交互
- [ ] `↑` `↓` / `j` `k`：切换 session 焦点
- [ ] `Enter`：展开/折叠 session 详情
- [ ] `Tab`：切换视图（列表 ↔ 看板）
- [ ] `/`：搜索过滤
- [ ] `f`：过滤模式（active / all / project）
- [ ] `q`：退出

#### 设计风格
- [ ] 黑客美学 / cyberpunk 终端风格
- [ ] 绿色/青色为主的配色方案
- [ ] ASCII art header
- [ ] 扫描线 / 闪烁效果等终端特效
- [ ] Design Playground 原型验证

#### 视图
- [ ] **当前 session 高亮**：最新活跃 session 置顶 + 高亮边框
- [ ] **折叠/展开**：旧 session 折叠成单行摘要
- [ ] **看板视图**：三列 Pending | In Progress | Done

### v0.3 — 多 Agent 监控

- [ ] **Team 模式支持**：读取 `~/.claude/teams/` 配置，按 team 分组展示
- [ ] **Agent 标识**：显示 task owner（哪个 agent 在做哪个任务）
- [ ] **依赖可视化**：显示 `blocks` / `blockedBy` 关系
- [ ] **进程状态**：检测 agent 进程是否存活（running / idle / dead）

### v0.4 — 事件流集成

- [ ] **Hook 事件接收**：接入 Claude Code hook 系统，实时显示事件流
- [ ] **事件时间线**：底部面板显示最近的 hook 事件（start, submit, complete, error...）
- [ ] **与 Sound FX 联动**：共享 hook 基础设施（同一个 event collector）

### 未来考虑（不承诺时间）

- [ ] Web 版本（localhost dashboard）
- [ ] 历史统计（每日完成任务数、平均 session 时长）
- [ ] Claude Code 插件集成（作为 MCP resource 提供数据）
- [ ] 通知集成（task blocked 时发送系统通知）

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript | 项目规范 + 类型安全 |
| TUI 引擎 | Ink (React for CLI) | 响应式渲染，组件化开发 |
| 数据刷新 | 1s setInterval 轮询 | 比 Chokidar FSEvents 更可靠，开销极低 |
| 持久化 | JSON 文件 (`~/.claude-monitor/`) | 本地快照，无需数据库 |
| 构建 | tsup | 零配置 TS 打包 |
| 开发 | tsx | TS 直接运行，无需编译 |
| 包管理 | npm | 项目默认 |

## 交互模型

### 键盘驱动（主要）

TUI 的交互模型类似 vim / htop / lazygit：

```
全局快捷键：
  q         退出
  /         搜索
  Tab       切换视图
  f         过滤

导航：
  ↑/k       上移焦点
  ↓/j       下移焦点
  Enter     展开/折叠
  Esc       返回上级
```

### Ink 提供的交互 Hook

```typescript
useInput()       // 捕获键盘输入
useFocus()       // 组件焦点管理
useFocusManager() // 全局焦点导航
```

### 鼠标（辅助，不依赖）

终端支持鼠标报告协议，但不同终端兼容性差异大，不作为主要交互方式。

## 约束与限制

### Claude Code 的限制

1. **无公开 Agent 状态 API** — 无法获知 agent 是在 "规划" 还是 "执行"，只能通过 task status 间接推断
2. **Hook 事件粒度有限** — 只有 7 个生命周期事件，无法追踪每次工具调用
3. ~~**没有 session ID 到项目的映射**~~ — ✅ 已解决：`sessions-index.json` + jsonl fallback
4. ~~**TodoWrite 和 TaskCreate 并存**~~ — ✅ 已统一：两套格式通过 SessionData 抽象层合并展示
5. **Task 删除后文件消失** — 🔜 v0.2 本地快照解决

### 设计原则

- **只读** — 不修改任何 Claude Code 的数据文件
- **非侵入** — 不需要修改 Claude Code 配置，开箱即用
- **轻量** — 独立终端窗口运行，不影响 Claude Code 性能
- **渐进增强** — 每个版本独立可用，不依赖未实现的功能
- **键盘优先** — 所有操作可通过键盘完成

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
