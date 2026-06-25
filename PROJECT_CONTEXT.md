# Brain Map — 活体项目认知地图

## 原始需求（用户原话，2026-06-11）

> 首先我们这个东西要进行1个大的这样的转变了，第1个东西就是我要做的这个呃我姑且将其称之为脑图吧，大概就是我有时候会发散出1些灵感然后呢我需要比如说有3个主题每个主题会向外发散出按照逻辑联系关系地图关系向外向外延展出大概要达到的小目标或者是应该做什么东西，然后这个东西呢最好是可以桌面画，详情参考我的那个小猪宠"E:\for claude\Clawd Companion\Clawd Companion.exe"，然后呢就首先在功能上这个脑图在我自己写好以后呢它得能够自我生长和修剪，而它的生长与修剪基是基于对应逻辑以及任务完成，草包转移上来讲它是1种地图从某种意义上来讲它是1种地图，至于它的修剪与生长他们这1上又需要cloud code被其进行监控，就我现在所看到的小周虫在某种意义上已经达到这种效果它是用hook注入但是它的hook写得很好达到了很好的效果能够实打实的交互所以我不知道能不能达到对应的效果短短期时间内那我需要这个脑图需要这个可以监视整个项目的地图以及我脑内想法的东西，至于某些关键节点我要求它能够让我直接点击这个节点进行需求补充我想这步呢。

### 需求精准化（经讨论提炼）

| # | 特征 | 精准化表述 |
|---|------|-----------|
| 1 | 发散式脑图结构 | 以主题为根节点的有向图，节点=目标/任务/想法，边=逻辑关系（因果、依赖、分解） |
| 2 | 自我生长 | AI代理根据规则自动创建新节点：任务拆解出新子任务、灵感关联出相关概念、项目文件变化触发图更新 |
| 3 | 自我修剪 | 完成的任务节点自动标记/折叠/归档；不再相关的死枝被检测并移除；图的复杂度自适应 |
| 4 | Claude Code Hook监控 | 通过Claude Code的Hook系统（SessionStart/PostToolUse/Stop等事件）实时感知项目状态，驱动图的生长与修剪 |
| 5 | 可交互节点 | 每个节点是可操作的UI元素：点击→补充细节/标注状态/手动拆解/发起Claude对话 |

---

## 技术方案演进

### 1. 最初讨论 — 概念探索
- 调研了 Xmind、Obsidian Graph、Whimsical MCP、Graphiti 等现有工具
- 结论：没有现成的"AI自演化个人项目认知地图"
- 最接近的开源项目：Understand Anything（55k★，代码库→知识图谱，但不适用个人规划）

### 2. 渲染方案选型
- 决定用 ECharts（已安装在 pv-station-admin 项目）
- 放弃 VueFlow（用户之前使用不满意）
- 纯 SVG + 手写力模拟 和 D3-force 作为备选方案
- 测试文件：`D:\photovoltaic\pv-station-admin\src\views\组件测试\BrainMap-力导向图-多方案对比.vue`

### 3. 从力导向图 → 链式结构（用户关键决策）
用户要求改成像区块链那样的链式结构：
> "改成1条有点像那种区块链的那种链式结构然后会有分支，你先改成改成这样子的东西我就知道说哪个东西是主链我们进行到哪个部分了"

### 4. 独立桌面App — 最终架构

```
Claude Code Hook 事件
  │
  ├─ settings.json (6个事件全部注册)
  │
  └─ node hook-forwarder.js (stdin ← JSON)
       │
       └─ HTTP POST /events ──→ server.cjs (port 47635)
                                    │
                                    ├─ SSE 实时推送 ──→ 浏览器 (ECharts)
                                    │
                                    └─ brain-map-state.json (持久化)
```

### 5. 放弃 Electron，改用 Node HTTP + 浏览器
- Electron 二进制下载被墙
- 改用 server.cjs + 浏览器打开，效果等价

### 6. 数据结构重构 — 链式树模型（2026-06-12 第6次会话）
核心发现：`chain[]` + `links[]` + `nodes[]` 三套数据描述同一件事，三个路口各自写入，不一致就崩。

**新模型：单一树结构**
```
每个节点自带:
  children[]    — 所有子节点（链上子节点 + 分支子节点）
  nextInChain   — 链上下一个节点的 id（null 表示链尾）

chain[] 和 links[] 由 deriveState() 从树推导，不再手动维护
```

