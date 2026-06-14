// Brain Map — preload script
// 通过 contextBridge 暴露安全的 API 给渲染进程

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('brainMap', {
  // 接收来自主进程的图更新
  onGraphUpdate: (callback) => {
    ipcRenderer.on('graph-update', (event, data) => callback(data))
  },
  // 接收原始事件
  onEvent: (callback) => {
    ipcRenderer.on('event', (event, data) => callback(data))
  },
  // 移除监听
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
