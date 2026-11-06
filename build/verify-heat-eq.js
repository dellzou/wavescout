/* ============================================================
   verify-heat-eq.js —— 热力图 / 重叠区计算的数值等价性对照

   背景：computeHeat 与 computeOverlap 曾各自内联约 60 行完全相同的
   「方向图 + 穿墙 + FSPL」，v1.8.3 抽出公共内核 pointRssi()。
   重构最大的风险是「数值悄悄变了」，而 e2e 只断言结构不比对数值，
   所以这里做逐像素位级比对：同一份固定工程，分别用旧/新 core.js 计算，
   输出的网格必须逐字节一致。

   用法：
     node build/verify-heat-eq.js js/core.js                 # 打印摘要
     node build/verify-heat-eq.js old.js new.js              # 比对两份实现
     node build/verify-heat-eq.js old.js new.js --bench      # 额外测耗时（各 10 轮，取均值）
   ============================================================ */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/* 在沙箱里加载 core.js：它只依赖 window，不需要 DOM（canvas 只在压缩函数里用到） */
function loadCore(file) {
  const ctx = { window: {}, Math, console, Date, JSON };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  const WS = ctx.window.WS;
  if (!WS) throw new Error('core.js 没有挂载 window.WS');
  return WS;
}

/* 固定测试工程：覆盖全向 / 定向 / 侧装 / 自定义波束 / 停用 / 5GHz / 多材质墙 */
function buildFixture(WS) {
  const p = WS.newProject();
  p.imgW = 1600;
  p.imgH = 1200;
  p.mpp = 0.04;
  p.settings.band = '5';
  p.settings.channel = 36;
  p.settings.bw = 80;
  p.settings.freq = WS.chMhz('5', 36);

  const walls = [
    [100, 100, 700, 100, 'brick', 24],
    [700, 100, 700, 620, 'concrete', 20],
    [700, 620, 120, 620, 'glass', 10],
    [120, 620, 120, 100, 'drywall', 12],
    [300, 100, 300, 400, 'brick', 12],
    [300, 400, 520, 400, 'metal', 2],
    [520, 400, 520, 620, 'concrete', 30],
    [900, 200, 1400, 200, 'brick', 24],
    [1400, 200, 1400, 900, 'glass', 10],
    [900, 900, 1400, 900, 'drywall', 12],
    [1000, 400, 1300, 400, 'concrete', 24]
  ];
  p.obstacles = walls.map((w, i) => WS.normalizeObstacle({
    id: 'o' + i, x1: w[0], y1: w[1], x2: w[2], y2: w[3], type: w[4], thick: w[5]
  }));

  p.aps = [
    { id: 'a1', x: 400, y: 300, mount: 'ceiling', power: 20, gain: 4, azimuth: 0 },
    { id: 'a2', x: 1100, y: 500, mount: 'panel', power: 18, gain: 9, azimuth: 45 },
    { id: 'a3', x: 200, y: 800, mount: 'wall', power: 16, gain: 6, azimuth: 135,
      band: '24', channel: 6, bw: 20 },
    { id: 'a4', x: 800, y: 850, mount: 'panel', power: 22, gain: 12, azimuth: 270,
      hpbwH: 65, hpbwV: 30 },
    { id: 'a5', x: 1350, y: 1050, mount: 'ceiling', power: 100, gain: 3, azimuth: 0,
      enabled: false }
  ];
  return p;
}

/* 位级摘要：值逐位相同才算等价，避免 1e-15 的漂移被四舍五入掩盖 */
function digest(grid) {
  const view = new Uint8Array(grid.data.buffer, grid.data.byteOffset, grid.data.byteLength);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < view.length; i++) {
    h1 = (h1 ^ view[i]) * 16777619 >>> 0;
    h2 = (h2 + view[i] * (i % 251 + 1)) >>> 0;
  }
  let sum = 0, min = Infinity, max = -Infinity, above = 0;
  for (let i = 0; i < grid.data.length; i++) {
    const v = grid.data[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v > -85) above++;
  }
  return {
    gw: grid.gw, gh: grid.gh,
    cell: +grid.cell.toFixed(6),
    empty: !!grid.empty,
    count: grid.data.length,
    sum: +sum.toFixed(3),
    min: min === -Infinity ? null : +min.toFixed(4),
    max: max === -Infinity ? null : +max.toFixed(4),
    above: above,
    hash1: h1.toString(16), hash2: h2.toString(16)
  };
}

