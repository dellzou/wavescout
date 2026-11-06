/* ============================================================
   core.js — 数据模型 · 几何 · 无线传播模型 · 热力图计算

   作者：邹宁
   出生日期：2004-04-17
   所在地：广东广州
   著作权：本软件（勘波 WaveScout）由邹宁个人独立开发完成，
           著作权归作者本人所有。未经作者书面许可，不得复制、
           修改、分发、商用或用于衍生作品。
   © 2026 邹宁 版权所有  All Rights Reserved.
   ============================================================ */
window.WS = window.WS || {};
(function (WS) {
  'use strict';

  /* 作者与著作权信息（界面「关于」、导出文件、状态栏共用同一份数据） */
  WS.AUTHOR = {
    name: '邹宁',
    birth: '2004-04-17',
    city: '广东广州',
    product: '勘波 WaveScout',
    year: '2026',
    notice: '本软件由邹宁个人独立开发，著作权归作者所有。未经许可不得复制、修改、分发或商用。'
  };

  var D2R = Math.PI / 180;
  WS.D2R = D2R;
  WS.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  WS.uid = function () { return Math.random().toString(36).slice(2, 10); };
  WS.round = function (v, n) { var k = Math.pow(10, n || 0); return Math.round(v * k) / k; };

  /* ------------------------------------------------------------
     1. 预设
     ------------------------------------------------------------ */

  WS.AP_PRESETS = {
    ceiling: {
      key: 'ceiling', label: '吸顶全向', short: '吸顶',
      power: 20, gain: 4,
      hpbwH: 360, hpbwV: 78, fb: 0, downtilt: 90,
      color: '#38bdf8', accent: '#0ea5e9',
      desc: '吸顶安装。水平面 360° 全向；垂直面向下辐射，覆盖半径随安装高度增大，越远俯仰损耗越大。'
    },
    wall: {
      key: 'wall', label: '壁挂定向', short: '壁挂',
      power: 20, gain: 8,
      hpbwH: 76, hpbwV: 62, fb: 20, downtilt: 20,
      color: '#f59e0b', accent: '#d97706',
      desc: '壁挂安装。前向高增益窄波束，后向抑制约 20 dB。适合走廊、长条形车间与隧道。'
    },
    panel: {
      key: 'panel', label: '面板入墙', short: '面板',
      power: 17, gain: 3,
      hpbwH: 112, hpbwV: 82, fb: 25, downtilt: 0,
      color: '#34d399', accent: '#059669',
      desc: '86 面板入墙安装。前向宽波束、小功率，背面几乎无穿透。适合酒店客房、独立办公室。'
    }
  };

  /* 障碍物材质预设
     数值取自 TP-LINK 官方《无线规划工具》工程文件中的实测值：
       atten24 / atten5 —— 2.4 GHz / 5 GHz 单次穿透损耗（dB），双频各自独立
       thick            —— 默认厚度（米）
       dash             —— 画布线型（玻璃窗、木门用虚线，砖墙与混凝土实线） */
  WS.OB_TYPES = {
    /* rate24 / rate5 = 每毫米穿透损耗（dB/mm），由「预设衰减 ÷ 预设厚度」得到；
       开启自动衰减后，实际损耗 = rate × 厚度(mm) */
    brick:    { key: 'brick',    label: '砖墙',   atten24: 4,  atten5: 7,  thick: 0.12, rate24: 4 / 120,  rate5: 7 / 120,  color: '#d76432', dash: [] },
    concrete: { key: 'concrete', label: '混凝土', atten24: 25, atten5: 30, thick: 0.24, rate24: 25 / 240, rate5: 30 / 240, color: '#788c96', dash: [] },
    glass:    { key: 'glass',    label: '玻璃窗', atten24: 8,  atten5: 10, thick: 0.08, rate24: 8 / 80,   rate5: 10 / 80,  color: '#28d4a3', dash: [4, 5] },
    wood:     { key: 'wood',     label: '木门',   atten24: 3,  atten5: 4,  thick: 0.04, rate24: 3 / 40,   rate5: 4 / 40,   color: '#f0b446', dash: [11, 6] },
    custom:   { key: 'custom',   label: '自定义', atten24: 10, atten5: 14, thick: 0.10, rate24: 10 / 100, rate5: 14 / 100, color: '#a78bfa', dash: [7, 5] }
  };

  /* 按厚度算穿透损耗（dB），保留 1 位小数 */
  WS.attenFor = function (cfg, thickM, five) {
    var mm = (thickM != null ? thickM : cfg.thick) * 1000;
    if (!(mm > 0)) mm = 0;
    var rate = five ? cfg.rate5 : cfg.rate24;
    return WS.round(rate * mm, 1);
  };

  /* 旧版材质 key → 新版 key（打开老项目文件时迁移用） */
  WS.OB_ALIAS = { wall: 'brick', door: 'wood', window: 'glass', column: 'concrete' };

  /* 旧 key 以不可枚举方式指向新配置：
     兼容 render.js 中 `WS.OB_TYPES[type] || WS.OB_TYPES.wall` 这类兜底写法，
     保证老数据渲染时不会取到 undefined。 */
  (function () {
    var olds = ['wall', 'door', 'window', 'column'];
    for (var i = 0; i < olds.length; i++) {
      (function (k) {
        Object.defineProperty(WS.OB_TYPES, k, {
          get: function () { return WS.OB_TYPES[WS.OB_ALIAS[k]]; },
          enumerable: false,
          configurable: true
        });
      })(olds[i]);
    }
  })();

  /* 取材质配置，未知 key 一律兜底为砖墙 */
  WS.obCfg = function (type) {
    if (type && WS.OB_TYPES[type]) return WS.OB_TYPES[type];
    var alias = WS.OB_ALIAS[type];
    if (alias && WS.OB_TYPES[alias]) return WS.OB_TYPES[alias];
    return WS.OB_TYPES.brick;
  };

  /* 旧 key 归一化为新 key（旧 key 的别名属性会命中 OB_TYPES，所以先查映射表） */
  WS.obTypeKey = function (type) {
    if (type && WS.OB_ALIAS[type]) return WS.OB_ALIAS[type];
    if (type && WS.OB_TYPES[type]) return type;
    return 'brick';
  };

  /* 某个障碍物在当前频段下的穿透损耗（兼容只有 atten 的旧数据） */
  WS.obAtten = function (o, fMHz) {
    var five = fMHz > 4000;

    /* 自动衰减：直接由材质 + 当前厚度算出，改厚度立刻生效。
       用 !== false 判断，与属性面板保持一致（undefined 也视为自动） */
    if (o.autoAtten !== false) {
      var acfg = WS.obCfg(o.type);
      return WS.attenFor(acfg, o.thick, five);
    }

    var v = five ? o.atten5 : o.atten24;
    if (v == null && o.atten != null) {
      v = five ? WS.round(o.atten * 1.35, 1) : o.atten;
    }
    if (v == null) {
      var c = WS.obCfg(o.type);
      v = five ? c.atten5 : c.atten24;
    }
    return v;
  };

  /* 单值衰减数据迁移：atten → atten24 / atten5，并归一化 type */
  WS.normalizeObstacle = function (o) {
    if (!o || typeof o !== 'object') return o;
    var cfg = WS.obCfg(o.type);
    o.type = WS.obTypeKey(o.type);
    var hadAtten = (o.atten24 != null || o.atten5 != null || o.atten != null);
    if (o.atten24 == null) o.atten24 = (o.atten != null) ? o.atten : cfg.atten24;
    if (o.atten5 == null) o.atten5 = (o.atten != null) ? WS.round(o.atten * 1.35, 1) : cfg.atten5;
    if (o.thick == null) o.thick = cfg.thick;
    if ('atten' in o) delete o.atten;

    /* 老数据没有这个字段：若两侧衰减都还贴着预设值，就视为「自动」；手改过则保持手动 */
    if (o.autoAtten == null) {
      if (!hadAtten) {
        /* 老数据里压根没存衰减值 → 直接按当前厚度自动算，
           否则厚度非预设值时会被误判成「手动」，衰减永久冻结 */
        o.autoAtten = true;
        o.atten24 = WS.attenFor(cfg, o.thick, false);
        o.atten5 = WS.attenFor(cfg, o.thick, true);
      } else {
        var a24 = WS.attenFor(cfg, o.thick, false);
        var a5 = WS.attenFor(cfg, o.thick, true);
        o.autoAtten = (Math.abs(a24 - o.atten24) < 0.35 && Math.abs(a5 - o.atten5) < 0.35);
      }
    }
    return o;
  };

  /* 信号色阶：红 → 橙 → 黄 → 绿 → 紫（强到弱） */
  WS.BANDS = [
    { min: -50, name: '极强', rgb: [239, 68, 68],  hex: '#ef4444' },
    { min: -60, name: '强',   rgb: [249, 115, 22], hex: '#f97316' },
    { min: -67, name: '良好', rgb: [250, 204, 21], hex: '#facc15' },
    { min: -75, name: '一般', rgb: [34, 197, 94],  hex: '#22c55e' },
    { min: -85, name: '弱',   rgb: [168, 85, 247], hex: '#a855f7' }
  ];

  /* 热力图绘制下限：色带最弱一档。低于此值才算真正的「无信号」 */
  WS.HEAT_FLOOR = WS.BANDS[WS.BANDS.length - 1].min;

  /* 平面编辑手感参数 —— 两个「默认值」同时也是滑条的中间值 */
  WS.VERSION = '1.8.1';

  /* 底图压缩策略：dataURL 超过这个体积才尝试重编码；收益不到 15% 就保留原图。
     只对线稿/扫描件做一次（WebP 有损 q0.95），尺寸不变，坐标与标定不受影响。 */
  WS.BACKDROP_TRY_BYTES = 500 * 1024;
  WS.BACKDROP_MIN_GAIN = 0.85;      // 软件版本（界面「关于」与文档共用）
  WS.SNAP_PX = 8;         // 端点吸附半径默认值（屏幕像素），滑条范围 0 ~ SNAP_MAX_PX
  WS.SNAP_MAX_PX = 16;    // 吸附半径上限（默认值的 2 倍）
  WS.ORTHO_RATIO = 0.16;  // 直线修正阈值默认值：短边/长边 < 0.16（约 9.1°）即拉直
  WS.ORTHO_MAX = 0.32;    // 修正阈值上限（默认值的 2 倍，约 17.7°）

  WS.FREQS = [
    { mhz: 2412, label: '2.4 GHz · Ch.1' },
    { mhz: 2437, label: '2.4 GHz · Ch.6' },
    { mhz: 2462, label: '2.4 GHz · Ch.11' },
    { mhz: 5180, label: '5 GHz · Ch.36 (低)' },
    { mhz: 5200, label: '5 GHz · Ch.40' },
    { mhz: 5500, label: '5 GHz · Ch.100 (中)' },
    { mhz: 5745, label: '5 GHz · Ch.149 (高)' }
  ];

  /* ------------------------------------------------------------
     频段 / 信道 / 频宽
     信道号 → 中心频点：
       2.4 GHz  Ch.1 = 2412 MHz，每信道 +5 MHz
       5 GHz    Ch.n = 5000 + n×5 MHz（Ch.36 = 5180）
     占用频率区间： [中心 − 10, 中心 − 10 + 频宽]
       （Wi-Fi 子载波向低频侧展开，Ch.36@80M 占 5170~5250）
     ------------------------------------------------------------ */
  WS.BANDS_INFO = {
    '24': {
      key: '24', label: '2.4 GHz', short: '2.4G',
      channels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      bws: [20, 40],
      chMhz: function (ch) { return 2412 + (ch - 1) * 5; }
    },
    '5': {
      key: '5', label: '5 GHz', short: '5G',
      channels: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120,
                 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
      bws: [20, 40, 80, 160],
      chMhz: function (ch) { return 5000 + ch * 5; }
    }
  };

  /* ------------------------------------------------------------
     射频区域（监管域）
     只做「可用信道 + EIRP 上限」两件事，用于规划阶段校验；
     数值取自公开法规整理，仅作工程参考，实际部署以当地最新法规为准。
       CN —— 工信部 129 号文 / 52 号公告：2.4G ≤20 dBm（天线增益<10dBi）、
             5150–5350 ≤23 dBm（限室内）、5725–5850 ≤33 dBm
       AU —— ACMA LIPD Class Licence（Schedule 1, Table 8）：
             2.4G 4000 mW(36 dBm)、5150–5350 200 mW(23 dBm)、
             5470–5725 1000 mW(30 dBm)、5725–5850 4000 mW(36 dBm)
     ------------------------------------------------------------ */
  WS.REGIONS = {
    CN: {
      key: 'CN', label: '中国', full: '中国 · SRRC',
      ch24: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      ch5: [36, 40, 44, 48, 52, 56, 60, 64, 149, 153, 157, 161, 165],
      eirp: [
        { lo: 2400, hi: 2483.5, dbm: 20, note: '天线增益 <10 dBi' },
        { lo: 5150, hi: 5350, dbm: 23, note: '限室内' },
        { lo: 5725, hi: 5850, dbm: 33, note: '' }
      ]
    },
    AU: {
      key: 'AU', label: '澳大利亚', full: '澳大利亚 · ACMA',
      ch24: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      /* 5600–5650（Ch.120）留给气象雷达，澳洲不允许使用 */
      ch5: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116,
            124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
      eirp: [
        { lo: 2400, hi: 2483.5, dbm: 36, note: '' },
        { lo: 5150, hi: 5250, dbm: 23, note: '限室内' },
        { lo: 5250, hi: 5350, dbm: 23, note: '限室内 · DFS' },
        { lo: 5470, hi: 5725, dbm: 30, note: 'DFS' },
        { lo: 5725, hi: 5850, dbm: 36, note: '' }
      ]
    }
  };

  WS.regionOf = function (key) { return WS.REGIONS[key] || WS.REGIONS.CN; };

  /* 该区域、该频段可用的信道号 */
  WS.channelsOf = function (bandKey, regionKey) {
    var r = WS.regionOf(regionKey);
    return (bandKey === '5' ? r.ch5 : r.ch24).slice();
  };

  /* 该区域、该中心频点的 EIRP 上限（dBm）；找不到返回 null */
  WS.eirpLimit = function (regionKey, mhz) {
    var r = WS.regionOf(regionKey);
    for (var i = 0; i < r.eirp.length; i++) {
      var e = r.eirp[i];
      if (mhz >= e.lo && mhz <= e.hi) return e;
    }
    return null;
  };

  /* 信道号 → 中心频点（频段由 bandKey 决定） */
  WS.chMhz = function (bandKey, ch) {
    var b = WS.BANDS_INFO[bandKey] || WS.BANDS_INFO['24'];
    return b.chMhz(ch);
  };

  /* 由中心频点反推最接近的信道号 */
  WS.nearestChannel = function (bandKey, mhz) {
    var b = WS.BANDS_INFO[bandKey] || WS.BANDS_INFO['24'];
    var best = b.channels[0], bd = Infinity;
    for (var i = 0; i < b.channels.length; i++) {
      var d = Math.abs(b.chMhz(b.channels[i]) - mhz);
      if (d < bd) { bd = d; best = b.channels[i]; }
    }
    return best;
  };

  /* 某个 AP 实际生效的射频参数（ap 上没设就跟随项目） */
  WS.apRf = function (ap, st) {
    var band = ap.band || st.band || '24';
    var b = WS.BANDS_INFO[band] || WS.BANDS_INFO['24'];
    var ch = (ap.channel != null) ? ap.channel : st.channel;
    var bw = (ap.bw != null) ? ap.bw : st.bw;
    /* 信道必须属于当前频段：切换频段后残留的旧信道（如 2.4G 频段 + Ch.149）
       会算出 3152 MHz 这种不存在的频率，必须回退到该频段的第一个信道 */
    if (b.channels.indexOf(ch) < 0) {
      var stBand = WS.BANDS_INFO[st.band || '24'] || b;
      ch = (stBand.channels.indexOf(st.channel) >= 0) ? st.channel : b.channels[0];
    }
    if (b.bws.indexOf(bw) < 0) bw = b.bws[0];
    var mhz = b.chMhz(ch);
    return {
      band: band, channel: ch, bw: bw, mhz: mhz,
      lo: mhz - 10, hi: mhz - 10 + bw,
      follow: (ap.channel == null && ap.bw == null && !ap.band)
    };
  };

  /* 两段频率区间是否有交叠（重叠判定的第一道门槛） */
  WS.rfOverlap = function (a, b) {
    return a.lo < b.hi && b.lo < a.hi;
  };

  /* 信道 + 频宽的简短描述，例如 "Ch.36 · 80MHz" */
  WS.rfLabel = function (rf) {
    return 'Ch.' + rf.channel + ' · ' + rf.bw + 'MHz';
  };

  /* ------------------------------------------------------------
     2. 项目数据结构
     ------------------------------------------------------------ */

  WS.newProject = function () {
    return {
      format: 'wireless-survey',
      version: 1,
      name: '未命名项目',
      image: null,
      imgW: 1240,
      imgH: 900,
      mpp: 0.05,                 // 米 / 像素
      calibrated: false,
      scaleRef: null,            // {x1,y1,x2,y2, meters}
      obstacles: [],
      aps: [],
      settings: {
        freq: 2412,                // 中心频点（由 band/channel 派生，供传播计算使用）
        band: '24',                // 频段：'24' | '5'
        channel: 1,                // 信道号（全项目统一，默认 2.4G 走 Ch.1）
        bw: 20,                    // 频宽 MHz（2.4G: 20/40；5G: 20/40/80/160）
        region: 'CN',              // 射频区域：CN 中国 / AU 澳大利亚
        overlapThr: -67,           // 重叠判定阈值（dBm）：两侧都高于它才算同频干扰
        pathLossN: 2.8,
        autoN: true,
        apHeightCeiling: 2.9,
        apHeightWall: 2.2,
        apHeightPanel: 1.3,
        rxHeight: 1.1,
        minRssi24: -65,            // 2.4 GHz 覆盖判定门限
        minRssi5: -65              // 5 GHz 覆盖判定门限
      },
      createdAt: Date.now()
    };
  };

  /* ------------------------------------------------------------
     楼层数据模型：项目(doc) → 楼宇(building) → 楼层(floor)

       · 楼层的字段形状与 v1 的 project 完全一致（底图 / 标定 / 墙体 / AP / 设置），
         所以既有的绘制、计算、导出代码继续围绕「当前楼层」工作，不必改写；
       · 唯一标识：每个楼宇、每个楼层都有 id（b_xxx / f_xxx），引用一律用 id、
         不用数组下标，增删或重排都不会串位；
       · doc.activeBuilding / doc.activeFloor 记录"当前在看哪一层"。
     ------------------------------------------------------------ */
  WS.newFloor = function (name, level) {
    var f = WS.newProject();
    delete f.format;
    delete f.version;
    delete f.createdAt;
    f.id = 'f_' + WS.uid();
    f.name = name || '1F';
    f.level = level || 1;
    return f;
  };

  WS.newBuilding = function (name) {
    var b = { id: 'b_' + WS.uid(), name: name || 'A 栋', floors: [] };
    b.floors.push(WS.newFloor('1F', 1));
    return b;
  };

  WS.newDoc = function (name) {
    var b = WS.newBuilding('A 栋');
    return {
      format: 'wireless-survey',
      version: 2,
      name: name || '未命名项目',
      buildings: [b],
      activeBuilding: b.id,
      activeFloor: b.floors[0].id,
      createdAt: Date.now()
    };
  };

  /* 把「单个平铺项目」包成文档（新建 / 载入示例 / 老接口兼容都用它） */
  WS.wrapDoc = function (flat) {
    var f = (flat && Array.isArray(flat.obstacles)) ? flat : WS.normalizeProject(flat || {});
    var projName = f.name || '未命名项目';
    f.id = f.id || ('f_' + WS.uid());
    f.name = '1F';
    f.level = f.level || 1;
    var b = { id: 'b_' + WS.uid(), name: 'A 栋', floors: [f] };
    return {
      format: 'wireless-survey',
      version: 2,
      name: projName,
      buildings: [b],
      activeBuilding: b.id,
      activeFloor: f.id,
      createdAt: (flat && flat.createdAt) || Date.now()
    };
  };

  WS.findBuilding = function (doc, bid) {
    if (!doc || !Array.isArray(doc.buildings)) return null;
    for (var i = 0; i < doc.buildings.length; i++) {
      if (doc.buildings[i].id === bid) return doc.buildings[i];
    }
    return null;
  };

  /* 返回 { building, floor }；找不到返回 null */
  WS.findFloor = function (doc, fid) {
    if (!doc || !Array.isArray(doc.buildings)) return null;
    for (var i = 0; i < doc.buildings.length; i++) {
      var b = doc.buildings[i];
      for (var j = 0; j < (b.floors || []).length; j++) {
        if (b.floors[j].id === fid) return { building: b, floor: b.floors[j] };
      }
    }
    return null;
  };

  /* 当前楼层：指针失效时回退到第一栋第一层并自我修复 */
  WS.activeFloor = function (doc) {
    if (!doc || !Array.isArray(doc.buildings) || !doc.buildings.length) return null;
    var hit = WS.findFloor(doc, doc.activeFloor);
    if (hit) return hit.floor;
    var b = WS.findBuilding(doc, doc.activeBuilding) || doc.buildings[0];
    var f = b.floors[0];
    doc.activeBuilding = b.id;
    doc.activeFloor = f.id;
    return f;
  };

  WS.setActive = function (doc, bid, fid) {
    var hit = WS.findFloor(doc, fid);
    if (!hit) return false;
    doc.activeBuilding = hit.building.id;
    doc.activeFloor = hit.floor.id;
    return true;
  };

  WS.addBuilding = function (doc, name) {
    var n = doc.buildings.length;
    var fallback = String.fromCharCode(65 + Math.min(n, 25)) + ' 栋';
    var b = WS.newBuilding(name || fallback);
    var curB = WS.activeFloor(doc);
    if (curB && curB.settings && b.floors[0]) {
      b.floors[0].settings = JSON.parse(JSON.stringify(curB.settings));
    }
    doc.buildings.push(b);
    return b;
  };

  WS.addFloor = function (doc, bid, name) {
    var b = WS.findBuilding(doc, bid);
    if (!b) return null;
    var maxLevel = 0;
    for (var i = 0; i < b.floors.length; i++) {
      maxLevel = Math.max(maxLevel, b.floors[i].level || (i + 1));
    }
    var lv = maxLevel + 1;
    var f = WS.newFloor(name || (lv + 'F'), lv);
    /* 新楼层继承「当前楼层」的射频环境（区域 / 频段 / 信道 / 门限 / 层高），
       但不继承几何与标定 —— 换了图纸，墙体和 AP 不该跟着复制过去 */
    var cur = WS.activeFloor(doc);
    if (cur && cur.settings) f.settings = JSON.parse(JSON.stringify(cur.settings));
    b.floors.push(f);
    return f;
  };

  /* 删除楼层：至少保留一层，否则「当前楼层」就不存在了 */
  WS.removeFloor = function (doc, fid) {
    var hit = WS.findFloor(doc, fid);
    if (!hit) return false;
    var b = hit.building;
    if (b.floors.length <= 1) return false;
    var idx = b.floors.indexOf(hit.floor);
    b.floors.splice(idx, 1);
    if (doc.activeFloor === fid) {
      var next = b.floors[Math.max(0, idx - 1)];
      doc.activeBuilding = b.id;
      doc.activeFloor = next.id;
    }
    return true;
  };

  /* 删除楼宇：至少保留一栋 */
  WS.removeBuilding = function (doc, bid) {
    var b = WS.findBuilding(doc, bid);
    if (!b || doc.buildings.length <= 1) return false;
    var idx = doc.buildings.indexOf(b);
    doc.buildings.splice(idx, 1);
    if (doc.activeBuilding === bid) {
      var nb = doc.buildings[Math.max(0, idx - 1)];
      doc.activeBuilding = nb.id;
      doc.activeFloor = nb.floors[0].id;
    }
    return true;
  };

  /* 楼层扁平列表（给下拉框 / 状态栏用） */
  WS.floorOptions = function (doc) {
    var out = [];
    ((doc && doc.buildings) || []).forEach(function (b) {
      (b.floors || []).forEach(function (f) {
        out.push({
          buildingId: b.id, buildingName: b.name,
          floorId: f.id, floorName: f.name, level: f.level,
          active: (b.id === doc.activeBuilding && f.id === doc.activeFloor)
        });
      });
    });
    return out;
  };

  WS.makeAp = function (mount, x, y, index) {
    var p = WS.AP_PRESETS[mount] || WS.AP_PRESETS.ceiling;
    var prefix = mount === 'ceiling' ? 'AP' : (mount === 'wall' ? 'WAP' : 'PAP');
    return {
      id: WS.uid(),
      name: prefix + '-' + (index || 1),
      x: x, y: y,
      mount: mount,
      power: p.power,
      gain: p.gain,
      hpbwH: p.hpbwH,
      hpbwV: p.hpbwV,
      fb: p.fb,
      downtilt: p.downtilt,
      azimuth: mount === 'ceiling' ? 0 : 90,
      height: null,
      /* 射频覆盖：null 表示跟随项目统一设置 */
      band: null,
      channel: null,
      bw: null,
      enabled: true
    };
  };

  WS.makeObstacle = function (type, x1, y1, x2, y2) {
    var key = WS.obTypeKey(type);
    var t = WS.OB_TYPES[key] || WS.OB_TYPES.brick;
    return {
      id: WS.uid(),
      type: key,
      x1: x1, y1: y1, x2: x2, y2: y2,
      /* 新建墙体默认「按厚度自动算衰减」 */
      autoAtten: true,
      atten24: WS.attenFor(t, t.thick, false),
      atten5: WS.attenFor(t, t.thick, true),
      thick: t.thick
    };
  };

  /* 当前频段对应的覆盖判定门限 */
  WS.minRssiOf = function (st) {
    if (!st) return -65;
    if (st.freq > 4000) return st.minRssi5 != null ? st.minRssi5 : (st.minRssi != null ? st.minRssi : -65);
    return st.minRssi24 != null ? st.minRssi24 : (st.minRssi != null ? st.minRssi : -65);
  };

  /* ------------------------------------------------------------
     3. 天线方向图
     ------------------------------------------------------------ */

  /* 半功率角 → cos^n 指数 */
  function nFromHpbw(hpbwDeg) {
    if (hpbwDeg >= 359.5) return 0;
    var c = Math.cos(hpbwDeg / 2 * D2R);
    if (c <= 0.0001) return 50;
    return Math.log(0.5) / Math.log(c);
  }

  /* 水平面定向方向图（含前后比） */
  function horizPattern(deltaRad, hpbwDeg, fbDb, nH) {
    if (hpbwDeg >= 359.5) return 1;
    var c = Math.cos(deltaRad);
    var br = Math.pow(10, -(fbDb || 0) / 10);   /* fb 是功率比 dB，必须 /10 */
    if (c >= 0) {
      var v = Math.pow(c, nH);
      var floor = br * 0.55;
      return v > floor ? v : floor;
    }
    var back = br * c * c;
    return back > 0.0025 ? back : 0.0025;
  }

  WS.antennaParams = function (ap) {
    var p = WS.AP_PRESETS[ap.mount] || WS.AP_PRESETS.ceiling;
    var hpbwV = (ap.hpbwV != null ? ap.hpbwV : p.hpbwV);
    var hpbwH = (ap.hpbwH != null ? ap.hpbwH : p.hpbwH);
    var dt = (ap.downtilt != null ? ap.downtilt : p.downtilt);
    return {
      hpbwH: hpbwH,
      hpbwV: hpbwV,
      fb: (ap.fb != null ? ap.fb : p.fb),
      gain: (ap.gain != null ? ap.gain : p.gain),
      power: (ap.power != null ? ap.power : p.power),
      omni: hpbwH >= 359.5,
      peakElev: (90 - dt) * D2R,
      nH: nFromHpbw(hpbwH),
      nV: nFromHpbw(hpbwV)
    };
  };

  WS.apHeight = function (ap, st) {
    if (ap.height != null && ap.height > 0) return ap.height;
    if (ap.mount === 'ceiling') return st.apHeightCeiling;
    if (ap.mount === 'wall') return st.apHeightWall;
    return st.apHeightPanel;
  };

  /* ------------------------------------------------------------
     4. 路径损耗
     室内对数距离模型：
       PL(dB) = 10·n·lg(d[m]) + 20·lg(f[MHz]) − 27.55
     n = 2 时退化为自由空间；室内通常 2.4G 取 2.6~3.0，5G 取 3.0~3.4
     ------------------------------------------------------------ */
  WS.fspl = function (dMeters, fMHz, n) {
    var d = dMeters < 1 ? 1 : dMeters;
    var k = (n || 2) * 10;
    return k * Math.log10(d) + 20 * Math.log10(fMHz) - 27.55;
  };

  WS.defaultN = function (fMHz) {
    return fMHz > 4000 ? 3.1 : 2.8;
  };

  /* 单点 RSSI（用于鼠标悬停读数、单 AP 探测） */
  WS.rssiAt = function (proj, wx, wy) {
    var st = proj.settings;
    var mpp = proj.mpp || 0.05;
    var fMHz = st.freq;
    var best = -200, bestAp = null;
    var aps = proj.aps;
    for (var i = 0; i < aps.length; i++) {
      var ap = aps[i];
      if (ap.enabled === false) continue;
      var P = WS.antennaParams(ap);
      var h = Math.max(0.25, WS.apHeight(ap, st) - st.rxHeight);
      var dx = wx - ap.x, dy = wy - ap.y;
      var rM = Math.sqrt(dx * dx + dy * dy) * mpp;
      if (rM > 90) continue;        /* 与热力图同一剪枝半径，保证两边读数一致 */
      var d3 = Math.sqrt(rM * rM + h * h);

      var elev = Math.atan2(rM, h);
      var vPat = 1;
      if (P.hpbwV < 359.5) {
        var cV = Math.cos(elev - P.peakElev);
        vPat = cV <= 0 ? 0.0001 : Math.pow(cV, P.nV);
      }

      var hPat = 1;
      if (!P.omni) {
        var dAz = Math.atan2(dx, -dy) - (ap.azimuth || 0) * D2R;
        dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
        hPat = horizPattern(dAz, P.hpbwH, P.fb, P.nH);
      }

      var grel = 10 * Math.log10(vPat * hPat + 1e-10);
      /* 频点、穿墙衰减、路径损耗指数三者必须用同一个频段，否则单点读数与热力图会对不上 */
      var fAp = (ap.channel != null || ap.band) ? WS.apRf(ap, st).mhz : fMHz;
      var loss = WS.wallLoss(proj, ap.x, ap.y, wx, wy, null, fAp);
      var nAp = st.pathLossN || WS.defaultN(fAp);
      var rssi = P.power + P.gain + grel - WS.fspl(d3, fAp, nAp) - loss;
      if (rssi > best) { best = rssi; bestAp = ap; }
    }
    return { rssi: best, ap: bestAp };
  };

  /* 视线穿墙损耗（按当前频段取 2.4G / 5G 对应的材质衰减） */
  WS.wallLoss = function (proj, x1, y1, x2, y2, skipId, fMHz) {
    var total = 0;
    var obs = proj.obstacles;
    var fq = fMHz || (proj.settings && proj.settings.freq) || 2437;
    var ax = x1, ay = y1, bx = x2, by = y2;
    var lo_x = Math.min(ax, bx), hi_x = Math.max(ax, bx);
    var lo_y = Math.min(ay, by), hi_y = Math.max(ay, by);
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (o.id === skipId) continue;
      var cx = o.x1, cy = o.y1, dx2 = o.x2, dy2 = o.y2;
      if (Math.max(cx, dx2) < lo_x || Math.min(cx, dx2) > hi_x) continue;
      if (Math.max(cy, dy2) < lo_y || Math.min(cy, dy2) > hi_y) continue;
      if (segIntersect(ax, ay, bx, by, cx, cy, dx2, dy2)) total += WS.obAtten(o, fq);
      if (total > 80) return 80;
    }
    return total;
  };

  function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    var d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    var d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    var d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  WS.segIntersect = segIntersect;

  /* ------------------------------------------------------------
     5. 热力图计算
     ------------------------------------------------------------ */
  /* 计算网格密度：draft 用于拖动时的即时预览，final 用于静止后的精细渲染 */
  WS.QUALITY = {
    draft: 45000,
    normal: 150000,
    high: 300000
  };

  WS.computeHeat = function (proj, quality) {
    var st = proj.settings;
    var W = proj.imgW || 1000, H = proj.imgH || 800;
    var mpp = proj.mpp || 0.05;
    var fMHz = st.freq;
    var rxH = st.rxHeight;

    var target = (typeof quality === 'number')
      ? quality
      : (WS.QUALITY[quality] || WS.QUALITY.normal);
    /* 源网格越细，后续插值放大倍数越小，边缘越锐利 */
    var cell = Math.max(1.6, Math.sqrt(W * H / target));
    var gw = Math.max(1, Math.ceil(W / cell));
    var gh = Math.max(1, Math.ceil(H / cell));
    var data = new Float32Array(gw * gh);

    /* --- 预取障碍物为扁平数组 --- */
    var obs = proj.obstacles;
    var nSeg = obs.length;
    var sx1 = new Float32Array(nSeg), sy1 = new Float32Array(nSeg);
    var sx2 = new Float32Array(nSeg), sy2 = new Float32Array(nSeg);
    /* 预取两套穿墙衰减：AP 可能单独工作在 2.4G 或 5G，
       若这里仍按项目频段取，会出现「FSPL 按 AP 频点、穿墙按项目频段」的互相矛盾 */
    var sAtt24 = new Float32Array(nSeg);
    var sAtt5 = new Float32Array(nSeg);
    for (var i = 0; i < nSeg; i++) {
      var o = obs[i];
      sx1[i] = o.x1; sy1[i] = o.y1; sx2[i] = o.x2; sy2[i] = o.y2;
      sAtt24[i] = WS.obAtten(o, 2437);
      sAtt5[i] = WS.obAtten(o, 5180);
    }

    /* --- 预取 AP 派生参数 --- */
    var aps = [];
    for (var j = 0; j < proj.aps.length; j++) {
      var ap = proj.aps[j];
      if (ap.enabled === false) continue;
      var P = WS.antennaParams(ap);
      var rfH = WS.apRf(ap, st);
      aps.push({
        x: ap.x, y: ap.y,
        fL: 20 * Math.log10(rfH.mhz),
        nK: 10 * (st.pathLossN || WS.defaultN(rfH.mhz)),
        sAtt: rfH.mhz > 4000 ? sAtt5 : sAtt24,
        h: Math.max(0.25, WS.apHeight(ap, st) - rxH),
        peakElev: P.peakElev,
        hpbwH: P.hpbwH, hpbwV: P.hpbwV,
        nH: P.nH, nV: P.nV,
        fb: P.fb, omni: P.omni,
        gain: P.gain, power: P.power,
        az: (ap.azimuth || 0) * D2R,
        br: Math.pow(10, -(P.fb || 0) / 10)
      });
    }
    var nAp = aps.length;

    if (nAp === 0) {
      return { gw: gw, gh: gh, cell: cell, data: data, empty: true };
    }

    /* 超过这个距离，即使全程无墙也低于色带下限，直接剪枝省掉墙体求交 */
    var maxR2 = Math.pow(90 / mpp, 2);

    var idx = 0;
    for (var gy = 0; gy < gh; gy++) {
      var py = (gy + 0.5) * cell;
      for (var gx = 0; gx < gw; gx++, idx++) {
        var px = (gx + 0.5) * cell;
        var best = -200;

        for (var k = 0; k < nAp; k++) {
          var A = aps[k];
          var dx = px - A.x, dy = py - A.y;
          var r2px = dx * dx + dy * dy;
          if (r2px > maxR2) continue;
          var rM = Math.sqrt(r2px) * mpp;
          var d3 = Math.sqrt(rM * rM + A.h * A.h);

          /* 垂直面 */
          var vPat = 1;
          if (A.hpbwV < 359.5) {
            var cV = Math.cos(Math.atan2(rM, A.h) - A.peakElev);
            vPat = cV <= 0 ? 0.0001 : Math.pow(cV, A.nV);
          }

          /* 水平面 */
          var hPat = 1;
          if (!A.omni) {
            var dAz = Math.atan2(dx, -dy) - A.az;
            dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
            var cH = Math.cos(dAz);
            if (cH >= 0) {
              var v = Math.pow(cH, A.nH);
              var fl = A.br * 0.55;
              hPat = v > fl ? v : fl;
            } else {
              var bk = A.br * cH * cH;
              hPat = bk > 0.0025 ? bk : 0.0025;
            }
          }

          /* 穿墙损耗 */
          var wall = 0;
          var loX = A.x < px ? A.x : px, hiX = A.x < px ? px : A.x;
          var loY = A.y < py ? A.y : py, hiY = A.y < py ? py : A.y;
          for (var s = 0; s < nSeg; s++) {
            var q1x = sx1[s], q1y = sy1[s], q2x = sx2[s], q2y = sy2[s];
            if ((q1x > q2x ? q1x : q2x) < loX || (q1x < q2x ? q1x : q2x) > hiX) continue;
            if ((q1y > q2y ? q1y : q2y) < loY || (q1y < q2y ? q1y : q2y) > hiY) continue;
            var e1 = (px - A.x) * (q1y - A.y) - (py - A.y) * (q1x - A.x);
            var e2 = (px - A.x) * (q2y - A.y) - (py - A.y) * (q2x - A.x);
            if ((e1 > 0 && e2 > 0) || (e1 < 0 && e2 < 0)) continue;
            var e3 = (q2x - q1x) * (A.y - q1y) - (q2y - q1y) * (A.x - q1x);
            var e4 = (q2x - q1x) * (py - q1y) - (q2y - q1y) * (px - q1x);
            if ((e3 > 0 && e4 > 0) || (e3 < 0 && e4 < 0)) continue;
            wall += A.sAtt[s];
            if (wall > 80) { wall = 80; break; }
          }

          var grel = 10 * Math.log10(vPat * hPat + 1e-10);
          var dSafe = d3 < 1 ? 1 : d3;
          var fspl = A.nK * Math.log10(dSafe) + A.fL - 27.55;
          var rssi = A.power + A.gain + grel - fspl - wall;
          if (rssi > best) best = rssi;
        }
        data[idx] = best;
      }
    }

    return { gw: gw, gh: gh, cell: cell, data: data, empty: false };
  };

  /* ------------------------------------------------------------
     5b. 同频重叠区计算
     判定（逐点）：
       ① 该点被至少两台 AP 覆盖，且这几台的 RSSI 都 ≥ 干扰阈值；
       ② 其中存在一对 AP，占用频率区间有交叠（不同信道 / 不相交的频宽不算）。
     满足①②的点即属于「同频重叠区」。只输出 0/1 掩码，交给 contour() 提矢量轮廓。
     ------------------------------------------------------------ */
  WS.computeOverlap = function (proj, thr, quality) {
    var st = proj.settings;
    var W = proj.imgW || 1000, H = proj.imgH || 800;
    var mpp = proj.mpp || 0.05;
    var rxH = st.rxHeight;
    var limit = (thr == null) ? (st.overlapThr != null ? st.overlapThr : -67) : thr;

    /* 重叠是「区域」概念，不需要热力图那种精细度，默认用 draft 档 */
    var target = (typeof quality === 'number')
      ? quality
      : (WS.QUALITY[quality] || WS.QUALITY.draft);
    var cell = Math.max(1.6, Math.sqrt(W * H / target));
    var gw = Math.max(1, Math.ceil(W / cell));
    var gh = Math.max(1, Math.ceil(H / cell));
    var data = new Uint8Array(gw * gh);

    /* --- 障碍物扁平化 --- */
    var obs = proj.obstacles;
    var nSeg = obs.length;
    var sx1 = new Float32Array(nSeg), sy1 = new Float32Array(nSeg);
    var sx2 = new Float32Array(nSeg), sy2 = new Float32Array(nSeg);
    var sAtt24 = new Float32Array(nSeg);
    var sAtt5 = new Float32Array(nSeg);
    for (var i = 0; i < nSeg; i++) {
      var o = obs[i];
      sx1[i] = o.x1; sy1[i] = o.y1; sx2[i] = o.x2; sy2[i] = o.y2;
      sAtt24[i] = WS.obAtten(o, 2437);
      sAtt5[i] = WS.obAtten(o, 5180);
    }

    /* --- AP 预取（含各自的频率区间） --- */
    var aps = [];
    for (var j = 0; j < proj.aps.length; j++) {
      var ap = proj.aps[j];
      if (ap.enabled === false) continue;
      var P = WS.antennaParams(ap);
      var rf = WS.apRf(ap, st);
      aps.push({
        x: ap.x, y: ap.y,
        lo: rf.lo, hi: rf.hi,
        fL: 20 * Math.log10(rf.mhz),
        nK: 10 * (st.pathLossN || WS.defaultN(rf.mhz)),
        sAtt: rf.mhz > 4000 ? sAtt5 : sAtt24,
        h: Math.max(0.25, WS.apHeight(ap, st) - rxH),
        peakElev: P.peakElev,
        hpbwH: P.hpbwH, hpbwV: P.hpbwV,
        nH: P.nH, nV: P.nV,
        fb: P.fb, omni: P.omni,
        gain: P.gain, power: P.power,
        az: (ap.azimuth || 0) * D2R,
        br: Math.pow(10, -(P.fb || 0) / 10)
      });
    }
    var nAp = aps.length;
    if (nAp < 2) {
      return { gw: gw, gh: gh, cell: cell, data: data, empty: true, count: 0, thr: limit };
    }

    var maxR2 = Math.pow(90 / mpp, 2);
    var hitIdx = new Int32Array(nAp);
    var cellCount = 0;
    var idx = 0;

    for (var gy = 0; gy < gh; gy++) {
      var py = (gy + 0.5) * cell;
      for (var gx = 0; gx < gw; gx++, idx++) {
        var px = (gx + 0.5) * cell;
        var nHit = 0;

        for (var k = 0; k < nAp; k++) {
          var A = aps[k];
          var dx = px - A.x, dy = py - A.y;
          var r2px = dx * dx + dy * dy;
          if (r2px > maxR2) continue;
          var rM = Math.sqrt(r2px) * mpp;
          var d3 = Math.sqrt(rM * rM + A.h * A.h);

          var vPat = 1;
          if (A.hpbwV < 359.5) {
            var cV = Math.cos(Math.atan2(rM, A.h) - A.peakElev);
            vPat = cV <= 0 ? 0.0001 : Math.pow(cV, A.nV);
          }
          var hPat = 1;
          if (!A.omni) {
            var dAz = Math.atan2(dx, -dy) - A.az;
            dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
            var cH = Math.cos(dAz);
            if (cH >= 0) {
              var hv = Math.pow(cH, A.nH);
              var fl = A.br * 0.55;
              hPat = hv > fl ? hv : fl;
            } else {
              var bk = A.br * cH * cH;
              hPat = bk > 0.0025 ? bk : 0.0025;
            }
          }

          /* 穿墙损耗 */
          var wall = 0;
          var loX = A.x < px ? A.x : px, hiX = A.x < px ? px : A.x;
          var loY = A.y < py ? A.y : py, hiY = A.y < py ? py : A.y;
          for (var sIdx = 0; sIdx < nSeg; sIdx++) {
            var q1x = sx1[sIdx], q1y = sy1[sIdx], q2x = sx2[sIdx], q2y = sy2[sIdx];
            if ((q1x > q2x ? q1x : q2x) < loX || (q1x < q2x ? q1x : q2x) > hiX) continue;
            if ((q1y > q2y ? q1y : q2y) < loY || (q1y < q2y ? q1y : q2y) > hiY) continue;
            var w1 = (px - A.x) * (q1y - A.y) - (py - A.y) * (q1x - A.x);
            var w2 = (px - A.x) * (q2y - A.y) - (py - A.y) * (q2x - A.x);
            if ((w1 > 0 && w2 > 0) || (w1 < 0 && w2 < 0)) continue;
            var w3 = (q2x - q1x) * (A.y - q1y) - (q2y - q1y) * (A.x - q1x);
            var w4 = (q2x - q1x) * (py - q1y) - (q2y - q1y) * (px - q1x);
            if ((w3 > 0 && w4 > 0) || (w3 < 0 && w4 < 0)) continue;
            wall += A.sAtt[sIdx];
            if (wall > 80) { wall = 80; break; }
          }

          var grel = 10 * Math.log10(vPat * hPat + 1e-10);
          var dSafe = d3 < 1 ? 1 : d3;
          var fspl = A.nK * Math.log10(dSafe) + A.fL - 27.55;
          var rssi = A.power + A.gain + grel - fspl - wall;

          /* 只有达到干扰阈值的 AP 才参与重叠判定 */
          if (rssi >= limit) hitIdx[nHit++] = k;
        }

        if (nHit < 2) continue;

        /* 两两配对：频率区间有交叠即视为同频干扰 */
        var marked = false;
        for (var a1 = 0; a1 < nHit && !marked; a1++) {
          var A1 = aps[hitIdx[a1]];
          for (var b1 = a1 + 1; b1 < nHit; b1++) {
            var B1 = aps[hitIdx[b1]];
            if (A1.lo < B1.hi && B1.lo < A1.hi) { marked = true; break; }
          }
        }
        if (marked) { data[idx] = 1; cellCount++; }
      }
    }

    return {
      gw: gw, gh: gh, cell: cell, data: data,
      empty: cellCount === 0, count: cellCount, thr: limit
    };
  };

  /* ------------------------------------------------------------
     5c. 掩码 → 矢量轮廓（marching squares）
     输出若干闭合多边形（世界坐标），用于画黑框 + 斜线填充。
     ------------------------------------------------------------ */
  WS.contour = function (grid) {
    var gw = grid.gw, gh = grid.gh, cell = grid.cell, d = grid.data;
    if (gw < 2 || gh < 2) return [];

    function val(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return 0;
      return d[gy * gw + gx] ? 1 : 0;
    }

    var segs = [];
    for (var gy = 0; gy < gh - 1; gy++) {
      for (var gx = 0; gx < gw - 1; gx++) {
        var a = val(gx, gy), b = val(gx + 1, gy);
        var c = val(gx + 1, gy + 1), e = val(gx, gy + 1);
        var ci = a | (b << 1) | (c << 2) | (e << 3);
        if (ci === 0 || ci === 15) continue;

        var x0 = (gx + 0.5) * cell, x1 = (gx + 1.5) * cell;
        var y0 = (gy + 0.5) * cell, y1 = (gy + 1.5) * cell;
        var T = { x: (x0 + x1) / 2, y: y0 };
        var R = { x: x1, y: (y0 + y1) / 2 };
        var B = { x: (x0 + x1) / 2, y: y1 };
        var L = { x: x0, y: (y0 + y1) / 2 };

        switch (ci) {
          case 1: case 14: segs.push([L, T]); break;
          case 2: case 13: segs.push([T, R]); break;
          case 3: case 12: segs.push([L, R]); break;
          case 4: case 11: segs.push([R, B]); break;
          case 6: case 9: segs.push([T, B]); break;
          case 7: case 8: segs.push([L, B]); break;
          case 5: segs.push([L, T], [R, B]); break;     /* 鞍点 */
          case 10: segs.push([T, R], [B, L]); break;    /* 鞍点 */
          default: break;
        }
      }
    }
    if (!segs.length) return [];

    var K = 100;                                      /* 端点量化精度 0.01 px */
    function key(p) { return Math.round(p.x * K) + ',' + Math.round(p.y * K); }

    var adj = {}, pts = {};
    for (var i = 0; i < segs.length; i++) {
      var ka = key(segs[i][0]), kb = key(segs[i][1]);
      if (ka === kb) continue;
      (adj[ka] || (adj[ka] = [])).push(kb);
      (adj[kb] || (adj[kb] = [])).push(ka);
      pts[ka] = segs[i][0];
      pts[kb] = segs[i][1];
    }

    var used = {};
    var polys = [];
    var keys = Object.keys(adj);
    for (var n = 0; n < keys.length; n++) {
      var start = keys[n];
      if (used[start]) continue;
      var cur = start, loop = [];
      for (var guard = 0; guard < segs.length * 2 + 8; guard++) {
        used[cur] = true;
        loop.push(pts[cur]);
        var nb = adj[cur] || [];
        var nxt = null;
        for (var m = 0; m < nb.length; m++) {
          if (!used[nb[m]]) { nxt = nb[m]; break; }
        }
        if (!nxt) {
          if (loop.length > 2 && nb.indexOf(start) >= 0) loop.push(pts[start]);
          break;
        }
        cur = nxt;
      }
      if (loop.length >= 3) polys.push(loop);
    }
    return polys;
  };

  /* RSSI → 色带索引，-1 表示无效/低于门限（minRssi 由调用方按当前频段传入） */
  WS.rssiBand = function (v, minRssi) {
    var floor = (minRssi == null) ? WS.HEAT_FLOOR : minRssi;
    if (!isFinite(v) || v < floor) return -1;
    for (var i = 0; i < WS.BANDS.length; i++) {
      if (v >= WS.BANDS[i].min) return i;
    }
    return -1;
  };

  WS.bandColor = function (v, minRssi) {
    var b = WS.rssiBand(v, minRssi);
    return b < 0 ? null : WS.BANDS[b];
  };

  /* ------------------------------------------------------------
     颜色查找表
     色带之间在边界处做 1.6 dB 的线性过渡：
       · 色带主体仍是纯色 —— 保留"阶梯递减"的观感
       · 只在交界处混合 —— 消除硬切造成的锯齿
     量化到 0.05 dB 建表，逐像素查表，比每像素做一次色带判定快得多
     ------------------------------------------------------------ */
  var LUT_MIN = -120;
  var LUT_MAX = -20;
  var LUT_STEP = 0.05;
  var LUT_N = Math.round((LUT_MAX - LUT_MIN) / LUT_STEP) + 1;
  var LUT_INV = 1 / LUT_STEP;
  var BLEND_DB = 0.65;
  var _lut = null;

  function blendColor(v, bi) {
    var b = WS.BANDS[bi];
    var rgb = b.rgb;
    var next = (bi + 1 < WS.BANDS.length) ? WS.BANDS[bi + 1] : null;
    if (!next) return rgb;

    var dv = v - b.min;          // 距本档下界（与更弱一档的分界）的距离
    if (dv >= 0 && dv < BLEND_DB) {
      var t = dv / BLEND_DB;     // 0 = 贴边界（取更弱档色），1 = 完全本档色
      var n = next.rgb;
      return [
        n[0] + (rgb[0] - n[0]) * t,
        n[1] + (rgb[1] - n[1]) * t,
        n[2] + (rgb[2] - n[2]) * t
      ];
    }
    return rgb;
  }

  function ensureLut() {
    if (_lut) return _lut;
    var lut = new Uint8Array(LUT_N * 3);
    for (var i = 0; i < LUT_N; i++) {
      var v = LUT_MIN + i * LUT_STEP;
      var bi = WS.rssiBand(v, WS.HEAT_FLOOR);
      var o = i * 3;
      if (bi < 0) {
        lut[o] = 122; lut[o + 1] = 134; lut[o + 2] = 152;
        continue;
      }
      var c = blendColor(v, bi);
      lut[o] = c[0] | 0;
      lut[o + 1] = c[1] | 0;
      lut[o + 2] = c[2] | 0;
    }
    _lut = lut;
    return lut;
  }

  /* ------------------------------------------------------------
     把 RSSI 网格渲染成位图
     直接输出到目标分辨率（默认 = 图纸尺寸），只做一次双线性插值，
     不再经过「超采样 → 再放大」的两级插值，边缘因此锐利
     ------------------------------------------------------------ */
  WS.heatToCanvas = function (heat, threshold, outW, outH) {
    var gw = heat.gw, gh = heat.gh;
    var ow = Math.max(gw, Math.round(outW || gw));
    var oh = Math.max(gh, Math.round(outH || gh));

    /* 防止超大图纸把内存打爆 */
    var maxPx = 3400 * 3400;
    if (ow * oh > maxPx) {
      var k = Math.sqrt(maxPx / (ow * oh));
      ow = Math.max(gw, Math.round(ow * k));
      oh = Math.max(gh, Math.round(oh * k));
    }

    var c = document.createElement('canvas');
    c.width = ow; c.height = oh;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(ow, oh);
    var buf = img.data;
    var data = heat.data;
    var lut = ensureLut();

    /* 预计算每一列 / 每一行的采样位置与权重，避免在内层循环里重复算 */
    var fx = gw / ow, fy = gh / oh;
    var cx0 = new Int32Array(ow), cx1 = new Int32Array(ow), cwx = new Float32Array(ow);
    var x, y, sx, sy, x0, y0, tx, ty;
    for (x = 0; x < ow; x++) {
      sx = (x + 0.5) * fx - 0.5;
      if (sx < 0) sx = 0;
      x0 = sx | 0;
      tx = sx - x0;
      if (x0 > gw - 1) { x0 = gw - 1; tx = 0; }
      cx0[x] = x0;
      cx1[x] = (x0 + 1 > gw - 1) ? gw - 1 : x0 + 1;
      cwx[x] = tx;
    }
    var ry0 = new Int32Array(oh), ry1 = new Int32Array(oh), rwy = new Float32Array(oh);
    for (y = 0; y < oh; y++) {
      sy = (y + 0.5) * fy - 0.5;
      if (sy < 0) sy = 0;
      y0 = sy | 0;
      ty = sy - y0;
      if (y0 > gh - 1) { y0 = gh - 1; ty = 0; }
      ry0[y] = y0;
      ry1[y] = (y0 + 1 > gh - 1) ? gh - 1 : y0 + 1;
      rwy[y] = ty;
    }

    var th = (threshold == null) ? WS.HEAT_FLOOR : threshold;
    var FLOOR = WS.HEAT_FLOOR;
    var lutMax = LUT_N - 1;

    for (y = 0; y < oh; y++) {
      var rowA = ry0[y] * gw, rowB = ry1[y] * gw, wy = rwy[y], wy1 = 1 - wy;
      var p = y * ow * 4;
      for (x = 0; x < ow; x++) {
        var wx = cwx[x], wx1 = 1 - wx;
        var i00 = rowA + cx0[x], i10 = rowA + cx1[x];
        var i01 = rowB + cx0[x], i11 = rowB + cx1[x];

        var v = (data[i00] * wx1 + data[i10] * wx) * wy1 +
                (data[i01] * wx1 + data[i11] * wx) * wy;

        if (v < FLOOR) {
          if (v > -190) {
            buf[p] = 122; buf[p + 1] = 134; buf[p + 2] = 152; buf[p + 3] = 46;
          } else {
            buf[p + 3] = 0;
          }
          p += 4;
          continue;
        }

        var li = ((v - LUT_MIN) * LUT_INV) | 0;
        if (li < 0) li = 0; else if (li > lutMax) li = lutMax;
        var o3 = li * 3;
        buf[p] = lut[o3];
        buf[p + 1] = lut[o3 + 1];
        buf[p + 2] = lut[o3 + 2];

        /* 达标区不透明，未达标区淡显；门限附近 2 dB 内做过渡，避免出现一条硬线 */
        var dth = v - th;
        var av;
        if (dth > 1) av = 222;
        else if (dth < -1) av = 118;
        else av = 118 + (dth + 1) * 52;
        buf[p + 3] = av;

        p += 4;
      }
    }

    ctx.putImageData(img, 0, 0);
    return c;
  };

  /* 覆盖统计（门限按当前频段取） */
  WS.coverageStats = function (proj, heat) {
    var st = proj.settings;
    var minR = WS.minRssiOf(st);
    var cellAreaM2 = Math.pow((heat.cell * (proj.mpp || 0.05)), 2);
    var counts = [0, 0, 0, 0, 0];
    var covered = 0, total = 0;
    var data = heat.data;
    for (var i = 0; i < data.length; i++) {
      total++;
      var v = data[i];
      /* 色带分布按「热力图实际绘制下限」统计，保证和肉眼看到的一致 */
      var bi = WS.rssiBand(v, WS.HEAT_FLOOR);
      if (bi >= 0) counts[bi]++;
      /* 达标面积按门限统计 */
      if (v >= minR) covered++;
    }
    var areaOf = function (n) { return n * cellAreaM2; };
    var res = {
      counts: counts,
      area: counts.map(areaOf),
      coveredArea: covered * cellAreaM2,
      totalArea: total * cellAreaM2,
      totalCount: total,
      pct: total ? covered / total * 100 : 0
    };
    return res;
  };

  /* ------------------------------------------------------------
     6. 全局运行状态
     ------------------------------------------------------------ */
  WS.state = {
    project: WS.newProject(),
    view: { s: 1, ox: 0, oy: 0 },
    mode: 'plan',              // plan | device
    tool: 'select',
    sel: null,                 // 单选主对象 {kind:'ap'|'ob', id}
    selKind: null,             // 'ap' | 'ob' | null —— 选择集的对象类型（绝不允许跨类型）
    selIds: [],                // 多选集合（包含主对象）
    marquee: null,             // 框选矩形 {x0,y0,x1,y1}（世界坐标）
    hover: null,
    heat: null,
    heatCanvas: null,
    showHeat: true,
    layers: { heat: true, obs: true, ap: true, grid: true, beam: false, overlap: false },
    drawing: null,             // {type,x1,y1,x2,y2}
    calib: null,               // {p1:{x,y}, p2:{x,y}, step:1|2}
    drag: null,
    aids: {                    // 平面编辑辅助开关（默认全开）
      snap: true,              // 端点吸附
      ortho: true,             // 直线修正（近似水平/垂直自动拉直）
      edgePan: true,           // 画线到视图边缘时自动平移
      snapEdge: true,          // 墙线吸附（吸到已有墙的交点 / 墙上），关掉则只吸端点
      snapPx: WS.SNAP_PX,      // 吸附强度：半径（屏幕像素），0 = 不吸附
      orthoRatio: WS.ORTHO_RATIO // 修正强度：短边/长边阈值，0 = 不修正（约 9.1°）
    },
    heatStale: false,          // 热力图与当前几何不一致（拖动中不重算）
    snapHint: null,            // 当前吸住的目标 {x,y,kind:'end'|'cross'|'edge'}
    snapNear: [],              // 附近的候选端点（画成淡色方框）
    cursorWorld: null,         // 光标世界坐标
    lastScr: null,             // 最近一次光标的画布坐标 {x,y}
    theme: 'dark',
    imgEl: null,
    doc: null,                 // 完整文档：{ name, buildings:[{id,name,floors:[...]}], activeBuilding, activeFloor }
    histories: {},             // 每个楼层各自一份撤销栈：floorId → {stack,pos,lock}
    history: { stack: [], pos: -1, lock: false },
    dirty: false,
    ready: false
  };

  /* ------------------------------------------------------------
     7. 存档
     ------------------------------------------------------------ */
  /* 单层（v1 平铺 project）的统一归一化：补默认值 + 老字段迁移 */
  WS.normalizeProject = function (p) {
    var base = WS.newProject();
    var merged = Object.assign(base, p);
    merged.settings = Object.assign(base.settings, p.settings || {});
    merged.obstacles = Array.isArray(p.obstacles) ? p.obstacles : [];
    merged.aps = Array.isArray(p.aps) ? p.aps : [];

    /* --- 旧数据迁移 --- */
    // 单值门限 minRssi → minRssi24 / minRssi5
    var src = p.settings || {};
    if (src.minRssi != null) {
      if (src.minRssi24 == null) merged.settings.minRssi24 = src.minRssi;
      if (src.minRssi5 == null) merged.settings.minRssi5 = src.minRssi;
    }
    if ('minRssi' in merged.settings) delete merged.settings.minRssi;

    // 旧材质 key 与单值 atten → 双频衰减
    for (var i = 0; i < merged.obstacles.length; i++) {
      WS.normalizeObstacle(merged.obstacles[i]);
    }

    /* 清理退化墙段：两端重合（或 NaN）的线段在画布上不可见、也点不中，
       留着只会变成"删不掉的残留"。只清真正退化的（< 1 mm 量级），不误伤短墙垛。 */
    merged.obstacles = merged.obstacles.filter(function (o) {
      var dx = o.x2 - o.x1, dy = o.y2 - o.y1;
      return (dx * dx + dy * dy) > 1e-6;
    });

    /* 信道 / 频宽 / 区域：老项目只有 settings.freq，反推出 band + channel */
    var s2 = merged.settings;
    if (!s2.band) {
      var oldF = s2.freq || 2437;
      s2.band = oldF > 4000 ? '5' : '24';
      s2.channel = WS.nearestChannel(s2.band, oldF);
      s2.bw = (s2.band === '5') ? 80 : 20;      /* 按项目默认口径补频宽 */
    }
    if (!WS.BANDS_INFO[s2.band]) s2.band = '24';
    var chs = WS.BANDS_INFO[s2.band].channels;
    if (chs.indexOf(s2.channel) < 0) {
      s2.channel = WS.nearestChannel(s2.band, s2.freq || chs[0]);
    }
    if (WS.BANDS_INFO[s2.band].bws.indexOf(s2.bw) < 0) {
      s2.bw = WS.BANDS_INFO[s2.band].bws[0];
    }
    if (!s2.region || !WS.REGIONS[s2.region]) s2.region = 'CN';
    if (s2.overlapThr == null) s2.overlapThr = -67;
    s2.freq = WS.chMhz(s2.band, s2.channel);    /* 中心频点由信道派生 */

    /* AP 射频覆盖字段（null = 跟随项目） */
    for (var j = 0; j < merged.aps.length; j++) {
      var a = merged.aps[j];
      if (a.band === undefined) a.band = null;
      if (a.channel === undefined) a.channel = null;
      if (a.bw === undefined) a.bw = null;
    }

    return merged;
  };

  WS.serialize = function (doc) {
    return JSON.stringify(doc);
  };

  /* 自动保存专用：去掉各楼层底图（图片单独存），避免撑爆 localStorage 配额。
     注意不要用 JSON.parse(JSON.stringify(doc)) 做深拷贝 —— 那会把所有楼层的
     底图 base64 字符串整份复制一遍，多楼层时自动保存会出现周期性卡顿；
     这里逐层浅拷贝并跳过 image 字段，其余字段按引用交给 JSON.stringify 展开。 */
  WS.serializeSlim = function (doc) {
    var buildings = (doc.buildings || []).map(function (b) {
      return {
        id: b.id,
        name: b.name,
        floors: (b.floors || []).map(function (f) {
          var c = {};
          for (var k in f) { if (k !== 'image' && Object.prototype.hasOwnProperty.call(f, k)) c[k] = f[k]; }
          return c;
        })
      };
    });
    return JSON.stringify({
      format: doc.format,
      version: doc.version,
      name: doc.name,
      buildings: buildings,
      activeBuilding: doc.activeBuilding,
      activeFloor: doc.activeFloor,
      createdAt: doc.createdAt
    });
  };

  /* v2 文档归一化：补齐 id / name / level，校准活动指针 */
  WS.normalizeDoc = function (src) {
    var doc = {
      format: 'wireless-survey',
      version: 2,
      name: src.name || '未命名项目',
      buildings: [],
      activeBuilding: src.activeBuilding || null,
      activeFloor: src.activeFloor || null,
      createdAt: src.createdAt || Date.now()
    };
    var list = Array.isArray(src.buildings) ? src.buildings : [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i] || {};
      var nb = {
        id: b.id || ('b_' + WS.uid()),
        name: b.name || ('楼宇 ' + (i + 1)),
        floors: []
      };
      var fl = Array.isArray(b.floors) ? b.floors : [];
      for (var j = 0; j < fl.length; j++) {
        var raw = fl[j] || {};
        var f = WS.normalizeProject(raw);
        f.id = raw.id || ('f_' + WS.uid());
        f.name = raw.name || ((j + 1) + 'F');
        f.level = raw.level || (j + 1);
        nb.floors.push(f);
      }
      if (!nb.floors.length) nb.floors.push(WS.newFloor('1F', 1));
      doc.buildings.push(nb);
    }
    if (!doc.buildings.length) doc.buildings.push(WS.newBuilding('A 栋'));
    if (!WS.findFloor(doc, doc.activeFloor)) {
      var b0 = doc.buildings[0];
      doc.activeBuilding = b0.id;
      doc.activeFloor = b0.floors[0].id;
    }
    return doc;
  };

  /* 读文件：v2 直接用；v1 平铺项目自动包成「A 栋 / 1F」 */
  WS.deserialize = function (text) {
    var raw = JSON.parse(text);
    var src = raw.project || raw;

    /* v2 结构 */
    if (src && Array.isArray(src.buildings) && src.buildings.length) {
      return WS.normalizeDoc(src);
    }

    /* v1 平铺结构 */
    if (!src || typeof src !== 'object') throw new Error('文件格式不正确');
    var looksLikeProject = Array.isArray(src.obstacles) || Array.isArray(src.aps) ||
      typeof src.image === 'string' || typeof src.mpp === 'number';
    if (!looksLikeProject) throw new Error('这不是勘波项目文件（缺少 obstacles / aps / mpp 等字段）');

    var flat = WS.normalizeProject(src);
    var oldName = flat.name || '未命名项目';
    flat.id = 'f_' + WS.uid();
    flat.name = '1F';
    flat.level = 1;
    flat._fromFlat = true;                 /* 迁移标记，仅用于排查 */
    var b = { id: 'b_' + WS.uid(), name: 'A 栋', floors: [flat] };
    return {
      format: 'wireless-survey',
      version: 2,
      name: oldName,
      buildings: [b],
      activeBuilding: b.id,
      activeFloor: flat.id,
      createdAt: flat.createdAt || Date.now()
    };
  };

})(window.WS);
