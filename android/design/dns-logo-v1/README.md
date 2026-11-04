# DNS · 送货单统计 Logo

设计元素：折角单据 + 统计柱形 + 向右送达箭头 + DNS 字母。
中文全名用于完整标志，DNS 同时嵌入应用图标的单据中。
保留项目原有琥珀金，并以深蓝灰提高字母和箭头的辨识度。

- dns-preview.png：设计展示图。
- dns-logo.svg / dns-logo.png：完整标志，背景透明。
- dns-icon.svg / dns-icon-1024.png：应用图标，圆角外部透明。
- dns-icon-{48,72,96,144,192,512}.png：常用尺寸导出。

颜色：琥珀金 #D99A2B；深蓝灰 #24364B；白色 #FFFFFF。
SVG 中所有文字均已转成轮廓，无须安装字体。
图形为原创矢量绘制，没有使用图片生成 API。
已采用为正式 Logo：用于 Android 启动图标、工作台、设置页关于区域及网页版网站图标。
运行 `python android/make_icon.py`（在仓库根目录）可重新同步所有使用中的品牌图片和 Android 图标。

重新导出：在 Windows PowerShell 运行 build-logo.ps1，需 Node.js 与 sharp。
可用 -Node 和 -SharpModule 指定对应可执行文件与模块路径。
