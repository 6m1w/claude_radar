# Claude Radar — 产品需求文档

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
| Session JSONL | `~/.claude/projects/*/{sessionId}.jsonl` | 会话记录 | ✅ 用于 fallback 匹配 + mtime 活跃检测 |
| Git HEAD | `{projectPath}/.git/HEAD` | 当前分支 | ✅ 已接入 |
| 项目文档 | `{projectPath}/CLAUDE.md`, `PRD.md`, `TDD.md`, `README.md` | 存在性检测 | ✅ 已接入 |
| 本地快照 | `~/.claude-radar/snapshots/{sessionId}.json` | TUI 自己的持久化副本 | 🔜 v0.2 |
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
- [ ] 每次 poll 发现新数据时，快照到 `~/.claude-radar/snapshots/`
- [ ] Claude Code 删除 task 后，TUI 仍保留历史记录
- [ ] 已完成/已删除的 session 默认折叠为一行，可展开查看

#### 键盘交互
- [x] `↑` `↓` / `j` `k`：切换 project/task 焦点
- [x] `Enter`：进入内层焦点（从项目列表 → 任务列表）
- [x] `Esc`：退出内层焦点 / 返回上级视图
- [x] `Tab`：切换到 Kanban 视图
- [x] `Space`：标记项目（☑/☐）用于 Kanban 多选
- [ ] `1` `2` `3`：内层焦点时切换右面板 tab（Tasks / Git / Docs）
- [ ] `/`：搜索过滤
- [ ] `f`：过滤模式（active / all / project）
- [x] `q`：退出

#### 设计风格
- [x] 黑客美学 / cyberpunk 终端风格
- [x] Catppuccin Mocha 配色方案（+ 预留 Retro / Cyberpunk 主题）
- [ ] ASCII art header
- [x] Design Playground 原型验证
- [x] 系统指标状态栏（CPU sparkline + MEM + 网络 + spinner）
- [x] Mini mascot（☻ 状态指示，内嵌 status bar，静态无动画避免闪烁）

#### 数据源重构
- [x] **项目中心化发现**：扫描 `~/.claude/projects/` 全部目录（不依赖 tasks/todos）
- [x] **Git 信息**：直接读 `.git/HEAD` 获取分支（非仅 sessions-index 元数据）
- [x] **文档检测**：检测 CLAUDE.md, PRD.md, TDD.md, README.md 存在性
- [x] **Session 活跃检测**：通过 `.jsonl` 文件 mtime 判断（5 分钟阈值）
- [x] **路径反推**：`resolveSegments()` 从 Claude 编码目录名重建实际路径
- [x] **项目去重**：多个 Claude 目录解析到同一路径时合并数据
- [x] **Session 历史**：从 sessions-index.json 提取 summary/firstPrompt 展示

#### 视图重构：Master-Detail 单页模式
- [x] **Dashboard 视图**（默认）：OVERVIEW + ACTIVE NOW + PROJECTS + DETAIL + ACTIVITY
- [ ] **~~Project Detail 视图~~**：**已废弃** → 合并到 Dashboard 内，改为两层焦点模式
  - 外层焦点：`j/k` 在项目列表移动，右面板跟随显示项目概要 + 前 N 个 tasks
  - 内层焦点（`Enter`）：`j/k` 在右面板任务列表移动，选中 task 展开详情
- [ ] **上下文感知底部面板（B1）**：
  - 外层焦点 → 底部显示 ACTIVITY（全局事件流）
  - 内层焦点 → 底部替换为 PRD/Docs + **Project Timeline**（git commits + task events 合并时间线）
- [ ] **右面板 Tab 切换**：内层焦点时按 `1/2/3` 切换 Tasks / Git / Docs 视图
- [x] **Focus/Kanban 视图**：Swimlane 表格布局（共享表头 TODO/DOING/DONE）
- [x] **活跃项目置顶**：有 active session 的项目排在最前
- [ ] **项目列表 Viewport 滚动**：大量项目时只渲染可见行，光标驱动窗口滑动
- [ ] **Agent 分组任务列表**：多 agent 项目在 inner focus 的 task 列表按 agent 分组，显示 agent 状态头（`── ◍ stream-a (active) ──`）；单 agent 项目保持平铺
- [ ] **项目名完整显示**：名字上限 20 字符，超长用 `…` 截断，面板宽度 34 列
- [ ] **By Agent 布局**：Kanban 按 agent 分列（设计已有，待实现）
- [ ] **折叠/展开**：旧 session 折叠成单行摘要

