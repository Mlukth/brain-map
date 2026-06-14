# Brain Map v2 — 技术方案

## 一、项目本质

一个**会话级 Claude Code 任务执行记录系统**，链式图可视化，通过 Hook 自动生长，支持预设计划链（计划经济）。

**不是**：思维导图工具、AI创意发散器、跨会话知识库、多人协作工具。

---

## 二、技术栈（不动现有骨架）

| 层 | 工具 | 理由 |
|----|------|------|
| 后端 | Node.js HTTP (server.cjs) | 已有，单文件800行，不改语言 |
| 渲染 | ECharts 6.0 (CDN) | 已有，链式布局稳定，暂不换 |
| Hook转发 | Node.js ESM (hook-forwarder.js) | 已有，stdin→HTTP |
| 存储 | JSON文件（会话级） | 已有树模型，加游标字段 |
| 双向通信 | SSE（server→浏览器）+ HTTP POST（浏览器→server） | 已有 SSE，加反向通道 |
| 弹窗/审计 | PreToolUse hook 阻塞 + SSE通知浏览器 + 浏览器回传 | 借鉴 Clawd Companion |
| 跨平台 | 浏览器（已有）+ Node.js（已有） | 不引入 Electron |

**不引入的新依赖**：无。所有功能用已有技术栈实现。

---

## 三、数据模型（基于现有树模型扩展）

### 3.1 节点属性

```javascript
node = {
  // 现有属性（保留）
  id: "goal-1718345678",
  name: "接qwen API",
  type: "goal",           // root | goal | action
  status: "active",       // active | done | shelved | failed
  taskLine: "eqwen",
  children: ["action-xxx"],
  nextInChain: "goal-xxx",
  symbolSize: 38,
  createdAt: "2026-06-14T...",
  
  // 新增属性
  planMode: false,        // true = 计划经济节点（灰色）
  notes: "",              // 用户备注（脑图UI或Claude写入）
  cursorAt: null,         // 时间戳，游标曾在此停留的时间
  result: null,           // { outcome: "success"|"failure", summary: "", failedAt: "" }
  branchOf: null,         // 如果是从计划链分出的临时灰色子链，记录父节点id
  pinned: false,          // 手动置顶（不被修剪删除）
  tags: [],               // 标签数组
  completedAt: null,      // 移到顶层（现有在tool_end设的）
  updatedAt: null         // 最后修改时间
}
```

### 3.2 全局元数据

```javascript
S.planRoots = ["goal-001", "goal-002", "goal-003"]   // 多条平行计划链的起点id
S.meta = {
  activeTaskLine: "eqwen",
  cursor: "goal-1718345678",    // 当前游标指向的节点id
  auditEnabled: true,           // 审计开关（浏览器控制）
  planMode: false,              // 当前是否在计划经济模式
  currentPlanIndex: 0,          // 正在执行第几条计划链
  lastUpdate: "2026-06-14T..."
}
```

### 3.3 存储文件

- 文件名：`brain-map-state-{cwdHash}.json`
- cwdHash = cwd 的简单 hash（路径里非法字符替换）
- 会话开始加载，会话结束清空（可选保留用于调试）

---

## 四、核心功能实现方案

### 4.1 游标系统（Cursor）

**原理**：服务器维护 `S.meta.cursor`，始终指向"Claude 当前应在的节点"。

**移动规则**：

| 事件 | 游标行为 |
|------|---------|
| prompt_submit → 新 goal | 游标移到新 goal |
| tool_start → 新 action | 游标不动（action 是分支） |
| tool_end → action done | 游标不动 |
| Claude 显式 `/brainmap move <id>` | 游标移到指定节点 |

**注入内容**（UserPromptSubmit hook 返回 additionalContext）：

```
[脑图] 当前进度:
  ✓ 搭邮件分类器
  ▶ 接qwen API  ← 当前位置
    备注: 用 qwen3:8b，注意超时
  ⏳ 测试准确率
  ⏳ 部署上线
```

**Claude 的职责**：读这段文本，判断自己是否真的在游标所指的节点。如果不匹配，通过对话或 `/brainmap` 命令修正。

### 4.2 计划经济（Plan Mode）

**触发**：prompt 含 `计划`/`步骤`/`路线`/`提前规划`/`先写需求`。

**流程**：

