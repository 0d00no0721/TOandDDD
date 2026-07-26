'use strict';

function generatePreviewHTML(collision, props, airwalls, meta) {
  const data = JSON.stringify({ collision, props, airwalls, meta });
  const escaped = data.replace(/<\/script>/g, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>地图碰撞预览 — ${escapeHtml(meta.mapName || '未命名')}</title>
<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
} }
</script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { overflow: hidden; background: #000; font-family: 'Segoe UI', system-ui, sans-serif; color: #e1e8ed; }
  #canvas { display: block; width: 100vw; height: 100vh; }

  #legend {
    position: fixed; top: 12px; left: 12px; z-index: 10;
    background: rgba(0, 25, 38, 0.88); border: 1px solid rgba(118, 255, 51, 0.25);
    border-radius: 12px; padding: 14px 16px; min-width: 220px;
    backdrop-filter: blur(8px); font-size: 13px; line-height: 1.7;
  }
  #legend h2 { font-size: 15px; color: #76ff33; margin-bottom: 8px; font-weight: 600; }
  #legend .row { display: flex; align-items: center; gap: 8px; }
  #legend .swatch { width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2); }
  #legend .group-label { color: #bfd5ff; font-weight: 600; margin: 6px 0 2px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  #legend .count { color: #8a9ba8; font-size: 11px; margin-left: auto; }
  #legend .divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 6px 0; }

  #stats {
    position: fixed; top: 12px; right: 12px; z-index: 10;
    background: rgba(0, 25, 38, 0.88); border: 1px solid rgba(118, 255, 51, 0.25);
    border-radius: 12px; padding: 10px 14px; font-size: 12px; line-height: 1.6;
    backdrop-filter: blur(8px);
  }
  #stats .val { color: #76ff33; font-weight: 600; }
  #stats .airwall { color: #ff8800; }

  #controls {
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 10;
    background: rgba(0, 25, 38, 0.88); border: 1px solid rgba(118, 255, 51, 0.25);
    border-radius: 24px; padding: 8px 16px; display: flex; gap: 12px; align-items: center;
    backdrop-filter: blur(8px); font-size: 12px;
  }
  #controls button {
    background: rgba(118, 255, 51, 0.1); border: 1px solid rgba(118, 255, 51, 0.3);
    color: #76ff33; padding: 6px 14px; border-radius: 16px; cursor: pointer; font-size: 12px;
    transition: all 0.15s;
  }
  #controls button:hover { background: rgba(118, 255, 51, 0.2); }
  #controls button.active { background: rgba(118, 255, 51, 0.3); border-color: #76ff33; }
  #controls .hint { color: #8a9ba8; font-size: 11px; }

  #props-info { color: #8a9ba8; font-size: 11px; margin-top: 4px; }
</style>
</head>
<body>
<canvas id="canvas"></canvas>

<div id="legend">
  <h2>碰撞视图 — ${escapeHtml(meta.mapName || '未命名')}</h2>
  <div class="group-label">碰撞组 1</div>
  <div class="row"><span class="swatch" style="background:#3366ff"></span> Type1 OBB 盒 <span class="count" id="c1t1">0</span></div>
  <div class="row"><span class="swatch" style="background:#ffaa00"></span> Type2 薄片墙 <span class="count" id="c1t2">0</span></div>
  <div class="row"><span class="swatch" style="background:#ff44aa"></span> Type3 三角面 <span class="count" id="c1t3">0</span></div>
  <div class="group-label">碰撞组 2</div>
  <div class="row"><span class="swatch" style="background:#00ddcc"></span> Type1 OBB 盒 <span class="count" id="c2t1">0</span></div>
  <div class="row"><span class="swatch" style="background:#aaff00"></span> Type2 薄片墙 <span class="count" id="c2t2">0</span></div>
  <div class="row"><span class="swatch" style="background:#aa66ff"></span> Type3 三角面 <span class="count" id="c2t3">0</span></div>
  <hr class="divider" />
  <div class="row"><span class="swatch" style="background:#ff8800; opacity:0.5"></span> 空气墙 <span class="count" id="airwall-count">0</span></div>
  <div id="props-info">视觉 props: ${props.length} 个</div>
</div>

<div id="stats">
  <div>渲染对象: <span class="val" id="mesh-count">0</span></div>
  <div>三角面: <span class="val" id="tri-count">0</span></div>
  <div>空气墙: <span class="airwall" id="airwall-count2">0</span></div>
  <div>FPS: <span class="val" id="fps">0</span></div>
</div>

<div id="controls">
  <button id="btn-wireframe" title="切换线框模式">线框</button>
  <button id="btn-airwalls" class="active" title="显示/隐藏空气墙高亮">空气墙</button>
  <button id="btn-props" title="显示/隐藏 prop 位置标记">Prop 标记</button>
  <button id="btn-grid" class="active" title="显示/隐藏网格">网格</button>
  <button id="btn-reset" title="重置视角">重置视角</button>
  <span class="hint">左键旋转 · 右键平移 · 滚轮缩放</span>
