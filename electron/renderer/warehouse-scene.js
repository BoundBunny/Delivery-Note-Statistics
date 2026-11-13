'use strict';
/* Production workspace scene. One instance is reused across business routes. */
window.createDNSWorkspaceScene = function (options) {
  const canvas = document.getElementById('warehouse');
  const host = document.getElementById('scene-surface');
  const markerLayer = document.getElementById('scene-markers');
  if (!window.THREE) throw new Error('本地 3D 引擎未能加载');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, options.pixelRatioCap || 1.6));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = options.shadows !== false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, .1, 160);
  const baseTarget = new THREE.Vector3(16, 0, 12);
  const target = baseTarget.clone(), desiredTarget = baseTarget.clone();
  const viewOffset = new THREE.Vector3(1, 1.36, 1).normalize().multiplyScalar(65);
  const right = new THREE.Vector3(1, 0, -1).normalize();
  const lookPoint = new THREE.Vector3(), projectedPoint = new THREE.Vector3();
  const materials = new Map(), geometries = new Map(), pickables = [], markers = [];
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const colors = { navy: '#304c68', navyDark: '#24364b', gold: '#d6a044', beam: '#d5a557', steel: '#f2f4f5', edge: '#9eafbf', carton: '#cda878' };
  let width = 1, height = 1, desiredHeight = 30, viewHeight = 30;
  let userMotion = options.motion !== false;
  let motion = userMotion && !reducedQuery.matches, night = false, immersive = false, paused = false;
  let frame = 0, last = 0, disposed = false, phase = 0, needsFrame = true;
  let paintedFrames = 0, fps = 0, fpsWindow = performance.now();
  let mouseX = 0, cameraSway = 0, selected = 'orders';
  let fallback = false;
  // 标记内容尺寸快照：-1 = 从未测过（首帧要测）；null = 内容变了、需重测；数组 = 可用缓存。
  // 改写标记文字（addMarker / setOrder / setCatalogCount / setBusinessData）时置 null。
  let contentSizes = -1;
  const ambient = new THREE.AmbientLight('#edf3fa', .4);
  const hemi = new THREE.HemisphereLight('#fffdf8', '#a6b8c9', .5);
  const sun = new THREE.DirectionalLight('#fffaf0', 1.8);
  sun.position.set(-15, 35, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(options.shadowSize || 1024, options.shadowSize || 1024);
  Object.assign(sun.shadow.camera, { left: -29, right: 29, top: 29, bottom: -29, near: 1, far: 90 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -.0006;
  sun.shadow.normalBias = .035;
  const fill = new THREE.DirectionalLight('#dce9f7', .4); fill.position.set(28, 15, -20);
  scene.add(ambient, hemi, sun, fill);

  function material(color, extra) {
    const key = color + JSON.stringify(extra || {});
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color:new THREE.Color(color).convertSRGBToLinear(), roughness: .78, metalness: .05, ...extra }));
    return materials.get(key);
  }
  function box(w, h, d, color, x, y, z, parent = scene, extra) {
    const key = [w, h, d].join(':');
    if (!geometries.has(key)) geometries.set(key, new THREE.BoxGeometry(w, h, d));
    const mesh = new THREE.Mesh(geometries.get(key), material(color, extra));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function cylinder(radius, h, color, x, y, z, parent = scene, segments = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, segments), material(color));
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function sphere(radius, color, x, y, z, parent = scene) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material(color));
    mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function textPlane(text, color, background, w, h, fontSize = 48) {
    const image = document.createElement('canvas'); image.width = 768; image.height = Math.round(768 * h / w);
    const ctx = image.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, image.width, image.height); }
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontSize}px "Microsoft YaHei","Segoe UI",sans-serif`;
    ctx.fillText(text, image.width / 2, image.height / 2 + 2, image.width - 40);
    const texture = new THREE.CanvasTexture(image); texture.encoding = THREE.sRGBEncoding;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
    return mesh;
  }
  function targetGroup(kind, category) {
    const group = new THREE.Group(); group.userData = { kind, category }; scene.add(group); pickables.push(group); return group;
  }

  // Continuous warehouse floor: the workspace is the scene, not a card.
  const floorImage = document.createElement('canvas'); floorImage.width = 2048; floorImage.height = 1536;
  const floorCtx = floorImage.getContext('2d');
  const scaleX = 2048 / 38, scaleZ = 1536 / 28;
  floorCtx.fillStyle = '#e4e9ec'; floorCtx.fillRect(0, 0, 2048, 1536);
  floorCtx.strokeStyle = '#cad4dc'; floorCtx.lineWidth = 1;
  for (let x = 0; x < 38; x += 2) { floorCtx.beginPath(); floorCtx.moveTo(x * scaleX, 0); floorCtx.lineTo(x * scaleX, 1536); floorCtx.stroke(); }
  for (let z = 0; z < 28; z += 2) { floorCtx.beginPath(); floorCtx.moveTo(0, z * scaleZ); floorCtx.lineTo(2048, z * scaleZ); floorCtx.stroke(); }
  floorCtx.fillStyle = '#f4f6f7'; floorCtx.fillRect(1 * scaleX, 2 * scaleZ, 13 * scaleX, 12 * scaleZ);
  floorCtx.fillStyle = '#f2f3ef'; floorCtx.fillRect(18 * scaleX, 2 * scaleZ, 16 * scaleX, 13 * scaleZ);
  floorCtx.strokeStyle = '#d3ae63'; floorCtx.lineWidth = 5;
  floorCtx.strokeRect(18 * scaleX, 2 * scaleZ, 16 * scaleX, 13 * scaleZ);
  floorCtx.setLineDash([18, 13]); floorCtx.strokeStyle = '#f8fafb'; floorCtx.lineWidth = 6;
  floorCtx.beginPath(); floorCtx.moveTo(0, 17 * scaleZ); floorCtx.lineTo(2048, 17 * scaleZ); floorCtx.stroke();
  floorCtx.setLineDash([]);
  function floorText(text, x, z, font = 40, color = '#94a3b1', rotation = 0) {
    floorCtx.save(); floorCtx.translate(x * scaleX, z * scaleZ); floorCtx.rotate(rotation);
    floorCtx.font = `600 ${font}px "Microsoft YaHei",sans-serif`; floorCtx.textAlign = 'center'; floorCtx.fillStyle = color; floorCtx.fillText(text, 0, 0); floorCtx.restore();
  }
  floorText('送 货 作 业 区', 8, 15.5, 40, '#899aa9');
  floorText('商 品 资 料', 26, 16, 38, '#9eaaaf');
  floorText('开 单  ·  核 对  ·  打 印', 16, 25, 40, '#8a9caa');
  floorText('送货宝  /  DELIVERY NOTE', 8.5, 25, 24, '#a7b3bd');
  const floorTexture = new THREE.CanvasTexture(floorImage); floorTexture.encoding = THREE.sRGBEncoding; floorTexture.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(38, 28), new THREE.MeshStandardMaterial({ map: floorTexture, roughness: .94, metalness: .03 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(17, -.035, 12); floor.receiveShadow = true; scene.add(floor);
  box(38, .45, 28, '#d4dde4', 17, -.29, 12);
  box(38, .09, .18, '#c0cdd7', 17, -.01, 26.03);

  // Open industrial shell, bay doors, warning posts, and daylight fixtures.
  box(35, 5.8, .32, '#e8edf0', 15.5, 2.9, -1.95);
  box(35.2, .25, .65, '#d8e0e6', 15.5, 5.78, -1.8);
  for (const x of [-1.7, 7.1, 16, 24.9, 33]) {
    box(.28, 5.9, .6, '#d4dde3', x, 2.9, -1.6);
    box(.35, .12, 1.3, '#f9faf9', x, 4.9, -.95);
  }
  // The loading doors are scenery, never aliases for an arbitrary saved order.
  const dock = new THREE.Group();scene.add(dock);
  for (const [i, x] of [4.2, 11.2].entries()) {
    box(5.8, 4.6, .25, '#bac7d2', x, 2.3, -1.68, dock);
    box(5.45, 4.25, .06, '#e0e6eb', x, 2.25, -1.51, dock);
    for (let y = .28; y < 4.45; y += .29) box(5.47, .025, .035, '#c1cdd7', x, y, -1.455, dock);
    box(5.85, .18, .27, '#a6b5c3', x, 4.58, -1.44, dock);
    for (const side of [-1, 1]) box(.19, 4.5, .32, '#8fa1b1', x + side * 2.83, 2.25, -1.5, dock);
    const label = textPlane('0' + (i + 1), '#718497', '#e5ebef', 1.3, .65, 210); label.position.set(x, 5.05, -1.43); dock.add(label);
    for (const side of [-1, 1]) {
      cylinder(.14, 1.05, colors.gold, x + side * 3.15, .525, -.8);
      cylinder(.145, .17, '#435467', x + side * 3.15, .62, -.8);
      cylinder(.145, .17, '#435467', x + side * 3.15, .27, -.8);
    }
    box(5.2, .12, 1.2, '#9aaab8', x, .06, -.45, dock);
  }
  for (let i = 0; i < 4; i++) {
    box(4.5, .8, .09, '#c3d7e5', 20 + i * 3.1, 4.5, -1.74);
    box(4.5, .04, .13, '#fafbfc', 20 + i * 3.1, 4.1, -1.69);
  }

  const cartonLabel = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160; const ctx = c.getContext('2d');
    ctx.fillStyle = '#f8f6ef'; ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = '#6c7b87'; ctx.font = '600 26px "Microsoft YaHei","Segoe UI"'; ctx.fillText('送货宝', 17, 34);
    ctx.font = '15px "Segoe UI"'; ctx.fillText('DELIVERY NOTE', 17, 59);
    let x = 18; for (let i = 0; i < 35; i++) { const w = i % 3 ? 2 : 4; ctx.fillRect(x, 80, w, 44); x += w + (i % 2 ? 3 : 2); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide });
  })();
  function carton(x, y, z, w = 1, h = .85, d = .85, pale = false, parent = scene) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    box(w, h, d, pale ? '#e7e9e8' : '#cda878', 0, h / 2, 0, g);
    box(w + .014, .018, .12, pale ? '#b6c6d2' : '#dbc298', 0, h + .008, 0, g);
    box(.11, h, .015, pale ? '#c4d2dc' : '#dac096', 0, h / 2, d / 2 + .009, g);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(w * .42, h * .45), cartonLabel); label.position.set(-w * .18, h * .58, d / 2 + .021); g.add(label);
    return g;
  }
  function pallet(x, z, w = 2.3, d = 1.85, parent = scene) {
    const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
    for (let i = 0; i < 5; i++) box(w / 5 - .05, .12, d, '#b79a76', -w / 2 + (i + .5) * w / 5, .27, 0, g);
    for (const xx of [-w * .36, 0, w * .36]) box(.23, .2, d * .9, '#9d805f', xx, .11, 0, g);
    return g;
  }

  const categoryPositions = {};
  const categories = [
    ['snack','休闲零食','#d6a04b'], ['drink','酒水饮料','#7599b2'], ['candy','糖果巧克力','#bd8b97'],
    ['grain','粮油副食','#8ba791'], ['daily','日用百货','#9b9eb7'], ['tobacco','香烟烟草','#a392ab'],
  ];
  categories.forEach(([category, label, accent], i) => {
    const row = Math.floor(i / 3), column = i % 3, x = 20.1 + column * 4.8, z = 2.7 + row * 6.1;
    const g = targetGroup('products', category); g.position.set(x, 0, z); categoryPositions[category] = new THREE.Vector3(x, 1.4, z);
    box(4.2, .09, 2.7, '#e2e8ec', 0, .02, 0, g);
    for (const xx of [-1.95, 1.95]) for (const zz of [-1.05, 1.05]) {
      box(.13, 5.5, .14, colors.navy, xx, 2.75, zz, g);
      box(.27, .17, .3, '#677d8f', xx, .11, zz, g);
    }
    for (const y of [.35, 1.9, 3.45, 5]) {
      box(4, .13, 2.25, '#e9edef', 0, y, 0, g);
      box(4.03, .19, .11, colors.beam, 0, y + .02, 1.13, g);
      box(4.03, .13, .11, colors.navy, 0, y + .02, -1.13, g);
      if (y < 4.5) {
        for (let j = 0; j < 3; j++) carton(-1.25 + j * 1.25, y + .08, .15, 1.04, .82 + (j + i) % 2 * .22, 1.55, (i + j) % 3 !== 0, g);
      }
    }
    for (const y of [1, 2.55, 4.1]) box(.04, 1.45, .05, '#8da0b0', -1.93, y, 0, g).rotation.x = .9;
    box(1.2, .65, .09, accent, 1.4, 4.93, 1.26, g);
    const code = textPlane(['A1','A2','A3','B1','B2','B3'][i], '#fff', accent, 1.05, .5, 220); code.position.set(1.4, 4.93, 1.32); g.add(code);
    const categoryLabel = textPlane(label, '#667c8e', '#f6f8f9', 2.2, .35, 66); categoryLabel.position.set(-.65, 5.37, 1.18); g.add(categoryLabel);
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6), new THREE.MeshBasicMaterial({ color: '#8194a5', opacity: .04, transparent: true, depthWrite: false }));
    shade.rotation.x = -Math.PI / 2; shade.position.set(0, .025, 0); g.add(shade);
  });

  const truck = targetGroup('orders'); truck.position.set(9, 0, 10.6);
  box(3.1, 2.7, 5.8, '#f6f8fa', 0, 2, -.8, truck);
  box(3.16, .15, 5.86, '#e1e7ed', 0, 3.42, -.8, truck);
  box(3.11, .15, 5.82, '#d7e0e8', 0, .64, -.8, truck);
  box(.025, .22, 5.6, colors.gold, 1.57, 1.9, -.8, truck);
  box(.025, .035, 5.6, '#afc0cf', 1.57, 2.18, -.8, truck);
  box(3.2, 2.1, 2.1, colors.navyDark, 0, 1.55, 3.2, truck);
  box(2.85, .8, .055, '#b1cfdf', 0, 2.02, 4.28, truck);
  box(.06, .7, 1.35, '#a8c9de', 1.63, 2.06, 3.25, truck);
  box(.04, .7, .03, '#506b80', 1.67, 2.06, 3.25, truck);
  box(3.28, .24, .3, '#9dadba', 0, .64, 4.3, truck);
  for (const side of [-1, 1]) {
    box(.43, .22, .06, '#fff1c5', side * 1.09, 1.02, 4.33, truck);
    box(.08, .45, .25, '#41596e', side * 1.85, 2.05, 3.7, truck);
    box(.32, .07, .14, '#8e9eac', side * 1.65, 2.22, 3.7, truck);
    for (const z of [-2.8, -.9, 3.1]) {
      const wheel = cylinder(.49, .36, '#374b5d', side * 1.53, .49, z, truck, 18); wheel.rotation.z = Math.PI / 2;
      const hub = cylinder(.24, .38, '#a5b1bb', side * 1.54, .49, z, truck, 16); hub.rotation.z = Math.PI / 2;
    }
  }
  const truckSign = textPlane('送货宝', '#c79642', '#f4f6f8', 2.25, .95, 230); truckSign.rotation.y = Math.PI / 2; truckSign.position.set(1.59, 2.62, -.7); truck.add(truckSign);
  const truckSub = textPlane('送货有单 · 统计有数', '#8a9cab', null, 3.4, .35, 62); truckSub.rotation.y = Math.PI / 2; truckSub.position.set(1.6, 2.03, -.7); truck.add(truckSub);
  box(2.7, 2.32, .025, '#dfe7ed', 0, 2, -3.72, truck);
  box(.025, 2.25, .05, '#b8c6d1', 0, 2, -3.74, truck);

  for (const [x, z, pale] of [[11,5,false],[14,6,true],[12.5,8.8,false],[17,12,true],[24,15,true]]) {
    const p = pallet(x, z); for (let layer = 0; layer < 2; layer++) for (let j = 0; j < 2; j++) carton(-.57 + j * 1.14, .35 + layer * .9, 0, 1.02, .82, 1.55, pale, p);
  }

  function forklift(x, z, rotation = 0) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotation; scene.add(g);
    box(1.8, .85, 2.5, colors.navy, 0, .68, 0, g);
    box(1.9, .65, .8, colors.gold, 0, 1.02, -.9, g);
    box(1.45, .22, 1.4, '#38546c', 0, 1.35, .1, g);
    for (const side of [-1, 1]) {
      const wheel = cylinder(.37, .27, '#35495b', side * .91, .37, .65, g); wheel.rotation.z = Math.PI / 2;
      const back = cylinder(.28, .25, '#35495b', side * .77, .28, -.8, g); back.rotation.z = Math.PI / 2;
      box(.1, 2.1, .1, '#344f66', side * .68, 1.9, -.2, g);
      box(.13, 2.4, .15, '#4c667b', side * .63, 1.7, 1.28, g);
      box(.15, .08, 1.9, '#a8b5bf', side * .53, .28, 2, g);
    }
    box(1.75, .12, 1.8, colors.navy, 0, 2.95, .15, g);
    box(1.4, .13, .13, '#a9b7c2', 0, 2.8, 1.28, g);
    box(.58, .68, .37, '#516678', 0, 1.57, -.2, g);
    sphere(.2, '#d3b99d', 0, 2.23, .16, g);
    box(.48, .6, .4, '#e5e9e8', 0, 1.84, .15, g);
    const cap = cylinder(.22, .1, colors.gold, 0, 2.4, .15, g);
    box(.2, .2, .48, colors.navy, -.13, 1.46, .35, g);
    box(.2, .2, .48, colors.navy, .13, 1.46, .35, g);
    return g;
  }
  const lift = forklift(14.1, 13.8, Math.PI / 2);
  const liftPallet = pallet(0, 2.1, 1.7, 1.45, lift);
  carton(0, .36, 0, 1.5, 1.15, 1.2, false, liftPallet);
  forklift(28.5, 13.5, -Math.PI / 2);

  // The packing desk is the "new delivery note" entry, not a fake picking task.
  const packing = targetGroup('new'); packing.position.set(14, 0, 21.2);
  box(6.4, .15, 2.3, '#d2bd9d', 0, 1.35, 0, packing);
  for (const x of [-2.8, 2.8]) for (const z of [-.85, .85]) box(.14, 1.35, .14, colors.navy, x, .67, z, packing);
  box(6.1, .1, 1.8, '#c6d0d9', 0, .4, 0, packing);
  carton(-2, 1.44, .15, 1.15, .78, .95, false, packing);
  carton(-.5, 1.44, .15, 1.2, .6, 1, true, packing);
  box(.6, .03, .85, '#f9faf8', 1.2, 1.45, -.35, packing);
  box(.55, .01, .11, colors.gold, 1.2, 1.475, -.6, packing);
  for (let i = 0; i < 4; i++) box(.4, .01, .018, '#b6c3cf', 1.2, 1.48, -.4 + i * .12, packing);
  box(.48, .45, .33, '#3f566c', 2.4, 1.65, -.45, packing);
  const monitor = box(.57, .4, .08, '#d7e6ef', 2.4, 1.95, -.4, packing); monitor.rotation.x = -.1;
  for (let i = 0; i < 8; i++) cylinder(.09, 2.9, '#b9c7d2', 4 + i * .3, 1.1, 0, packing).rotation.x = Math.PI / 2;
  box(2.6, .14, 2.8, colors.navy, 5.1, 1, 0, packing);
  carton(4.8, 1.14, 0, .9, .75, .9, true, packing);
  function person(x, z, angle) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = angle; scene.add(g);
    for (const xx of [-.14, .14]) {
      box(.2, .8, .24, '#3c566d', xx, .46, 0, g);
      box(.23, .13, .43, '#35495c', xx, .1, .07, g);
    }
    box(.62, .75, .39, '#e7ecee', 0, 1.19, 0, g);
    box(.1, .72, .43, colors.gold, -.18, 1.19, 0, g);
    box(.1, .72, .43, colors.gold, .18, 1.19, 0, g);
    sphere(.23, '#cfb495', 0, 1.88, 0, g);
    cylinder(.255, .12, '#eef2f4', 0, 2.04, 0, g);
    const arm = box(.17, .65, .18, '#cdb194', -.4, 1.25, .18, g); arm.rotation.x = -.7;
    const arm2 = box(.17, .65, .18, '#cdb194', .4, 1.25, .18, g); arm2.rotation.x = -.7;
    box(.5, .05, .65, colors.navy, 0, 1.17, .65, g);
  }
  person(13.5, 23.1, Math.PI);
  person(7.1, 16.5, -Math.PI / 4);

  // Business destinations on the board: accounting podium and local settings desk.
  const accounting=targetGroup('stats');accounting.position.set(22.5,0,23.2);
  box(4.5,.18,2.9,'#e3e9ed',0,.09,0,accounting);
  const accountBars=[];
  [-1.25,0,1.25].forEach((x,i)=>{const bar=box(.8,1,.8,['#d6a044','#7d96ad','#a8b6c4'][i],x,.65,0,accounting);accountBars.push(bar);});
  const accountSign=textPlane('统计 / 对账','#718497','#f6f8f9',3.1,.38,85);accountSign.position.set(0,.36,1.48);accounting.add(accountSign);
  const settingsDesk=targetGroup('settings');settingsDesk.position.set(23.5,0,17.4);
  box(2.7,.14,1.4,'#d2bd9d',0,1.25,0,settingsDesk);
  for(const x of [-1.08,1.08])box(.12,1.25,1,'#526c82',x,.62,0,settingsDesk);
  box(.18,.5,.18,'#667f94',0,1.55,-.12,settingsDesk);
  box(1.72,1.05,.12,'#304c68',0,2,-.15,settingsDesk);
  const screenLabel=textPlane('送货宝 · 本机设置','#fbf3e3','#24364b',1.52,.83,80);screenLabel.position.set(0,2,-.07);settingsDesk.add(screenLabel);
  box(.95,.025,.38,'#f3f5f6',0,1.34,.38,settingsDesk);

  // A customer handover point makes the client database a spatial destination.
  const customer = targetGroup('customers'); customer.position.set(31.8, 0, 21.2);
  box(4.8, 3.2, 3.6, '#f1efea', 0, 1.6, 0, customer);
  box(4.95, .18, 3.75, '#d9dcd8', 0, 3.3, 0, customer);
  box(4.6, .68, .12, colors.navyDark, 0, 2.85, 1.86, customer);
  const shopSign = textPlane('客户交付', '#f8f5ec', colors.navyDark, 3, .48, 92); shopSign.position.set(0, 2.86, 1.94); customer.add(shopSign);
  for (let i = 0; i < 7; i++) box(.69, .08, 1.25, i % 2 ? '#faf8ed' : colors.gold, -2.05 + i * .69, 2.46, 2, customer).rotation.x = .12;
  box(1.5, 2.2, .1, '#8faabb', 1.25, 1.2, 1.84, customer);
  box(1.8, 1.15, .1, '#b0c9d6', -1.15, 1.6, 1.84, customer);
  box(.06, 2.15, .15, '#e6ecee', 1.25, 1.2, 1.92, customer);
  for (const x of [-2.2, 2.2]) {
    box(.55, .43, .55, '#ac947b', x, .22, 2, customer);
    sphere(.37, '#7a9f8b', x, .72, 2, customer);
  }
  for (const [x, z] of [[-1,18],[-1,22],[-1,25],[35,18],[35,23]]) {
    cylinder(.13, 1.5, '#a08c76', x, .75, z);
    sphere(.86, '#91b19d', x, 2.1, z);
    sphere(.6, '#a0bdab', x-.3, 2.6, z+.1);
  }

  const focusOutline = new THREE.Group(); scene.add(focusOutline);
  function selectionRect(w, d) {
    while (focusOutline.children.length) {
      const c = focusOutline.children.pop(); c.parent = null;
    }
    for (const xx of [-1, 1]) for (const zz of [-1, 1]) {
      box(.07, .035, .9, '#dca747', xx * w / 2, .11, zz * (d / 2 - .45), focusOutline);
      box(.9, .035, .07, '#dca747', xx * (w / 2 - .45), .11, zz * d / 2, focusOutline);
    }
  }
  selectionRect(4, 9.1); focusOutline.position.set(9, 0, 10.6);

  const markerSpecs = [
    { kind:'orders', point:new THREE.Vector3(9,4.8,11.2), icon:'file', title:'当前送货单', label:'', active:true },
    { kind:'products', point:new THREE.Vector3(24.8,8.4,1), icon:'box', title:'商品资料', label:'0 种' },
    { kind:'new', point:new THREE.Vector3(14,2.75,21.2), icon:'plus', title:'开单工作台', label:'' },
    { kind:'customers', point:new THREE.Vector3(31.8,5.2,21.2), icon:'people', title:'往来客户', label:'0 位' },
    { kind:'stats', point:new THREE.Vector3(22.5,4.4,23.2), icon:'chart', title:'统计对账', label:'' },
    { kind:'settings', point:new THREE.Vector3(23.5,3.4,17.4), icon:'settings', title:'本机设置', label:'' },
    ...categories.map(([category,title],i)=>({kind:'products',category,point:new THREE.Vector3(categoryPositions[category].x,5.9,categoryPositions[category].z+.6),icon:'box',title,label:'0',compact:true})),
  ];
  for (const spec of markerSpecs) {
    // 固定工作台里所有标签统一成白色胶囊；卡车(orders) 的活动高亮只在沉浸式场景里使用。
    const active = !!spec.active && !options.fixedPanels;
    const el = document.createElement('button'); el.className = 'scene-marker' + (active ? ' active' : '') + (spec.compact?' category-marker':'');
    el.dataset.sceneModule = spec.kind;
    el.hidden = !!options.fixedPanels && (!!spec.category || spec.kind==='stats');
    el.setAttribute('aria-label',spec.title);
    if(spec.category)el.dataset.sceneCategory=spec.category;
    // 标签文字用独立的 textContent 写入，不再依赖 innerHTML 里嵌套的 <span>。
    // 原因：<button> 内不能再放交互内容，部分环境/回流下嵌套内联 span 的文字会整段塌陷成空，
    // 表现为「白胶囊+图标在、文字没了」。改用一个带类名的块级文字容器，结构更稳、可预期。
    // 注意：分类标记（compact）在多分类时可达上百个，innerHTML 解析会成倍放大初始化开销，
    // 这类简单标签改用 createElement 拼装；只有模块标签（含 halo）保留 innerHTML。
    if (spec.compact) {
      const svgNs='http://www.w3.org/2000/svg';
      const svg=document.createElementNS(svgNs,'svg');
      const use=document.createElementNS(svgNs,'use'); use.setAttribute('href','#i-'+spec.icon); svg.appendChild(use);
      const num=document.createElement('span'); num.className='marker-number';
      el.append(svg,num);
    } else {
      const text = `<span class="marker-text"><span class="marker-title"></span><small></small></span>`;
      el.innerHTML = `<svg><use href="#i-${spec.icon}"/></svg>${text}<span class="marker-number"></span>${active?'<i class="marker-halo"></i>':''}`;
    }
    // 通过 textContent 赋值（自动转义标题里的特殊字符，也更便于后续 write/setOrder 定位更新）。
    const titleEl = el.querySelector('.marker-title');
    if (titleEl) titleEl.textContent = spec.title;
    const smallEl = el.querySelector('small');
    if (smallEl) smallEl.textContent = active ? '点击查看单据明细' : (spec.compact ? '' : '点击打开模块窗口');
    const numEl = el.querySelector('.marker-number');
    if (numEl) numEl.textContent = spec.label;
    el.addEventListener('click', () => options.onSelect(spec.kind,spec.category)); markerLayer.appendChild(el); markers.push({ ...spec, el });
    contentSizes = null; // 新增标记后内容尺寸要重测
  }

  function paintOnce() {
    // 暂停/单帧模式下也需要能立刻画一帧：窗口缩放、显隐切换后画布缓冲会被清空，
    // 如果不补这一帧，画布就只剩空白，而 DOM 标签还在（表现为“场景空白只剩标签”）。
    if (disposed || document.hidden) return;
    try { updateCamera(1); renderer.render(scene, camera); updateMarkers(); needsFrame = false; } catch (_) { /* ignore */ }
  }
  function size() {
    width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, options.pixelRatioCap || 1.6));
    renderer.setSize(width, height, false);
    desiredHeight = width < 700 ? 38 : width < 1150 ? 33 : 30;
    if (paused) paintOnce(); else invalidate();
  }
  function updateCamera(dt) {
    target.lerp(desiredTarget, motion ? Math.min(1, dt * 3.5) : 1);
    viewHeight += (desiredHeight - viewHeight) * (motion ? Math.min(1, dt * 4) : 1);
    const aspect = width / height, half = viewHeight / 2;
    camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
    const offset = width < 700 ? -1.8 : immersive ? 1 : 6;
    const look = lookPoint.copy(target).addScaledVector(right, offset);
    cameraSway += ((motion ? mouseX : 0) - cameraSway) * Math.min(1, dt * 3);
    camera.position.copy(look).add(viewOffset).addScaledVector(right, cameraSway * .2);
    camera.lookAt(look); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  function measureMarkers() {
    contentSizes = markers.map(marker => ({ h: marker.el.offsetHeight, w: marker.el.offsetWidth }));
    return contentSizes;
  }
  function updateMarkers() {
    const toolRow=document.querySelector('.scene-tool-row');
    const safeTop=toolRow ? toolRow.offsetTop+toolRow.offsetHeight+10 : 195;
    // 只有内容变化（或首次）才测一次；纯相机动画帧直接复用快照，不再触发布局。
    const sizes = (contentSizes && contentSizes !== -1) ? contentSizes : measureMarkers();
    const heights=sizes.map(size=>size.h);
    const widths=options.fixedPanels?sizes.map(size=>size.w):[];
    const hostRect=options.fixedPanels?host.getBoundingClientRect():null;
    const dispatch=options.fixedPanels?document.getElementById('dispatch-panel').getBoundingClientRect():null;
    const statistics=options.fixedPanels?document.getElementById('statistics-panel').getBoundingClientRect():null;
    const placed=[];
    for (let i=0;i<markers.length;i++) {
      const marker=markers[i];if(marker.el.hidden)continue;
      const p = projectedPoint.copy(marker.point).project(camera);
      let x = (p.x + 1) / 2 * width,y = Math.max((1 - p.y) / 2 * height,safeTop+heights[i]);
      if(options.fixedPanels){
        const half=widths[i]/2;
        x=Math.min(statistics.left-hostRect.left-half-15,Math.max(dispatch.right-hostRect.left+half+15,x));
        y=Math.max(150,Math.min(height-55,y));
        for(const previous of placed)if(Math.abs(x-previous.x)<half+previous.half+12&&Math.abs(y-previous.y)<heights[i]+12)y=Math.max(150,previous.y-heights[i]-18);
        placed.push({x,y,half});
      }
      // 投影偶尔可能得到 NaN（相机矩阵尚未稳定/尺寸为 0 的瞬间）。绝不能把 NaN 写进 style，
      // 否则标签会渲染到非法坐标而“消失”。
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      // 固定工作台标签一律可见；仅在沉浸式场景里按投影深度/边界显隐。
      const visible = options.fixedPanels ? true : (p.z > -1 && p.z < 1 && x > 30 && x < width - 30 && y > (width<700?270:195) && y < height - 40);
      // 用 transform 平移来摆放，而不写 left/top：
      // .scene-marker 的基础样式是 position:absolute;transform:translate(-50%,-100%)，
      // 它相对“最近的定位祖先”定位；#scene-markers 只是 .scene-markers{position:absolute;
      // inset:0;pointer-events:none} 的绝对层，正常情况下它就是定位参照（inset:0 撑满
      // .scene-surface）。用 translate 把标签移到投影点 (x,y) 是唯一不受包含块影响、且
      // 与旧版表现一致的写法（旧版本就靠 translate(-50%,-100%) 摆位置）。
      marker.el.style.left = '0';
      marker.el.style.top = '0';
      marker.el.style.right = 'auto';
      marker.el.style.bottom = 'auto';
      if(options.fixedPanels){
        // left/top 保持 0，用 translate 把标签中心挪到投影点 (x,y)，向上让 9px 让指针指向实体。
        marker.el.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%,-100%) translateY(-9px)';
        marker.el.style.opacity = '1';
        marker.el.style.pointerEvents = 'auto';
      } else {
        marker.el.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%,-100%)';
        marker.el.style.opacity = visible ? '1' : '0';
        marker.el.style.pointerEvents = visible ? 'auto' : 'none';
      }
    }
  }
  function invalidate() { needsFrame = true; if (!frame && !disposed && !paused && !document.hidden) frame = requestAnimationFrame(tick); }
  function tick(now) {
    frame = 0;
    if (disposed || paused || document.hidden || (!motion && !needsFrame)) return;
    if (motion) frame = requestAnimationFrame(tick);
    if (motion && now - last < 1000 / (options.maxFPS || 30) - 2) return;
    const dt = Math.min(.05, (now - last) / 1000 || .016); last = now;
    if (motion) phase += dt;
    updateCamera(dt);
    lift.position.x = 14.1 + (motion ? Math.sin(phase * .3) * .12 : 0);
    if (selected === 'orders') focusOutline.children.forEach(c => { c.material.emissive?.setScalar(motion ? .04 + Math.sin(phase * 2) * .02 : 0); });
    renderer.render(scene, camera); updateMarkers(); needsFrame = false;
    paintedFrames++;if(now-fpsWindow>=500){fps=Math.round(paintedFrames*1000/(now-fpsWindow));paintedFrames=0;fpsWindow=now;}
  }
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  function pick(event) {
    const r = canvas.getBoundingClientRect(); ndc.set((event.clientX-r.left)/r.width*2-1, -(event.clientY-r.top)/r.height*2+1);
    raycaster.setFromCamera(ndc, camera);
    // Respect visible scenery as an occluder; do not click through a closed door.
    const hits = raycaster.intersectObjects(scene.children, true);
    for(const hit of hits){
      let node=hit.object,root=null,visible=true;
      while(node){if(!node.visible){visible=false;break;}if(node.userData.kind&&!root)root=node;node=node.parent;}
      if(visible)return root;
    }
    return null;
  }
  const onPointerMove = event => {
    if(disposed)return;
    // 即使场景因打开任务面板而暂停渲染，可见的 3D 区域仍要能正确反馈光标，
    // 否则光标会停留在上一次命中的“手型”上，且点击其他物体无反应。
    const hit = pick(event); canvas.style.cursor = hit ? 'pointer' : 'default';
    if(!paused) mouseX = event.clientX / Math.max(1, innerWidth) - .5;
  };
  const onPointerDown = event => { if(!disposed)down = { x:event.clientX,y:event.clientY }; };
  const onPointerUp = event => {
    if (down && Math.hypot(event.clientX-down.x,event.clientY-down.y)<6) { const hit=pick(event); if(hit)options.onSelect(hit.userData.kind, hit.userData.category); }
    down = null;
  };
  // 指针移出画布时恢复默认光标，避免离开后残留手型
  const onPointerLeave = () => { if(!disposed) canvas.style.cursor = 'default'; };
  canvas.addEventListener('pointermove',onPointerMove);
  canvas.addEventListener('pointerdown',onPointerDown);
  canvas.addEventListener('pointerup',onPointerUp);
  canvas.addEventListener('pointerleave',onPointerLeave);
  const resizeObserver = new ResizeObserver(size); resizeObserver.observe(host);
  const visibilityChanged = () => { if(document.hidden){cancelAnimationFrame(frame);frame=0;}else{last=performance.now();invalidate();} };
  const motionChanged = () => { motion=userMotion&&!reducedQuery.matches;invalidate(); };
  // 应用窗口放大/缩小或显卡驱动抖动可能导致 WebGL 上下文丢失；恢复后必须补画一帧，
  // 否则会出现“3D 场景空白、只剩 DOM 标签”的现象。
  const contextLost = event => { if(event && event.preventDefault) event.preventDefault(); cancelAnimationFrame(frame); frame=0; console.warn('[3D] WebGL 上下文丢失，等待恢复'); };
  const contextRestored = () => { console.info('[3D] WebGL 上下文已恢复，重绘场景'); needsFrame=true; last=performance.now(); paintOnce(); if(!paused) invalidate(); };
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  document.addEventListener('visibilitychange', visibilityChanged);
  reducedQuery.addEventListener('change', motionChanged);
  size(); updateCamera(1); document.getElementById('scene-loading').hidden = true; invalidate();
  return {
    // 重置视角（focus('home')）后，DOM 标记的位置/透明度需要在相机稳定后重新计算。
    // 否则在不连续渲染（motion 关闭或场景暂停）时，标记会停留在旧的投影状态而显示异常/消失。
    reshowMarkers(){
      // 重置视角后立即重算一次投影位置并刷新固定工作台标签，避免在“不连续渲染
      // （motion 关闭或场景暂停）”时标签停留在旧的/非法的投影状态而显示异常/消失。
      contentSizes = -1;
      try { updateCamera(1); updateMarkers(); } catch (_) {}
      if(options.fixedPanels){
        // 兜底：updateMarkers 若因异常没跑完，至少别让标签保持不可见。
        // 位置一律交给 updateMarkers（它按投影 x/y 摆位），这里只强制透明度/可交互。
        for(const m of markers){
          if(m.el.hidden) continue;
          m.el.style.opacity = '1';
          m.el.style.pointerEvents = 'auto';
        }
      }
      invalidate();
    },
    focus(kind, category) {
      selected=kind; focusOutline.visible=true;
      const homeLike=kind==='home'||kind==='orders';
      markers.forEach(marker=>marker.el.classList.toggle('active',marker.kind===(homeLike?'orders':kind)));
      if(kind==='products'){
        const p=categoryPositions[category] || new THREE.Vector3(24,1,6);
        desiredTarget.copy(p).add(new THREE.Vector3(-3,-1,5));selectionRect(category?4.5:14.1,category?3:9.8);focusOutline.position.set(category?p.x:24.9,0,category?p.z:5.6);
      }else if(kind==='customers'){
        desiredTarget.set(26,0,18);selectionRect(5.4,4.4);focusOutline.position.set(31.8,0,21.2);
      }else if(kind==='new'){
        desiredTarget.set(15,0,15);selectionRect(7,3);focusOutline.position.set(14,0,21.2);
      }else if(kind==='stats'){
        desiredTarget.copy(baseTarget);selectionRect(5,3.4);focusOutline.position.set(22.5,0,23.2);
      }else if(kind==='settings'){
        desiredTarget.copy(baseTarget);selectionRect(3.3,2);focusOutline.position.set(23.5,0,17.4);
      }else{desiredTarget.copy(baseTarget);selectionRect(4,9.1);focusOutline.position.set(9,0,10.6);focusOutline.visible=kind==='orders'||kind==='home';}
      invalidate();
    },
    setOrder(order){markers[0].el.querySelector('.marker-number').textContent=order?order.no:'暂无送货单';markers[0].el.querySelector('small').textContent=order?'点击查看单据明细':'点击进入单据工作台';contentSizes=null;invalidate();},
    setCatalogCount(count){markers[1].el.querySelector('.marker-number').textContent=count+' 种';contentSizes=null;},
    setBusinessData(data){
      const cash=value=>(Number(value)||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
      const marker=kind=>markers.find(m=>m.kind===kind&&!m.category);
      const write=(kind,label,detail,title)=>{const m=marker(kind);if(!m)return;m.el.querySelector('.marker-number').textContent=label;m.el.querySelector('small').textContent=detail;if(title)m.el.querySelector('.marker-title').textContent=title;m.el.title=[title||m.title,label,detail].filter(Boolean).join(' · ');};
      write('orders',(data.todayCount||0)+' 张','今日金额 ¥'+cash(data.todayAmount),'送货单');
      write('new','新建送货单','选择客户 · 录入货品 · 保存打印');
      write('customers',(data.customerCount||0)+' 位','客户资料与本月往来账单');
      write('stats','¥'+cash(data.monthAmount),(data.month||'本月')+' · '+(data.monthCount||0)+' 张单据');
      write('settings',data.company||'公司信息待填写',data.operator?'制单人 · '+data.operator:'公司资料 · 图片 · 备份恢复');
      for(const m of markers.filter(m=>m.category))m.el.querySelector('.marker-number').textContent=String(data.categoryCounts?.[m.category]||0);
      contentSizes=null;
      const ranking=data.topCustomers||[],max=Math.max(1,...ranking.map(row=>Number(row.total)||0));
      accountBars.forEach((bar,i)=>{const row=ranking[i];bar.visible=!!row&&row.total>0;const h=.45+2.15*((Number(row?.total)||0)/max);bar.scale.y=h;bar.position.y=.2+h/2;});
      invalidate();
    },
    setMotion(value){const next=!!value;if(userMotion===next)return motion;userMotion=next;motion=userMotion&&!reducedQuery.matches;invalidate();return motion;},
    setImmersive(value){if(immersive===!!value)return;immersive=!!value;desiredTarget.copy(baseTarget);invalidate();},
    // 回退提示是否正在显示：显示时应把标记层藏掉，避免“3D 不可用”与残留标签重叠。
    setFallback(value){
      fallback=!!value;
      markerLayer.style.visibility=fallback?'hidden':'';
      return fallback;
    },
    setNight(value){
      if(night===!!value)return night;
      night=!!value;ambient.intensity=night?.2:.4;hemi.intensity=night?.25:.5;sun.intensity=night?.75:1.8;sun.color.set(night?'#c7dbf0':'#fffaf0');
      document.body.classList.toggle('is-night',night);invalidate();return night;
    },
    stats(){return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frame:renderer.info.render.frame,motion,night,paused,disposed,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,fps:motion&&!paused?fps:0};},
    // 窗口尺寸变化后由外部调用：无论动画开/关、暂停与否，立即重画一帧，避免画布空白。
    repaint(){ if(disposed)return; if(paused) paintOnce(); else { needsFrame=true; invalidate(); } },
    project(x,y,z){const p=new THREE.Vector3(x,y,z).project(camera),r=canvas.getBoundingClientRect();return {x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};},
    pause(){paused=true;cancelAnimationFrame(frame);frame=0;},
    resume(){if(disposed||!paused)return;paused=false;last=performance.now();paintedFrames=0;fpsWindow=last;invalidate();},
    dispose(){
      if(disposed)return;disposed=true;paused=true;cancelAnimationFrame(frame);frame=0;resizeObserver.disconnect();
      document.removeEventListener('visibilitychange',visibilityChanged);reducedQuery.removeEventListener('change',motionChanged);
      canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);
      canvas.removeEventListener('pointermove',onPointerMove);canvas.removeEventListener('pointerdown',onPointerDown);canvas.removeEventListener('pointerup',onPointerUp);
      const allGeometries=new Set(geometries.values()),allMaterials=new Set(materials.values()),textures=new Set();
      scene.traverse(object=>{if(object.geometry)allGeometries.add(object.geometry);for(const material of [].concat(object.material||[]))allMaterials.add(material);});
      for(const material of allMaterials){for(const value of Object.values(material))if(value?.isTexture)textures.add(value);material.dispose();}
      for(const geometry of allGeometries)geometry.dispose();for(const texture of textures)texture.dispose();
      sun.shadow.map?.dispose();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();
      markers.forEach(marker=>marker.el.remove());materials.clear();geometries.clear();pickables.length=0;scene.clear();
    },
  };
};
