/* ============================================================
   打包脚本：把应用打成 Windows x64 可执行目录
   用法：node build/pack.js
   产物：dist/WaveScout-win32-x64/WaveScout.exe
   ============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const packager = require('electron-packager');

const ROOT = path.join(__dirname, '..');

/* 只把运行必需的网页资源打进 asar，其余全部排除 */
function shouldIgnore(p) {
  if (!p) return false;
  const rel = p.replace(/\\/g, '/');

  if (/^\/dist(\/|$)/.test(rel)) return true;
  if (/^\/build(\/|$)/.test(rel)) return true;
  if (/^\/\.git(\/|$)/.test(rel)) return true;
  if (/^\/node_modules(\/|$)/.test(rel)) return true;   // 运行时零依赖
  if (/^\/test(\/|$)/.test(rel)) return true;           // 端到端断言脚本，不进成品
  if (/^\/package-lock\.json$/.test(rel)) return true;
  if (/^\/启动\.vbs$/.test(rel)) return true;
  if (/^\/使用说明/.test(rel)) return true;
  if (/\.md$/.test(rel)) return true;
  if (/\.log$/.test(rel)) return true;
  if (/\.psd$|\.ai$/.test(rel)) return true;

  return false;
}

const opts = {
  dir: ROOT,
  name: 'WaveScout',
  platform: 'win32',
  arch: 'x64',
  out: path.join(ROOT, 'dist'),
  overwrite: true,
  prune: true,
  asar: true,
  icon: path.join(ROOT, 'electron', 'icon.ico'),
  appVersion: '1.8.3',
  buildVersion: '1.8.3.0',
  appCopyright: 'Copyright © 2026 邹宁 All Rights Reserved.',
  ignore: shouldIgnore,
  quiet: false,
  win32metadata: {
    CompanyName: '邹宁',
    FileDescription: '勘波 WaveScout 无线覆盖规划工具',
    ProductName: '勘波 WaveScout',
    InternalName: 'WaveScout',
    OriginalFilename: 'WaveScout.exe',
    LegalCopyright: 'Copyright © 2026 邹宁 版权所有'
  }
};

console.log('[pack] 开始打包…');
const t0 = Date.now();

packager(opts)
  .then(function (appPaths) {
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const src = appPaths[0];

    /* 把 WaveScout-win32-x64 / WaveScout.exe 改成中文名，方便用户直接找 */
    const dst = path.join(ROOT, 'dist', '勘波 WaveScout');
    try {
      /* 旧版本先改名备份（rename 是原子的，比递归删除快且不会被安全软件卡住） */
      if (fs.existsSync(dst)) {
        const bak = path.join(ROOT, 'dist', '_old_' + Date.now());
        fs.renameSync(dst, bak);
        try {
          fs.rmSync(bak, { recursive: true, force: true });
        } catch (e2) {
          console.log('[pack] 旧版本改名到: ' + bak + '（可稍后手动删除）');
        }
      }

      fs.renameSync(src, dst);

      const oldExe = path.join(dst, 'WaveScout.exe');
      const newExe = path.join(dst, '勘波 WaveScout.exe');
      if (fs.existsSync(oldExe)) fs.renameSync(oldExe, newExe);
    } catch (e) {
      console.error('[pack] 重命名失败（不影响使用）: ' + e.message);
      console.log('[pack] 原始输出目录: ' + src);
      return;
    }

    console.log('[pack] 完成，用时 ' + sec + 's');
    console.log('[pack] 成品: ' + path.join(dst, '勘波 WaveScout.exe'));
  })
  .catch(function (err) {
    console.error('[pack] 失败:', err && err.message ? err.message : err);
    process.exit(1);
  });
