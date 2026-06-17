// Brain Map v2 — 游标驱动链式模型 + 计划经济
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = parseInt(process.env.BRAIN_MAP_PORT || '47635')
const ARCHIVE_FILE = 'D:/docs/brain-map-archive.jsonl'
const STATE_DIR = __dirname

const TASK_LINE_COLORS = [
  '#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#fc8452','#9a60b4','#ea7ccc'
]

function stateFile(sessionId) {
  const safe = (sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40)
  return path.join(STATE_DIR, `brain-map-state-${safe}.json`)
}

function defaultState() {
  return { nodes: [], links: [], taskLines: {}, chain: [], planRoots: [], meta: { auditEnabled: false, planMode: false, currentPlanIndex: 0 } }
}

// 当前活跃 session 的快捷引用（每次 handleEvent/handleGraphAction 会更新）
let S = defaultState()

function save(state) {
  const target = state || S
  if (target._stateFile) {
    target.meta.lastUpdate = new Date().toISOString()
    fs.writeFileSync(target._stateFile, JSON.stringify(target, null, 2))
  }
}

// ============ 多会话管理 ============
const sessions = new Map()  // sessionId → State

function getOrCreateSession(sessionId) {
  if (!sessionId || sessionId === 'unknown') sessionId = 'default'

  if (sessions.has(sessionId)) return sessions.get(sessionId)

  const file = stateFile(sessionId)
  let state
  try {
    if (fs.existsSync(file)) {
      state = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!state.taskLines) state.taskLines = {}
      if (!state.chain) state.chain = []
      if (!state.planRoots) state.planRoots = []
      if (!state.meta) state.meta = {}
      if (!state.meta.cursor) state.meta.cursor = null
    } else {
      state = defaultState()
    }
  } catch(e) { state = defaultState() }

  // A1 修复: 确保已加载的状态有 root 节点
  if (!state.nodes.find(n => n.type === 'root')) {
    const rootId = 'root-' + Date.now()
    state.nodes.push(newNode(rootId, { name:'会话开始', type:'root', taskLine:'__root__',
      symbolSize:48, status:'done', createdAt: new Date().toISOString() }))
    if (!state.taskLines['__root__']) state.taskLines['__root__'] = { name:'会话', color:'#888' }
  }
  if (!state.meta.cursor) {
    state.meta.cursor = state.nodes.find(n => n.type === 'root')?.id || state.nodes[0]?.id || null
  }
  if (!state.planRoots) state.planRoots = []

  state._stateFile = file
  state._sessionId = sessionId
  sessions.set(sessionId, state)
  return state
}

function getMultiView() {
  const sessionList = []
  for (const [sid, state] of sessions) {
    sessionList.push({
      sessionId: sid,
      nodes: state.nodes,
      links: state.links,
      chain: state.chain,
      planRoots: state.planRoots,
      taskLines: state.taskLines,
      meta: state.meta
    })
  }
  if (sessionList.length === 0) {
    // fallback: 用当前 S
    sessionList.push({
      sessionId: S._sessionId || 'default',
      nodes: S.nodes,
      links: S.links,
      chain: S.chain,
      planRoots: S.planRoots,
      taskLines: S.taskLines,
      meta: S.meta
    })
  }
  return { sessions: sessionList, multiSession: true }
}

// ============ 任务线管理 ============
const TIME_WINDOW_MS = 30 * 60 * 1000
const MIN_SCORE_NEW_LINE = 0.25

function getOrCreateTaskLine(name) {
  const key = name.replace(/\s+/g,'').substring(0,20)
  if (S.taskLines[key]) return key
  const idx = Object.keys(S.taskLines).length % TASK_LINE_COLORS.length
  S.taskLines[key] = {
    name: name.length > 18 ? name.substring(0,16)+'…' : name,
    color: TASK_LINE_COLORS[idx],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    filesTouched: [],
    dirsTouched: [],
    promptCount: 1
  }
  return key
}

