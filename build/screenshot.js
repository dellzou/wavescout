/* ============================================================
   screenshot.js — 用 Chrome CDP 截整页图（本机 stdout 被吞，只能走调试协议）
   用法：node build/screenshot.js <项目.json|-> <out.png> [页面里要执行的JS]
   例：  node build/screenshot.js proj.json out.png "WS._ui.setMode('device')"
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'ws-shot-' + process.pid);
const projArg = process.argv[2];
const OUT = process.argv[3] || path.join(ROOT, 'shot.png');
const SETUP = process.argv[4] || '';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome'); process.exit(2); }

/* ---------------- 最小 WebSocket 客户端（RFC6455，够用即可） ---------------- */
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write('GET ' + u.pathname + ' HTTP/1.1\r\n' +
        'Host: ' + u.host + '\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf = Buffer.alloc(0);
    let handshook = false;
    const listeners = [];

    function send(obj) {
      const data = Buffer.from(JSON.stringify(obj));
      const mask = crypto.randomBytes(4);
      const len = data.length;
      let header;
      if (len < 126) {
        header = Buffer.from([0x81, 0x80 | len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
      }
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i % 4];
      sock.write(Buffer.concat([header, mask, masked]));
    }

    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (!handshook) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.slice(0, i).toString();
        if (head.indexOf('101') < 0) { reject(new Error('WS 握手失败: ' + head.split('\r\n')[0])); return; }
        buf = buf.slice(i + 4);
        handshook = true;
        resolve({ send, on: f => listeners.push(f), close: () => sock.destroy() });
      }
      while (buf.length >= 2) {
        const b0 = buf[0], b1 = buf[1];
        let len = b1 & 127, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) break;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if ((b0 & 15) === 1) {
          let msg = null;
          try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
          listeners.forEach(f => f(msg));
        }
      }
    });
    sock.on('error', reject);
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => { b += c; });
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cp(src, dst) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(f => cp(path.join(src, f), path.join(dst, f)));
  } else fs.copyFileSync(src, dst);
}

(async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(TMP, 'index.html'));
  ['assets', 'js'].forEach(d => cp(path.join(ROOT, d), path.join(TMP, d)));
  if (projArg && projArg !== '-') fs.copyFileSync(projArg, path.join(TMP, 'project.json'));

  const boot = `
(function(){
  function ready(){
    if (!window.WS || !WS._ui) { setTimeout(ready, 60); return; }
    var next = function(){ window.__SHOT_READY = 1; };
    if (!window.__HAS_PROJECT) { setTimeout(next, 300); return; }
    fetch('project.json').then(function(r){ return r.text(); }).then(function(t){
      WS._ui.applyProject(WS.deserialize(t));
      WS._ui.setMode('device');
      WS.fitView();
      setTimeout(function(){ WS._ui.rebuildHeat(); setTimeout(next, 2600); }, 400);
    });
  }
  if (document.readyState === 'complete') setTimeout(ready, 120);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(ready, 120); });
})();`;

  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' data: blob:; ' +
    'script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src *;">');
  html = html.replace('</body>',
    '<script>window.__HAS_PROJECT = ' + (projArg && projArg !== '-' ? 'true' : 'false') + ';</script>\n<script>' + boot + '</script>\n</body>');
  fs.writeFileSync(path.join(TMP, '_shot.html'), html, 'utf8');

  const port = 9400 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--window-size=1560,980',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(TMP, '_profile'),
    'file:///' + path.join(TMP, '_shot.html').replace(/\\/g, '/')
  ], { stdio: 'ignore' });

  function kill() {
    try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) {}
  }

  try {
    let list = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const raw = await httpGet('http://127.0.0.1:' + port + '/json/list');
        const arr = JSON.parse(raw);
        list = arr.filter(t => t.type === 'page' && t.webSocketDebuggerUrl)[0];
        if (list) break;
      } catch (e) { /* 还没起来 */ }
    }
    if (!list) throw new Error('连不上 CDP');

    const ws = await wsConnect(list.webSocketDebuggerUrl);
    let seq = 0;
    const waiting = {};
    ws.on(m => {
      if (m.id && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; }
    });
    const cmd = (method, params) => new Promise(res => {
      const id = ++seq;
      waiting[id] = res;
      ws.send({ id, method, params: params || {} });
    });

    await cmd('Page.enable');
    await cmd('Emulation.setDeviceMetricsOverride', {
      width: 1560, height: 980, deviceScaleFactor: 1, mobile: false
    });

    /* 等页面做完初始化 + 可选 setup */
    let readyOk = false;
    for (let i = 0; i < 60; i++) {
      const r = await cmd('Runtime.evaluate', { expression: 'window.__SHOT_READY === 1', returnByValue: true });
      if (r.result && r.result.result && r.result.result.value === true) { readyOk = true; break; }
      await sleep(300);
    }
    if (!readyOk) console.log('[shot] 警告：页面未报告就绪，仍然截图');

    /* 可选：模拟指定视口尺寸，用于检查响应式布局（环境变量 SHOT_W / SHOT_H / SHOT_DPR） */
    const VW = parseInt(process.env.SHOT_W || '0', 10);
    const VH = parseInt(process.env.SHOT_H || '0', 10);
    if (VW > 0 && VH > 0) {
      await cmd('Emulation.setDeviceMetricsOverride', {
        width: VW, height: VH,
        deviceScaleFactor: parseFloat(process.env.SHOT_DPR || '1'),
        mobile: false
      });
      await sleep(600);
      console.log('[shot] 视口设为 ' + VW + '×' + VH);
    }

    /* 就绪后再执行准备脚本，错误由 CDP 直接回传 */
    if (SETUP) {
      const r = await cmd('Runtime.evaluate', { expression: SETUP, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) {
        console.error('[shot] 准备脚本报错: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
      } else if (r.result && r.result.result) {
        console.log('[shot] 准备脚本返回: ' + JSON.stringify(r.result.result.value));
      }
      await sleep(700);
    }
    await sleep(400);

    const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (!shot.result || !shot.result.data) throw new Error('截图返回为空');
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log('[shot] 已保存 ' + OUT);

    /* 顺手回传一些状态，方便断言 */
    const info = await cmd('Runtime.evaluate', {
      expression: 'JSON.stringify({ap:(WS.state.project.aps||[]).length,obs:(WS.state.project.obstacles||[]).length,sel:WS.state.selIds.length,kind:WS.state.selKind,mode:WS.state.mode,val:document.getElementById("zVal").textContent})',
      returnByValue: true
    });
    console.log('[shot] 状态 ' + (info.result.result.value || ''));
    ws.close();
    kill();
    process.exit(0);
  } catch (e) {
    console.error('[shot] 失败: ' + e.message);
    kill();
    process.exit(1);
  }
})();