写入路径：
- `linkAsChain(parent, child)` → 设 parent.nextInChain + push children（唯一入口）
- `linkAsBranch(parent, child)` → push children（唯一入口）
- action 找不到父 goal → 不创建节点，永不进链

---

## 文件清单

| 文件 | 作用 |
|------|------|
| `D:/scripts/brain-map/server.cjs` | HTTP 服务器 + 事件处理 + 状态管理 + SSE 推送 |
| `D:/scripts/brain-map/renderer/index.html` | ECharts 链式图渲染 |
| `D:/scripts/brain-map/hook-forwarder.js` | Claude Code Hook 转发器（stdin→HTTP） |
| `D:/scripts/brain-map/brain-map-state.json` | 图状态持久化（自动保存） |
| `C:\Users\16707\.claude\settings.json` | Hook 注册（6个事件） |

---

## 已实现的功能

### Hook 事件 → 图行为

| Claude Code 事件 | 图的行为 |
|------------------|---------|
| `SessionStart` | 创建根节点，自动启动服务器 |
| `UserPromptSubmit` | 创建 goal 节点，加入主链 |
| `PreToolUse` | 创建 action 节点，挂在对应 goal 下（分支） |
| `PostToolUse` | action 节点 → done |
| `Stop` | 活跃节点 → done，搁置节点保持 shelved |
| `Notification` | 不处理（Clawd Companion 负责） |

### 四规则任务关联（第一层方法论）

| 规则 | 权重 | 说明 |
|------|------|------|
| 关键词/2-gram 重叠 | 0.5 + 0.3 | 任务线名与 prompt 的字面重叠 |
| 文件邻近 | 0.4 + 0.3 | 同目录/同文件 → 同任务线 |
| 时间窗口（30分钟） | 0.2 * (1 - elapsed/30min) | 越近分数越高 |
| 显式信号（"继续"等） | 0.3 | prompt 以 继续/接着/然后/下一步 开头 |

阈值：总分 < 0.25 → 新建任务线

### 节点状态

| 状态 | 视觉 | 触发条件 |
|------|------|---------|
| `active` | 白边框高亮 | 当前正在进行的节点 |
| `done` | 暗色+✓ | 工具完成 / Stop 事件 |
| `shelved` | 虚线边框+半透 | 切换到其他任务线时被搁置 |

### 镜头追踪
- 自动追踪最后 4 个主链节点
- 最新节点在视野 65% 位置
- 旧节点自然滚出左边视野
- 支持手动缩放（滚轮），不可拖拽

---

## 待讨论/未完成

### ⚠️ CLI 实际忽视计划链（2026-06-18 确认）
- **现象**：实际运行中，Claude Code 在对话里**不会主动**创建计划链节点或遵循计划链规则
- **根因**：
  1. Claude 不知道自己的 sessionId → 调 `/graph` 时可能写到别的 CLI 的链
  2. 没有明确的触发机制让 Claude 知道"现在该建计划链了"
  3. 计划链的创建依赖 Claude **主动**调 `/graph` API，但 Claude 默认不会这样做
  4. hook 层只负责记录（prompt→goal），不负责规划（goal→plan chain）
- **当前缓解**：`graph-helper.cjs` 已提供，Claude 可通过 `node D:/scripts/brain-map/graph-helper.cjs '...'` 安全写计划链
- **长期方向**：需要设计一套机制让 Claude **自动**在合适时机创建/更新计划链
  - 方案A: Skill 封装 — 用户说"写计划"时调用 skill 自动建链
  - 方案B: Hook 增强 — PreToolUse 时检查 prompt 是否含计划关键词，自动调 /graph
  - 方案C: Claude 训练 — 在 system prompt 里注入计划链创建规则
- **暂不修改**，先记录

### 第二层方法论：主链 vs 分支判定
- **现状**：prompt → goal → 主链，tool → action → 分支
- **问题**："查一下API文档"和"重构关联逻辑"目前都在主链上
- **可选方案**：
  - A. 关键词规则（hook层判断"做"vs"查"）
  - B. Claude 主动告诉脑图（通过 /graph API）
  - C. 用户手动标记

### 第三层方法论：变灰逻辑细化
- **现状**：切换任务线→搁置，Stop→done，PostToolUse→done
- **问题**：什么情况下一个目标算"真正完成"？是否所有子工具完成=目标完成？

### 节点点击交互
- 点击节点 → 补充需求/展开子任务
- 需要双向通信（浏览器 → Claude Code）

### Claude 主动操控图
- `/graph` API 已留好
- Claude 可以根据上下文直接修改图数据

