/* 门口效应：整墙 vs 开门 vs 门与墙重叠，横向扫描看"扩散"宽度 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sandbox = {
  window: {}, Math, JSON, Float32Array, Uint8Array, Int32Array,
  Object, Array, String, Number, isFinite, parseFloat, parseInt, console, Date,
  document: {
    createElement: function () {
      return {
        width: 0, height: 0,
        getContext: function () {
          return {
            createImageData: function (w, h) { return { data: new Uint8Array(w * h * 4) }; },
            putImageData: function () {}
          };
        }
      };
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8'), sandbox);
const WS = sandbox.window.WS;

function base() {
  const p = WS.newProject();
  p.imgW = 1200; p.imgH = 800; p.mpp = 0.02; p.calibrated = true;
  p.settings.band = '5'; p.settings.channel = 36; p.settings.bw = 80;
  p.settings.freq = WS.chMhz('5', 36);
  p.settings.pathLossN = WS.defaultN(5180);
  p.obstacles = [];
  p.aps = [WS.makeAp('ceiling', 200, 400, 1)];
  return p;
}

function solidWall() {
  const p = base();
  p.obstacles.push(WS.makeObstacle('brick', 600, 100, 600, 700));
  return p;
}
function doorOpen() {
  const p = base();
  p.obstacles.push(WS.makeObstacle('brick', 600, 100, 600, 350));
  p.obstacles.push(WS.makeObstacle('wood', 600, 350, 600, 450));
  p.obstacles.push(WS.makeObstacle('brick', 600, 450, 600, 700));
  return p;
}
function doorOverlap() {
  const p = doorOpen();
  p.obstacles.push(WS.makeObstacle('brick', 600, 350, 600, 450));
  return p;
}

const rssi = (p, x, y) => { const r = WS.rssiAt(p, x, y); return typeof r === 'number' ? r : r.rssi; };

console.log('材质衰减（5180 MHz）：砖墙 ' + WS.obAtten(WS.makeObstacle('brick', 0, 0, 1, 0), 5180) +
  ' dB，木门 ' + WS.obAtten(WS.makeObstacle('wood', 0, 0, 1, 0), 5180) + ' dB');

const S = [['整墙', solidWall()], ['开门', doorOpen()], ['门+墙重叠', doorOverlap()]];

console.log('\n== 正对门口的中轴线上 ==');
console.log('  位置            整墙    开门   门+重叠');
[[500, 400], [650, 400], [800, 400], [1000, 400], [1150, 400]].forEach(function (pt) {
  const row = S.map(function (s) { return rssi(s[1], pt[0], pt[1]).toFixed(1).padStart(6); });
  console.log('  (' + pt[0] + ',' + pt[1] + ')' + ' '.repeat(Math.max(1, 10 - String(pt[0]).length)) + row.join('  '));
});

console.log('\n== 门后 2m 处横向扫描（x=900，y 从 250 到 550） ==');
console.log('  y    ' + S.map(s => s[0].padStart(8)).join('  '));
for (let y = 250; y <= 550; y += 25) {
  console.log('  ' + String(y).padEnd(5) + S.map(s => rssi(s[1], 900, y).toFixed(1).padStart(8)).join('  '));
}

/* 统计 x=900 处"还能画出来"的横向宽度：阈值 -85（绘制下限） */
console.log('\n== 门后可见宽度（RSSI >= -85 的横向跨度，x=900） ==');
S.forEach(function (s) {
  let first = null, last = null;
  for (let y = 100; y <= 700; y++) {
    if (rssi(s[1], 900, y) >= -85) { if (first === null) first = y; last = y; }
  }
  const w = (first === null) ? 0 : (last - first);
  console.log('  ' + s[0].padEnd(10) + (first === null ? '完全不可见' : (first + ' ~ ' + last + '，宽 ' + w + ' px = ' + (w * 0.02).toFixed(2) + ' m')));
});

/* 门洞本身宽度 */
console.log('\n门洞宽度 350~450 = 100 px = ' + (100 * 0.02).toFixed(2) + ' m');