// ============ 四规则关联评分 ============
function scoreTaskLine(tlKey, prompt, filePath) {
  const tl = S.taskLines[tlKey]
  if (!tl || tlKey === '__root__') return 0
  let score = 0

  if (prompt) {
    const tlName = tl.name
    if (prompt.includes(tlName) || tlName.includes(prompt.substring(0, Math.min(6, prompt.length)))) {
      score += 0.5
    }
    const bigrams = s => { const r=new Set(); for(let i=0;i<s.length-1;i++)r.add(s.substring(i,i+2)); return r }
    const a = bigrams(prompt), b = bigrams(tlName)
    let overlap = 0; a.forEach(g => { if (b.has(g)) overlap++ })
    const maxLen = Math.max(a.size, b.size) || 1
    score += 0.3 * (overlap / maxLen)
  }

  if (filePath) {
    const dir = filePath.replace(/[/\\][^/\\]*$/, '').toLowerCase()
    const fileName = filePath.split(/[/\\]/).pop().toLowerCase()
    if (tl.dirsTouched && tl.dirsTouched.some(d => d.toLowerCase() === dir)) score += 0.4
    if (tl.filesTouched && tl.filesTouched.some(f => f.toLowerCase() === fileName)) score += 0.3
  }

  if (tl.lastActiveAt) {
    const elapsed = Date.now() - new Date(tl.lastActiveAt).getTime()
    if (elapsed < TIME_WINDOW_MS) score += 0.2 * (1 - elapsed / TIME_WINDOW_MS)
  }

  if (prompt && /^(继续|接着|然后|下一步|好了|ok|next)/i.test(prompt.trim())) score += 0.3

  return score
}

function findBestTaskLine(prompt, filePath) {
  let bestKey = null, bestScore = MIN_SCORE_NEW_LINE
  for (const k of Object.keys(S.taskLines)) {
    if (k === '__root__') continue
    const s = scoreTaskLine(k, prompt, filePath)
    if (s > bestScore) { bestScore = s; bestKey = k }
  }
  return bestKey
}

