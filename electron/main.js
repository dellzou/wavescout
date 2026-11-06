/* ============================================================
   勘波 WaveScout — Electron 主进程
   ============================================================
   职责：
     · 创建无菜单栏的应用窗口，加载 app 内的 index.html
     · 接管所有下载请求，弹原生「另存为」对话框
     · 屏蔽浏览器快捷键、页面导航、window.open
     · 关闭前检查未保存修改
     · 记忆窗口位置与尺寸

   作者：邹宁（2004-04-17，广东广州）
   著作权：本软件由邹宁个人独立开发，著作权归作者所有。
   © 2026 邹宁 版权所有  All Rights Reserved.
   ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const APP_ID = 'com.aursen.wavescout';
const APP_TITLE = '勘波 WaveScout';
const AUTHOR = '邹宁';           // 作者签名（个人独立开发，著作权归作者）
const DEFAULT_W = 1560;
const DEFAULT_H = 980;
const MIN_W = 1180;
const MIN_H = 720;

let mainWindow = null;
let forceClose = false;     // 已确认退出，跳过 close 拦截
let pendingClose = false;   // 用户选了「先保存再退出」

/* ---- 调试开关（正常使用不会触发） ---- */
if (process.argv.indexOf('--debug-cdp') >= 0) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

/* ------------------------------------------------------------
   窗口状态记忆
   ------------------------------------------------------------ */
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (!s || typeof s.width !== 'number') return null;
    // 校验窗口是否还在可见屏幕范围内（换显示器后可能跑到屏幕外）
    const displays = screen.getAllDisplays();
    const visible = displays.some(function (d) {
      const b = d.workArea;
      return s.x >= b.x - 80 && s.x <= b.x + b.width - 120 &&
             s.y >= b.y - 40 && s.y <= b.y + b.height - 120;
    });
    if (!visible) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({
      x: b.x, y: b.y, width: b.width, height: b.height,
      maximized: win.isMaximized()
    }), 'utf8');
  } catch (e) { /* 忽略 */ }
}

/* ------------------------------------------------------------
   主窗口
   ------------------------------------------------------------ */
function createWindow() {
  const st = loadWindowState();

  mainWindow = new BrowserWindow({
    width: st ? st.width : DEFAULT_W,
    height: st ? st.height : DEFAULT_H,
    x: st ? st.x : undefined,
    y: st ? st.y : undefined,
    minWidth: MIN_W,
    minHeight: MIN_H,
    title: APP_TITLE,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0f141b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webgl: true
    }
  });

  // 彻底移除菜单栏（否则 Ctrl+R / Ctrl+P / DevTools 等快捷键会生效）
  Menu.setApplicationMenu(null);

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', function () {
    if (st && st.maximized) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();

    /* 自检模式：WS_CAPTURE=<png路径> 启动时截图并退出，用于回归验证 */
    if (process.env.WS_CAPTURE) {
      setTimeout(function () {
        const target = process.env.WS_CAPTURE;
        const demo = process.env.WS_DEMO;

        const task = demo
          ? mainWindow.webContents.executeJavaScript(
              '(function(){var b=document.getElementById("btnEmptyDemo");if(b){b.click();return "clicked";}return "no-button";})()'
            ).then(function () {
              return new Promise(function (r) { setTimeout(r, 2000); });
            })
          : Promise.resolve();

        task.then(function () {
          return mainWindow.webContents.capturePage();
        }).then(function (img) {
          try {
            fs.writeFileSync(target, img.toPNG());
            console.log('[capture] saved to ' + target);
          } catch (e) {
            console.error('[capture] ' + e.message);
          }
          setTimeout(function () { app.exit(0); }, 300);
        }).catch(function (e) {
          console.error('[capture] ' + e.message);
          app.exit(1);
        });
      }, 2600);
    }
  });

  // 禁止整页缩放（画布自己有缩放，Ctrl+滚轮/捏合不应改变 UI 尺寸）
  try { mainWindow.webContents.setVisualZoomLevelLimits(1, 1); } catch (e) {}

  /* ---- 快捷键拦截 ---- */
  mainWindow.webContents.on('before-input-event', function (event, input) {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;

    // 单键
    if (key === 'f5' || key === 'f12' || key === 'f11') {
      event.preventDefault();
      return;
    }
    if (!ctrl) return;

    // Ctrl+Shift+I 开发者工具
    if (input.shift && key === 'i') { event.preventDefault(); return; }

    // 这些组合交给页面自己处理，放行
    const allowed = ['s', 'o', 'z', 'y', 'a', 'c', 'v', 'x'];
    if (allowed.indexOf(key) >= 0) return;

    // 其余浏览器级组合全部拦掉：刷新、打印、查找、跳转、缩放、关闭、新窗口
    const blocked = ['r', 'p', 'f', 'g', 'j', 'u', 'w', 'n', 't', '+', '-', '=', '0', '1', '2', '3'];
    if (blocked.indexOf(key) >= 0) event.preventDefault();
  });

  /* ---- 右键菜单（仅输入框 / 选中文本） ---- */
  mainWindow.webContents.on('context-menu', function (e, params) {
    let tpl = null;
    if (params.isEditable) {
      tpl = [
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { type: 'separator' },
        { role: 'selectAll', label: '全选' }
      ];
    } else if (params.selectionText && params.selectionText.trim()) {
      tpl = [{ role: 'copy', label: '复制' }];
    }
    if (tpl) Menu.buildFromTemplate(tpl).popup({ window: mainWindow });
  });

  /* ---- 关闭确认 ---- */
  mainWindow.on('close', function (e) {
    if (forceClose) return;
    e.preventDefault();

    mainWindow.webContents.executeJavaScript(
      '!!(window.WS && window.WS.state && window.WS.state.dirty)'
    ).then(function (dirty) {
      if (!dirty) { doClose(); return; }
      const r = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['取消', '不保存并退出', '先保存再退出'],
        defaultId: 2,
        cancelId: 0,
        noLink: true,
        title: APP_TITLE,
        message: '当前项目有未保存的修改',
        detail: '建议先保存项目文件（.wssurvey.json），以免丢失。'
      });
      if (r === 1) {
        doClose();
      } else if (r === 2) {
        pendingClose = true;
        mainWindow.webContents.send('menu-save');
        // 兜底：若保存对话框 20 秒内没有结果，不强行退出
        setTimeout(function () {
          if (pendingClose) {
            pendingClose = false;
            dialog.showMessageBoxSync(mainWindow, {
              type: 'info', buttons: ['知道了'], noLink: true,
              title: APP_TITLE,
              message: '尚未完成保存',
              detail: '保存操作似乎没有完成，窗口将保持打开。请手动导出项目后再关闭。'
            });
          }
        }, 20000);
      }
    }).catch(function () {
      doClose();
    });
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function doClose() {
  if (!mainWindow) return;
  saveWindowState(mainWindow);
  forceClose = true;
  mainWindow.close();
}

