'use strict';

const fs = require('fs');
const path = require('path');
const { parseMapBin } = require('../src/parseMapBin');

const mapBinPath = process.argv[2] || 'E:/DDD/testanki1.github.io/maps/Highland REMASTER Summer Evening/map.bin';

const buffer = fs.readFileSync(mapBinPath);
const parsed = parseMapBin(buffer);

function getShapeCenter(d, type) {
  if (type === 1) return [d[0], d[1], d[2]];
  if (type === 2) return [d.data[0], d.data[1], d.data[2]];
  if (type === 3) return [d.data[0], d.data[1], d.data[2]];
}

function dist3(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

const propPositions = parsed.props.map(p => p.pos);

function nearestPropDist(center) {
  let minDist = Infinity;
  for (const pp of propPositions) {
    const d = dist3(center, pp);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function analyzeGroup(label, col) {
  const allShapes = [];
  for (const d of col.shapesType1) allShapes.push({ type: 1, center: getShapeCenter(d, 1), data: d });
  for (const d of col.shapesType2) allShapes.push({ type: 2, center: getShapeCenter(d, 2), data: d });
  for (const d of col.shapesType3) allShapes.push({ type: 3, center: getShapeCenter(d, 3), data: d });

  const dists = allShapes.map(s => nearestPropDist(s.center));
  dists.sort((a, b) => a - b);

  const pct = (p) => dists[Math.floor(dists.length * p)] || 0;
  const histogram = (max, bins) => {
    const h = new Array(bins).fill(0);
    for (const d of dists) {
      const idx = Math.min(Math.floor(d / max * bins), bins - 1);
      h[idx]++;
    }
    return h;
  };

  console.log(`\n=== ${label} ===`);
  console.log(`总形状数: ${allShapes.length}`);
  console.log(`  Type1: ${col.shapesType1.length}, Type2: ${col.shapesType2.length}, Type3: ${col.shapesType3.length}`);

  const bounds = allShapes.reduce((acc, s) => ({
    minX: Math.min(acc.minX, s.center[0]), maxX: Math.max(acc.maxX, s.center[0]),
    minY: Math.min(acc.minY, s.center[1]), maxY: Math.max(acc.maxY, s.center[1]),
    minZ: Math.min(acc.minZ, s.center[2]), maxZ: Math.max(acc.maxZ, s.center[2]),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });

  console.log(`空间范围:`);
  console.log(`  X: [${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}] 宽=${(bounds.maxX-bounds.minX).toFixed(1)}`);
  console.log(`  Y: [${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}] 高=${(bounds.maxY-bounds.minY).toFixed(1)}`);
  console.log(`  Z: [${bounds.minZ.toFixed(1)}, ${bounds.maxZ.toFixed(1)}] 深=${(bounds.maxZ-bounds.minZ).toFixed(1)}`);

  console.log(`到最近 prop 距离:`);
  console.log(`  最小: ${dists[0]?.toFixed(2)}`);
  console.log(`  10%: ${pct(0.1).toFixed(2)}`);
  console.log(`  25%: ${pct(0.25).toFixed(2)}`);
  console.log(`  中位数: ${pct(0.5).toFixed(2)}`);
  console.log(`  75%: ${pct(0.75).toFixed(2)}`);
  console.log(`  90%: ${pct(0.9).toFixed(2)}`);
  console.log(`  最大: ${dists[dists.length-1]?.toFixed(2)}`);
  console.log(`  平均: ${(dists.reduce((a,b)=>a+b,0)/dists.length).toFixed(2)}`);

  console.log(`距离直方图 (0-500, 20bins):`);
  const h = histogram(500, 20);
  const maxCount = Math.max(...h);
  for (let i = 0; i < h.length; i++) {
    const bar = '█'.repeat(Math.round(h[i] / maxCount * 40));
    const lo = (i * 25).toFixed(0);
    const hi = ((i+1) * 25).toFixed(0);
    console.log(`  ${lo.padStart(3)}-${hi.padStart(3)}: ${String(h[i]).padStart(5)} ${bar}`);
  }

  const overThreshold = [50, 100, 150, 200, 300, 500].map(t => ({
    threshold: t,
    count: dists.filter(d => d > t).length,
    pct: (dists.filter(d => d > t).length / dists.length * 100).toFixed(1)
  }));
  console.log(`超过阈值的形状数:`);
  for (const t of overThreshold) {
    console.log(`  > ${t}: ${t.count} (${t.pct}%)`);
  }

  return { dists, allShapes, bounds };
}

console.log(`分析: ${mapBinPath}`);
console.log(`Props 总数: ${parsed.props.length}`);

const propBounds = parsed.props.reduce((acc, p) => ({
  minX: Math.min(acc.minX, p.pos[0]), maxX: Math.max(acc.maxX, p.pos[0]),
  minY: Math.min(acc.minY, p.pos[1]), maxY: Math.max(acc.maxY, p.pos[1]),
  minZ: Math.min(acc.minZ, p.pos[2]), maxZ: Math.max(acc.maxZ, p.pos[2]),
}), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });

console.log(`Props 空间范围:`);
console.log(`  X: [${propBounds.minX.toFixed(1)}, ${propBounds.maxX.toFixed(1)}]`);
console.log(`  Y: [${propBounds.minY.toFixed(1)}, ${propBounds.maxY.toFixed(1)}]`);
console.log(`  Z: [${propBounds.minZ.toFixed(1)}, ${propBounds.maxZ.toFixed(1)}]`);

const g1 = analyzeGroup('碰撞组 1 (collisionData1)', parsed.collisionData1);
const g2 = analyzeGroup('碰撞组 2 (collisionData2)', parsed.collisionData2);

console.log('\n=== 两组对比 ===');
console.log(`形状总数: 组1=${g1.allShapes.length}, 组2=${g2.allShapes.length}`);
console.log(`空间范围重叠: X=[${Math.max(g1.bounds.minX, g2.bounds.minX).toFixed(1)}, ${Math.min(g1.bounds.maxX, g2.bounds.maxX).toFixed(1)}]`);

const g1Median = g1.dists[Math.floor(g1.dists.length * 0.5)];
const g2Median = g2.dists[Math.floor(g2.dists.length * 0.5)];
console.log(`到最近 prop 中位距离: 组1=${g1Median.toFixed(2)}, 组2=${g2Median.toFixed(2)}`);

const g1FarCount = g1.dists.filter(d => d > 100).length;
const g2FarCount = g2.dists.filter(d => d > 100).length;
console.log(`远离 prop (>100) 占比: 组1=${(g1FarCount/g1.dists.length*100).toFixed(1)}%, 组2=${(g2FarCount/g2.dists.length*100).toFixed(1)}%`);

console.log('\n=== 按类型分析到最近 prop 距离 (组1) ===');
for (const t of [1, 2, 3]) {
  const shapes = g1.allShapes.filter(s => s.type === t);
  const ds = shapes.map(s => nearestPropDist(s.center)).sort((a,b)=>a-b);
  const med = ds[Math.floor(ds.length*0.5)] || 0;
  const far = ds.filter(d => d > 100).length;
  console.log(`  Type${t}: n=${shapes.length}, 中位距离=${med.toFixed(2)}, >100: ${far} (${(far/shapes.length*100).toFixed(1)}%)`);
}

console.log('\n=== 按类型分析到最近 prop 距离 (组2) ===');
for (const t of [1, 2, 3]) {
  const shapes = g2.allShapes.filter(s => s.type === t);
  const ds = shapes.map(s => nearestPropDist(s.center)).sort((a,b)=>a-b);
  const med = ds[Math.floor(ds.length*0.5)] || 0;
  const far = ds.filter(d => d > 100).length;
  console.log(`  Type${t}: n=${shapes.length}, 中位距离=${med.toFixed(2)}, >100: ${far} (${(far/shapes.length*100).toFixed(1)}%)`);
}

console.log('\n=== Prop 名称分布 (前20) ===');
const nameCounts = {};
for (const p of parsed.props) {
  nameCounts[p.name] = (nameCounts[p.name] || 0) + 1;
}
const sorted = Object.entries(nameCounts).sort((a,b) => b[1] - a[1]);
for (const [name, count] of sorted.slice(0, 20)) {
  console.log(`  ${name}: ${count}`);
}
