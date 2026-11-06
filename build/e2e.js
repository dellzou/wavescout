/* ============================================================
   e2e.js — 端到端回归
   做法：把 index.html 复制成 _test.html（放宽 CSP）→ 注入断言脚本
        → 启动系统 Chrome --headless → 页面跑完断言后 POST 回本地服务
   用法：node build/e2e.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
/* 每次跑用独立目录：Chrome 的 Crashpad 会锁住 profile，复用同一路径会 EBUSY */
const TMP = path.join(os.tmpdir(), 'ws-e2e-' + process.pid);

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));

if (!CHROME) {
  console.error('[e2e] 找不到 Chrome / Edge');
  process.exit(2);
}

/* 本机 Node 22 上 fs.cpSync 会直接崩掉（退出码 127），改用递归复制 */
function cp(src, dst) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(f => cp(path.join(src, f), path.join(dst, f)));
  } else {
    fs.copyFileSync(src, dst);
  }
}

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(TMP, 'index.html'));
['assets', 'js', 'test'].forEach(d => cp(path.join(ROOT, d), path.join(TMP, d)));

/* ---- 启动本地回传服务 ---- */
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.indexOf('/report') === 0) {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      onResult(body);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

let finished = false;
let chrome = null;

function cleanup(code) {
  try { if (chrome && chrome.pid) execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) {}
  try { server.close(); } catch (e) {}
  setTimeout(() => process.exit(code), 120);
}

function onResult(body) {
  if (finished) return;
  finished = true;
  console.log(body.trim());
  const m = /SUM:\s*(\d+)\s*pass,\s*(\d+)\s*fail/.exec(body);
  const code = (m && parseInt(m[2], 10) === 0) ? 0 : 1;
  cleanup(code);
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;

  /* ---- 生成测试页：放宽 CSP + 注入回传地址与断言脚本 ---- */
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' data: blob:; ' +
    'script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; ' +
    'img-src \'self\' data: blob:; connect-src *;">'
  );
  html = html.replace('</body>',
    '<script>window.__E2E_REPORT_URL = "http://127.0.0.1:' + port + '/report";</script>\n' +
    '<script src="test/e2e-inject.js"></script>\n</body>');
  fs.writeFileSync(path.join(TMP, '_test.html'), html, 'utf8');

  const url = 'file:///' + path.join(TMP, '_test.html').replace(/\\/g, '/');
  console.log('[e2e] ' + path.basename(CHROME) + ' → ' + url);

  chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,1000',
    '--user-data-dir=' + path.join(TMP, '_profile'),
    url
  ], { stdio: 'ignore' });

  chrome.on('error', e => {
    console.error('[e2e] 启动失败: ' + e.message);
    cleanup(2);
  });
});

/* 兜底超时 */
setTimeout(() => {
  if (!finished) {
    finished = true;
    console.error('[e2e] 超时：页面 60 秒内没有回传结果');
    cleanup(3);
  }
}, 60000);
