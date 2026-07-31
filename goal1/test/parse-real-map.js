// 用真实 Highland map.bin 验证 parseMapBin 能正确解析游戏原版地图
// 这是 M2 的另一验证维度：确保解析器对真实数据（含 atlases/碰撞/未知数组）兼容

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapBin } from '../src/parse-map-bin.js';

const mapPath = join('..', 'testanki1.github.io', 'maps', 'Highland REMASTER Summer Evening', 'map.bin');
const buf = readFileSync(mapPath);
console.log(`读取真实 map.bin: ${mapPath} (${(buf.length / 1024).toFixed(1)} KB)`);

const data = parseMapBin(buf);
console.log('\n=== 真实 Highland map.bin 解析结果 ===');
console.log(`props:       ${data.props.length}`);
console.log(`materials:   ${Object.keys(data.materials).length}`);
console.log(`atlases:     ${Object.keys(data.atlases).length}`);
console.log(`collisionData1: type1=${data.collisionData1.shapesType1.length}, type2=${data.collisionData1.shapesType2.length}, type3=${data.collisionData1.shapesType3.length}`);
console.log(`collisionData2: type1=${data.collisionData2.shapesType1.length}, type2=${data.collisionData2.shapesType2.length}, type3=${data.collisionData2.shapesType3.length}`);

// 坐标范围（用于确定 Tanki 地图的有效坐标范围 —— 目标1 待定问题之一）
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of data.props) {
    minX = Math.min(minX, p.pos[0]); maxX = Math.max(maxX, p.pos[0]);
    minY = Math.min(minY, p.pos[1]); maxY = Math.max(maxY, p.pos[1]);
    minZ = Math.min(minZ, p.pos[2]); maxZ = Math.max(maxZ, p.pos[2]);
}
console.log(`\nprops 坐标范围:`);
console.log(`  x: [${minX.toFixed(1)}, ${maxX.toFixed(1)}]  宽 ${((maxX - minX) / 2).toFixed(1)}`);
console.log(`  y: [${minY.toFixed(1)}, ${maxY.toFixed(1)}]  高 ${(maxY - minY).toFixed(1)}`);
console.log(`  z: [${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]  宽 ${((maxZ - minZ) / 2).toFixed(1)}`);

// 抽样几个 prop
console.log(`\nprops 抽样（前 3 个）:`);
for (const p of data.props.slice(0, 3)) {
    console.log(`  id=${p.id} name="${p.name}" grp="${p.grpName}" matID=${p.matID} pos=[${p.pos.map(v => v.toFixed(1)).join(',')}] lib="${p.libName}"`);
}

// 材质 shader 分布
const shaders = {};
for (const m of Object.values(data.materials)) {
    shaders[m.shader] = (shaders[m.shader] || 0) + 1;
}
console.log(`\nshader 分布:`, shaders);

console.log('\n✓ 真实 map.bin 解析成功（parseMapBin 兼容原版数据）');
