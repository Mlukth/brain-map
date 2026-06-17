// Brain Map v2 — Claude Code Hook Forwarder
// 用法：在 settings.json 的 hooks 中添加
//   "command": "node \"D:/scripts/brain-map/hook-forwarder.js\""
// 通信方式：stdin 接收 Claude Code 事件 JSON → HTTP POST 到 Brain Map server

import { readFileSync, existsSync, appendFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.BRAIN_MAP_PORT || 47635
const SERVER_URL = `http://127.0.0.1:${PORT}`

// ============ 读取 stdin ============
function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8')
    if (!raw || raw.trim() === '') return null
    return JSON.parse(raw)
  } catch (e) { return null }
}

// ============ HTTP 请求 ============
async function postJSON(url, data, timeoutMs = 5000) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    return await res.json()
  } catch (e) { return null }
}

async function getText(url, timeoutMs = 3000) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    return await res.text()
  } catch (e) { return null }
}

// ============ 健康检查 ============
async function isServerRunning() {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch (e) { return false }
}

// ============ 自动启动 server + 浏览器 ============
async function autoStartApp() {
  if (await isServerRunning()) return true

  try {
    const { spawn } = await import('child_process')
    const serverPath = resolve(__dirname, 'server.cjs')

    const proc = spawn('node', [serverPath], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore',
      shell: true
    })
    proc.unref()

    // 等 server 启动
    await new Promise(r => setTimeout(r, 1500))
  } catch (e) { /* 启动失败不阻塞 */ }

  return await isServerRunning()
}

function openBrowser() {
  try {
    execSync(`start http://127.0.0.1:${PORT}`, { shell: true, timeout: 3000 })
  } catch (e) { /* 失败静默 */ }
}

// ============ 事件规范化 ============
function normalize(payload) {
  const hookName = payload.hook_event_name
  // 优先用 Claude Code 内置的 CLAUDE_SESSION_ID（环境变量），fallback 到 payload.session_id
  const sessionId = process.env.CLAUDE_SESSION_ID || payload.session_id || 'unknown'
  const base = {
    sessionId: sessionId,
    cwd: payload.cwd || '',
    rawPayload: payload
  }

  switch (hookName) {
    case 'SessionStart':
      return { ...base, type: 'session_start', title: `会话开始 · ${payload.cwd?.split(/[/\\]/).pop() || ''}` }
    case 'UserPromptSubmit':
      return { ...base, type: 'prompt_submit', title: payload.prompt || '收到新任务' }
    case 'PreToolUse': {
      const tName = toolName(payload.tool_name)
      const tDetail = toolDetail(payload.tool_name, payload.tool_input)
      return { ...base, type: 'tool_start', title: tDetail, toolName: tName }
    }
    case 'PostToolUse':
      return { ...base, type: 'tool_end', title: '工具完成', toolName: toolName(payload.tool_name) }
    case 'Notification':
      return { ...base, type: 'permission_wait', title: '需要确认' }
    case 'Stop':
      return { ...base, type: 'done', title: '处理完成' }
    default:
      return { ...base, type: 'notification', title: hookName || '未知事件' }
  }
}

function toolName(raw) {
  if (!raw) return 'Unknown'
  if (raw.startsWith('mcp__')) {
    const parts = raw.split('__')
    return parts.length >= 3 ? `MCP:${parts[1]}/${parts.slice(2).join('__')}` : raw
  }
  return raw
}