/* ------------------------------------------------------------
   项目文件保存
   目标：第一次保存弹一次框，之后 Ctrl+S 直接写回同一个文件
   做法：主进程记住「项目名 → 路径」的映射，存在 userData 下
   ------------------------------------------------------------ */
function saveStateFile() {
  return path.join(app.getPath('userData'), 'recent-save.json');
}

function readSaveState() {
  try {
    const o = JSON.parse(fs.readFileSync(saveStateFile(), 'utf8'));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) {
    return {};
  }
}

function writeSaveState(all) {
  try {
    fs.writeFileSync(saveStateFile(), JSON.stringify(all), 'utf8');
  } catch (e) { /* 记不住就下次再弹框，不致命 */ }
}

function setupSaveHandler() {
  /* 保存 / 另存为。forceDialog=true 时强制弹框 */
  ipcMain.handle('project:save', async function (evt, payload) {
    const p = payload || {};
    const filename = p.filename || '未命名项目.wssurvey.json';
    const key = p.key || filename;
    const content = (p.content == null) ? '' : String(p.content);
    const all = readSaveState();
    let target = null;

    if (!p.forceDialog) {
      const cached = all[key];
      /* 目录还在就直接写回；文件被删了也没关系，writeFileSync 会重建 */
      if (cached && fs.existsSync(path.dirname(cached))) target = cached;
    }

    if (!target) {
      const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
      const r = await dialog.showSaveDialog(parent, {
        title: p.forceDialog ? '另存为' : '保存项目',
        defaultPath: all[key] || path.join(app.getPath('documents'), filename),
        filters: [
          { name: 'WaveScout 项目', extensions: ['json', 'wssurvey'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        buttonLabel: '保存'
      });
      if (!r || r.canceled || !r.filePath) return { ok: false, cancelled: true };
      target = r.filePath;
    }

    try {
      fs.writeFileSync(target, content, 'utf8');
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), path: target };
    }
    all[key] = target;
    writeSaveState(all);

    /* 关窗时选了「先保存再退出」：保存走的是这条路（不再经过 will-download），
       所以退出要在这里接上，否则窗口会卡在「尚未完成保存」的提示上 */
    if (pendingClose) {
      pendingClose = false;
      setTimeout(doClose, 160);
    }

    return { ok: true, path: target };
  });

  /* 打开文件后，把真实路径登记成该项目的保存位置 */
  ipcMain.handle('project:set-path', function (evt, payload) {
    const p = payload || {};
    if (!p.key || !p.path) return false;
    const all = readSaveState();
    all[p.key] = p.path;
    writeSaveState(all);
    return true;
  });

  /* 查询某项目是否已有记住的路径（界面提示用） */
  ipcMain.handle('project:get-path', function (evt, key) {
    const all = readSaveState();
    return all[key] || null;
  });
}

/* ------------------------------------------------------------
   便携版：退出后清理 %TEMP% 里的解压目录
   便携版 exe 是自解压包，每次运行把 230 MB 运行时解到
   %TEMP%\<解压目录>，而且退出后不会自己删。留着有两个麻烦：
     · 白占 230 MB
     · 下次启动、或另一个实例同时在跑时，解压会撞上被占用的文件
   这里在退出时起一个 detached 的 cmd，等进程真正退出后再删。
   删不掉也不影响使用（下次启动会覆盖）。
   ------------------------------------------------------------ */
function schedulePortableCleanup() {
  if (!process.env.PORTABLE_EXECUTABLE_FILE) return;   // 不是便携版

  let target;
  try { target = path.resolve(path.dirname(process.execPath)); } catch (e) { return; }

  const tmpRoot = path.resolve(app.getPath('temp'));
  const t = target.toLowerCase();
  const tr = tmpRoot.toLowerCase();

  /* 护栏：只删 %TEMP% 下面、名字以 WaveScout 开头的目录，避免误删 */
  if (t === tr) return;
  if (t.indexOf(tr + path.sep) !== 0) return;
  if (!/^wavescout/i.test(path.basename(target))) return;

  /* 退出的瞬间 exe/dll 还被系统持有，而且实测目录句柄会滞留十几秒，
     所以不能只试一两次：循环重试 8 次、每次间隔约 1.5 秒。
     删成功之后再执行是无害的（目录已不存在，报错被丢弃）。 */
  const cmd =
    'for /L %i in (1,1,8) do @(rmdir /s /q "' + target + '" 2>nul & ping 127.0.0.1 -n 2 >nul)';
  try {
    spawn('cmd.exe', ['/c', cmd], {
      detached: true, stdio: 'ignore', windowsHide: true
    }).unref();
  } catch (e) { /* 忽略 */ }
}

/* ------------------------------------------------------------
   下载接管：所有 a[download] 都走原生另存为
   ------------------------------------------------------------ */
function setupDownloadHandler() {
  session.defaultSession.on('will-download', function (event, item) {
    const filename = item.getFilename() || '未命名文件';
    const ext = path.extname(filename).replace(/^\./, '');
    const filters = [];
    if (ext) filters.push({ name: ext.toUpperCase() + ' 文件', extensions: [ext] });
    filters.push({ name: '所有文件', extensions: ['*'] });

    let savePath = null;
    try {
      const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
      savePath = dialog.showSaveDialogSync(parent, {
        title: '保存文件',
        defaultPath: path.join(app.getPath('documents'), filename),
        filters: filters,
        buttonLabel: '保存'
      });
    } catch (e) {
      savePath = null;
    }

    if (!savePath) {
      item.cancel();
      notifyDownload({ state: 'cancelled', name: filename, path: null });
      return;
    }

    item.setSavePath(savePath);

    item.once('done', function (e, state) {
      notifyDownload({
        state: state,               // completed | cancelled | interrupted
        name: filename,
        path: savePath
      });
      if (state === 'completed' && pendingClose) {
        pendingClose = false;
        setTimeout(doClose, 260);
      } else if (pendingClose) {
        pendingClose = false;
      }
    });
  });
}

function notifyDownload(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-done', payload);
  }
}