### ⚠️ Plan Mode 与脑图计划链未打通
- **现状**：Claude Code 内置 `EnterPlanMode` 把计划写入 `~/.claude/plans/*.md`，但不同步到脑图 `/graph` API
- **结果**：Claude 跑完 plan mode 写了 md 文件，脑图里看不到计划链节点，用户无法在可视化界面上追踪
- **期望**：EnterPlanMode 或 Claude 在做计划时，自动 `POST /graph` 把计划步骤建到脑图主链上（planMode: true, asChain: true）
- **暂定方案**：后续统一调整，可能通过 hook 或 skill 实现 PlanMode → 脑图自动同步

### ⚠️ 计划执行中的小请求无法作为子节点
- **现状**：计划链执行过程中，用户提出的零散小要求（如"把这个记到文档里""顺便改一下XX"）会作为独立 prompt 触发 `UserPromptSubmit` hook，被创建为新的链上 goal 节点，打断计划链
- **期望**：执行计划节点期间的小请求，应自动挂到当前活跃的计划节点下面作为 `action` 或 `sub-goal`（children），而不是抢占主链
- **问题根源**：hook 层只管 `prompt → goal → 主链`，没有感知"当前是否有一个活跃的计划节点正在执行中"。需要一套主节点/子节点判定逻辑
- **暂定方案**：后续优化主链/分支判定规则，计划节点激活期间的小请求自动降级为子节点

---

## 长远需求（当前需求跑通后再做）

### 多 CLI 并行 — 多条链同时运行
**用户原话**：*"我可能会同时开多个 claude cli，这就意味着是多条链并行运行了，到时候你怎么分辨"*

**核心挑战**：
- 每个 CLI 窗口是一个独立的 Claude Code 会话（独立 session_id）
- 各自有各自的任务线和主链
- 脑图需要同时展示多条并行链
- Hook 事件需要按 session_id 分流到对应链

**需要讨论的问题**：
1. **数据模型**：每条链是独立实例，还是一个统一大图？多条链之间是否允许交叉连接？
2. **session 识别**：Hook 事件自带 `session_id`，当前只追踪最后一个。需要改为按 session_id 分组
3. **可视化**：多链同屏 = 多个平行的链式结构？用颜色区分的独立泳道（swimlane）？
4. **会话生命周期**：CLI 窗口关闭 ≠ 链消失。链应该持久化，可以随时恢复
5. **端口**：多个 CLI 共享一个 server（47635），还是每个 CLI 一个端口？

**可能的方向**：
```
会话1（pv-station-admin）: [root]→[A1]→[A2]→[A3]   ← 蓝色泳道
会话2（brain-map）:       [root]→[B1]→[B2]         ← 绿色泳道
会话3（邮件管线）:         [root]→[C1]→[C2]→[C3]→[C4] ← 黄色泳道
```

### 计划经济 — 开篇预设目标步骤
**用户原话**：*"开篇先设置好后面大概多少步要达到什么目标，你这个又该如何书写"*

**核心挑战**：
- 会话开始前就规划好目标路线图
- 每一步是一个预定义的检查点（milestone）
- 实际执行与计划对照，偏离时高亮警告
- 计划格式要 Claude 能读懂，人也能手写

**需要讨论的问题**：
1. **计划格式**：JSON？Markdown checklist？YAML？什么格式最易书写和解析？
2. **计划粒(yù)度**：每步是"一个 goal 节点"还是"一个任务线"？
3. **计划与实际的关系**：计划节点是"占位符"，实际执行后填充？还是计划永远只是参考线？
4. **偏差检测**：实际偏离计划时如何提示？是视觉标记还是主动通知？
5. **计划的来源**：人手写？Claude 生成？从 task-sync.json 导入？

**可能的格式草图**：
```markdown
## 计划: 脑图项目 v0.2
1. [ ] 主链/分支判定逻辑 → 预期2步
2. [ ] 变灰逻辑细化 → 预期3步  
3. [ ] 节点点击交互 → 预期4步
4. [ ] Claude主动操控图 → 预期2步
```

---

## 运行方式

```bash
# 手动启动
node D:/scripts/brain-map/server.cjs

# 浏览器访问
http://127.0.0.1:47635

# 重置状态
curl -X POST http://127.0.0.1:47635/reset
```

自动启动：SessionStart Hook 会自动拉起服务器。

---

## 会话记录

