// Brain Map Graph Helper — Claude 通过此脚本安全调用 /graph API
// 自动根据 cwd 找到对应 session，防止计划链写到别的 CLI
// 用法:
//   node D:/scripts/brain-map/graph-helper.cjs '{"op":"create-node","name":"P1","planMode":true,"asPlanRoot":true,"asChain":true,"notes":"..."}'
//   node D:/scripts/brain-map/graph-helper.cjs '{"op":"mark-done","nodeId":"goal-xxx"}'
//   node D:/scripts/brain-map/graph-helper.cjs '{"op":"move-cursor","nodeId":"goal-xxx"}'

const http = require('http')
const PORT = process.env.BRAIN_MAP_PORT || 47635

function post(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch(e) { resolve({ raw: d }) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body)
    req.end()
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.log('用法: node graph-helper.cjs \'{"op":"...","name":"..."}\'')
    console.log('支持所有 /graph 操作: create-node, delete-node, update-node, move-cursor, mark-done, mark-failed')
    process.exit(1)
  }

  let action
  try {
    action = JSON.parse(args[0])
  } catch(e) {
    console.error('JSON 解析失败:', e.message)
    process.exit(1)
  }

  const cwd = process.env.CLAUDE_CODE_CWD || process.cwd()

  // 先查 /state 找到当前 cwd 对应的 session
  let sessionId = null
  try {
    const state = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${PORT}/state`, res => {
        let d = ''
        res.on('data', c => d += c)
        res.on('end', () => {
          try { resolve(JSON.parse(d)) } catch(e) { resolve(null) }
        })
      }).on('error', () => resolve(null))
    })

    if (state && state.sessions) {
      // 找 cwd 匹配的 session
      for (const sess of state.sessions) {
        const sessCwd = sess.meta?.cwd || ''
        if (sessCwd && cwd && sessCwd.toLowerCase() === cwd.toLowerCase()) {
          sessionId = sess.sessionId
          break
        }
      }
      // fallback: 找有活跃节点的 session
      if (!sessionId && state.sessions.length > 0) {
        for (const sess of state.sessions) {
          if (sess.chain && sess.chain.length > 0) {
            sessionId = sess.sessionId
            break
          }
        }
      }
    }
  } catch(e) {}

  // 带上 sessionId 发送请求
  if (sessionId) action.sessionId = sessionId

  try {
    const result = await post(`http://127.0.0.1:${PORT}/graph`, action)
    if (result.ok) {
      console.log(JSON.stringify(result))
      if (result.nodeId) console.log('节点ID:', result.nodeId)
      process.exit(0)
    } else {
      console.error('失败:', result.error || '未知错误')
      process.exit(1)
    }
  } catch(e) {
    console.error('请求失败:', e.message)
    process.exit(1)
  }
}

main()