</div>

<script type="application/json" id="data">${escaped}</script>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const raw = JSON.parse(document.getElementById('data').textContent);
const col = raw.collision;
const props = raw.props;
const aw = raw.airwalls;
const meta = raw.meta;

const COLORS = {
  cd1_t1: 0x3366ff, cd1_t2: 0xffaa00, cd1_t3: 0xff44aa,
  cd2_t1: 0x00ddcc, cd2_t2: 0xaaff00, cd2_t3: 0xaa66ff,
};

const AIRWALL_COLOR = 0xff6600;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1520);
scene.fog = new THREE.Fog(0x0a1520, 500, 3000);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 10000);
camera.position.set(200, 150, 200);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 200, 100);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(2000, 50, 0x2a4a6a, 0x1a3040);
gridHelper.name = 'grid';
scene.add(gridHelper);

const collisionGroup = new THREE.Group();
scene.add(collisionGroup);

const propGroup = new THREE.Group();
propGroup.visible = false;
scene.add(propGroup);

const airwallGroup = new THREE.Group();
scene.add(airwallGroup);

let wireframeMode = false;
let totalTris = 0;
let airwallCount = 0;

function makeMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, depthWrite: false,
    side: THREE.DoubleSide, wireframe: false
  });
}

function makeAirwallMaterial() {
  return new THREE.MeshBasicMaterial({
    color: AIRWALL_COLOR, transparent: true, opacity: 0.50, depthWrite: false,
    side: THREE.DoubleSide, wireframe: false
  });
}

function makeAirwallWireframe() {
  return new THREE.LineBasicMaterial({ color: AIRWALL_COLOR, transparent: true, opacity: 0.85 });
}

function addType1(arr, color, airwallFlags, group) {
  if (!arr.length) return;
  const mat = makeMaterial(color);
  const awMat = makeAirwallMaterial();
  const awWire = makeAirwallWireframe();
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i];
    const isAW = airwallFlags && airwallFlags[i];
    const useMat = isAW ? awMat : mat;
    const geo = new THREE.BoxGeometry(d[6], d[7], d[8]);
    const mesh = new THREE.Mesh(geo, useMat);
    mesh.position.set(d[0], d[1], d[2]);
    mesh.rotation.set(d[3], d[4], d[5], 'ZYX');
    group.add(mesh);
    totalTris += 12;
    if (isAW) {
      airwallCount++;
      const wire = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(wire, awWire);
      line.position.copy(mesh.position);
      line.rotation.copy(mesh.rotation);
      airwallGroup.add(line);
    }
  }
}

function addType2(arr, color, airwallFlags, group) {
  if (!arr.length) return;
  const mat = makeMaterial(color);
  const awMat = makeAirwallMaterial();
  const awWire = makeAirwallWireframe();
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i];
    const isAW = airwallFlags && airwallFlags[i];
    const useMat = isAW ? awMat : mat;
    const length = d[0];
    const width = d[7];
    const thickness = 5;
    const geo = new THREE.BoxGeometry(width, length, thickness);
    const mesh = new THREE.Mesh(geo, useMat);
    mesh.position.set(d[1], d[2], d[3]);
    mesh.rotation.set(d[4], d[5], d[6], 'ZYX');
    group.add(mesh);
    totalTris += 12;
    if (isAW) {
      airwallCount++;
      const wire = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(wire, awWire);
      line.position.copy(mesh.position);
      line.rotation.copy(mesh.rotation);
      airwallGroup.add(line);
    }
  }
}

