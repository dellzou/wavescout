/* ============================================================
   render.js — Canvas 渲染

   作者：邹宁（2004-04-17，广东广州）
   著作权：本软件由邹宁个人独立开发，著作权归作者所有。
   © 2026 邹宁 版权所有
   ============================================================ */
(function (WS) {
  'use strict';

  var S = WS.state;
  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;

  var cv = null, ctx = null, dpr = 1, W = 0, H = 0;
  var pending = false;

  /* ---------- 主题色 ---------- */
  function palette() {
    if (S.theme === 'light') {
      return {
        canvasBg: '#dfe4ea',
        paper: '#fbfcfd',
        paperEdge: 'rgba(30,50,80,.22)',
        gridMinor: 'rgba(40,70,110,.09)',
        gridMajor: 'rgba(40,70,110,.20)',
        text: '#1b2530',
        textDim: '#7b8b9c',
        chip: 'rgba(255,255,255,.92)'
      };
    }
    return {
      canvasBg: '#0f141b',
      paper: '#f7f9fb',
      paperEdge: 'rgba(0,0,0,.55)',
      gridMinor: 'rgba(30,60,100,.08)',
      gridMajor: 'rgba(30,60,100,.18)',
      text: '#e3ecf5',
      textDim: '#8b9bad',
      chip: 'rgba(13,17,23,.86)'
    };
  }

  /* ---------- 工具 ---------- */
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  WS.hexA = hexA;

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ---------- 初始化 ---------- */
  WS.initCanvas = function (canvas) {
    cv = canvas;
    ctx = cv.getContext('2d', { alpha: false });
    resize();
    watchDpr();
    window.addEventListener('resize', function () { resize(); WS.requestDraw(); });
  };

  /* 跨显示器拖动时 devicePixelRatio 会变化，但 window.resize 不一定触发，
     需要单独监听，否则画面会按旧 dpr 渲染而变糊 */
  var dprMQ = null;
  function watchDpr() {
    if (!window.matchMedia) return;
    if (dprMQ && dprMQ.removeEventListener) {
      dprMQ.removeEventListener('change', onDprChange);
    }
    try {
      dprMQ = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      if (dprMQ.addEventListener) dprMQ.addEventListener('change', onDprChange);
    } catch (e) { dprMQ = null; }
  }
  function onDprChange() {
    resize();
    WS.requestDraw();
    watchDpr();
  }

  function resize() {
    if (!cv) return;
    var r = cv.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
  }
  WS.viewSize = function () { return { w: W, h: H }; };

  WS.requestDraw = function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; WS.draw(); });
  };

  /* ---------- 坐标 ---------- */
  WS.screenToWorld = function (sx, sy) {
    var v = S.view;
    return { x: (sx - v.ox) / v.s, y: (sy - v.oy) / v.s };
  };
  WS.worldToScreen = function (x, y) {
    var v = S.view;
    return { x: x * v.s + v.ox, y: y * v.s + v.oy };
  };

  WS.fitView = function () {
    if (!ctx) return;
    var p = S.project;
    var pad = 46;
    var s = Math.min((W - pad * 2) / (p.imgW || 1), (H - pad * 2) / (p.imgH || 1));
    s = WS.clamp(s, 0.02, 6);
    S.view.s = s;
    S.view.ox = (W - p.imgW * s) / 2;
    S.view.oy = (H - p.imgH * s) / 2;
    WS.requestDraw();
  };

  WS.zoomAt = function (factor, sx, sy) {
    var v = S.view;
    var ns = WS.clamp(v.s * factor, 0.03, 12);
    var k = ns / v.s;
    v.ox = sx - (sx - v.ox) * k;
    v.oy = sy - (sy - v.oy) * k;
    v.s = ns;
    WS.requestDraw();
  };

  /* ============================================================
     主绘制
     ============================================================ */
  WS.draw = function () {
    if (!ctx) return;
    var P = palette();
    var p = S.project;
    var v = S.view;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = P.canvasBg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.s, v.s);

    drawPaper(p, P);
    if (S.layers.grid) drawGrid(p, P);
    if (S.layers.heat && S.showHeat) drawHeat(p);
    if (S.layers.overlap) drawOverlap(p);
    if (S.layers.obs) drawObstacles(p);
    drawDrawing(p);
    drawSnapHint();
    if (S.layers.ap) drawAps(p, P);
    drawCalib(p);
    drawMarquee(p);

    ctx.restore();

    drawScaleBar(p, P);
  };

  /* ---------- 纸面 ---------- */
  function drawPaper(p, P) {
    ctx.save();
    ctx.shadowColor = P.paperEdge;
    /* 阴影在缩放后的坐标系里画，必须除以 s 才能保持屏幕上恒定，
       否则放大 4 倍时纸边阴影会糊成 72 px 的一团 */
    ctx.shadowBlur = 18 / S.view.s;
    ctx.shadowOffsetY = 3 / S.view.s;
    ctx.fillStyle = P.paper;
    ctx.fillRect(0, 0, p.imgW, p.imgH);
    ctx.restore();

    if (S.imgEl && S.imgEl.complete && S.imgEl.naturalWidth) {
      ctx.drawImage(S.imgEl, 0, 0, p.imgW, p.imgH);
    }

    ctx.strokeStyle = P.paperEdge;
    ctx.lineWidth = 1 / S.view.s;
    ctx.strokeRect(0, 0, p.imgW, p.imgH);
  }

  /* ---------- 米制网格 ---------- */
  function niceStep(raw) {
    var steps = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= raw) return steps[i];
    return 1000;
  }

  function drawGrid(p, P) {
    var mpp = p.mpp || 0.05;
    var screenPxPerM = (1 / mpp) * S.view.s;
    if (screenPxPerM < 3) return;
    var stepM = niceStep(64 / screenPxPerM);
    var stepPx = stepM / mpp;
    if (stepPx * S.view.s < 12) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, p.imgW, p.imgH);
    ctx.clip();

    var lw = 1 / S.view.s;
    var x, y, i;

    ctx.strokeStyle = P.gridMinor;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (x = 0; x <= p.imgW; x += stepPx) { ctx.moveTo(x, 0); ctx.lineTo(x, p.imgH); }
    for (y = 0; y <= p.imgH; y += stepPx) { ctx.moveTo(0, y); ctx.lineTo(p.imgW, y); }
    ctx.stroke();

    // 每 5 格加粗
    ctx.strokeStyle = P.gridMajor;
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    for (i = 0, x = 0; x <= p.imgW; x += stepPx, i++) {
      if (i % 5 === 0) { ctx.moveTo(x, 0); ctx.lineTo(x, p.imgH); }
    }
    for (i = 0, y = 0; y <= p.imgH; y += stepPx, i++) {
      if (i % 5 === 0) { ctx.moveTo(0, y); ctx.lineTo(p.imgW, y); }
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 热力图 ---------- */
  function drawHeat(p) {
    if (!S.heatCanvas) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    /* multiply 混合：白纸上的颜色保持饱和，底图的深色线条（墙、标注）仍能透出来，
       比普通半透明叠加更接近工程图纸的观感 */
    ctx.globalCompositeOperation = 'multiply';
    /* 拖动期间热力图不重算，画面已与几何不一致 —— 淡显提示「这是旧结果」 */
    ctx.globalAlpha = S.heatStale ? 0.42 : 0.94;
    ctx.drawImage(S.heatCanvas, 0, 0, p.imgW, p.imgH);
    ctx.restore();
  }

  /* ---------- 选中集合查找表 ---------- */
  function selMap(kind) {
    if (S.selKind !== kind || !S.selIds || !S.selIds.length) return null;
    var map = {};
    for (var i = 0; i < S.selIds.length; i++) map[S.selIds[i]] = true;
    return map;
  }

  /* ---------- 同频重叠区（黑框 + 斜线填充） ---------- */
  var hatchPat = null;

  /* 45° 斜线图案：8×8 无缝平铺，屏幕空间恒定密度 */
  function getHatch() {
    if (hatchPat) return hatchPat;
    var t = document.createElement('canvas');
    t.width = 8; t.height = 8;
    var g = t.getContext('2d');
    g.strokeStyle = 'rgba(18,18,18,.80)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.stroke();
    g.beginPath(); g.moveTo(-2, 2); g.lineTo(2, -2); g.stroke();
    g.beginPath(); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
    hatchPat = ctx.createPattern(t, 'repeat');
    return hatchPat;
  }

  function drawOverlap(p) {
    var polys = S.overlapPolys;
    if (!polys || !polys.length) return;
    /* 拖动期间几何已变、轮廓还是旧的：先隐掉，避免画框停在原地误导，
       松手后 rebuildHeat 会触发 scheduleOverlap 重新算出来 */
    if (S.heatStale) return;
    var v = S.view;
    var path = new Path2D();
    var i, j, poly;
    for (i = 0; i < polys.length; i++) {
      poly = polys[i];
      if (poly.length < 3) continue;
      path.moveTo(poly[0].x, poly[0].y);
      for (j = 1; j < poly.length; j++) path.lineTo(poly[j].x, poly[j].y);
      path.closePath();
    }

    ctx.save();
    var pat = getHatch();
    if (pat && pat.setTransform) {
      /* 图案反向缩放，抵消画布缩放 → 斜线在屏幕上的间距恒定 */
      try { pat.setTransform(new DOMMatrix([1 / v.s, 0, 0, 1 / v.s, 0, 0])); } catch (e) { /* 忽略 */ }
    }
    ctx.fillStyle = pat || 'rgba(0,0,0,.08)';
    ctx.fill(path, 'evenodd');          /* evenodd：环状区域中间能留空 */
    ctx.strokeStyle = 'rgba(8,8,8,.92)';
    ctx.lineWidth = 1.6 / v.s;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.stroke(path);
    ctx.restore();
  }

  /* ---------- 障碍物 ---------- */
  function drawObstacles(p) {
    var mpp = p.mpp || 0.05;
    var s = S.view.s;
    var list = p.obstacles;
    var sel = selMap('ob');
    var hovId = (S.hover && S.hover.kind === 'ob') ? S.hover.id : null;
    var i;

    /* 端点手柄只在「单选」时出现：多选时满是蓝点，反而看不清 */
    var showEnds = !!(S.selIds && S.selIds.length === 1);

    /* 先画未选中的，再画选中的 —— 保证高亮不会被后画的线条盖住 */
    for (i = 0; i < list.length; i++) {
      if (sel && sel[list[i].id]) continue;
      strokeObstacle(list[i], mpp, s, false, hovId === list[i].id, false);
    }
    for (i = 0; i < list.length; i++) {
      if (sel && sel[list[i].id]) strokeObstacle(list[i], mpp, s, true, false, showEnds);
    }
  }

  function strokeObstacle(o, mpp, s, selected, hovered, showEnds) {
    var cfg = WS.OB_TYPES[o.type] || WS.OB_TYPES.wall;
    var wpx = Math.max((o.thick || 0.15) / mpp, 1.6 / s);

    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';

    if (selected) {
      ctx.shadowColor = 'rgba(56,189,248,.85)';
      ctx.shadowBlur = 10 / s;
    }

    // 外描边（暗色，增加可读性）
    ctx.beginPath();
    ctx.moveTo(o.x1, o.y1);
    ctx.lineTo(o.x2, o.y2);
    ctx.strokeStyle = selected ? '#38bdf8' : 'rgba(12,20,30,.55)';
    ctx.lineWidth = wpx + (hovered ? 3 : 1.6) / s;
    ctx.setLineDash([]);
    ctx.stroke();

    // 主体
    ctx.beginPath();
    ctx.moveTo(o.x1, o.y1);
    ctx.lineTo(o.x2, o.y2);
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = wpx;
    var dash = cfg.dash;
    if (dash && dash.length) {
      var d = [];
      for (var k = 0; k < dash.length; k++) d.push(dash[k] / s);
      ctx.setLineDash(d);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();

    // ---- 类型细节 ----
    if (o.type === 'window') {
      // 中间细线，形成双层玻璃观感
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.strokeStyle = '#1e5b8c';
      ctx.lineWidth = Math.max(1 / s, wpx * 0.16);
      ctx.setLineDash([]);
      ctx.stroke();
    } else if (o.type === 'door') {
      // 两端门框
      var ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      var nx = -Math.sin(ang), ny = Math.cos(ang);
      var tick = Math.max(5 / s, wpx * 1.5);
      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(1.6 / s, wpx * 0.35);
      ctx.strokeStyle = '#8a5a2b';
      ctx.beginPath();
      ctx.moveTo(o.x1 - nx * tick, o.y1 - ny * tick);
      ctx.lineTo(o.x1 + nx * tick, o.y1 + ny * tick);
      ctx.moveTo(o.x2 - nx * tick, o.y2 - ny * tick);
      ctx.lineTo(o.x2 + nx * tick, o.y2 + ny * tick);
      ctx.stroke();
    }

    // 选中端点（可拖拽调整，仅单选时显示）
    if (selected && showEnds) {
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      var r = 5 / s;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath(); ctx.arc(o.x1, o.y1, r, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(o.x2, o.y2, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#0b1118';
      ctx.lineWidth = 1.4 / s;
      ctx.beginPath(); ctx.arc(o.x1, o.y1, r, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(o.x2, o.y2, r, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- AP 波束 ---------- */
  function drawBeam(ap, mpp) {
    var cfg = WS.AP_PRESETS[ap.mount] || WS.AP_PRESETS.ceiling;
    var P = WS.antennaParams(ap);
    var radius = 9 / mpp;
    var half = (P.omni ? 180 : Math.min(P.hpbwH / 2, 88)) * D2R;
    var az = (ap.azimuth || 0) * D2R;
    var center = az - Math.PI / 2;

    ctx.save();
    if (P.omni) {
      var g0 = ctx.createRadialGradient(ap.x, ap.y, 0, ap.x, ap.y, radius);
      g0.addColorStop(0, hexA(cfg.color, 0.22));
      g0.addColorStop(0.55, hexA(cfg.color, 0.09));
      g0.addColorStop(1, hexA(cfg.color, 0));
      ctx.beginPath();
      ctx.arc(ap.x, ap.y, radius, 0, TAU);
      ctx.fillStyle = g0;
      ctx.fill();
    } else {
      var g = ctx.createRadialGradient(ap.x, ap.y, 0, ap.x, ap.y, radius);
      g.addColorStop(0, hexA(cfg.color, 0.30));
      g.addColorStop(1, hexA(cfg.color, 0));
      ctx.beginPath();
      ctx.moveTo(ap.x, ap.y);
      ctx.arc(ap.x, ap.y, radius, center - half, center + half);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }
    // 中心到前向的轴线
    ctx.beginPath();
    ctx.moveTo(ap.x, ap.y);
    ctx.lineTo(ap.x + Math.sin(az) * radius * 0.92, ap.y - Math.cos(az) * radius * 0.92);
    ctx.strokeStyle = hexA(cfg.color, 0.45);
    ctx.lineWidth = 1 / S.view.s;
    ctx.setLineDash([6 / S.view.s, 6 / S.view.s]);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- AP 图标 ---------- */
  function drawAps(p, P) {
    var s = S.view.s;
    var mpp = p.mpp || 0.05;
    var list = p.aps;
    var sel = selMap('ap');
    var i;

    if (S.layers.beam) {
      for (i = 0; i < list.length; i++) {
        if (list[i].enabled === false) continue;
        drawBeam(list[i], mpp);
      }
    }
    for (i = 0; i < list.length; i++) {
      if (sel && sel[list[i].id]) continue;
      drawApMarker(list[i], s, P, false);
    }
    for (i = 0; i < list.length; i++) {
      if (sel && sel[list[i].id]) drawApMarker(list[i], s, P, true);
    }
  }

  function drawApMarker(ap, s, P, selected) {
    var cfg = WS.AP_PRESETS[ap.mount] || WS.AP_PRESETS.ceiling;
    var off = ap.enabled === false;

    ctx.save();
    ctx.translate(ap.x, ap.y);
    ctx.scale(1 / s, 1 / s);
    ctx.globalAlpha = off ? 0.42 : 1;

    // 选中光环
    if (selected) {
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, TAU);
      ctx.strokeStyle = 'rgba(56,189,248,.9)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 外发光
    var g = ctx.createRadialGradient(0, 0, 4, 0, 0, 18);
    g.addColorStop(0, hexA(cfg.color, 0.34));
    g.addColorStop(1, hexA(cfg.color, 0));
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    // 底座
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, TAU);
    ctx.fillStyle = 'rgba(9,15,22,.92)';
    ctx.fill();
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 符号
    ctx.strokeStyle = cfg.color;
    ctx.fillStyle = cfg.color;
    ctx.lineWidth = 1.5;
    if (ap.mount === 'ceiling') {
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, TAU); ctx.stroke();
      for (var a = 0; a < 4; a++) {
        var ang = a * Math.PI / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 5, Math.sin(ang) * 5);
        ctx.lineTo(Math.cos(ang) * 7, Math.sin(ang) * 7);
        ctx.stroke();
      }
    } else if (ap.mount === 'wall') {
      ctx.save();
      ctx.rotate((ap.azimuth || 0) * D2R - Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(5.6, 0);
      ctx.lineTo(-2.6, -4.2);
      ctx.lineTo(-2.6, 4.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.lineWidth = 1.4;
      roundRect(ctx, -3.6, -3.6, 7.2, 7.2, 1.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(3.6, -1.6); ctx.lineTo(6.4, -3.4);
      ctx.moveTo(3.6, 1.6); ctx.lineTo(6.4, 3.4);
      ctx.stroke();
    }

    // 名称标签
    ctx.font = '600 10px "Microsoft YaHei UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var label = ap.name;
    var tw = ctx.measureText(label).width;
    ctx.fillStyle = P.chip;
    roundRect(ctx, -tw / 2 - 5, 12, tw + 10, 15, 4);
    ctx.fill();
    ctx.strokeStyle = hexA(cfg.color, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = off ? P.textDim : cfg.color;
    ctx.fillText(label, 0, 14.5);

    // 朝向手柄
    if (selected && ap.mount !== 'ceiling') {
      var az = (ap.azimuth || 0) * D2R;
      var hx = Math.sin(az) * 34, hy = -Math.cos(az) * 34;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(hx, hy);
      ctx.strokeStyle = hexA(cfg.color, 0.75);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, TAU);
      ctx.fillStyle = cfg.color;
      ctx.fill();
      ctx.strokeStyle = '#0b1118';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ---------- 正在绘制的线 ---------- */
  function drawDrawing(p) {
    var d = S.drawing;
    if (!d) return;
    var cfg = WS.OB_TYPES[d.type] || WS.OB_TYPES.wall;
    var s = S.view.s;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d.x1, d.y1);
    ctx.lineTo(d.x2, d.y2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max((cfg.thick || 0.15) / (p.mpp || 0.05), 2 / s);
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([5 / s, 4 / s]);
    ctx.strokeStyle = '#e0f2fe';
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 吸附提示 ----------
     淡色方框 = 附近可吸的端点；彩色标记 = 当前已吸住的目标
       蓝 = 端点 / 绿 = 墙线垂足 / 琥珀 = 与墙线的交点 */
  function drawSnapHint() {
    var s = S.view.s;
    var near = S.snapNear;
    if ((!near || !near.length) && !S.snapHint) return;

    ctx.save();

    if (near && near.length) {
      var half = 3.4 / s;
      ctx.strokeStyle = 'rgba(56,189,248,.5)';
      ctx.lineWidth = 1.2 / s;
      ctx.setLineDash([]);
      for (var i = 0; i < near.length; i++) {
        ctx.strokeRect(near[i].x - half, near[i].y - half, half * 2, half * 2);
      }
    }

    var h = S.snapHint;
    if (h) {
      var col = h.kind === 'cross' ? '#fbbf24' : (h.kind === 'edge' ? '#34d399' : '#38bdf8');
      var rPx = ((S.aids && S.aids.snapPx) ? S.aids.snapPx : 8) / s;

      /* 光标 → 吸附目标 的虚线，表明"贴到哪儿了" */
      if (S.cursorWorld) {
        ctx.beginPath();
        ctx.moveTo(S.cursorWorld.x, S.cursorWorld.y);
        ctx.lineTo(h.x, h.y);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1 / s;
        ctx.setLineDash([3 / s, 3 / s]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(h.x, h.y, Math.max(rPx * 0.6, 5 / s), 0, TAU);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6 / s;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(h.x, h.y, 2.6 / s, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();

      var c2 = 7 / s;
      ctx.beginPath();
      ctx.moveTo(h.x - c2, h.y); ctx.lineTo(h.x + c2, h.y);
      ctx.moveTo(h.x, h.y - c2); ctx.lineTo(h.x, h.y + c2);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1 / s;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 框选矩形 ---------- */
  function drawMarquee(p) {
    var m = S.marquee;
    if (!m) return;
    var s = S.view.s;
    var x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    var w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);

    ctx.save();
    ctx.fillStyle = 'rgba(56,189,248,.10)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(56,189,248,.92)';
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    /* 光标旁的范围提示：明确「本模式只框选什么」 */
    if (m.hint) {
      var fs = 11 / s;
      ctx.font = '600 ' + fs + 'px "Microsoft YaHei UI",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      var tw = ctx.measureText(m.hint).width;
      var bx = x, by = y - fs * 2.2;
      if (by < 2 / s) by = y + h + fs * 0.6;
      ctx.fillStyle = 'rgba(9,15,22,.88)';
      roundRect(ctx, bx, by, tw + 12 / s, fs * 1.8, 4 / s);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56,189,248,.55)';
      ctx.lineWidth = 1 / s;
      ctx.stroke();
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(m.hint, bx + 6 / s, by + fs * 0.95);
    }
    ctx.restore();
  }

  /* ---------- 比例标定 ---------- */
  function drawCalib(p) {
    var c = S.calib;
    if (!c || !c.p1) return;
    var s = S.view.s;
    var x2 = c.p2 ? c.p2.x : c.cur.x;
    var y2 = c.p2 ? c.p2.y : c.cur.y;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c.p1.x, c.p1.y);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2 / s;
    ctx.setLineDash([7 / s, 5 / s]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fbbf24';
    [c.p1, { x: x2, y: y2 }].forEach(function (pt) {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5 / s, 0, TAU); ctx.fill();
    });

    // 实时像素长度
    var dpx = Math.hypot(x2 - c.p1.x, y2 - c.p1.y);
    var mpp = p.mpp || 0.05;
    var txt = Math.round(dpx) + ' px';
    ctx.font = '600 ' + (12 / s) + 'px "Microsoft YaHei UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(9,15,22,.85)';
    var tw = ctx.measureText(txt).width;
    roundRect(ctx, (c.p1.x + x2) / 2 - tw / 2 - 6 / s, (c.p1.y + y2) / 2 - 22 / s, tw + 12 / s, 17 / s, 4 / s);
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(txt, (c.p1.x + x2) / 2, (c.p1.y + y2) / 2 - 8 / s);
    ctx.restore();
  }

  /* ---------- 屏幕比例尺 ---------- */
  function drawScaleBar(p, P) {
    var mpp = p.mpp || 0.05;
    var screenPxPerM = (1 / mpp) * S.view.s;
    if (!isFinite(screenPxPerM) || screenPxPerM <= 0) return;

    var cands = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
    var meters = cands[0];
    for (var i = 0; i < cands.length; i++) {
      if (cands[i] * screenPxPerM <= 150) meters = cands[i];
    }
    var len = meters * screenPxPerM;
    if (len < 26) return;

    var x0 = 16, y0 = H - 84;
    ctx.save();
    ctx.font = '11px "Microsoft YaHei UI",sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // 底衬
    ctx.fillStyle = P.chip;
    roundRect(ctx, x0 - 8, y0 - 20, len + 16, 32, 5);
    ctx.fill();

    // 尺条
    var segsCount = 4;
    var seg = len / segsCount;
    for (var k = 0; k < segsCount; k++) {
      ctx.fillStyle = k % 2 === 0 ? P.text : 'transparent';
      if (k % 2 === 0) ctx.fillRect(x0 + k * seg, y0 - 5, seg, 5);
      ctx.strokeStyle = P.text;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + k * seg, y0 - 5, seg, 5);
    }
    // 端点刻度
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 8); ctx.lineTo(x0, y0 + 1);
    ctx.moveTo(x0 + len, y0 - 8); ctx.lineTo(x0 + len, y0 + 1);
    ctx.strokeStyle = P.text;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = P.text;
    ctx.fillText(meters >= 1 ? (meters + ' m') : (meters * 100 + ' cm'), x0, y0 - 10);
    ctx.restore();
  }

  /* ---------- 命中测试 ---------- */
  WS.hitTest = function (wx, wy) {
    var p = S.project;
    var tol = 7 / S.view.s;
    var best = null, bestD = Infinity;
    var i;

    // AP 优先
    for (i = 0; i < p.aps.length; i++) {
      var ap = p.aps[i];
      var d = Math.hypot(ap.x - wx, ap.y - wy);
      if (d < 13 / S.view.s && d < bestD) { bestD = d; best = { kind: 'ap', id: ap.id }; }
    }
    if (best) return best;

    // 朝向手柄
    if (S.sel && S.sel.kind === 'ap') {
      var sap = WS.findAp(S.sel.id);
      if (sap && sap.mount !== 'ceiling') {
        var az = (sap.azimuth || 0) * D2R;
        var hx = sap.x + Math.sin(az) * 34 / S.view.s;
        var hy = sap.y - Math.cos(az) * 34 / S.view.s;
        if (Math.hypot(hx - wx, hy - wy) < 9 / S.view.s) {
          return { kind: 'ap-handle', id: sap.id };
        }
      }
    }

    // 已选中墙体的端点：优先级高于墙体本体，便于拖拽端点微调
    if (S.sel && S.sel.kind === 'ob') {
      var sob = WS.findOb(S.sel.id);
      if (sob) {
        var et = 10 / S.view.s;
        if (Math.hypot(sob.x1 - wx, sob.y1 - wy) < et) return { kind: 'ob-end', id: sob.id, end: 1 };
        if (Math.hypot(sob.x2 - wx, sob.y2 - wy) < et) return { kind: 'ob-end', id: sob.id, end: 2 };
      }
    }

    // 障碍物
    for (i = 0; i < p.obstacles.length; i++) {
      var o = p.obstacles[i];
      var dd = pointSegDist(wx, wy, o.x1, o.y1, o.x2, o.y2);
      /* thick 是「米」，tol 是「像素」：先把半厚度换算成像素再取大，
         否则粗墙在放大后反而点不中（旧写法直接比大小，单位混用） */
      var halfPx = ((o.thick || 0.15) / 2) / (p.mpp || 0.05);
      var w = Math.max(halfPx, tol);
      if (dd < w && dd < bestD) { bestD = dd; best = { kind: 'ob', id: o.id }; }
    }
    return best;
  };

  function pointSegDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    var t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = WS.clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  /* ---------- 查找 ---------- */
  WS.findAp = function (id) {
    var a = S.project.aps;
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  };
  WS.findOb = function (id) {
    var a = S.project.obstacles;
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  };

})(window.WS);