### 2026-06-11（第1次）
- 用户提出模糊需求
- 搜索调研现有方案
- 精准化需求为5个核心特征
- 讨论9个延展问题

### 2026-06-11（第2次）
- 确定独立App方案
- 探索 Clawd Companion 的 Hook 架构（6事件，HTTP通信模式）
- 确定技术栈：Node HTTP + ECharts + SSE
- 创建 brain-map 项目骨架
- 安装 Electron 失败，切换为 Node HTTP + 浏览器方案
- Hook 注册到 settings.json
- 完整链路跑通

### 2026-06-11（第3次）
- 用户要求链式结构（像区块链，主链+分支）
- 改为手动布局（CHAIN_X, BRANCH_GAP）
- 镜头自动追踪主链前沿
- 四规则任务关联实现
- 搁置/完成/活跃三态视觉

### 2026-06-12（第4次）
- 搜索"任务关联方法论"→ 没有现成方案，但可借鉴 CPM + TDG + 事件驱动状态机
- 提出三层方法论框架：关联判定 → 主链/分支 → 变灰
- 实现四规则关联评分算法
- 字体大小和可读性调整（暂未完全解决）
- 创建本文件（PROJECT_CONTEXT.md）
- 记录长远需求：多CLI并行链 + 计划经济预设目标

### 2026-06-12（第5次）
- 清空旧测试数据，重置 state.json
- 修复 Bug #1：tool_start 的 action 无父节点时被 `addToChain` 塞进链首 → 导致链首是孤儿 action，后续 root 遍历不到
  - 修法：action 找不到父 goal 不创建节点，永不进链（server.cjs 第249行）
- 修复 Bug #2：tool_end 用 `[...S.nodes].reverse().find(...)` 取"最近 active action"→ 并发工具会标错节点
  - 修法：tool_start 记录 `meta.currentActionId`，tool_end 用它精确定位
- 修复 Bug #3：渲染器孤儿节点用 `Math.random()` 散落 → 视觉效果变成非链式
  - 修法：按 taskLine 分组堆叠在泳道下方
- 修复 touchFile 记入假路径（//127.0.0.1/health、/dev/null 等）→ 加 `isValidPath` 校验
- 修剪时同步清理无节点引用的 taskLines

### 2026-06-12（第6次）
- 揭示根因：三套数据（chain[]/links[]/nodes[]）描述同一件事，写入不一致导致所有 bug
- **数据结构重构**：改为单一树模型 — 每个节点自带 `children[]` + `nextInChain`
  - 移除 `addToChain()`、`getChainIndex()`、手动的 `S.links.push()`
  - 替换为 `linkAsChain()`、`linkAsBranch()`、`deriveState()`
  - chain[] 和 links[] 从树推导，不再手动维护
- 渲染器：多 root 泳道 → chain[0] 为单一布局根，孤儿按 taskLine 分组堆叠
- 调研 EventStoreDB/DAG/ArangoDB 等重型方案 → 结论：800行项目不需要，树模型足够
- **重要教训**：上下文丢失导致之前精心设计的工作模式崩盘 → 需求文档必须在编码前完整写好（见 CLAUDE.md 补充规则）