function addType3(arr, color, airwallFlags, group) {
  if (!arr.length) return;
  const positions = new Float32Array(arr.length * 9);
  const euler = new THREE.Euler();
  const v = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const awIndices = [];
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i];
    pos.set(d[1], d[2], d[3]);
    euler.set(d[4], d[5], d[6], 'ZYX');
    for (let k = 0; k < 3; k++) {
      v.set(d[7 + k*3], d[8 + k*3], d[9 + k*3]);
      v.applyEuler(euler).add(pos);
      positions[i*9 + k*3]     = v.x;
      positions[i*9 + k*3 + 1] = v.y;
      positions[i*9 + k*3 + 2] = v.z;
    }
    if (airwallFlags && airwallFlags[i]) {
      awIndices.push(i);
    }
  }

  const nonAW = arr.length - awIndices.length;
  if (nonAW > 0) {
    const nonAWBuf = new Float32Array(nonAW * 9);
    let out = 0;
    for (let i = 0; i < arr.length; i++) {
      if (!airwallFlags || !airwallFlags[i]) {
        for (let k = 0; k < 9; k++) nonAWBuf[out++] = positions[i*9 + k];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(nonAWBuf, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, makeMaterial(color));
    group.add(mesh);
    totalTris += nonAW;
  }

  if (awIndices.length > 0) {
    const awBuf = new Float32Array(awIndices.length * 9);
    let out = 0;
    for (let idx of awIndices) {
      for (let k = 0; k < 9; k++) {
        awBuf[out++] = positions[idx*9 + k];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(awBuf, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, makeAirwallMaterial());
    group.add(mesh);
    totalTris += awIndices.length;
    airwallCount += awIndices.length;

    for (let i = 0; i < awIndices.length; i++) {
      const wp = new Float32Array([
        awBuf[i*9], awBuf[i*9+1], awBuf[i*9+2],
        awBuf[i*9+3], awBuf[i*9+4], awBuf[i*9+5],
        awBuf[i*9+6], awBuf[i*9+7], awBuf[i*9+8],
        awBuf[i*9], awBuf[i*9+1], awBuf[i*9+2]
      ]);
      const wGeo = new THREE.BufferGeometry();
      wGeo.setAttribute('position', new THREE.BufferAttribute(wp, 3));
      const line = new THREE.Line(wGeo, makeAirwallWireframe());
      airwallGroup.add(line);
    }
  }
}

addType1(col.collisionData1.type1, COLORS.cd1_t1, aw ? aw.collisionData1.airwall1 : null, collisionGroup);
addType2(col.collisionData1.type2, COLORS.cd1_t2, aw ? aw.collisionData1.airwall2 : null, collisionGroup);
addType3(col.collisionData1.type3, COLORS.cd1_t3, aw ? aw.collisionData1.airwall3 : null, collisionGroup);
addType1(col.collisionData2.type1, COLORS.cd2_t1, aw ? aw.collisionData2.airwall1 : null, collisionGroup);
addType2(col.collisionData2.type2, COLORS.cd2_t2, aw ? aw.collisionData2.airwall2 : null, collisionGroup);
addType3(col.collisionData2.type3, COLORS.cd2_t3, aw ? aw.collisionData2.airwall3 : null, collisionGroup);

for (const p of props) {
  const geo = new THREE.OctahedronGeometry(8, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0x76ff33, transparent: true, opacity: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
  mesh.userData = { name: p.n, lib: p.lib };
  propGroup.add(mesh);
}

const box = new THREE.Box3().setFromObject(collisionGroup);
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
const maxDim = Math.max(size.x, size.y, size.z) || 500;
controls.target.copy(center);
camera.position.set(center.x + maxDim * 0.8, center.y + maxDim * 0.6, center.z + maxDim * 0.8);
controls.update();

if (gridHelper) {
  gridHelper.position.x = center.x;
  gridHelper.position.z = center.z;
}

document.getElementById('c1t1').textContent = col.collisionData1.type1.length;
document.getElementById('c1t2').textContent = col.collisionData1.type2.length;
document.getElementById('c1t3').textContent = col.collisionData1.type3.length;
document.getElementById('c2t1').textContent = col.collisionData2.type1.length;
document.getElementById('c2t2').textContent = col.collisionData2.type2.length;
document.getElementById('c2t3').textContent = col.collisionData2.type3.length;
document.getElementById('mesh-count').textContent = collisionGroup.children.length;
document.getElementById('tri-count').textContent = totalTris.toLocaleString();
document.getElementById('airwall-count').textContent = airwallCount;
document.getElementById('airwall-count2').textContent = airwallCount;

let airwallVisible = true;
document.getElementById('btn-wireframe').addEventListener('click', (e) => {
  wireframeMode = !wireframeMode;
  e.target.classList.toggle('active', wireframeMode);
  collisionGroup.traverse(obj => {
    if (obj.material) obj.material.wireframe = wireframeMode;
  });
});

document.getElementById('btn-airwalls').addEventListener('click', (e) => {
  airwallVisible = !airwallVisible;
  airwallGroup.visible = airwallVisible;
  e.target.classList.toggle('active', airwallVisible);
});

document.getElementById('btn-props').addEventListener('click', (e) => {
  propGroup.visible = !propGroup.visible;
  e.target.classList.toggle('active', propGroup.visible);
});

document.getElementById('btn-grid').addEventListener('click', (e) => {
  gridHelper.visible = !gridHelper.visible;
  e.target.classList.toggle('active', gridHelper.visible);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  controls.target.copy(center);
  camera.position.set(center.x + maxDim * 0.8, center.y + maxDim * 0.6, center.z + maxDim * 0.8);
  controls.update();
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let fpsLast = performance.now();
let fpsFrames = 0;
const fpsEl = document.getElementById('fps');

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 1000) {
    fpsEl.textContent = Math.round(fpsFrames * 1000 / (now - fpsLast));
    fpsFrames = 0;
    fpsLast = now;
  }
}
animate();
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { generatePreviewHTML };