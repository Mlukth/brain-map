// Brain Map — Electron 主进程 + HTTP 事件接收
// 模式参考 Clawd Companion，但专注于项目认知地图

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')

// ============ 配置 ============
const PORT = 47635 // 区别于 Clawd 的 47634
const TOKEN = 'brain-map-local'
const STATE_FILE = path.join(app.getPath('userData'), 'brain-map-state.json')
const CONNECTION_FILE = path.join(app.getPath('userData'), 'connection.json')

let mainWindow = null
let tray = null
let graphState = null // 图数据（nodes + edges + meta）

// ============ 图状态管理 ============
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      graphState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      return
    }
  } catch (e) { /* ignore */ }
  // 默认空状态
  graphState = {
    nodes: [
      { id: 'root', name: '当前会话', category: 0, symbolSize: 40, status: 'active' }
    ],
    links: [],
    meta: { lastSessionId: null, lastUpdate: null }
  }
}

function saveState() {
  graphState.meta.lastUpdate = new Date().toISOString()
  fs.writeFileSync(STATE_FILE, JSON.stringify(graphState, null, 2))
}

// ============ 写 connection.json（供 hook-forwarder 读取）============
function writeConnectionFile() {
  const dir = path.dirname(CONNECTION_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONNECTION_FILE, JSON.stringify({ port: PORT, token: TOKEN }))
}

// ============ HTTP 事件服务器 ============
function startEventServer() {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return
    }

    // 健康检查
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', port: PORT }))
      return
    }

    // 获取当前图状态
    if (req.url === '/state' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(graphState))
      return
    }

    // 接收事件（POST /events）
    if (req.url === '/events' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => {
        try {
          const event = JSON.parse(body)
          handleEvent(event)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ received: true, event: event.type }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    // 直接更新图数据（POST /graph — Claude 可直接写入）
    if (req.url === '/graph' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => {
        try {
          const update = JSON.parse(body)
          if (update.nodes) graphState.nodes = update.nodes
          if (update.links) graphState.links = update.links
          if (update.meta) Object.assign(graphState.meta, update.meta)
          saveState()
          sendToRenderer('graph-update', graphState)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[brain-map] HTTP server on http://127.0.0.1:${PORT}`)
    writeConnectionFile()
  })
}

// ============ 事件处理 ============
const CATEGORY_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#fc8452']
let categoryIdx = 0
const categoryMap = {}

function getOrCreateCategory(topic) {
  if (!categoryMap[topic]) {
    categoryMap[topic] = categoryIdx % CATEGORY_COLORS.length
    categoryIdx++
  }
  return categoryMap[topic]
}

function handleEvent(event) {
  const now = new Date().toISOString()
  graphState.meta.lastEvent = event.type
  graphState.meta.lastEventTime = now

  switch (event.type) {
    case 'session_start':
      // 新会话开始 → 创建会话节点
      graphState.nodes.push({
        id: `session-${Date.now()}`,
        name: event.title || '新会话',
        category: 0,
        symbolSize: 36,
        status: 'active',
        sessionId: event.sessionId,
        createdAt: now
      })
      break

    case 'prompt_submit':
      // 用户发送提示 → 创建提示节点
      if (event.title && event.title !== '收到新任务') {
        const topic = event.title.substring(0, 15)
        const cat = getOrCreateCategory(topic)
        const promptNode = {
          id: `prompt-${Date.now()}`,
          name: event.title.length > 20 ? event.title.substring(0, 18) + '...' : event.title,
          category: cat,
          symbolSize: 28,
          status: 'active',
          fullText: event.title,
          createdAt: now
        }
        graphState.nodes.push(promptNode)
        // 连接到最近的活跃节点
        const activeNodes = graphState.nodes.filter(n => n.status === 'active' && n.id !== promptNode.id)
        if (activeNodes.length > 0) {
          const lastActive = activeNodes[activeNodes.length - 1]
          graphState.links.push({ source: lastActive.id, target: promptNode.id })
        }
      }
      break

    case 'tool_start':
      // 工具调用开始 → 创建工具节点
      {
        const toolNode = {
          id: `tool-${Date.now()}`,
          name: event.title || '工具调用',
          category: 3,
          symbolSize: 18,
          status: 'active',
          toolName: event.toolName,
          createdAt: now
        }
        graphState.nodes.push(toolNode)
        // 连接到最近的 prompt 或 tool 节点
        const recentNodes = graphState.nodes.slice(-5)
        if (recentNodes.length > 1) {
          const prev = recentNodes[recentNodes.length - 2]
          graphState.links.push({ source: prev.id, target: toolNode.id })
        }
      }
      break

    case 'tool_end':
      // 工具完成 → 对应 tool_start 节点变灰
      {
        const recentTool = [...graphState.nodes].reverse().find(n => n.status === 'active' && n.id.startsWith('tool-'))
        if (recentTool) {
          recentTool.status = 'done'
          recentTool.completedAt = now
        }
      }
      break

    case 'done':
      // 会话/回合结束
      graphState.nodes.forEach(n => {
        if (n.status === 'active') n.status = 'done'
      })
      break

    case 'error':
      // 错误
      graphState.nodes.push({
        id: `error-${Date.now()}`,
        name: event.title || '错误',
        category: 4,
        symbolSize: 22,
        status: 'error',
        createdAt: now
      })
      break

    default:
      console.log('[brain-map] unknown event type:', event.type)
  }

  // 修剪：保持节点总数 ≤ 80，移除最旧的已完成节点
  if (graphState.nodes.length > 80) {
    const doneNodes = graphState.nodes.filter(n => n.status === 'done')
    if (doneNodes.length > 20) {
      const toRemove = doneNodes.slice(0, doneNodes.length - 20)
      const removeIds = new Set(toRemove.map(n => n.id))
      graphState.nodes = graphState.nodes.filter(n => !removeIds.has(n.id))
      graphState.links = graphState.links.filter(l => !removeIds.has(l.source) && !removeIds.has(l.target))
    }
  }

  saveState()
  sendToRenderer('graph-update', graphState)
  sendToRenderer('event', event)
}

// ============ 向渲染进程发送消息 ============
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// ============ Electron 窗口 ============
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 600,
    minHeight: 400,
    frame: true,
    title: 'Brain Map — 认知地图',
    icon: nativeImage.createEmpty(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1a1a2e',
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // 开发模式打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ============ 系统托盘 ============
function createTray() {
  // 用一个简单的 16x16 图标
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Brain Map — 认知地图')

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
      }
    }},
    { label: '清空地图', click: () => {
      graphState = { nodes: [{ id: 'root', name: '当前会话', category: 0, symbolSize: 40, status: 'active' }], links: [], meta: {} }
      saveState()
      sendToRenderer('graph-update', graphState)
    }},
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(contextMenu)
}

// ============ 应用生命周期 ============
app.whenReady().then(() => {
  loadState()
  startEventServer()
  createWindow()
  // createTray() // 托盘需要图标，先注释，后面加
})

app.on('window-all-closed', () => {
  // Windows 上保持托盘运行
  if (process.platform !== 'darwin') {
    // app.quit() // 先注释，让窗口关闭即退出（MVP阶段）
  }
})

app.on('before-quit', () => {
  saveState()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