### 2026-06-14~15（第7次）— v2 Phase 1 完成
- 完整需求讨论 → 技术方案 → 分期实现
- **工作流**：讨论需求 → 写TECHNICAL_PLAN.md → 确认方案 → 分期落地 → 测试验证 → git备份
- **数据模型**：基于v1树模型扩展，加游标(S.meta.cursor)、planMode、planRoots、notes/result/successCriteria/audited等字段
- **游标系统**：S.meta.cursor指针，自动随prompt_submit移动，Hook注入±3节点上下文
- **计划经济**：prompt含"计划/步骤/路线"→建灰色链(planMode:true,#666虚线)；游标激活→变亮+黄框；done→任务线色+半透明；failed→红框
- **planRoots**：方案A(轻量数组)，支持多条平行计划链，currentPlanIndex逐条推进
- **/graph API**：create-node/delete-node/update-node/move-cursor/mark-done/mark-failed + auditRequest/auditResponse阻塞端点
- **审计系统**：浏览器toggle开关(默认关)，开→PreToolUse阻塞+SSE+Modal→用户确认→回传；30s超时自动拒绝
- **防死循环**：3次失败标红+finalReport；2备选方案均失败→人工介入
- **归档**：有价值节点→D:/docs/brain-map-archive.jsonl (JSONL追加)
- **文件变更**：server.cjs(+300行)、hook-forwarder.js(重写)、renderer/index.html(重写)、settings.json(+SessionEnd,超时调整)
- **测试**：test-cursor.js(游标匹配)、test-init.cjs(初始化)、test-demo.cjs(全流程8项)
- **计划链颜色表**（见BrainMap-计划链生命周期演示.vue）：灰色虚线(pending)→亮色白边+黄框(游标激活)→彩色(执行中action)→半透+✓(done)→红框+✗(failed)
- **待完成**：倒计时自动递进(已讨论方案，未代码化)、平行泳道渲染、审计弹窗真实触发验证

### 2026-06-17~18（第9次）— v2.2 多CLI修缮 + 渲染增强
- **多CLI架构完工**：session_id 路由验证通过，每个 CLI 窗口独立泳道
- **致命bug修复**：Stop事件每次Claude响应完就触发→误调/cleanup删session→已移除
- **代码审计**：移除 CURRENT_STATE_FILE/cwd参数/saveSession 等死代码
- **渲染增强**：attempt徽章(左下)+失败警告红点(左上脉冲)+hover浮窗预览attempts列表
- **graph-helper.cjs**：Claude安全写计划链的辅助脚本，自动根据cwd匹配session
- **测试组件**：ChainBranch-ABCD.vue, DashboardView.vue, HoverDashboard.vue
- **确认问题**：CLI实际使用中忽视计划链，Claude不会主动创建计划链节点（记录在案，暂不修改）
- **教训**：cwd注册表在同目录多窗口下导致session数据污染，已彻底移除
- **重要修复**：hook-forwarder审计状态读取兼容新旧/state格式

### 2026-06-16（第8次）— ETT-mobile v2.0 改造实战，暴露两个问题

#### Bug #4：curl POST /graph 中文节点名乱码
- **现象**：通过 curl 调用 `/graph` API 创建计划节点（P0~P5），节点名中的中文字符在脑图渲染时显示为乱码（如 `P0: ������ʾ���ع�`）
- **根因未确定**，可能原因：
  - curl 在 Git Bash 下发送 JSON 时 Content-Type 未声明 charset=utf-8
  - Windows 终端编码（GBK）与 UTF-8 不匹配，curl 读取参数时已损坏
  - server.cjs 的 JSON 解析未做编码处理
- **临时方案**：下次用 Node.js 脚本发 /graph 请求（绕过 shell 编码层），或直接在 js 里 `require('http').request` 发 UTF-8
- **后续**：用户说会统一修，先记在这里

#### 工作流缺口：讨论阶段没有实时创建计划节点
- **现象**：本次会话完整走了一遍"讨论需求→确认方案→执行"，但讨论阶段（"你有没有发现一个问题..."→"好的"）产生的节点都是 hook 自动创建的普通 goal 节点（带颜色），不是灰色计划节点。直到用户问"计划链呢？"才手动 POST /graph 补建了 P0~P5 灰色链。
- **对比方法论要求**：蓝图先行工作流规定"讨论需求→逐条确认→拆成目标节点→写TECHNICAL_PLAN.md"。按这个流程，讨论阶段每确定一个目标就应该实时创建对应的计划节点，而不是讨论完再补。
- **根因**：
  1. 技术上：hook 的 `UserPromptSubmit` 事件只能创建普通 goal，无法判断当前是否在"计划讨论中"从而自动打 `planMode: true`
  2. 行为上：Claude 没有主动在讨论过程中调 `/graph` API 建计划节点，而是等用户催促才补
- **改进方向**：
  - Claude 侧：当用户明确表达"先讨论方案"时，应主动在讨论过程中用 `/graph` 把确认下来的目标实时建成灰色计划节点
  - 脑图侧：可能需要一个"进入计划模式"的标记，让 hook 知道这段时间创建的节点应该打 `planMode: true`
- **与已有文档的关联**：[[#⚠️ Plan Mode 与脑图计划链未打通]] 已记录了技术层面的问题，本例是同一问题在实际使用中的具体表现
- **重要经验**：本次工作流(需求讨论→方案文档→分期→测试→git)执行满意，考虑封装为Skill

### 2026-06-25（第10次）— v2.3 节点审计系统

#### 新增功能

**1. mark-done 验证约束**
- `mark-done` 必须携带 `verified:true` + `evidence`(验证证据) + `checks`(验证项列表)
- 不带验证数据直接拒绝：`{"ok":false,"error":"需要 verified:true + evidence + checks"}`
- 验证证据存储到节点：`node.evidence` / `node.checks` / `node.attempts`
- 每次 mark-done 追加一条 attempt 记录(approach/verdict/evidence/checks)

**2. 节点审计开关**
- 浏览器顶栏新增双开关：`Tool审计`(原有PreToolUse阻塞) + `节点审计`(新增)
- 节点审计开→mark-done变为`pending_audit`状态，须人工approve/reject
- 节点审计关→mark-done直接`done`
- 开关状态持久化到`.audit-config.json`，重启恢复
- 实现：全局变量`_nodeAuditEnabled`(绕过session meta同步问题)
- ⚠️ 已知问题：`sessions.forEach`设置session.meta后S变量不同步，改用全局变量

**3. audit-approve / audit-reject 端点**
- `POST /graph {"op":"audit-approve","nodeId":"xxx","note":"人工审计通过"}`
  - 必须`pending_audit`状态才能approve
  - 通过后：`status=done`, `auditedBy=human`, `result.outcome=success`
  - 广播SSE事件`audit_approved`
- `POST /graph {"op":"audit-reject","nodeId":"xxx","reason":"驳回原因","note":"备注"}`
  - 驳回后：`status=active`, `auditedBy=human`, `result.outcome=rejected`, `result.rejectReason=原因`
  - 记录failed attempt到`node.attempts`
  - 广播SSE事件`audit_rejected`

**4. mark-failed attempt记录**
- `mark-failed`自动记录失败尝试：approach/verdict='failed'/reason/time

**5. Renderer 增强**
- `pending_audit`珠子：黄色虚线脉冲动画(`plan-pending-audit` CSS class)
- Report弹窗：底部显示`✅通过`/`❌驳回`按钮(仅pending_audit状态)
- 通过/驳回按钮携带`sessionId`参数
- `nodeAuditEnabled`从state同步(页面加载+SSE更新)
- Countdown overlay已禁用(`v-if="false"`,多链暂时不用)
- evidence/checks展示在hover浮窗和report弹窗

**6. 辅助脚本**
- `check-audit-status.cjs`：查询所有session的rejected/pendingAudit/activePlan节点，Claude可主动调用检测驳回
- `watch-audit.cjs`：SSE监听器，审计事件写入`.audit-events.jsonl`通知文件
- `graph-helper.cjs`：复用现有脚本，mark-done支持verified/evidence/checks/approach参数

#### 未达到的效果

**1. Claude自动感知驳回(半完成)**
- ✅ Claude可主动调用`check-audit-status.cjs`检测驳回
- ✅ SSE广播`audit_rejected`事件
- ❌ Claude不会自动响应驳回，需要用户手动告知或Claude主动检查
- ❌ 无法达到小桌宠那种"点了立即有反应"的实时干预
- **原因**：脑图→Claude Code的通信只有Hook系统(单向:CC→脑图)，缺少反向通道

**2. Session管理混乱(未修复)**
- `S`变量(模块级)到处被覆盖，sessionId传递不一致
- graph-helper通过cwd匹配session，同目录多窗口时可能写错session
- 多次testkill重启导致节点丢失
- 两个session(default vs 25741e7c)节点创建位置不可预测
- **根因**：JSON文件+Map+S变量三套数据，写入路径不一致

**3. SQLite迁移(放弃)**
- 尝试将存储从JSON迁移到SQLite(better-sqlite3/sql.js)
- Windows原生编译失败，sql.js ESM/CJS兼容问题
- **结论**：脑图生命周期=一个Claude Code窗口，JSON文件足够，SQLite过度设计

**4. 审计闭环完整性(部分完成)**
- ✅ 驳回→attempt记录
- ✅ SSE广播
- ✅ Claude检测脚本
- ❌ Claude不会在无用户提示下自动读取驳回原因并重新提交
- ❌ 驳回后"补做缺失工作→重提"的闭环仍需人力驱动

#### 文件变更
- `server.cjs`：mark-done/mark-failed/audit-approve/audit-reject handler
- `renderer/index.html`：双开关、pending_audit珠子、通过/驳回按钮、evidence展示
- `check-audit-status.cjs`：新增
- `watch-audit.cjs`：新增
- `.audit-config.json`：新增(节点审计开关持久化)
- `_废弃/旧脑图状态/`：38个旧session state文件移入

#### 存储清理
- 清理前：40+ state JSON文件, ~700KB
- 清理后：2个活跃文件(25741e7c+default), 62KB
- 旧文件移入`_废弃/旧脑图状态/`
