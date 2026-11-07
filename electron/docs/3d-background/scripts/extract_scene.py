#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
extract_scene.py — 把 3D 沙盘场景从单页 HTML 抽成可直挂的 scene.js（P4 原生化）

背景：
  P3 阶段 3D 背景通过 <iframe src="3d/p0-blockout.html"> 接入工作台，多一层嵌套 +
  只能靠 postMessage 传数据。P4 把场景逻辑抽成独立脚本 scene.js：
    - 预览页 p0-blockout.html 变成薄壳（保留调试面板 + 场景脚本）
    - 宿主页 bg3d.js 直接在主页面里挂载 scene.js，无需 iframe、无需 postMessage

做法：
  1. 读取 p0-blockout.html 里的内联 <script> 场景代码
  2. 施加一组「宿主直挂模式」补丁（可选 canvas / 可覆盖 URL 参数 / 预览 UI 全部加空值保护）
  3. 输出 scene.js
  4. 把 p0-blockout.html 改写成薄壳（引用 scene.js）

本脚本对 assets 与 docs 两份副本都适用；重复执行时若已抽取过会直接跳过。
"""

import io
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
ASSETS_3D = os.path.join(REPO, 'android', 'app', 'src', 'main', 'assets', 'app', '3d')
DOCS_PREVIEW = os.path.abspath(os.path.join(HERE, '..', 'preview'))

# ---------------------------------------------------------------- 补丁表
PATCHES = [
    # 1) 画布 / 参数可由宿主注入
    (
        "  var canvas = document.getElementById('bg');",
        "  var canvas = (OPTS && OPTS.canvas) || document.getElementById('bg');",
    ),
    (
        "  var bootQ = new URLSearchParams(location.search);",
        "  var bootQ = (OPTS && OPTS.params) || new URLSearchParams(location.search);",
    ),
    (
        "  var q=new URLSearchParams(location.search);",
        "  var q=(OPTS && OPTS.params) || new URLSearchParams(location.search);",
    ),
    # 2) 宿主直挂模式没有预览页覆盖层 → 建隐藏占位
    (
        "  var tagLayer = document.getElementById('tag-layer');\n"
        "  var tagSvg = document.getElementById('tag-svg');",
        "  var tagLayer = document.getElementById('tag-layer');\n"
        "  var tagSvg = document.getElementById('tag-svg');\n"
        "  if(!tagLayer || !tagSvg){\n"
        "    // 宿主直挂模式没有预览页覆盖层：建隐藏占位，后续 appendChild 不会报错\n"
        "    var uiHolder = document.createElement('div');\n"
        "    uiHolder.id = 'dns-scene-ui-holder';\n"
        "    uiHolder.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';\n"
        "    tagLayer = document.createElement('div'); tagLayer.id = 'tag-layer';\n"
        "    tagSvg = document.createElementNS('http://www.w3.org/2000/svg','svg'); tagSvg.id = 'tag-svg';\n"
        "    uiHolder.appendChild(tagSvg); uiHolder.appendChild(tagLayer);\n"
        "    (document.body || document.documentElement).appendChild(uiHolder);\n"
        "  }",
    ),
    # 3) 统计面板 UI 只在预览页存在
    (
        "    // UI\n"
        "    document.getElementById('ui-orders').innerHTML = state.orders+'<small>单</small>';\n"
        "    document.getElementById('ui-today').textContent = money(state.todayAmount);\n"
        "    document.getElementById('ui-month').textContent = money(state.amount);\n"
        "    document.getElementById('ui-customers').innerHTML = state.customers+'<small>家</small>';\n"
        "    document.querySelector('.flow .more').textContent = '今日 · '+state.orders+' 单';\n"
        "    document.getElementById('data-source').textContent = '数据源：' + state.source;\n"
        "    renderRecent();",
        "    // UI（仅预览页有这套面板，宿主直挂模式跳过）\n"
        "    if(OPTS && OPTS.ui){\n"
        "      var elO=document.getElementById('ui-orders'); if(elO) elO.innerHTML = state.orders+'<small>单</small>';\n"
        "      var elT=document.getElementById('ui-today'); if(elT) elT.textContent = money(state.todayAmount);\n"
        "      var elM=document.getElementById('ui-month'); if(elM) elM.textContent = money(state.amount);\n"
        "      var elC=document.getElementById('ui-customers'); if(elC) elC.innerHTML = state.customers+'<small>家</small>';\n"
        "      var elMore=document.querySelector('.flow .more'); if(elMore) elMore.textContent = '今日 · '+state.orders+' 单';\n"
        "      var elSrc=document.getElementById('data-source'); if(elSrc) elSrc.textContent = '数据源：' + state.source;\n"
        "      renderRecent();\n"
        "    }",
    ),
    (
        "    var ul = document.getElementById('ui-recent');",
        "    var ul = document.getElementById('ui-recent');\n    if(!ul) return;",
    ),
    # 4) FPS：宿主要读数，预览页没有 #fps 也不能报错
    (
        "  var fpsEl=document.getElementById('fps');",
        "  var fpsEl=document.getElementById('fps');\n  var fpsValue=0;",
    ),
    (
        "    if(fpsTime>=0.5){\n"
        "      fpsEl.textContent=Math.round(frames/fpsTime)+' fps';\n"
        "      frames=0; fpsTime=0;\n"
        "    }",
        "    if(fpsTime>=0.5){\n"
        "      fpsValue=Math.round(frames/fpsTime);\n"
        "      if(fpsEl) fpsEl.textContent=fpsValue+' fps';\n"
        "      frames=0; fpsTime=0;\n"
        "    }",
    ),
    # 5) 控件全部加空值保护
    (
        "  document.getElementById('hud-head').addEventListener('click',function(){",
        "  var hudHead=document.getElementById('hud-head');\n"
        "  if(hudHead) hudHead.addEventListener('click',function(){",
    ),
    (
        "  btnUI.addEventListener('click',function(){",
        "  if(btnUI) btnUI.addEventListener('click',function(){",
    ),
    (
        "  btnZones.addEventListener('click',function(){\n"
        "    var on=document.getElementById('safe').classList.toggle('on');",
        "  if(btnZones) btnZones.addEventListener('click',function(){\n"
        "    var safeEl=document.getElementById('safe');\n"
        "    var on = safeEl ? safeEl.classList.toggle('on') : false;",
    ),
    (
        "  btnWire.addEventListener('click',function(){",
        "  if(btnWire) btnWire.addEventListener('click',function(){",
    ),
    (
        "  btnNight.addEventListener('click',function(){",
        "  if(btnNight) btnNight.addEventListener('click',function(){",
    ),
    (
        "  var fileData = document.getElementById('file-data');\n"
        "  document.querySelector('[data-act=\"load\"]').addEventListener('click', function(){ fileData.click(); });\n"
        "  fileData.addEventListener('change', function(e){",
        "  var fileData = document.getElementById('file-data');\n"
        "  var btnLoad = document.querySelector('[data-act=\"load\"]');\n"
        "  if(btnLoad && fileData) btnLoad.addEventListener('click', function(){ fileData.click(); });\n"
        "  if(fileData) fileData.addEventListener('change', function(e){",
    ),
    (
        "    var el=document.getElementById(id), v=document.getElementById('v-'+key);\n"
        "    el.addEventListener('input',function(){",
        "    var el=document.getElementById(id), v=document.getElementById('v-'+key);\n"
        "    if(!el) return;\n"
        "    el.addEventListener('input',function(){",
    ),
    (
        "  document.getElementById('guide-close').addEventListener('click', clearFocus);",
        "  var guideClose=document.getElementById('guide-close');\n"
        "  if(guideClose) guideClose.addEventListener('click', clearFocus);",
    ),
    (
        "  if(q.get('hud')==='0'){ document.getElementById('hud').style.display='none'; document.querySelector('.tip').style.display='none'; }",
        "  if(q.get('hud')==='0'){ var hud0=document.getElementById('hud'); if(hud0) hud0.style.display='none';\n"
        "    var tip0=document.querySelector('.tip'); if(tip0) tip0.style.display='none'; }",
    ),
    (
        "  if(q.get('clean')==='1'){\n"
        "    document.body.classList.add('no-ui');\n"
        "    document.getElementById('hud').style.display='none';\n"
        "    document.querySelector('.tip').style.display='none';\n"
        "    document.getElementById('safe').classList.remove('on');\n"
        "  }",
        "  if(q.get('clean')==='1'){\n"
        "    document.body.classList.add('no-ui');\n"
        "    var hud1=document.getElementById('hud'); if(hud1) hud1.style.display='none';\n"
        "    var tip1=document.querySelector('.tip'); if(tip1) tip1.style.display='none';\n"
        "    var safe1=document.getElementById('safe'); if(safe1) safe1.classList.remove('on');\n"
        "  }",
    ),
    # 6) 导出 API：宿主直挂直接调用；新增 setQuality / stats / dispose
    (
        "  var lastPaint = 0;\n"
        "  function tick(now){\n"
        "    requestAnimationFrame(tick);",
        "  var lastPaint = 0;\n"
        "  var rafId = 0;\n"
        "  function tick(now){\n"
        "    rafId = requestAnimationFrame(tick);",
    ),
    (
        "  // 暴露给调试/截图\n"
        "  window.__preview = {scene:scene, camera:camera, state:state, applyData:applyData, setNight:setNight,\n"
        "    selectModule:selectModule, clearFocus:clearFocus, pickRoot:pickRoot,\n"
        "    loadBackup:loadBackup, computeFromData:computeFromData};",
        "  // 暴露给调试/截图；宿主直挂模式可直接调用，无需 postMessage\n"
        "  var api = window.__preview = {scene:scene, camera:camera, state:state, applyData:applyData, setNight:setNight,\n"
        "    selectModule:selectModule, clearFocus:clearFocus, pickRoot:pickRoot,\n"
        "    loadBackup:loadBackup, computeFromData:computeFromData,\n"
        "    renderer:renderer,\n"
        "    // 运行时调画质：dpr / maxfps 可实时生效（params 需支持 set）\n"
        "    setQuality:function(quality){\n"
        "      quality = quality || {};\n"
        "      try{\n"
        "        if(quality.maxfps && bootQ && typeof bootQ.set === 'function') bootQ.set('maxfps', quality.maxfps);\n"
        "        if(quality.dpr){\n"
        "          renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, quality.dpr));\n"
        "          renderer.setSize(window.innerWidth, window.innerHeight, false);\n"
        "        }\n"
        "      }catch(err){}\n"
        "      return true;\n"
        "    },\n"
        "    stats:function(){ return {fps:fpsValue, dpr:renderer.getPixelRatio(), maxfps:Number(bootQ.get('maxfps'))||0}; },\n"
        "    // 卸载：停掉主循环并释放 GPU 资源（宿主重建场景时调用）\n"
        "    dispose:function(){ try{ cancelAnimationFrame(rafId); renderer.dispose(); }catch(err){} }\n"
        "  };\n"
        "  window.DNS_SCENE = api;\n"
        "  if(typeof window.__dnsSceneOnReady === 'function'){ try{ window.__dnsSceneOnReady(api); }catch(err){} }",
    ),
]

INLINE_MARK = '<script src="vendor/three.min.js"></script>'

SHELL = (
    '<script src="vendor/three.min.js"></script>\n'
    '<script>window.__dnsSceneOpts={ui:true,params:new URLSearchParams(location.search)};</script>\n'
    '<script src="scene.js"></script>'
)

HEADER = (
    "/* ============================================================\n"
    " * scene.js — 3D 微缩送货沙盘场景（P4：从 p0-blockout.html 抽出，可直挂）\n"
    " * ------------------------------------------------------------\n"
    " * - 由 scripts/extract_scene.py 从 p0-blockout.html 的内联脚本抽取并打补丁\n"
    " * - 预览页：p0-blockout.html（OPTS.ui=true，带调试面板）\n"
    " * - 宿主页：js/bg3d.js 直接挂到主页面（OPTS.ui=false，无需 iframe / postMessage）\n"
    " * - 宿主注入点：window.__dnsSceneOpts = {canvas, params, ui}\n"
    " * ============================================================ */\n"
)


def patch_scene(body: str) -> str:
    for old, new in PATCHES:
        n = body.count(old)
        if n != 1:
            raise SystemExit("PATCH FAIL (%d hits): %s" % (n, old.splitlines()[0][:90]))
        body = body.replace(old, new)
    # 注入 OPTS
    old_head = "(function(){\n  'use strict';"
    if body.count(old_head) != 1:
        raise SystemExit("HEAD NOT FOUND")
    body = body.replace(
        old_head,
        "(function(){\n  'use strict';\n  var OPTS = window.__dnsSceneOpts || {};",
    )
    return body


def do_one(html_path: str, scene_out: str):
    with io.open(html_path, encoding="utf-8") as f:
        html = f.read()
    if 'src="scene.js"' in html:
        print("SKIP (already extracted?):", html_path)
        return False
    lines = html.splitlines()
    try:
        anchor = next(i for i, l in enumerate(lines) if INLINE_MARK in l)
    except StopIteration:
        print("SKIP (no three.js anchor):", html_path)
        return False
    # 内联 <script> ... </script> 紧跟其后
    start = anchor + 1
    while start < len(lines) and lines[start].strip() in ('', '<script>'):
        start += 1
    end = next((i for i in range(start, len(lines)) if lines[i].strip() == '</script>'), None)
    if end is None:
        raise SystemExit("inline script end not found: " + html_path)
    body = "\n".join(lines[start:end])
    if not body.lstrip().startswith('(function()'):
        raise SystemExit("unexpected inline script head: " + body[:60])
    body = patch_scene(body)
    with io.open(scene_out, "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER + body + "\n")
    new_lines = lines[:anchor] + SHELL.splitlines() + lines[end + 1:]
    with io.open(html_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(new_lines) + "\n")
    print("OK:", html_path, "->", scene_out)
    return True


def main():
    # 1) assets 版（宿主页真正用的那份）
    assets_html = os.path.join(ASSETS_3D, 'p0-blockout.html')
    assets_scene = os.path.join(ASSETS_3D, 'scene.js')
    if not do_one(assets_html, assets_scene):
        return 0
    # 2) docs 版（独立验证页，自带一份 scene.js 快照）
    docs_html = os.path.join(DOCS_PREVIEW, 'p0-blockout.html')
    docs_scene = os.path.join(DOCS_PREVIEW, 'scene.js')
    if os.path.exists(docs_html):
        do_one(docs_html, docs_scene)
        if os.path.exists(docs_scene):
            shutil.copyfile(assets_scene, docs_scene)
            print("SYNC docs scene.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
