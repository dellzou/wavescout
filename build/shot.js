/* ============================================================
   shot.js — 用真实项目文件渲染一张画布快照（验证用）
   用法：node build/shot.js "项目.json" [输出png]
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'ws-shot-' + process.pid);
const OUT = process.argv[3] || path.join(ROOT, 'shot.png');
const projFile = process.argv[2];

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));

function cp(src, dst) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(f => cp(path.join(src, f), path.join(dst, f)));
  } else fs.copyFileSync(src, dst);
}

fs.mkdirSync(TMP, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(TMP, 'index.html'));
['assets', 'js'].forEach(d => cp(path.join(ROOT, d), path.join(TMP, d)));
fs.copyFileSync(projFile, path.join(TMP, 'project.json'));

const shotScript = `
(function(){
  function go(){
    if (!window.WS || !WS._ui) { setTimeout(go, 60); return; }
    fetch('project.json').then(function(r){ return r.text(); }).then(function(t){
      var p = WS.deserialize(t);
      WS._ui.applyProject(p);
      WS._ui.setMode('device');
      WS.fitView();
      setTimeout(function(){
        WS._ui.rebuildHeat();
        setTimeout(function(){
          var cv = document.getElementById('cv');
          var info = { w: cv.width, h: cv.height };
          var st = WS.state;
          if (st.heat && !st.heat.empty) {
            var s = WS.coverageStats(st.project, st.heat);
            info.ap = st.project.aps.length;
            info.obs = st.project.obstacles.length;
            info.pct = Math.round(s.pct * 10) / 10;
            info.area = Math.round(s.coveredArea);
            info.gw = st.heat.gw; info.gh = st.heat.gh;
          }
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/shot', true);
          xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
          xhr.send(JSON.stringify({ png: cv.toDataURL('image/png'), info: info }));
        }, 2600);
      }, 400);
    });
  }
  if (document.readyState === 'complete') setTimeout(go, 150);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(go, 150); });
})();
`;

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(
  /<meta http-equiv="Content-Security-Policy"[^>]*>/,
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' \'unsafe-inline\' data: blob:; ' +
  'script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src *;">'
);
html = html.replace('</body>', '<script>' + shotScript + '</script>\n</body>');
fs.writeFileSync(path.join(TMP, '_shot.html'), html, 'utf8');

let chrome = null;
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {                       /* 预检 / 其他请求直接放行 */
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    res.end();
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', c => { body += c; });
  req.on('end', () => {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    if (!body) return;                                /* 空体忽略，别提前退出 */
    try {
      const d = JSON.parse(body);
      fs.writeFileSync(OUT, Buffer.from(d.png.split(',')[1], 'base64'));
      console.log('[shot] 已保存 ' + OUT);
      console.log('[shot] ' + JSON.stringify(d.info));
    } catch (e) {
      console.error('[shot] 解析失败: ' + e.message);
    }
    cleanup(0);
  });
});

function cleanup(code) {
  try { if (chrome && chrome.pid) execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch (e) {}
  try { server.close(); } catch (e) {}
  setTimeout(() => process.exit(code), 150);
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  html = html.replace("xhr.open('POST', '/shot'", "xhr.open('POST', 'http://127.0.0.1:" + port + "/shot'");
  fs.writeFileSync(path.join(TMP, '_shot.html'), html, 'utf8');

  const url = 'file:///' + path.join(TMP, '_shot.html').replace(/\\/g, '/');
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--allow-file-access-from-files', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1560,980',
    '--user-data-dir=' + path.join(TMP, '_profile'),
    url
  ], { stdio: 'ignore' });
  chrome.on('error', e => { console.error('[shot] 启动失败 ' + e.message); cleanup(2); });
  console.log('[shot] 渲染中…');
});

setTimeout(() => { console.error('[shot] 超时'); cleanup(3); }, 60000);
