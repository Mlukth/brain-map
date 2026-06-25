// 监听脑图审计事件 → 写入通知文件 → Claude 自动感知
// 启动: node watch-audit.cjs &
const http = require('http')
const fs = require('fs')
const path = require('path')
const NOTIFY_FILE = path.join(__dirname, '.audit-events.jsonl')

function listen() {
  console.log('👁 审计监听已启动')
  const req = http.get('http://127.0.0.1:47635/sse', res => {
    let buf = ''
    res.on('data', chunk => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const evt = JSON.parse(line.slice(5))
          if (evt.type === 'audit_rejected' || evt.type === 'audit_approved' || evt.type === 'pending_audit') {
            const entry = { time: new Date().toISOString(), ...evt }
            fs.appendFileSync(NOTIFY_FILE, JSON.stringify(entry) + '\n')
            console.log('📨', evt.type, evt.nodeName || evt.nodeId?.slice(-5))
          }
        } catch(e) {}
      }
    })
    res.on('end', () => { console.log('SSE断开, 3s重连...'); setTimeout(listen, 3000) })
  })
  req.on('error', () => { setTimeout(listen, 3000) })
}

// 清理旧通知
try { fs.unlinkSync(NOTIFY_FILE) } catch(e) {}
listen()
