// 光伏知识库 — 脑图计划链初始化
// 通过 /graph API 创建灰色计划节点
const http = require('http')

const BASE = 'http://127.0.0.1:47635'

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(path, BASE)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve({ status: res.statusCode, body: buf }))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  const phases = [
    {
      name: '🚀 阶段0：最小可行验证（MVP）',
      id: 'P0',
      notes: '选1个公众号20篇文章，跑通完整管道，输出可浏览的知识手册',
      successCriteria: '分类准确率>80%，MkDocs站点可浏览搜索，原文完整保留',
      tasks: [
        { name: '0.1 下载公众号文章', notes: 'wechatDownload MCP下载20篇文章→Markdown' },
        { name: '0.2 文本清洗脚本', notes: '正则去广告/引导关注/历史文章列表' },
        { name: '0.3 文本切分脚本', notes: 'RecursiveCharacterTextSplitter,512tokens,15%重叠,按标题层级' },
        { name: '0.4 AI标注脚本', notes: '对每个chunk：分类+打标签+写概括，原文不动' },
        { name: '0.5 生成知识手册', notes: 'MkDocs Material站点，按分类树导航' },
        { name: '0.6 人工评估', notes: '抽查20个chunk，评估分类/标签/概括质量' },
      ]
    },
    {
      name: '🏗️ 阶段1：核心骨架搭建',
      id: 'P1',
      notes: '把阶段0的脚本产品化，形成可复用的知识库管理员Agent',
      successCriteria: 'Agent能自主完成入栈处理+双通道回答+增量更新',
      tasks: [
        { name: '1.1 知识库管理员Agent', notes: '系统Prompt：光伏知识图书馆馆长，职责+行为边界' },
        { name: '1.2 入栈管道', notes: '整合clean+chunk+annotate为一条管道，输入md→输出标注JSON+MkDocs' },
        { name: '1.3 双通道问答接口', notes: '通道A原文检索(零幻觉)+通道B AI推演(标注推理风险)' },
        { name: '1.4 增量处理', notes: '新文章只处理新增chunk，hash去重，不重跑全库' },
        { name: '1.5 知识手册自动更新', notes: '入库后自动rebuild MkDocs，更新最近入库页面' },
      ]
    },
    {
      name: '🔄 阶段2：智能维护',
      id: 'P2',
      notes: 'Agent能自主发现知识库问题，输出审计报告待人工确认',
      successCriteria: '周审计自动运行，月审计输出整理方案，人工确认后自动执行',
      tasks: [
        { name: '2.1 定期全库审计', notes: 'AI遍历全库检查：标签冗余/分类不一致/内容过期/知识缺口/切分质量' },
        { name: '2.2 人工确认机制', notes: '审计建议格式：AI建议+依据+影响范围，人工逐条确认/拒绝/修改' },
        { name: '2.3 日志追踪', notes: '每次操作记录：时间/类型/chunk/结果，支持回溯' },
        { name: '2.4 分类法迭代', notes: '根据使用反馈调整分类树，变更时自动更新受影响chunk' },
      ]
    },
    {
      name: '🔌 阶段3：扩展与集成',
      id: 'P3',
      notes: '多来源+语义搜索+安全+开源平台评估',
      successCriteria: '支持URL/PDF入栈，向量检索可用，Dify/MaxKB试用报告完成',
      tasks: [
        { name: '3.1 多来源入栈', notes: 'URL直接爬取/PDF/Word上传→解析→清洗→入库' },
        { name: '3.2 向量检索(ChromaDB)', notes: 'BM25关键词+向量语义+重排序混合检索' },
        { name: '3.3 开源平台试用评估', notes: '部署Dify/MaxKB→测试→评估报告→决定迁移or混合or自建' },
        { name: '3.4 安全管控', notes: '注入检测/来源验证/异常隔离/完整日志链路' },
      ]
    }
  ]

  const createdIds = {}

  for (const phase of phases) {
    // 创建阶段计划节点（计划根节点）
    console.log(`Creating: ${phase.id} ${phase.name}`)
    const r = await post('/graph', {
      op: 'create-node',
      name: `${phase.id} ${phase.name}`,
      type: 'goal',
      planMode: true,
      asPlanRoot: true,
      asChain: true,
      notes: phase.notes,
      successCriteria: phase.successCriteria,
      taskLine: '光伏知识库'
    })
    console.log(`  -> ${r.status} ${r.body}`)
    try {
      const res = JSON.parse(r.body)
      if (res.node) createdIds[phase.id] = res.node.id
    } catch(e) {}

    // 创建子任务节点
    for (let i = 0; i < phase.tasks.length; i++) {
      const task = phase.tasks[i]
      const isLast = i === phase.tasks.length - 1
      console.log(`  Creating: ${task.name}`)
      const tr = await post('/graph', {
        op: 'create-node',
        name: `${phase.id}.${task.name}`,
        type: 'goal',
        planMode: true,
        asChain: true,
        notes: task.notes,
        taskLine: '光伏知识库'
        // 不设parentId，让API自动挂到游标（上一个节点）后面
      })
      console.log(`    -> ${tr.status} ${tr.body}`)
    }
  }

  console.log('\n✅ 计划链创建完成')
}

main().catch(e => { console.error(e); process.exit(1) })
