/* ============================================================
   文档构建：把 使用说明.md 转成可直接双击阅读的 使用说明.html
   用法：node build/md2html.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, '使用说明.md'), 'utf8');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

const lines = src.split(/\r?\n/);
let out = [], i = 0, inCode = false, codeBuf = [], listType = null;

function closeList() { if (listType) { out.push('</' + listType + '>'); listType = null; } }

while (i < lines.length) {
  const line = lines[i];

  if (/^```/.test(line)) {
    if (inCode) { out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; inCode = false; }
    else { closeList(); inCode = true; }
    i++; continue;
  }
  if (inCode) { codeBuf.push(line); i++; continue; }
  if (/^\s*$/.test(line)) { closeList(); i++; continue; }
  if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }

  if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
    closeList();
    const parseRow = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const head = parseRow(line);
    i += 2;
    const rows = [];
    while (i < lines.length && /^\|/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
    let t = '<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>';
    rows.forEach(r => { t += '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'; });
    out.push(t + '</tbody></table>');
    continue;
  }

  if (/^>\s?/.test(line)) {
    closeList();
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
    out.push('<blockquote>' + buf.map(b => inline(b)).join('<br>') + '</blockquote>');
    continue;
  }

  const hm = line.match(/^(#{1,6})\s+(.*)$/);
  if (hm) {
    closeList();
    const lv = hm[1].length;
    out.push('<h' + lv + '>' + inline(hm[2]) + '</h' + lv + '>');
    i++; continue;
  }

  if (/^\s*[-*]\s+/.test(line)) {
    if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
    out.push('<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
    i++; continue;
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
    out.push('<li>' + inline(line.replace(/^\s*\d+\.\s+/, '')) + '</li>');
    i++; continue;
  }

  closeList();
  out.push('<p>' + inline(line) + '</p>');
  i++;
}
closeList();
if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>勘波 WaveScout · 使用说明</title>
<style>
:root{--bg:#0f141b;--bg2:#141a22;--bg3:#1a222c;--line:#27313d;--txt:#e3ecf5;--txt2:#9aabbe;--txt3:#6b7c90;--accent:#38bdf8;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",sans-serif;font-size:14px;line-height:1.85;}
.wrap{max-width:920px;margin:0 auto;padding:44px 30px 90px;}
h1{font-size:28px;margin:0 0 6px;letter-spacing:1px;background:linear-gradient(90deg,#38bdf8,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent;}
h2{font-size:18px;margin:44px 0 14px;padding-bottom:9px;border-bottom:1px solid var(--line);letter-spacing:.3px;}
h2::before{content:"";display:inline-block;width:4px;height:16px;background:var(--accent);border-radius:2px;margin-right:10px;vertical-align:-2px;}
h3{font-size:15px;margin:26px 0 10px;color:#bfd4e6;font-weight:600;}
p{margin:10px 0;color:var(--txt2);}
b,strong{color:var(--txt);font-weight:600;}
a{color:var(--accent);}
code{background:#0b1017;border:1px solid var(--line);border-radius:4px;padding:1px 6px;font-family:Consolas,monospace;font-size:12.5px;color:#7dd3fc;}
pre{background:#0b1017;border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:14px 0;}
pre code{border:none;background:none;padding:0;color:#a5c9e0;font-size:12.5px;line-height:1.75;}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;background:var(--bg2);border-radius:8px;overflow:hidden;}
th,td{padding:9px 13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;}
th{background:var(--bg3);color:var(--txt3);font-weight:600;font-size:12px;letter-spacing:.5px;}
td{color:var(--txt2);}
tr:last-child td{border-bottom:none;}
td b,td strong{color:var(--txt);}
ul,ol{margin:10px 0;padding-left:24px;color:var(--txt2);}
li{margin:5px 0;}
hr{border:none;border-top:1px solid var(--line);margin:34px 0;}
blockquote{margin:14px 0;padding:11px 16px;background:rgba(56,189,248,.07);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;color:var(--txt2);}
blockquote p{margin:0;}
@media (max-width:700px){.wrap{padding:24px 16px 60px}table{font-size:12px}th,td{padding:7px 9px}}
</style>
</head>
<body><div class="wrap">
${out.join('\n')}
</div></body>
</html>`;

fs.writeFileSync(path.join(ROOT, '使用说明.html'), html);
console.log('使用说明.html 已生成: ' + html.length + ' 字节');
