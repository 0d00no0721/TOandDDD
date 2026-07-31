// 批量下载 + 解析真实地图，提取布局模式作为 skill 参考样例
// 输出: data/map_references.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMapBin } from '../src/parse-map-bin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, 'data', 'cache', 'maps');

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// maps.json 中的所有地图 URL
const MAPS = [
  // Sandbox
  { name: 'Sandbox Summer Day',      url: 'https://res.3dtank.com/570/174542/371/60/31656237623505/map.bin' },
  { name: 'Sandbox Summer Evening',  url: 'https://res.3dtank.com/570/174542/371/64/31656237623467/map.bin' },
  { name: 'Sandbox Autumn',          url: 'https://res.3dtank.com/570/174542/371/65/31656237623460/map.bin' },
  // Forest
  { name: 'Forest Summer Day',       url: 'https://res.3dtank.com/0/16723/204/372/31656237623200/map.bin' },
  { name: 'Forest Winter Day',       url: 'https://res.3dtank.com/0/16723/204/143/31656237623216/map.bin' },
  // Sandal
  { name: 'Sandal Summer Day',       url: 'https://res.3dtank.com/544/77313/263/311/31656237623450/map.bin' },
  { name: 'Sandal Autumn',           url: 'https://res.3dtank.com/544/77313/263/313/31656237623432/map.bin' },
  // Highland
  { name: 'Highland Summer Day',     url: 'https://res.3dtank.com/570/174542/371/116/31656237623240/map.bin' },
  { name: 'Highland Summer Evening', url: 'https://res.3dtank.com/570/174542/371/160/31656237625001/map.bin' },
  { name: 'Highland Autumn',         url: 'https://res.3dtank.com/570/174542/371/121/31656237623231/map.bin' },
  // Cross
  { name: 'Cross Summer Day',        url: 'https://res.3dtank.com/570/174542/371/130/31656237623152/map.bin' },
  { name: 'Cross Autumn',            url: 'https://res.3dtank.com/570/174542/371/133/31656237623140/map.bin' },
  // Parma
  { name: 'Parma Summer Day',        url: 'https://res.3dtank.com/570/174542/371/104/31656237623400/map.bin' },
  { name: 'Parma Autumn',            url: 'https://res.3dtank.com/570/174542/371/107/31656237623367/map.bin' },
];

// 加载库索引用于 prop 分类
const index = JSON.parse(readFileSync(join(ROOT, 'data', 'library_index.json'), 'utf8'));
const propNameToCategory = {};
for (const p of index.props) {
  propNameToCategory[`${p.libId}:${p.name}`] = p.semanticCategory;
}

async function fetchMap(url, cacheKey) {
  const cachePath = join(CACHE_DIR, cacheKey + '.bin');
  if (existsSync(cachePath)) {
    return readFileSync(cachePath);
  }
  console.log(`  下载: ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(cachePath, buf);
  return buf;
}

function analyzeMap(name, buf) {
  const data = parseMapBin(buf);
  const props = data.props;

  // 坐标范围
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for (const p of props) {
    minX=Math.min(minX,p.pos[0]); maxX=Math.max(maxX,p.pos[0]);
    minY=Math.min(minY,p.pos[1]); maxY=Math.max(maxY,p.pos[1]);
    minZ=Math.min(minZ,p.pos[2]); maxZ=Math.max(maxZ,p.pos[2]);
  }

  // prop 类别分布
  const catCounts = {};
  for (const p of props) {
    const cat = propNameToCategory[`${p.libName || 'main'}:${p.name}`] || 'unknown';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  // shader 分布
  const shaders = {};
  for (const m of Object.values(data.materials)) {
    shaders[m.shader] = (shaders[m.shader] || 0) + 1;
  }

  // libName 分布
  const libNames = {};
  for (const p of props) {
    const ln = p.libName || '';
    libNames[ln] = (libNames[ln] || 0) + 1;
  }

  // prop name 频率 top 10
  const nameFreq = {};
  for (const p of props) nameFreq[p.name] = (nameFreq[p.name] || 0) + 1;
  const topProps = Object.entries(nameFreq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([n,c])=>({name:n,count:c}));

  // 密度估算: props / 面积 (千单位²)
  const areaK = ((maxX-minX) * (maxZ-minZ)) / 1_000_000;
  const density = areaK > 0 ? (props.length / areaK).toFixed(1) : 'N/A';

  return {
    name,
    propCount: props.length,
    materialCount: Object.keys(data.materials).length,
    atlasCount: Object.keys(data.atlases).length,
    coordRange: {
      x: [Math.round(minX), Math.round(maxX)],
      y: [Math.round(minY), Math.round(maxY)],
      z: [Math.round(minZ), Math.round(maxZ)],
    },
    mapSize: { w: Math.round(maxX-minX), h: Math.round(maxZ-minZ) },
    densityPerKm2: density,
    categoryMix: catCounts,
    shaderMix: shaders,
    libNameMix: libNames,
    topProps,
    collisionCount: {
      col1: data.collisionData1.shapesType1.length + data.collisionData1.shapesType2.length + data.collisionData1.shapesType3.length,
      col2: data.collisionData2.shapesType1.length + data.collisionData2.shapesType2.length + data.collisionData2.shapesType3.length,
    },
  };
}

console.log('=== 下载 + 解析真实地图 ===\n');
const results = [];

for (const map of MAPS) {
  const cacheKey = map.name.replace(/\s+/g, '_');
  try {
    const buf = await fetchMap(map.url, cacheKey);
    const analysis = analyzeMap(map.name, buf);
    results.push(analysis);
    console.log(`✓ ${map.name}: ${analysis.propCount} props, ${analysis.materialCount} mats, ${analysis.mapSize.w}×${analysis.mapSize.h}`);
  } catch (e) {
    console.error(`✗ ${map.name}: ${e.message}`);
    results.push({ name: map.name, error: e.message });
  }
}

writeFileSync(join(ROOT, 'data', 'map_references.json'), JSON.stringify(results, null, 2));
console.log(`\n=== 完成: ${results.length} 张地图分析结果 → data/map_references.json ===`);

// 打印汇总
console.log('\n--- 汇总 ---');
const ok = results.filter(r => !r.error);
console.log(`成功: ${ok.length}/${results.length}`);
const sizes = ok.map(r => r.mapSize.w).sort((a,b)=>a-b);
console.log(`地图宽度范围: ${sizes[0]} ~ ${sizes[sizes.length-1]}`);
const propCounts = ok.map(r => r.propCount).sort((a,b)=>a-b);
console.log(`道具数量范围: ${propCounts[0]} ~ ${propCounts[propCounts.length-1]}`);
