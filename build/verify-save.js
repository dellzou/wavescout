/* 验证保存逻辑：预置记住的路径后，saveProjectFile 应直接写盘、不弹框 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const USERDATA = path.join(process.env.APPDATA, 'WaveScout');
const SAVE_STATE = path.join(USERDATA, 'recent-save.json');
const OUTDIR = path.join(os.tmpdir(), 'ws-savetest');
const OUT = path.join(OUTDIR, '记住的路径.wssurvey.json');
const KEY = '测试项目';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function () {
  fs.mkdirSync(OUTDIR, { recursive: true });
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  fs.mkdirSync(USERDATA, { recursive: true });

  /* 预置：这个项目名 -> 输出路径（模拟「上次已经保存过」） */
  const backup = fs.existsSync(SAVE_STATE) ? fs.readFileSync(SAVE_STATE, 'utf8') : null;
  fs.writeFileSync(SAVE_STATE, JSON.stringify({ [KEY]: OUT }), 'utf8');

  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  const child = spawn(ELECTRON, ['.', '--debug-cdp'], { cwd: ROOT, env, stdio: 'ignore' });
  let ok = false;

  try {
    /* 等 CDP 端口就绪 */
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const r = await fetch('http://127.0.0.1:9222/json');
        const list = await r.json();
        targets = list.filter(t => t.type === 'page');
        if (targets.length) break;
      } catch (e) { /* 还没起来 */ }
    }
    if (!targets || !targets.length) throw new Error('CDP 未就绪');

    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    function cmd(method, params) {
      return new Promise((resolve, reject) => {
        const mid = ++id;
        const onMsg = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.id === mid) { ws.removeEventListener('message', onMsg); resolve(m); }
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => reject(new Error('CDP 超时: ' + method)), 20000);
      });
    }

    const expr = `(async () => {
      const r = await window.wsDesktop.saveProjectFile({
        content: '{"probe":"记住路径测试"}',
        filename: '记住的路径.wssurvey.json',
        key: '${KEY}',
        forceDialog: false
      });
      return JSON.stringify(r);
    })()`;

    const res = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const val = res.result && res.result.result && res.result.result.value;
    console.log('IPC 返回:', val);

    const parsed = JSON.parse(val || '{}');
    const wrote = fs.existsSync(OUT);
    const body = wrote ? fs.readFileSync(OUT, 'utf8') : '';

    console.log('文件已写入:', wrote, wrote ? '(' + body.length + ' 字节)' : '');
    console.log('内容正确:', body.indexOf('记住路径测试') >= 0);
    console.log('返回路径匹配:', parsed.path === OUT);

    /* 再检查一次：刚才那次调用没有弹框（如果弹了，awaitPromise 会一直挂着直到超时） */
    console.log('未弹框（调用直接返回）:', parsed.ok === true);
    ok = parsed.ok === true && wrote && body.indexOf('记住路径测试') >= 0;

    ws.close();
  } catch (e) {
    console.log('失败:', e.message);
  } finally {
    try { child.kill(); } catch (e) {}
    await sleep(1200);
    if (backup === null) { try { fs.unlinkSync(SAVE_STATE); } catch (e) {} }
    else { fs.writeFileSync(SAVE_STATE, backup, 'utf8'); }
    console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
    process.exit(ok ? 0 : 1);
  }
})();
