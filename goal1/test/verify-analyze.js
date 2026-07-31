// 在真实地图上验证 analyzeMap
// 用 Highland 和高密度 Sandbox 实测

import { analyzeMap } from '../src/analyze-map.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('=== 地图分析器验证 ===\n');

// ── 测试 1: 空数据 ──
console.log('[1] 空数据');
{
    const r = analyzeMap(new Uint8Array(0));
    assert(r.summary.isEmpty, '空数据返回 isEmpty');
}

// ── 测试 2: Highland Summer Day（网路缓存或本地） ──
console.log('\n[2] Highland Summer Day 分析');
const highlandPaths = [
    join(ROOT, 'data', 'cache', 'maps', 'Highland_Summer_Day.bin'),
    join(ROOT, '..', 'testanki1.github.io', 'maps', 'Highland REMASTER Summer Evening', 'map.bin'),
];

let highlandBuf = null;
let highlandPath = '';
for (const p of highlandPaths) {
    try { highlandBuf = readFileSync(p); highlandPath = p; break; } catch {}
}

if (highlandBuf) {
    const r = analyzeMap(highlandBuf);
    console.log(`  来源: ${highlandPath}`);
    assert(r.summary.propCount > 0, `props > 0 (实际 ${r.summary.propCount})`);
    assert(r.summary.materialCount > 0, `materials > 0 (实际 ${r.summary.materialCount})`);
    assert(r.summary.size === 'large', `size = large (实际 ${r.summary.size})`);
    assert(typeof r.symmetry.conclusion === 'string', 'symmetry.conclusion 是字符串');
    assert(r.symmetry.xAxis.ratio >= 0 && r.symmetry.xAxis.ratio <= 1, `xAxis.ratio 在 [0,1] (实际 ${r.symmetry.xAxis.ratio})`);
    assert(r.symmetry.zAxis.ratio >= 0 && r.symmetry.zAxis.ratio <= 1, `zAxis.ratio 在 [0,1] (实际 ${r.symmetry.zAxis.ratio})`);
    assert(Object.keys(r.categories.counts).length >= 5, `categories 至少 5 类 (实际 ${Object.keys(r.categories.counts).length})`);
    assert(r.categories.dominantCategories.length >= 1, '有 dominantCategories');
    assert(typeof r.terrain.description === 'string', 'terrain.description 是字符串');
    assert(r.terrain.collisionComplexity.col1 > 0 || r.terrain.collisionComplexity.col2 > 0, '有碰撞数据');
    assert(r.spatial.gridSize.cols >= 2 && r.spatial.gridSize.rows >= 2, `网格 ≥ 2×2 (实际 ${r.spatial.gridSize.cols}×${r.spatial.gridSize.rows})`);
    assert(r.spatial.avgDensity > 0, 'avgDensity > 0');
    assert(r.topProps.length === 15, `topProps = 15 (实际 ${r.topProps.length})`);
    assert(r.summary.xzRatio > 1, `xzRatio > 1 (地图 x 大于 z) (实际 ${r.summary.xzRatio.toFixed(1)})`);
} else {
    assert(false, '未找到 Highland map.bin 文件');
}

// ── 测试 3: Sandbox Summer Day ──
console.log('\n[3] Sandbox Summer Day 分析');
const sandboxPaths = [
    join(ROOT, 'data', 'cache', 'maps', 'Sandbox_Summer_Day.bin'),
    join(ROOT, 'data', 'cache', 'maps', 'Sandbox_Summer_Evening.bin'),
];

let sandboxBuf = null;
let sandboxPath = '';
for (const p of sandboxPaths) {
    try { sandboxBuf = readFileSync(p); sandboxPath = p; break; } catch {}
}

if (sandboxBuf) {
    const r = analyzeMap(sandboxBuf);
    console.log(`  来源: ${sandboxPath}`);
    assert(r.summary.propCount > 0, `props > 0 (实际 ${r.summary.propCount})`);
    assert(r.summary.size === 'large' || r.summary.size === 'medium', `size = medium/large (实际 ${r.summary.size})`);
} else {
    assert(false, '未找到 Sandbox map.bin 文件');
}

// ── 测试 4: 小图 Forest ──
console.log('\n[4] Forest Summer Day 分析');
const forestPaths = [
    join(ROOT, 'data', 'cache', 'maps', 'Forest_Summer_Day.bin'),
    join(ROOT, 'data', 'cache', 'maps', 'Forest_Winter_Day.bin'),
];

let forestBuf = null;
let forestPath = '';
for (const p of forestPaths) {
    try { forestBuf = readFileSync(p); forestPath = p; break; } catch {}
}

if (forestBuf) {
    const r = analyzeMap(forestBuf);
    console.log(`  来源: ${forestPath}`);
    assert(r.summary.propCount > 0, `props > 0 (实际 ${r.summary.propCount})`);
    assert(r.summary.size === 'small' || r.summary.size === 'medium', `size = small/medium (实际 ${r.summary.size})`);
} else {
    assert(false, '未找到 Forest map.bin 文件');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);