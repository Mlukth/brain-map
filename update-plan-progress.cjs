// 标记P0完成 + 更新计划链进度
const http = require('http')
const BASE = 'http://127.0.0.1:47635'

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL('/graph', BASE)
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve(JSON.parse(b))) })
    req.on('error', reject)
    req.write(data); req.end()
  })
}

async function main() {
  // 先拿state找到P0相关的节点ID
  const state = await new Promise((resolve) => {
    http.get(BASE+'/state', res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve(JSON.parse(b))) })
  })

  // 新数据模型: sessions[0].nodes
  const session = state.sessions?.[0]
  if (!session) { console.log('No session found'); return }
  const nodes = session.nodes

  // 找所有计划节点
  const planNodes = nodes.filter(n => n.planMode && n.status === 'pending')
  console.log(`Found ${planNodes.length} pending plan nodes`)

  // 标记P0及其子任务为done
  const p0Nodes = planNodes.filter(n => n.name.includes('P0') || n.name.includes('0.'))
  for (const n of p0Nodes) {
    console.log(`  Marking done: ${n.name.slice(0,50)}`)
    await post({ op: 'mark-done', nodeId: n.id })
  }

  // 标记P1为active
  const p1 = planNodes.find(n => n.name.startsWith('P1 '))
  if (p1) {
    console.log(`  Activating: ${p1.name.slice(0,50)}`)
    await post({ op: 'update-node', nodeId: p1.id, status: 'active' })
  }

  console.log('\nPlan chain updated. Refresh http://127.0.0.1:47635')
}

main().catch(e => { console.error(e); process.exit(1) })
