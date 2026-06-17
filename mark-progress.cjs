const http = require('http')
const BASE = 'http://127.0.0.1:47635'

function post(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body)
    const url = new URL('/graph', BASE)
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve(JSON.parse(b))) })
    req.write(data); req.end()
  })
}

async function main() {
  const state = await new Promise(resolve => {
    http.get(BASE+'/state', res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve(JSON.parse(b))) })
  })
  const nodes = state.sessions?.[0]?.nodes || state.nodes || []
  const planNodes = nodes.filter(n => n.planMode)

  // P0 done
  for (const n of planNodes.filter(n => n.name.match(/P0|0\.\d/))) {
    console.log('done:', n.name.slice(0,50))
    await post({ op: 'mark-done', nodeId: n.id })
  }
  // P1.1, P1.2 done
  for (const n of planNodes.filter(n => n.name.match(/1\.[12]/))) {
    console.log('done:', n.name.slice(0,50))
    await post({ op: 'mark-done', nodeId: n.id })
  }
  // P1.3 active
  const p13 = planNodes.find(n => n.name.includes('1.3'))
  if (p13) {
    console.log('active:', p13.name.slice(0,50))
    await post({ op: 'update-node', nodeId: p13.id, status: 'active' })
  }
  console.log('\nPlan chain updated.')
}

main().catch(e => console.error(e))