```
用户: "做计划：接qwen到邮件管线"
  → Claude 新建一条灰色链（planMode: true）
     [接qwen API] → [调试endpoint] → [处理超时] → [联调测试] → [部署]
  → 用户审计灰色链（脑图UI查看，可编辑、增删节点）
  → Claude 开始执行
    → 游标走到第一个灰色节点 → 自动变亮
    → 逐一完成
  → 执行中产生新想法 → Claude 可延伸灰色子链挂在当前节点下
  → 计划链某节点失败 → 标记 status:"failed"，存储 result.failedAt
```

**视觉**：
- 普通节点：任务线颜色（蓝/绿/黄等）
- 灰色节点（planMode: true）：#666 灰色，虚线边框
- 灰色节点被游标激活：变亮为任务线颜色 + 白边框（同 active 状态）
- 失败节点：红色边框 + status 显示 "失败"

### 4.3 审计系统（Audit）

**开关位置**：浏览器顶部栏，一个 toggle 按钮。

**工作流**（开关打开时）：

```
Claude 要改图结构（删节点/改关系/改备注）
  → Claude 调用 Bash 或 HTTP（访问 brain-map server 的 /graph 接口）
    → PreToolUse hook 拦截
      → hook-forwarder 识别这是 brain-map 的请求
        → 如果 S.meta.auditEnabled === false → 直接放行 ✅
        → 如果 auditEnabled === true:
          → POST 给 brain-map server
            → server 通过 SSE 推送给浏览器: { type: "audit-request", action: "delete", nodeId: "X" }
              → 浏览器弹出确认框（模态层）
                → 用户点击 确认 / 拒绝
                  → 浏览器 POST /audit-response { approved: true/false }
                    → server 返回结果给 hook-forwarder
                      → hook 返回 allow/deny 给 Claude Code
```

**弹窗样式**：简洁的模态框，显示操作描述 + 确认/取消按钮。不搞花哨动画。

### 4.4 节点编辑（Brain Map UI）

**右键菜单**（在浏览器脑图界面上）：
- 编辑备注 → 弹出文本框
- 标记完成/失败 → 手动改状态
- 删除节点 → 触发审计流程
- 在此节点后插入子节点 → 手动建链

**双击节点** → 快速编辑备注。

**所有编辑操作** → POST /graph 到 server → 更新 state → SSE 推送回浏览器刷新。

### 4.5 Claude 主动操控图

**方式**：Claude 调用 `Bash` → `curl -X POST http://127.0.0.1:47635/graph -d '{"action":"...", ...}'`

**支持的 actions**（暂定）：
- `create-node` — 创建新节点
- `delete-node` — 删除节点（会触发审计）
- `update-node` — 修改节点属性
- `move-cursor` — 移动游标
- `mark-done` / `mark-failed` — 标记状态
- `add-note` — 写入备注

**如果审计开关关闭**：所有操作直接执行，不阻塞。

---

## 五、实现范围（分期）

### Phase 1 — 最小闭环 ✅ 已完成 (2026-06-15)

**已完成**：游标、planMode灰色节点、/graph API、Hook注入、审计开关、右键菜单、归档JSONL、planRoots多链、防死循环

**改动文件**：
- `server.cjs`：加游标、planMode、notes、result 字段，加 /graph API
- `hook-forwarder.js`：加 UserPromptSubmit context injection，识别计划关键词
- `renderer/index.html`：灰色节点视觉、右键菜单（编辑备注）、审计开关按钮
- `settings.json`：确认 UserPromptSubmit hook 已注册

**不改**：ECharts 渲染引擎、链式布局算法、SSE 推送逻辑。

**验收标准**：
1. 用户说"做计划：接qwen" → 脑图出现灰色链
2. Claude 执行时游标自动移动，灰色节点逐个变亮
3. Claude 能看到当前节点备注（通过 hook 注入）
4. 用户在脑图右键→编辑备注→Claude 下次读到时能看见新内容

### Phase 2 — 审计系统（目标：改结构要确认）

**改动文件**：
- `server.cjs`：加 audit-request/audit-response SSE 事件
- `hook-forwarder.js`：加 PreToolUse 拦截 brain-map 请求的逻辑
- `renderer/index.html`：加确认弹窗 UI

**验收标准**：
1. 审计开 → 删节点弹窗，用户确认才执行
2. 审计关 → 全自动，不弹窗
3. 30秒超时无响应 → 自动拒绝（安全兜底）

### Phase 3 — 完成判定 + 失败处理（目标：计划失败有记录）