function run(file) {
  const WS = loadCore(file);
  const p = buildFixture(WS);
  const out = {
    version: WS.VERSION,
    heat: {},
    overlap: {}
  };
  ['draft', 'normal', 'high'].forEach(q => {
    out.heat[q] = digest(WS.computeHeat(p, q));
  });
  [-67, -75].forEach(thr => {
    const g = WS.computeOverlap(p, thr, 'draft');
    out.overlap['thr' + thr] = Object.assign(digest(g), {
      cellCount: g.count, thr: g.thr
    });
  });
  /* 单点读数也走同一套模型，顺手一起锁死（rssiAt 返回 { rssi, ap }） */
  out.rssiAt = [[400, 300], [1100, 500], [60, 60], [1500, 1150]].map(function (pt) {
    var r = WS.rssiAt(p, pt[0], pt[1]);
    return WS.round(r.rssi, 4);
  });
  return out;
}

function bench(file, label) {
  const WS = loadCore(file);
  const p = buildFixture(WS);
  for (let i = 0; i < 3; i++) { WS.computeHeat(p, 'normal'); WS.computeOverlap(p, -67, 'draft'); }
  let t = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) WS.computeHeat(p, 'normal');
  const heat = Number(process.hrtime.bigint() - t) / 1e6 / 10;
  t = process.hrtime.bigint();
  for (let i = 0; i < 10; i++) WS.computeOverlap(p, -67, 'draft');
  const ov = Number(process.hrtime.bigint() - t) / 1e6 / 10;
  console.log(label.padEnd(5), 'heat(normal) ' + heat.toFixed(1) + ' ms',
              '| overlap(draft) ' + ov.toFixed(1) + ' ms');
}

function main() {
  const argv = process.argv.slice(2).filter(x => x !== '--bench');
  const wantBench = process.argv.includes('--bench');
  const args = argv;
  if (!args.length) {
    console.log('用法: node build/verify-heat-eq.js <core.js> [new-core.js] [--bench]');
    process.exit(1);
  }

  const a = args[0];
  const resA = run(a);

  if (args.length === 1) {
    console.log(JSON.stringify(resA, null, 2));
    if (wantBench) bench(a, 'A');
    return;
  }

  const resB = run(args[1]);
  const diffs = [];
  /* version 是我们特意要改的，不参与数值比对 */
  const SKIP = new Set(['version']);
  const walk = (pa, pb, label) => {
    if (SKIP.has(label)) return;
    if (typeof pa === 'number' && typeof pb === 'number') {
      if (Math.abs(pa - pb) > 1e-9) diffs.push(`${label}: ${pa} → ${pb}`);
      return;
    }
    if (pa && typeof pa === 'object' && pb && typeof pb === 'object') {
      const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
      keys.forEach(k => walk(pa[k], pb[k], label ? label + '.' + k : k));
      return;
    }
    if (pa !== pb) diffs.push(`${label}: ${JSON.stringify(pa)} → ${JSON.stringify(pb)}`);
  };
  walk(resA, resB, '');

  console.log('旧实现版本:', resA.version, '| 新实现版本:', resB.version);
  console.log('网格规模:', resA.heat.normal.gw + 'x' + resA.heat.normal.gh);
  console.log('抽样 RSSI:', JSON.stringify(resA.rssiAt));

  if (wantBench) {
    bench(a, '旧');
    bench(args[1], '新');
    bench(a, '旧');
    bench(args[1], '新');
  }

  if (!diffs.length) {
    console.log('✅ 逐位一致：热力图 3 档 + 重叠区 2 档 + 单点读数全部相同');
    return;
  }
  console.log('❌ 发现 ' + diffs.length + ' 处差异：');
  diffs.slice(0, 40).forEach(d => console.log('   ' + d));
  process.exit(1);
}

main();
