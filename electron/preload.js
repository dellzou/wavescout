/* ============================================================
   勘波 WaveScout — preload
   在隔离上下文中向渲染层暴露最小桌面能力

   作者：邹宁（2004-04-17，广东广州）· © 2026 邹宁 版权所有
   ============================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wsDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  },

  /* 主进程要求保存（关闭窗口时选了「先保存再退出」） */
  onMenuSave: function (cb) {
    ipcRenderer.on('menu-save', function () { cb(); });
  },

  /* 下载结果回调：{ state, name, path } */
  onDownloadDone: function (cb) {
    ipcRenderer.on('download-done', function (e, payload) { cb(payload); });
  },

  /* 请求主进程退出（保存完成后再调用） */
  requestQuit: function () {
    ipcRenderer.send('app-quit');
  }
});
