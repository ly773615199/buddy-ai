/**
 * 浮窗 Preload — IPC 桥接
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 打开主窗口
  openMainWindow: () => ipcRenderer.send('floating_open_main'),

  // 右键菜单
  showContextMenu: () => ipcRenderer.send('floating_context_menu'),

  // 状态更新（主窗口 → 浮窗）
  onStateUpdate: (callback) => {
    ipcRenderer.on('state_update', (event, state) => callback(state));
  },

  // Sprint 5: 感知事件
  onPerceptionEvent: (callback) => {
    ipcRenderer.on('perception_event', (event, data) => callback(data));
  },

  // Sprint 6: 自主行为事件
  onBehaviorEvent: (callback) => {
    ipcRenderer.on('behavior_event', (event, data) => callback(data));
  },

  // Sprint 6: 窗口感知事件
  onWindowAwareness: (callback) => {
    ipcRenderer.on('window_awareness', (event, data) => callback(data));
  },

  // 拖拽
  dragStart: (offset) => ipcRenderer.send('floating_drag_start', offset),
  dragMove: (mousePos) => ipcRenderer.send('floating_drag_move', mousePos),
  dragEnd: () => ipcRenderer.send('floating_drag_end'),
});