#### 自适应布局
- [ ] **高度自适应**：根据终端行数动态分配面板高度
- [ ] **项目列表上限**：高度不超过屏幕 50%，保证底部面板（Docs/Git/Activity）有足够空间
- [ ] **可配置比例**：布局比例通过 `~/.claude-radar/config.json` 的 `layout` 字段配置
- [ ] **小屏 fallback**：终端行数不足时自动隐藏底部面板，退化为紧凑模式
- [ ] **Overview 可收起**（stretch）：内层焦点时 Overview 压缩为单行上下文条，释放空间

#### 性能优化
- [x] **渲染频率降低**：metrics 3s/次（网络 6s），数据轮询 3s
- [x] **顺序异步循环**：while + await 替代 setInterval，防止 netstat 进程累积
- [x] **StatusBar 渲染隔离**：useMetrics() 在 StatusBar 内部，不传播到 App
- [x] **固定宽度格式化**：数值 padStart 防止 layout shift
- [x] **snapshotKey 差异检测**：仅数据变化时触发 React re-render
- [x] **Production 构建**：NODE_ENV=production 抑制 React dev 警告

### v0.3 — 多 Agent 监控 + 看板增强

- [ ] **Team 模式支持**：读取 `~/.claude/teams/` 配置，按 team 分组展示
- [ ] **Worktree 分组**：检测 git worktree（`.git` 文件 → 指向主 repo），同一 repo 的 worktree 在项目列表树形折叠展示
- [ ] **Agent 标识**：显示 task owner（哪个 agent 在做哪个任务）
- [ ] **依赖可视化**：Kanban 中显示 `blocks` / `blockedBy` 关系（`⊘ blocked:#4` 标记）
- [ ] **状态停留时间**：显示 task 在当前状态停留了多久（`↑ 2h in-doing`）
- [ ] **进程状态**：检测 agent 进程是否存活（running / idle / dead）
- [ ] **多套主题**：Catppuccin Mocha / Retro Terminal / Cyberpunk，`t` 键切换或 CLI flag

### v0.4 — 事件流集成

- [ ] **Hook 事件接收**：接入 Claude Code hook 系统，实时显示事件流
- [ ] **事件时间线**：底部面板显示最近的 hook 事件（start, submit, complete, error...）
- [ ] **与 Sound FX 联动**：共享 hook 基础设施（同一个 event collector）

### v0.5 — 动效与润色

- [ ] **Phase 1 微动效**：活跃 task 脉冲闪烁、新 task 高亮 flash、数字滚动
- [ ] **Phase 2 过渡效果**：视图切换淡入淡出、进度条动画
- [ ] **Phase 3 角色动画**（stretch goal）：mascot 水平跑动、获取数据冲撞特效、跳跃/掉落
- [ ] **可展开指标面板**：按 `m` 展开 braille 折线图（CPU/MEM/NET 1 分钟历史）
- [ ] **多套主题切换**：Catppuccin Mocha / Retro Terminal / Cyberpunk，`t` 键或 CLI flag

### 未来考虑（不承诺时间）

- [ ] Web 版本（localhost dashboard）
- [ ] 历史统计（每日完成任务数、平均 session 时长）
- [ ] Claude Code 插件集成（作为 MCP resource 提供数据）
- [ ] 通知集成（task blocked 时发送系统通知）

## 竞品分析（2026-02）

### 直接竞品 — TUI Dashboard