function toolDetail(name, input) {
  if (!name) return '工具调用'
  const base = name.startsWith('mcp__') ? name.split('__').slice(1).join('/') : name

  switch (base) {
    case 'Bash':
      return input?.command ? `执行: ${input.command.substring(0, 40)}${input.command.length > 40 ? '...' : ''}` : '执行命令'
    case 'Read':
      return input?.file_path ? `读: ${input.file_path.split(/[/\\]/).pop()}` : '读文件'
    case 'Write':
      return input?.file_path ? `写: ${input.file_path.split(/[/\\]/).pop()}` : '写文件'
    case 'Edit':
      return input?.file_path ? `编辑: ${input.file_path.split(/[/\\]/).pop()}` : '编辑文件'
    case 'Grep':
      return input?.pattern ? `搜索: ${input.pattern.substring(0, 30)}` : '搜索'
    case 'Glob':
      return input?.pattern ? `查找: ${input.pattern.substring(0, 30)}` : '查找文件'
    case 'WebSearch':
      return input?.query ? `搜索: ${input.query.substring(0, 30)}` : '网络搜索'
    case 'WebFetch':
      return input?.url ? `获取: ${input.url.substring(0, 40)}` : '获取网页'
    case 'Agent':
      return input?.description ? `子代理: ${input.description.substring(0, 30)}` : '启动子代理'
    case 'Skill':
      return input?.skill ? `技能: ${input.skill}` : '调用技能'
    case 'Task':
      return '任务管理'
    default:
      return `调用: ${base}`
  }
}

// ============ 检测是否是 brain-map 的 graph 请求 ============
function isBrainMapRequest(toolName, toolInput) {
  if (toolName !== 'Bash') return false
  const cmd = toolInput?.command || ''
  return /curl.*127\.0\.0\.1:47635\/(graph|archive)/i.test(cmd) ||
         /curl.*localhost:47635\/(graph|archive)/i.test(cmd)
}

// ============ 主流程 ============
async function main() {
  const payload = readStdin()
  if (!payload) { process.exit(0) }

  const event = normalize(payload)

  // ---- SessionStart ----
  if (event.type === 'session_start') {
    const running = await autoStartApp()
    if (running) {
      // 初始化 session
      await postJSON(`${SERVER_URL}/init`, {
        sessionId: event.sessionId,
        cwd: event.cwd
      })
      // 自动弹浏览器
      openBrowser()
    }
  }

  // ---- UserPromptSubmit: 注入游标上下文 ----
  if (event.type === 'prompt_submit') {
    // 先发送事件（创建节点 + 移动游标）
    await postJSON(`${SERVER_URL}/events`, event)

    // 拉取游标上下文
    const context = await getText(`${SERVER_URL}/context?radius=3`)

    if (context) {
      // 返回 additionalContext，注入到 Claude 的上下文
      const output = JSON.stringify({
        additionalContext: context,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: context
        }
      })
      process.stdout.write(output)
    }
    process.exit(0)
  }

  // ---- PreToolUse: 审计拦截 ----
  if (payload.hook_event_name === 'PreToolUse' && isBrainMapRequest(payload.tool_name, payload.tool_input)) {
    // 检查审计状态
    let auditEnabled = false
    try {
      const state = await getText(`${SERVER_URL}/state`)
      if (state) {
        const S = JSON.parse(state)
        auditEnabled = S.meta?.auditEnabled === true
      }
    } catch (e) {}

    if (!auditEnabled) {
      // 审计关闭 → 直接放行
      const output = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow'
        }
      })
      process.stdout.write(output)
    } else {
      // 审计开启 → 阻塞等待用户确认
      // 调 /audit-request (服务端阻塞直到用户回应或超时)
      const auditResult = await postJSON(`${SERVER_URL}/audit-request`, {
        action: 'graph操作',
        command: payload.tool_input?.command || '',
        timeout: 35000
      }, 40000) // 等 40s

      if (auditResult && auditResult.approved) {
        const output = JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow'
          }
        })
        process.stdout.write(output)
      } else {
        // 超时或拒绝 → 阻止
        const output = JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: auditResult?.reason || '审计未通过（超时或用户拒绝）'
          }
        })
        process.stdout.write(output)
      }
    }
    process.exit(0)
  }

  // ---- PostToolUse / Stop / 其他事件 → 直接转发 ----
  await postJSON(`${SERVER_URL}/events`, event)

  // 注意: Stop 事件是 Claude 每次响应完就触发，不是会话结束！
  // 不在 Stop 时清理，让 session 持久化。状态文件保留在磁盘。
  // SessionEnd hook（如果注册）才应该清理。

  process.exit(0)
}

main()