/* ------------------------------------------------------------
   导航防护
   ------------------------------------------------------------ */
function hardenNavigation() {
  app.on('web-contents-created', function (e, wc) {
    wc.on('will-navigate', function (ev) { ev.preventDefault(); });
    wc.on('will-frame-navigate', function (ev) { ev.preventDefault(); });
    wc.setWindowOpenHandler(function (info) {
      // 外链一律交给系统浏览器，绝不开新窗口
      if (/^https?:/i.test(info.url)) shell.openExternal(info.url);
      return { action: 'deny' };
    });
    wc.on('will-attach-webview', function (ev) { ev.preventDefault(); });
  });
}

/* ------------------------------------------------------------
   生命周期
   ------------------------------------------------------------ */
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  /* 作者与著作权：写进系统「关于」信息里（作者个人开发，版权归作者） */
  try {
    app.setAboutPanelOptions({
      applicationName: APP_TITLE,
      applicationVersion: app.getVersion() + ' · ' + AUTHOR,
      version: '',
      copyright: '© 2026 ' + AUTHOR + ' 版权所有 All Rights Reserved.'
    });
  } catch (e) { /* 部分平台不支持，忽略 */ }

  app.whenReady().then(function () {
    hardenNavigation();
    setupSaveHandler();
    setupDownloadHandler();
    createWindow();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', function () {
    app.quit();
  });

  /* 退出前安排清理便携版解压目录（延迟到进程真正退出后执行） */
  app.on('will-quit', function () {
    schedulePortableCleanup();
  });

  // 渲染层请求退出（保存完成后由页面主动调用）
  ipcMain.on('app-quit', function () {
    doClose();
  });
}
