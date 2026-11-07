/* ============================================================
 * scene.js — 3D 微缩送货沙盘场景（P4：从 p0-blockout.html 抽出，可直挂）
 * ------------------------------------------------------------
 * - 由 scripts/extract_scene.py 从 p0-blockout.html 的内联脚本抽取并打补丁
 * - 预览页：p0-blockout.html（OPTS.ui=true，带调试面板）
 * - 宿主页：js/bg3d.js 直接挂到主页面（OPTS.ui=false，无需 iframe / postMessage）
 * - 宿主注入点：window.__dnsSceneOpts = {canvas, params, ui}
 * ============================================================ */
(function(){
  'use strict';
  var OPTS = window.__dnsSceneOpts || {};

  /* ============================================================
   * 0. 基础工具
   * ============================================================ */
  var C = {
    base:'#D2DBE8', storage:'#CBD9F5', dock:'#E4D9FB', road:'#C8D3E3',
    store:'#F7E0B4', fore:'#DCE3ED', rack:'#9FB4FF', rackEdge:'#6D80F2',
    carton:'#DDB46F', cartonDark:'#C79C58', pallet:'#B58C55',
    truck:'#F3F7FF', indigo:'#4F46E5', indigoEdge:'#C9D2E2',
    violet:'#7C3AED', amber:'#D97706', green:'#3FA467', city:'#C2CCDC',
    lamp:'#FDE68A', podium:['#93A6FF','#B7C7FF','#D4CFFF']
  };
  var geoCache = {};
  function geo(w,h,d){
    var k=w+'_'+h+'_'+d;
    if(!geoCache[k]) geoCache[k]=new THREE.BoxGeometry(w,h,d);
    return geoCache[k];
  }
  var matCache = {};
  function M(color,opts){
    var k=color+'|'+(opts?JSON.stringify(opts):'');
    if(!matCache[k]) matCache[k]=new THREE.MeshStandardMaterial(Object.assign({
      color:new THREE.Color(color), roughness:0.86, metalness:0.02, flatShading:true
    },opts||{}));
    return matCache[k];
  }
  function box(w,h,d,color,x,y,z,parent){
    var m=new THREE.Mesh(geo(w,h,d),M(color));
    m.position.set(x,y,z);
    (parent||scene).add(m);
    return m;
  }
  // P1：圆角软体块（Extrude 圆角矩形 + 倒角），用于车身/建筑/货架背板等精模主体
  var softCache = {};
  function softBox(w,h,d,color,r,x,y,z,parent){
    r = Math.min(r==null?0.1:r, w/2-0.02, h/2-0.02, Math.abs(d)/2-0.005);
    var key = [w,h,d,r].join('_');
    var g = softCache[key];
    if(!g){
      var s = new THREE.Shape(), sx=-w/2, sy=-h/2;
      s.moveTo(sx+r,sy);
      s.lineTo(sx+w-r,sy); s.quadraticCurveTo(sx+w,sy,sx+w,sy+r);
      s.lineTo(sx+w,sy+h-r); s.quadraticCurveTo(sx+w,sy+h,sx+w-r,sy+h);
      s.lineTo(sx+r,sy+h); s.quadraticCurveTo(sx,sy+h,sx,sy+h-r);
      s.lineTo(sx,sy+r); s.quadraticCurveTo(sx,sy,sx+r,sy);
      g = new THREE.ExtrudeGeometry(s, {depth:Math.abs(d), bevelEnabled:true,
        bevelThickness:r*0.75, bevelSize:r*0.75, bevelSegments:2, curveSegments:4});
      g.center();
      softCache[key] = g;
    }
    var m = new THREE.Mesh(g, M(color));
    m.position.set(x,y,z);
    (parent||scene).add(m);
    return m;
  }
  function makeTextPlane(text, bg, fg, w, h, fontSize){
    var cv=document.createElement('canvas'); cv.width=512; cv.height=160;
    var g=cv.getContext('2d');
    g.fillStyle=bg; rrPath(g,0,0,512,160,28); g.fill();
    g.fillStyle=fg; g.textAlign='center'; g.textBaseline='middle';
    var fs=fontSize||78; g.font='bold '+fs+'px "Microsoft YaHei","PingFang SC",sans-serif';
    while(g.measureText(text).width>456 && fs>26){ fs-=4; g.font='bold '+fs+'px "Microsoft YaHei",sans-serif'; }
    g.fillText(text,256,84);
    var tex=new THREE.CanvasTexture(cv); tex.encoding=THREE.sRGBEncoding;
    var m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
      new THREE.MeshBasicMaterial({map:tex,transparent:true}));
    return m;
  }
  function edges(mesh,color,opacity){
    var e=new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 28),
      new THREE.LineBasicMaterial({color:color||'#B6C2D8',transparent:true,opacity:opacity==null?0.45:opacity})
    );
    mesh.add(e); return e;
  }
  function rrPath(g,x,y,w,h,r){
    g.beginPath();
    g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r);
    g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r);
    g.arcTo(x,y,x+w,y,r); g.closePath();
  }

  /* ============================================================
   * 1. 渲染器 / 场景 / 相机
   * ============================================================ */
  var canvas = (OPTS && OPTS.canvas) || document.getElementById('bg');
  var bootQ = (OPTS && OPTS.params) || new URLSearchParams(location.search);
  var MAX_DPR = Number(bootQ.get('dpr')) || 2;
  var renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, alpha:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, MAX_DPR));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xF4F7FC, 70, 150);

  var TARGET = new THREE.Vector3(22, 2.0, 15);
  var BASE_OFFSET = new THREE.Vector3(1,1,1).normalize().multiplyScalar(62);
  var camera = new THREE.OrthographicCamera(-1,1,1,-1,0.1,220);
  camera.position.copy(TARGET).add(BASE_OFFSET);
  camera.lookAt(TARGET);

  var hemi = new THREE.HemisphereLight(0xEAF2FF, 0xC9D4E5, 0.38); scene.add(hemi);
  var amb  = new THREE.AmbientLight(0xFFFFFF, 0.08); scene.add(amb);
  var dir  = new THREE.DirectionalLight(0xFFF6E8, 0.82);
  dir.position.set(-30, 50, 20); scene.add(dir);
  var fill = new THREE.DirectionalLight(0xDBE7FF, 0.22);
  fill.position.set(45, 28, -25); scene.add(fill);

  /* ============================================================
   * 2. 地面 / 分区
   * ============================================================ */
  var zoneLabelGroup = new THREE.Group(); scene.add(zoneLabelGroup);
  var zoneOutlineGroup = new THREE.Group(); scene.add(zoneOutlineGroup);

  // 底座
  box(46,0.6,32,'#C6D1E0',22,-0.32,14).receiveShadow = false;
  // 地坪
  box(44,0.12,30,C.base,22,-0.04,15);

  function zoneSlab(x,z,w,d,color,label,sub){
    var y=0.05;
    box(w,0.04,d,color,x,y,z);
    // 边界
    var pts=[
      new THREE.Vector3(x-w/2,y+0.03,z-d/2),
      new THREE.Vector3(x+w/2,y+0.03,z-d/2),
      new THREE.Vector3(x+w/2,y+0.03,z+d/2),
      new THREE.Vector3(x-w/2,y+0.03,z+d/2),
      new THREE.Vector3(x-w/2,y+0.03,z-d/2)
    ];
    var g=new THREE.BufferGeometry().setFromPoints(pts);
    var ln=new THREE.Line(g,new THREE.LineDashedMaterial({color:'#A5B4FC',dashSize:0.6,gapSize:0.35,transparent:true,opacity:.65}));
    ln.computeLineDistances();
    zoneOutlineGroup.add(ln);
    if(!label) return;
    var sp=makeLabel(label,sub,'#4F46E5');
    sp.position.set(x, label==='客户门店'?4.2:1.6, z);
    zoneLabelGroup.add(sp);
  }
  zoneSlab(9.25,14.25,14.5,18.5,C.storage,'商品分区 · 6 大类','6 大分类 · 点击查看');
  zoneSlab(23,9.25,13,8.5,C.dock,'月台 · 装车','卷帘门 01 / 02');
  zoneSlab(28.25,18.5,23.5,10,C.road,'场内道路','装车 → 出口');
  zoneSlab(42,17.25,4,12.5,C.road,null);
  zoneSlab(40,7.75,8,6.5,C.store,'客户门店','送达 · 招牌');
  zoneSlab(22,27.5,40,5,C.fore,null);

  /* ============================================================
   * 3. 商品 6 分类货架 / 纸箱（可点击）
   * ============================================================ */
  var CATEGORIES = [
    {key:'snack',   label:'休闲零食类', short:'零食', accent:'#D97706', light:'#FEF3C7', mid:'#FDE68A', x:4.55,  z:8.3},
    {key:'drink',   label:'酒水饮料类', short:'饮料', accent:'#2563EB', light:'#DBEAFE', mid:'#BFDBFE', x:9.25,  z:8.3},
    {key:'candy',   label:'糖果巧克力类', short:'糖果', accent:'#DB2777', light:'#FCE7F3', mid:'#FBCFE8', x:13.95, z:8.3},
    {key:'grain',   label:'粮油副食类', short:'粮油', accent:'#059669', light:'#D1FAE5', mid:'#A7F3D0', x:4.55,  z:14.6},
    {key:'daily',   label:'日用百货类', short:'日用', accent:'#4F46E5', light:'#E0E7FF', mid:'#C7D2FE', x:9.25,  z:14.6},
    {key:'tobacco', label:'香烟烟草类', short:'烟草', accent:'#7C3AED', light:'#EDE9FE', mid:'#DDD6FE', x:13.95, z:14.6}
  ];
  var categoryPods = [];
  var categoryCartonGroups = [];
  var clickTargets = [];

  function buildCategoryPod(cat){
    var g = new THREE.Group();
    g.position.set(cat.x, 0, cat.z);
    g.userData = {module:'products', cat:cat.key, name:cat.label, accent:cat.accent,
                  center:new THREE.Vector3(cat.x,0,cat.z), radius:3.1};

    // 地台 + 背板
    softBox(4.3, 0.12, 2.2, '#FFFFFF', 0.06, 0, 0.06, 0, g);
    var back = softBox(3.9, 2.7, 0.14, cat.mid, 0.07, 0, 1.45, -0.82, g);
    // 四角立柱 + 薄侧板
    [-1,1].forEach(function(sx){
      [-1,1].forEach(function(sz){
        softBox(0.16, 2.7, 0.16, cat.accent, 0.05, sx*1.86, 1.45, sz*0.66, g);
      });
      softBox(0.10, 2.45, 1.72, cat.mid, 0.04, sx*1.92, 1.42, 0, g);
    });
    // 三层隔板 + 前挡边
    [0.55, 1.32, 2.09].forEach(function(y){
      softBox(3.7, 0.09, 1.55, '#FFFFFF', 0.035, 0, y, -0.02, g);
      box(3.7, 0.14, 0.05, cat.mid, 0, y + 0.09, 0.74, g);
      box(3.7, 0.04, 0.05, '#FFFFFF', 0, y + 0.02, 0.765, g);
    });
    // 顶部招牌 + 实体分类牌
    softBox(4.05, 0.56, 0.18, cat.accent, 0.08, 0, 2.95, -0.82, g);
    var sign = makeTextPlane(cat.short, cat.accent, '#FFFFFF', 2.7, 0.4, 74);
    sign.position.set(0, 2.95, -0.715); g.add(sign);
    // 顶部小灯条
    box(3.4, 0.04, 0.04, '#FFFFFF', 0, 3.3, -0.70, g);

    var cg = new THREE.Group(); g.add(cg);
    categoryCartonGroups.push(cg);
    scene.add(g);
    categoryPods.push(g);
    clickTargets.push(g);
    return g;
  }
  CATEGORIES.forEach(buildCategoryPod);

  function buildCategoryCartons(fill){
    categoryPods.forEach(function(g, pi){
      var cg = categoryCartonGroups[pi];
      while(cg.children.length) cg.remove(cg.children[0]);
      var cat = CATEGORIES[pi];
      var n = Math.max(1, Math.round(1 + fill * 4));
      [0.55, 1.32, 2.09].forEach(function(y, si){
        for(var i=0;i<n;i++){
          var bx = -1.45 + i * 0.72;
          if(bx > 1.42) break;
          var h = 0.56 + ((i + si + pi) % 2) * 0.12;
          box(0.62, h, 0.62, (i % 2 ? cat.light : C.carton), bx, y + 0.07 + h/2, -0.12, cg);
          box(0.10, 0.012, 0.58, '#C7A16A', bx, y + 0.07 + h + 0.006, -0.12, cg);
        }
      });
    });
  }

  /* ============================================================
   * 4. 月台 / 货车 / 叉车 / 待装托盘
   * ============================================================ */
  var dock = new THREE.Group(); scene.add(dock);
  dock.userData={module:'orders', name:'单据 · 装车', center:new THREE.Vector3(23,0,10.5), radius:5.6};
  clickTargets.push(dock);
  var dockBody=softBox(13,3,2.2,'#F5F7FC',0.12,23,1.5,5.7,dock);
  box(13.2,0.18,0.30,'#DDE5F2',23,3.06,4.65,dock);
  // 门楣雨棚（只挑出门口，不遮住货车）
  softBox(13.6,0.16,1.5,'#E9EEF8',0.06,23,3.38,6.35,dock);
  [20,26].forEach(function(dx){
    // 门框
    box(0.18,2.35,0.16,'#C7D2FE',dx-2.1,1.25,6.90,dock);
    box(0.18,2.35,0.16,'#C7D2FE',dx+2.1,1.25,6.90,dock);
    box(4.4,0.18,0.16,'#C7D2FE',dx,2.42,6.90,dock);
    // 卷帘门横条
    for(var i=0;i<7;i++){
      box(3.8,0.16,0.05,(i%2?'#D8E0EE':'#E7EDF8'),dx,0.45+i*0.30,6.91,dock);
    }
    // 防撞胶块 + 装卸货唇板
    box(0.28,0.50,0.35,'#334155',dx-1.92,0.30,7.10,dock);
    box(0.28,0.50,0.35,'#334155',dx+1.92,0.30,7.10,dock);
    box(3.7,0.07,1.0,'#AFBCCE',dx,0.06,7.55,dock);
  });
  // 门楣编号
  var d1l=makeLabel('01','卷帘门','#4F46E5'); d1l.position.set(20,3.78,6.95); d1l.scale.set(1.6,.5,1); dock.add(d1l);
  var d2l=makeLabel('02','卷帘门','#4F46E5'); d2l.position.set(26,3.78,6.95); d2l.scale.set(1.6,.5,1); dock.add(d2l);

  function softShadow(x,z,w,d,op){
    var m=new THREE.Mesh(new THREE.PlaneGeometry(w,d), new THREE.MeshBasicMaterial({
      map:shadowTex, transparent:true, opacity:op==null?0.5:op, depthWrite:false
    }));
    m.rotation.x=-Math.PI/2; m.position.set(x,0.08,z); scene.add(m); return m;
  }
  // 阴影贴图
  var shadowTex=(function(){
    var cv=document.createElement('canvas'); cv.width=cv.height=128;
    var g=cv.getContext('2d');
    var gr=g.createRadialGradient(64,64,4,64,64,62);
    gr.addColorStop(0,'rgba(30,38,60,.34)');
    gr.addColorStop(0.55,'rgba(30,38,60,.14)');
    gr.addColorStop(1,'rgba(30,38,60,0)');
    g.fillStyle=gr; g.fillRect(0,0,128,128);
    var t=new THREE.CanvasTexture(cv); t.encoding=THREE.sRGBEncoding; return t;
  })();
  // 底座悬浮投影（在 shadowTex 定义之后）
  (function(){
    var m=new THREE.Mesh(new THREE.PlaneGeometry(68,50), new THREE.MeshBasicMaterial({
      map:shadowTex, transparent:true, opacity:0.5, depthWrite:false
    }));
    m.rotation.x=-Math.PI/2; m.position.set(22,-0.64,15); scene.add(m);
  })();

  function buildTruck(x){
    var g=new THREE.Group(); g.position.set(x,0,10.4);
    // 货箱 + 顶导流罩
    softBox(2.35,2.55,5.0,'#F6F9FF',0.12,0,1.6,0,g);
    softBox(1.9,0.42,4.4,'#E9EFFF',0.1,0,3.05,0.15,g);
    // 侧面品牌条（+X 面，面向相机）
    box(0.02,1.35,3.4,'#E3EBFF',1.18,1.7,0,g);
    box(0.02,0.16,3.4,'#4F46E5',1.185,1.94,0,g);
    box(0.02,0.55,0.55,'#4F46E5',1.19,1.45,-0.35,g);
    // 尾部双门 + 门缝 + 拉手
    box(2.06,2.0,0.05,'#EDF2FC',0,1.55,-2.51,g);
    box(0.03,2.0,0.06,'#C9D2E2',0,1.55,-2.53,g);
    box(0.12,0.06,0.08,'#94A3B8',-0.55,1.2,-2.56,g);
    box(0.12,0.06,0.08,'#94A3B8', 0.55,1.2,-2.56,g);
    // 驾驶室 + 挡风 + 侧窗
    softBox(2.3,1.9,1.7,'#4F46E5',0.12,0,1.3,3.0,g);
    box(2.0,0.68,0.05,'#DCE9FF',0,1.98,3.88,g);
    box(0.05,0.55,0.85,'#DCE9FF',-1.13,1.85,2.95,g);
    box(0.05,0.55,0.85,'#DCE9FF', 1.13,1.85,2.95,g);
    // 后视镜
    [-1,1].forEach(function(sx){
      box(0.06,0.06,0.30,'#475569',sx*1.28,2.10,3.15,g);
      box(0.08,0.28,0.16,'#334155',sx*1.33,2.00,3.27,g);
    });
    // 前灯 + 保险杠
    box(0.34,0.18,0.05,'#FDE68A',-0.72,0.86,3.89,g);
    box(0.34,0.18,0.05,'#FDE68A', 0.72,0.86,3.89,g);
    softBox(2.2,0.22,0.28,'#C9D2E2',0.06,0,0.42,3.92,g);
    // 车轮 + 轮毂
    var wheelGeo=new THREE.CylinderGeometry(0.44,0.44,0.34,16);
    var hubGeo=new THREE.CylinderGeometry(0.19,0.19,0.36,12);
    [[-1.02,1.55],[-1.02,-1.5],[1.02,1.55],[1.02,-1.5]].forEach(function(p){
      var w=new THREE.Mesh(wheelGeo,M('#374151'));
      w.rotation.z=Math.PI/2; w.position.set(p[0],0.44,p[1]); g.add(w);
      var h=new THREE.Mesh(hubGeo,M('#B7C3D6'));
      h.rotation.z=Math.PI/2; h.position.set(p[0]*1.01,0.44,p[1]); g.add(h);
    });
    var lb=makeLabel('SD-20261107-006','送货单 · 装车中','#4F46E5');
    lb.position.set(0,3.55,0.4); lb.scale.set(3.1,.98,1);
    if(x<23) g.add(lb);
    softShadow(x,10.4,3.8,6.4,.55);
    scene.add(g); return g;
  }
  var truck1=buildTruck(20);
  var truck2=buildTruck(26);
  truck1.userData.target=1; truck2.userData.target=1;
  truck1.userData.module='orders'; truck1.userData.center=new THREE.Vector3(20,0,10.4);
  truck2.userData.module='orders'; truck2.userData.center=new THREE.Vector3(26,0,10.4);
  clickTargets.push(truck1, truck2);
  truck2.scale.set(0.001,0.001,0.001);

  // P2：路上配送的小货车（沿道路循环）
  function buildVan(){
    var g=new THREE.Group(); g.position.set(16.5,0,18.4);
    softBox(2.4,1.5,1.35,'#FFFFFF',0.10,-0.15,0.92,0,g);
    softBox(1.20,1.34,1.35,'#4F46E5',0.10,1.50,0.82,0,g);
    box(0.04,0.52,1.10,'#DCE9FF',2.06,1.08,0,g);
    box(1.45,0.45,0.03,'#DCE9FF',0.35,1.10,0.69,g);
    box(0.04,0.18,0.90,'#4F46E5',-1.36,1.18,0,g);
    var wg=new THREE.CylinderGeometry(0.30,0.30,0.22,12);
    [-0.75,1.05].forEach(function(wx){
      [-1,1].forEach(function(wz){
        var w=new THREE.Mesh(wg,M('#374151'));
        w.rotation.x=Math.PI/2; w.position.set(wx,0.30,wz*0.70); g.add(w);
      });
    });
    box(1.9,0.16,0.24,'#C9D2E2',0,0.34,0,g);
    scene.add(g); return g;
  }
  var van=buildVan();
  van.userData={module:'orders', name:'配送中 · 在途', center:new THREE.Vector3(16.5,0,18.4)};
  clickTargets.push(van);

  // 叉车
  var forklift=new THREE.Group(); forklift.position.set(16.6,0,12.2); scene.add(forklift);
  var fbody=box(1.1,0.9,2.0,C.amber,0,0.75,0,forklift); edges(fbody,'#B45309',.5);
  box(0.9,0.55,0.7,'#B45309',0,1.45,0.5,forklift);
  var mast=box(0.12,1.8,0.12,'#475569',-0.5,1.5,-0.85,forklift); edges(mast,'#334155',.5);
  box(0.12,1.8,0.12,'#475569',0.5,1.5,-0.85,forklift);
  var fork=box(1.2,0.1,1.1,'#94A3B8',0,0.55,-1.45,forklift);
  forklift.userData.fork=fork;
  makePallet(0,0.10,0,fork);

  // 待装托盘 / 箱堆
  var dockStackGroup=new THREE.Group(); scene.add(dockStackGroup);
  var STACK_SLOTS=[{x:17.0,z:8.5},{x:27.9,z:8.5},{x:22.4,z:8.2}];
  function makePallet(x,y,z,parent){
    var g=new THREE.Group(); g.position.set(x,y,z);
    for(var i=-2;i<=2;i++) box(1.3,0.07,0.16,C.pallet,0,0,i*0.20,g);
    [-1,1].forEach(function(sx){
      [-1,1].forEach(function(sz){
        box(0.16,0.11,0.16,'#A97F49',sx*0.55,-0.09,sz*0.38,g);
      });
    });
    [-1,1].forEach(function(sz){
      box(1.3,0.07,0.14,'#B58C55',0,-0.15,sz*0.40,g);
    });
    parent.add(g); return g;
  }
  function buildDockStacks(n){
    while(dockStackGroup.children.length){
      dockStackGroup.remove(dockStackGroup.children[0]);
    }
    for(var s=0;s<Math.min(n,STACK_SLOTS.length);s++){
      var slot=STACK_SLOTS[s];
      makePallet(slot.x,0.11,slot.z,dockStackGroup);
      var layers=2+s%2;
      for(var l=0;l<layers;l++){
        for(var k=0;k<2;k++){
          var cw=0.62, chh=0.52, cd=0.5;
          var cx=slot.x-0.34+k*0.68, cy=0.44+l*0.54, cz=slot.z;
          box(cw,chh,cd,(l+k)%2?C.carton:C.cartonDark, cx,cy,cz, dockStackGroup);
          box(cw*0.16,0.012,cd*0.96,'#C7A16A', cx,cy+chh/2+0.006,cz, dockStackGroup);
        }
      }
    }
  }

  /* ============================================================
   * 5. 仓储作业 / 门店 / 环境
   * ============================================================ */
  // 打包台 + 传送带
  var table=box(3.2,1.0,1.6,'#F3F5FA',6.4,0.5,21.0); edges(table,'#C9D2E2',.45);
  var conv=box(3.0,0.8,0.7,'#D7DEE8',9.6,0.4,21.0); edges(conv,'#B6C1D2',.45);
  // P2：传送带条纹（UV 滚动）
  var convTex=(function(){
    var cv=document.createElement('canvas'); cv.width=128; cv.height=32;
    var g=cv.getContext('2d');
    g.fillStyle='#E7ECF5'; g.fillRect(0,0,128,32);
    g.fillStyle='#CDD7E8';
    for(var i=0;i<8;i++) g.fillRect(i*16,0,8,32);
    var t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(4,1); t.encoding=THREE.sRGBEncoding; return t;
  })();
  var convTop=new THREE.Mesh(new THREE.PlaneGeometry(2.9,0.62),
    new THREE.MeshBasicMaterial({map:convTex}));
  convTop.rotation.x=-Math.PI/2; convTop.position.set(9.6,0.815,21.0); scene.add(convTop);
  table.userData={module:'order', name:'开单 · 打包台', center:new THREE.Vector3(7.8,0,21)};
  conv.userData={module:'order', name:'开单 · 打包台', center:new THREE.Vector3(7.8,0,21)};
  clickTargets.push(table, conv);

  // 客户门店
  var storeG=new THREE.Group(); storeG.position.set(40,0,7.6); scene.add(storeG);
  storeG.userData={module:'customers', name:'客户管理 · 门店', center:new THREE.Vector3(40,0,7.6), radius:4.6};
  clickTargets.push(storeG);
  var st=softBox(7,3.1,5.4,'#FDF7EE',0.15,0,1.55,0,storeG);
  box(7.06,0.12,0.22,'#E4C98D',0,3.10,2.56,storeG);
  // 条纹雨棚
  for(var ai=0; ai<8; ai++){
    softBox(0.70,0.13,1.95,(ai%2?'#FFFFFF':C.violet),0.05,-3.05+ai*0.86+(ai===0?0.03:0),2.86,2.05,storeG);
  }
  box(6.7,0.16,0.10,C.violet,0,2.72,1.08,storeG);
  // 店招
  box(4.9,0.92,0.16,'#4F46E5',0,3.42,2.62,storeG);
  // 招牌发光
  var signCanvas=document.createElement('canvas'); signCanvas.width=512; signCanvas.height=128;
  var sg=signCanvas.getContext('2d');
  sg.fillStyle='#4F46E5'; rrPath(sg,0,0,512,128,26); sg.fill();
  sg.fillStyle='#fff'; sg.font='bold 56px "Microsoft YaHei",sans-serif'; sg.textAlign='center';
  sg.fillText('客户门店',256,82);
  var signTex=new THREE.CanvasTexture(signCanvas); signTex.encoding=THREE.sRGBEncoding;
  var signMesh=new THREE.Mesh(new THREE.PlaneGeometry(4.6,1.15),
    new THREE.MeshBasicMaterial({map:signTex,transparent:true}));
  signMesh.position.set(0,3.42,2.72); storeG.add(signMesh);
  // 门 / 窗（带框）
  box(2.05,1.30,0.08,'#FFFFFF',-1.65,1.80,2.72,storeG);
  box(1.85,1.10,0.06,'#BFE0FF',-1.65,1.80,2.77,storeG);
  box(0.08,1.25,0.08,'#FFFFFF',-1.65,1.80,2.70,storeG);
  box(1.55,2.20,0.10,'#FFFFFF',2.00,1.25,2.72,storeG);
  box(1.36,2.00,0.06,'#BFE0FF',2.00,1.25,2.78,storeG);
  box(0.06,0.26,0.08,'#94A3B8',2.55,1.15,2.83,storeG);
  box(1.7,0.10,1.10,'#E6D3AE',2.00,0.10,2.15,storeG);
  // 门口花箱
  [-1,1].forEach(function(sx){
    box(0.62,0.36,0.62,'#C9A472',sx*3.0,0.18,2.55,storeG);
    var sh=new THREE.Mesh(new THREE.IcosahedronGeometry(0.34,0),M('#4EAE78',{flatShading:true}));
    sh.position.set(sx*3.0,0.55,2.55); storeG.add(sh);
  });

  // 树木 / 灌木 / 路灯
  var treePos=[[1.3,2.0],[7.0,1.8],[20.0,1.6],[31.0,1.7],[42.5,27.5],[1.6,27.2],[33.0,27.8]];
  function buildTree(x,z,s){
    var t=new THREE.Group(); t.position.set(x,0,z); s=s||1;
    var trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.11*s,0.16*s,1.7*s,7),M('#8A6D4B'));
    trunk.position.y=0.85*s; t.add(trunk);
    var c1=new THREE.Mesh(new THREE.IcosahedronGeometry(1.0*s,0),M('#3FA467',{flatShading:true}));
    c1.position.y=2.10*s; c1.scale.set(1,0.88,1); t.add(c1);
    var c2=new THREE.Mesh(new THREE.IcosahedronGeometry(0.72*s,0),M('#4EAE78',{flatShading:true}));
    c2.position.set(0.28*s,2.62*s,-0.05); t.add(c2);
    var c3=new THREE.Mesh(new THREE.IcosahedronGeometry(0.60*s,0),M('#35935C',{flatShading:true}));
    c3.position.set(-0.34*s,2.35*s,0.18); t.add(c3);
    scene.add(t);
    softShadow(x,z,2.0*s,1.8*s,.34);
  }
  treePos.forEach(function(p,i){ buildTree(p[0], p[1], 0.82 + (i%3)*0.10); });
  // 前景灌木
  var bushPos=[[5.0,26.6],[10.0,27.2],[14.5,26.5],[19.0,27.0],[24.0,26.6],[29.0,27.1],[36.0,26.6],[39.0,27.2]];
  bushPos.forEach(function(p,i){
    var b=new THREE.Mesh(new THREE.IcosahedronGeometry(0.45+(i%2)*0.12,0),
      M(i%2?'#4EAE78':'#3FA467',{flatShading:true}));
    b.position.set(p[0],0.34,p[1]); b.scale.set(1.2,0.75,1.2); scene.add(b);
  });
  var lampLights=[];
  [[20.0,23.2],[28.0,23.2],[36.0,23.2]].forEach(function(p){
    var g=new THREE.Group(); g.position.set(p[0],0,p[1]);
    var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,3.4,8),M('#94A3B8'));
    pole.position.y=1.7; g.add(pole);
    var head=new THREE.Mesh(geo(0.62,0.14,0.32), new THREE.MeshBasicMaterial({color:0xFDE68A}));
    head.position.set(0,3.44,0); g.add(head);
    var bulb=new THREE.Mesh(new THREE.SphereGeometry(0.2,10,10),new THREE.MeshBasicMaterial({color:0xFDE68A,transparent:true,opacity:.55}));
    bulb.position.y=3.44; g.add(bulb); lampLights.push(bulb);
    scene.add(g);
  });

  // 远景城市
  var cityG=new THREE.Group(); scene.add(cityG); cityG.visible=false;
  var seed=7;
  function rnd(){ seed=(seed*9301+49297)%233280; return seed/233280; }
  for(var cx=-2; cx<=46; cx+=3.4){
    var hh=1.5+rnd()*2.8, ww=2.2+rnd()*1.6;
    var b=new THREE.Mesh(geo(ww,hh,1.5), new THREE.MeshBasicMaterial({color:0xC2CCDC}));
    b.position.set(cx,hh/2-0.2,-8.0-rnd()*1.5); cityG.add(b);
  }

  // 三级展台（销量排行）
  var podiumGroup=new THREE.Group(); scene.add(podiumGroup);
  podiumGroup.userData={module:'stats', name:'统计 · 销量排行', center:new THREE.Vector3(10.3,0,26.6), radius:4.2};
  clickTargets.push(podiumGroup);
  var podiumBars=[];
  var podiumLabels=[];
  [7.5,10.3,13.1].forEach(function(x,i){
    var bar=softBox(2.3,1,2.3,C.podium[i],0.12,x,0.5,26.6,podiumGroup);
    bar.scale.y=0.7; bar.position.y=0.35; bar.userData.h=0.7;
    podiumBars.push(bar);
    var sp=makeLabel('—','第'+(i+1)+'名','#4338CA');
    sp.position.set(x,2.0,26.6); sp.scale.set(2.2,.7,1); podiumGroup.add(sp); podiumLabels.push(sp);
    softShadow(x,26.6,2.8,2.8,.35);
  });

  // 道路箭头
  var arrowTex=(function(){
    var cv=document.createElement('canvas'); cv.width=256; cv.height=128;
    var g=cv.getContext('2d'); g.clearRect(0,0,256,128);
    g.strokeStyle='#64748B'; g.lineWidth=18; g.lineCap='round';
    g.beginPath(); g.moveTo(30,64); g.lineTo(178,64); g.stroke();
    g.fillStyle='#64748B'; g.beginPath(); g.moveTo(230,64); g.lineTo(164,26); g.lineTo(164,102); g.closePath(); g.fill();
    var t=new THREE.CanvasTexture(cv); t.encoding=THREE.sRGBEncoding; return t;
  })();
  function roadArrow(x,z,rot){
    var m=new THREE.Mesh(new THREE.PlaneGeometry(3.2,1.6),
      new THREE.MeshBasicMaterial({map:arrowTex,transparent:true,opacity:.8,depthWrite:false}));
    m.rotation.x=-Math.PI/2; m.rotation.z=rot||0; m.position.set(x,0.09,z); scene.add(m);
  }
  roadArrow(19,18.5,0); roadArrow(26,18.5,0); roadArrow(33,18.5,0);
  roadArrow(42,20.5,Math.PI/2); roadArrow(42,15.0,Math.PI/2);
  // P1：道路虚线 + 月台停车线
  for(var lx=17.2; lx<=38.5; lx+=2.4){
    box(1.05,0.02,0.14,'#FFFFFF',lx,0.075,18.5);
  }
  for(var pi=0; pi<4; pi++){
    box(0.12,0.02,4.1,'#FFFFFF',18.3+pi*2.55,0.075,16.6);
  }

  /* ============================================================
   * 6. 标签工具
   * ============================================================ */
  function makeLabel(text,sub,color,small){
    var cv=document.createElement('canvas'); cv.width=512; cv.height=small?160:176;
    var g=cv.getContext('2d');
    g.clearRect(0,0,cv.width,cv.height);
    g.fillStyle='rgba(255,255,255,.96)';
    rrPath(g,8,8,496,cv.height-16,30); g.fill();
    g.strokeStyle=color||'#4F46E5'; g.lineWidth=5; g.stroke();
    g.fillStyle=color||'#4F46E5';
    var fs=44; g.font='bold '+fs+'px "Microsoft YaHei","PingFang SC",sans-serif';
    while(g.measureText(text).width>450 && fs>24){fs-=2;g.font='bold '+fs+'px "Microsoft YaHei",sans-serif';}
    g.textAlign='center'; g.textBaseline='middle';
    g.fillText(text,256,sub?(cv.height/2-16):(cv.height/2));
    if(sub){
      g.fillStyle='#71717A'; g.font='26px "Microsoft YaHei",sans-serif';
      g.fillText(sub,256,cv.height/2+30);
    }
    var tex=new THREE.CanvasTexture(cv); tex.encoding=THREE.sRGBEncoding;
    var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:true}));
    sp.scale.set(3.4, cv.height/512*3.4, 1);
    return sp;
  }

  /* ============================================================
   * 7. 数据模拟与绑定
   * ============================================================ */
  var state = {
    orders: 6, todayAmount: 1274, amount: 18200, customers: 18, source: '模拟数据',
    top: [
      {name:'农夫山泉 550ml', qty:320},
      {name:'可口可乐 330ml', qty:268},
      {name:'金龙鱼油 5L', qty:196}
    ],
    recent: [
      {no:'SD-20261107-006', customer:'城南便利店', total:320},
      {no:'SD-20261107-005', customer:'老王杂货铺', total:186},
      {no:'SD-20261107-004', customer:'阳光超市', total:540},
      {no:'SD-20261107-003', customer:'惠民小卖部', total:96}
    ]
  };

  function money(n){ return '¥'+Math.round(n).toLocaleString('zh-CN'); }
  function escHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function renderRecent(){
    var ul = document.getElementById('ui-recent');
    if(!ul) return;
    if(!state.recent || !state.recent.length){
      ul.innerHTML = '<li><b>还没有送货单</b><span>点上方「开单」开始录入</span><em></em></li>';
      return;
    }
    ul.innerHTML = state.recent.slice(0,4).map(function(o){
      return '<li><b>' + escHtml(o.no) + '</b><span>' + escHtml(o.customer || '—') +
        '</span><em>' + money(o.total || 0) + '</em></li>';
    }).join('');
  }
  function applyData(){
    // 月台箱堆
    buildDockStacks(Math.min(6, Math.ceil(state.orders/2)));
    // 货架填充
    var fill = Math.min(1, Math.log10(state.amount+1)/Math.log10(50000));
    buildCategoryCartons(fill);
    // 货车
    truck1.userData.target = state.orders>=1 ? 1 : 0;
    truck2.userData.target = state.orders>=4 ? 1 : 0;
    // 展台高度
    var maxQty = Math.max.apply(null, state.top.map(function(p){return p.qty;}).concat([1]));
    podiumBars.forEach(function(bar,i){
      var p=state.top[i]; if(!p) return;
      bar.userData.h = 0.6 + 0.75*(p.qty/maxQty);
      setSpriteText(podiumLabels[i], p.name, '第'+(i+1)+'名 · '+p.qty+'件');
    });
    // 门店
    storeG.visible = state.customers>0;
    // UI（仅预览页有这套面板，宿主直挂模式跳过）
    if(OPTS && OPTS.ui){
      var elO=document.getElementById('ui-orders'); if(elO) elO.innerHTML = state.orders+'<small>单</small>';
      var elT=document.getElementById('ui-today'); if(elT) elT.textContent = money(state.todayAmount);
      var elM=document.getElementById('ui-month'); if(elM) elM.textContent = money(state.amount);
      var elC=document.getElementById('ui-customers'); if(elC) elC.innerHTML = state.customers+'<small>家</small>';
      var elMore=document.querySelector('.flow .more'); if(elMore) elMore.textContent = '今日 · '+state.orders+' 单';
      var elSrc=document.getElementById('data-source'); if(elSrc) elSrc.textContent = '数据源：' + state.source;
      renderRecent();
    }
  }

  function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function computeFromData(orders, customers){
    orders = Array.isArray(orders) ? orders : [];
    customers = Array.isArray(customers) ? customers : [];
    var today = todayStr(), month = today.slice(0,7);
    var todayOrders = orders.filter(function(o){ return String(o.date||'') === today; });
    var monthOrders = orders.filter(function(o){ return String(o.date||'').slice(0,7) === month; });
    var sum = function(arr){ return arr.reduce(function(a,o){ return a + (Number(o.total)||0); }, 0); };
    var sales = new Map();
    orders.forEach(function(o){
      (o.items||[]).forEach(function(it){
        if(!it) return;
        var name=String(it.name||'').trim(), spec=String(it.spec||'').trim(), unit=String(it.unit||'').trim();
        var qty=Number(it.qty); if(!name || !isFinite(qty) || qty<=0) return;
        var key=JSON.stringify([name,spec,unit]);
        if(!sales.has(key)) sales.set(key,{name:name,spec:spec,unit:unit,qty:0});
        sales.get(key).qty += qty;
      });
    });
    var top = Array.from(sales.values()).sort(function(a,b){ return b.qty-a.qty; }).slice(0,3);
    var sorted = orders.slice().sort(function(a,b){
      if(a.date===b.date) return (b.createdAt||0)-(a.createdAt||0);
      return String(a.date||'') < String(b.date||'') ? 1 : -1;
    });
    state.orders = todayOrders.length;
    state.todayAmount = Math.round(sum(todayOrders));
    state.amount = Math.round(sum(monthOrders));
    state.customers = customers.length;
    if(top.length) state.top = top.map(function(p){ return {name:p.name + (p.spec?' '+p.spec:''), qty:p.qty}; });
    state.recent = sorted.slice(0,4).map(function(o){
      return {no:o.no, customer:(o.customer && o.customer.name) || '—', total:o.total};
    });
    applyData();
  }

  function loadBackup(obj){
    if(!obj || obj.app !== 'songhuodan' || !obj.data) throw new Error('不是送货单统计的备份文件');
    state.source = '备份文件';
    computeFromData(obj.data.orders || [], obj.data.customers || []);
  }

  function tryLocalStore(){
    try{
      var orders = JSON.parse(localStorage.getItem('sd_v1_orders') || 'null');
      var customers = JSON.parse(localStorage.getItem('sd_v1_customers') || 'null');
      if(Array.isArray(orders) && orders.length){
        state.source = '本地 Store';
        computeFromData(orders, customers || []);
        return true;
      }
    }catch(e){}
    return false;
  }

  function setSpriteText(sp,text,sub){
    var cv=sp.material.map.image;
    var g=cv.getContext('2d');
    g.clearRect(0,0,cv.width,cv.height);
    g.fillStyle='rgba(255,255,255,.96)'; rrPath(g,8,8,496,cv.height-16,30); g.fill();
    g.strokeStyle='#4338CA'; g.lineWidth=5; g.stroke();
    g.fillStyle='#4338CA'; var fs=36;
    g.font='bold '+fs+'px "Microsoft YaHei",sans-serif';
    while(g.measureText(text).width>450 && fs>18){fs-=2;g.font='bold '+fs+'px "Microsoft YaHei",sans-serif';}
    g.textAlign='center'; g.textBaseline='middle'; g.fillText(text,256,cv.height/2-14);
    g.fillStyle='#71717A'; g.font='24px "Microsoft YaHei",sans-serif'; g.fillText(sub,256,cv.height/2+26);
    sp.material.map.needsUpdate = true;
  }

  /* ============================================================
   * 8. 交互：相机 / 视差
   * ============================================================ */
  var pointer={x:0.5,y:0.5}, targetYaw=0, targetPitch=0, yaw=0, pitch=0;
  var desiredTarget = TARGET.clone();
  var desiredScale = 1, viewScale = 1;

  window.addEventListener('pointermove', function(e){
    pointer.x=e.clientX/window.innerWidth;
    pointer.y=e.clientY/window.innerHeight;
    targetYaw=(pointer.x-0.5)*0.045;
    targetPitch=-(pointer.y-0.5)*0.030;
  });
  window.addEventListener('pointerleave', function(){ targetYaw=0; targetPitch=0; });

  function updateCameraSize(){
    var w=window.innerWidth, h=window.innerHeight, aspect=w/h;
    var fh=50;
    if(w<1200) fh=50*(1200/w);
    if(aspect>2.2) fh=56;
    fh *= viewScale;
    var hw=fh*aspect/2, hh=fh/2;
    camera.left=-hw; camera.right=hw; camera.top=hh; camera.bottom=-hh;
    camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
  }
  window.addEventListener('resize', updateCameraSize);

  function updateCamera(dt){
    yaw += (targetYaw-yaw)*Math.min(1,dt*6);
    pitch += (targetPitch-pitch)*Math.min(1,dt*6);
    var off=BASE_OFFSET.clone();
    var q=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));
    off.applyQuaternion(q);
    camera.position.copy(TARGET).add(off);
    camera.lookAt(TARGET);
  }

  /* ============================================================
   * 8.5 场景导航：左栏 → 3D 指引，3D → 功能模块
   * ============================================================ */
  var MODULES = {
    home:     {name:'工作台',   target:new THREE.Vector3(22,2,15),   scale:1.00, radius:0,   sub:'总览'},
    order:    {name:'开单',     target:new THREE.Vector3(7.8,1,21),  scale:0.82, radius:3.4, sub:'打包台 / 新建送货单'},
    orders:   {name:'单据',     target:new THREE.Vector3(23,1,10.5), scale:0.86, radius:5.2, sub:'月台 / 装车'},
    stats:    {name:'统计',     target:new THREE.Vector3(10.3,.8,26.6), scale:0.72, radius:4.0, sub:'销量排行'},
    customers:{name:'客户管理', target:new THREE.Vector3(40,1,7.6),  scale:0.66, radius:4.4, sub:'客户门店'},
    products: {name:'商品管理', target:new THREE.Vector3(9.25,1,11.6), scale:0.95, radius:7.2, sub:'6 大分类'}
  };
  var currentFocus = {module:'home', cat:null};
  var hoveredRoot = null;

  /* ---- 3D 聊天气泡标签（HTML 覆盖层，文字大、带引线） ---- */
  var TAG_DEFS = [
    {module:'order',     world:[7.8, 2.2, 21],   dx:220, dy:40,  label:'开单',     sub:'打包台 · 新建送货单', accent:'#4F46E5'},
    {module:'orders',    world:[23, 4.2, 10.5],  dx:0,   dy:4,   label:'单据',     sub:'月台 · 装车 / 查询',  accent:'#4F46E5'},
    {module:'stats',     world:[10.3, 2.6, 26.6],dx:0,   dy:0,   label:'统计',     sub:'销量排行',            accent:'#7C3AED'},
    {module:'customers', world:[40, 4.6, 7.6],   dx:-95, dy:0,   label:'客户管理', sub:'客户门店',            accent:'#059669'},
    {module:'products',  world:[9.25, 5.0, 11.6],dx:300, dy:90,  label:'商品管理', sub:'6 大分类',            accent:'#4F46E5'}
  ];
  var tagLayer = document.getElementById('tag-layer');
  var tagSvg = document.getElementById('tag-svg');
  if(!tagLayer || !tagSvg){
    // 宿主直挂模式没有预览页覆盖层：建隐藏占位，后续 appendChild 不会报错
    var uiHolder = document.createElement('div');
    uiHolder.id = 'dns-scene-ui-holder';
    uiHolder.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
    tagLayer = document.createElement('div'); tagLayer.id = 'tag-layer';
    tagSvg = document.createElementNS('http://www.w3.org/2000/svg','svg'); tagSvg.id = 'tag-svg';
    uiHolder.appendChild(tagSvg); uiHolder.appendChild(tagLayer);
    (document.body || document.documentElement).appendChild(uiHolder);
  }
  var tagItems = [];
  TAG_DEFS.forEach(function(def){
    var el = document.createElement('div');
    el.className = 'tag';
    el.style.setProperty('--accent', def.accent);
    el.style.setProperty('--dx', def.dx + 'px');
    el.style.setProperty('--dy', def.dy + 'px');
    el.innerHTML = '<div class="dot"></div><div class="bubble"><b>' + def.label +
      '</b><span>' + def.sub + '</span><i class="cta">点击进入 →</i></div>';
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', def.accent);
    tagSvg.appendChild(line);
    tagLayer.appendChild(el);
    tagItems.push({def:def, el:el, line:line});
  });

  var catHoverEl = document.createElement('div');
  catHoverEl.className = 'tag';
  catHoverEl.style.setProperty('--dx','0px');
  catHoverEl.style.setProperty('--dy','-12px');
  catHoverEl.innerHTML = '<div class="dot"></div><div class="bubble"><b>—</b><span>点击筛选该分类</span><i class="cta">点击进入 →</i></div>';
  tagLayer.appendChild(catHoverEl);
  var catHoverLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  catHoverLine.setAttribute('stroke', '#4F46E5');
  tagSvg.appendChild(catHoverLine);

  var _v3 = new THREE.Vector3();
  function projectPoint(x, y, z){
    camera.updateMatrixWorld();
    _v3.set(x, y, z).project(camera);
    return {
      x: (_v3.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_v3.y * 0.5 + 0.5) * window.innerHeight,
      ok: _v3.z > -1 && _v3.z < 1
    };
  }

  function updateTagPositions(){
    var showStatic = (currentFocus.module === 'home');
    var hideForCat = !!(hoveredRoot && hoveredRoot.userData && hoveredRoot.userData.cat);
    tagItems.forEach(function(t){
      var p = projectPoint(t.def.world[0], t.def.world[1], t.def.world[2]);
      var allow = showStatic || (hoveredRoot && hoveredRoot.userData.module === t.def.module);
      var on = allow && !hideForCat && p.ok && p.x > -260 && p.x < window.innerWidth + 260 && p.y > -260 && p.y < window.innerHeight + 260;
      t.el.style.display = on ? 'block' : 'none';
      t.line.style.display = on ? '' : 'none';
      if(!on) return;
      t.el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)';
      var bx = p.x + t.def.dx, by = p.y + t.def.dy;
      t.line.setAttribute('x1', p.x); t.line.setAttribute('y1', p.y);
      t.line.setAttribute('x2', bx);   t.line.setAttribute('y2', by - 2);
    });
    // 悬停分类气泡
    if(hoveredRoot && hoveredRoot.userData && hoveredRoot.userData.cat){
      var c = hoveredRoot.userData.center || {x:0, z:0};
      var hp = projectPoint(c.x, 3.9, c.z);
      catHoverEl.style.display = hp.ok ? 'block' : 'none';
      if(hp.ok){
        var offX = 95, offY = 45;
        catHoverEl.style.setProperty('--dx', offX + 'px');
        catHoverEl.style.setProperty('--dy', offY + 'px');
        catHoverEl.style.setProperty('--accent', hoveredRoot.userData.accent || '#4F46E5');
        catHoverEl.style.transform = 'translate(' + hp.x + 'px,' + hp.y + 'px)';
        catHoverEl.querySelector('b').textContent = hoveredRoot.userData.name || '分类';
        catHoverEl.classList.add('hot');
        catHoverLine.style.display = '';
        catHoverLine.setAttribute('stroke', hoveredRoot.userData.accent || '#4F46E5');
        catHoverLine.setAttribute('x1', hp.x); catHoverLine.setAttribute('y1', hp.y);
        catHoverLine.setAttribute('x2', hp.x + offX); catHoverLine.setAttribute('y2', hp.y + offY - 2);
      }
    } else {
      catHoverEl.style.display = 'none';
      catHoverLine.style.display = 'none';
    }
  }

  function setHoverRoot(root){
    hoveredRoot = root;
    document.body.style.cursor = root ? 'pointer' : '';
    tagItems.forEach(function(t){
      t.el.classList.toggle('hot', !!root && root.userData && root.userData.module === t.def.module);
    });
    if(!root){
      hoverRing.visible = false;
      catHoverEl.style.display = 'none';
      catHoverLine.style.display = 'none';
      return;
    }
    hoverRing.material.color.set(root.userData.accent || '#818CF8');
    var c = root.userData.center || root.getWorldPosition(new THREE.Vector3());
    hoverRing.visible = true;
    hoverRing.position.set(c.x, 0.135, c.z);
    hoverRing.userData.base = root.userData.radius || 3;
    hoverRing.scale.setScalar(hoverRing.userData.base);
  }

  var focusRing = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1.0, 64),
    new THREE.MeshBasicMaterial({color:0x4F46E5, transparent:true, opacity:.6, side:THREE.DoubleSide, depthWrite:false})
  );
  focusRing.rotation.x = -Math.PI/2;
  focusRing.position.y = 0.13;
  focusRing.visible = false;
  scene.add(focusRing);

  var hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(0.93, 1.0, 64),
    new THREE.MeshBasicMaterial({color:0x818CF8, transparent:true, opacity:.28, side:THREE.DoubleSide, depthWrite:false})
  );
  hoverRing.rotation.x = -Math.PI/2;
  hoverRing.position.y = 0.135;
  hoverRing.visible = false;
  scene.add(hoverRing);

  var focusLabel = makeLabel('定位', '', '#4F46E5');
  focusLabel.scale.set(4.2, 1.3, 1);
  focusLabel.visible = false;
  scene.add(focusLabel);

  var guideEl = document.getElementById('guide');
  var guideText = document.getElementById('guide-text');
  var toastEl = document.getElementById('route-toast');
  var toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('on'); }, 2400);
  }

  function setActiveNav(module, catKey){
    document.querySelectorAll('.nav a[data-module]').forEach(function(a){
      a.classList.toggle('active', a.dataset.module === module);
    });
    document.querySelectorAll('.cat-chip').forEach(function(c){
      c.classList.toggle('on', module === 'products' && c.dataset.cat === catKey);
    });
  }

  function selectModule(module, catKey, fromScene){
    if(module === 'home' || module === 'settings'){ clearFocus(); return; }
    var meta = MODULES[module] || MODULES.home;
    var target = meta.target.clone();
    var scale = meta.scale, radius = meta.radius, label = meta.name;
    var cat = null;
    if(module === 'products' && catKey){
      cat = CATEGORIES.filter(function(c){ return c.key === catKey; })[0] || null;
      if(cat){
        target.set(cat.x, 1, cat.z);
        scale = 0.62; radius = 3.15; label = cat.label;
      }
    }
    desiredTarget.copy(target);
    desiredScale = scale;
    currentFocus = {module:module, cat:cat ? cat.key : null};

    focusRing.visible = true;
    focusRing.position.set(target.x, 0.13, target.z);
    focusRing.userData.base = radius || 3;
    focusRing.scale.setScalar(radius || 3);
    focusRing.material.color.set(cat ? cat.accent : '#4F46E5');

    focusLabel.visible = !cat;
    focusLabel.position.set(target.x, 4.55, target.z);
    setSpriteText(focusLabel, label, cat ? (cat.short + '类 · 点击进入') : (meta.sub || '点击进入'));

    guideText.textContent = cat ? label : (label + ' · ' + (meta.sub || ''));
    guideEl.classList.add('on');
    setActiveNav(module, cat ? cat.key : null);

    if(fromScene){
      var route = module === 'products'
        ? '商品管理' + (cat ? ' / ' + cat.short : '')
        : (meta.name || '');
      showToast('3D 场景 → 打开「' + route + '」' + (cat ? '（筛选：' + cat.label + '）' : ''));
    }
  }

  function clearFocus(){
    currentFocus = {module:'home', cat:null};
    desiredTarget.set(22, 2, 15);
    desiredScale = 1;
    focusRing.visible = false;
    focusLabel.visible = false;
    guideEl.classList.remove('on');
    setActiveNav('home', null);
  }

  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  function pickRoot(e){
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObjects(clickTargets, true);
    if(!hits.length) return null;
    var o = hits[0].object;
    while(o && !(o.userData && o.userData.module)) o = o.parent;
    return (o && o.userData && o.userData.module) ? o : null;
  }

  window.addEventListener('pointermove', function(e){
    setHoverRoot(e.target === canvas ? pickRoot(e) : null);
  });
  canvas.addEventListener('pointerleave', function(){ setHoverRoot(null); });

  var downPoint = null;
  window.addEventListener('pointerdown', function(e){
    if(e.target === canvas) downPoint = {x:e.clientX, y:e.clientY};
  });
  window.addEventListener('pointerup', function(e){
    if(!downPoint) return;
    var dx = e.clientX - downPoint.x, dy = e.clientY - downPoint.y;
    downPoint = null;
    if(dx*dx + dy*dy > 36) return;   // 拖拽不算点击
    if(e.target !== canvas) return;
    var root = pickRoot(e);
    if(root) selectModule(root.userData.module, root.userData.cat || null, true);
    else clearFocus();
  });

  document.querySelectorAll('.nav a[data-module], .cat-chip').forEach(function(el){
    el.addEventListener('click', function(ev){
      ev.preventDefault();
      selectModule(el.dataset.module, el.dataset.cat || null, false);
    });
  });
  var guideClose=document.getElementById('guide-close');
  if(guideClose) guideClose.addEventListener('click', clearFocus);

  /* ============================================================
   * 9. 动效 / 主循环
   * ============================================================ */
  var wireOn=false, nightOn=false;
  var clock=new THREE.Clock();
  var fpsEl=document.getElementById('fps');
  var fpsValue=0;
  var frames=0, fpsTime=0;

  function setWire(on){
    wireOn=on;
    scene.traverse(function(o){
      if(o.isMesh && o.material && 'wireframe' in o.material){ o.material.wireframe=on; }
    });
  }
  function setNight(on){
    nightOn=on;
    document.body.classList.toggle('night',on);
    scene.fog.color.set(on?0x1B2238:0xF4F7FC);
    hemi.intensity = on?0.24:0.38;
    hemi.color.set(on?0x3A4A78:0xEAF2FF);
    hemi.groundColor.set(on?0x1A2030:0xC9D4E5);
    dir.intensity = on?0.30:0.82;
    dir.color.set(on?0x9FB4FF:0xFFF6E8);
    fill.intensity = on?0.06:0.22;
    amb.intensity = on?0.06:0.08;
    lampLights.forEach(function(b){ b.material.opacity = on?0.95:0.35; });
  }

  var lastPaint = 0;
  var rafId = 0;
  function tick(now){
    rafId = requestAnimationFrame(tick);
    if(document.hidden) return;
    var maxFps = Number(bootQ.get('maxfps')) || 0;
    if(maxFps && now && now - lastPaint < (1000 / maxFps) - 2) return;
    if(now) lastPaint = now;
    var dt=Math.min(0.05, clock.getDelta());
    var t=clock.elapsedTime;
    if(Math.abs(desiredScale-viewScale) > 0.0008){
      viewScale += (desiredScale-viewScale)*Math.min(1,dt*3.2);
      updateCameraSize();
    }
    TARGET.lerp(desiredTarget, Math.min(1,dt*3.2));
    updateCamera(dt);
    updateTagPositions();
    // 悬停：体块轻微上浮 + 焦点环
    clickTargets.forEach(function(root){
      if(root.userData._baseY == null) root.userData._baseY = root.position.y;
      var base = root.userData._baseY;
      var targetY = (root === hoveredRoot) ? base + 0.16 + Math.sin(t*4)*0.05 : base;
      root.position.y += (targetY - root.position.y) * Math.min(1, dt*10);
    });

    // 货车显隐
    [truck1,truck2].forEach(function(tr){
      var s=tr.scale.x, tg=tr.userData.target;
      s += (tg-s)*Math.min(1,dt*3.2);
      tr.scale.set(s,s,s);
      tr.userData.s=s;
    });
    // 叉车往返（货架 ↔ 月台，带托盘举升）
    var fp = (t * 0.075) % 1;
    var fz = fp < 0.5 ? 10.0 + (fp/0.5)*2.8 : 12.8 - ((fp-0.5)/0.5)*2.8;
    forklift.position.z = fz;
    forklift.position.x = 16.3 + Math.sin(fp*Math.PI*2)*0.12;
    forklift.userData.fork.position.y = 0.55 + (fp>0.18 && fp<0.45 ? 0.35 : 0);
    // 传送带 UV 滚动
    if(convTex) convTex.offset.x -= dt * 0.35;
    // 路上配送小货车循环
    var vp = (t * 0.09) % 1;
    van.visible = vp < 0.94;
    van.position.x = 15.5 + vp * 27.0;
    van.position.z = 18.4;
    van.userData.center.set(van.position.x, 0, van.position.z);
    // 展台高度
    podiumBars.forEach(function(bar){
      var cur=bar.scale.y, tg=bar.userData.h;
      var nv=cur+(tg-cur)*Math.min(1,dt*4);
      bar.scale.y=nv; bar.position.y=nv/2;
    });
    // 标签轻微浮动
    zoneLabelGroup.children.forEach(function(sp,i){
      if(sp.userData.baseY==null) sp.userData.baseY=sp.position.y;
      sp.position.y = sp.userData.baseY + Math.sin(t*0.8+i)*0.06;
    });
    // 焦点环呼吸
    if(focusRing.visible){
      var bs = focusRing.userData.base || 3;
      focusRing.scale.setScalar(bs * (1 + 0.035*Math.sin(t*3)));
      focusRing.material.opacity = 0.42 + 0.30*(0.5 + 0.5*Math.sin(t*3));
    }
    if(hoverRing.visible){
      var hb = hoverRing.userData.base || 3;
      hoverRing.scale.setScalar(hb * (1 + 0.02*Math.sin(t*4)));
    }
    if(focusLabel.visible) focusLabel.position.y = 4.55 + Math.sin(t*1.4)*0.08;
    // 夜间呼吸
    if(nightOn){
      var k=0.75+0.25*Math.sin(t*1.5);
      lampLights.forEach(function(b){ b.material.opacity=0.6+0.35*k; });
    }
    renderer.render(scene,camera);

    frames++; fpsTime+=dt;
    if(fpsTime>=0.5){
      fpsValue=Math.round(frames/fpsTime);
      if(fpsEl) fpsEl.textContent=fpsValue+' fps';
      frames=0; fpsTime=0;
    }
  }
  function fork_position(){}

  /* ============================================================
   * 10. 控件
   * ============================================================ */
  var hudHead=document.getElementById('hud-head');
  if(hudHead) hudHead.addEventListener('click',function(){
    document.getElementById('hud').classList.toggle('collapsed');
  });
  var btnUI=document.querySelector('[data-act="ui"]');
  var btnZones=document.querySelector('[data-act="zones"]');
  var btnWire=document.querySelector('[data-act="wire"]');
  var btnNight=document.querySelector('[data-act="night"]');

  if(btnUI) btnUI.addEventListener('click',function(){
    var hidden=document.body.classList.toggle('no-ui');
    btnUI.textContent=hidden?'显示 UI':'隐藏 UI';
    btnUI.classList.toggle('on',!hidden);
  });
  if(btnZones) btnZones.addEventListener('click',function(){
    var safeEl=document.getElementById('safe');
    var on = safeEl ? safeEl.classList.toggle('on') : false;
    zoneLabelGroup.visible=on; zoneOutlineGroup.visible=on;
    btnZones.classList.toggle('on',on);
  });
  if(btnWire) btnWire.addEventListener('click',function(){
    setWire(!wireOn); btnWire.classList.toggle('on',wireOn);
  });
  if(btnNight) btnNight.addEventListener('click',function(){
    setNight(!nightOn); btnNight.classList.toggle('on',nightOn);
  });

  // P2：载入 App 导出的备份 JSON（Store.exportJSON），用真实数据驱动场景
  var fileData = document.getElementById('file-data');
  var btnLoad = document.querySelector('[data-act="load"]');
  if(btnLoad && fileData) btnLoad.addEventListener('click', function(){ fileData.click(); });
  if(fileData) fileData.addEventListener('change', function(e){
    var f = e.target.files && e.target.files[0];
    if(!f) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        loadBackup(JSON.parse(String(reader.result)));
        showToast('已载入备份：' + state.source + ' · 今日 ' + state.orders + ' 单');
      }catch(err){
        showToast('载入失败：' + err.message);
      }
      fileData.value = '';
    };
    reader.readAsText(f, 'utf-8');
  });

  function bindSlider(id, key, fmt){
    var el=document.getElementById(id), v=document.getElementById('v-'+key);
    if(!el) return;
    el.addEventListener('input',function(){
      state[key==='cust'?'customers':key]=Number(el.value);
      if(key==='amount') v.textContent=(Number(el.value)/1000).toFixed(1)+'k';
      else v.textContent=el.value;
      applyData();
    });
  }
  bindSlider('s-orders','orders');
  bindSlider('s-amount','amount');
  bindSlider('s-cust','cust');

  /* URL 参数（供截图脚本） */
  var q=(OPTS && OPTS.params) || new URLSearchParams(location.search);
  if(q.get('ui')==='0'){ document.body.classList.add('no-ui'); btnUI.textContent='显示 UI'; btnUI.classList.remove('on'); }
  if(q.get('hud')==='0'){ var hud0=document.getElementById('hud'); if(hud0) hud0.style.display='none';
    var tip0=document.querySelector('.tip'); if(tip0) tip0.style.display='none'; }
  if(q.get('zones')==='1'){ btnZones.click(); }
  if(q.get('night')==='1'){ btnNight.click(); }
  if(q.get('focus')){ selectModule(q.get('focus'), q.get('cat'), false); }
  // 嵌入为背景时：只留纯场景
  if(q.get('tags')==='0' || q.get('clean')==='1'){
    document.getElementById('tag-layer').style.display='none';
    document.getElementById('tag-svg').style.display='none';
    zoneLabelGroup.visible=false; zoneOutlineGroup.visible=false;
  }
  if(q.get('clean')==='1'){
    document.body.classList.add('no-ui');
    var hud1=document.getElementById('hud'); if(hud1) hud1.style.display='none';
    var tip1=document.querySelector('.tip'); if(tip1) tip1.style.display='none';
    var safe1=document.getElementById('safe'); if(safe1) safe1.classList.remove('on');
  }

  // 与宿主工作台通信：接收真实数据 / 通知首帧已就绪
  window.addEventListener('message', function(e){
    var d = e.data;
    if(d && d.type === 'dns-bg3d-data'){
      state.source = '工作台 Store';
      computeFromData(d.orders || [], d.customers || []);
    }
  });
  if(window.parent && window.parent !== window){
    setTimeout(function(){
      try{ window.parent.postMessage({type:'dns-bg3d-ready'}, '*'); }catch(err){}
    }, 700);
  }

  /* ============================================================
   * 11. 启动
   * ============================================================ */
  updateCameraSize();
  if(q.get('data') === 'local' && tryLocalStore()){ /* 主动读取本地 Store */ }
  else { applyData(); }
  tick();

  // 暴露给调试/截图；宿主直挂模式可直接调用，无需 postMessage
  var api = window.__preview = {scene:scene, camera:camera, state:state, applyData:applyData, setNight:setNight,
    selectModule:selectModule, clearFocus:clearFocus, pickRoot:pickRoot,
    loadBackup:loadBackup, computeFromData:computeFromData,
    renderer:renderer,
    // 运行时调画质：dpr / maxfps 可实时生效（params 需支持 set）
    setQuality:function(quality){
      quality = quality || {};
      try{
        if(quality.maxfps && bootQ && typeof bootQ.set === 'function') bootQ.set('maxfps', quality.maxfps);
        if(quality.dpr){
          renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, quality.dpr));
          renderer.setSize(window.innerWidth, window.innerHeight, false);
        }
      }catch(err){}
      return true;
    },
    stats:function(){ return {fps:fpsValue, dpr:renderer.getPixelRatio(), maxfps:Number(bootQ.get('maxfps'))||0}; },
    // 卸载：停掉主循环并释放 GPU 资源（宿主重建场景时调用）
    dispose:function(){ try{ cancelAnimationFrame(rafId); renderer.dispose(); }catch(err){} }
  };
  window.DNS_SCENE = api;
  if(typeof window.__dnsSceneOnReady === 'function'){ try{ window.__dnsSceneOnReady(api); }catch(err){} }
})();
