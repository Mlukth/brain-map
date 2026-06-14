// 测试 server.cjs — 独立端口
const http = require('http')
const { spawn } = require('child_process')
const path = require('path')
const PORT = 47637

async function test() {
  const proc = spawn('node', [path.join(__dirname, 'server.cjs')], {
    cwd: __dirname, stdio: 'pipe', shell: true,
    env: { ...process.env, BRAIN_MAP_PORT: String(PORT) }
  })

  await new Promise(r => setTimeout(r, 2500))

  const base = `http://127.0.0.1:${PORT}`

  const initRes = await postJSON(`${base}/init`, {sessionId:'test-' + Date.now(), cwd:'D:/test'})
  console.log('1. /init:', JSON.stringify(initRes))

  const state = await getJSON(`${base}/state`)
  console.log('2. nodes:', state.nodes.length, 'cursor:', state.meta.cursor)
  state.nodes.forEach(n => console.log('  ', n.id, n.name, 'type:', n.type))
  console.log('   chain:', JSON.stringify(state.chain))

  const ctx = await getText(`${base}/context?radius=3`)
  console.log('3. context:', JSON.stringify(ctx))

  const createRes = await postJSON(`${base}/graph`, {
    op: 'create-node', name: '接qwen测试', type: 'goal',
    planMode: true, asChain: true, notes: '用qwen3:8b', successCriteria: '返回200'
  })
  console.log('4. create-node:', JSON.stringify(createRes))

  const ctx2 = await getText(`${base}/context?radius=3`)
  console.log('5. context:', JSON.stringify(ctx2))

  const state2 = await getJSON(`${base}/state`)
  console.log('6. nodes:', state2.nodes.length, 'chain:', JSON.stringify(state2.chain), 'cursor:', state2.meta.cursor)

  proc.kill()
  console.log('\nDone')
}

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const body = JSON.stringify(data)
    const req = http.request({hostname:u.hostname, port:u.port, path:u.pathname, method:'POST',
      headers:{'Content-Type':'application/json'}}, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)) } catch(e) { resolve(b) } })
    }); req.on('error', reject); req.write(body); req.end()
  })
}
function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)) } catch(e) { resolve(b) } }) }).on('error', reject)
  })
}
function getText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b)) }).on('error', reject)
  })
}

test().catch(e => { console.error(e); process.exit(1) })