**改动文件**：
- `server.cjs`：加 goal 完成判定逻辑（所有子 action done → goal done），失败节点存储 result
- `renderer/index.html`：失败节点视觉（红色边框 + tooltip 显示原因）

**验收标准**：
1. goal 下所有 action done → goal 自动 done
2. 计划节点失败 → 显示红色边框，tooltip 能看到失败原因
3. 失败后可手动重新激活

### Phase 4 — 修剪 + 优化（目标：图不自爆）

**改动文件**：
- `server.cjs`：加修剪启发式（按时间+状态+是否 pinned），加节点上限（60→80）
- `renderer/index.html`：优化大量节点时的布局

**验收标准**：
1. 超过上限时自动清理最旧的 done 节点
2. pinned 节点不被清理
3. 计划链节点不因超限被清理

---

## 六、本轮讨论新增决策

| # | 决策 | 结论 |
|---|------|------|
| 1 | 游标 | S.meta.cursor 字符串指针，prompt_submit 自动移动 |
| 2 | Hook 注入 | UserPromptSubmit 返回 additionalContext，注入游标±3节点 + 当前节点备注 |
| 3 | 注入格式 | 压缩纯文本，~150字符，不搞 JSON |
| 4 | 计划经济触发 | prompt 含 计划/步骤/路线/提前规划/先写需求 → 建灰色链 |
| 5 | 灰色节点 | planMode:true，#666灰色虚线边框，游标走到自动变亮 |
| 6 | 审计开关 | 浏览器 toggle，默认关；开→改结构弹窗，关→全自动 |
| 7 | 审计弹窗 | PreToolUse hook 阻塞 + HTTP → SSE → 浏览器 Modal → 回传 |
| 8 | 30s超时 | 无人响应自动拒绝，不阻塞 Claude |
| 9 | 完成判定 | 所有子action done → goal done；planMode节点需对照成功标准 |
| 10 | 防死循环 | 单节点连续3次失败→标failed；2个备选方案均失败→标红需人工介入 |
| 11 | 节点信息分层 | Hover→Tooltip(轻量)；Click→弹窗(finalReport完整报告) |
| 12 | 存储 | 一个CLI一个临时文件 `brain-map-state-{sessionId}-{timestamp}.json` |
| 13 | 归档 | 有价值节点导出到 `D:\docs\brain-map-archive.jsonl` |
| 14 | 多计划链 | 允许并存+执行中临时追加；普通链后面直接接灰色节点 |
| 15 | 节点上限 | 放开，不设硬限制；修剪暂不启用 |
| 16 | server崩溃 | 不处理，会话级临时数据，挂了就挂了 |
| 17 | 浏览器 | SessionStart 自动弹窗打开 |
| 18 | Claude操控图 | curl → POST /graph API |
| 19 | finalReport | Claude 通过 /graph/update 写入节点 |
| 20 | 视觉效果 | 游标动画+箭头等后面单做 |

---

## 七、不做的东西（明确边界）

| 不做 | 原因 |
|------|------|
| 跨会话持久化 | 用户明确：会话结束释放 |
| 多CLI并行泳道 | 先跑通单CLI，架构预留 session_id |
| 复杂边类型（因果/依赖/分解） | 用户说"没那么高深莫测的需求" |
| AI 创意发散式生长 | 不搞 AI 自创节点 |
| Electron 桌面壳 | 浏览器够用，之前装不上 |
| 换渲染引擎（Cytoscape/VueFlow） | ECharts 链式布局够用，不影响核心功能 |
| 移动端/手机通知 | 需求范围外 |
| 智能完成判定（LLM 判断） | Phase 3 先用简单规则，LLM 判定以后再说 |
| 节点拖拽 / 自由布局 | 链式自动布局，手动布局不是重点 |

---

## 七、风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| PreToolUse hook 阻塞超时 | Claude Code 卡住 | 30s 超时 → 自动 allow，hook 不过度阻塞 |
| Claude 判断节点位置不准 | 游标错位 | 允许 Claude 显式修正 `/brainmap move` |
| 灰色链 + 普通链颜色混淆 | 视觉混乱 | 测试阶段发现就调 |
| 大量节点 ECharts 卡顿 | 图不可用 | Phase 4 修剪上限，80 节点内 |
| Hook stdout JSON 解析失败 | 注入失败 | Hook 脚本容错，失败不阻塞 Claude |
