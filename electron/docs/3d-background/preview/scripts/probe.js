// 诊断：验证 6 分类货架的 Raycaster 命中与实际点击路由。
// 运行： node_modules\electron\dist\electron.exe docs\3d-background\preview\scripts\probe.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.on('window-all-closed', function(){});
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'p0-blockout.html'), { query: { ui: '1', hud: '0' } });
  await new Promise(r => setTimeout(r, 2600));

  const hits = await win.webContents.executeJavaScript(`(function(){
    var t = window.__preview, arr = [];
    for (var x = 440; x <= 1040; x += 10) {
      for (var y = 240; y <= 720; y += 10) {
        var r = t.pickRoot({clientX:x, clientY:y});
        if (r && r.userData && r.userData.cat) arr.push({x:x, y:y, cat:r.userData.cat});
      }
    }
    var rc = document.querySelector('.recent').getBoundingClientRect();
    var pts = [[4.55,8.3],[9.25,8.3],[13.95,8.3],[4.55,14.6],[9.25,14.6],[13.95,14.6]].map(function(p){
      var v = new THREE.Vector3(p[0], 1.2, p[1]).project(t.camera);
      return {wx:p[0], wz:p[1], x:Math.round((v.x*0.5+0.5)*innerWidth), y:Math.round((-v.y*0.5+0.5)*innerHeight)};
    });
    return {hits:arr, recent:{left:rc.left,right:rc.right,top:rc.top,bottom:rc.bottom}, pods:pts};
  })()`);
  console.log('recent:', JSON.stringify(hits.recent));
  console.log('pods:', JSON.stringify(hits.pods));
  console.log('hit count:', hits.hits.length, 'sample:', JSON.stringify(hits.hits.slice(0, 5)));
  const p = hits.hits.filter(h => h.x > 690 && h.y > 322)[0] || hits.hits.filter(h => h.y > 322)[0];
  if (p) {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 1600));
    const img = await win.webContents.capturePage();
    const file = path.join(__dirname, '..', 'shots', 'click-candy.png');
    fs.writeFileSync(file, img.toPNG());
    console.log('clicked at', JSON.stringify(p), 'saved', file);
  }
  app.quit();
});