function isValidPath(p) {
  if (!p || p === 'null') return false
  if (/^\/\//.test(p)) return false
  if (/^\/dev\//.test(p)) return false
  if (/^\/proc\//.test(p)) return false
  return true
}

function touchFile(tlKey, filePath) {
  const tl = S.taskLines[tlKey]
  if (!tl || !filePath) return
  if (!isValidPath(filePath)) return
  if (!tl.filesTouched) tl.filesTouched = []
  if (!tl.dirsTouched) tl.dirsTouched = []
  const fileName = filePath.split(/[/\\]/).pop()
  const dir = filePath.replace(/[/\\][^/\\]*$/, '')
  if (!tl.filesTouched.includes(fileName)) tl.filesTouched.push(fileName)
  if (!tl.dirsTouched.includes(dir)) tl.dirsTouched.push(dir)
  if (tl.filesTouched.length > 10) tl.filesTouched = tl.filesTouched.slice(-10)
  if (tl.dirsTouched.length > 10) tl.dirsTouched = tl.dirsTouched.slice(-10)
  tl.lastActiveAt = new Date().toISOString()
}

function activateTaskLine(tlKey) {
  const tl = S.taskLines[tlKey]
  if (!tl) return
  tl.lastActiveAt = new Date().toISOString()
  tl.promptCount = (tl.promptCount || 0) + 1
}

// ============ 树结构操作 ============
function newNode(id, data) {
  return Object.assign({ id, children: [], nextInChain: null, planMode: false, notes: '', successCriteria: '', result: null, pinned: false, tags: [], audited: false, updatedAt: new Date().toISOString() }, data)
}

function linkAsChain(parent, child) {
  if (!parent.children.includes(child.id)) parent.children.push(child.id)
  parent.nextInChain = child.id
}

function linkAsBranch(parent, child) {
  if (!parent.children.includes(child.id)) parent.children.push(child.id)
}

function deriveChain() {
  S.chain = []
  const root = S.nodes.find(n => n.type === 'root')
  let cur = root, depth = 0
  while (cur && depth < 200) {
    S.chain.push(cur.id)
    cur = cur.nextInChain ? S.nodes.find(n => n.id === cur.nextInChain) : null
    depth++
  }
}

function deriveLinks() {
  S.links = []
  S.nodes.forEach(n => {
    (n.children || []).forEach(cid => {
      S.links.push({ source: n.id, target: cid, isMain: n.nextInChain === cid })
    })
  })
}

function deriveState() { deriveChain(); deriveLinks() }

// ============ 游标系统 ============
function getChainIndexOf(cursorId) {
  return S.chain.indexOf(cursorId)
}

function getContextWindow(cursorId, radius) {
  radius = radius || 3
  const idx = getChainIndexOf(cursorId)
  let windowIds
  if (idx === -1) {
    windowIds = S.chain.slice(0, radius * 2)
  } else {
    const start = Math.max(0, idx - radius)
    const end = Math.min(S.chain.length, idx + radius + 1)
    windowIds = S.chain.slice(start, end)
  }
  return windowIds.map(id => S.nodes.find(n => n.id === id)).filter(Boolean)
}

function formatContext(windowNodes, cursorId) {
  // 压缩格式：1行概览 + 1行游标详情
  const icons = { done: '✓', active: '▶', shelved: '⊘', failed: '✗' }
  const overview = windowNodes.map(n => {
    const icon = icons[n.status] || '⏳'
    const marker = n.id === cursorId ? '▶' : ''
    return `${icon}${n.name}${marker}`
  }).join('  ')

  const cursorNode = windowNodes.find(n => n.id === cursorId)
  let detail = ''
  if (cursorNode) {
    detail = `\n[脑图] 游标: ${cursorNode.name}`
    if (cursorNode.notes) detail += ` | 备注: ${cursorNode.notes}`
    if (cursorNode.successCriteria) detail += ` | 成功标准: ${cursorNode.successCriteria}`
    if (cursorNode.status === 'failed' && cursorNode.result) {
      detail += ` | ⚠️失败: ${cursorNode.result.summary || '未记录原因'}`
    }
    // 检查是否有节点需要人工介入
    if (cursorNode.result && cursorNode.result.attempts && cursorNode.result.attempts.length >= 3) {
      detail += ` | 🆘 需人工介入`
    }
  }

  return `[脑图] 链: ${overview}${detail}`
}

function hasStalledNode(windowNodes) {
  return windowNodes.some(n => n.status === 'failed' && n.result && n.result.attempts && n.result.attempts.length >= 3)
}

// ============ 防死循环 ============
function checkDeadLoop(goalNode) {
  if (!goalNode || goalNode.type !== 'goal') return false
  const attempts = goalNode.result?.attempts || []
  if (attempts.length >= 3) {
    // 3次失败 → 标红需人工介入
    goalNode.status = 'failed'
    if (!goalNode.result) goalNode.result = {}
    goalNode.result.outcome = 'failure'
    goalNode.result.summary = goalNode.result.summary || '3次尝试均失败，需人工介入'
    return true
  }
  // 检查备选方案
  const altNodes = S.nodes.filter(n => n.branchOf === goalNode.id && n.planMode)
  if (altNodes.length >= 2 && altNodes.every(n => n.status === 'failed')) {
    goalNode.status = 'failed'
    if (!goalNode.result) goalNode.result = {}
    goalNode.result.outcome = 'failure'
    goalNode.result.summary = '2个备选方案均失败，需人工介入'
    return true
  }
  return false
}

// ============ SSE ============
const clients = []
function broadcast(evt, data) {
  const msg = `event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`
  clients.forEach(r => { try { r.write(msg) } catch(e) {} })
}

// ============ 事件处理 ============
function handleEvent(evt) {
  // 多会话路由: cwd 映射保证同目录事件进同一条链
  const sessionId = evt.sessionId || 'default'
  S = getOrCreateSession(sessionId)
  const now = new Date().toISOString()

  switch (evt.type) {

    case 'session_start': {
      const id = 'root-' + Date.now()
      S.nodes.push(newNode(id, { name:'会话开始', type:'root', taskLine:'__root__',
        symbolSize:48, status:'active', createdAt:now }))
      if (!S.taskLines['__root__']) S.taskLines['__root__'] = { name:'会话', color:'#888' }
      // 初始化游标
      S.meta.cursor = id
      break
    }

    case 'prompt_submit': {
      if (!evt.title || evt.title === '收到新任务') break
      const text = evt.title
      const short = text.length > 20 ? text.substring(0,18)+'…' : text

      // 检测计划经济关键词
      const planKeywords = /计划|步骤|路线|提前规划|先写需求/
      const isPlan = planKeywords.test(text)
      if (isPlan) S.meta.planMode = true

      let tlKey = findBestTaskLine(text, null)
      if (!tlKey) {
        tlKey = getOrCreateTaskLine(text.substring(0,10))
      }
      activateTaskLine(tlKey)

      const prevTl = S.meta.activeTaskLine
      if (prevTl && prevTl !== tlKey && prevTl !== '__root__') {
        S.nodes.forEach(n => {
          if (n.taskLine === prevTl && n.status === 'active' && n.type !== 'root') {
            n.status = 'shelved'
          }
        })
      }
      S.meta.activeTaskLine = tlKey

      const id = 'goal-' + Date.now()
      const goal = newNode(id, { name:short, type:'goal', taskLine:tlKey,
        symbolSize:38, status:"active", fullText:text, createdAt:now,
        planMode: isPlan })
      S.nodes.push(goal)

      const lastChain = getLastChainNode()
      if (lastChain) {
        linkAsChain(lastChain, goal)
      }

      // 游标移到新 goal
      S.meta.cursor = id
      break
    }

    case 'tool_start': {
      const label = (evt.title || evt.toolName || '工具')
      const short = label.length > 25 ? label.substring(0,23)+'…' : label
      const filePath = evt.rawPayload?.tool_input?.file_path
        || evt.rawPayload?.tool_input?.command?.match(/(?:[A-Z]:[/\\][^\s]*|\/[^\s]*)/)?.[0]
        || null

      let tlKey = S.meta.activeTaskLine
      if (filePath) {
        const fileBest = findBestTaskLine(null, filePath)
        if (fileBest) tlKey = fileBest
      }
      if (!tlKey || tlKey === '__root__') tlKey = '__root__'

      touchFile(tlKey, filePath)
      activateTaskLine(tlKey)

      // A2 修复: 优先用游标定位父 goal，避免同 taskLine 多 goal 时找错
      let parent = null
      const cursorNode = S.meta.cursor && S.nodes.find(n => n.id === S.meta.cursor)
      if (cursorNode && cursorNode.type === 'goal') {
        parent = cursorNode
      } else {
        parent = [...S.nodes].reverse()
          .find(n => n.taskLine === tlKey && n.type === 'goal')
      }

      if (parent) {
        const id = 'action-' + Date.now()
        const action = newNode(id, { name:short, type:'action', taskLine:tlKey, toolName,
          symbolSize:28, status:"active", filePath, createdAt:now })
        S.nodes.push(action)
        linkAsBranch(parent, action)
        S.meta.currentActionId = id

        // 记录到父 goal 的 attempts
        if (parent.planMode) {
          if (!parent.result) parent.result = { attempts: [] }
          if (!parent.result.attempts) parent.result.attempts = []
          // 找到或创建当前方案
          let lastAttempt = parent.result.attempts[parent.result.attempts.length - 1]
          if (!lastAttempt || lastAttempt.verdict !== 'pending') {
            lastAttempt = { approach: '', actions: [], verdict: 'pending' }
            parent.result.attempts.push(lastAttempt)
          }
          lastAttempt.actions.push(id)
        }
      }
      break
    }

    case 'tool_end': {
      const currentId = S.meta.currentActionId
      const target = currentId && S.nodes.find(n => n.id === currentId && n.status === 'active')
      if (target) { target.status = 'done'; target.completedAt = now; S.meta.currentActionId = null }

      // 检查 action 的父 goal
      if (target) {
        const parentGoal = S.nodes.find(n => n.children && n.children.includes(target.id) && n.type === 'goal')
        if (parentGoal && parentGoal.planMode) {
          // 更新 attempts 的 verdict
          const attempts = parentGoal.result?.attempts
          if (attempts && attempts.length > 0) {
            const lastAttempt = attempts[attempts.length - 1]
            // tool_end 不自动判成功/失败 — Claude 审计时判
            lastAttempt.verdict = lastAttempt.verdict || 'pending'
          }
          // 检查所有子 action 是否都 done
          const allChildren = (parentGoal.children || []).map(cid => S.nodes.find(n => n.id === cid)).filter(Boolean)
          const allActions = allChildren.filter(c => c.type === 'action')
          if (allActions.length > 0 && allActions.every(a => a.status === 'done')) {
            // 所有 action done，但 planMode goal 需要 Claude 审计确认
            // 不自动标 done，留待 Claude 判断
          }
        }
      }
      break
    }

    case 'done':
      S.nodes.forEach(n => {
        if (n.status === 'active') n.status = 'done'
      })
      break

    case 'error':
      // 记录错误到当前游标指向的 goal
      const cursorGoal = S.meta.cursor && S.nodes.find(n => n.id === S.meta.cursor && n.type === 'goal')
      const errNode = newNode('err-'+Date.now(), { name:evt.title||'错误', type:'action',
        taskLine:'__root__', symbolSize:28, status:'error', createdAt:now })
      S.nodes.push(errNode)
      if (cursorGoal) {
        linkAsBranch(cursorGoal, errNode)
      }
      break
  }

  deriveState()
  save()
  broadcast('graph-update', getMultiView())
  broadcast('event', evt)
}

// ============ /graph API ============
function handleGraphAction(action, res) {
  const now = new Date().toISOString()
  let result = { ok: true }

  switch (action.op) {
    case 'create-node': {
      const id = (action.type || 'goal') + '-' + Date.now()
      const node = newNode(id, {
        name: action.name || '未命名',
        type: action.type || 'goal',
        taskLine: action.taskLine || S.meta.activeTaskLine || '__root__',
        symbolSize: action.type === 'action' ? 28 : 38,
        status: 'pending',
        planMode: action.planMode !== undefined ? action.planMode : S.meta.planMode,
        notes: action.notes || '',
        successCriteria: action.successCriteria || '',
        branchOf: action.branchOf || null,
        createdAt: now
      })
      S.nodes.push(node)

      // 挂载到父节点
      if (action.parentId) {
        const parent = S.nodes.find(n => n.id === action.parentId)
        if (parent) {
          if (action.asChain) {
            linkAsChain(parent, node)
          } else {
            linkAsBranch(parent, node)
          }
        }
      } else if (action.asChain && action.planRootId) {
        // 挂到指定计划根节点后面
        const planRoot = S.nodes.find(n => n.id === action.planRootId)
        if (planRoot) linkAsChain(planRoot, node)
      } else if (action.asChain && S.meta.cursor) {
        // 无指定父节点但要求上链 -> 挂到游标指向的节点后面
        const cursorNode = S.nodes.find(n => n.id === S.meta.cursor)
        if (cursorNode && cursorNode.type !== "action") {
          linkAsChain(cursorNode, node)
        }
      }

      // planRoot 注册
      if (action.asPlanRoot) {
        if (!S.planRoots) S.planRoots = []
        S.planRoots.push(id)
        if (S.meta.currentPlanIndex === undefined) S.meta.currentPlanIndex = 0
      }

      // 更新游标
      if (action.setCursor || action.asChain || action.asPlanRoot) S.meta.cursor = id

      result.nodeId = id
      break
    }

    case 'delete-node': {
      const node = S.nodes.find(n => n.id === action.nodeId)
      if (!node) { result.ok = false; result.error = '节点不存在'; break }
      // 清理引用
      S.nodes.forEach(n => {
        n.children = (n.children || []).filter(cid => cid !== action.nodeId)
        if (n.nextInChain === action.nodeId) n.nextInChain = null
        if (n.branchOf === action.nodeId) n.branchOf = null
      })
      // 如果游标指向被删节点，移到链首
      if (S.meta.cursor === action.nodeId) {
        S.meta.cursor = S.chain[0] || null
      }
      S.nodes = S.nodes.filter(n => n.id !== action.nodeId)
      break
    }

    case 'update-node': {
      const node = S.nodes.find(n => n.id === action.nodeId)
      if (!node) { result.ok = false; result.error = '节点不存在'; break }
      const updatable = ['name','notes','successCriteria','status','planMode','pinned','tags','audited','fullText','taskLine','branchOf']
      updatable.forEach(k => {
        if (action[k] !== undefined) node[k] = action[k]
      })
      // result 字段特殊处理：支持写入和追加
      if (action.result) {
        node.result = Object.assign(node.result || {}, action.result)
      }
      if (action.finalReport) {
        if (!node.result) node.result = {}
        node.result.finalReport = action.finalReport
      }
      if (action.appendAttempt) {
        if (!node.result) node.result = { attempts: [] }
        if (!node.result.attempts) node.result.attempts = []
        node.result.attempts.push(action.appendAttempt)
      }
      // 如果手动标 done/failed，检查死循环
      if (action.status === 'failed' && node.type === 'goal') {
        checkDeadLoop(node)
      }
      node.updatedAt = now
      if (action.audited) { node.audited = true; node.auditedAt = now; node.auditedBy = action.auditedBy || 'claude' }
      break
    }

    case 'move-cursor': {
      const target = action.nodeId && S.nodes.find(n => n.id === action.nodeId)
      if (target) {
        S.meta.cursor = action.nodeId
        // 如果是 planMode 节点且状态是 pending → 激活变亮
        if (target.planMode && target.status === 'pending') {
          target.status = 'active'
        }
        result.cursor = action.nodeId
      } else {
        result.ok = false; result.error = '目标节点不存在'
      }
      break
    }

    case 'mark-done': {
      const node = S.nodes.find(n => n.id === action.nodeId)
      if (!node) { result.ok = false; result.error = '节点不存在'; break }
      node.status = 'done'
      node.completedAt = now
      if (action.auditResult) {
        if (!node.result) node.result = {}
        node.result.outcome = 'success'
        node.result.summary = action.auditResult
        node.audited = true; node.auditedAt = now; node.auditedBy = 'claude'
      }
      // 如果done的是planRoot且是当前链 → 启动倒计时
      if (S.planRoots && node.planMode && S.planRoots.includes(node.id)) {
        const idx = S.planRoots.indexOf(node.id)
        if (idx === (S.meta.currentPlanIndex || 0) && idx < S.planRoots.length - 1) {
          startCountdown(idx)
        }
      }
      break
    }

    case 'mark-failed': {
      const node = S.nodes.find(n => n.id === action.nodeId)
      if (!node) { result.ok = false; result.error = '节点不存在'; break }
      node.status = 'failed'
      if (!node.result) node.result = {}
      node.result.outcome = 'failure'
      node.result.summary = action.reason || '未记录原因'
      node.result.failedAt = now
      if (action.finalReport) node.result.finalReport = action.finalReport
      node.audited = true; node.auditedAt = now; node.auditedBy = 'claude'

      // 检查死循环
      if (node.type === 'goal') checkDeadLoop(node)
      break
    }

    case 'stop-countdown': {
      if (S.meta._countdownTimer) { clearTimeout(S.meta._countdownTimer); S.meta._countdownTimer = null }
      S.meta._countdown = null
      broadcast('event', { type:'countdown_cancelled' })
      result.ok = true
      break
    }

    case 'advance-plan': {
      const next = (S.meta.currentPlanIndex || 0) + 1
      if (S.planRoots && next < S.planRoots.length) {
        S.meta.currentPlanIndex = next
        const nextRoot = S.planRoots[next]
        const node = S.nodes.find(n => n.id === nextRoot)
        if (node) { node.status = 'active'; S.meta.cursor = nextRoot }
        if (S.meta._countdownTimer) { clearTimeout(S.meta._countdownTimer); S.meta._countdownTimer = null }
        S.meta._countdown = null
        result.nextChain = nextRoot
      } else {
        result.ok = false; result.error = '没有更多计划链'
      }
      break
    }

    default:
      result.ok = false; result.error = '未知操作: ' + action.op
  }

  if (result.ok) {
    deriveState()
    save()
    broadcast('graph-update', getMultiView())
  }
  return result
}

// ============ 倒计时 ============
function startCountdown(planIdx) {
  const nextIdx = planIdx + 1
  if (!S.planRoots || nextIdx >= S.planRoots.length) return

  const nextName = (S.nodes.find(n => n.id === S.planRoots[nextIdx]) || {}).name || '下一条链'
  const totalSec = 15  // 15秒倒计时（可调）
  let remaining = totalSec

  S.meta._countdown = { nextIdx, nextName, remaining, total: totalSec }
  broadcast('event', { type:'countdown_start', remaining, total: totalSec, nextName, nextIdx })

  function tick() {
    remaining--
    S.meta._countdown.remaining = remaining
    broadcast('event', { type:'countdown_tick', remaining, nextName, nextIdx })
    if (remaining <= 0) {
      S.meta._countdownTimer = null
      S.meta._countdown = null
      // 自动递进
      S.meta.currentPlanIndex = nextIdx
      const nextRoot = S.planRoots[nextIdx]
      const node = S.nodes.find(n => n.id === nextRoot)
      if (node) { node.status = 'active'; S.meta.cursor = nextRoot }
      deriveState(); save()
      broadcast('graph-update', getMultiView())
      broadcast('event', { type:'countdown_done', nextIdx, nextRoot })
    } else {
      S.meta._countdownTimer = setTimeout(tick, 1000)
    }
  }
  S.meta._countdownTimer = setTimeout(tick, 1000)
}

// ============ 归档导出 ============
function archiveNode(nodeId) {
  const node = S.nodes.find(n => n.id === nodeId)
  if (!node) return { ok: false, error: '节点不存在' }

  const record = {
    savedAt: new Date().toISOString(),
    nodeName: node.name,
    type: node.type,
    status: node.status,
    notes: node.notes,
    successCriteria: node.successCriteria,
    result: node.result,
    fullText: node.fullText || '',
    taskLine: S.taskLines[node.taskLine]?.name || node.taskLine
  }

  // 确保目录存在
  const dir = path.dirname(ARCHIVE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.appendFileSync(ARCHIVE_FILE, JSON.stringify(record) + '\n')
  return { ok: true, file: ARCHIVE_FILE }
}

function archiveChain() {
  // 导出所有有 finalReport 或 notes 的节点
  const valuable = S.nodes.filter(n =>
    (n.result && n.result.finalReport) ||
    (n.notes && n.notes.length > 10) ||
    (n.status === 'failed')
  )
  if (valuable.length === 0) return { ok: true, count: 0 }

  const dir = path.dirname(ARCHIVE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  let count = 0
  valuable.forEach(n => {
    const record = {
      savedAt: new Date().toISOString(),
      nodeName: n.name,
      type: n.type,
      status: n.status,
      notes: n.notes,
      successCriteria: n.successCriteria,
      result: n.result,
      fullText: n.fullText || '',
      taskLine: S.taskLines[n.taskLine]?.name || n.taskLine
    }
    fs.appendFileSync(ARCHIVE_FILE, JSON.stringify(record) + '\n')
    count++
  })
  return { ok: true, count, file: ARCHIVE_FILE }
}

function getLastChainNode() {
  const root = S.nodes.find(n => n.type === 'root')
  if (!root) return null
  let cur = root, depth = 0
  while (cur.nextInChain && depth < 200) {
    const next = S.nodes.find(n => n.id === cur.nextInChain)
    if (!next) break
    cur = next; depth++
  }
  return cur
}

// ============ HTTP ============
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204); return res.end()
  }

  // SSE
  if (req.url === '/sse') {
    res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'})
    res.write(`data: ${JSON.stringify({type:'connected'})}\n\n`)
    // 如果有活跃倒计时，立即推给新客户端
    if (S.meta._countdown) {
      const cd = S.meta._countdown
      res.write(`event: event\ndata: ${JSON.stringify({type:'countdown_start',remaining:cd.remaining,total:cd.total,nextName:cd.nextName,nextIdx:cd.nextIdx})}\n\n`)
    }
    clients.push(res)
    req.on('close', () => { const i = clients.indexOf(res); if (i>=0) clients.splice(i,1) })
    return
  }

  // 状态查询
  if (req.url === '/state' || req.url.startsWith('/state?')) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const sid = url.searchParams.get('sessionId')
    if (sid) {
      const state = getOrCreateSession(sid)
      res.writeHead(200, {'Content-Type':'application/json'})
      return res.end(JSON.stringify(state))
    }
    res.writeHead(200, {'Content-Type':'application/json'})
    return res.end(JSON.stringify(getMultiView()))
  }

  // 游标上下文（压缩格式，给 Claude 用）
  if (req.url.startsWith('/context')) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const radius = parseInt(url.searchParams.get('radius') || '3')
    const sid = url.searchParams.get('sessionId') || 'default'
    S = getOrCreateSession(sid)
    const windowNodes = getContextWindow(S.meta.cursor, radius)
    const text = formatContext(windowNodes, S.meta.cursor)
    const stalled = hasStalledNode(windowNodes)
    res.writeHead(200, {'Content-Type':'text/plain'})
    return res.end(text + (stalled ? '\n[脑图] ⚠️ 有节点需要人工介入' : ''))
  }

  // /graph API
  if (req.url === '/graph' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const action = JSON.parse(body)
        // 会话路由: 如果请求带了 sessionId，切换到对应会话
        if (action.sessionId) S = getOrCreateSession(action.sessionId)
        const result = handleGraphAction(action, res)
        res.writeHead(result.ok ? 200 : 400, {'Content-Type':'application/json'})
        res.end(JSON.stringify(result))
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:false, error:e.message}))
      }
    })
    return
  }

  // 归档
  if (req.url === '/archive' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}')
        let result
        if (params.nodeId) {
          result = archiveNode(params.nodeId)
        } else {
          result = archiveChain()
        }
        res.writeHead(200, {'Content-Type':'application/json'})
        res.end(JSON.stringify(result))
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:false, error:e.message}))
      }
    })
    return
  }

  // 审计开关
  if (req.url === '/audit-toggle' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}')
        // 审计是全局开关，应用到所有 session
        const enabled = params.enabled !== undefined ? params.enabled : !(S.meta.auditEnabled)
        sessions.forEach(state => { state.meta.auditEnabled = enabled; save(state) })
        res.writeHead(200, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:true, auditEnabled: enabled}))
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:false, error:e.message}))
      }
    })
    return
  }

  // 事件接收
  if (req.url === '/events' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try { handleEvent(JSON.parse(body)); res.end(JSON.stringify({ok:true})) }
      catch(e) { res.writeHead(400); res.end(JSON.stringify({error:e.message})) }
    })
    return
  }

  // 初始化（SessionStart 时调用）
  if (req.url === '/init' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}')
        const sessionId = params.sessionId || 'default'
        S = getOrCreateSession(sessionId)
        S.meta.sessionId = sessionId
        deriveState()
        save()
        broadcast('graph-update', getMultiView())
        res.writeHead(200, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:true, stateFile: S._stateFile, sessionId}))
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:false, error:e.message}))
      }
    })
    return
  }

  // 清理（SessionEnd 时调用）
  if (req.url === '/cleanup' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}')
        const sid = params.sessionId || S._sessionId || 'default'
        // 先归档有价值节点
        if (params.archive !== false) archiveChain()
        // 删除 state 文件 + 从 sessions Map 移除
        const file = stateFile(sid)
        if (fs.existsSync(file)) fs.unlinkSync(file)
        sessions.delete(sid)
        if (sessions.size > 0) {
          const first = sessions.values().next().value
          S = first
        } else {
          S = defaultState()
        }
        broadcast('graph-update', getMultiView())
        res.writeHead(200, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:true}))
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok:false, error:e.message}))
      }
    })
    return
  }

  if (req.url === '/reset' && req.method === 'POST') {
    sessions.clear()
    S = defaultState()
    broadcast('graph-update', getMultiView())
    return res.end(JSON.stringify({ok:true}))
  }
  if (req.url === '/health') {
    let totalNodes = 0; sessions.forEach(s => totalNodes += s.nodes.length)
    res.writeHead(200, {'Content-Type':'application/json'})
    return res.end(JSON.stringify({ok:true,nodes:totalNodes,sessions:sessions.size,clients:clients.length}))
  }

  // ============ 审计阻塞端点 ============
  const auditRequests = server._auditRequests || (server._auditRequests = new Map())
  server._auditRequests = auditRequests

  if (req.url === '/audit-request' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}')
        const requestId = 'audit-' + Date.now() + '-' + Math.random().toString(36).substring(2,6)
        const action = params.action || '未知操作'
        const timeoutMs = params.timeout || 30000

        // 通知浏览器弹窗
        broadcast('event', { type: 'audit_check', requestId, action,
          command: params.command || '', timeout: timeoutMs })

        let resolved = false
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true
            auditRequests.delete(requestId)
            res.writeHead(200, {'Content-Type':'application/json'})
            res.end(JSON.stringify({approved: false, reason: '超时自动拒绝'}))
          }
        }, timeoutMs)

        auditRequests.set(requestId, {
          resolve: (approved, reason) => {
            if (!resolved) {
              resolved = true
              clearTimeout(timer)
              auditRequests.delete(requestId)
              res.writeHead(200, {'Content-Type':'application/json'})
              res.end(JSON.stringify({approved, reason}))
            }
          }
        })

        req.on('close', () => {
          if (!resolved) {
            resolved = true
            clearTimeout(timer)
            auditRequests.delete(requestId)
          }
        })
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'})
        res.end(JSON.stringify({approved: false, reason: e.message}))
      }
    })
    return
  }

  if (req.url === '/audit-response' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}')
        const { requestId, approved, reason } = params
        const entry = auditRequests.get(requestId)
        if (entry) {
          entry.resolve(approved !== false, reason || (approved ? '用户允许' : '用户拒绝'))
          res.writeHead(200, {'Content-Type':'application/json'})
          res.end(JSON.stringify({ok: true}))
        } else {
          res.writeHead(404, {'Content-Type':'application/json'})
          res.end(JSON.stringify({ok: false, error: '请求已过期或不存在'}))
        }
      } catch(e) {
        res.writeHead(400, {'Content-Type':'application/json'})
        res.end(JSON.stringify({ok: false, error: e.message}))
      }
    })
    return
  }

  // 静态文件
  let fp = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  fp = path.join(__dirname, 'renderer', fp)
  const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css'}
  if (fs.existsSync(fp)) {
    res.writeHead(200, {'Content-Type': mime[path.extname(fp)]||'text/plain'})
    fs.createReadStream(fp).pipe(res)
  } else { res.writeHead(404); res.end('Not Found') }
})

server.listen(PORT, '127.0.0.1', () => console.log(`\n🧠 Brain Map v2 → http://127.0.0.1:${PORT}\n`))
