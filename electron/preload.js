/* ============================================================
   勘波 WaveScout — preload
   在隔离上下文中向渲染层暴露最小桌面能力

   作者：邹宁（2004-04-17，广东广州）· © 2026 邹宁 版权所有
   ============================================================ */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  },

  /* ---- 项目文件保存：记住路径，Ctrl+S 直接写回，不再每次弹框 ---- */
  saveProjectFile: function (payload) {
    return ipcRenderer.invoke('project:save', payload);
  },

  /* 打开文件后登记它的真实路径，之后保存直接存回原文件 */
  setSavePath: function (key, filePath) {
    return ipcRenderer.invoke('project:set-path', { key: key, path: filePath });
  },

  getSavePath: function (key) {
    return ipcRenderer.invoke('project:get-path', key);
  },

  /* 取本地文件的真实路径（浏览器出于安全不暴露，Electron 提供 webUtils） */
  pathForFile: function (file) {
    try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; }
  }
});
