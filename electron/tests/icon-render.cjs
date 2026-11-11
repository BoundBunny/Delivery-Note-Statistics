// 把 SVG 图标光栅化为指定尺寸 PNG（保留圆角透明）。
// 用法：node tests/run-ui.cjs icon-render.cjs <svgPath> <outPng> [size]
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

app.disableHardwareAcceleration();

const svgPath = path.resolve(process.argv[2]);
const outPath = path.resolve(process.argv[3]);
const size = parseInt(process.argv[4] || '512', 10);

app.whenReady().then(async () => {
  const tmp = path.join(os.tmpdir(), `icon-frame-${Date.now()}.html`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    img{display:block;width:${size}px;height:${size}px}
  </style></head><body><img src="${pathToFileURL(svgPath).href}"></body></html>`;
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({
    width: size, height: size, useContentSize: true, show: false,
    frame: false, transparent: true, backgroundColor: '#00000000',
  });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.writeFileSync(outPath, img.toPNG());
  console.log('WROTE', outPath);
  try { fs.unlinkSync(tmp); } catch (_) {}
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
