// 3D 地图预览 HTML 生成器
// 输入: map.bin → 输出: 自包含 HTML（Three.js CDN，浏览器打开即看）
//
// 用法:
//   node src/preview-html.js path/to/map.bin -o output.html
//   node src/preview-html.js path/to/map.bin --no-collision

import { readFileSync, writeFileSync } from 'node:fs';
import { parseMapBin } from './parse-map-bin.js';
import { semanticCategory, CATEGORY_COLORS } from './analyze-map.js';

function buildPreviewHTML(mapData, mapName, options = {}) {
    const { includeCollision = true } = options;

    const props = mapData.props.map(p => ({
        id: p.id,
        name: p.name,
        pos: p.pos,
        rot: p.rot || [0, 0, 0],
        scl: p.scale || [1, 1, 1],
        cat: semanticCategory(p.name),
    }));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of props) {
        minX = Math.min(minX, p.pos[0]); maxX = Math.max(maxX, p.pos[0]);
        minY = Math.min(minY, p.pos[1]); maxY = Math.max(maxY, p.pos[1]);
        minZ = Math.min(minZ, p.pos[2]); maxZ = Math.max(maxZ, p.pos[2]);
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const spanZ = maxZ - minZ || 1;
    const camDist = Math.max(spanX, spanZ * 3) * 0.55;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const boxSize = Math.max(spanX, spanZ) / 120;

    const propsJSON = JSON.stringify(props);
    const colorsJSON = JSON.stringify(CATEGORY_COLORS);

    let collisionJSON = 'null';
    if (includeCollision && mapData.collisionData1 && mapData.collisionData2) {
        collisionJSON = JSON.stringify({
            col1: mapData.collisionData1,
            col2: mapData.collisionData2,
        });
    }

    const totalProps = props.length;
    const catCounts = {};
    for (const p of props) catCounts[p.cat] = (catCounts[p.cat] || 0) + 1;
    const legendHTML = Object.entries(CATEGORY_COLORS).filter(([k]) => catCounts[k]).map(([k, v]) => {
        const hex = '#' + v.toString(16).padStart(6, '0');
        const name = { natural: '自然', structure: '建筑', decoration: '装饰', terrain: '地形', vehicle: '载具', other: '其他' }[k] || k;
        return `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:2px 0">
          <input type="checkbox" checked data-cat="${k}" onchange="toggleCategory('${k}',this.checked)">
          <span style="width:14px;height:14px;background:${hex};border-radius:2px;flex-shrink:0"></span>
          <span style="font-size:12px">${name} (${catCounts[k]})</span>
        </label>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${mapName} — 3D 地图预览</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { overflow:hidden; background:#1a1a2e; font-family:system-ui,sans-serif; }
  canvas { display:block; }

  #panel { position:fixed; top:12px; right:12px; background:rgba(0,0,0,0.75); color:#ccc;
    border-radius:8px; padding:12px 14px; font-size:13px; min-width:180px; z-index:10; }
  #panel h3 { color:#fff; margin:0 0 8px; font-size:14px; }
  #panel button { display:block; width:100%; margin:4px 0; padding:6px 10px; border-radius:4px;
    border:1px solid #555; background:#333; color:#ddd; cursor:pointer; font-size:12px; }
  #panel button:hover { background:#444; border-color:#888; }
  #panel button.active { background:#2d6a4f; border-color:#40916c; color:#fff; }
  #panel .hint { font-size:10px; color:#888; margin-top:6px; line-height:1.5; }

  #legend { position:fixed; top:12px; left:12px; background:rgba(0,0,0,0.75); color:#ccc;
    border-radius:8px; padding:10px 12px; font-size:12px; z-index:10; }
  #legend h4 { color:#fff; margin:0 0 6px; font-size:13px; }

  #loading { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    color:#fff; font-size:18px; z-index:20; }
</style>
</head>
<body>
<div id="loading">加载中...</div>

<div id="legend">
  <h4>分类图例</h4>
  ${legendHTML}
</div>

<div id="panel">
  <h3>${mapName}</h3>
  <div style="font-size:11px;color:#aaa;margin-bottom:8px">
    道具: ${totalProps} · 材质: ${Object.keys(mapData.materials || {}).length}<br>
    尺寸: ${spanX.toLocaleString()} × ${spanZ.toLocaleString()} (x:z = ${(spanX/spanZ||1).toFixed(1)}:1)
  </div>
  <button id="btn-collision" class="${includeCollision ? '' : 'disabled'}" ${includeCollision ? '' : 'disabled'}>显示碰撞层</button>
  <button id="btn-reset">重置视角</button>
  <button id="btn-top">俯视图</button>
  <button id="btn-wireframe">线框模式</button>
  <div class="hint">🖱 旋转 / 缩放 / 平移<br>双击重置视角</div>
</div>

<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }
}
</script>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PROPS = ${propsJSON};
const COLORS = ${colorsJSON};
const COLLISION = ${collisionJSON};

const centerX = ${centerX}, centerZ = ${centerZ};
const camDist = ${camDist};
const boxBase = ${boxSize};
const spanX = ${spanX}, spanY = ${spanY}, spanZ = ${spanZ};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, camDist * 2, camDist * 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 100, camDist * 8);
camera.position.set(centerX, camDist * 0.7, centerZ + camDist);
camera.lookAt(centerX, 0, centerZ);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(centerX, 0, centerZ);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.48;
controls.update();

// ── 光照 ──
scene.add(new THREE.AmbientLight(0x404060, 1.5));
const dir = new THREE.DirectionalLight(0xffffff, 2);
dir.position.set(centerX + camDist, camDist * 2, centerZ + camDist);
scene.add(dir);
const dir2 = new THREE.DirectionalLight(0x8888cc, 0.8);
dir2.position.set(centerX - camDist, camDist, centerZ - camDist);
scene.add(dir2);

// ── 地面网格 ──
const gridSize = Math.max(spanX, spanZ) * 1.1;
const gridDiv = Math.max(40, Math.round(gridSize / 5000));
const grid = new THREE.GridHelper(gridSize, gridDiv, 0x334455, 0x1a1a2e);
grid.position.set(centerX, 0, centerZ);
scene.add(grid);

// Y 轴参考线（细红线标地面）
const ySpan = Math.max(Math.abs(${minY}), Math.abs(${maxY}), spanY);
if (ySpan > 500) {
  const yLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(centerX, -ySpan, centerZ), new THREE.Vector3(centerX, ySpan, centerZ)]),
    new THREE.LineBasicMaterial({ color: 0x883333, transparent: true, opacity: 0.3 })
  );
  scene.add(yLine);
}

// ── 分类 → InstancedMesh ──
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const catMeshes = {};
const catGroups = {};

for (const [cat, color] of Object.entries(COLORS)) {
  const count = PROPS.filter(p => p.cat === cat).length;
  if (count === 0) continue;
  const mat = new THREE.MeshPhongMaterial({ color, specular: 0x111111, shininess: 10, flatShading: true });
  const mesh = new THREE.InstancedMesh(boxGeo, mat, count);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = cat;
  catMeshes[cat] = mesh;
  scene.add(mesh);

  const wireMat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.4 });
  const wireMesh = new THREE.InstancedMesh(boxGeo, wireMat, count);
  wireMesh.visible = false;
  wireMesh.name = cat + '_wire';
  catMeshes[cat + '_wire'] = wireMesh;
  scene.add(wireMesh);
}

// 填充实例矩阵
const dummy = new THREE.Object3D();
const catIndices = {};
for (const cat of Object.keys(COLORS)) catIndices[cat] = 0;

for (const p of PROPS) {
  const idx = catIndices[p.cat]++;
  const sx = boxBase * (p.scl[0] || 1);
  const sy = boxBase * (p.scl[1] || 1);
  const sz = boxBase * (p.scl[2] || 1);
  dummy.position.set(p.pos[0], p.pos[1], p.pos[2]);
  dummy.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  catMeshes[p.cat].setMatrixAt(idx, dummy.matrix);
  catMeshes[p.cat + '_wire'].setMatrixAt(idx, dummy.matrix);
}
for (const [cat, mesh] of Object.entries(catMeshes)) {
  if (mesh.isInstancedMesh) { mesh.instanceMatrix.needsUpdate = true; mesh.count = mesh.count; }
}

// ── 碰撞层 (可选) ──
let collisionGroup = null;
let collisionBuilt = false;

function buildCollision() {
  if (collisionBuilt || !COLLISION) return;
  collisionBuilt = true;
  collisionGroup = new THREE.Group();
  collisionGroup.name = 'collision';
  collisionGroup.visible = false;

  const col1Mat = new THREE.LineBasicMaterial({ color: 0xFF3333, transparent: true, opacity: 0.6 });
  const col2Mat = new THREE.LineBasicMaterial({ color: 0x33FF33, transparent: true, opacity: 0.6 });

  function addShapes(collision, mat) {
    for (const d of (collision.shapesType1 || [])) {
      const [px, py, pz, rx, ry, rz, sx, sy, sz] = d;
      const geo = new THREE.BoxGeometry(sx || 100, sy || 100, sz || 100);
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, mat);
      line.position.set(px, py, pz);
      line.rotation.set(rx, ry, rz);
      collisionGroup.add(line);
    }
    for (const d of (collision.shapesType2 || [])) {
      const f1 = d.f1, f2 = d.f2;
      const [px, py, pz, rx, ry, rz] = d.data;
      const geo = new THREE.BoxGeometry(f2 || 200, 5, f1 || 200);
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, mat);
      line.position.set(px, py, pz);
      line.rotation.set(rx, ry, rz);
      collisionGroup.add(line);
    }
    for (const d of (collision.shapesType3 || [])) {
      const [px, py, pz, rx, ry, rz, v1x, v1y, v1z, v2x, v2y, v2z, v3x, v3y, v3z] = d.data;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([v1x, v1y, v1z, v2x, v2y, v2z, v3x, v3y, v3z], 3));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(v1x, v1y, v1z),
          new THREE.Vector3(v2x, v2y, v2z),
          new THREE.Vector3(v3x, v3y, v3z),
          new THREE.Vector3(v1x, v1y, v1z),
        ]),
        mat
      );
      line.position.set(px, py, pz);
      line.rotation.set(rx, ry, rz);
      collisionGroup.add(line);
    }
  }

  if (COLLISION.col1) addShapes(COLLISION.col1, col1Mat);
  if (COLLISION.col2) addShapes(COLLISION.col2, col2Mat);
  scene.add(collisionGroup);
}

// ── UI 交互 ──
document.getElementById('loading').style.display = 'none';

let wireframeMode = false;

function toggleCategory(cat, visible) {
  if (catMeshes[cat]) {
    catMeshes[cat].visible = visible;
    if (!wireframeMode) catMeshes[cat + '_wire'].visible = false;
  }
}

function setWireframe(on) {
  wireframeMode = on;
  const btn = document.getElementById('btn-wireframe');
  if (on) { btn.textContent = '实体模式'; btn.classList.add('active'); }
  else { btn.textContent = '线框模式'; btn.classList.remove('active'); }
  for (const [key, mesh] of Object.entries(catMeshes)) {
    if (key.endsWith('_wire')) {
      mesh.visible = on && catMeshes[key.replace('_wire', '')].visible;
    } else {
      mesh.visible = !on;
    }
  }
}

document.getElementById('btn-wireframe').addEventListener('click', () => setWireframe(!wireframeMode));

document.getElementById('btn-reset').addEventListener('click', () => {
  camera.position.set(centerX, camDist * 0.7, centerZ + camDist);
  controls.target.set(centerX, 0, centerZ);
  controls.update();
});

document.getElementById('btn-top').addEventListener('click', () => {
  camera.position.set(centerX, camDist * 1.2, centerZ + 10);
  controls.target.set(centerX, 0, centerZ);
  controls.update();
});

const btnCol = document.getElementById('btn-collision');
if (COLLISION) {
  btnCol.addEventListener('click', () => {
    buildCollision();
    if (!collisionGroup) return;
    collisionGroup.visible = !collisionGroup.visible;
    btnCol.textContent = collisionGroup.visible ? '隐藏碰撞层' : '显示碰撞层';
    btnCol.classList.toggle('active', collisionGroup.visible);
  });
} else {
  btnCol.textContent = '(无碰撞数据)';
  btnCol.disabled = true;
  btnCol.style.opacity = '0.5';
}

window.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'LABEL' || e.target.tagName === 'INPUT') return;
  camera.position.set(centerX, camDist * 0.7, centerZ + camDist);
  controls.target.set(centerX, 0, centerZ);
  controls.update();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 暴露给全局（legend checkbox 用）
window.toggleCategory = toggleCategory;

// ── 渲染循环 ──
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>`;
}

// ── CLI ──
function parseArgs(argv) {
    const args = { _: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--no-collision') { args.flags.noCollision = true; continue; }
        if (a === '--help' || a === '-h') { args.flags.help = true; continue; }
        if (a.startsWith('-')) {
            const key = a.replace(/^-+/, '');
            if (key === 'o' || key === 'output') args.flags.output = argv[++i];
        } else {
            args._.push(a);
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.flags.help || args._.length === 0) {
        console.log('用法: node src/preview-html.js <map.bin路径> [-o output.html] [--no-collision]');
        console.log('  -o         输出 HTML 文件路径（默认 output/preview.html）');
        console.log('  --no-collision  不嵌入碰撞数据（减小文件体积）');
        console.log('  --help, -h  显示帮助');
        process.exit(0);
    }

    const mapPath = args._[0];
    const outPath = args.flags.output || 'output/preview.html';
    const includeCollision = !args.flags.noCollision;

    let buf;
    try {
        buf = readFileSync(mapPath);
    } catch (e) {
        console.error('无法读取文件:', e.message);
        process.exit(1);
    }

    console.log('解析 map.bin...');
    const mapData = parseMapBin(buf);
    const mapName = mapPath.replace(/^.*[\\/]/, '').replace(/\.bin$/, '');

    console.log(`生成 HTML: props=${mapData.props.length}, collision=${includeCollision ? '含' : '无'}`);
    const html = buildPreviewHTML(mapData, mapName, { includeCollision });

    writeFileSync(outPath, html);
    const sizeKB = (html.length / 1024).toFixed(0);
    console.log(`已写入: ${outPath} (${sizeKB} KB)`);
    console.log(`浏览器打开即可预览`);
}

const isMain = process.argv[1] && (process.argv[1].endsWith('preview-html.js') || process.argv[1].includes('preview-html'));
if (isMain) main().catch(e => { console.error(e); process.exit(1); });