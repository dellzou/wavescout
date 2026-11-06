/* 多频段穿墙衰减一致性验证
   场景：一堵墙（手动衰减 2.4G=4 dB / 5G=30 dB），AP 在墙左、测点在墙右。
   项目级频段固定 2.4G，只改 AP 自己的频段：
     · AP=2.4G → 穿墙应取 4 dB
     · AP=5G   → 穿墙应取 30 dB（修复前仍是 4 dB，因为它读的是项目频段）
*/
const fs = require('fs');
const vm = require('vm');

const sb = {
  window: {}, Math, JSON, Float32Array, Uint8Array, Int32Array,
  Object, Array, String, Number, isFinite, parseFloat, parseInt, console
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(__dirname + '/../js/core.js', 'utf8'), sb);
const WS = sb.window.WS;

function mkProj(apBand, apCh, apBw, legacyWall) {
  const p = WS.newProject();
  p.imgW = 400; p.imgH = 200; p.mpp = 0.05; p.calibrated = true;
  p.settings.band = '24';
  p.settings.channel = 1;
  p.settings.bw = 20;
  p.settings.freq = 2437;
  p.obstacles = [];

  const w = WS.makeObstacle('brick', 100, 0, 100, 200);
  w.autoAtten = false;
  w.atten24 = 4;
  w.atten5 = 30;
  w.thick = 0.12;
  if (legacyWall) w.atten5 = w.atten24;      /* 模拟修复前：5G 也取 2.4G 的衰减 */
  p.obstacles.push(w);

  const ap = WS.makeAp('ceiling', 50, 100, 1);
  if (apBand) { ap.band = apBand; ap.channel = apCh; ap.bw = apBw; }
  p.aps = [ap];
  return p;
}

const PX = 150, PY = 100;                    /* 墙右侧 2.5 m 处 */

function heatAt(p, cellApprox) {
  const h = WS.computeHeat(p, 'draft');
  const gx = Math.min(h.gw - 1, Math.floor(PX / h.cell));
  const gy = Math.min(h.gh - 1, Math.floor(PY / h.cell));
  return h.data[gy * h.gw + gx];
}

const r24 = WS.rssiAt(mkProj(null), PX, PY).rssi;
const r5new = WS.rssiAt(mkProj('5', 36, 80, false), PX, PY).rssi;
const r5old = WS.rssiAt(mkProj('5', 36, 80, true), PX, PY).rssi;

const h24 = heatAt(mkProj(null));
const h5new = heatAt(mkProj('5', 36, 80, false));
const h5old = heatAt(mkProj('5', 36, 80, true));

const f = v => v.toFixed(2);
console.log('单点 rssiAt（测点距 AP 5 m，穿墙 1 堵）');
console.log('  AP=2.4G                       : ' + f(r24) + ' dBm');
console.log('  AP=5G   修复后（穿墙 30 dB）  : ' + f(r5new) + ' dBm   Δ=' + f(r24 - r5new));
console.log('  AP=5G   修复前（穿墙 4 dB）   : ' + f(r5old) + ' dBm   Δ=' + f(r24 - r5old));
console.log('');
console.log('热力图 computeHeat（同一测点）');
console.log('  AP=2.4G                       : ' + f(h24) + ' dBm');
console.log('  AP=5G   修复后                : ' + f(h5new) + ' dBm   Δ=' + f(h24 - h5new));
console.log('  AP=5G   修复前                : ' + f(h5old) + ' dBm   Δ=' + f(h24 - h5old));
console.log('');

const dNew = r24 - r5new;
const dOld = r24 - r5old;
const expect = 26;                           /* 衰减差 30-4 */
const ok = (dNew > dOld + expect * 0.8) &&
           (Math.abs(h5new - r5new) < 1.5) &&
           (Math.abs(h24 - r24) < 1.5);
console.log('判据：');
console.log('  ① 5G 相对 2.4G 的下降应≥' + (expect * 0.8).toFixed(0) + ' dB（含衰减差） : ' +
  (dNew > dOld + expect * 0.8 ? 'PASS' : 'FAIL') + '  实测 ' + f(dNew));
console.log('  ② 热力图与该点单点读数一致（误差 <1.5 dB）              : ' +
  (Math.abs(h5new - r5new) < 1.5 && Math.abs(h24 - r24) < 1.5 ? 'PASS' : 'FAIL') +
  '  h5=' + f(h5new) + ' rssi5=' + f(r5new));
console.log('');
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 1);