| 项目 | GitHub | 语言 | 核心特点 | 与我们的差异 |
|------|--------|------|----------|-------------|
| [claudash](https://github.com/claudash/claudash) | claudash/claudash | — | 像 tig 一样浏览 Claude Code session 历史 | 聚焦 session 浏览，不做实时任务监控 |
| [claude-dashboard](https://github.com/seunggabi/claude-dashboard) | seunggabi/claude-dashboard | Go | k9s 风格 TUI，通过 tmux 管理 Claude sessions | 依赖 tmux，聚焦 session 管理而非任务看板 |
| [ccboard](https://github.com/FlorianBruniaux/ccboard) | FlorianBruniaux/ccboard | Rust | 9 个 tab 的 TUI + Web 界面，成本追踪，预算告警 | 功能全面但偏 DevOps 视角，非任务进度 |
| [agent-deck (TUI)](https://github.com/asheshgoplani/agent-deck) | asheshgoplani/agent-deck | — | 多 AI agent 终端管理器（Claude, Gemini, Codex 等） | 聚焦 session 管理，不读取 task/todo 数据 |
| [agent-of-empires](https://github.com/njbrake/agent-of-empires) | njbrake/agent-of-empires | — | tmux + git worktree 多 agent 管理 | 依赖 tmux + worktree，偏运维而非可视化 |
| [tmuxcc](https://github.com/nyanko3141592/tmuxcc) | nyanko3141592/tmuxcc | — | tmux 中的 AI coding agent TUI dashboard | 类似 claude-dashboard，tmux 依赖 |
| [claude-session-browser](https://github.com/davidpp/claude-session-browser) | davidpp/claude-session-browser | — | TUI 浏览器，浏览和恢复 Claude sessions | 偏历史浏览，不做实时监控 |

### 相关工具 — 移动端 / 桌面端

| 项目 | GitHub | 特点 | 备注 |
|------|--------|------|------|
| [agent-deck (Mobile)](https://github.com/tonyofthehills/agent-deck) | tonyofthehills/agent-deck | Mac menubar + 手机实时监控 agent 状态 | 手机端是独特优势 |
| [claude-code-monitor](https://github.com/onikan27/claude-code-monitor) | onikan27/claude-code-monitor | CLI + Mobile Web UI + QR code 访问 | macOS only，与我们同名 |

### 相关工具 — 用量 / 成本分析

| 项目 | GitHub | 特点 | 备注 |
|------|--------|------|------|
| [ccusage](https://github.com/ryoppippi/ccusage) | ryoppippi/ccusage | 分析 JSONL 日志的 CLI，日报/月报/session 报告 | 高 star，专注成本分析 |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | Maciek-roboblog/Claude-Code-Usage-Monitor | 实时 token 用量、burn rate、预测 | 偏监控告警 |
| [ccflare](https://ccflare.dev) | — | Web UI 用量 dashboard | 非 TUI |
| [Claudex](https://github.com/Claudex) | — | Web 端 session 浏览器，全文搜索 | 偏历史检索 |

### 相关工具 — Hook / 可观测性

| 项目 | GitHub | 特点 | 备注 |
|------|--------|------|------|
| [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | disler/claude-code-hooks-multi-agent-observability | 通过 hook 事件追踪多 agent | 我们 v0.4 计划接入 |

### 企业级监控

| 项目 | 特点 | 备注 |
|------|------|------|
| [Datadog AI Agents Console](https://www.datadoghq.com/blog/claude-code-monitoring/) | 组织级 Claude Code 采用监控 | 企业 SaaS，非本地工具 |
| [SigNoz Claude Code Dashboard](https://signoz.io/docs/dashboards/dashboard-templates/claude-code-dashboard/) | 开源可观测平台模板 | 需部署 SigNoz |

### 我们的差异化定位

| 维度 | Claude Radar（本项目） | 多数竞品 |
|------|--------------------------|----------|
| **核心数据源** | 读取 `~/.claude/tasks/` + `~/.claude/todos/` 任务数据 | 多数只读 session 元数据或 JSONL 日志 |
| **任务级可视化** | Kanban 看板、任务进度条、blocks/blockedBy 依赖 | session 列表或成本图表 |
| **历史持久化** | 本地快照，task 被删后仍保留完整历史 | 无持久化或仅统计聚合 |
| **项目中心化** | 5 阶段 pipeline 自动发现所有项目 + git/docs 富化 | 需手动选择或依赖 tmux session |
| **零依赖** | 不依赖 tmux / Docker / 外部服务 | 部分依赖 tmux 或 Web 服务 |
| **黑客美学** | Catppuccin Mocha + lazygit 风格 + ASCII mascot | 多数无明确设计语言 |

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript | 项目规范 + 类型安全 |
| TUI 引擎 | Ink (React for CLI) | 响应式渲染，组件化开发 |
| 数据刷新 | 3s setInterval 轮询 + snapshotKey diff | 比 Chokidar FSEvents 更可靠，仅变化时 re-render |
| 持久化 | JSON 文件 (`~/.claude-radar/`) | 本地快照，无需数据库 |
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
npm install -g claude-radar
claude-radar

# 未来：带参数
claude-radar --filter active      # 只看活跃 session
claude-radar --view kanban        # 看板视图
claude-radar --team my-project    # 只看某个 team
```
