/* ============================================================
 * scripts/after-pack-clean.cjs — 打包后清理
 * ------------------------------------------------------------
 * electron-builder 打包时会把 dist/win-unpacked 整个目录塞进安装包。
 * 如果开发者在 win-unpacked 里跑过一次应用，就会留下：
 *   - 用户数据/    ← 真实业务数据（单据、客户、改过的商品价格）
 *   - CommercesData/ ← 上传的商品图片
 *   - 数据备份/    ← 目录外备份的副本
 * 这些绝不能发给用户。本脚本在 afterPack 阶段把它们删掉。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const RUNTIME_DIRS = ['用户数据', 'CommercesData', '数据备份', '送货单统计数据备份'];

function rmrf(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = async function afterPack(context) {
  const outDir = context && context.appOutDir;
  if (!outDir) return;
  for (const name of RUNTIME_DIRS) {
    const target = path.join(outDir, name);
    if (!fs.existsSync(target)) continue;
    if (rmrf(target)) {
      console.log('[after-pack-clean] 已移除运行期目录: ' + target);
    } else {
      console.warn('[after-pack-clean] 无法移除: ' + target);
    }
  }
  // 保险：安装包里不应出现任何业务数据文件
  const stray = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (/^sd_v1_.*\.json$/.test(e.name)) stray.push(full);
    }
  };
  walk(outDir, 0);
  if (stray.length) {
    console.warn('[after-pack-clean] 警告：安装目录仍存在业务数据文件：');
    stray.forEach(f => console.warn('  ' + f));
  }
};
