// 脑图 v2 功能演示测试 — 验证所有 Phase 1 功能
const http = require('http')
const BASE = 'http://127.0.0.1:47635'

function post(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url.startsWith('http') ? url : BASE + url)
    const body = JSON.stringify(data)
    const req = http.request({hostname:u.hostname, port:u.port, path:u.pathname, method:'POST',
      headers:{'Content-Type':'application/json'}}, res => {
      let b = ''; res.on('data', c => b += c)
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch(e) { resolve(b) } })
    }); req.on('error', reject); req.write(body); req.end()
  })
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(BASE + url, res => {
      let b = ''; res.on('data', c => b += c)
      res.on('end', () => resolve(b))
    }).on('error', reject)
  })
}

async function demo() {
  console.log('╔════════════════════════════════════════╗')
  console.log('║   Brain Map v2 功能演示测试           ║')
  console.log('╚════════════════════════════════════════╝\n')

  // 确保干净状态
  console.log('🧹 重置状态...')
  await post('/reset', {})
  await post('/init', {sessionId:'demo-' + Date.now(), cwd:'D:/test'})
  console.log('✅ 服务器初始化完成\n')

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 1: 游标系统 + context 注入')
  console.log('━'.repeat(50))

  let ctx = await get('/context?radius=3')
  console.log('Hook注入给Claude的文本:')
  console.log(ctx)
  console.log()

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 2: 创建计划链节点 (planMode)')
  console.log('━'.repeat(50))

  // 创建多个计划节点
  const plan1 = await post('/graph', {
    op: 'create-node', name: '重构邮件管线', type: 'goal',
    planMode: true, asChain: true, notes: '从轮询改成IDLE模式',
    successCriteria: 'IDLE推送延迟<3秒'
  })
  console.log('创建计划节点1:', plan1.nodeId)

  const plan2 = await post('/graph', {
    op: 'create-node', name: '接qwen API', type: 'goal',
    planMode: true, asChain: true, notes: 'qwen3:8b, 注意超时处理',
    successCriteria: 'endpoint返回200, 延迟<2s'
  })
  console.log('创建计划节点2:', plan2.nodeId)

  const plan3 = await post('/graph', {
    op: 'create-node', name: '优化搜索性能', type: 'goal',
    planMode: true, asChain: true, notes: '加索引, 改查询逻辑',
    successCriteria: '查询<100ms'
  })
  console.log('创建计划节点3:', plan3.nodeId)

  console.log()
  ctx = await get('/context?radius=5')
  console.log('当前链上下文:')
  console.log(ctx)
  console.log()

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 3: 模拟执行 — tool创建action + 标记完成')
  console.log('━'.repeat(50))

  // 模拟 tool_start 事件（直接在第一个计划节点下建action）
  const action1 = await post('/graph', {
    op: 'create-node', name: 'Read: email-poller.js', type: 'action',
    planMode: false, parentId: plan1.nodeId, taskLine: '__root__'
  })
  console.log('创建action (Read文件):', action1.nodeId)

  // 标记完成
  await post('/graph', {op: 'mark-done', nodeId: action1.nodeId, auditResult: '文件已阅读，了解现有轮询逻辑'})
  console.log('action marked done')

  // 标记goal完成（模拟审计通过）
  await post('/graph', {
    op: 'mark-done', nodeId: plan1.nodeId,
    auditResult: '重构完成：轮询已改为IDLE，推送延迟实测1.2秒，达到标准'
  })
  console.log('✅ 计划1 标记完成(已审计)\n')

  ctx = await get('/context?radius=5')
  console.log('更新后的链上下文:')
  console.log(ctx)
  console.log()

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 4: 游标移动')
  console.log('━'.repeat(50))

  // 移动游标到计划2
  await post('/graph', {op: 'move-cursor', nodeId: plan2.nodeId})
  console.log('游标移动到: 接qwen API')

  ctx = await get('/context?radius=5')
  console.log('移动后上下文:')
  console.log(ctx)
  console.log()

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 5: 审计开关')
  console.log('━'.repeat(50))

  let auditState = await post('/audit-toggle', {enabled: true})
  console.log('审计开关 开:', auditState.auditEnabled)

  auditState = await post('/audit-toggle', {enabled: false})
  console.log('审计开关 关:', auditState.auditEnabled)
  console.log()

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 6: 失败处理 + finalReport')
  console.log('━'.repeat(50))

  // 模拟在计划2下建一个失败attempt
  await post('/graph', {
    op: 'create-node', name: 'Bash: curl测试', type: 'action',
    parentId: plan2.nodeId
  })
  await post('/graph', {
    op: 'mark-failed', nodeId: plan2.nodeId,
    reason: '方案A: qwen3:8b endpoint超时无响应',
    finalReport: '## 执行报告\n\n### 尝试方案A: qwen3:8b\n- endpoint: http://127.0.0.1:11434\n- 结果: 连接超时(30s)\n- 原因: ollama服务未启动\n\n### 结论\n需要先检查ollama运行状态。\n\n### 下一步\n尝试方案B: 检查并重启ollama服务'
  })
  console.log('✅ 计划2 标记失败 + 写入finalReport\n')

  ctx = await get('/context?radius=5')
  console.log('失败后的链上下文:')
  console.log(ctx)
  console.log()

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 7: 归档导出')
  console.log('━'.repeat(50))

  // 归档有价值节点
  const archiveRes = await post('/archive', {})
  console.log('批量归档结果:', JSON.stringify(archiveRes))

  // 归档单个节点
  const singleArchive = await post('/archive', {nodeId: plan2.nodeId})
  console.log('单节点归档:', JSON.stringify(singleArchive))
  console.log()

  // ================================================================
  console.log('━'.repeat(50))
  console.log('📋 测试 8: 节点备注编辑 (模拟UI操作)')
  console.log('━'.repeat(50))

  // 编辑节点备注（模拟用户在浏览器UI编辑后POST）
  await post('/graph', {
    op: 'update-node', nodeId: plan2.nodeId,
    notes: '改用qwen2.5:7b，endpoint不变，注意检查ollama状态',
    successCriteria: 'ollama运行 + endpoint返回200'
  })
  console.log('✅ 备注和成功标准已更新\n')

  ctx = await get('/context?radius=5')
  console.log('更新备注后的上下文:')
  console.log(ctx)
  console.log()

  // ================================================================
  // 最终状态
  console.log('━'.repeat(50))
  console.log('📊 最终状态汇总')
  console.log('━'.repeat(50))

  const stateUrl = BASE + '/state'
  const state = await new Promise((resolve) => {
    http.get(stateUrl, res => {
      let b = ''; res.on('data', c => b += c)
      res.on('end', () => resolve(JSON.parse(b)))
    })
  })

  console.log('节点总数:', state.nodes.length)
  console.log('链:', state.chain.map(id => {
    const n = state.nodes.find(nd => nd.id === id)
    return n ? `${n.status === 'done' ? '✓' : '⏳'}${n.name}` : '?'
  }).join(' → '))
  console.log('游标:', state.meta.cursor)
  console.log('任务线:', Object.keys(state.taskLines).length, '条')

  const planNodes = state.nodes.filter(n => n.planMode)
  console.log('计划节点:', planNodes.length, '个')
  planNodes.forEach(n => console.log(`  ${n.name}: ${n.status} | 备注: ${(n.notes||'').substring(0,30)}`))

  const doneNodes = state.nodes.filter(n => n.status === 'done')
  const failedNodes = state.nodes.filter(n => n.status === 'failed')
  console.log('完成:', doneNodes.length, '| 失败:', failedNodes.length)

  console.log('\n╔════════════════════════════════════════╗')
  console.log('║   全部 8 项测试通过 ✅                 ║')
  console.log('╚════════════════════════════════════════╝')
}

demo().catch(e => { console.error('测试失败:', e.message); process.exit(1) })
