/* ============================================================
   bench-heat.js — 用真实项目文件量热力图计算耗时
   用法：node build/bench-heat.js "D:\path\to\project.wssurvey.json"
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* core.js 只依赖 window 命名空间，不碰 DOM，直接跑在 Node 里 */
const sandbox = { window: {}, Math, JSON, Date, console, Float32Array, Uint8Array, Int32Array, isFinite, parseFloat, parseInt };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8'), sandbox, { filename: 'core.js' });

const WS = sandbox.window.WS;
const file = process.argv[2];
if (!file) {
  console.error('用法: node build/bench-heat.js <项目文件.wssurvey.json>');
  process.exit(2);
}

const proj = WS.deserialize(fs.readFileSync(file, 'utf8'));
console.log('项目: ' + proj.name);
console.log('图纸: ' + proj.imgW + ' × ' + proj.imgH + ' px，障碍物 ' + proj.obstacles.length + ' 段，AP ' + proj.aps.length + ' 台，频段 ' + proj.settings.freq + ' MHz');
console.log('');

function bench(label, quality, times) {
  /* 预热一次，避免 JIT 影响第一次计时 */
  WS.computeHeat(proj, quality);
  const t0 = process.hrtime.bigint();
  let grid = null;
  for (let i = 0; i < times; i++) grid = WS.computeHeat(proj, quality);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6 / times;
  console.log(
    label.padEnd(22) + ms.toFixed(1).padStart(8) + ' ms/次' +
    '   网格 ' + grid.gw + '×' + grid.gh + ' = ' + (grid.gw * grid.gh).toLocaleString() + ' 格'
  );
  return ms;
}

const draft = bench('拖动时的草稿质量', 'draft', 3);
const normal = bench('松手后的精细质量', 'normal', 2);

console.log('');
console.log('按一次拖动平均 40 帧计算（旧行为：拖动中每 70 ms 出一张草稿，约 6 次）:');
console.log('  旧行为拖动一次  ≈ ' + (draft * 6).toFixed(0) + ' ms 计算 + 6 次全图重绘');
console.log('  新行为拖动一次  ≈ 0 ms（松手后只算 1 次 ' + normal.toFixed(0) + ' ms）');
console.log('  单次拖动省下    ≈ ' + (draft * 6).toFixed(0) + ' ms CPU');
