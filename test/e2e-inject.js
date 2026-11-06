/* ============================================================
   e2e-inject.js — 端到端回归断言（仅测试用，不参与打包）
   由 build/e2e.js 注入到 _test.html 后，用 Chrome headless 跑
   结果写入 <div id="E2E_RESULT">
   ============================================================ */
(function () {
  'use strict';

  var lines = [];
  var pass = 0, fail = 0;

  function ok(name, cond, detail) {
    if (cond) { pass++; lines.push('PASS | ' + name + (detail ? ' | ' + detail : '')); }
    else { fail++; lines.push('FAIL | ' + name + (detail ? ' | ' + detail : '')); }
  }
  function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.5 : tol); }

  window.addEventListener('error', function (e) {
    fail++;
    lines.push('FAIL | 运行时异常 | ' + e.message + ' @' + (e.filename || '') + ':' + (e.lineno || ''));
  });

  var cv, cvRect;
  function scr(wx, wy) {
    var v = WS.state.view;
    return { x: wx * v.s + v.ox, y: wy * v.s + v.oy };
  }
  function mouse(type, sx, sy, extra) {
    var o = {
      clientX: cvRect.left + sx, clientY: cvRect.top + sy,
      button: 0, buttons: 1, bubbles: true, cancelable: true
    };
    if (extra) for (var k in extra) o[k] = extra[k];
    var target = (type === 'mousedown') ? cv : window;
    target.dispatchEvent(new MouseEvent(type, o));
  }
  function key(k, extra) {
    var o = { key: k, bubbles: true, cancelable: true };
    if (extra) for (var x in extra) o[x] = extra[x];
    window.dispatchEvent(new KeyboardEvent('keydown', o));
  }
  function down(wx, wy, extra) { var s = scr(wx, wy); mouse('mousedown', s.x, s.y, extra); }
  function move(wx, wy, extra) { var s = scr(wx, wy); mouse('mousemove', s.x, s.y, extra); }
  function up() { mouse('mouseup', 0, 0); }

  function resetScene(obs, aps) {
    var p = WS.newProject();
    p._blank = true;
    p.imgW = 1400; p.imgH = 1000;
    p.mpp = 0.05;
    p.calibrated = true;
    WS._ui.applyProject(p);
    var S = WS.state;
    S.project.obstacles = [];
    S.project.aps = [];
    (obs || []).forEach(function (a) { S.project.obstacles.push(WS.makeObstacle(a[0], a[1], a[2], a[3], a[4])); });
    (aps || []).forEach(function (a) {
      var ap = WS.makeAp(a[0], a[1], a[2], 1);
      ap.name = a[3];
      S.project.aps.push(ap);
    });
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    S.sel = null; S.drag = null; S.drawing = null;
    S.aids.snap = true; S.aids.ortho = true; S.aids.edgePan = true;
    WS._ui.setTool('select');
    WS._ui.rebuildHeat();
    WS.requestDraw();
  }

  /* 统计热力图重算次数 */
  var heatCalls = 0;
  function hookHeat() {
    var orig = WS.computeHeat;
    WS.computeHeat = function () { heatCalls++; return orig.apply(null, arguments); };
  }

  function run() {
    var S = WS.state;
    cv = document.getElementById('cv');
    cvRect = cv.getBoundingClientRect();
    hookHeat();

    /* ============ T1 拖动 AP 期间不重算热力图 ============ */
    resetScene([[ 'brick', 100, 100, 700, 100 ]], [['ceiling', 300, 300, 'AP-1']]);
    WS._ui.setMode('device');          /* v1.7 起：平面模式按类型拦截，AP 只能在设备编辑里操作 */
    heatCalls = 0;
    var ap = S.project.aps[0];
    down(300, 300);
    ok('T1a 点击 AP 进入拖动', S.drag && S.drag.type === 'move-ap', S.drag && S.drag.type);
    for (var i = 1; i <= 12; i++) move(300 + i * 8, 300 + i * 4);
    ok('T1b 拖动 12 帧内热力图重算 0 次', heatCalls === 0, '实测 ' + heatCalls + ' 次');
    ok('T1c 拖动期 heatStale 标记为真', S.heatStale === true);
    ok('T1d AP 位置确实跟手', near(ap.x, 396, 1) && near(ap.y, 348, 1), ap.x.toFixed(1) + ',' + ap.y.toFixed(1));
    up();
    ok('T1e 松手后只算 1 次', heatCalls === 1, '实测 ' + heatCalls + ' 次');
    ok('T1f 松手后 heatStale 复位', S.heatStale === false);

    /* ============ T2 选中墙体后拖端点 ============ */
    resetScene([['brick', 200, 400, 600, 400]], []);
    WS._ui.setMode('plan');            /* 墙体在平面编辑模式下操作 */
    var wall = S.project.obstacles[0];
    down(400, 400); up();                       /* 先点选墙体 */
    ok('T2a 点选到墙体', S.sel && S.sel.kind === 'ob');
    down(602, 400);                             /* 抓右端点 */
    ok('T2b 命中端点手柄', S.drag && S.drag.type === 'move-ob-end', S.drag && S.drag.type);
    move(600, 520);
    up();
    ok('T2c 端点已移动', near(wall.x2, 600, 1) && near(wall.y2, 520, 1), wall.x2 + ',' + wall.y2);
    ok('T2d 另一端保持不动', near(wall.x1, 200, 0.01) && near(wall.y1, 400, 0.01), wall.x1 + ',' + wall.y1);

    /* ============ T3 端点吸附半径 ============ */
    resetScene([['brick', 200, 400, 600, 400]], []);
    WS._ui.setTool('wall');
    down(207, 400);                             /* 距端点 7 px，应吸附 */
    ok('T3a 7 px 内吸附到端点', S.drawing && near(S.drawing.x1, 200, 0.01) && near(S.drawing.y1, 400, 0.01),
      S.drawing ? (S.drawing.x1 + ',' + S.drawing.y1) : 'no drawing');
    move(400, 400); up();
    WS._ui.setTool('wall');
    down(210, 400);                             /* 距端点 10 px，超出 8 px 半径，不应吸附 */
    ok('T3b 10 px 外不吸附', S.drawing && near(S.drawing.x1, 210, 0.01), S.drawing ? String(S.drawing.x1) : 'no drawing');
    up();

    /* ============ T4 直线修正 ============ */
    WS._ui.setTool('wall');
    down(100, 600);
    move(400, 630);                             /* 偏 30/300 = 0.10 < 0.16（默认阈值）→ 拉直 */
    ok('T4a 近似水平自动拉直', S.drawing && near(S.drawing.y2, 600, 0.01), S.drawing ? String(S.drawing.y2) : 'no drawing');
    move(400, 700);                             /* 偏 100/300 = 0.33 > 0.16 → 不拉直 */
    ok('T4b 明显倾斜不修正', S.drawing && near(S.drawing.y2, 700, 0.01), S.drawing ? String(S.drawing.y2) : 'no drawing');
    up();

    /* ============ T5 关掉开关后失效 ============ */
    S.aids.ortho = false;
    S.aids.snap = false;
    WS._ui.setTool('wall');
    down(100, 600);
    move(400, 630);
    ok('T5a 关闭直线修正后不拉直', S.drawing && near(S.drawing.y2, 630, 0.01), S.drawing ? String(S.drawing.y2) : 'no drawing');
    up();
    S.aids.ortho = true;
    S.aids.snap = false;                        /* 只关吸附，验证吸附确实失效 */
    WS._ui.setTool('wall');
    down(207, 400);
    ok('T5b 关闭吸附后不吸附', S.drawing && near(S.drawing.x1, 207, 0.01), S.drawing ? String(S.drawing.x1) : 'no drawing');
    up();
    S.aids.snap = true;

    /* ============ T6 Esc 退回选择工具 ============ */
    WS._ui.setMode('device');
    WS._ui.setTool('ap-ceiling');
    key('Escape');
    ok('T6a Esc 从吸顶 AP 回到选择工具', S.tool === 'select', S.tool);

    resetScene([], [['ceiling', 500, 500, 'AP-9']]);
    down(500, 500); up();
    ok('T6b 选中 AP', S.sel && S.sel.kind === 'ap');
    key('Escape');
    ok('T6c 选择工具下 Esc 取消选中', S.sel === null);

    /* ============ T7 Ctrl+Shift+A ============ */
    WS._ui.setMode('plan');
    key('a', { ctrlKey: true, shiftKey: true });
    ok('T7 Ctrl+Shift+A 切到吸顶 AP', S.mode === 'device' && S.tool === 'ap-ceiling', S.mode + '/' + S.tool);

    /* ============ T8 画线边缘自动滚屏 ============ */
    resetScene([], []);
    WS._ui.setMode('plan');
    WS._ui.setTool('wall');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    down(100, 500);
    var ox0 = S.view.ox;
    var x2before = S.drawing ? S.drawing.x2 : 0;
    var vw = WS.viewSize();
    var sEdge = scr(vw.w - 8, 500);
    mouse('mousemove', sEdge.x, sEdge.y);

    pendingEdgeCheck = function () {
      ok('T8a 边缘停靠后视图自动左移', S.view.ox < ox0 - 5, 'ox ' + ox0 + ' → ' + S.view.ox.toFixed(1));
      ok('T8b 线段随视图延长', S.drawing && S.drawing.x2 > x2before + 5,
        x2before + ' → ' + (S.drawing ? S.drawing.x2.toFixed(1) : 'null'));
      up();
      ok('T8c 松手后停止绘制', S.drawing === null);

      /* ============ T9 整体平移墙体同样不重算 ============ */
      /* 必须放一台 AP，否则 rebuildHeat 会因为没有 AP 直接短路，测不出重算次数 */
      resetScene([['brick', 300, 700, 700, 700]], [['ceiling', 900, 200, 'AP-X']]);
      /* v1.7.2 起：热力图不可见时不再计算，这里显式打开才能验证「松手后重算」 */
      S.layers.heat = true; S.showHeat = true;
      heatCalls = 0;
      down(500, 700);
      ok('T9a 命中墙体本体进入平移', S.drag && S.drag.type === 'move-ob', S.drag && S.drag.type);
      for (var q = 1; q <= 8; q++) move(500 + q * 5, 700 + q * 3);
      ok('T9b 平移墙体期间热力图重算 0 次', heatCalls === 0, '实测 ' + heatCalls + ' 次');
      ok('T9c 平移期 heatStale 为真', S.heatStale === true);
      up();
      ok('T9d 松手后算 1 次', heatCalls === 1, '实测 ' + heatCalls + ' 次');

      /* ============ T10 关闭边缘滚屏后视图不动 ============ */
      resetScene([], []);
      S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
      S.aids.edgePan = false;
      WS._ui.setTool('wall');
      down(100, 500);
      var oxA = S.view.ox;
      var vw2 = WS.viewSize();
      var sEdge2 = scr(vw2.w - 8, 500);
      mouse('mousemove', sEdge2.x, sEdge2.y);
      setTimeout(function () {
        ok('T10 关闭边缘滚屏后视图保持不动', Math.abs(S.view.ox - oxA) < 0.001,
          'ox ' + oxA + ' → ' + S.view.ox);
        up();
        S.aids.edgePan = true;

        /* ============ T11 辅助开关按钮接线 ============ */
        WS._ui.setMode('plan');
        var bar = document.getElementById('aidsBar');
        var btns = bar ? bar.querySelectorAll('[data-aid]') : [];
        ok('T11a 四个辅助按钮存在', btns.length === 4, '实际 ' + btns.length + ' 个');
        var allOn = true;
        for (var b = 0; b < btns.length; b++) if (!btns[b].classList.contains('on')) allOn = false;
        ok('T11b 默认全部开启（.on）', allOn);
        ok('T11c 平面模式下可见', bar && !bar.hidden, 'hidden=' + (bar && bar.hidden));

        var orthoBtn = bar.querySelector('[data-aid="ortho"]');
        orthoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        ok('T11d 点击后状态翻转', S.aids.ortho === false && !orthoBtn.classList.contains('on'),
          'ortho=' + S.aids.ortho);
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem('ws_aids_v1')); } catch (e) {}
        ok('T11e 开关状态已写入 localStorage', saved && saved.ortho === false, JSON.stringify(saved));
        orthoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        ok('T11f 再点一次恢复开启', S.aids.ortho === true);

        WS._ui.setMode('device');
        ok('T11g 设备模式下自动隐藏', bar.hidden === true);
        WS._ui.setMode('plan');

        checkMarquee();
      }, 320);
    };
  }


  var pendingEdgeCheck = null;

  /* ============ 框选 / 批量编辑 ============ */
  function boxDrag(x0, y0, x1, y1) {
    down(x0, y0, { ctrlKey: true });
    move((x0 + x1) / 2, (y0 + y1) / 2, { ctrlKey: true });
    move(x1, y1, { ctrlKey: true });
    up();
  }

  function sceneForMarquee() {
    /* 两个框内墙、一个框外墙、两台框内 AP —— 用来验证模式限制不会跨类型混选 */
    resetScene([
      ['brick', 100, 100, 220, 100],
      ['concrete', 150, 150, 150, 260],
      ['brick', 900, 900, 980, 900]
    ], [
      ['ceiling', 300, 300, 'AP-A'],
      ['wall', 380, 400, 'WAP-B']
    ]);
  }

  function checkMarquee() {
    var S = WS.state;
    var tipEl = document.getElementById('tipBar');
    var walls = 0, aps = 0;

    /* ---- T12 平面编辑：只框墙体 ---- */
    sceneForMarquee();
    WS._ui.setMode('plan');
    boxDrag(50, 50, 500, 500);
    ok('T12a 平面模式框选类型为墙体', S.selKind === 'ob', String(S.selKind));
    walls = S.project.obstacles.filter(function (o) { return S.selIds.indexOf(o.id) >= 0; }).length;
    aps = S.project.aps.filter(function (a) { return S.selIds.indexOf(a.id) >= 0; }).length;
    ok('T12b 框内 2 段墙被选中', walls === 2, '实测 ' + walls + ' 段');
    ok('T12c 框内的 AP 未被选中', aps === 0, '实测 ' + aps + ' 台');
    ok('T12d 框外的墙未被选中', S.selIds.length === 2, '选中 ' + S.selIds.length + ' 个');

    /* ---- T13 设备编辑：只框 AP ---- */
    sceneForMarquee();
    WS._ui.setMode('device');
    boxDrag(50, 50, 500, 500);
    ok('T13a 设备模式框选类型为 AP', S.selKind === 'ap', String(S.selKind));
    ok('T13b 框内 2 台 AP 被选中', S.selIds.length === 2, '选中 ' + S.selIds.length + ' 个');
    ok('T13c 墙体未被一并选中',
      S.project.obstacles.every(function (o) { return S.selIds.indexOf(o.id) < 0; }));

    /* ---- T14 框选过程中的提示词 ---- */
    sceneForMarquee();
    WS._ui.setMode('plan');
    down(50, 50, { ctrlKey: true });
    move(300, 300, { ctrlKey: true });
    ok('T14a 拖动中出现框选提示', tipEl.textContent.indexOf('仅框选墙体') >= 0, tipEl.textContent.slice(0, 40));
    ok('T14b 提示含实时数量', tipEl.textContent.indexOf('当前覆盖') >= 0, tipEl.textContent.slice(0, 46));
    ok('T14c 画布角标含范围说明', S.marquee && S.marquee.hint.indexOf('仅框选墙体') === 0, S.marquee && S.marquee.hint);
    up();
    ok('T14d 松手后提示改为结果', tipEl.textContent.indexOf('已框选') >= 0, tipEl.textContent.slice(0, 40));

    /* ---- T15 Ctrl+单击 = 普通点选（与点击选择共存）---- */
    sceneForMarquee();
    WS._ui.setMode('plan');
    boxDrag(50, 50, 500, 500);
    ok('T15a 框选得到 2 段', S.selIds.length === 2);
    down(160, 100); move(162, 101); up();          /* 不带 Ctrl 单击某一段 */
    ok('T15b 普通点击变回单选', S.selIds.length === 1 && S.selKind === 'ob', '选中 ' + S.selIds.length);

    var firstWall = S.project.obstacles[0];
    down(firstWall.x1 + 2, firstWall.y1); up();     /* 点另一个端点附近=点选该墙 */
    ok('T15c 点选到的就是这段墙', S.selIds.length === 1 && S.selIds[0] === firstWall.id);

    /* ---- T16 批量改材质 ---- */
    sceneForMarquee();
    WS._ui.setMode('plan');
    boxDrag(50, 50, 500, 500);
    var typeBtn = document.querySelector('#inspBody [data-obtype="concrete"]');
    ok('T16a 批量面板出现材质按钮', !!typeBtn);
    if (typeBtn) {
      typeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      var sel = S.project.obstacles.filter(function (o) { return S.selIds.indexOf(o.id) >= 0; });
      ok('T16b 两段墙材质都改为混凝土', sel.every(function (o) { return o.type === 'concrete'; }),
        sel.map(function (o) { return o.type; }).join(','));
      ok('T16c 衰减值同步为混凝土预设', sel.every(function (o) { return o.atten24 === 25 && o.atten5 === 30; }),
        sel.map(function (o) { return o.atten24 + '/' + o.atten5; }).join(','));
    }

    /* ---- T17 批量改安装方式 ---- */
    sceneForMarquee();
    WS._ui.setMode('device');
    boxDrag(50, 50, 500, 500);
    var mountBtn = document.querySelector('#inspBody [data-mount="panel"]');
    ok('T17a 批量面板出现安装方式按钮', !!mountBtn);
    if (mountBtn) {
      mountBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      ok('T17b 两台 AP 都改为面板', S.project.aps.every(function (a) { return a.mount === 'panel'; }),
        S.project.aps.map(function (a) { return a.mount; }).join(','));
    }

    /* ---- T18 整组拖动 ---- */
    sceneForMarquee();
    WS._ui.setMode('device');
    boxDrag(50, 50, 500, 500);
    var apA = S.project.aps[0], apB = S.project.aps[1];
    var ax0 = apA.x, ay0 = apA.y, bx0 = apB.x, by0 = apB.y;
    down(apA.x, apA.y);
    ok('T18a 按住已选中的 AP 进入整组拖动', S.drag && S.drag.type === 'move-multi', S.drag && S.drag.type);
    move(apA.x + 40, apA.y + 30);
    up();
    ok('T18b 两台 AP 同步平移',
      near(apA.x, ax0 + 40, 1) && near(apA.y, ay0 + 30, 1) &&
      near(apB.x, bx0 + 40, 1) && near(apB.y, by0 + 30, 1),
      apA.x.toFixed(0) + ',' + apA.y.toFixed(0) + ' / ' + apB.x.toFixed(0) + ',' + apB.y.toFixed(0));

    /* ---- T19 批量删除 ---- */
    sceneForMarquee();
    WS._ui.setMode('device');
    boxDrag(50, 50, 500, 500);
    var beforeAp = S.project.aps.length;
    key('Delete');
    ok('T19a Delete 批量删除所选 AP', S.project.aps.length === beforeAp - 2,
      beforeAp + ' → ' + S.project.aps.length);
    ok('T19b 删除后选择集清空', S.selIds.length === 0 && S.sel === null);
    ok('T19c 墙体未受影响', S.project.obstacles.length === 3, S.project.obstacles.length + ' 段');

    /* ---- T20 关于窗口（作者签名）---- */
    document.getElementById('verBadge').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var mask = document.getElementById('modalMask');
    var body = document.getElementById('modalBody');
    ok('T20a 点击版本号弹出关于', mask.hidden === false);
    ok('T20b 关于里含作者与出生日期',
      body.textContent.indexOf('邹宁') >= 0 && body.textContent.indexOf('2004-04-17') >= 0,
      body.textContent.replace(/\s+/g, ' ').slice(0, 60));
    ok('T20c 关于里含著作权声明',
      body.textContent.indexOf('著作权') >= 0 && body.textContent.indexOf('广东广州') >= 0);
    document.getElementById('modalX').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('T20d 关于可正常关闭', mask.hidden === true);

    checkAidStrength();
  }

  /* 设置滑条值并触发 input（模拟拖动） */
  function setRange(id, v) {
    var r = document.getElementById(id);
    r.value = v;
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return r;
  }

  /* 画一条线，返回两端（用来观察吸附 / 修正结果）
     探针画出来的墙会立即撤掉，否则新端点会污染后续吸附测试 */
  function drawTo(x0, y0, x1, y1) {
    var st = WS.state;
    var before = st.project.obstacles.length;
    WS._ui.setTool('wall');
    down(x0, y0);
    move(x1, y1);
    var d = st.drawing;
    var end = d ? { x: d.x2, y: d.y2, x1: d.x1, y1: d.y1 } : null;
    up();
    if (st.project.obstacles.length > before) st.project.obstacles.length = before;
    return end;
  }

  function checkAidStrength() {
    var S = WS.state;

    /* ---- T21 默认值：两个滑条都在正中间 ---- */
    ok('T21a 吸附默认强度 = 8 px（中间值）', S.aids.snapPx === 8, String(S.aids.snapPx));
    ok('T21b 修正默认阈值 = 0.16 ≈ 9.1°（增强后的中间值）', S.aids.orthoRatio === 0.16,
      String(S.aids.orthoRatio));
    ok('T21c 滑条最大值可达到上限',
      document.getElementById('snapRange').max === '16' &&
      document.getElementById('orthoRange').max === '32',
      document.getElementById('snapRange').max + ' / ' + document.getElementById('orthoRange').max);
    ok('T21d 滑条最小值可到 0',
      document.getElementById('snapRange').min === '0' && document.getElementById('orthoRange').min === '0');

    /* ---- T22 吸附强度：0 不吸 / 16 最粘 ---- */
    resetScene([['brick', 200, 400, 600, 400]], []);
    WS._ui.setMode('plan');

    setRange('snapRange', 0);
    ok('T22a 拖到 0 时状态立即生效', S.aids.snapPx === 0);
    var e0 = drawTo(207, 400, 400, 400);
    ok('T22b 强度 0：7 px 也不吸附', e0 && near(e0.x1, 207, 0.01), e0 ? String(e0.x1) : 'null');

    setRange('snapRange', 16);
    ok('T22c 数值标签实时更新', document.getElementById('snapVal').textContent === '16 px',
      document.getElementById('snapVal').textContent);
    var e16 = drawTo(214, 400, 400, 400);
    ok('T22d 强度 16：14 px 也能吸住', e16 && near(e16.x1, 200, 0.01), e16 ? String(e16.x1) : 'null');

    setRange('snapRange', 8);
    var e8a = drawTo(214, 400, 400, 400);
    ok('T22e 回到 8：14 px 不吸附', e8a && near(e8a.x1, 214, 0.01), e8a ? String(e8a.x1) : 'null');
    var e8b = drawTo(207, 400, 400, 400);
    ok('T22f 回到 8：7 px 仍吸附', e8b && near(e8b.x1, 200, 0.01), e8b ? String(e8b.x1) : 'null');

    /* ---- T23 修正强度：0 不修正 / 32 最激进 ---- */
    resetScene([], []);
    WS._ui.setMode('plan');

    setRange('orthoRange', 0);
    ok('T23a 拖到 0 时状态立即生效', S.aids.orthoRatio === 0);
    var o0 = drawTo(100, 600, 400, 630);
    ok('T23b 强度 0：完全水平也不拉直', o0 && near(o0.y, 630, 0.01), o0 ? String(o0.y) : 'null');

    setRange('orthoRange', 32);
    ok('T23c 数值标签实时更新为 17.7°',
      document.getElementById('orthoVal').textContent === '17.7°',
      document.getElementById('orthoVal').textContent);
    var o32 = drawTo(100, 600, 400, 690);      /* 偏差 0.30 < 0.32 */
    ok('T23d 强度 17.7°：偏差 16.7° 被拉直', o32 && near(o32.y, 600, 0.01), o32 ? String(o32.y) : 'null');

    setRange('orthoRange', 16);
    var o16a = drawTo(100, 600, 400, 690);     /* 偏差 0.30 > 0.16 */
    ok('T23e 回到 9.1°：偏差 16.7° 不拉直', o16a && near(o16a.y, 690, 0.01), o16a ? String(o16a.y) : 'null');
    var o16b = drawTo(100, 600, 400, 640);     /* 偏差 0.133 < 0.16 */
    ok('T23f 回到 9.1°：偏差 7.6° 被拉直', o16b && near(o16b.y, 600, 0.01), o16b ? String(o16b.y) : 'null');

    /* ---- T24 强度写入 localStorage（用非默认值验证，避免"存了默认值也算过"）---- */
    setRange('snapRange', 13);
    setRange('orthoRange', 27);
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('ws_aids_v1')); } catch (e) {}
    ok('T24a 非默认强度已持久化',
      saved && saved.snapPx === 13 && Math.abs(saved.orthoRatio - 0.27) < 1e-9,
      JSON.stringify(saved));
    setRange('snapRange', 8);
    setRange('orthoRange', 16);

    /* ---- T25 关掉开关时滑条变灰只读 ---- */
    document.querySelector('[data-aid="snap"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var row = document.querySelector('.aid-slider[data-slider="snap"]');
    ok('T25 关闭吸附后滑条置灰只读',
      row.classList.contains('dim') && document.querySelector('#snapRange').disabled === true);
    document.querySelector('[data-aid="snap"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    /* ---- T26 强度滑条随模式显示/隐藏 ---- */
    WS._ui.setMode('device');
    ok('T26a 设备模式下强度滑条一并隐藏', document.getElementById('aidSliders').hidden === true);
    WS._ui.setMode('plan');
    ok('T26b 回到平面模式恢复显示', document.getElementById('aidSliders').hidden === false);

    checkRfOverlap();
  }

  /* 下拉框赋值并触发 change */
  function setSelect(id, v) {
    var e = document.getElementById(id);
    e.value = v;
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return e;
  }

  function optValues(id) {
    return Array.prototype.map.call(document.getElementById(id).options, function (o) { return o.value; }).join(',');
  }

  function checkRfOverlap() {
    var S = WS.state;

    /* ---- T27 新项目默认值 ---- */
    var p0 = WS.newProject();
    ok('T27a 新项目默认 2.4G / Ch.1 / 20MHz',
      p0.settings.band === '24' && p0.settings.channel === 1 && p0.settings.bw === 20,
      p0.settings.band + ' / Ch.' + p0.settings.channel + ' / ' + p0.settings.bw + 'MHz');
    ok('T27b 默认射频区域为中国', p0.settings.region === 'CN', p0.settings.region);

    /* ---- T28 频宽选项按频段限制 ---- */
    resetScene([], []);
    WS._ui.setMode('device');
    setSelect('selBand', '24');
    ok('T28a 2.4G 只有 20 / 40 MHz', optValues('selBw') === '20,40', optValues('selBw'));
    ok('T28b 切到 2.4G 默认 Ch.1 + 20MHz',
      S.project.settings.channel === 1 && S.project.settings.bw === 20,
      'Ch.' + S.project.settings.channel + ' / ' + S.project.settings.bw);
    ok('T28c 2.4G 中心频点 2412', S.project.settings.freq === 2412, String(S.project.settings.freq));

    setSelect('selBand', '5');
    ok('T28d 5G 有 20 / 40 / 80 / 160 MHz', optValues('selBw') === '20,40,80,160', optValues('selBw'));
    ok('T28e 切到 5G 默认 Ch.36 + 80MHz',
      S.project.settings.channel === 36 && S.project.settings.bw === 80,
      'Ch.' + S.project.settings.channel + ' / ' + S.project.settings.bw);
    ok('T28f 5G 中心频点 5180', S.project.settings.freq === 5180, String(S.project.settings.freq));

    var chs = document.getElementById('selChannel');
    ok('T28g 5G 信道列表按区域给出（中国 13 个）', chs.options.length === 13, String(chs.options.length));

    /* ---- T29 中国 / 澳洲 一键切换 ---- */
    var apP = WS.makeAp('ceiling', 400, 400, 1);
    apP.power = 20; apP.gain = 4;                 /* EIRP 24 dBm */
    S.project.aps.push(apP);
    setSelect('selBand', '24');
    apP.power = 20;                                /* 2.4G 切频段时已被中国标准夹到 16，这里复位再测 */

    document.querySelector('[data-region="AU"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('T29a 切到澳洲：2.4G 上限 36 dBm', WS.eirpLimit('AU', 2437).dbm === 36,
      String(WS.eirpLimit('AU', 2437).dbm));
    ok('T29b 澳洲标准下 24 dBm EIRP 不超限，功率保持 20', apP.power === 20, String(apP.power));

    document.querySelector('[data-region="CN"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('T29c 切到中国：2.4G 上限 20 dBm', WS.eirpLimit('CN', 2437).dbm === 20,
      String(WS.eirpLimit('CN', 2437).dbm));
    ok('T29d 中国标准下功率被压到 16 dBm（20 − 增益 4）', apP.power === 16, String(apP.power));
    ok('T29e 切换时给出收紧提示',
      document.getElementById('tipBar').textContent.indexOf('收紧') >= 0,
      document.getElementById('tipBar').textContent.slice(0, 46));
    ok('T29f 区域提示显示 EIRP 上限',
      document.getElementById('regionHint').textContent.indexOf('20 dBm') >= 0,
      document.getElementById('regionHint').textContent);

    /* ---- T30 重叠判定 ---- */
    function ovScene(chA, bwA, chB, bwB, thr) {
      resetScene([], []);
      var st = S.project.settings;
      st.band = '5'; st.channel = chA; st.bw = bwA; st.freq = WS.chMhz('5', chA);
      st.overlapThr = thr == null ? -67 : thr;
      var a = WS.makeAp('ceiling', 400, 400, 1);
      var b = WS.makeAp('ceiling', 620, 400, 2);
      a.power = 20; a.gain = 4; b.power = 20; b.gain = 4;
      if (chB != null) b.channel = chB;
      if (bwB != null) b.bw = bwB;
      S.project.aps = [a, b];
      S.layers.overlap = true;
      WS._ui.rebuildOverlap();
      return S.overlap ? S.overlap.count : 0;
    }

    var same = ovScene(36, 20, null, null);
    ok('T30a 同信道 + 两侧都够强 → 有重叠', same > 0, same + ' 格');
    ok('T30b 能提出矢量轮廓', S.overlapPolys && S.overlapPolys.length >= 1,
      (S.overlapPolys ? S.overlapPolys.length : 0) + ' 个');
    ok('T30c 轮廓是闭合折线', S.overlapPolys && S.overlapPolys[0].length >= 4,
      S.overlapPolys ? String(S.overlapPolys[0].length) + ' 点' : 'none');

    var diff = ovScene(36, 20, 44, 20);
    ok('T30d 不同信道（频段不相交）→ 无重叠', diff === 0, diff + ' 格');

    var bwOverlap = ovScene(36, 80, 44, 20);
    ok('T30e 中心信道不同但频段相交（36@80M vs 44@20M）→ 算重叠',
      bwOverlap > 0, bwOverlap + ' 格');

    var loose = ovScene(36, 20, null, null, -80);
    var base = ovScene(36, 20, null, null, -67);
    var tight = ovScene(36, 20, null, null, -50);
    ok('T30f 阈值越低重叠区越大', loose > base && base > tight,
      '-' + 80 + ':' + loose + ' / -67:' + base + ' / -50:' + tight);

    /* ---- T31 单台 AP 不构成重叠 ---- */
    resetScene([], []);
    var only = WS.makeAp('ceiling', 400, 400, 1);
    S.project.aps = [only];
    S.layers.overlap = true;
    WS._ui.rebuildOverlap();
    ok('T31 只有一台 AP 时无重叠', !S.overlap || S.overlap.empty === true,
      S.overlap ? String(S.overlap.count) : 'null');
    ok('T31b 单台 AP 时轮廓为空', !S.overlapPolys || S.overlapPolys.length === 0);
    S.layers.overlap = false;

    checkThickAndLayers();
  }

  function checkThickAndLayers() {
    var S = WS.state;

    /* ---- T32 墙体衰减按厚度自动计算 ---- */
    var w = WS.makeObstacle('brick', 100, 100, 300, 100);
    ok('T32a 新建墙体默认自动衰减', w.autoAtten === true, String(w.autoAtten));
    ok('T32b 砖墙 120mm → 2.4G 衰减 4 dB', Math.abs(WS.obAtten(w, 2437) - 4) < 0.05,
      WS.obAtten(w, 2437) + ' dB');
    ok('T32c 砖墙 120mm → 5G 衰减 7 dB', Math.abs(WS.obAtten(w, 5180) - 7) < 0.05,
      WS.obAtten(w, 5180) + ' dB');

    w.thick = 0.24;                                  /* 厚度翻倍 → 衰减翻倍 */
    ok('T32d 厚度 240mm → 2.4G 衰减 8 dB', Math.abs(WS.obAtten(w, 2437) - 8) < 0.05,
      WS.obAtten(w, 2437) + ' dB');
    ok('T32e 厚度 240mm → 5G 衰减 14 dB', Math.abs(WS.obAtten(w, 5180) - 14) < 0.05,
      WS.obAtten(w, 5180) + ' dB');

    var cc = WS.makeObstacle('concrete', 0, 0, 100, 0);
    cc.thick = 0.36;                                 /* 混凝土 360mm */
    ok('T32f 混凝土 360mm → 2.4G 37.5 dB', Math.abs(WS.obAtten(cc, 2437) - 37.5) < 0.2,
      WS.obAtten(cc, 2437) + ' dB');

    /* 手动模式：改厚度不影响衰减 */
    w.autoAtten = false;
    w.atten24 = 12; w.atten5 = 18;
    w.thick = 0.12;
    ok('T32g 手动模式下衰减不随厚度变化',
      WS.obAtten(w, 2437) === 12 && WS.obAtten(w, 5180) === 18,
      WS.obAtten(w, 2437) + ' / ' + WS.obAtten(w, 5180));

    /* 老数据迁移：预设值 → 自动；手改过 → 手动 */
    var legacy = { id: 'x1', type: 'brick', x1: 0, y1: 0, x2: 10, y2: 0, atten24: 4, atten5: 7, thick: 0.12 };
    WS.normalizeObstacle(legacy);
    ok('T32h 老数据衰减=预设值 → 推断为自动', legacy.autoAtten === true);
    var legacy2 = { id: 'x2', type: 'brick', x1: 0, y1: 0, x2: 10, y2: 0, atten24: 30, atten5: 40, thick: 0.12 };
    WS.normalizeObstacle(legacy2);
    ok('T32i 老数据衰减被手改过 → 保持手动', legacy2.autoAtten === false);

    /* ---- T33 切换模式自动管图层 ---- */
    resetScene([], []);
    S.layers.heat = true; S.showHeat = true;
    S.layers.beam = true; S.layers.ap = true; S.layers.overlap = true;
    WS._ui.setMode('plan');
    ok('T33a 平面编辑：热力图关闭', S.layers.heat === false && S.showHeat === false);
    ok('T33b 平面编辑：天线方向图关闭', S.layers.beam === false);
    ok('T33c 平面编辑：无线设备关闭', S.layers.ap === false);
    ok('T33d 平面编辑：信号重叠关闭', S.layers.overlap === false);
    ok('T33e 复选框同步',
      document.getElementById('layHeat').checked === false &&
      document.getElementById('layBeam').checked === false &&
      document.getElementById('layAp').checked === false &&
      document.getElementById('layOverlap').checked === false &&
      document.getElementById('heatToggle').checked === false);

    WS._ui.setMode('device');
    ok('T33f 设备编辑：无线设备自动打开', S.layers.ap === true);
    ok('T33g 设备编辑：其余图层恢复为进入平面模式前的状态',
      S.layers.heat === true && S.showHeat === true &&
      S.layers.beam === true && S.layers.overlap === true,
      'heat=' + S.layers.heat + ' beam=' + S.layers.beam + ' ov=' + S.layers.overlap);

    /* ---- T34 新手引导元素 ---- */
    resetScene([], []);
    WS._ui.setMode('plan');
    var mt = document.getElementById('modeTip');
    ok('T34a 平面模式说明条', mt && mt.textContent.indexOf('平面编辑') === 0, mt && mt.textContent);
    WS._ui.setMode('device');
    ok('T34b 设备模式说明条', mt.textContent.indexOf('设备编辑') === 0, mt.textContent);
    ok('T34c 区块序号存在', document.querySelectorAll('.sect-n').length >= 3,
      String(document.querySelectorAll('.sect-n').length));
    ok('T34d 空状态三步引导存在', document.querySelectorAll('.steps .step').length === 3,
      String(document.querySelectorAll('.steps .step').length));

    WS._ui.setMode('plan');

    checkWallSnap();
  }

  /* 画一条探针线并读取落点（画完立即撤回，避免污染后续场景） */
  function probeSnap(x0, y0, x1, y1, opts) {
    var st = WS.state;
    var before = st.project.obstacles.length;
    WS._ui.setTool('wall');
    down(x0, y0, opts);
    move(x1, y1, opts);
    var d = st.drawing;
    var h = st.snapHint;
    var res = d ? {
      x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2,
      hint: h ? { x: h.x, y: h.y, k: h.kind } : null
    } : null;
    up();
    if (st.project.obstacles.length > before) st.project.obstacles.length = before;
    return res;
  }

  function checkWallSnap() {
    var S = WS.state;
    var r;

    /* ---- T35 端点吸附仍然有效（回归）---- */
    resetScene([['brick', 200, 200, 400, 200]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    r = probeSnap(300, 400, 203, 203);
    ok('T35 端点吸附（4 px 内）', r && near(r.x2, 200, 0.6) && near(r.y2, 200, 0.6) && r.hint && r.hint.k === 'end',
      r ? (r.x2 + ',' + r.y2 + ' / ' + (r.hint && r.hint.k)) : 'null');

    /* ---- T36 交点吸附：水平墙拖到斜墙旁，端点落到两条线的交点 ---- */
    resetScene([['brick', 500, 400, 700, 600]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    r = probeSnap(300, 500, 596, 500);
    ok('T36a 端点贴到与斜墙的交点 (600,500)',
      r && near(r.x2, 600, 0.8) && near(r.y2, 500, 0.8),
      r ? (r.x2.toFixed(1) + ',' + r.y2.toFixed(1)) : 'null');
    ok('T36b 吸附类型标记为交点', r && r.hint && r.hint.k === 'cross', r && r.hint ? r.hint.k : 'none');

    /* ---- T37 交点必须真的落在已有墙段上（不能吸到延长线的空中）---- */
    resetScene([['brick', 600, 400, 700, 400]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    r = probeSnap(300, 500, 590, 400);
    ok('T37 交点落在墙段外 → 不吸附', r && near(r.x2, 590, 0.8) && !r.hint,
      r ? (r.x2.toFixed(1) + ' / kind=' + (r.hint ? r.hint.k : 'none')) : 'null');

    /* ---- T38 垂足吸附：两墙近水平、无有效交点时贴到墙上 ---- */
    resetScene([['brick', 500, 400, 700, 400]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    setRange('orthoRange', 0);                  /* 关掉直线修正，才轮到垂足吸附 */
    r = probeSnap(400, 410, 600, 405);
    ok('T38a 关闭直线修正后贴到墙上最近点 (600,400)',
      r && near(r.x2, 600, 0.8) && near(r.y2, 400, 0.8),
      r ? (r.x2.toFixed(1) + ',' + r.y2.toFixed(1)) : 'null');
    ok('T38b 吸附类型标记为墙线', r && r.hint && r.hint.k === 'edge', r && r.hint ? r.hint.k : 'none');
    setRange('orthoRange', 16);
    r = probeSnap(400, 410, 600, 405);
    ok('T38c 直线修正开启时正交优先：保持 y=410 且不吸平行墙',
      r && near(r.y2, 410, 0.01) && !r.hint,
      r ? (r.x2.toFixed(1) + ',' + r.y2.toFixed(1) + ' / ' + (r.hint ? r.hint.k : 'none')) : 'null');

    /* ---- T39 拖动墙体端点时同样吸附 ---- */
    resetScene([['brick', 500, 400, 700, 400], ['brick', 200, 300, 400, 300]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    var wall = S.project.obstacles[1];
    down(300, 300); up();                       /* 选中下面那条墙 */
    down(400, 300);                             /* 抓右端点 */
    var isEnd = S.drag && S.drag.type === 'move-ob-end';
    move(600, 396);
    up();
    ok('T39a 拖端点时也吸附到墙线', isEnd && near(wall.x2, 600, 0.8) && near(wall.y2, 400, 0.8),
      wall.x2.toFixed(1) + ',' + wall.y2.toFixed(1));
    ok('T39b 另一端不动', near(wall.x1, 200, 0.01) && near(wall.y1, 300, 0.01),
      wall.x1 + ',' + wall.y1);

    /* ---- T40 吸附强度 0 = 完全不吸 ---- */
    resetScene([['brick', 500, 400, 700, 600]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    setRange('snapRange', 0);
    r = probeSnap(300, 500, 596, 500);
    ok('T40 强度 0：交点也不吸', r && near(r.x2, 596, 0.8) && !r.hint,
      r ? (r.x2.toFixed(1) + ' / ' + (r.hint ? r.hint.k : 'none')) : 'null');

    /* ---- T41 强度调大 → 更远的交点也能吸 ---- */
    setRange('snapRange', 8);
    r = probeSnap(300, 500, 588, 500);          /* 距交点 12 px */
    ok('T41a 强度 8 px：12 px 外的交点不吸', r && near(r.x2, 588, 0.8), r ? r.x2.toFixed(1) : 'null');
    setRange('snapRange', 16);
    r = probeSnap(300, 500, 588, 500);
    ok('T41b 强度 16 px：同一个点能吸住', r && near(r.x2, 600, 0.8),
      r ? r.x2.toFixed(1) : 'null');
    setRange('snapRange', 8);

    /* ---- T42 关掉「墙线吸附」只吸端点 ---- */
    resetScene([['brick', 500, 400, 700, 600]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    document.querySelector('[data-aid="snapEdge"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('T42a 开关已关闭', S.aids.snapEdge === false);
    r = probeSnap(300, 500, 596, 500);
    ok('T42b 只吸端点时不再贴墙线', r && near(r.x2, 596, 0.8) && !r.hint,
      r ? (r.x2.toFixed(1) + ' / ' + (r.hint ? r.hint.k : 'none')) : 'null');
    document.querySelector('[data-aid="snapEdge"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('T42c 开关恢复', S.aids.snapEdge === true);

    /* ---- T43 吸附后墙体仍可正常编辑 ---- */
    resetScene([['brick', 500, 400, 700, 600]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    WS._ui.setTool('wall');
    down(300, 500); move(596, 500); up();       /* 真实画一条，端点被吸到 (600,500) */
    var made = S.project.obstacles[S.project.obstacles.length - 1];
    ok('T43a 新墙端点落在交点上', near(made.x2, 600, 0.8) && near(made.y2, 500, 0.8),
      made.x2.toFixed(1) + ',' + made.y2.toFixed(1));
    ok('T43b 新墙仍是独立可编辑线段', made.id && made.x1 === 300 && made.y1 === 500);
    WS._ui.setTool('select');                   /* 画完切回选择，才谈得上"点选/拖端点" */
    var cntBefore = S.project.obstacles.length;
    down(450, 500); up();
    ok('T43c 可以正常点选', S.selIds.length === 1 && S.selIds[0] === made.id &&
      S.project.obstacles.length === cntBefore,
      '选中 ' + S.selIds.length + ' / 墙数 ' + S.project.obstacles.length);
    down(600, 500);                             /* 抓端点 → 应命中端点手柄 */
    ok('T43d 端点手柄可再次拖动', S.drag && S.drag.type === 'move-ob-end', S.drag && S.drag.type);
    up();

    checkOrthoSnapCoexist();
    checkLayerHotkeys();
    checkV17Fixes();
    checkFloors();

    finish();
  }

  /* ============================================================
     吸附 × 正交 共存（v1.7 修复的核心问题）
     旧行为：只要吸住就无条件贴过去，直线修正被完全跳过 →
             画水平墙时一靠近别的墙，端点被拽到吸附点，墙就歪了。
     新行为：先判定正交轴，再**在约束内**吸附：
             交点用约束线求交，端点 / 垂足必须落在约束轴上。
     ============================================================ */
  function checkOrthoSnapCoexist() {
    var S = WS.state;
    var r;

    setRange('snapRange', 8);
    setRange('orthoRange', 16);

    /* ---- T44 水平画墙撞垂直墙：吸到交点，且严格保持水平 ---- */
    resetScene([['brick', 600, 300, 600, 700]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    r = probeSnap(200, 500, 596, 502);            /* 鼠标比水平线低 2 px */
    ok('T44a 端点被吸到垂直墙上', r && near(r.x2, 600, 0.8) && near(r.y2, 500, 0.8),
      r ? (r.x2.toFixed(1) + ',' + r.y2.toFixed(1)) : 'null');
    ok('T44b 吸附后仍然严格水平（y2 === y1）', r && r.y2 === r.y1,
      r ? (r.y1 + ' -> ' + r.y2) : 'null');
    ok('T44c 吸附类型仍是交点', r && r.hint && r.hint.k === 'cross', r && r.hint ? r.hint.k : 'none');

    /* ---- T45 垂直画墙撞水平墙：吸到交点，且严格保持垂直 ---- */
    resetScene([['brick', 300, 600, 700, 600]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    r = probeSnap(500, 200, 503, 596);            /* 鼠标比垂直线右偏 3 px */
    ok('T45a 端点被吸到水平墙上', r && near(r.x2, 500, 0.8) && near(r.y2, 600, 0.8),
      r ? (r.x2.toFixed(1) + ',' + r.y2.toFixed(1)) : 'null');
    ok('T45b 吸附后仍然严格垂直（x2 === x1）', r && r.x2 === r.x1,
      r ? (r.x1 + ' -> ' + r.x2) : 'null');

    /* ---- T46 Shift 强制正交：偏差大时依然锁定，且不会被吸附拽歪 ---- */
    resetScene([['brick', 600, 300, 600, 700]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    r = probeSnap(200, 500, 596, 620, { shiftKey: true });
    ok('T46 Shift 强制正交在偏差 17 度时依然锁定水平', r && near(r.y2, 500, 0.01),
      r ? String(r.y2) : 'null');

    /* ---- T47 非正交时吸附照旧（回归，别把老能力改没了）---- */
    resetScene([['brick', 500, 400, 700, 400]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    setRange('snapRange', 16);
    r = probeSnap(400, 300, 600, 412);            /* 偏差 0.56 -> 不修正 */
    ok('T47 非正交时垂足吸附照旧生效', r && near(r.x2, 600, 0.8) && near(r.y2, 400, 0.8),
      r ? (r.x2.toFixed(1) + ',' + r.y2.toFixed(1)) : 'null');
    setRange('snapRange', 8);

    /* ---- T48 吸附终点与墙的距离为 0（真贴合，不是近似）---- */
    resetScene([['brick', 600, 300, 600, 700]], []);
    WS._ui.setMode('plan');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;
    r = probeSnap(200, 500, 597, 501);
    ok('T48 吸附终点精确落在墙体上', r && Math.abs(r.x2 - 600) < 1e-9,
      r ? ('x2=' + r.x2) : 'null');
  }

  /* ============================================================
     图层快捷键 Alt+1~6
     ============================================================ */
  function checkLayerHotkeys() {
    var S = WS.state;
    var keys = ['heat', 'obs', 'ap', 'grid', 'beam', 'overlap'];
    var names = ['热力图', '障碍物', '无线设备', '米制网格', '天线方向图', '信号重叠'];

    function press(n, extra) {
      var o = { key: String(n), code: 'Digit' + n, altKey: true, bubbles: true, cancelable: true };
      if (extra) for (var kk in extra) o[kk] = extra[kk];
      window.dispatchEvent(new KeyboardEvent('keydown', o));
    }

    keys.forEach(function (k) { S.layers[k] = true; });
    S.showHeat = true;
    WS._ui.syncLayerUI();

    /* T49 逐个验证：按一次关、再按一次开 */
    for (var i = 0; i < 6; i++) {
      var k1 = keys[i];
      press(i + 1);
      var off = (S.layers[k1] === false);
      press(i + 1);
      var on = (S.layers[k1] === true);
      ok('T49' + String.fromCharCode(97 + i) + ' Alt+' + (i + 1) + ' 切换「' + names[i] + '」',
        off && on, 'off=' + off + ' on=' + on);
    }

    /* T50 与系统快捷键不冲突 */
    var snap = keys.map(function (k) { return S.layers[k]; }).join(',');
    ['c', 'v', 'a'].forEach(function (ch) {
      window.dispatchEvent(new KeyboardEvent('keydown',
        { key: ch, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    ok('T50 Ctrl+C / V / A 不会误触图层开关',
      keys.map(function (k) { return S.layers[k]; }).join(',') === snap);

    /* T51 文本输入框内不拦截（不与输入法 Alt+数字选词打架） */
    var inp = document.createElement('input');
    inp.type = 'text';
    document.body.appendChild(inp);
    inp.focus();
    var heatB = S.layers.heat;
    inp.dispatchEvent(new KeyboardEvent('keydown',
      { key: '1', altKey: true, bubbles: true, cancelable: true }));
    ok('T51 文本输入框内 Alt+1 不触发图层切换', S.layers.heat === heatB);
    if (inp.parentNode) inp.parentNode.removeChild(inp);

    /* T52 界面标注与实现顺序一致 */
    var kbds = Array.prototype.map.call(
      document.querySelectorAll('.layer-row kbd.lhk'),
      function (e2) { return e2.textContent.trim(); });
    ok('T52 六个图层都标了快捷键且顺序正确',
      kbds.join(',') === 'Alt+1,Alt+2,Alt+3,Alt+4,Alt+5,Alt+6', kbds.join(','));

    /* T53 设备编辑模式下同样可用（图层与模式无关） */
    WS._ui.setMode('device');
    var obsB = S.layers.obs;
    press(2);
    ok('T53 设备编辑模式下 Alt+2 仍可切障碍物', S.layers.obs === !obsB,
      'before=' + obsB + ' after=' + S.layers.obs);
    press(2);
    WS._ui.setMode('plan');
    keys.forEach(function (k) { S.layers[k] = true; });
    WS._ui.syncLayerUI();
  }

  /* ============================================================
     v1.7 收尾修复的回归断言
     ============================================================ */
  function checkV17Fixes() {
    var S = WS.state;

    /* ---- V1 撤销基线：打开项目后，第一次操作就能撤销 ---- */
    resetScene([], []);
    WS._ui.setMode('plan');
    var n0 = S.project.obstacles.length;
    WS._ui.setTool('wall');
    down(100, 100); move(400, 100); up();
    ok('V1a 已画出第一段墙', S.project.obstacles.length === n0 + 1, String(S.project.obstacles.length));
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    ok('V1b 首次操作就能撤销（修复前 pos<=0 直接返回）',
      S.project.obstacles.length === n0, String(S.project.obstacles.length));

    /* ---- V2 松开右键不结束绘制 ---- */
    resetScene([['brick', 200, 900, 600, 900]], []);
    WS._ui.setMode('plan');
    WS._ui.setTool('wall');
    down(200, 600);
    move(400, 600);
    var hadDrawing = !!S.drawing;
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
    ok('V2 拖到一半松右键不会结束当前绘制', hadDrawing && !!S.drawing);
    up();
    ok('V2b 松开左键才真正结束', S.drawing === null);

    /* ---- V3 平面模式点到 AP：按空白处理，不选中不可见对象 ---- */
    resetScene([], [['ceiling', 300, 300, 'AP-X']]);
    WS._ui.setMode('plan');
    down(300, 300);
    ok('V3 平面模式点到 AP 不选中（改为平移画布）',
      S.drag && S.drag.type === 'pan' && S.selIds.length === 0,
      (S.drag && S.drag.type) + ' / sel=' + S.selIds.length);
    up();

    /* ---- V4 多选后轻点（未超过 3 px）不产生位移 ---- */
    resetScene([['brick', 200, 400, 600, 400], ['brick', 200, 500, 600, 500]], []);
    WS._ui.setMode('plan');
    WS._ui.setSelection('ob', S.project.obstacles.map(function (o) { return o.id; }));
    var y0 = S.project.obstacles[0].y1;
    down(400, 400); move(400.6, 400.6); up();
    ok('V4 多选轻点不产生位移', Math.abs(S.project.obstacles[0].y1 - y0) < 1e-9,
      y0 + ' -> ' + S.project.obstacles[0].y1);

    /* ---- V5 前后比：定向 AP 正后方应比正前方低约 fb（20 dB）----
       修复前把 dB 当幅度比算（/20），背面只低 10 dB */
    var pj = WS.newProject();
    pj.imgW = 800; pj.imgH = 800; pj.mpp = 0.05; pj.calibrated = true;
    pj.obstacles = [];
    var apw = WS.makeAp('wall', 400, 400, 1);
    apw.band = null; apw.channel = null; apw.bw = null;
    pj.aps = [apw];
    /* 壁挂 AP 默认 azimuth=90°（朝 +x），所以前后取 x 轴两侧 */
    var dPx = 100;                       /* 5 m，前后等距，垂直面衰减相同 */
    var rf = WS.rssiAt(pj, 400 + dPx, 400).rssi;
    var rb = WS.rssiAt(pj, 400 - dPx, 400).rssi;
    ok('V5 定向 AP 背面比正面低约 20 dB（前后比按功率比换算）',
      Math.abs((rf - rb) - 20) < 1.5,
      'front=' + rf.toFixed(1) + ' back=' + rb.toFixed(1) + ' Δ=' + (rf - rb).toFixed(1));

    /* ---- V6 老墙没有任何衰减字段 → 交给厚度自动算 ---- */
    var legacyBare = { id: 'lb', type: 'brick', x1: 0, y1: 0, x2: 10, y2: 0, thick: 0.24 };
    WS.normalizeObstacle(legacyBare);
    ok('V6 无衰减字段的老墙判为自动（修复前会被厚度误判成手动）',
      legacyBare.autoAtten === true && Math.abs(legacyBare.atten24 - 7.9) < 0.2,
      'auto=' + legacyBare.autoAtten + ' atten24=' + legacyBare.atten24);

    /* ---- V7 粗墙在放大后仍能点中（命中容差单位修复）---- */
    resetScene([], []);
    var thickWall = WS.makeObstacle('concrete', 300, 300, 700, 300);
    thickWall.thick = 0.4; thickWall.autoAtten = false;
    S.project.obstacles.push(thickWall);
    S.view.s = 4; S.view.ox = 0; S.view.oy = 0;
    WS._ui.setTool('select');
    var hitW = WS.hitTest(500, 300 + 0.18 / S.project.mpp);
    ok('V7 粗墙边缘（半厚度内）在放大 4 倍时仍可命中',
      !!hitW && hitW.id === thickWall.id, hitW ? hitW.kind : 'none');
    S.view.s = 1; S.view.ox = 0; S.view.oy = 0;

    /* ---- V8 端点拖到与另一端重合：整段删除，而不是留一个选不中的残留 ---- */
    resetScene([['brick', 200, 400, 600, 400]], []);
    WS._ui.setMode('plan');
    WS._ui.setTool('select');
    down(400, 400); up();                    /* 选中这堵墙，端点手柄才出现 */
    down(600, 400);                          /* 抓右端点 */
    move(201, 400);                          /* 拖到左端点旁边（长度 1 px）*/
    up();
    ok('V8 端点拖到几乎重合 → 墙段被删除', S.project.obstacles.length === 0,
      String(S.project.obstacles.length) + ' 段');
    window.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    ok('V8b 删除可撤销，墙段能回来', S.project.obstacles.length === 1,
      String(S.project.obstacles.length) + ' 段');

    /* ---- V9 打开含退化墙段的老项目：加载时清理 ---- */
    var raw = JSON.stringify({
      format: 'wireless-survey', version: 1, project: {
        name: '退化墙测试', imgW: 200, imgH: 200, mpp: 0.05, calibrated: true,
        obstacles: [
          { id: 'z1', type: 'brick', x1: 50, y1: 50, x2: 50, y2: 50, thick: 0.12 },
          { id: 'z2', type: 'brick', x1: 10, y1: 10, x2: 60, y2: 10, thick: 0.12 }
        ],
        aps: [], settings: {}
      }
    });
    var pj = WS.activeFloor(WS.deserialize(raw));      /* v2：deserialize 返回文档，取活动楼层 */
    ok('V9 加载时自动清理零长度墙段',
      pj.obstacles.length === 1 && pj.obstacles[0].id === 'z2',
      pj.obstacles.length + ' 段');

    /* ---- V10 热力图不可见时，放置 AP 不触发计算（卡顿根因）---- */
    resetScene([], [['ceiling', 300, 300, 'AP-A']]);
    WS._ui.setMode('device');
    S.layers.heat = false; S.showHeat = false;
    WS._ui.syncLayerUI();
    heatCalls = 0;
    WS._ui.setTool('ap-ceiling');
    down(500, 420); up();
    ok('V10 热力图关闭时放置 AP 不重算（旧行为每次 2~7 s）',
      heatCalls === 0, '实测 ' + heatCalls + ' 次');
    ok('V10b 已标记为待更新', S.heatDirty === true, String(S.heatDirty));
    ok('V10c AP 确实放下了', S.project.aps.length === 2, S.project.aps.length + ' 台');

    /* ---- V11 打开热力图时自动补算一次 ---- */
    heatCalls = 0;
    var cbHeat = document.getElementById('layHeat');
    cbHeat.checked = true;
    cbHeat.dispatchEvent(new Event('change', { bubbles: true }));
    ok('V11 打开热力图后自动补算', heatCalls >= 1 && S.heatDirty === false,
      '算 ' + heatCalls + ' 次 / dirty=' + S.heatDirty);

    /* ---- V12 打开非项目 JSON：必须报错，而不是静默给一个空项目 ---- */
    var threw = false;
    try { WS.deserialize(JSON.stringify({ hello: 'world', items: [1, 2, 3] })); }
    catch (e1) { threw = true; }
    ok('V12 非项目 JSON 被拒绝并提示', threw);

    /* ---- V12b 正常项目文件仍能打开 ---- */
    var goodPj = null;
    try {
      goodPj = WS.deserialize(JSON.stringify({
        format: 'wireless-survey', version: 1,
        project: { name: 'ok', imgW: 200, imgH: 200, mpp: 0.05, obstacles: [], aps: [], settings: {} }
      }));
    } catch (e2) { goodPj = null; }
    var goodFloor = goodPj ? WS.activeFloor(goodPj) : null;
    ok('V12b 正常项目仍可打开', !!goodFloor && goodFloor.imgW === 200,
      goodFloor ? String(goodFloor.imgW) : 'null');
  }

  /* ============================================================
     楼层：项目 → 楼宇 → 楼层
     ============================================================ */
  function checkFloors() {
    var S = WS.state;

    /* ---- F1 新文档：1 栋 1 层，活动楼层已挂到 S.project ---- */
    WS._ui.applyDoc(WS.newDoc('楼层测试'));
    ok('F1 新文档为 1 栋 1 层',
      S.doc.buildings.length === 1 && S.doc.buildings[0].floors.length === 1,
      S.doc.buildings.length + ' 栋 / ' + S.doc.buildings[0].floors.length + ' 层');
    ok('F1b 活动楼层即 S.project',
      !!S.project && S.project.id === S.doc.activeFloor,
      (S.project && S.project.id) + ' vs ' + S.doc.activeFloor);

    var b1 = S.doc.buildings[0];
    var f1 = S.project;

    /* ---- F2 在 1F 放内容 ---- */
    WS._ui.setMode('plan');
    WS._ui.setTool('wall');
    down(200, 200); move(600, 200); up();
    WS._ui.setMode('device');
    WS._ui.setTool('ap-ceiling');
    down(400, 400); up();
    ok('F2 1F 有 1 段墙 + 1 台 AP',
      f1.obstacles.length === 1 && f1.aps.length === 1,
      f1.obstacles.length + ' 墙 / ' + f1.aps.length + ' AP');

    /* ---- F3 新增楼层是空的（不继承几何，但继承射频环境）---- */
    f1.settings.band = '5'; f1.settings.channel = 36; f1.settings.bw = 80;
    f1.settings.freq = WS.chMhz('5', 36);
    var f2 = WS.addFloor(S.doc, b1.id);
    ok('F3c 新楼层继承当前楼层的射频设置（不会退回 2.4G 默认）',
      f2.settings.band === '5' && f2.settings.channel === 36 && f2.settings.bw === 80,
      f2.settings.band + ' / Ch.' + f2.settings.channel + ' / ' + f2.settings.bw + 'MHz');
    WS._ui.switchFloor(b1.id, f2.id);
    ok('F3 切到 2F 后画布为空',
      S.project.id === f2.id && S.project.obstacles.length === 0 && S.project.aps.length === 0,
      S.project.obstacles.length + ' 墙 / ' + S.project.aps.length + ' AP');
    ok('F3b 2F 编号与层号自动接续', f2.name === '2F' && f2.level === 2,
      f2.name + ' / L' + f2.level);

    /* ---- F4 2F 的内容独立 ---- */
    WS._ui.setMode('plan');
    WS._ui.setTool('wall');
    down(300, 300); move(300, 700); up();
    ok('F4 2F 也有 1 段墙', S.project.obstacles.length === 1, String(S.project.obstacles.length));

    /* ---- F5 切回 1F：内容完整且互不污染 ---- */
    WS._ui.switchFloor(b1.id, f1.id);
    ok('F5 切回 1F 内容完整',
      S.project.id === f1.id && S.project.obstacles.length === 1 && S.project.aps.length === 1,
      S.project.obstacles.length + ' 墙 / ' + S.project.aps.length + ' AP');
    ok('F5b 两层几何互不串台',
      f1.obstacles[0].x1 !== f2.obstacles[0].x1,
      '1F x=' + f1.obstacles[0].x1 + ' / 2F x=' + f2.obstacles[0].x1);

    /* ---- F6 新增楼宇（自带一层）---- */
    var nb = WS.addBuilding(S.doc, 'B 栋');
    ok('F6 新增楼宇自带一层',
      S.doc.buildings.length === 2 && nb.floors.length === 1 && nb.name === 'B 栋',
      S.doc.buildings.length + ' 栋 / ' + nb.floors.length + ' 层');
    WS._ui.switchFloor(nb.id, nb.floors[0].id);
    ok('F6b 新楼宇的楼层为空', S.project.obstacles.length === 0, String(S.project.obstacles.length));

    /* ---- F7 删除规则 ---- */
    ok('F7 可以删除楼层', WS.removeFloor(S.doc, f2.id) === true);
    ok('F7b 每栋最后一层不能删',
      WS.removeFloor(S.doc, S.doc.buildings[0].floors[0].id) === false);
    ok('F7c 删完后 A 栋只剩 1 层',
      S.doc.buildings[0].floors.length === 1, String(S.doc.buildings[0].floors.length));

    /* ---- F8 序列化往返（多楼宇/多楼层结构保持）---- */
    WS._ui.switchFloor(b1.id, f1.id);
    var doc2 = WS.deserialize(WS.serialize(S.doc));
    ok('F8 往返后仍为 2 栋 2 层',
      doc2.buildings.length === 2 && WS.floorOptions(doc2).length === 2,
      doc2.buildings.length + ' 栋 / ' + WS.floorOptions(doc2).length + ' 层');
    ok('F8b 往返后 1F 的墙与 AP 都在',
      WS.activeFloor(doc2).obstacles.length === 1 && WS.activeFloor(doc2).aps.length === 1,
      WS.activeFloor(doc2).obstacles.length + ' 墙 / ' + WS.activeFloor(doc2).aps.length + ' AP');

    /* ---- F9 v1 平铺项目迁移 ---- */
    var v1 = JSON.stringify({
      format: 'wireless-survey', version: 1,
      project: {
        name: '老项目', imgW: 800, imgH: 600, mpp: 0.05, calibrated: true,
        obstacles: [{ id: 'w1', type: 'brick', x1: 0, y1: 0, x2: 100, y2: 0, thick: 0.12 }],
        aps: [], settings: { freq: 2437 }
      }
    });
    var md = WS.deserialize(v1);
    ok('F9 老项目迁移为 1 栋 1 层',
      md.buildings.length === 1 && md.buildings[0].floors.length === 1,
      md.buildings.length + ' 栋 / ' + md.buildings[0].floors.length + ' 层');
    ok('F9b 项目名提升到文档级，楼层名补 1F',
      md.name === '老项目' && md.buildings[0].floors[0].name === '1F',
      md.name + ' / ' + md.buildings[0].floors[0].name);
    ok('F9c 迁移后几何完整', WS.activeFloor(md).obstacles.length === 1,
      String(WS.activeFloor(md).obstacles.length));
    ok('F9d 活动指针指向唯一那一层',
      md.activeFloor === md.buildings[0].floors[0].id && md.activeBuilding === md.buildings[0].id);
  }

  function finish() {
    /* 收尾：确保没有残留拖动 */
    WS.state.drag = null;
    var text = '\n' + lines.join('\n') + '\n----\nSUM: ' + pass + ' pass, ' + fail + ' fail';
    var d = document.createElement('div');
    d.id = 'E2E_RESULT';
    d.style.display = 'none';
    d.textContent = text;
    document.body.appendChild(d);
    document.title = fail === 0 ? 'ALLPASS' : ('FAILED-' + fail);

    /* 本机 Chrome 的 stdout 被环境吞掉，改用 HTTP 回传给 node 侧 */
    if (window.__E2E_REPORT_URL) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', window.__E2E_REPORT_URL, true);
        xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
        xhr.send(text);
      } catch (e) { /* 忽略 */ }
    }
  }

  function start() {
    if (!window.WS || !WS._ui || !document.getElementById('cv')) {
      setTimeout(start, 60);
      return;
    }
    try {
      run();
      /* 边缘滚屏需要等若干帧，run() 里把断言放进 pendingEdgeCheck */
      setTimeout(function () {
        if (pendingEdgeCheck) pendingEdgeCheck();
        else finish();
      }, 420);
    } catch (err) {
      fail++;
      lines.push('FAIL | 脚本异常 | ' + (err && err.message ? err.message : err));
      finish();
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 120);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 120); });
  }
})();
