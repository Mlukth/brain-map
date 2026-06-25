// 检查计划链审计状态 — Claude 每次会话启动时调用
// 用法: node check-audit-status.cjs
const http = require('http')
const PORT = 47635

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch(e) { resolve(null) } })
    }).on('error', reject)
  })
}

async function main() {
  const state = await get('/state')
  if (!state || !state.sessions) { console.log('{}'); return }

  const result = { rejected: [], pendingAudit: [], activePlan: [] }

  for (const sess of state.sessions) {
    for (const node of sess.nodes) {
      if (node.status === 'pending_audit') {
        result.pendingAudit.push({
          sessionId: sess.sessionId?.slice(0,8),
          nodeId: node.id,
          name: node.name,
          evidence: node.evidence || '',
          checks: node.checks || [],
          attempts: (node.attempts||[]).length
        })
      }
      if (node.status === 'active' && node.result?.outcome === 'rejected') {
        result.rejected.push({
          sessionId: sess.sessionId?.slice(0,8),
          nodeId: node.id,
          name: node.name,
          rejectReason: node.result.rejectReason || '',
          auditNote: node.result.auditNote || '',
          attempts: (node.attempts||[]).length
        })
      }
      if (node.planMode && node.status === 'active' && !node.result?.outcome) {
        result.activePlan.push({
          sessionId: sess.sessionId?.slice(0,8),
          nodeId: node.id,
          name: node.name,
          notes: node.notes || ''
        })
      }
    }
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch(e => console.log(JSON.stringify({error: e.message})))
