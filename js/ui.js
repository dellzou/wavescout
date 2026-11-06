/* ============================================================
   ui.js — 交互 · 工具 · 属性面板 · 项目管理

   作者：邹宁（2004-04-17，广东广州）
   著作权：本软件由邹宁个人独立开发，著作权归作者所有。
   © 2026 邹宁 版权所有  All Rights Reserved.
   ============================================================ */
(function (WS) {
  'use strict';

  var S = WS.state;
  var $ = function (s) { return document.querySelector(s); };
  var el = {};
  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;

  var heatTimer = null;
  var heatFinalTimer = null;
  var autosaveTimer = null;
  var tipTimer = null;
  var spaceDown = false;
  var shiftDown = false;      /* 边缘滚屏重算终点时也要知道 Shift 状态 */
  var downButton = 0;         /* 本次按下的鼠标键，避免松右键/中键误结束操作 */
  var MIN_WALL_PX = 4;        /* 墙段最短长度（屏幕像素）：低于此值视为「被拖没了」 */
  var autoSaveWarned = false;

  /* ============================================================
     选择集：单选 / 多选（框选）共用一套状态
     · S.sel     —— 主对象，供属性面板、朝向手柄等单选逻辑使用
     · S.selIds  —— 全部选中 id（含主对象）
     · S.selKind —— 选择集的类型，模型层保证「一次只选一种类型」
     ============================================================ */
  function setSelection(kind, ids) {
    ids = (ids || []).slice();
    S.selIds = ids;
    S.selKind = ids.length ? kind : null;
    S.sel = ids.length ? { kind: kind, id: ids[0] } : null;
  }

  function clearSelection() { setSelection(null, []); }

  function isSelected(kind, id) {
    return S.selKind === kind && S.selIds.indexOf(id) >= 0;
  }

  /* 取出选择集对应的对象（类型不符时返回空数组，绝不跨类型返回） */
  function selectedObjects(kind) {
    if (S.selKind !== kind || !S.selIds.length) return [];
    var out = [];
    for (var i = 0; i < S.selIds.length; i++) {
      var o = kind === 'ap' ? WS.findAp(S.selIds[i]) : WS.findOb(S.selIds[i]);
      if (o) out.push(o);
    }
    return out;
  }

  /* 当前模式允许框选的类型 —— 平面编辑只框墙体，设备编辑只框 AP */
  function scopeOfMode(m) {
    var mode = m || S.mode;
    return mode === 'plan'
      ? { kind: 'ob', label: '墙体', unit: '段', modeName: '平面编辑' }
      : { kind: 'ap', label: 'AP', unit: '台', modeName: '设备编辑' };
  }

  /* 当前频段对应的覆盖判定门限 */
  function curMinRssi() {
    return WS.minRssiOf(S.project.settings);
  }

  /* ============================================================
     启动
     ============================================================ */
  function init() {
    cacheEl();
    buildRfOptions();
    buildLegend();
    bindTopbar();
    bindTools();
    bindAids();
    bindCanvas();
    bindInspector();
    bindFormInputs();
    bindDrop();
    bindDesktop();
    bindFloor();

    WS.initCanvas(el.cv);
    restoreAutosave();
    /* 自动恢复失败或首次启动时，兜一个空文档，避免后面 S.project 为 null */
    if (!S.doc) S.doc = WS.wrapDoc(S.project);
    syncInputs();
    setMode('plan');
    setTool('select');
    renderInspector();
    updateStatus();

    if (!S.project.image && !S.project._blank) {
      el.emptyState.hidden = false;
      el.hud.hidden = true;
      el.legend.hidden = true;
    } else {
      el.emptyState.hidden = true;
      WS.fitView();
      rebuildHeat();
    }

    setTimeout(function(){ WS.fitView(); }, 60);
  }

  function cacheEl() {
    ['cv','stage','emptyState','btnEmptyPick','btnEmptyBlank','btnEmptyDemo','hud','hudXY','hudRssi','hudDist',
     'legend','legendItems','tipBar','inspTitle','inspBadge','inspBody','stProject','stHint',
     'stObjCount','stRf','stScale','stZoom','fileImage','fileProject','modalMask','modal','modalTitle',
     'modalBody','modalX','modalFoot','toolsPlan','toolsDevice','sectPlan','sectDevice',
     'modeSwitch','heatToggle','zOut','zVal','zIn','zFit','themeBtn','btnNew','btnOpen','btnSave',
     'btnImport','btnExport','btnHelp','btnPickImage','calWidth','btnCalWidth','btnCalTwo','calHint',
     'scaleVal','scaleRef','selBand','selChannel','selBw','segRegion','regionHint','rfHint','hCeil','hRx','thresh','threshVal','threshLabel','stApCount','stCover',
     'stGood','stWeak','bandStats','layHeat','layObs','layAp','layGrid','layBeam','plN','plNVal',
     'modeTip','aidsBar','aidSliders','snapRange','orthoRange','snapVal','orthoVal','selHint','verBadge','stCopyright',
     'layOverlap','ovThr','ovThrVal','ovStat',
     'selBuilding','selFloor','btnAddFloor','btnAddBuilding','btnRenameFloor','btnDelFloor','stFloor'
   ].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
  }

  /* ============================================================
     顶栏
     ============================================================ */
  function bindTopbar() {
    el.btnNew.onclick = function () {
      dialog({
        title: '新建地勘项目',
        body: '<p>当前项目<strong style="color:var(--txt)">尚未保存</strong>，新建后未保存的内容将会丢失。</p><p style="color:var(--txt-3);font-size:11.5px">建议先点击「保存」导出项目文件。</p>',
        buttons: [
          { label: '返回', cls: 'btn-s', value: false },
          { label: '保存并新建', cls: 'btn-s', value: 'save' },
          { label: '直接新建', cls: 'btn-p', value: true }
        ]
      }).then(function (r) {
        if (!r) return;
        if (r === 'save') saveProject();
        applyDoc(WS.newDoc());
        setMode('plan');
        setTool('select');
        tip('已新建项目');
      });
    };

    el.btnOpen.onclick = function () { el.fileProject.click(); };
    el.fileProject.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) readProjectFile(f);
      e.target.value = '';
    };

    el.btnSave.onclick = saveProject;
    el.btnImport.onclick = function () { el.fileImage.click(); };
    el.btnPickImage.onclick = function () { el.fileImage.click(); };
    el.btnEmptyPick.onclick = function () { el.fileImage.click(); };
    el.btnEmptyBlank.onclick = function () {
      S.project._blank = true;
      el.emptyState.hidden = true;
      el.hud.hidden = false;
      el.legend.hidden = false;
      WS.fitView();
      rebuildHeat();
      updateStatus();
      tip('已启用空白画布，可先标定比例尺再绘制墙体');
    };
    el.btnEmptyDemo.onclick = loadDemo;

    el.fileImage.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) loadImageFile(f);
      e.target.value = '';
    };

    el.btnExport.onclick = exportMenu;
    el.btnHelp.onclick = showHelp;

    /* 作者签名入口：点版本号或状态栏版权即弹出「关于」 */
    if (el.verBadge) {
      el.verBadge.style.cursor = 'pointer';
      el.verBadge.onclick = showAbout;
    }
    if (el.stCopyright) {
      el.stCopyright.style.cursor = 'pointer';
      el.stCopyright.onclick = showAbout;
    }

    el.btnCalWidth.onclick = function () {
      var m = parseFloat(el.calWidth.value);
      if (!isFinite(m) || m <= 0) return tip('请先输入图片的实际宽度（米）');
      var p = S.project;
      p.mpp = m / p.imgW;
      p.calibrated = true;
      p.scaleRef = { mode: 'width', meters: m };
      syncScaleUI();
      rebuildHeat();
      pushHistory();
      tip('已按图幅宽度标定：整幅 ' + m + ' m');
    };

    el.btnCalTwo.onclick = startCalibration;

    el.zIn.onclick = function () { WS.zoomAt(1.2, WS.viewSize().w / 2, WS.viewSize().h / 2); updateZoomLabel(); };
    el.zOut.onclick = function () { WS.zoomAt(1 / 1.2, WS.viewSize().w / 2, WS.viewSize().h / 2); updateZoomLabel(); };
    el.zFit.onclick = function () { WS.fitView(); updateZoomLabel(); };

    el.themeBtn.onclick = function () {
      S.theme = S.theme === 'dark' ? 'light' : 'dark';
      document.body.classList.toggle('light', S.theme === 'light');
      WS.requestDraw();
      updateStats();
    };

    el.heatToggle.onchange = function () {
      S.showHeat = el.heatToggle.checked;
      S.layers.heat = el.heatToggle.checked;
      el.layHeat.checked = el.heatToggle.checked;
      if (S.layers.heat && S.showHeat && S.heatDirty) rebuildHeat();
      WS.requestDraw();
    };

    el.modeSwitch.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      setMode(b.dataset.mode);
    });

    el.modalX.onclick = function () { closeModal(null); };
    el.modalMask.addEventListener('mousedown', function (e) {
      if (e.target === el.modalMask) closeModal(null);
    });
  }

  /* ============================================================
     模式 / 工具
     ============================================================ */
  function setMode(m) {
    var prevMode = S.mode;
    /* 只有「设备 → 平面」这一刻才记录用户想看什么 */
    if (m === 'plan' && prevMode !== 'plan') captureLayerPref();
    S.mode = m;
    Array.prototype.forEach.call(el.modeSwitch.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.mode === m);
    });
    el.toolsPlan.hidden = m !== 'plan';
    el.toolsDevice.hidden = m !== 'device';
    el.aidsBar.hidden = m !== 'plan';
    if (el.aidSliders) el.aidSliders.hidden = m !== 'plan';
    el.sectPlan.hidden = m !== 'plan';
    el.sectDevice.hidden = m !== 'device';

    clearSelection();
    S.drawing = null;
    S.calib = null;
    S.marquee = null;
    applyModeLayers(m);
    setTool('select');
    updateSelHint();
    updateModeTip();
    renderInspector();
    updateStatus();
    WS.requestDraw();

    if (m === 'device') {
      el.legend.hidden = false;
      if (!S.heat || S.heatDirty) rebuildHeat();
      if (S.layers.overlap && !S.overlapPolys) rebuildOverlap();
    }
  }

  /* ============================================================
     图层跟随编辑模式
       平面编辑：关掉热力图 / 天线方向图 / 无线设备 / 信号重叠（专心画墙）
       设备编辑：只打开「无线设备」，其余保持用户当前状态
     ============================================================ */
  /* 记录「设备编辑下想看什么」：平面编辑会强制关掉这几项，
     所以必须在切过去之前记，而不是切回来时读当前值（那时已是关的） */
  function captureLayerPref() {
    S.layerPref = {
      heat: !!(S.layers.heat && S.showHeat),
      beam: !!S.layers.beam,
      overlap: !!S.layers.overlap
    };
  }

  function applyModeLayers(m) {
    if (m === 'plan') {
      /* 注意：这里**不**记录偏好。此刻图层往往已经被上一次进入平面模式关掉了，
         再记就会把"关"当成用户偏好，来回切一次热力图就永久没了。
         记录的时机在 setMode 里（真正从设备切过来的那一刻）。 */
      S.layers.heat = false;
      S.showHeat = false;
      S.layers.beam = false;
      S.layers.ap = false;
      S.layers.overlap = false;
      S.overlapPolys = null;
    } else {
      var pf = S.layerPref || { heat: true, beam: false, overlap: false };
      S.layers.heat = pf.heat;
      S.showHeat = pf.heat;
      S.layers.beam = pf.beam;
      S.layers.overlap = pf.overlap;
      S.layers.ap = true;
      if (!S.layers.overlap) S.overlapPolys = null;
    }
    syncLayerUI();
    updateOverlapStat();
  }

  /* 把状态写回所有图层复选框（顶栏热力图开关也同步） */
  function syncLayerUI() {
    if (el.layHeat) el.layHeat.checked = !!(S.layers.heat && S.showHeat);
    if (el.heatToggle) el.heatToggle.checked = !!S.showHeat;
    if (el.layObs) el.layObs.checked = !!S.layers.obs;
    if (el.layAp) el.layAp.checked = !!S.layers.ap;
    if (el.layGrid) el.layGrid.checked = !!S.layers.grid;
    if (el.layBeam) el.layBeam.checked = !!S.layers.beam;
    if (el.layOverlap) el.layOverlap.checked = !!S.layers.overlap;
  }

  /* 图层快捷键：Alt + 1~6，顺序与左侧「图层」列表一致。
     选 Alt 系而非 Ctrl 系：Ctrl+C/V/X/A/S/Z/Y/O/F/P 都被系统占用，
     Ctrl+Shift+A 已用于吸顶 AP，Tab/Esc/Delete/Space 也已分配。 */
  var LAYER_KEYS = ['heat', 'obs', 'ap', 'grid', 'beam', 'overlap'];
  var LAYER_NAMES = {
    heat: '热力图', obs: '障碍物', ap: '无线设备',
    grid: '米制网格', beam: '天线方向图', overlap: '信号重叠'
  };

  /* 图层开关：统一走复选框的 onchange，保证快捷键与鼠标点击行为完全一致
     （热力图还牵扯 showHeat、重叠层要触发重算，不能各写一份逻辑） */
  function toggleLayer(k) {
    var box = {
      heat: el.layHeat, obs: el.layObs, ap: el.layAp,
      grid: el.layGrid, beam: el.layBeam, overlap: el.layOverlap
    }[k];
    if (!box) return;
    box.checked = !box.checked;
    if (box.onchange) box.onchange();
    syncLayerUI();
    tip(LAYER_NAMES[k] + (box.checked ? ' 已开启' : ' 已关闭') +
        '（Alt+' + (LAYER_KEYS.indexOf(k) + 1) + '）', 1800);
  }

  /* 左上角的模式说明，给新手一句「这一步该干什么」 */
  function updateModeTip() {
    if (!el.modeTip) return;
    el.modeTip.textContent = S.mode === 'plan'
      ? '平面编辑 · 画墙 / 门 / 窗，Ctrl + 拖动可框选墙体'
      : '设备编辑 · 放 AP，勾选图层查看热力图与信号重叠';
  }

  /* 侧栏常驻提示：明确当前模式能框选什么 */
  function updateSelHint() {
    if (!el.selHint) return;
    var sc = scopeOfMode();
    var lb = sc.label === 'AP' ? ' AP ' : sc.label;   /* 中英混排留空格 */
    el.selHint.innerHTML = 'Ctrl + 拖动框选<b>' + lb + '</b> · 本模式仅' + lb + '可选';
  }

  function bindTools() {
    [el.toolsPlan, el.toolsDevice].forEach(function (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('.tool');
        if (!b) return;
        setTool(b.dataset.tool);
      });
    });
  }

  /* ============================================================
     平面编辑辅助开关（端点吸附 / 直线修正 / 边缘滚屏）
     ============================================================ */
  var AIDS_KEY = 'ws_aids_v1';

  function bindAids() {
    loadAids();

    el.aidsBar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-aid]');
      if (!b) return;
      var k = b.dataset.aid;
      S.aids[k] = !S.aids[k];
      syncAidsUI();
      saveAids();
      WS.requestDraw();
      tip(aidTipText(k, S.aids[k]));
    });

    /* 强度滑条：拖动即时生效（下一次画线立刻按新强度走） */
    if (el.snapRange) {
      el.snapRange.addEventListener('input', function () {
        S.aids.snapPx = parseInt(this.value, 10) || 0;
        if (S.aids.snapPx > 0) S.aids.snap = true;   /* 拖离 0 视为重新开启 */
        syncAidsUI();
        saveAids();
      });
      el.snapRange.addEventListener('change', function () {
        tip(S.aids.snapPx > 0
          ? '端点吸附强度 ' + S.aids.snapPx + ' px（0 ~ ' + WS.SNAP_MAX_PX + '）'
          : '端点吸附强度 0：完全不再吸附');
      });
    }

    if (el.orthoRange) {
      el.orthoRange.addEventListener('input', function () {
        S.aids.orthoRatio = (parseInt(this.value, 10) || 0) / 100;
        if (S.aids.orthoRatio > 0) S.aids.ortho = true;
        syncAidsUI();
        saveAids();
        WS.requestDraw();
      });
      el.orthoRange.addEventListener('change', function () {
        tip(S.aids.orthoRatio > 0
          ? '直线修正强度 ±' + ratioDeg(S.aids.orthoRatio) + '°（0 ~ ' + ratioDeg(WS.ORTHO_MAX) + '°）'
          : '直线修正强度 0：完全不再拉直（仍可按 Shift 强制正交）');
      });
    }

    syncAidsUI();
  }

  /* 阈值比例 → 角度文本（ratio = 短边/长边 = tan(偏角)） */
  function ratioDeg(r) {
    if (!(r > 0)) return '0.0';
    return (Math.atan(r) * 180 / Math.PI).toFixed(1);
  }

  function aidTipText(k, on) {
    if (k === 'snap') {
      return on ? ('吸附已开启（' + S.aids.snapPx + ' px 范围内吸端点 / 墙线）') : '吸附已关闭';
    }
    if (k === 'snapEdge') {
      return on ? '墙线吸附已开启：端点会贴到已有墙的交点或墙上' : '墙线吸附已关闭（只吸端点）';
    }
    if (k === 'ortho') {
      return on ? ('直线修正已开启：偏差 ' + ratioDeg(S.aids.orthoRatio) + '° 内自动拉直')
                : '直线修正已关闭（按住 Shift 仍可强制正交）';
    }
    return on ? '边缘滚屏已开启：画线拖到画布边缘会自动平移视图' : '边缘滚屏已关闭';
  }

  function syncAidsUI() {
    Array.prototype.forEach.call(el.aidsBar.querySelectorAll('[data-aid]'), function (b) {
      b.classList.toggle('on', !!S.aids[b.dataset.aid]);
    });

    /* 滑条位置 / 当前值 / 与开关联动（关掉开关时滑条变灰只读） */
    if (el.snapRange) el.snapRange.value = S.aids.snapPx;
    if (el.orthoRange) el.orthoRange.value = Math.round(S.aids.orthoRatio * 100);
    if (el.snapVal) el.snapVal.textContent = S.aids.snapPx + ' px';
    if (el.orthoVal) el.orthoVal.textContent = ratioDeg(S.aids.orthoRatio) + '°';

    if (el.aidSliders) {
      Array.prototype.forEach.call(el.aidSliders.querySelectorAll('.aid-slider'), function (row) {
        var k = row.dataset.slider;
        var off = !S.aids[k];
        row.classList.toggle('dim', off);
        var inp = row.querySelector('input');
        if (inp) inp.disabled = off;
      });
    }
  }

  function loadAids() {
    try {
      var raw = localStorage.getItem(AIDS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      ['snap', 'ortho', 'edgePan', 'snapEdge'].forEach(function (k) {
        if (typeof o[k] === 'boolean') S.aids[k] = o[k];
      });
      if (typeof o.snapPx === 'number' && o.snapPx >= 0) {
        S.aids.snapPx = WS.clamp(Math.round(o.snapPx), 0, WS.SNAP_MAX_PX);
      }
      if (typeof o.orthoRatio === 'number' && o.orthoRatio >= 0) {
        S.aids.orthoRatio = WS.clamp(o.orthoRatio, 0, WS.ORTHO_MAX);
      }
    } catch (e) { /* 忽略 */ }
  }

  function saveAids() {
    try { localStorage.setItem(AIDS_KEY, JSON.stringify(S.aids)); } catch (e) { /* 忽略 */ }
  }

  /* 清掉吸附的临时状态（候选方框 / 已吸住标记 / 光标世界坐标） */
  function clearSnapState() {
    S.snapHint = null;
    S.snapNear = [];
    S.cursorWorld = null;
  }

  function setTool(t) {
    S.tool = t;
    var box = S.mode === 'plan' ? el.toolsPlan : el.toolsDevice;
    Array.prototype.forEach.call(box.querySelectorAll('.tool'), function (b) {
      b.classList.toggle('on', b.dataset.tool === t);
    });
    S.drawing = null;
    stopAutoPan();
    clearSnapState();
    if (t !== 'select') S.calib = null;

    el.cv.style.cursor = cursorFor(t);

    WS.requestDraw();
    if (t === 'erase') tip('点击墙体或设备即可删除');
    else if (t === 'wall') tip('按住左键拖动画砖墙 · 直线修正 / 端点吸附 / 边缘滚屏已生效，按住 Shift 强制正交');
    else if (t === 'door') tip('按住左键拖动画木门 · 靠近端点会自动吸附');
    else if (t === 'window') tip('按住左键拖动画玻璃窗 · 靠近端点会自动吸附');
    else if (t === 'column') tip('按住左键拖动画混凝土墙 / 立柱 · 靠近端点会自动吸附');
    else if (t === 'select') tip('点选可拖动；墙体两端蓝点可调长度；Ctrl + 拖动框选' + scopeOfMode().label + '（Esc 取消）');
    else if (t.indexOf('ap-') === 0) tip('在平面图上点击放置设备，放置后可拖动朝向手柄调整');
  }

  /* ============================================================
     画布交互
     ============================================================ */
  function bindCanvas() {
    el.cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.cv.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    /* 全局禁用 Ctrl+滚轮 的页面缩放 —— 侧栏/顶栏上滚动也不该改变 UI 比例 */
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    el.cv.addEventListener('mouseleave', function () {
      el.hudXY.textContent = '—';
      el.hudRssi.textContent = '—';
      el.hudDist.textContent = '—';
    });

    el.cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = el.cv.getBoundingClientRect();
      var f = e.deltaY < 0 ? 1.13 : 1 / 1.13;
      WS.zoomAt(f, e.clientX - r.left, e.clientY - r.top);
      updateZoomLabel();
    }, { passive: false });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    /* 拖到一半切走窗口时 mouseup 可能丢失 —— 主动收尾，避免卡在「框选中 / 绘制中」状态 */
    window.addEventListener('blur', function () {
      var dirty = false;
      if (S.marquee) { S.marquee = null; dirty = true; }
      if (S.drawing) { S.drawing = null; stopAutoPan(); dirty = true; }
      var wasDrag = S.drag;
      if (S.drag) { S.drag = null; dirty = true; }
      if (S.heatStale) { S.heatStale = false; dirty = true; }
      shiftDown = false;
      clearSnapState();
      /* 对象已经被移动却不记历史，等于这段位移无法撤销 → 在这里补记一次 */
      if (wasDrag && (wasDrag.type === 'move-ap' || wasDrag.type === 'rotate-ap' ||
          wasDrag.type === 'move-ob' || wasDrag.type === 'move-ob-end' ||
          (wasDrag.type === 'move-multi' && wasDrag.moved))) {
        pushHistory();
        rebuildHeat();
      }
      if (dirty) {
        el.cv.style.cursor = cursorFor(S.tool);
        WS.requestDraw();
      }
    });
  }

  function pos(e) {
    var r = el.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    downButton = e.button;
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      var p0 = pos(e);
      S.drag = { type: 'pan', sx: p0.x, sy: p0.y, ox: S.view.ox, oy: S.view.oy };
      el.cv.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    var sc = pos(e);
    var w = WS.screenToWorld(sc.x, sc.y);
    S.lastScr = sc;

    /* ---- 比例标定 ---- */
    if (S.calib) { calibClick(w); return; }

    /* ---- Ctrl + 拖动 = 框选（按当前模式限制可选类型）---- */
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); startMarquee(w); return; }

    /* ---- 擦除 ---- */
    if (S.tool === 'erase') {
      var hit = WS.hitTest(w.x, w.y);
      if (hit) {
        /* hitTest 对已选中墙体的端点会返回 ob-end，这里必须归一化，否则点端点删不掉 */
        var hk = (hit.kind === 'ob-end') ? 'ob' : (hit.kind === 'ap-handle' ? 'ap' : hit.kind);
        var sc0 = scopeOfMode();
        if (hk !== sc0.kind) {
          tip(sc0.modeName + '模式只能删除' + sc0.label + '，已忽略点到的对象', 2200);
          return;
        }
        if (hk === 'ap') removeAp(hit.id);
        else removeOb(hit.id);
      }
      return;
    }

    /* ---- 放置 AP ---- */
    if (S.tool.indexOf('ap-') === 0) {
      placeAp(S.tool.slice(3), w);
      return;
    }

    /* ---- 绘制障碍物 ---- */
    if (S.tool === 'wall' || S.tool === 'door' || S.tool === 'window' || S.tool === 'column') {
      var a = snapPoint(w, null);
      S.drawing = { type: S.tool, ax: a.x, ay: a.y, x1: a.x, y1: a.y, x2: a.x, y2: a.y };
      S.snapHint = a.kind ? { x: a.x, y: a.y, kind: a.kind } : null;
      S.snapNear = nearSnapPoints(w);
      S.cursorWorld = { x: w.x, y: w.y };
      WS.requestDraw();
      startAutoPan();
      return;
    }

    /* ---- 选择 / 拖动 ---- */
    var h = WS.hitTest(w.x, w.y);
    /* 当前模式只接受本模式的对象类型：plan 下点到（已隐藏的）AP、device 下点到墙，
       一律按「点空白」处理，避免选中看不见的东西后误删 */
    if (h) {
      var hk0 = (h.kind === 'ob-end') ? 'ob' : (h.kind === 'ap-handle' ? 'ap' : h.kind);
      if (hk0 !== scopeOfMode().kind) h = null;
    }
    if (h) {
      if (h.kind === 'ap-handle') {
        S.drag = { type: 'rotate-ap', id: h.id };
        setSelection('ap', [h.id]);
        renderInspector();
        WS.requestDraw();
        return;
      }
      if (h.kind === 'ap') {
        var ap = WS.findAp(h.id);
        /* 点已经选中的一台（且是多选状态）→ 整组平移 */
        if (isSelected('ap', h.id) && S.selIds.length > 1) {
          S.drag = { type: 'move-multi', kind: 'ap', sx: w.x, sy: w.y, pressId: h.id, moved: false, items: groupSnapshot('ap') };
          renderInspector();
          WS.requestDraw();
          return;
        }
        setSelection('ap', [h.id]);
        S.drag = { type: 'move-ap', id: h.id, dx: ap.x - w.x, dy: ap.y - w.y };
        renderInspector();
        WS.requestDraw();
        return;
      }
      if (h.kind === 'ob-end') {
        var oe = WS.findOb(h.id);
        setSelection('ob', [h.id]);
        S.drag = {
          type: 'move-ob-end', id: h.id, end: h.end,
          ox1: oe.x1, oy1: oe.y1, ox2: oe.x2, oy2: oe.y2
        };
        el.cv.style.cursor = 'move';
        renderInspector();
        WS.requestDraw();
        return;
      }
      if (h.kind === 'ob') {
        var o = WS.findOb(h.id);
        /* 点已选中的一段（多选状态）→ 整组平移 */
        if (isSelected('ob', h.id) && S.selIds.length > 1) {
          S.drag = { type: 'move-multi', kind: 'ob', sx: w.x, sy: w.y, pressId: h.id, moved: false, items: groupSnapshot('ob') };
          renderInspector();
          WS.requestDraw();
          return;
        }
        setSelection('ob', [h.id]);
        S.drag = { type: 'move-ob', id: h.id, sx: w.x, sy: w.y, ox1: o.x1, oy1: o.y1, ox2: o.x2, oy2: o.y2 };
        renderInspector();
        WS.requestDraw();
        return;
      }
    }

    // 空白拖动 = 平移（并清空选择）
    if (S.selIds.length) clearSelection();
    renderInspector();
    WS.requestDraw();
    S.drag = { type: 'pan', sx: sc.x, sy: sc.y, ox: S.view.ox, oy: S.view.oy };
  }

  function onMove(e) {
    var sc = pos(e);
    var w = WS.screenToWorld(sc.x, sc.y);
    S.lastScr = sc;

    /* HUD */
    if (!el.hud.hidden) {
      el.hudXY.textContent = WS.round(w.x * (S.project.mpp || 0.05), 2) + ', ' +
                             WS.round(w.y * (S.project.mpp || 0.05), 2) + ' m';
      if (S.project.aps.length) {
        var r = WS.rssiAt(S.project, w.x, w.y);
        if (r.rssi > -199) {
          el.hudRssi.textContent = WS.round(r.rssi, 1) + ' dBm';
          var band = WS.bandColor(r.rssi, curMinRssi());
          el.hudRssi.style.color = band ? band.hex : 'var(--txt-3)';
        } else {
          el.hudRssi.textContent = '无覆盖';
          el.hudRssi.style.color = 'var(--txt-3)';
        }
        var near = nearestApDist(w);
        el.hudDist.textContent = near != null ? WS.round(near, 2) + ' m' : '—';
      } else {
        el.hudRssi.textContent = '—';
        el.hudRssi.style.color = '';
        el.hudDist.textContent = '—';
      }
    }

    /* 框选预览 */
    if (S.drag && S.drag.type === 'marquee') { updateMarquee(w); return; }

    /* 标定预览 */
    if (S.calib) { S.calib.cur = { x: w.x, y: w.y }; WS.requestDraw(); return; }

    /* 绘制预览 */
    if (S.drawing) {
      shiftDown = !!e.shiftKey;          /* 与键盘状态保持同步 */
      updateDrawingPoint(w, e.shiftKey);
      return;
    }

    /* 拖动 */
    var d = S.drag;
    if (!d) return;

    if (d.type === 'pan') {
      S.view.ox = d.ox + (sc.x - d.sx);
      S.view.oy = d.oy + (sc.y - d.sy);
      WS.requestDraw();
      return;
    }
    if (d.type === 'move-ap') {
      var ap = WS.findAp(d.id);
      if (ap) {
        ap.x = w.x + d.dx;
        ap.y = w.y + d.dy;
        markHeatStale();
        WS.requestDraw();
        updateStatus();
      }
      return;
    }
    if (d.type === 'rotate-ap') {
      var ap2 = WS.findAp(d.id);
      if (ap2) {
        var ang = Math.atan2(w.x - ap2.x, -(w.y - ap2.y)) / D2R;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        ang = ((ang % 360) + 360) % 360;
        ap2.azimuth = Math.round(ang);
        markHeatStale();
        WS.requestDraw();
        renderInspector();
      }
      return;
    }
    if (d.type === 'move-multi') {
      var gmx = w.x - d.sx, gmy = w.y - d.sy;
      if (e.shiftKey) {
        if (Math.abs(gmx) > Math.abs(gmy)) gmy = 0; else gmx = 0;
      }
      if (Math.hypot(gmx, gmy) * S.view.s > 3) d.moved = true;
      /* 轻点（未超过阈值）不产生位移：否则「点一下」会挪 0.1 m，而且 onUp 按未拖动提前返回，
         既不记历史也不重算热力图，画面与数据会脱节 */
      if (!d.moved) { WS.requestDraw(); return; }
      d.items.forEach(function (it) {
        if (d.kind === 'ap') {
          var ga = WS.findAp(it.id);
          if (ga) { ga.x = it.x + gmx; ga.y = it.y + gmy; }
        } else {
          var go = WS.findOb(it.id);
          if (go) {
            go.x1 = it.x1 + gmx; go.y1 = it.y1 + gmy;
            go.x2 = it.x2 + gmx; go.y2 = it.y2 + gmy;
          }
        }
      });
      markHeatStale();
      WS.requestDraw();
      return;
    }
    if (d.type === 'move-ob-end') {
      var oe = WS.findOb(d.id);
      if (oe) {
        var ax = (d.end === 1) ? oe.x2 : oe.x1;
        var ay = (d.end === 1) ? oe.y2 : oe.y1;
        /* 与画线同一套策略：先定正交轴，再在约束内吸附，最后才退纯正交 */
        var axis2 = orthoAxis(ax, ay, w.x, w.y, e.shiftKey);
        var tp = snapPoint(w, { x: ax, y: ay }, d.id, axis2);
        var np;
        if (tp.kind) np = { x: tp.x, y: tp.y };
        else if (axis2 === 'h') np = { x: w.x, y: ay };
        else if (axis2 === 'v') np = { x: ax, y: w.y };
        else np = { x: w.x, y: w.y };
        S.snapHint = tp.kind ? { x: tp.x, y: tp.y, kind: tp.kind } : null;
        S.snapNear = nearSnapPoints(w, axis2, { x: ax, y: ay }, d.id);
        if (d.end === 1) { oe.x1 = np.x; oe.y1 = np.y; }
        else { oe.x2 = np.x; oe.y2 = np.y; }
        markHeatStale();
        WS.requestDraw();
      }
      return;
    }
    if (d.type === 'move-ob') {
      var ob = WS.findOb(d.id);
      if (ob) {
        var mx = w.x - d.sx, my = w.y - d.sy;
        if (e.shiftKey) {
          if (Math.abs(mx) > Math.abs(my)) my = 0; else mx = 0;
        }
        ob.x1 = d.ox1 + mx; ob.y1 = d.oy1 + my;
        ob.x2 = d.ox2 + mx; ob.y2 = d.oy2 + my;
        markHeatStale();
        WS.requestDraw();
      }
    }
  }

  function onUp(e) {
    /* 拖到一半松开右键/中键不该结束当前绘制或拖动（会留下半截墙） */
    if (e && typeof e.button === 'number' && e.button !== downButton) return;
    var d = S.drag;

    /* 框选结束：定选 / 或当作 Ctrl+单击 */
    if (d && d.type === 'marquee') {
      finishMarquee();
      if (S.heatStale) { S.heatStale = false; WS.requestDraw(); }
      S.drag = null;
      return;
    }

    if (S.drawing) {
      var dr = S.drawing;
      var len = Math.hypot(dr.x2 - dr.x1, dr.y2 - dr.y1);
      if (len > 4 / S.view.s) {
        var o = WS.makeObstacle(dr.type, dr.x1, dr.y1, dr.x2, dr.y2);
        S.project.obstacles.push(o);
        setSelection('ob', [o.id]);
        rebuildHeat();
        pushHistory();
        renderInspector();
        updateStatus();
      }
      S.drawing = null;
      S.snapHint = null;
      S.snapNear = [];
      stopAutoPan();
      WS.requestDraw();
    }

    if (d) {
      /* 多选状态下只是点了一下（没拖动）→ 收起为单选，和普通点击行为一致 */
      if (d.type === 'move-multi' && !d.moved) {
        setSelection(d.kind, [d.pressId]);
        renderInspector();
        WS.requestDraw();
        el.cv.style.cursor = cursorFor(S.tool);
        S.heatStale = false;
        S.drag = null;
        return;
      }
      /* 端点被拖到与另一端几乎重合 → 整段删掉（等效「把墙拖没了」）。
         否则会留下一个看不见、也点不中的零长度墙，只能撤销或重开项目才清得掉。 */
      if (d.type === 'move-ob-end') {
        var oe2 = WS.findOb(d.id);
        if (oe2) {
          var segPx = Math.hypot(oe2.x2 - oe2.x1, oe2.y2 - oe2.y1) * S.view.s;
          if (segPx < MIN_WALL_PX) {
            removeOb(d.id);          /* 内部已 pushHistory + rebuildHeat + 清选择 */
            tip('墙段被拖到几乎没有长度，已删除（Ctrl+Z 可撤销）', 2600);
            el.cv.style.cursor = cursorFor(S.tool);
            S.heatStale = false;
            clearSnapState();
            S.drag = null;
            WS.requestDraw();
            return;
          }
        }
      }

      /* 拖动过程中不重算热力图，松手（位置固定）后才算一次 */
      if (d.type === 'move-ap' || d.type === 'rotate-ap' ||
          d.type === 'move-ob' || d.type === 'move-ob-end' ||
          d.type === 'move-multi') {
        pushHistory();
        rebuildHeat();
        if (d.type === 'move-multi') renderInspector();
      }
      el.cv.style.cursor = cursorFor(S.tool);
      S.snapHint = null;
      S.snapNear = [];
    }
    if (S.heatStale) { S.heatStale = false; WS.requestDraw(); }
    S.drag = null;
  }

  function cursorFor(t) {
    if (t === 'select') return 'default';
    if (t === 'erase') return 'crosshair';
    if (t.indexOf('ap-') === 0) return 'copy';
    return 'crosshair';
  }

  /* ============================================================
     框选（Ctrl + 拖动）
     规则：平面编辑模式只框墙体，设备编辑模式只框 AP。
     类型由 scopeOfMode() 统一决定，选择集永远只有一种类型，
     避免「墙 + AP 混选」后批量操作改错对象。
     ============================================================ */
  function marqueeHint(sc, n) {
    return '仅框选' + sc.label + ' · 已覆盖 ' + n + ' ' + sc.unit;
  }

  function startMarquee(w) {
    var sc = scopeOfMode();
    S.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, moved: false, hint: marqueeHint(sc, 0) };
    S.drag = { type: 'marquee' };
    S.drawing = null;
    el.cv.style.cursor = 'crosshair';
    tip('框选中… ' + sc.modeName + '模式仅框选' + sc.label + '，拖出范围后松手生效', 0);
    WS.requestDraw();
  }

  function updateMarquee(w) {
    var m = S.marquee;
    if (!m) return;
    m.x1 = w.x;
    m.y1 = w.y;
    m.moved = Math.hypot(m.x1 - m.x0, m.y1 - m.y0) * S.view.s > 3;
    var sc = scopeOfMode();
    var ids = m.moved ? marqueeHits(sc.kind) : [];
    m.hint = marqueeHint(sc, ids.length);
    tip('框选中… ' + sc.modeName + '模式仅框选' + sc.label +
        ' · 当前覆盖 ' + ids.length + ' ' + sc.unit, 0);
    WS.requestDraw();
  }

  function finishMarquee() {
    var m = S.marquee;
    if (!m) return;
    var sc = scopeOfMode();
    /* 必须在清掉 S.marquee 之前算命中结果 */
    var ids = m.moved ? marqueeHits(sc.kind) : [];
    S.marquee = null;
    el.cv.style.cursor = cursorFor(S.tool);

    /* 没拖动 = Ctrl + 单击，按普通点选处理（与点击选择完全兼容） */
    if (!m.moved) {
      var hit = WS.hitTest(m.x1, m.y1);
      var hk = hit ? hit.kind : null;
      if (hk === 'ap-handle') hk = 'ap';
      if (hk === 'ob-end') hk = 'ob';
      if (!hit) {
        clearSelection();
      } else if (hk === sc.kind) {
        setSelection(sc.kind, [hit.id]);
      } else {
        tip(sc.modeName + '模式只能选中' + sc.label + '，已忽略点到的对象', 2800);
        WS.requestDraw();
        return;
      }
      renderInspector();
      WS.requestDraw();
      return;
    }

    setSelection(sc.kind, ids);
    renderInspector();
    updateStatus();
    WS.requestDraw();
    if (ids.length) {
      tip('已框选 ' + ids.length + ' ' + sc.unit + sc.label +
          ' · ' + sc.modeName + '模式仅框选' + sc.label + '，按 Delete 可批量删除', 3200);
    } else {
      tip('框选范围内没有' + sc.label + '（' + sc.modeName + '模式只能框选' + sc.label + '）', 3000);
    }
  }

  function marqueeHits(kind) {
    var m = S.marquee;
    if (!m) return [];
    var x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
    var y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
    var out = [];
    if (kind === 'ap') {
      S.project.aps.forEach(function (ap) {
        if (ap.x >= x0 && ap.x <= x1 && ap.y >= y0 && ap.y <= y1) out.push(ap.id);
      });
    } else {
      S.project.obstacles.forEach(function (o) {
        if (segRectHit(o, x0, y0, x1, y1)) out.push(o.id);
      });
    }
    return out;
  }

  /* 线段与矩形相交：端点落在框内，或与矩形任一条边相交 */
  function segRectHit(o, x0, y0, x1, y1) {
    var ax = o.x1, ay = o.y1, bx = o.x2, by = o.y2;
    if (ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1) return true;
    if (bx >= x0 && bx <= x1 && by >= y0 && by <= y1) return true;
    return WS.segIntersect(ax, ay, bx, by, x0, y0, x1, y0) ||
           WS.segIntersect(ax, ay, bx, by, x1, y0, x1, y1) ||
           WS.segIntersect(ax, ay, bx, by, x1, y1, x0, y1) ||
           WS.segIntersect(ax, ay, bx, by, x0, y1, x0, y0);
  }

  /* 整组拖动前记下各对象原始位置 */
  function groupSnapshot(kind) {
    if (kind === 'ap') {
      return selectedObjects('ap').map(function (a) { return { id: a.id, x: a.x, y: a.y }; });
    }
    return selectedObjects('ob').map(function (o) {
      return { id: o.id, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 };
    });
  }

  function nearestApDist(w) {
    var best = null;
    var mpp = S.project.mpp || 0.05;
    S.project.aps.forEach(function (a) {
      var d = Math.hypot(a.x - w.x, a.y - w.y) * mpp;
      if (best === null || d < best) best = d;
    });
    return best;
  }

  /* ------------------------------------------------------------
     端点吸附：把点吸到最近的已有墙体端点（半径按屏幕像素固定，缩放后手感一致）
     excludeId —— 拖动墙体自身端点时排除自己，避免吸回原位
     ------------------------------------------------------------ */
  /* 点到线段的最近点（垂足） */
  function closestOnSeg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return { x: x1, y: y1 };
    var t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = WS.clamp(t, 0, 1);
    return { x: x1 + t * dx, y: y1 + t * dy };
  }

  /* 线段 a1→a2（可延长）与线段 s1→s2 的交点
     约束：交点必须落在已有墙段内（u∈[0,1]）、且在 a1 的正方向（t≥0），
     否则会出现"吸到墙延长线的空中"或"墙被拉到反向" */
  function segCrossPoint(a1, a2, s1, s2) {
    var rx = a2.x - a1.x, ry = a2.y - a1.y;
    var qx = s2.x - s1.x, qy = s2.y - s1.y;
    var den = rx * qy - ry * qx;
    if (Math.abs(den) < 1e-9) return null;                 /* 平行 / 共线 */
    var ax = s1.x - a1.x, ay = s1.y - a1.y;
    var t = (ax * qy - ay * qx) / den;
    var u = (ax * ry - ay * rx) / den;
    if (t < 0) return null;                                /* 交点在起点反方向 */
    if (u < -0.001 || u > 1.001) return null;              /* 交点不在已有墙段上 */
    return { x: a1.x + t * rx, y: a1.y + t * ry };
  }

  /* ------------------------------------------------------------
     吸附：按优先级找最近的目标
       ① 已有墙的端点（含很早画的墙）
       ② 当前走向与已有墙的交点 —— 保持墙体方向，只把端点"顶"到墙上
       ③ 已有墙上的垂足（平行等没有交点的情况）
     anchor 为当前线段的起点；传入后会做交点判定，传 null 则只有 ①③。

     axis = 'h' | 'v' 表示本次绘制已被正交约束（按住 Shift 或直线修正触发）。
     此时**所有候选点都必须落在以 anchor 为基准的水平/垂直线上**，否则等于
     把刚画直的墙又拽歪 —— 这是「吸附与正交打架」的修复点：
       · 端点：垂直偏移超过 offTol 的直接跳过（宁可吸不到，也不能破坏正交）
       · 交点：改用**约束线**与已有墙求交，而不是沿鼠标斜向射线求交；
               这样端点被"顶"到墙上时，墙依然严格水平/垂直
       · 垂足：先把光标投影到约束轴再求垂足，垂足离开轴则放弃
     ------------------------------------------------------------ */
  function snapPoint(w, anchor, excludeId, axis) {
    if (!S.aids.snap || !(S.aids.snapPx > 0)) return { x: w.x, y: w.y, kind: null };
    var tol = S.aids.snapPx / S.view.s;
    var obs = S.project.obstacles;
    var best = null, bd = tol;
    var i, k;
    var offTol = tol * 0.4;        /* 正交时允许的垂直偏移，比吸附半径更严 */

    function onAxis(p) {
      if (!axis) return true;
      return axis === 'h' ? Math.abs(p.y - anchor.y) <= offTol
                          : Math.abs(p.x - anchor.x) <= offTol;
    }

    /* ① 端点 */
    for (i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (excludeId && o.id === excludeId) continue;
      var ex = [o.x1, o.x2], ey = [o.y1, o.y2];
      for (k = 0; k < 2; k++) {
        if (axis && !onAxis({ x: ex[k], y: ey[k] })) continue;
        var d = Math.hypot(ex[k] - w.x, ey[k] - w.y);
        if (d < bd) { bd = d; best = { x: ex[k], y: ey[k], kind: 'end' }; }
      }
    }
    if (best) return best;

    if (S.aids.snapEdge === false) return { x: w.x, y: w.y, kind: null };

    /* ② 交点：正交时沿约束轴延伸求交（segCrossPoint 内部会用 t≥0 / u∈[0,1] 过滤） */
    if (anchor) {
      var p0 = anchor, p1 = w;
      if (axis === 'h') {
        p0 = { x: anchor.x, y: anchor.y };
        p1 = { x: anchor.x + (w.x >= anchor.x ? 1e6 : -1e6), y: anchor.y };
      } else if (axis === 'v') {
        p0 = { x: anchor.x, y: anchor.y };
        p1 = { x: anchor.x, y: anchor.y + (w.y >= anchor.y ? 1e6 : -1e6) };
      }
      for (i = 0; i < obs.length; i++) {
        var o2 = obs[i];
        if (excludeId && o2.id === excludeId) continue;
        var cp = segCrossPoint(p0, p1,
          { x: o2.x1, y: o2.y1 }, { x: o2.x2, y: o2.y2 });
        if (!cp) continue;
        if (axis && !onAxis(cp)) continue;
        var dc = Math.hypot(cp.x - w.x, cp.y - w.y);
        if (dc < bd) { bd = dc; best = { x: cp.x, y: cp.y, kind: 'cross' }; }
      }
      if (best) return best;
    }

    /* ③ 垂足：正交时先把光标投影到约束轴，再取墙上的最近点 */
    var probe = w;
    if (axis === 'h') probe = { x: w.x, y: anchor.y };
    else if (axis === 'v') probe = { x: anchor.x, y: w.y };
    for (i = 0; i < obs.length; i++) {
      var o3 = obs[i];
      if (excludeId && o3.id === excludeId) continue;
      var q = closestOnSeg(probe.x, probe.y, o3.x1, o3.y1, o3.x2, o3.y2);
      if (axis && !onAxis(q)) continue;      /* 斜墙的垂足会离开约束轴，放弃 */
      var dq = Math.hypot(q.x - w.x, q.y - w.y);
      if (dq < bd) { bd = dq; best = { x: q.x, y: q.y, kind: 'edge' }; }
    }
    return best || { x: w.x, y: w.y, kind: null };
  }

  /* 附近的候选端点（3 倍半径内），画成淡色方框，让用户知道哪里能吸。
     正交约束下只提示落在约束轴上的端点，避免"看得到方框却吸不上"的困惑 */
  function nearSnapPoints(w, axis, anchor, excludeId) {
    if (!S.aids.snap || !(S.aids.snapPx > 0)) return [];
    var r = (S.aids.snapPx * 3) / S.view.s;
    var out = [];
    for (var i = 0; i < S.project.obstacles.length; i++) {
      var o = S.project.obstacles[i];
      if (excludeId && o.id === excludeId) continue;    /* 拖端点时别提示它自己 */
      var pts = [[o.x1, o.y1], [o.x2, o.y2]];
      for (var k = 0; k < 2; k++) {
        if (axis && anchor) {
          var onAxis = axis === 'h'
            ? Math.abs(pts[k][1] - anchor.y) <= r * 0.4
            : Math.abs(pts[k][0] - anchor.x) <= r * 0.4;
          if (!onAxis) continue;
        }
        if (Math.hypot(pts[k][0] - w.x, pts[k][1] - w.y) <= r) {
          out.push({ x: pts[k][0], y: pts[k][1] });
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------
     直线修正的判定：返回 'h'（贴水平）/ 'v'（贴垂直）/ null（不修正）
     force = true（按住 Shift）时无条件正交。
     偏差（短边/长边）< 阈值（默认 0.16，约 9.1°）才修正；
     距离太近（< 3 屏幕像素）不判定，避免起手时的抖动误触发。
     ------------------------------------------------------------ */
  function orthoAxis(ax, ay, bx, by, force) {
    var adx = Math.abs(bx - ax), ady = Math.abs(by - ay);
    if (Math.max(adx, ady) * S.view.s < 3) return null;
    if (!force) {
      var lim = S.aids.orthoRatio;
      if (!S.aids.ortho || !(lim > 0)) return null;
      if (Math.min(adx, ady) / Math.max(adx, ady) > lim) return null;
    }
    return adx >= ady ? 'h' : 'v';
  }

  function orthoSnap(ax, ay, bx, by, force) {
    var axis = orthoAxis(ax, ay, bx, by, force);
    if (!axis) return { x: bx, y: by };
    return axis === 'h' ? { x: bx, y: ay } : { x: ax, y: by };
  }

  /* 绘制中的终点：正交判定 → 在约束内吸附 → 没有目标时才退回纯正交。
     关键：正交判定必须用**原始光标位置**，不能用吸附后的点，否则判定会失真
     （吸附点可能已经偏出去，导致本来该修正的没修正）。 */
  function updateDrawingPoint(w, forceOrtho) {
    var d = S.drawing;
    if (!d) return;
    var ax = d.x1, ay = d.y1;
    var axis = orthoAxis(ax, ay, w.x, w.y, forceOrtho);
    var tw = snapPoint(w, { x: ax, y: ay }, undefined, axis);

    var p;
    if (tw.kind) {
      p = { x: tw.x, y: tw.y };                    /* 吸附点已保证在约束轴上 */
    } else if (axis === 'h') {
      p = { x: w.x, y: ay };
    } else if (axis === 'v') {
      p = { x: ax, y: w.y };
    } else {
      p = { x: w.x, y: w.y };
    }

    d.x2 = p.x;
    d.y2 = p.y;
    S.snapHint = tw.kind ? { x: tw.x, y: tw.y, kind: tw.kind } : null;
    S.snapNear = nearSnapPoints(w, axis, { x: ax, y: ay });
    S.cursorWorld = { x: w.x, y: w.y };
    WS.requestDraw();
  }

  /* 拖动期间只标记「热力图已过期」，不触发任何重算 */
  function markHeatStale() {
    S.heatStale = true;
  }

  /* ------------------------------------------------------------
     边缘自动滚屏：画线时鼠标进入视图边缘 56 px 内即开始平移，
     越靠外越快；平移后按同一屏幕位置反算世界坐标，线段跟着光标继续延长
     ------------------------------------------------------------ */
  var EDGE_PX = 56;
  var EDGE_MAX_STEP = 10;   /* 贴着边缘时每帧最多 10 px（≈600 px/s），靠外不再加速 */
  var autoPanRaf = 0;

  function startAutoPan() {
    if (autoPanRaf) return;
    autoPanRaf = requestAnimationFrame(autoPanTick);
  }

  function stopAutoPan() {
    if (autoPanRaf) cancelAnimationFrame(autoPanRaf);
    autoPanRaf = 0;
  }

  function edgeStep(v) {
    var t = Math.min(1, Math.abs(v) / EDGE_PX);
    var sp = 1.5 + t * (EDGE_MAX_STEP - 1.5);
    return v < 0 ? -sp : sp;
  }

  function autoPanTick() {
    autoPanRaf = 0;
    if (!S.drawing) return;                       // 绘制结束，循环自然停止
    autoPanRaf = requestAnimationFrame(autoPanTick);
    if (!S.aids.edgePan || !S.lastScr) return;

    var vw = WS.viewSize();
    var sx = S.lastScr.x, sy = S.lastScr.y;
    var dx = 0, dy = 0;
    if (sx < EDGE_PX) dx = EDGE_PX - sx;
    else if (sx > vw.w - EDGE_PX) dx = -(sx - (vw.w - EDGE_PX));
    if (sy < EDGE_PX) dy = EDGE_PX - sy;
    else if (sy > vw.h - EDGE_PX) dy = -(sy - (vw.h - EDGE_PX));
    if (!dx && !dy) return;

    S.view.ox += edgeStep(dx);
    S.view.oy += edgeStep(dy);

    /* 视图移动后同一屏幕位置对应的世界坐标已改变 → 重算终点 */
    updateDrawingPoint(WS.screenToWorld(sx, sy), shiftDown);
    updateZoomLabel();
  }

  /* ---------- 键盘 ---------- */
  function onKeyDown(e) {
    if (e.key === 'Shift') shiftDown = true;
    var k = e.key.toLowerCase();
    var mod = e.ctrlKey || e.metaKey;

    /* 带修饰键的组合优先处理，不受输入框焦点影响 */
    if (mod) {
      /* Ctrl+Shift+A —— 直接切到吸顶 AP 放置工具（必要时自动进入设备编辑） */
      if (k === 'a' && e.shiftKey) { e.preventDefault(); quickCeilingAp(); return; }
      if (k === 's' && e.shiftKey) { e.preventDefault(); saveProject(true); return; }
      if (k === 's') { e.preventDefault(); saveProject(); return; }
      if (k === 'o') { e.preventDefault(); el.fileProject.click(); return; }
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      return;   // 其余 Ctrl 组合不参与工具切换，交给系统/浏览器
    }

    /* Alt + 1~6：图层开关（热力图 / 障碍物 / 无线设备 / 米制网格 / 天线方向图 / 信号重叠）
       在文本类输入框里不拦截，避免与中文输入法的 Alt+数字选词冲突 */
    if (e.altKey && !mod && !e.shiftKey) {
      var tg0 = (e.target.tagName || '').toLowerCase();
      var tp0 = (e.target.type || '').toLowerCase();
      var inText = tg0 === 'textarea' ||
        (tg0 === 'input' && tp0 !== 'checkbox' && tp0 !== 'range' && tp0 !== 'radio');
      var li = '123456'.indexOf(e.key);
      if (!inText && li >= 0) { e.preventDefault(); toggleLayer(LAYER_KEYS[li]); return; }
    }

    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    if (e.code === 'Space') { spaceDown = true; el.cv.style.cursor = 'grab'; e.preventDefault(); return; }

    if (k === 'escape') {
      if (S.calib) { S.calib = null; WS.requestDraw(); tip('已取消标定'); return; }
      if (S.drawing) { S.drawing = null; stopAutoPan(); clearSnapState(); WS.requestDraw(); return; }
      if (S.marquee) { S.marquee = null; S.drag = null; WS.requestDraw(); tip('已取消框选'); return; }
      /* 处于放置 AP / 画墙工具时，Esc 先退回「选择」（选中对象保留） */
      if (S.tool !== 'select') { setTool('select'); return; }
      if (S.selIds.length) { clearSelection(); renderInspector(); WS.requestDraw(); }
      return;
    }
    if (k === 'delete' || k === 'backspace') {
      if (S.selIds.length) {
        deleteSelection();
        e.preventDefault();
      }
      return;
    }

    if (S.mode === 'plan') {
      if (k === 'v') setTool('select');
      else if (k === 'w') setTool('wall');
      else if (k === 'd') setTool('door');
      else if (k === 'n') setTool('window');
      else if (k === 'e') setTool('erase');
    } else {
      if (k === 'v') setTool('select');
      else if (k === '1') setTool('ap-ceiling');
      else if (k === '2') setTool('ap-wall');
      else if (k === '3') setTool('ap-panel');
    }
    if (k === 'tab') { e.preventDefault(); setMode(S.mode === 'plan' ? 'device' : 'plan'); }
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') shiftDown = false;
    if (e.code === 'Space') {
      spaceDown = false;
      if (!S.drag) el.cv.style.cursor = cursorFor(S.tool);
    }
  }

  /* Ctrl+Shift+A：一键进入设备编辑并切到吸顶 AP 放置工具 */
  function quickCeilingAp() {
    if (S.mode !== 'device') setMode('device');
    setTool('ap-ceiling');
    tip('吸顶 AP 放置工具 · 在图上点击放置，Esc 退回选择');
  }

  /* ============================================================
     对象操作
     ============================================================ */
  function placeAp(mount, w) {
    var name = nextApName(mount);
    var ap = WS.makeAp(mount, w.x, w.y, 1);
    ap.name = name;
    S.project.aps.push(ap);
    setSelection('ap', [ap.id]);
    rebuildHeat('draft');          /* 先出草稿，260 ms 空闲后再升精细，避免二次卡顿叠加 */
    pushHistory();
    renderInspector();
    updateStatus();
    WS.requestDraw();
    tip('已放置 ' + WS.AP_PRESETS[mount].label + ' · ' + name);
  }

  function nextApName(mount) {
    var prefix = mount === 'ceiling' ? 'AP' : (mount === 'wall' ? 'WAP' : 'PAP');
    var max = 0;
    S.project.aps.forEach(function (a) {
      if (!a.name) return;
      var m = a.name.match(/(\d+)\s*$/);
      if (a.name.indexOf(prefix) === 0 && m) max = Math.max(max, parseInt(m[1], 10));
    });
    return prefix + '-' + (max + 1);
  }

  function removeAp(id) {
    var arr = S.project.aps;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) {
        arr.splice(i, 1);
        dropFromSelection(id);
        rebuildHeat('draft');
        pushHistory();
        renderInspector();
        updateStatus();
        WS.requestDraw();
        return;
      }
    }
  }

  function removeOb(id) {
    var arr = S.project.obstacles;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) {
        arr.splice(i, 1);
        dropFromSelection(id);
        rebuildHeat();
        pushHistory();
        renderInspector();
        updateStatus();
        WS.requestDraw();
        return;
      }
    }
  }

  /* 单个删除时同步选择集，避免留下已失效的 id */
  function dropFromSelection(id) {
    var k = S.selIds.indexOf(id);
    if (k < 0) return;
    var ids = S.selIds.slice();
    ids.splice(k, 1);
    setSelection(S.selKind, ids);
  }

  /* 批量删除当前选择集：只记一条历史，可一次 Ctrl+Z 撤销 */
  function deleteSelection() {
    var kind = S.selKind;
    var ids = S.selIds.slice();
    if (!ids.length) return;
    if (kind === 'ap') {
      S.project.aps = S.project.aps.filter(function (a) { return ids.indexOf(a.id) < 0; });
    } else {
      S.project.obstacles = S.project.obstacles.filter(function (o) { return ids.indexOf(o.id) < 0; });
    }
    clearSelection();
    rebuildHeat();
    pushHistory();
    renderInspector();
    updateStatus();
    WS.requestDraw();
    tip('已删除 ' + ids.length + ' ' + (kind === 'ap' ? '台 AP' : '段墙体') + ' · Ctrl+Z 可撤销', 3200);
  }

  /* ============================================================
     比例标定
     ============================================================ */
  function startCalibration() {
    S.calib = { p1: null, p2: null, cur: { x: 0, y: 0 } };
    S.drawing = null;
    el.cv.style.cursor = 'crosshair';
    tip('请在平面图上点击已知长度的起点', 0);
    WS.requestDraw();
  }

  function calibClick(w) {
    var c = S.calib;
    if (!c.p1) {
      c.p1 = { x: w.x, y: w.y };
      c.cur = { x: w.x, y: w.y };
      tip('再点击另一个端点', 0);
      WS.requestDraw();
      return;
    }
    c.p2 = { x: w.x, y: w.y };
    var dpx = Math.hypot(c.p2.x - c.p1.x, c.p2.y - c.p1.y);
    if (dpx < 5) { S.calib = null; tip('两点太近，请重新标定'); WS.requestDraw(); return; }
    WS.requestDraw();

    inputDialog('标定比例尺', '这两点之间的实际距离是多少米？', '', 'm',
      '例如：一面墙的实际长度为 4.5 米，就填 4.5。像素距离 ' + Math.round(dpx) + ' px。')
      .then(function (m) {
        if (!m || m <= 0) { S.calib = null; WS.requestDraw(); return; }
        S.project.mpp = m / dpx;
        S.project.calibrated = true;
        S.project.scaleRef = { mode: 'two', meters: m, px: dpx };
        S.calib = null;
        syncScaleUI();
        rebuildHeat();
        pushHistory();
        el.cv.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
        tip('比例尺已标定：1 px = ' + WS.round(S.project.mpp * 100, 2) + ' cm');
        WS.requestDraw();
      });
  }

  /* ============================================================
     图片 / 项目文件
     ============================================================ */
  /* ------------------------------------------------------------
     底图压缩：黑白线稿 / 扫描件用 WebP 重编码
       · 尺寸不变 → 墙 / AP 坐标、mpp、比例标定全都不受影响
       · 只做一次（imageCodec 标记）→ 不会多次有损重编码累积劣化
       · 压不动（收益 < 15%）就保留原图，只记 keep，下次不再尝试
     ------------------------------------------------------------ */
  function compressBackdrop(p, done) {
    function finish(gain) { if (done) done(gain || 0); }
    var src = p && p.image;
    if (!src) { finish(0); return; }
    if (p.imageCodec) { finish(0); return; }
    if (src.length < WS.BACKDROP_TRY_BYTES) { p.imageCodec = 'keep'; finish(0); return; }
    if (typeof Image === 'undefined') { finish(0); return; }

    var img = new Image();
    img.onload = function () {
      var out = null;
      try {
        var cv = document.createElement('canvas');
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        var g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        out = cv.toDataURL('image/webp', 0.95);
      } catch (e) { out = null; }

      if (out && out.indexOf('data:image/webp') === 0 &&
          out.length < src.length * WS.BACKDROP_MIN_GAIN) {
        p.image = out;
        p.imageCodec = 'webp95';
        finish(1 - out.length / src.length);
      } else {
        p.imageCodec = 'keep';
        finish(0);
      }
    };
    img.onerror = function () { p.imageCodec = 'keep'; finish(0); };
    img.src = src;
  }

  function loadImageFile(file) {
    if (!file.type.match(/^image\//)) { tip('请选择图片文件'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var img = new Image();
      img.onload = function () {
        var W0 = img.naturalWidth, H0 = img.naturalHeight;
        var maxSide = 4000;
        var scale = Math.min(1, maxSide / Math.max(W0, H0));
        var w = Math.max(1, Math.round(W0 * scale));
        var h = Math.max(1, Math.round(H0 * scale));

        var dataURL;
        if (scale < 1) {
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          dataURL = c.toDataURL('image/png');
        } else {
          dataURL = rd.result;
        }

        var p = S.project;
        p.image = dataURL;
        p.imgW = w;
        p.imgH = h;
        p._blank = false;

        var img2 = new Image();
        img2.onload = function () {
          S.imgEl = img2;
          WS.fitView();
          rebuildHeat();
          updateStatus();
          WS.requestDraw();
          /* 底图体积大时压一次（尺寸不变，只换编码），解决项目文件/自动保存过大 */
          compressBackdrop(p, function (gain) {
            if (gain > 0) {
              scheduleAutosave();
              tip('底图已压缩：体积减小约 ' + Math.round(gain * 100) +
                  '%（尺寸不变，线条清晰度不受影响）', 3400);
            }
          });
        };
        if (scale < 1) {
          img2.src = dataURL;
        } else {
          img2.src = dataURL;
        }

        el.emptyState.hidden = true;
        el.hud.hidden = false;
        el.legend.hidden = !(S.mode === 'device' || S.project.aps.length);
        syncInputs();
        /* 换了底图，之前的撤销记录是基于旧图纸坐标的，继续沿用会让墙/AP 套到新图上错位。
           这里把历史重置为「导入后的状态」作为新起点。 */
        resetHistory();
        tip('底图已导入 ' + w + ' × ' + h + ' px，建议先标定比例尺');
      };
      img.onerror = function () { tip('图片读取失败，请换一张试试'); };
      img.src = rd.result;
    };
    /* 读文件本身也可能失败（被占用 / 没权限 / 文件已被删除），不能静默 */
    rd.onerror = function () { tip('无法读取该图片文件，请确认它没有被其他程序占用', 4200); };
    rd.readAsDataURL(file);
  }

  /* forceDialog = true 时强制弹框（另存为）；否则直接写回上次的路径 */
  function saveProject(forceDialog) {
    var doc = S.doc || WS.wrapDoc(S.project);
    var name = (doc.name || '未命名项目').replace(/[\\/:*?"<>|]/g, '_');
    var filename = name + '.wssurvey.json';
    var text = WS.serialize(doc);
    var desk = window.wsDesktop;

    /* 桌面版交给主进程：第一次弹框选路径，之后记在 userData 里，
       Ctrl+S 直接写回同一个文件，不再打断操作 */
    if (desk && desk.saveProjectFile) {
      desk.saveProjectFile({
        content: text, filename: filename, key: name, forceDialog: !!forceDialog
      }).then(function (r) {
        if (!r) return;
        if (r.ok) {
          S.dirty = false;
          notifySaved(forceDialog ? '已另存为' : '项目已保存');
          tip('已保存到 ' + r.path, 3000);
        } else if (r.error) {
          dialog({
            title: '保存失败',
            body: '<p>无法写入这个文件：</p><p style="color:var(--danger)">' +
              escapeHtml(r.error) + '</p><p style="font-size:11px;color:var(--txt-3)">' +
              '可能被其他程序占用，或该目录没有写入权限。</p>'
          });
        }
        /* cancelled：用户自己取消的，不打扰 */
      }).catch(function (err) {
        dialog({ title: '保存失败', body: '<p>' + escapeHtml(String((err && err.message) || err)) + '</p>' });
      });
      return;
    }

    /* 网页版没有文件系统权限，只能触发浏览器下载 */
    var blob = new Blob([text], { type: 'application/json' });
    downloadBlob(blob, filename);
    S.dirty = false;
    notifySaved('项目已保存');
  }

  function readProjectFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var p = WS.deserialize(rd.result);
        applyProject(p);
        /* 桌面版：记住这个文件的真实路径，之后 Ctrl+S 直接存回原文件 */
        var desk = window.wsDesktop;
        if (desk && desk.pathForFile && desk.setSavePath) {
          var fp = desk.pathForFile(file);
          var nm = ((S.doc && S.doc.name) || '未命名项目').replace(/[\\/:*?"<>|]/g, '_');
          if (fp) desk.setSavePath(nm, fp);
        }
        tip('已打开：' + p.name);
      } catch (err) {
        dialog({ title: '打开失败', body: '<p>文件解析出错：</p><p style="color:var(--danger)">' + escapeHtml(String(err.message || err)) + '</p>' });
      }
    };
    rd.onerror = function () {
      dialog({ title: '打开失败', body: '<p>无法读取该文件：可能被其他程序占用，或没有读取权限。</p>' });
    };
    rd.readAsText(file);
  }

  /* 兼容入口：外部（测试 / 示例 / 老接口）传「单个平铺项目」时，包成 A 栋 / 1F 文档 */
  function applyProject(p) {
    applyDoc(WS.wrapDoc(p));
  }

  /* 打开一份文档：把「活动楼层」挂到 S.project 上，其余代码继续围绕 S.project 工作 */
  function applyDoc(doc) {
    S.doc = doc;
    var f = WS.activeFloor(doc);
    S.project = f;

    clearSelection();
    S.drawing = null;
    S.calib = null;
    S.marquee = null;
    S.drag = null;
    clearSnapState();
    S.heat = null;
    S.heatCanvas = null;
    S.overlapPolys = null;
    S.heatDirty = false;
    S.histories = {};
    if (!S.layerPref) S.layerPref = { heat: true, beam: false, overlap: false };
    resetHistory();

    loadFloorImage(f);

    applyModeLayers(S.mode);
    syncLayerUI();

    buildFloorUI();
    syncInputs();
    WS.fitView();
    rebuildHeat();
    renderInspector();
    updateStatus();
    pushHistory();
  }

  /* 载入某一层的底图（打开项目 / 切楼层都走这里） */
  function loadFloorImage(f) {
    if (f && f.image) {
      var img = new Image();
      img.onload = function () {
        if (S.project !== f) return;        /* 加载期间又切走了，丢弃这次结果 */
        S.imgEl = img;
        WS.requestDraw();
        /* 老项目里存的是原始 PNG，这里补一次压缩（只做一次，之后有标记跳过） */
        compressBackdrop(f, function (gain) {
          if (gain > 0) { S.dirty = true; scheduleAutosave(); }
        });
      };
      img.src = f.image;
      S.imgEl = null;
    } else {
      S.imgEl = null;
    }
    var hasContent = !!(f && (f._blank || f.obstacles.length || f.aps.length));
    el.emptyState.hidden = !!(f && (f.image || hasContent));
    el.hud.hidden = !(f && (f.image || hasContent));
    el.legend.hidden = true;
  }

  /* ============================================================
     楼层：下拉 / 新增 / 重命名 / 删除 / 切换
     ============================================================ */
  function buildFloorUI() {
    if (!el.selBuilding || !S.doc) return;
    var doc = S.doc;
    var html = '';
    for (var i = 0; i < doc.buildings.length; i++) {
      html += '<option value="' + doc.buildings[i].id + '">' +
        escapeHtml(doc.buildings[i].name) + '</option>';
    }
    el.selBuilding.innerHTML = html;
    el.selBuilding.value = doc.activeBuilding;

    var b = WS.findBuilding(doc, doc.activeBuilding) || doc.buildings[0];
    var fh = '';
    for (var j = 0; j < b.floors.length; j++) {
      fh += '<option value="' + b.floors[j].id + '">' +
        escapeHtml(b.floors[j].name) + '</option>';
    }
    el.selFloor.innerHTML = fh;
    el.selFloor.value = doc.activeFloor;

    var active = WS.activeFloor(doc);
    if (el.stFloor) {
      el.stFloor.textContent = b.name + ' · ' + (active ? active.name : '—');
    }
  }

  /* 切走前把撤销栈存起来，切回来还能继续撤销 */
  function stashHistory() {
    if (!S.project || !S.project.id) return;
    S.histories[S.project.id] = S.history;
  }

  /* 结构变化后强制重载当前楼层（不走 switchFloor 的「同层直接返回」） */
  function reloadFloor() {
    var f = WS.activeFloor(S.doc);
    S.project = f;
    S.heat = null;
    S.heatCanvas = null;
    S.overlapPolys = null;
    S.heatDirty = false;
    S.drag = null;
    S.drawing = null;
    S.calib = null;
    clearSelection();
    clearSnapState();
    loadFloorImage(f);
    S.history = S.histories[f.id] || { stack: [], pos: -1, lock: false };
    if (S.history.pos < 0) resetHistory();
    buildFloorUI();
    syncInputs();
    WS.fitView();
    /* 先出草稿（比精细快约 4 倍），空闲后再精修：切楼层不该让人等整张图算完 */
    rebuildHeat('draft');
    renderInspector();
    updateStatus();
    WS.requestDraw();
  }

  function switchFloor(bid, fid) {
    if (!S.doc) return;
    if (bid === S.doc.activeBuilding && fid === S.doc.activeFloor) return;
    if (!WS.setActive(S.doc, bid, fid)) return;
    stashHistory();
    reloadFloor();
    var f = S.project;
    tip('已切换到 ' + f.name + '（墙 ' + f.obstacles.length + ' 段 · AP ' + f.aps.length + ' 台）', 2600);
  }

  function bindFloor() {
    if (!el.selBuilding) return;

    el.selBuilding.onchange = function () {
      var b = WS.findBuilding(S.doc, el.selBuilding.value);
      if (!b) return;
      if (b.id === S.doc.activeBuilding) { buildFloorUI(); return; }
      switchFloor(b.id, b.floors[0].id);
    };

    el.selFloor.onchange = function () {
      switchFloor(S.doc.activeBuilding, el.selFloor.value);
    };

    el.btnAddFloor.onclick = function () {
      if (!S.doc) return;
      var b = WS.findBuilding(S.doc, S.doc.activeBuilding);
      var f = WS.addFloor(S.doc, S.doc.activeBuilding);
      if (!f || !b) return;
      S.dirty = true;
      scheduleAutosave();
      switchFloor(b.id, f.id);
      tip('已新增 ' + f.name + '（空楼层，请导入本层图纸并标定比例）', 3200);
    };

    el.btnAddBuilding.onclick = function () {
      if (!S.doc) return;
      var b = WS.addBuilding(S.doc);
      S.dirty = true;
      scheduleAutosave();
      switchFloor(b.id, b.floors[0].id);
      tip('已新增楼宇「' + b.name + '」及其 1F', 3000);
    };

    el.btnRenameFloor.onclick = function () {
      var f = WS.activeFloor(S.doc);
      if (!f) return;
      dialog({
        title: '重命名楼层',
        body: '<p style="margin:0 0 8px">给当前楼层起个名字（如 3F、机房层）：</p>' +
          '<input id="dlgInput" value="' + escapeHtml(f.name) + '" maxlength="16" ' +
          'style="width:100%;padding:7px 9px;border-radius:6px;border:1px solid var(--line-2);' +
          'background:var(--bg-0);color:var(--txt);font-size:13px">',
        buttons: [
          { label: '取消', cls: 'btn-s', value: false },
          {
            label: '确定', cls: 'btn-p',
            collect: function () {
              var v = (document.getElementById('dlgInput').value || '').trim();
              return v || false;                 /* 空名字不关闭弹窗 */
            }
          }
        ]
      }).then(function (v) {
        if (!v) return;
        f.name = v;
        S.dirty = true;
        scheduleAutosave();
        buildFloorUI();
        tip('楼层已重命名为 ' + v, 2400);
      });
    };

    el.btnDelFloor.onclick = function () {
      var doc = S.doc;
      var hit = WS.findFloor(doc, doc.activeFloor);
      if (!hit) return;
      if (hit.building.floors.length <= 1) {
        tip('每栋楼宇至少要保留一层，无法删除', 3000);
        return;
      }
      var f = hit.floor;
      dialog({
        title: '删除楼层',
        body: '<p>确定删除 <strong style="color:var(--txt)">' + escapeHtml(hit.building.name) +
          ' / ' + escapeHtml(f.name) + '</strong> 吗？</p>' +
          '<p style="color:var(--txt-3);font-size:11.5px">该层的 ' + f.obstacles.length +
          ' 段墙体、' + f.aps.length + ' 台 AP 与底图会一并删除，' +
          '<b style="color:var(--danger)">此操作不可撤销</b>。</p>',
        buttons: [
          { label: '取消', cls: 'btn-s', value: false },
          { label: '删除', cls: 'btn-d', value: true }
        ]
      }).then(function (ok) {
        if (!ok) return;
        WS.removeFloor(doc, f.id);
        S.dirty = true;
        scheduleAutosave();
        reloadFloor();
        tip('已删除楼层 ' + f.name, 2600);
      });
    };
  }

  /* ---------- 示例布局 ---------- */
  function loadDemo() {
    var p = WS.newProject();
    p.name = '示例 · 办公区无线覆盖';
    p.imgW = 1200;
    p.imgH = 880;
    p.mpp = 0.025;
    p.calibrated = true;
    p._blank = true;
    p.settings.band = '5';
    p.settings.channel = 36;
    p.settings.bw = 80;
    p.settings.freq = WS.chMhz('5', 36);
    p.settings.pathLossN = WS.defaultN(5180);

    var segs = [];
    function rect(x1, y1, x2, y2, t) {
      segs.push([t, x1, y1, x2, y1], [t, x2, y1, x2, y2],
                [t, x2, y2, x1, y2], [t, x1, y2, x1, y1]);
    }
    function seg(t, x1, y1, x2, y2) { segs.push([t, x1, y1, x2, y2]); }

    rect(90, 90, 1110, 790, 'brick');             // 外墙
    seg('brick', 90, 430, 470, 430);              // 左上房间
    seg('brick', 470, 90, 470, 430);
    seg('wood', 470, 200, 470, 320);
    seg('glass', 200, 90, 380, 90);
    seg('glass', 700, 90, 900, 90);

    seg('brick', 700, 430, 1110, 430);            // 右上房间
    seg('brick', 700, 90, 700, 430);
    seg('wood', 700, 180, 700, 300);

    seg('brick', 90, 610, 520, 610);              // 左下房间
    seg('concrete', 520, 430, 520, 610);
    seg('wood', 300, 610, 400, 610);

    seg('brick', 700, 610, 1110, 610);            // 右下大厅
    seg('glass', 800, 790, 1000, 790);
    seg('concrete', 560, 640, 560, 760);

    p.obstacles = segs.map(function (s) {
      return WS.makeObstacle(s[0], s[1], s[2], s[3], s[4]);
    });

    function mkAp(mount, x, y, az, name) {
      var a = WS.makeAp(mount, x, y, 1);
      a.name = name;
      if (az != null) a.azimuth = az;
      return a;
    }
    p.aps = [
      mkAp('ceiling', 280, 260, 0, 'AP-1'),
      mkAp('ceiling', 900, 260, 0, 'AP-2'),
      mkAp('wall', 560, 520, 90, 'WAP-1'),
      mkAp('panel', 250, 700, 270, 'PAP-1')
    ];

    applyDoc(WS.wrapDoc(p));
    S.layers.beam = true;
    S.layers.heat = true;
    S.showHeat = true;
    el.layBeam.checked = true;
    setMode('device');
    syncLayerUI();
    tip('已载入示例布局，拖动 AP 即可看热力图实时变化');
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 桌面版会弹原生「另存为」对话框，用户可能停留很久；
    // 60 秒后再释放，避免对话框未关闭时 blob 已被回收导致写出 0 字节
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* 保存结果提示：桌面版等主进程回调，浏览器版直接提示 */
  function notifySaved(msg) {
    if (window.wsDesktop) return;
    tip(msg);
  }

  /* ============================================================
     导出
     ============================================================ */
  function exportMenu() {
    dialog({
      title: '导出',
      body: '<p style="margin-bottom:14px">选择要导出的内容：</p>' +
        '<div style="display:flex;flex-direction:column;gap:9px">' +
        '<button class="btn-s" id="expPng" style="text-align:left;padding:11px 14px">' +
        '<b style="color:var(--txt);display:block;margin-bottom:3px">导出热力图 PNG</b>' +
        '<span style="font-size:11px;color:var(--txt-3)">底图 + 热力图 + 障碍物 + 设备，可直接放进方案文档</span></button>' +
        '<button class="btn-s" id="expJson" style="text-align:left;padding:11px 14px">' +
        '<b style="color:var(--txt);display:block;margin-bottom:3px">另存为项目文件 (.json)…</b>' +
        '<span style="font-size:11px;color:var(--txt-3)">另选路径存一份副本（Ctrl+Shift+S）；日常保存按 Ctrl+S 直接覆盖上次的文件</span></button>' +
        '<button class="btn-s" id="expCsv" style="text-align:left;padding:11px 14px">' +
        '<b style="color:var(--txt);display:block;margin-bottom:3px">导出设备清单 (.csv)</b>' +
        '<span style="font-size:11px;color:var(--txt-3)">AP 名称、安装方式、功率、位置坐标</span></button>' +
        '</div>',
      buttons: [{ label: '关闭', cls: 'btn-s' }]
    });
    setTimeout(function () {
      var b1 = document.getElementById('expPng');
      var b2 = document.getElementById('expJson');
      var b3 = document.getElementById('expCsv');
      if (b1) b1.onclick = function () { closeModal(); exportPng(); };
      if (b2) b2.onclick = function () { closeModal(); saveProject(true); };
      if (b3) b3.onclick = function () { closeModal(); exportCsv(); };
    }, 20);
  }

  function exportPng() {
    var p = S.project;
    var pad = 0;
    var scale = Math.min(1, 3000 / Math.max(p.imgW, p.imgH));
    var w = Math.round(p.imgW * scale), h = Math.round(p.imgH * scale);

    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.scale(scale, scale);

    if (S.imgEl) { try { g.drawImage(S.imgEl, 0, 0, p.imgW, p.imgH); } catch (e) {} }

    if (S.heatCanvas && S.showHeat) {
      g.save();
      g.globalAlpha = 0.8;
      g.imageSmoothingEnabled = true;
      g.drawImage(S.heatCanvas, 0, 0, p.imgW, p.imgH);
      g.restore();
    }

    // 障碍物
    var mpp = p.mpp || 0.05;
    p.obstacles.forEach(function (o) {
      var cfg = WS.obCfg(o.type);
      var lw = Math.max((o.thick || 0.15) / mpp, 2 / scale);
      g.beginPath(); g.moveTo(o.x1, o.y1); g.lineTo(o.x2, o.y2);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = lw + 2 / scale; g.setLineDash([]); g.stroke();
      g.beginPath(); g.moveTo(o.x1, o.y1); g.lineTo(o.x2, o.y2);
      g.strokeStyle = cfg.color; g.lineWidth = lw;
      if (cfg.dash && cfg.dash.length) g.setLineDash(cfg.dash.map(function (d) { return d / scale; }));
      g.stroke(); g.setLineDash([]);
    });

    // AP
    p.aps.forEach(function (ap) {
      var cfg = WS.AP_PRESETS[ap.mount] || WS.AP_PRESETS.ceiling;
      g.beginPath(); g.arc(ap.x, ap.y, 9 / scale, 0, TAU);
      g.fillStyle = 'rgba(9,15,22,.9)'; g.fill();
      g.strokeStyle = cfg.color; g.lineWidth = 2 / scale; g.stroke();
      g.beginPath(); g.arc(ap.x, ap.y, 3.4 / scale, 0, TAU);
      g.strokeStyle = cfg.color; g.lineWidth = 1.5 / scale; g.stroke();

      g.font = '600 ' + (11 / scale) + 'px "Microsoft YaHei UI",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'top';
      var tw = g.measureText(ap.name).width;
      g.fillStyle = 'rgba(9,15,22,.78)';
      roundRectPath(g, ap.x - tw / 2 - 5 / scale, ap.y + 12 / scale, tw + 10 / scale, 15 / scale, 4 / scale);
      g.fill();
      g.fillStyle = cfg.color;
      g.fillText(ap.name, ap.x, ap.y + 14 / scale);
    });

    // 图例
    drawExportLegend(g, w / scale, h / scale, scale);
    // 比例尺
    drawExportScale(g, h / scale, scale);

    c.toBlob(function (blob) {
      var name = (p.name || '勘波').replace(/[\\/:*?"<>|]/g, '_');
      downloadBlob(blob, name + '-热力图.png');
      notifySaved('热力图已导出');
    }, 'image/png');
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawExportLegend(g, w, h, scale) {
    var pad = 14 / scale;
    var rowH = 17 / scale;
    var boxW = 168 / scale;
    var boxH = (28 + WS.BANDS.length * 17) / scale;
    var x = w - boxW - pad, y = pad;

    g.fillStyle = 'rgba(255,255,255,.94)';
    roundRectPath(g, x, y, boxW, boxH, 6 / scale);
    g.fill();
    g.strokeStyle = 'rgba(30,50,80,.22)';
    g.lineWidth = 1 / scale;
    g.stroke();

    g.fillStyle = '#5a6c80';
    g.font = (10 / scale) + 'px "Microsoft YaHei UI",sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('信号强度 (dBm)', x + 10 / scale, y + 14 / scale);

    for (var i = 0; i < WS.BANDS.length; i++) {
      var b = WS.BANDS[i];
      var ry = y + (26 + i * 17) / scale;
      g.fillStyle = b.hex;
      roundRectPath(g, x + 10 / scale, ry, 26 / scale, 9 / scale, 2 / scale);
      g.fill();
      g.fillStyle = '#1b2530';
      g.font = (10.5 / scale) + 'px "Microsoft YaHei UI",sans-serif';
      g.fillText(b.name, x + 44 / scale, ry + 4.5 / scale);
      g.fillStyle = '#8a99a9';
      g.textAlign = 'right';
      var txt = (i === WS.BANDS.length - 1) ? ('≥ ' + Math.max(b.min, curMinRssi())) : ('≥ ' + b.min);
      g.fillText(txt, x + boxW - 10 / scale, ry + 4.5 / scale);
      g.textAlign = 'left';
    }
  }

  function drawExportScale(g, h, scale) {
    var p = S.project;
    var mpp = p.mpp || 0.05;
    var pxPerM = 1 / mpp;
    var cands = [0.5, 1, 2, 5, 10, 20, 50];
    var meters = cands[0];
    for (var i = 0; i < cands.length; i++) {
      if (cands[i] * pxPerM * scale <= 170 && cands[i] * pxPerM * scale >= 40) { meters = cands[i]; break; }
    }
    var len = meters * pxPerM;
    var x0 = 16 / scale, y0 = h - 26 / scale;

    g.fillStyle = 'rgba(255,255,255,.94)';
    roundRectPath(g, x0 - 8 / scale, y0 - 22 / scale, len + 16 / scale, 32 / scale, 5 / scale);
    g.fill();
    g.strokeStyle = 'rgba(30,50,80,.22)'; g.lineWidth = 1 / scale; g.stroke();

    for (var k = 0; k < 4; k++) {
      g.fillStyle = k % 2 === 0 ? '#1b2530' : '#ffffff';
      g.fillRect(x0 + k * len / 4, y0 - 5 / scale, len / 4, 5 / scale);
      g.strokeStyle = '#1b2530'; g.lineWidth = 1 / scale;
      g.strokeRect(x0 + k * len / 4, y0 - 5 / scale, len / 4, 5 / scale);
    }
    g.fillStyle = '#1b2530';
    g.font = '600 ' + (11 / scale) + 'px "Microsoft YaHei UI",sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(meters + ' m', x0, y0 - 9 / scale);
  }

  function exportCsv() {
    var p = S.project;
    var mpp = p.mpp || 0.05;
    /* 单元格转义：AP 名称里带逗号 / 引号 / 换行时，Excel 会错列 */
    function cell(v) {
      var t = (v == null) ? '' : String(v);
      return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    }
    /* 文本单元格：Excel 会把 = + - @ 开头的值当公式执行（CSV 注入 / CWE-1236），
       前面垫一个单引号强制按文本处理；数值列不走这里，避免负数被改坏 */
    function txt(v) {
      var t = (v == null) ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return cell(t);
    }
    var lines = ['名称,安装方式,发射功率(dBm),天线增益(dBi),朝向(°),安装高度(m),X(m),Y(m),半径参考(m)'];
    p.aps.forEach(function (a) {
      var cfg = WS.AP_PRESETS[a.mount] || WS.AP_PRESETS.ceiling;
      lines.push([
        txt(a.name), txt(cfg.label), a.power, a.gain,
        a.mount === 'ceiling' ? '-' : a.azimuth,
        WS.apHeight(a, p.settings),
        WS.round(a.x * mpp, 2), WS.round(a.y * mpp, 2),
        a.mount === 'ceiling' ? WS.round(WS.apHeight(a, p.settings) - p.settings.rxHeight, 2) : '-'
      ].map(cell).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var name = (p.name || '勘波').replace(/[\\/:*?"<>|]/g, '_');
    downloadBlob(blob, name + '-设备清单.csv');
    notifySaved('设备清单已导出');
  }

  /* ============================================================
     热力图
     ============================================================ */
  function scheduleHeat(delay, quality) {
    clearTimeout(heatTimer);
    heatTimer = setTimeout(function () {
      rebuildHeat(quality || 'draft');
    }, delay == null ? 90 : delay);
  }

  /* quality: 'draft' → 拖动时的快速预览；'normal' / 'high' → 静止后的精细渲染 */
  function rebuildHeat(quality) {
    var p = S.project;
    if (!p.aps.length) {
      S.heat = null;
      S.heatCanvas = null;
      S.heatDirty = false;
      WS.requestDraw();
      updateStats();
      return;
    }

    /* 热力图不可见时不做无用功 —— 这是「放一个 AP 卡一下」的根因：
       实测 26 台 AP / 188 段墙的项目，单次完整计算要 1.9~7.6 s，
       而此刻画面上根本不显示热力图。先记脏，等真正打开热力图时再算。 */
    if (!S.layers.heat || !S.showHeat) {
      S.heatDirty = true;
      updateStats();
      WS.requestDraw();
      return;
    }
    S.heatDirty = false;

    var q = quality || 'normal';
    var heat = WS.computeHeat(p, q);
    S.heat = heat;
    /* 直接渲染到图纸全分辨率，只做一次插值 —— 这是消除模糊和方块感的关键 */
    S.heatCanvas = heat.empty ? null : WS.heatToCanvas(heat, curMinRssi(), p.imgW, p.imgH);
    WS.requestDraw();
    updateStats();

    /* 几何/射频变了，重叠区也要跟着重算（仅在图层打开时） */
    if (S.layers.overlap) scheduleOverlap(80);

    /* 草稿质量渲染完成后，空闲时自动补一张精细版。
       大项目精修一次要数秒（150k 格 × N 台 AP × M 段墙），
       若仍按 260 ms 排，用户刚放下 AP 就会被这一拍打断 —— 规模大就多等一会。 */
    clearTimeout(heatFinalTimer);
    if (q === 'draft') {
      var bigProject = (heat.gw * heat.gh > 60000) || p.aps.length > 12;
      heatFinalTimer = setTimeout(function () {
        if (!S.drag) rebuildHeat('normal');
      }, bigProject ? 1300 : 260);
    }
  }

  /* ------------------------------------------------------------
     同频重叠层：只在图层打开时计算，几何/阈值变化后防抖重算
     ------------------------------------------------------------ */
  var ovTimer = null;

  function scheduleOverlap(delay) {
    clearTimeout(ovTimer);
    ovTimer = setTimeout(function () { rebuildOverlap(); }, delay == null ? 120 : delay);
  }

  function rebuildOverlap() {
    var p = S.project;
    if (!S.layers.overlap) {
      S.overlap = null;
      S.overlapPolys = null;
      WS.requestDraw();
      updateOverlapStat();
      return;
    }
    if (!p.aps.length) {
      S.overlap = null;
      S.overlapPolys = null;
      WS.requestDraw();
      updateOverlapStat();
      return;
    }
    var g = WS.computeOverlap(p, p.settings.overlapThr, 'draft');
    S.overlap = g;
    S.overlapPolys = g.empty ? null : WS.contour(g);
    WS.requestDraw();
    updateOverlapStat();
  }

  function updateOverlapStat() {
    if (!el.ovStat) return;
    if (!S.layers.overlap) {
      el.ovStat.textContent = '勾选后计算：仅同信道、且两侧都高于阈值的区域';
      return;
    }
    if (!S.overlap || S.overlap.empty) {
      el.ovStat.textContent = '未发现同频重叠区（信道不同，或信号未达阈值）';
      return;
    }
    var mpp = S.project.mpp || 0.05;
    var area = S.overlap.count * Math.pow(S.overlap.cell * mpp, 2);
    el.ovStat.textContent = '重叠 ' + WS.round(area, 1) + ' m² · ' +
      (S.overlapPolys ? S.overlapPolys.length : 0) + ' 处轮廓';
  }

  function rebuildHeatCanvasOnly() {
    if (S.heat && !S.heat.empty) {
      var p = S.project;
      S.heatCanvas = WS.heatToCanvas(S.heat, curMinRssi(), p.imgW, p.imgH);
    }
    WS.requestDraw();
    updateStats();
  }

  /* ============================================================
     统计 / 图例
     ============================================================ */
  function updateStats() {
    var p = S.project;
    if (el.stApCount) el.stApCount.textContent = p.aps.length + ' 台';

    var stat = null;
    /* heatDirty = 几何变过但热力图没重算，此时显示旧统计会误导，直接留空 */
    if (S.heat && !S.heat.empty && !S.heatDirty) stat = WS.coverageStats(p, S.heat);

    if (el.stCover) el.stCover.textContent = stat ? WS.round(stat.coveredArea, 0) + ' m²' : '—';

    if (el.stGood) {
      if (stat) {
        var good = stat.counts[0] + stat.counts[1] + stat.counts[2];
        el.stGood.textContent = WS.round(good / stat.totalCount * 100, 1) + '%';
        el.stWeak.textContent = WS.round(100 - stat.pct, 1) + '%';
      } else {
        el.stGood.textContent = '—';
        el.stWeak.textContent = '—';
      }
    }

    if (el.bandStats) {
      var html = '';
      var total = stat ? stat.totalCount : 0;
      WS.BANDS.forEach(function (b, i) {
        var cnt = stat ? stat.counts[i] : 0;
        var pct = total ? (cnt / total * 100) : 0;
        var dim = stat && b.min < curMinRssi();
        html += '<div class="band-row"' + (dim ? ' style="opacity:.45"' : '') + '>' +
          '<span class="band-chip" style="background:' + b.hex + '"></span>' +
          '<span class="band-name">' + b.name + '</span>' +
          '<span class="band-track"><span class="band-fill" style="width:' + pct.toFixed(1) + '%;background:' + b.hex + '"></span></span>' +
          '<span class="band-pct">' + pct.toFixed(0) + '%</span>' +
          '</div>';
      });
      el.bandStats.innerHTML = html;
    }
  }

  /* 颜色数组 → CSS 颜色串 */
  function rgbCss(c) {
    if (!c) return '#7a8698';
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  function buildLegend() {
    var th = curMinRssi();
    var html = '';
    for (var i = 0; i < WS.BANDS.length; i++) {
      var b = WS.BANDS[i];
      var next = (i + 1 < WS.BANDS.length) ? WS.BANDS[i + 1].min : null;
      var rangeTxt = (next !== null) ? (b.min + ' ~ ' + next) : ('≥ ' + b.min);
      // 该档中最强的信号仍低于门限 → 整档不达标，淡显
      var dim = (b.min < th);
      /* 色块用该档「强端 → 弱端」的渐变，与画面上的连续色标一致；
         相邻两行在交界处取同一个值，颜色自然接上，不再是一排纯色块 */
      var hi = (i === 0) ? (b.min + 10) : WS.BANDS[i - 1].min;
      var cHi = rgbCss(WS.heatColorAt(hi));
      var cLo = rgbCss(WS.heatColorAt(b.min));
      html += '<div class="legend-row"' + (dim ? ' style="opacity:.42"' : '') + '>' +
        '<i style="background:linear-gradient(90deg,' + cHi + ' 0%,' + cLo + ' 100%)"></i>' +
        '<span>' + b.name + '</span><b>' + rangeTxt + '</b></div>';
    }
    if (S.layers.overlap) {
      html += '<div class="legend-row" style="margin-top:5px;padding-top:6px;border-top:1px solid var(--line)">' +
        '<i class="lg-hatch"></i><span>同频重叠</span><b>≥2 台同信道</b></div>';
    }
    el.legendItems.innerHTML = html;

    var title = document.querySelector('.legend-title');
    if (title) title.textContent = '信号强度 dBm · 门限 ' + th;
  }

  /* ============================================================
     属性面板
     ============================================================ */
  function currentSel() {
    if (!S.sel) return null;
    return S.sel.kind === 'ap' ? WS.findAp(S.sel.id) : WS.findOb(S.sel.id);
  }

  function bindInspector() {
    el.inspBody.addEventListener('input', function (e) {
      var t = e.target;

      /* 批量输入框：作用于当前选择集全部对象 */
      if (t.dataset.batch) {
        var v0 = parseFloat(t.value);
        if (!isFinite(v0)) return;
        var list0 = selectedObjects(S.selKind);
        if (!list0.length) return;
        if (t.dataset.batch === 'power') {
          list0.forEach(function (a) { a.power = v0; });
        }
        scheduleHeat(200);
        return;
      }

      if (!t.dataset.k) return;
      var obj = currentSel();
      if (!obj) return;
      /* 信道 / 频宽下拉：空字符串表示「跟随项目」 */
      if (t.dataset.k === 'channel' || t.dataset.k === 'bw') {
        obj[t.dataset.k] = (t.value === '') ? null : parseInt(t.value, 10);
        rebuildHeat();
        renderInspector();
        WS.requestDraw();
        return;
      }
      var k = t.dataset.k;
      var v;
      if (t.type === 'number') v = parseFloat(t.value);
      else if (t.type === 'checkbox') v = t.checked;
      else v = t.value;
      if (t.type === 'number' && !isFinite(v)) return;
      // 厚度按毫米输入，内部统一存米
      if (k === 'thickMM') {
        obj.thick = v / 1000;
        /* 自动模式：把重算后的衰减写回数据，保证存档与界面一致 */
        if (obj.autoAtten) {
          var c2 = WS.obCfg(obj.type);
          obj.atten24 = WS.attenFor(c2, obj.thick, false);
          obj.atten5 = WS.attenFor(c2, obj.thick, true);
          renderInspector();
        }
        rebuildHeat();
        return;
      }
      obj[k] = v;

      if (k === 'atten24' || k === 'atten5' || k === 'thick') {
        rebuildHeat();
      } else if (k === 'x' || k === 'y') {
        WS.requestDraw();
        rebuildHeat();
      } else {
        scheduleHeat(90);
      }
      if (k === 'name') { WS.requestDraw(); updateStatus(); }
      if (k === 'azimuth') updateAzimDial(v);
      if (k === 'height') { WS.requestDraw(); scheduleHeat(60); }
    });

    el.inspBody.addEventListener('change', function (e) {
      if (e.target.dataset.k || e.target.dataset.batch) pushHistory();
    });

    el.inspBody.addEventListener('click', function (e) {
      var mountBtn = e.target.closest('[data-mount]');
      if (mountBtn) {
        var m = mountBtn.dataset.mount;
        var aps = selectedObjects('ap');
        var changedM = false;
        aps.forEach(function (ap) {
          if (ap.mount !== m) { applyMount(ap, m); changedM = true; }
        });
        if (changedM) {
          renderInspector();
          rebuildHeat();
          pushHistory();
          WS.requestDraw();
          if (aps.length > 1) tip('已把 ' + aps.length + ' 台 AP 改为「' + WS.AP_PRESETS[m].label + '」', 2600);
        }
        return;
      }
      var typeBtn = e.target.closest('[data-obtype]');
      if (typeBtn) {
        var key = WS.obTypeKey(typeBtn.dataset.obtype);
        var ocfg = WS.obCfg(key);
        var obs = selectedObjects('ob');
        var changedO = false;
        obs.forEach(function (o) {
          if (o.type !== key) {
            o.type = key;
            o.atten24 = ocfg.atten24;
            o.atten5 = ocfg.atten5;
            o.thick = ocfg.thick;
            changedO = true;
          }
        });
        if (changedO) {
          renderInspector();
          rebuildHeat();
          pushHistory();
          WS.requestDraw();
          if (obs.length > 1) tip('已把 ' + obs.length + ' 段墙改为「' + ocfg.label + '」', 2600);
        }
        return;
      }
      var clearBtn = e.target.closest('[data-act="clear"]');
      if (clearBtn) {
        clearSelection();
        renderInspector();
        WS.requestDraw();
        tip('已取消选择');
        return;
      }
      var delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        if (delBtn.dataset.del === 'batch') deleteSelection();
        else if (delBtn.dataset.del === 'ap') removeAp(delBtn.dataset.id);
        else removeOb(delBtn.dataset.id);
        return;
      }
      var pickBtn = e.target.closest('[data-pick]');
      if (pickBtn) {
        setSelection(pickBtn.dataset.pick, [pickBtn.dataset.id]);
        renderInspector();
        WS.requestDraw();
        return;
      }
      var attenBtn = e.target.closest('[data-toggle="atten"]');
      if (attenBtn) {
        var ob = currentSel();
        if (ob && ob.type) {
          var toAuto = ob.autoAtten === false;
          ob.autoAtten = toAuto;
          var c3 = WS.obCfg(ob.type);
          ob.atten24 = WS.attenFor(c3, ob.thick, false);
          ob.atten5 = WS.attenFor(c3, ob.thick, true);
          renderInspector();
          rebuildHeat();
          pushHistory();
          WS.requestDraw();
          tip(toAuto ? '已改为按厚度自动计算衰减' : '已改为手动指定衰减（当前厚度对应 ' +
            ob.atten24 + ' / ' + ob.atten5 + ' dB）');
        }
        return;
      }

      var togBtn = e.target.closest('[data-toggle="enable"]');
      if (togBtn) {
        /* 多选时批量启停，单选时切换自身 */
        var targets = S.selIds.length > 1
          ? selectedObjects('ap')
          : [currentSel()].filter(Boolean);
        if (targets.length) {
          var allOff = targets.every(function (o) { return o.enabled === false; });
          targets.forEach(function (o) { o.enabled = allOff ? true : false; });
          renderInspector();
          rebuildHeat();
          pushHistory();
          WS.requestDraw();
        }
        return;
      }
    });

    // 方位角圆盘旋钮
    el.inspBody.addEventListener('mousedown', function (e) {
      var dial = e.target.closest('.azim-dial');
      if (!dial) return;
      var ap = currentSel();
      if (!ap) return;
      e.preventDefault();
      var rect = dial.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      var move = function (ev) {
        var ang = Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) / D2R;
        if (ev.shiftKey) ang = Math.round(ang / 15) * 15;
        ap.azimuth = Math.round(((ang % 360) + 360) % 360);
        updateAzimDial(ap.azimuth);
        WS.requestDraw();
        scheduleHeat(70);
      };
      var up = function () {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        pushHistory();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      move(e);
    });
  }

  function updateAzimDial(deg) {
    var d = el.inspBody.querySelector('.azim-dial');
    if (d) d.style.setProperty('--az', deg + 'deg');
  }

  function applyMount(ap, mount) {
    var cfg = WS.AP_PRESETS[mount];
    ap.mount = mount;
    ap.power = cfg.power;
    ap.gain = cfg.gain;
    ap.hpbwH = cfg.hpbwH;
    ap.hpbwV = cfg.hpbwV;
    ap.fb = cfg.fb;
    ap.downtilt = cfg.downtilt;
    if (mount === 'ceiling') ap.azimuth = 0;
    else if (!ap.azimuth) ap.azimuth = 90;
    ap.height = null;
    var m = (ap.name || '').match(/^[A-Z]+/);
    var prefix = mount === 'ceiling' ? 'AP' : (mount === 'wall' ? 'WAP' : 'PAP');
    if (m && /^(AP|WAP|PAP)$/.test(m[0])) ap.name = prefix + (ap.name.match(/\d+$/) ? '-' + ap.name.match(/\d+$/)[0] : '');
  }

  function renderInspector() {
    var p = S.project;

    /* 多选：进入批量编辑面板 */
    if (S.selIds.length > 1) { renderBatchInspector(); return; }

    var obj = currentSel();

    if (!obj) {
      el.inspTitle.textContent = '项目概览';
      el.inspBadge.textContent = S.mode === 'plan' ? '平面' : '设备';
      el.inspBadge.style.color = '';
      el.inspBody.innerHTML = overviewHtml();
      bindOverview();
      return;
    }

    if (S.sel.kind === 'ap') {
      el.inspTitle.textContent = '无线设备';
      el.inspBadge.textContent = (WS.AP_PRESETS[obj.mount] || {}).short || 'AP';
      el.inspBadge.style.color = (WS.AP_PRESETS[obj.mount] || {}).color;
      el.inspBody.innerHTML = apHtml(obj);
      updateAzimDial(obj.azimuth || 0);
    } else {
      el.inspTitle.textContent = '障碍物';
      var cfg = WS.obCfg(obj.type);
      el.inspBadge.textContent = cfg.label;
      el.inspBadge.style.color = cfg.color;
      el.inspBody.innerHTML = obHtml(obj);
    }
  }

  /* 当前楼宇 · 楼层 的短标签 */
  function floorLabel() {
    if (!S.doc) return '—';
    var b = WS.findBuilding(S.doc, S.doc.activeBuilding);
    var f = WS.activeFloor(S.doc);
    return (b ? b.name : '—') + ' · ' + (f ? f.name : '—');
  }

  function overviewHtml() {
    var p = S.project;
    var mpp = p.mpp || 0.05;
    var wM = WS.round(p.imgW * mpp, 1);
    var hM = WS.round(p.imgH * mpp, 1);
    var counts = { brick: 0, concrete: 0, glass: 0, wood: 0, custom: 0 };
    p.obstacles.forEach(function (o) {
      var k = WS.obTypeKey(o.type);
      counts[k] = (counts[k] || 0) + 1;
    });

    var html = '';
    html += '<div class="ig"><div class="ig-title">项目</div>' +
      '<div class="kv"><span>项目</span><b>' + escapeHtml((S.doc && S.doc.name) || p.name) + '</b></div>' +
      '<div class="kv"><span>楼层</span><b>' + escapeHtml(floorLabel()) + '</b></div>' +
      '<div class="kv"><span>图纸尺寸</span><b>' + p.imgW + ' × ' + p.imgH + ' px</b></div>' +
      '<div class="kv"><span>实际范围</span><b>' + wM + ' × ' + hM + ' m</b></div>' +
      '<div class="kv"><span>比例尺</span><b>' + WS.round(mpp * 100, 2) + ' cm/px</b></div>' +
      '<div class="kv"><span>标定状态</span><b style="color:' + (p.calibrated ? 'var(--ok)' : 'var(--warn)') + '">' +
        (p.calibrated ? '已标定' : '未标定（使用默认值）') + '</b></div>' +
      '</div>';

    html += '<div class="ig"><div class="ig-title">障碍物统计</div>' +
      '<div class="kv"><span>砖墙</span><b>' + counts.brick + ' 段</b></div>' +
      '<div class="kv"><span>混凝土</span><b>' + counts.concrete + ' 段</b></div>' +
      '<div class="kv"><span>玻璃窗</span><b>' + counts.glass + ' 段</b></div>' +
      '<div class="kv"><span>木门</span><b>' + counts.wood + ' 段</b></div>' +
      '</div>';

    if (p.aps.length) {
      html += '<div class="ig"><div class="ig-title">设备列表</div><div class="obj-list">';
      p.aps.forEach(function (a) {
        var c = WS.AP_PRESETS[a.mount] || WS.AP_PRESETS.ceiling;
        html += '<div class="obj-item">' +
          '<span class="obj-dot" style="background:' + c.color + '"></span>' +
          '<span class="obj-name">' + escapeHtml(a.name) + '</span>' +
          '<span class="obj-meta">' + c.short + '</span>' +
          '<button class="obj-del" data-del="ap" data-id="' + a.id + '" title="删除">×</button>' +
          '</div>';
      });
      html += '</div></div>';
    } else {
      html += '<div class="insp-empty" style="padding:20px 0">还没有放置无线设备<br>' +
        '<i>切换到「设备编辑」模式，在图上点击放置 AP</i></div>';
    }

    return html;
  }

  function bindOverview() {
    // 设备列表点击选中
    Array.prototype.forEach.call(el.inspBody.querySelectorAll('.obj-item'), function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-del]')) return;
        var btn = row.querySelector('[data-del]');
        if (btn) {
          setSelection('ap', [btn.dataset.id]);
          renderInspector();
          WS.requestDraw();
        }
      });
    });
  }

  /* ============================================================
     批量编辑面板（框选出多个对象后显示）
     ============================================================ */
  function renderBatchInspector() {
    var sc = scopeOfMode();
    var n = S.selIds.length;
    el.inspTitle.textContent = '批量编辑 · ' + sc.label;
    el.inspBadge.textContent = n + ' ' + sc.unit;
    el.inspBadge.style.color = '';
    el.inspBody.innerHTML = sc.kind === 'ap' ? batchApHtml(n) : batchObHtml(n);
  }

  function batchObHtml(n) {
    var list = selectedObjects('ob');
    var counts = { brick: 0, concrete: 0, glass: 0, wood: 0, custom: 0 };
    list.forEach(function (o) { counts[WS.obTypeKey(o.type)] = (counts[WS.obTypeKey(o.type)] || 0) + 1; });
    var types = list.map(function (o) { return WS.obTypeKey(o.type); });
    var common = types.every(function (t) { return t === types[0]; }) ? types[0] : null;

    var html = '<div class="batch-badge"><b>' + n + '</b> 段墙体已选中</div>';
    html += '<div class="batch-scope">框选范围：<b>仅墙体</b> —— 平面编辑模式只允许框选墙体，' +
      '画布上的 AP 不会被一起选中。</div>';

    html += '<div class="ig"><div class="ig-title">类型分布</div>';
    [['brick', '砖墙'], ['concrete', '混凝土'], ['glass', '玻璃窗'], ['wood', '木门'], ['custom', '自定义']]
      .forEach(function (t) {
        if (!counts[t[0]]) return;
        html += '<div class="kv"><span>' + t[1] + '</span><b>' + counts[t[0]] + ' 段</b></div>';
      });
    html += '</div>';

    html += '<div class="ig"><div class="ig-title">批量改材质</div><div class="type-pills">';
    ['brick', 'concrete', 'glass'].forEach(function (k) {
      html += '<button class="pill' + (common === k ? ' on' : '') + '" data-obtype="' + k + '">' +
        WS.obCfg(k).label + '</button>';
    });
    html += '</div><div class="type-pills" style="grid-template-columns:1fr 1fr">';
    ['wood', 'custom'].forEach(function (k) {
      html += '<button class="pill' + (common === k ? ' on' : '') + '" data-obtype="' + k + '">' +
        WS.obCfg(k).label + '</button>';
    });
    html += '</div><div class="hint">会同时把这几段的 2.4G / 5G 衰减与厚度重置为该材质的预设值。</div></div>';

    html += '<div class="ig"><div class="ig-title">操作</div><div class="frow">' +
      '<button class="mini-btn wide" data-act="clear">取消框选</button>' +
      '<button class="mini-btn danger" data-del="batch">删除这 ' + n + ' 段</button>' +
      '</div><div class="hint">在画布上按住其中任意一段拖动，可整体平移这 ' + n + ' 段；按 Ctrl+Z 可撤销。</div></div>';

    return html;
  }

  function batchApHtml(n) {
    var list = selectedObjects('ap');
    var counts = { ceiling: 0, wall: 0, panel: 0 };
    list.forEach(function (a) { counts[a.mount] = (counts[a.mount] || 0) + 1; });
    var mounts = list.map(function (a) { return a.mount; });
    var common = mounts.every(function (m) { return m === mounts[0]; }) ? mounts[0] : null;
    var allOff = list.every(function (a) { return a.enabled === false; });
    var pw = list.length ? list[0].power : 20;

    var html = '<div class="batch-badge"><b>' + n + '</b> 台 AP 已选中</div>';
    html += '<div class="batch-scope">框选范围：<b>仅 AP</b> —— 设备编辑模式只允许框选 AP，' +
      '墙体不会被一起选中。</div>';

    html += '<div class="ig"><div class="ig-title">安装方式分布</div>';
    [['ceiling', '吸顶全向'], ['wall', '壁挂定向'], ['panel', '面板入墙']].forEach(function (t) {
      if (!counts[t[0]]) return;
      html += '<div class="kv"><span>' + t[1] + '</span><b>' + counts[t[0]] + ' 台</b></div>';
    });
    html += '</div>';

    html += '<div class="ig"><div class="ig-title">批量改安装方式</div><div class="type-pills">';
    ['ceiling', 'wall', 'panel'].forEach(function (k) {
      html += '<button class="pill' + (common === k ? ' on' : '') + '" data-mount="' + k + '">' +
        WS.AP_PRESETS[k].short + '</button>';
    });
    html += '</div><div class="hint">会按所选安装方式重置功率、波瓣、前后比与安装高度。</div></div>';

    html += '<div class="ig"><div class="ig-title">批量射频</div>' +
      '<div class="field"><label>发射功率（应用于全部）</label><div class="frow">' +
      '<input type="number" data-batch="power" min="1" max="33" step="0.5" value="' + pw + '">' +
      '<span class="unit">dBm</span></div></div>' +
      '<div class="hint">输入后立即应用到全部 ' + n + ' 台，热力图会在松开输入框后重算一次。</div></div>';

    html += '<div class="ig"><div class="ig-title">操作</div><div class="frow">' +
      '<button class="mini-btn wide" data-toggle="enable">' + (allOff ? '全部启用' : '全部停用') + '</button>' +
      '<button class="mini-btn" data-act="clear">取消框选</button>' +
      '</div><div class="frow" style="margin-top:6px">' +
      '<button class="mini-btn danger" style="flex:1" data-del="batch">删除这 ' + n + ' 台</button>' +
      '</div><div class="hint">在画布上按住其中任意一台拖动，可整体平移这 ' + n + ' 台；按 Ctrl+Z 可撤销。</div></div>';

    return html;
  }

  function apHtml(ap) {
    var cfg = WS.AP_PRESETS[ap.mount] || WS.AP_PRESETS.ceiling;
    var p = S.project;
    var mpp = p.mpp || 0.05;
    var rank = apRank(ap);
    var cr = apCoverRadius(ap);

    var html = '';
    html += '<div class="type-pills">';
    ['ceiling', 'wall', 'panel'].forEach(function (k) {
      html += '<button class="pill' + (ap.mount === k ? ' on' : '') + '" data-mount="' + k + '">' +
        WS.AP_PRESETS[k].short + '</button>';
    });
    html += '</div>';

    html += '<div class="desc">' + cfg.desc + '</div>';

    html += '<div class="ig"><div class="ig-title">基本</div>' +
      '<div class="field"><label>设备名称</label><div class="frow">' +
      '<input type="text" data-k="name" value="' + escapeAttr(ap.name) + '"></div></div>' +
      '<div class="kv"><span>信号排名</span><b>' + rank + '</b></div>' +
      '<div class="kv"><span>坐标</span><b>' + WS.round(ap.x * mpp, 2) + ', ' + WS.round(ap.y * mpp, 2) + ' m</b></div>' +
      '<div class="kv"><span>视距参考半径</span><b>' + (cr === null ? '&gt; 60 m' : cr + ' m') + '</b></div>' +
      '</div>';

    var rf = WS.apRf(ap, p.settings);
    var chList = WS.channelsOf(p.settings.band, p.settings.region);
    var bwList = WS.BANDS_INFO[p.settings.band].bws;
    var chOpts = '<option value=""' + (ap.channel == null ? ' selected' : '') + '>跟随项目</option>';
    for (var ci = 0; ci < chList.length; ci++) {
      var cc = chList[ci];
      chOpts += '<option value="' + cc + '"' + (ap.channel === cc ? ' selected' : '') + '>Ch.' + cc + '</option>';
    }
    var bwOpts = '<option value=""' + (ap.bw == null ? ' selected' : '') + '>跟随项目</option>';
    for (var bi = 0; bi < bwList.length; bi++) {
      bwOpts += '<option value="' + bwList[bi] + '"' + (ap.bw === bwList[bi] ? ' selected' : '') + '>' +
        bwList[bi] + ' MHz</option>';
    }
    html += '<div class="ig"><div class="ig-title">信道与频宽</div>' +
      '<div class="field-2">' +
      '<div class="field"><label>信道</label><div class="frow">' +
      '<select data-k="channel">' + chOpts + '</select></div></div>' +
      '<div class="field"><label>频宽</label><div class="frow">' +
      '<select data-k="bw">' + bwOpts + '</select></div></div>' +
      '</div>' +
      '<div class="kv"><span>实际占用</span><b>' + WS.rfLabel(rf) + '</b></div>' +
      '<div class="kv"><span>频率范围</span><b>' + rf.lo + '–' + rf.hi + ' MHz</b></div>' +
      '<div class="hint">默认跟随项目统一设置；个别 AP 需要错开信道时再单独指定。</div>' +
      '</div>';

    html += '<div class="ig"><div class="ig-title">射频参数</div>' +
      '<div class="field-2">' +
      '<div class="field"><label>发射功率</label><div class="frow">' +
      '<input type="number" data-k="power" min="1" max="33" step="0.5" value="' + ap.power + '"><span class="unit">dBm</span></div></div>' +
      '<div class="field"><label>天线增益</label><div class="frow">' +
      '<input type="number" data-k="gain" min="0" max="20" step="0.5" value="' + ap.gain + '"><span class="unit">dBi</span></div></div>' +
      '</div>' +
      '<div class="field-2">' +
      '<div class="field"><label>水平波瓣</label><div class="frow">' +
      '<input type="number" data-k="hpbwH" min="20" max="360" step="5" value="' + ap.hpbwH + '"><span class="unit">°</span></div></div>' +
      '<div class="field"><label>垂直波瓣</label><div class="frow">' +
      '<input type="number" data-k="hpbwV" min="15" max="180" step="5" value="' + ap.hpbwV + '"><span class="unit">°</span></div></div>' +
      '</div>' +
      (ap.mount !== 'ceiling' ?
        '<div class="field"><label>前后比</label><div class="frow">' +
        '<input type="number" data-k="fb" min="0" max="40" step="1" value="' + ap.fb + '"><span class="unit">dB</span></div></div>' : '') +
      '<div class="field"><label>安装高度</label><div class="frow">' +
      '<input type="number" data-k="height" min="0.3" max="15" step="0.1" value="' + WS.round(WS.apHeight(ap, p.settings), 2) + '">' +
      '<span class="unit">m</span></div></div>' +
      '</div>';

    if (ap.mount !== 'ceiling') {
      html += '<div class="ig"><div class="ig-title">朝向</div>' +
        '<div class="azim-row">' +
        '<div class="azim-dial" style="--az:' + (ap.azimuth || 0) + 'deg"></div>' +
        '<div style="flex:1">' +
        '<div class="field" style="margin:0"><div class="frow">' +
        '<input type="number" data-k="azimuth" min="0" max="359" step="1" value="' + (ap.azimuth || 0) + '">' +
        '<span class="unit">°</span></div></div>' +
        '<div class="hint" style="margin-top:5px">0° = 正上方，顺时针。也可拖动画布上的手柄。</div>' +
        '</div></div></div>';
    }

    html += '<div class="ig"><div class="ig-title">操作</div>' +
      '<div class="frow">' +
      '<button class="mini-btn wide" data-toggle="enable">' + (ap.enabled === false ? '启用此 AP' : '临时停用') + '</button>' +
      '<button class="mini-btn danger" data-del="ap" data-id="' + ap.id + '">删除</button>' +
      '</div></div>';

    return html;
  }

  function apRank(ap) {
    return '#' + (S.project.aps.indexOf(ap) + 1) + ' / ' + S.project.aps.length;
  }

  function apCoverRadius(ap) {
    var p = S.project;
    var P = WS.antennaParams(ap);
    var h = Math.max(0.25, WS.apHeight(ap, p.settings) - p.settings.rxHeight);
    var need = curMinRssi();
    var maxR = 60;
    for (var d = 0.5; d <= maxR; d += 0.5) {
      var hh = Math.sqrt(d * d + h * h);
      var loss = WS.fspl(hh, p.settings.freq, p.settings.pathLossN);
      var elev = Math.atan2(d, h);
      var cV = Math.cos(elev - P.peakElev);
      var vPat = P.hpbwV >= 359.5 ? 1 : (cV <= 0 ? 0.0001 : Math.pow(cV, P.nV));
      var grel = 10 * Math.log10(vPat + 1e-10);
      if (ap.power + ap.gain + grel - loss < need) return WS.round(d, 1);
    }
    return null;
  }

  function obHtml(o) {
    var p = S.project;
    var mpp = p.mpp || 0.05;
    var lenM = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * mpp;
    var a24 = WS.round(WS.obAtten(o, 2437), 1);
    var a5 = WS.round(WS.obAtten(o, 5180), 1);
    var thickMM = Math.round((o.thick || 0) * 1000);

    var html = '<div class="type-pills">';
    ['brick', 'concrete', 'glass'].forEach(function (k) {
      html += '<button class="pill' + (o.type === k ? ' on' : '') + '" data-obtype="' + k + '">' +
        WS.obCfg(k).label + '</button>';
    });
    html += '</div>';
    html += '<div class="type-pills" style="grid-template-columns:1fr 1fr">';
    ['wood', 'custom'].forEach(function (k) {
      html += '<button class="pill' + (o.type === k ? ' on' : '') + '" data-obtype="' + k + '">' +
        WS.obCfg(k).label + '</button>';
    });
    html += '</div>';

    html += '<div class="ig"><div class="ig-title">几何</div>' +
      '<div class="kv"><span>长度</span><b>' + WS.round(lenM, 2) + ' m</b></div>' +
      '<div class="kv"><span>起点</span><b>' + WS.round(o.x1 * mpp, 2) + ', ' + WS.round(o.y1 * mpp, 2) + '</b></div>' +
      '<div class="kv"><span>终点</span><b>' + WS.round(o.x2 * mpp, 2) + ', ' + WS.round(o.y2 * mpp, 2) + '</b></div>' +
      '</div>';

    var auto = o.autoAtten !== false;
    html += '<div class="ig"><div class="ig-title">衰减与厚度</div>' +
      '<div class="frow" style="margin-bottom:9px">' +
      '<button class="mini-btn wide' + (auto ? ' on' : '') + '" data-toggle="atten">' +
      (auto ? '✓ 按厚度自动计算' : '手动指定衰减') + '</button></div>';

    if (auto) {
      html += '<div class="kv"><span>2.4 GHz 衰减</span><b>' + a24 + ' dB</b></div>' +
        '<div class="kv"><span>5 GHz 衰减</span><b>' + a5 + ' dB</b></div>';
    } else {
      html += '<div class="field-2">' +
        '<div class="field"><label>2.4 GHz 衰减</label><div class="frow">' +
        '<input type="number" data-k="atten24" min="0" max="80" step="0.5" value="' + a24 + '">' +
        '<span class="unit">dB</span></div></div>' +
        '<div class="field"><label>5 GHz 衰减</label><div class="frow">' +
        '<input type="number" data-k="atten5" min="0" max="80" step="0.5" value="' + a5 + '">' +
        '<span class="unit">dB</span></div></div>' +
        '</div>';
    }

    html += '<div class="field"><label>墙体厚度</label><div class="frow">' +
      '<input type="number" data-k="thickMM" min="10" max="1500" step="10" value="' + thickMM + '">' +
      '<span class="unit">mm</span></div></div>';

    if (auto) {
      var cfgNow = WS.obCfg(o.type);
      html += '<div class="hint">自动模式：' + cfgNow.label + '每毫米衰减 ' +
        WS.round(cfgNow.rate24 * 1000, 1) + ' / ' + WS.round(cfgNow.rate5 * 1000, 1) +
        ' dB/m（2.4G / 5G），厚度一改衰减立刻跟着变。</div>';
    } else {
      html += '<div class="hint">手动模式：2.4G / 5G 各自独立取值，改厚度不影响衰减。</div>';
    }
    html += '</div>';

    html += '<div class="ig"><div class="ig-title">操作</div>' +
      '<div class="frow"><button class="mini-btn danger" style="flex:1" data-del="ob" data-id="' + o.id + '">删除此障碍物</button></div>' +
      '</div>';

    return html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ============================================================
     表单 / 图层
     ============================================================ */
  function buildRfOptions() {
    syncChannelOptions();
    syncBwOptions();
    syncRegionUI();
    syncRfHint();
  }

  /* 信道下拉：随频段 + 区域重建 */
  function syncChannelOptions() {
    var st = S.project.settings;
    var list = WS.channelsOf(st.band, st.region);
    if (list.indexOf(st.channel) < 0) st.channel = list[0];
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var ch = list[i];
      if (ch === 120 && st.region === 'AU') continue;
      html += '<option value="' + ch + '">Ch.' + ch + '</option>';
    }
    el.selChannel.innerHTML = html;
    el.selChannel.value = st.channel;
  }

  /* 频宽下拉：2.4G 只有 20/40，5G 才有 20/40/80/160 */
  function syncBwOptions() {
    var st = S.project.settings;
    var list = WS.BANDS_INFO[st.band].bws;
    if (list.indexOf(st.bw) < 0) st.bw = list[0];
    var html = '';
    for (var i = 0; i < list.length; i++) {
      html += '<option value="' + list[i] + '">' + list[i] + ' MHz</option>';
    }
    el.selBw.innerHTML = html;
    el.selBw.value = st.bw;
  }

  function syncRegionUI() {
    var st = S.project.settings;
    Array.prototype.forEach.call(el.segRegion.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.region === st.region);
    });
    var r = WS.regionOf(st.region);
    var e = WS.eirpLimit(st.region, st.freq);
    el.regionHint.textContent = r.full + (e ? (' · EIRP ≤ ' + e.dbm + ' dBm') : ' · 该频点无预设');
  }

  /* 当前信道的占用频段 + 区域功率上限 */
  function syncRfHint() {
    var st = S.project.settings;
    var rf = WS.apRf({ channel: st.channel, bw: st.bw, band: st.band }, st);
    var e = WS.eirpLimit(st.region, rf.mhz);
    el.rfHint.textContent = '占用 ' + rf.lo + '–' + rf.hi + ' MHz' +
      (e ? (' · 上限 EIRP ' + e.dbm + ' dBm' + (e.note ? '（' + e.note + '）' : '')) : '');
  }

  /* 区域切换时把超限的 AP 功率压回上限之内（EIRP = 功率 + 增益） */
  function clampPowersToRegion() {
    var st = S.project.settings;
    var n = 0, to = null;
    S.project.aps.forEach(function (ap) {
      var rf = WS.apRf(ap, st);
      var e = WS.eirpLimit(st.region, rf.mhz);
      if (!e) return;
      var maxPower = WS.round(e.dbm - (ap.gain || 0), 1);
      if (ap.power > maxPower) { ap.power = maxPower; n++; to = maxPower; }
    });
    return { n: n, to: to };
  }

  /* 射频参数变化后的统一收尾 */
  function applyRfChange(msg) {
    var st = S.project.settings;
    st.freq = WS.chMhz(st.band, st.channel);
    if (st.autoN !== false) {
      st.pathLossN = WS.defaultN(st.freq);
      if (el.plN) el.plN.value = st.pathLossN;
      if (el.plNVal) el.plNVal.textContent = st.pathLossN.toFixed(1);
    }
    syncChannelOptions();
    syncBwOptions();
    syncRegionUI();
    syncRfHint();
    syncThresholdUI();
    buildLegend();
    rebuildHeat();
    rebuildOverlap();
    pushHistory();
    if (msg) tip(msg);
  }

  function bindFormInputs() {
    el.selBand.onchange = function () {
      var st = S.project.settings;
      st.band = el.selBand.value;
      /* 按约定给每频段的默认信道与频宽 */
      var b = WS.BANDS_INFO[st.band];
      st.channel = (st.band === '5') ? 36 : 1;
      st.bw = (st.band === '5') ? 80 : 20;
      if (WS.channelsOf(st.band, st.region).indexOf(st.channel) < 0) {
        st.channel = WS.channelsOf(st.band, st.region)[0];
      }
      if (b.bws.indexOf(st.bw) < 0) st.bw = b.bws[0];
      var clamped = clampPowersToRegion();
      applyRfChange('已切到 ' + b.label + ' · Ch.' + st.channel + ' · ' + st.bw + ' MHz' +
        (clamped.n ? ('（' + clamped.n + ' 台 AP 功率收到 ' + clamped.to + ' dBm）') : ''));
    };

    el.selChannel.onchange = function () {
      var st = S.project.settings;
      st.channel = parseInt(el.selChannel.value, 10);
      var e = WS.eirpLimit(st.region, WS.chMhz(st.band, st.channel));
      var clamped = clampPowersToRegion();
      applyRfChange('信道 → Ch.' + st.channel + ' · ' + WS.chMhz(st.band, st.channel) + ' MHz' +
        (e ? ('（' + st.region + ' 上限 ' + e.dbm + ' dBm）') : '') +
        (clamped.n ? ('，' + clamped.n + ' 台 AP 功率已收紧') : ''));
    };

    el.selBw.onchange = function () {
      var st = S.project.settings;
      st.bw = parseInt(el.selBw.value, 10);
      applyRfChange('频宽 → ' + st.bw + ' MHz');
    };

    el.segRegion.addEventListener('click', function (e) {
      var b = e.target.closest('[data-region]');
      if (!b) return;
      var st = S.project.settings;
      var key = b.dataset.region;
      if (st.region === key) return;
      st.region = key;
      var list = WS.channelsOf(st.band, key);
      if (list.indexOf(st.channel) < 0) st.channel = list[0];
      var clamped = clampPowersToRegion();
      applyRfChange('已切到 ' + WS.regionOf(key).full +
        (clamped.n ? ('，' + clamped.n + ' 台 AP 功率按上限收紧到 ' + clamped.to + ' dBm') : ''));
    });
    el.plN.oninput = function () {
      S.project.settings.pathLossN = parseFloat(el.plN.value);
      S.project.settings.autoN = false;
      el.plNVal.textContent = S.project.settings.pathLossN.toFixed(1);
      rebuildHeat();
    };
    el.plN.onchange = function () { pushHistory(); };
    el.hCeil.onchange = function () {
      S.project.settings.apHeightCeiling = parseFloat(el.hCeil.value) || 2.9;
      rebuildHeat(); pushHistory();
    };
    el.hRx.onchange = function () {
      S.project.settings.rxHeight = parseFloat(el.hRx.value) || 1.1;
      rebuildHeat(); pushHistory();
    };
    el.thresh.oninput = function () {
      var v = parseInt(el.thresh.value, 10);
      if (S.project.settings.band === '5') S.project.settings.minRssi5 = v;
      else S.project.settings.minRssi24 = v;
      el.threshVal.textContent = el.thresh.value;
      buildLegend();
      rebuildHeatCanvasOnly();
    };
    el.thresh.onchange = function () { pushHistory(); };

    el.layHeat.onchange = function () {
      S.showHeat = el.layHeat.checked;
      S.layers.heat = el.layHeat.checked;
      el.heatToggle.checked = el.layHeat.checked;
      /* 之前关着的时候只记了脏，这里补算 */
      if (S.layers.heat && S.showHeat && S.heatDirty) rebuildHeat();
      WS.requestDraw();
    };
    el.layObs.onchange = function () { S.layers.obs = el.layObs.checked; WS.requestDraw(); };
    el.layAp.onchange = function () { S.layers.ap = el.layAp.checked; WS.requestDraw(); };
    el.layGrid.onchange = function () { S.layers.grid = el.layGrid.checked; WS.requestDraw(); };
    el.layBeam.onchange = function () { S.layers.beam = el.layBeam.checked; WS.requestDraw(); };

    el.layOverlap.onchange = function () {
      S.layers.overlap = el.layOverlap.checked;
      buildLegend();
      if (S.layers.overlap) {
        rebuildOverlap();
        tip('已显示同频重叠区：仅统计同信道、且两侧都高于 ' + S.project.settings.overlapThr + ' dBm 的区域');
      } else {
        S.overlapPolys = null;
        WS.requestDraw();
        updateOverlapStat();
      }
    };

    el.ovThr.oninput = function () {
      S.project.settings.overlapThr = parseInt(el.ovThr.value, 10);
      el.ovThrVal.textContent = S.project.settings.overlapThr + ' dBm';
      if (S.layers.overlap) scheduleOverlap(120);
    };
    el.ovThr.onchange = function () { pushHistory(); };
  }

  /* 门限滑块：显示并编辑当前频段对应的门限 */
  function syncThresholdUI() {
    var st = S.project.settings;
    var is5 = st.band === '5';
    var v = WS.minRssiOf(st);
    if (el.thresh) el.thresh.value = v;
    if (el.threshVal) el.threshVal.textContent = v;
    if (el.threshLabel) {
      el.threshLabel.textContent = '覆盖判定门限（' + (is5 ? '5 GHz' : '2.4 GHz') + '）';
    }
  }

  function syncInputs() {
    var p = S.project;
    var st = p.settings;
    el.selBand.value = st.band;
    syncChannelOptions();
    syncBwOptions();
    syncRegionUI();
    syncRfHint();
    el.hCeil.value = st.apHeightCeiling;
    el.hRx.value = st.rxHeight;
    syncThresholdUI();
    var nv = st.pathLossN || WS.defaultN(st.freq);
    el.plN.value = nv;
    el.plNVal.textContent = nv.toFixed(1);
    el.calWidth.value = '';
    el.calWidth.placeholder = WS.round(p.imgW * p.mpp, 1);
    syncScaleUI();
    buildLegend();
  }

  function syncScaleUI() {
    var p = S.project;
    var mpp = p.mpp || 0.05;
    el.scaleVal.textContent = WS.round(mpp * 100, 2);
    if (p.calibrated) {
      el.scaleRef.textContent = '已标定';
      el.scaleRef.classList.add('ok');
      el.calHint.textContent = '整幅约 ' + WS.round(p.imgW * mpp, 1) + ' × ' + WS.round(p.imgH * mpp, 1) + ' m';
    } else {
      el.scaleRef.textContent = '未标定';
      el.scaleRef.classList.remove('ok');
      el.calHint.textContent = '在平面上点两点 → 输入真实距离';
    }
  }

  /* ============================================================
     状态栏
     ============================================================ */
  function updateStatus() {
    var p = S.project;
    el.stProject.textContent = (S.doc && S.doc.name) || p.name || '未命名项目';
    if (el.stFloor && S.doc) {
      var sfb = WS.findBuilding(S.doc, S.doc.activeBuilding);
      var sff = WS.activeFloor(S.doc);
      el.stFloor.textContent = (sfb ? sfb.name : '—') + ' · ' + (sff ? sff.name : '—');
    }
    if (el.stRf) {
      var bi = WS.BANDS_INFO[p.settings.band] || WS.BANDS_INFO['24'];
      el.stRf.textContent = bi.short + ' · Ch.' + p.settings.channel + ' · ' + p.settings.bw + 'MHz';
    }
    el.stScale.textContent = '1 px = ' + WS.round((p.mpp || 0.05) * 100, 2) + ' cm';
    updateZoomLabel();

    var c = { brick: 0, concrete: 0, glass: 0, wood: 0, custom: 0 };
    p.obstacles.forEach(function (o) {
      var k = WS.obTypeKey(o.type);
      c[k] = (c[k] || 0) + 1;
    });
    el.stObjCount.textContent = '砖墙 ' + c.brick + ' · 混凝土 ' + c.concrete +
      ' · 玻璃窗 ' + c.glass + ' · 木门 ' + c.wood + ' · AP ' + p.aps.length +
      (S.selIds.length > 1 ? (' · 已选 ' + S.selIds.length + ' ' + scopeOfMode().unit + scopeOfMode().label) : '');
  }

  function updateZoomLabel() {
    var v = Math.round(S.view.s * 100);
    el.zVal.textContent = v + '%';
    el.stZoom.textContent = v + '%';
  }

  function tip(msg, ms) {
    el.tipBar.textContent = msg;
    el.tipBar.hidden = false;
    clearTimeout(tipTimer);
    if (ms !== 0) {
      tipTimer = setTimeout(function () { el.tipBar.hidden = true; }, ms || 2400);
    }
  }

  /* ============================================================
     撤销 / 重做
     ============================================================ */
  function snapshot() {
    var p = S.project;
    return JSON.stringify({
      name: p.name,
      obstacles: p.obstacles,
      aps: p.aps,
      settings: p.settings,
      mpp: p.mpp,
      calibrated: p.calibrated,
      scaleRef: p.scaleRef
    });
  }

  /* 撤销基线：打开 / 新建项目后立刻压入「当前状态」，
     否则第一次改动后的快照会成为栈底，undo 因 pos<=0 直接返回（首次操作撤不掉） */
  function resetHistory() {
    S.history = { stack: [snapshot()], pos: 0, lock: false };
  }

  function pushHistory() {
    var h = S.history;
    var s = snapshot();
    if (h.pos >= 0 && h.stack[h.pos] === s) return;
    h.stack = h.stack.slice(0, h.pos + 1);
    h.stack.push(s);
    if (h.stack.length > 100) h.stack.shift();
    h.pos = h.stack.length - 1;
    S.dirty = true;
    scheduleAutosave();
  }

  function applySnapshot(s) {
    var d = JSON.parse(s);
    var p = S.project;
    p.name = d.name;
    p.obstacles = d.obstacles;
    p.aps = d.aps;
    p.settings = d.settings;
    p.mpp = d.mpp;
    p.calibrated = d.calibrated;
    p.scaleRef = d.scaleRef;
    clearSelection();
    syncInputs();
    rebuildHeat();
    renderInspector();
    updateStatus();
    WS.requestDraw();
  }

  function undo() {
    var h = S.history;
    if (h.pos <= 0) { tip('没有可撤销的操作'); return; }
    h.pos--;
    applySnapshot(h.stack[h.pos]);
    tip('已撤销');
  }

  function redo() {
    var h = S.history;
    if (h.pos >= h.stack.length - 1) { tip('没有可重做的操作'); return; }
    h.pos++;
    applySnapshot(h.stack[h.pos]);
    tip('已重做');
  }

  /* ============================================================
     自动保存
     ============================================================ */
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosave, 1500);
  }

  function autosave() {
    var p = S.project;
    try {
      /* 结构与底图分开存：结构只有几十 KB，几乎一定能存下；
         底图是 base64，大图可能超出 localStorage 配额，单独兜底 */
      var structure = WS.serializeSlim(S.doc || WS.wrapDoc(p));
      localStorage.setItem('ws_autosave_v1', structure);
      localStorage.setItem('ws_autosave_theme', S.theme);

      if (p.image) {
        try {
          localStorage.setItem('ws_autosave_img', p.image);
        } catch (e2) {
          if (!autoSaveWarned) {
            autoSaveWarned = true;
            tip('图纸过大，自动备份未包含底图；请用「保存」导出项目文件', 5200);
          }
        }
      } else {
        localStorage.removeItem('ws_autosave_img');
      }
    } catch (e) {
      if (!autoSaveWarned) {
        autoSaveWarned = true;
        tip('自动备份失败，请及时用「保存」导出项目文件', 5200);
      }
    }
  }

  function restoreAutosave() {
    try {
      var t = localStorage.getItem('ws_autosave_theme');
      if (t === 'light') {
        S.theme = 'light';
        document.body.classList.add('light');
      }
      var raw = localStorage.getItem('ws_autosave_v1');
      if (!raw) return;

      var doc = WS.deserialize(raw);
      var f = WS.activeFloor(doc);
      if (!f) return;
      if (!f.image && !f.aps.length && !f.obstacles.length) return;

      /* 底图单独取回（只还到当前楼层） */
      if (!f.image) {
        var imgData = localStorage.getItem('ws_autosave_img');
        if (imgData) f.image = imgData;
      }

      applyDoc(doc);
      if (S.mode === 'device') el.legend.hidden = false;
      toolateTip();
    } catch (e) {
      /* 静默失败会让用户以为「上次的工作没了」却不知道为什么，这里必须说一声 */
      tip('上次的自动备份无法恢复，已从空白项目开始', 5200);
    }
  }

  function toolateTip() {
    setTimeout(function () {
      if (S.project.aps.length || S.project.obstacles.length) tip('已恢复上次的编辑内容');
    }, 400);
  }

  /* ============================================================
     拖拽导入
     ============================================================ */
  function bindDrop() {
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    el.stage.addEventListener('dragover', function (e) {
      e.preventDefault();
      el.stage.classList.add('dragover');
    });
    el.stage.addEventListener('dragleave', function (e) {
      if (e.target === el.stage) el.stage.classList.remove('dragover');
    });
    el.stage.addEventListener('drop', function (e) {
      e.preventDefault();
      el.stage.classList.remove('dragover');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (f.type.match(/^image\//)) loadImageFile(f);
      else if (/\.(json|wssurvey)$/i.test(f.name)) readProjectFile(f);
      else tip('请拖入图片或项目文件');
    });

    /* 拖到画布以外的地方松手时给个反馈，别让用户以为程序卡了 */
    window.addEventListener('drop', function (e) {
      if (e.target.closest && e.target.closest('#stage')) return;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        tip('请把文件拖到中间的画布区域');
      }
    });
  }

  /* ============================================================
     桌面版桥接（Electron）
     ============================================================ */
  function bindDesktop() {
    if (!window.wsDesktop) return;

    /* 关闭窗口时选了「先保存再退出」 */
    window.wsDesktop.onMenuSave(function () {
      saveProject();
    });

    /* 主进程弹过原生「另存为」对话框后回传结果 */
    window.wsDesktop.onDownloadDone(function (d) {
      if (d.state === 'completed') {
        if (/\.json$/i.test(d.name || '')) S.dirty = false;
        tip('已保存：' + (d.name || '文件'));
      } else if (d.state === 'cancelled') {
        tip('已取消保存');
      } else {
        tip('保存未完成，请重试');
      }
    });

    document.body.classList.add('desktop');
  }

  /* ============================================================
     弹窗
     ============================================================ */
  var dialogResolve = null;

  function dialog(o) {
    return new Promise(function (resolve) {
      dialogResolve = resolve;
      el.modalTitle.textContent = o.title || '提示';
      el.modalBody.innerHTML = o.body || '';
      el.modal.className = 'modal' + (o.wide ? ' wide' : '');
      el.modalFoot.innerHTML = '';

      (o.buttons || [{ label: '知道了', cls: 'btn-p', value: true }]).forEach(function (b) {
        var btn = document.createElement('button');
        btn.className = b.cls || 'btn-s';
        btn.textContent = b.label;
        btn.onclick = function () {
          var r;
          if (typeof b.collect === 'function') {
            r = b.collect();
            if (r === false) return;
          } else {
            r = (b.value !== undefined ? b.value : true);
          }
          closeModal(r);
        };
        el.modalFoot.appendChild(btn);
      });

      el.modalMask.hidden = false;
      var inp = el.modalBody.querySelector('input');
      if (inp) {
        setTimeout(function () { inp.focus(); inp.select(); }, 40);
        inp.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            var last = el.modalFoot.lastElementChild;
            if (last) last.click();
          }
        });
      }
    });
  }

  function closeModal(value) {
    el.modalMask.hidden = true;
    var r = dialogResolve;
    dialogResolve = null;
    if (r) r(value === undefined ? null : value);
  }

  function inputDialog(title, label, defVal, unit, hint) {
    return dialog({
      title: title,
      body: '<p style="margin-bottom:8px;color:var(--txt)">' + label + '</p>' +
        '<input class="big-input" id="dlgInput" type="number" step="any" min="0" value="' + (defVal || '') + '" placeholder="输入数值">' +
        (unit ? '<div style="text-align:center;color:var(--txt-3);margin-top:6px;font-size:12px">单位：' + unit + '</div>' : '') +
        (hint ? '<p style="margin-top:12px;font-size:11px;color:var(--txt-3);line-height:1.6">' + hint + '</p>' : ''),
      buttons: [
        { label: '取消', cls: 'btn-s', value: 0 },
        {
          label: '确定', cls: 'btn-p',
          collect: function () {
            var v = parseFloat(document.getElementById('dlgInput').value);
            if (!isFinite(v) || v <= 0) { tip('请输入大于 0 的数值'); return false; }
            return v;
          }
        }
      ]
    });
  }

  /* ============================================================
     帮助
     ============================================================ */
  function showHelp() {
    dialog({
      title: '使用说明',
      wide: true,
      body: [
        '<h4>两步走：先平面，后设备</h4>',
        '<p><b style="color:var(--txt)">① 平面编辑</b> —— 导入平面图 → 标定比例尺 → 沿图纸描出墙、门、窗。</p>',
        '<p><b style="color:var(--txt)">② 设备编辑</b> —— 放置 AP → 调整安装方式与朝向 → 看热力图实时变化。</p>',

        '<h4>平面编辑</h4>',
        '<table>',
        '<tr><th>操作</th><th>方法</th></tr>',
        '<tr><td><b>导入底图</b></td><td>点「导入底图」，或把图片直接拖进画布（JPG / PNG / BMP / WEBP）</td></tr>',
        '<tr><td><b>标定比例尺</b></td><td>点「在图上标定比例尺」→ 在已知长度的两点上各点一下 → 输入真实米数</td></tr>',
        '<tr><td><b>画墙 / 门 / 窗</b></td><td>选中工具后按住左键拖出一条线段；靠近已有墙会自动吸附（默认 8 px，可调 0 ~ 16 px），方便连成折线</td></tr>',
        '<tr><td><b>吸附到墙线</b></td><td>端点会按 <b style="color:var(--txt)">端点 → 交点 → 墙上最近点</b> 的优先级贴过去。' +
          '吸到交点时保持你画的方向，只把端点顶到墙上，不会把墙拽歪；交点必须真的落在已有墙段内。' +
          '画布上：淡色方框 = 可吸的端点，彩色圆圈+十字 = 已吸住（蓝=端点 / 琥珀=交点 / 绿=墙线）</td></tr>',
        '<tr><td><b>直线修正</b></td><td>与水平 / 垂直偏差小于默认 9.1°（可调 0 ~ 17.7°）时自动拉直；按住 <kbd>Shift</kbd> 则无条件锁定正交</td></tr>',
        '<tr><td><b>边缘滚屏</b></td><td>画线时把光标拖到视图边缘，视图会自动平移，长墙可一次画完</td></tr>',
        '<tr><td><b>调整已画的墙</b></td><td>点选墙体后拖动两端蓝色圆点，可单独移动某一端；拖动墙体中部则整体平移</td></tr>',
        '<tr><td><b>调整衰减</b></td><td>新建墙体默认<b style="color:var(--txt)">按厚度自动算</b>衰减：改厚度，衰减立刻跟着变；' +
          '点属性面板的「按厚度自动计算」可切成手动，分别填 2.4G / 5G 的 dB 值</td></tr>',
        '</table>',
        '<p style="font-size:11px;color:var(--txt-3)">「工具」下方的四个开关分别控制<b style="color:var(--txt)">吸附</b>、' +
          '<b style="color:var(--txt)">墙线吸附</b>、<b style="color:var(--txt)">直线修正</b>、<b style="color:var(--txt)">边缘滚屏</b>，' +
          '默认全部开启，可按需关闭。</p>',
        '<p style="font-size:11px;color:var(--txt-3)">开关下面还有两条<b style="color:var(--txt)">强度滑条</b>，向左减弱、向右增强，拖到最左端 0 就等于完全关掉这项效果：</p>',
        '<table>',
        '<tr><th>滑条</th><th>范围</th><th>默认（中间值）</th><th>含义</th></tr>',
        '<tr><td><b>吸附强度</b></td><td>0 ~ 16 px</td><td><b>8 px</b></td><td>进入该屏幕半径内即吸附；同时作用于端点、交点与墙线</td></tr>',
        '<tr><td><b>直线修正强度</b></td><td>0° ~ 17.7°</td><td><b>9.1°</b></td><td>与水平/垂直的偏差小于该角度时自动拉直</td></tr>',
        '</table>',
        '<p style="font-size:11px;color:var(--txt-3)">强度按<b style="color:var(--txt)">屏幕像素 / 角度</b>计，缩放图纸不会改变手感；滑块位置和数值会记住，下次打开沿用。</p>',

        '<h4>图层与编辑模式</h4>',
        '<p>切换模式时图层会自动跟着调，不必手动勾：</p>',
        '<table>',
        '<tr><th>切到</th><th>自动处理</th></tr>',
        '<tr><td><b>平面编辑</b></td><td>关闭 热力图 / 天线方向图 / 无线设备 / 信号重叠，专心画墙</td></tr>',
        '<tr><td><b>设备编辑</b></td><td>只打开「无线设备」，其余保持原来的勾选状态</td></tr>',
        '</table>',
        '<p style="font-size:11px;color:var(--txt-3)">需要时也可以手动再勾回来，例如想在平面模式下顺便看一眼热力图。</p>',

        '<h4>框选与批量编辑</h4>',
        '<p>按住 <kbd>Ctrl</kbd> 在画布上拖出矩形即可框选。为避免跨类型批量误改，' +
          '<b style="color:var(--txt)">框选只按当前模式的对象类型生效</b>：</p>',
        '<table>',
        '<tr><th>当前模式</th><th>可框选对象</th><th>不会被选中</th></tr>',
        '<tr><td><b>平面编辑</b></td><td>墙体 / 门 / 窗 / 立柱（统一按「墙体」处理）</td><td>AP</td></tr>',
        '<tr><td><b>设备编辑</b></td><td>AP</td><td>墙体、门窗</td></tr>',
        '</table>',
        '<p>框选时，矩形左上角与底部提示条都会显示「仅框选 XX · 已覆盖 N」，松手才生效；' +
          '框错了按 <kbd>Esc</kbd> 或点属性栏的「取消框选」。' +
          '按住 <kbd>Ctrl</kbd> 单击（不拖动）等同于普通点选，两种选择方式并存不冲突。</p>',
        '<p>选中多个后，右侧属性栏会切换为批量面板：可批量改材质 / 安装方式 / 发射功率、批量启停、' +
          '批量删除（<kbd>Delete</kbd>），也可以直接拖动其中任意一个整体平移；<kbd>Ctrl+Z</kbd> 可撤销。</p>',

        '<h4>障碍物材质</h4>',
        '<p>预设取自 TP-LINK 官方《无线规划工具》，2.4 GHz 与 5 GHz 各自独立取值，计算时按当前频段直接选用，不再乘换算系数。</p>',
        '<table>',
        '<tr><th>材质</th><th>2.4 GHz</th><th>5 GHz</th><th>默认厚度</th></tr>',
        '<tr><td><b>砖墙</b></td><td>4 dB</td><td>7 dB</td><td>120 mm</td></tr>',
        '<tr><td><b>混凝土</b></td><td>25 dB</td><td>30 dB</td><td>240 mm</td></tr>',
        '<tr><td><b>玻璃窗</b></td><td>8 dB</td><td>10 dB</td><td>80 mm</td></tr>',
        '<tr><td><b>木门</b></td><td>3 dB</td><td>4 dB</td><td>40 mm</td></tr>',
        '<tr><td><b>自定义</b></td><td>10 dB</td><td>14 dB</td><td>100 mm</td></tr>',
        '</table>',

        '<h4>设备编辑</h4>',
        '<table>',
        '<tr><th>安装方式</th><th>辐射特性</th></tr>',
        '<tr><td><b>吸顶全向</b></td><td>水平 360° 全向；垂直面向下辐射，覆盖半径随吊顶高度增加</td></tr>',
        '<tr><td><b>壁挂定向</b></td><td>前向窄波束高增益，后向抑制约 20 dB；适合走廊、长条车间</td></tr>',
        '<tr><td><b>面板入墙</b></td><td>前向宽波束小功率，背面几乎无穿透；适合酒店客房、单间办公</td></tr>',
        '</table>',
        '<p>放置后拖动设备本体可移动，拖动外侧的<b style="color:var(--txt)">圆形手柄</b>可调整朝向（按住 <kbd>Shift</kbd> 按 15° 步进）。</p>',

                '<h4>信道与频宽</h4>',
        '<table>',
        '<tr><th>频段</th><th>可选频宽</th><th>默认</th></tr>',
        '<tr><td><b>2.4 GHz</b></td><td>20 / 40 MHz</td><td>Ch.1 · 20 MHz</td></tr>',
        '<tr><td><b>5 GHz</b></td><td>20 / 40 / 80 / 160 MHz</td><td>Ch.36 · 80 MHz</td></tr>',
        '</table>',
        '<p>默认全项目统一信道；个别 AP 要错开时，在右侧「信道与频宽」里单独指定（默认"跟随项目"）。' +
          '占用频率区间 = [中心 − 10 MHz，中心 − 10 MHz + 频宽]，例如 Ch.36@80 MHz 占 5170–5250 MHz。</p>',

        '<h4>射频区域</h4>',
        '<p>「射频区域」可在中国 / 澳大利亚之间一键切换，只影响<b style="color:var(--txt)">可用信道</b>与' +
          '<b style="color:var(--txt)">EIRP 上限</b>；超限的 AP 会在切换时自动收紧功率。</p>',
        '<table>',
        '<tr><th>区域</th><th>2.4 GHz</th><th>5150–5350</th><th>5472–5725</th><th>5725–5850</th></tr>',
        '<tr><td><b>中国 · SRRC</b></td><td>≤20 dBm</td><td>≤23 dBm</td><td>不可用</td><td>≤33 dBm</td></tr>',
        '<tr><td><b>澳大利亚 · ACMA</b></td><td>≤36 dBm</td><td>≤23 dBm</td><td>≤30 dBm</td><td>≤36 dBm</td></tr>',
        '</table>',
        '<p style="font-size:11px;color:var(--txt-3)">数值来自公开法规整理，仅作规划参考，不替代合规认证。</p>',

        '<h4>热力图</h4>',
        '<p>颜色从强到弱依次为：</p>',
        '<p style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px">' +
          WS.BANDS.map(function (b, i) {
            var lo = (i === WS.BANDS.length - 1) ? Math.max(b.min, curMinRssi()) : b.min;
            return '<span style="display:inline-flex;align-items:center;gap:5px;background:var(--bg-0);border:1px solid var(--line);border-radius:5px;padding:3px 9px;font-size:11px">' +
              '<i style="width:12px;height:8px;border-radius:2px;background:' + b.hex + ';display:inline-block"></i>' +
              b.name + ' ≥ ' + lo + '</span>';
          }).join('') +
        '</p>',
        '<p>低于门限的区域留白；若该处已算出信号但强度不足，会显示为淡灰色盲区。门限默认 -65 dBm，2.4 GHz 与 5 GHz 可分别设置，滑块始终编辑当前频段的那个值。鼠标移到画布上，左下角会实时显示该点的计算信号值与到最近 AP 的距离。</p>',
        '<p><b style="color:var(--txt)">拖动时不重算：</b>拖动 AP 或墙体期间热力图保持上一次结果并淡显（表示「待更新」），松手后才重算一次，避免拖动过程中反复占用 CPU。</p>',

        '<h4>同频重叠（信号重叠图层）</h4>',
        '<p>勾选「图层 → 信号重叠」，画布上用<b style="color:var(--txt)">黑色边框 + 45° 斜线</b>标出同频重叠区。判定是逐点做的：</p>',
        '<ul>',
        '<li>该点被 <b style="color:var(--txt)">≥2 台 AP</b> 覆盖，且这些 AP 在该点的信号都 ≥ 干扰阈值（默认 -67 dBm）；</li>',
        '<li>这些 AP 中至少有一对，<b style="color:var(--txt)">占用频率区间相交</b>。</li>',
        '</ul>',
        '<p>所以：不同信道且频带不相交 → 不算重叠；中心信道不同但频带交叠（如 Ch.36@80M 与 Ch.44@20M）→ 算重叠；' +
          '一侧已衰减到阈值以下（如另一台只剩 -70 dBm）→ 不算重叠。阈值滑块调低则重叠区变大。</p>',

        '<h4>快捷键</h4>',
        '<table>',
        '<tr><td><kbd>V</kbd></td><td>选择工具</td><td><kbd>W</kbd> / <kbd>D</kbd> / <kbd>N</kbd></td><td>墙 / 门 / 窗</td></tr>',
        '<tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>吸顶 / 壁挂 / 面板 AP</td><td><kbd>Ctrl+Shift+A</kbd></td><td>随时切到吸顶 AP</td></tr>',
        '<tr><td><kbd>Ctrl+Z</kbd></td><td>撤销</td><td><kbd>Ctrl+Y</kbd></td><td>重做</td></tr>',
        '<tr><td><kbd>Delete</kbd></td><td>删除选中</td><td><kbd>Esc</kbd></td><td>取消操作 / 退回选择工具</td></tr>',
        '<tr><td><kbd>Tab</kbd></td><td>切换平面 / 设备模式</td><td><kbd>空格</kbd>+拖拽</td><td>平移画布</td></tr>',
        '<tr><td><kbd>滚轮</kbd></td><td>以光标为中心缩放</td><td><kbd>Shift</kbd></td><td>画线时强制正交</td></tr>',
        '<tr><td><kbd>Ctrl</kbd>+拖动</td><td>框选（仅当前模式的对象类型）</td><td><kbd>Delete</kbd></td><td>删除选中（可批量）</td></tr>',
        '<tr><td><kbd>Alt</kbd>+<kbd>1</kbd>~<kbd>6</kbd></td><td colspan="3">图层开关：热力图 / 障碍物 / 无线设备 / 米制网格 / 天线方向图 / 信号重叠（顺序同左侧图层列表）</td></tr>',
        '</table>',
        '<p style="font-size:11px;color:var(--txt-3)">Alt 系组合与系统复制粘贴（Ctrl+C/V）、全选（Ctrl+A）、保存（Ctrl+S）、撤销（Ctrl+Z）都不冲突；' +
          '在名称等文本框里不拦截，不会影响中文输入法的 Alt+数字选词。</p>',

        '<h4>吸附与正交</h4>',
        '<p>画墙时，新端点会自动吸附到附近已有墙体，优先级为：<b>墙的端点</b> → <b>你这条线的延长线与已有墙的交点</b> → <b>墙上的最近点（垂足）</b>。' +
          '吸附半径由左侧「吸附强度」滑条控制（0 ~ 16 px，默认 8 px，最左 0 = 关闭）。</p>',
        '<p><b>吸附不会破坏水平 / 垂直</b>：一旦进入正交状态（偏差小于设定角度，或按住 <kbd>Shift</kbd>），吸附目标必须同时落在这条水平 / 垂直线上 —— ' +
          '撞到垂直墙时端点会精确吸在交点上，墙仍然是平的，不会被拽歪。</p>',
        '<p>由此带来一个取舍：当附近那条墙与你的线<b>平行但不同高</b>时，两者无法同时满足，此时<b>正交优先、不吸附</b>。' +
          '确实需要吸到那条平行墙上，先把左侧「直线修正」滑条拖到最左（0）或关掉该开关。</p>',

        '<h4>计算模型</h4>',
        '<p>信号强度 = 发射功率 + 天线增益 + 方向图增益 − 自由空间损耗 − 穿墙损耗。</p>',
        '<ul>',
        '<li>自由空间损耗：<code>20lg(d) + 20lg(f) − 27.55</code></li>',
        '<li>方向图按半功率波瓣宽度建模为 <code>cos^n</code>，n 由 HPBW 反解；定向天线另加前后比</li>',
        '<li>穿墙损耗按收发两点连线与每段障碍物求交后累加，2.4 GHz / 5 GHz 分别使用各自独立的材质衰减值（单点累计上限 80 dB）</li>',
        '<li>多 AP 时取各 AP 计算值的最大值（不做同频干扰合并）</li>',
        '</ul>',
        '<p style="color:var(--txt-3);font-size:11px;margin-top:10px">说明：本模型为工程估算模型，用于方案阶段的 AP 点位与数量评估；最终覆盖效果仍需现场实测校验。</p>',

        '<h4>关于 · 作者与著作权</h4>',
        '<p><b style="color:var(--txt)">' + WS.AUTHOR.product + ' v' + WS.VERSION + '</b><br>' +
          '作者：<b style="color:var(--txt)">' + WS.AUTHOR.name + '</b>' +
          '（' + WS.AUTHOR.birth + '，' + WS.AUTHOR.city + '）</p>',
        '<p>' + WS.AUTHOR.notice + '</p>',
        '<p style="color:var(--txt-3);font-size:11px">© ' + WS.AUTHOR.year + ' ' + WS.AUTHOR.name +
          ' 版权所有 All Rights Reserved.<br>' +
          '本软件为个人独立开发作品；如需办理软件著作权登记，可凭本声明与源程序向中国版权保护中心提出申请。</p>'
      ].join(''),
      buttons: [{ label: '开始使用', cls: 'btn-p' }]
    });
  }

  /* ============================================================
     关于 · 作者与著作权声明
     ============================================================ */
  function showAbout() {
    var A = WS.AUTHOR;
    dialog({
      title: '关于 ' + A.product,
      body: [
        '<div style="text-align:center;margin:4px 0 14px">',
        '<div style="font-size:17px;font-weight:600;color:var(--txt);letter-spacing:1px">' + A.product + '</div>',
        '<div style="font-size:11.5px;color:var(--txt-3);margin-top:3px">v' + WS.VERSION + ' · 平面图无线覆盖规划工具</div>',
        '</div>',
        '<table>',
        '<tr><th style="width:84px">作者</th><td>' + A.name + '</td></tr>',
        '<tr><th>出生日期</th><td>' + A.birth + '</td></tr>',
        '<tr><th>所在地</th><td>' + A.city + '</td></tr>',
        '<tr><th>开发方式</th><td>个人独立开发</td></tr>',
        '</table>',
        '<p style="margin-top:12px;line-height:1.75">' + A.notice + '</p>',
        '<p style="margin-top:10px;color:var(--txt-3);font-size:11px;line-height:1.7">© ' + A.year + ' ' + A.name +
          ' 版权所有 All Rights Reserved.<br>' +
          '如需办理软件著作权登记，可凭本声明与本软件源程序向中国版权保护中心提出申请。</p>'
      ].join(''),
      buttons: [{ label: '知道了', cls: 'btn-p' }]
    });
  }

  /* ============================================================
     go
     ============================================================ */
  WS._ui = {
    setMode: setMode,
    setTool: setTool,
    renderInspector: renderInspector,
    rebuildHeat: rebuildHeat,
    rebuildOverlap: rebuildOverlap,
    syncInputs: syncInputs,
    updateStatus: updateStatus,
    updateStats: updateStats,
    pushHistory: pushHistory,
    saveProject: saveProject,
    applyProject: applyProject,
    tip: tip,
    showAbout: showAbout,
    /* 选择集（自动化测试 / 调试用） */
    setSelection: setSelection,
    clearSelection: clearSelection,
    selectedObjects: selectedObjects,
    scopeOfMode: scopeOfMode,
    marqueeHits: marqueeHits,
    deleteSelection: deleteSelection,
    /* 供自动化测试 / 调试使用 */
    compressBackdrop: compressBackdrop,
    /* 楼层（自动化测试 / 调试用） */
    applyDoc: applyDoc,
    switchFloor: switchFloor,
    buildFloorUI: buildFloorUI,
    snapPoint: snapPoint,
    orthoSnap: orthoSnap,
    orthoAxis: orthoAxis,
    toggleLayer: toggleLayer,
    syncLayerUI: syncLayerUI,
    startAutoPan: startAutoPan,
    stopAutoPan: stopAutoPan
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window.WS);
