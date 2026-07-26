// M3 验证：过程化布局层端到端测试
// 验证 generateLayout → serializeMapBin → parseMapBin 全链路

import { generateLayout, generateDefaultLayout } from '../src/layout.js';
import { serializeMapBin } from '../src/serialize-map-bin.js';
import { parseMapBin } from '../src/parse-map-bin.js';
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

// 加载库索引用于交叉验证
const index = JSON.parse(readFileSync(join(ROOT, 'data', 'library_index.json'), 'utf8'));
const indexPropNames = new Set(index.props.map(p => `${p.libId}:${p.name}`));

const SIZE_BOUNDS = {
    small:  { half: 800 },
    medium: { half: 1500 },
    large:  { half: 2500 },
};

console.log('=== M3 过程化布局层验证 ===\n');

// --- 测试 1：generateDefaultLayout 返回合法结构 ---
console.log('[1] generateDefaultLayout 返回合法结构');
{
    const layout = generateDefaultLayout();
    assert(layout.props && layout.props.length > 0, `props 非空（${layout.props.length} 个）`);
    assert(layout.materials && layout.materials.length > 0, `materials 非空（${layout.materials.length} 个）`);
    assert(layout.stats.propCount === layout.props.length, `stats.propCount 一致（${layout.stats.propCount}）`);
    assert(layout.stats.materialCount === layout.materials.length, `stats.materialCount 一致（${layout.stats.materialCount}）`);
}

// --- 测试 2：端到端 serializeMapBin → parseMapBin ---
console.log('\n[2] 端到端：layout → serializeMapBin → parseMapBin');
{
    const layout = generateDefaultLayout();
    const bin = serializeMapBin(layout);
    assert(bin instanceof Uint8Array && bin.length > 0, `serializeMapBin 生成 map.bin（${bin.length} 字节）`);

    const parsed = parseMapBin(bin);
    assert(parsed.props.length === layout.props.length, `props 数量往返一致（${parsed.props.length}）`);
    assert(Object.keys(parsed.materials).length === layout.materials.length, `materials 数量往返一致`);
    assert(parsed.collisionData1.shapesType1.length === 0, 'collisionData1 为空（默认）');
    assert(parsed.collisionData2.shapesType1.length === 0, 'collisionData2 为空（默认）');
}

// --- 测试 3：对称布局 props 数量应为选取消数的 2 倍 ---
console.log('\n[3] 对称镜像：props 数量 = 选取数 × 2');
{
    const layout = generateDefaultLayout();
    // defaultLayout: structure 15 + natural 12 + decoration 6 = 33 selected, ×2 mirror = 66
    const expectedSelected = 15 + 12 + 6;
    assert(layout.props.length === expectedSelected * 2, `props 数量 = ${expectedSelected}×2 = ${expectedSelected * 2}（实际 ${layout.props.length}）`);
}

// --- 测试 4：所有 prop 的 pos 在 SIZE_BOUNDS 范围内 ---
console.log('\n[4] 坐标范围检查');
{
    const layout = generateDefaultLayout();
    const half = SIZE_BOUNDS.small.half;
    let outOfBounds = 0;
    for (const p of layout.props) {
        if (Math.abs(p.pos[0]) > half || Math.abs(p.pos[2]) > half) outOfBounds++;
    }
    assert(outOfBounds === 0, `所有 prop 的 x/z 在 [-${half}, ${half}] 内（${outOfBounds} 个越界）`);
    // y 应为 0（贴地）
    let yOk = 0;
    for (const p of layout.props) if (p.pos[1] === 0) yOk++;
    assert(yOk === layout.props.length, `所有 prop 的 y=0（${yOk}/${layout.props.length}）`);
}

// --- 测试 5：所有 prop 的 matID 在 materials 表中存在 ---
console.log('\n[5] matID 有效性检查');
{
    const layout = generateDefaultLayout();
    const matIDs = new Set(layout.materials.map(m => m.id));
    let invalid = 0;
    for (const p of layout.props) {
        if (!matIDs.has(p.matID)) invalid++;
    }
    assert(invalid === 0, `所有 prop 的 matID 在 materials 表中存在（${invalid} 个无效）`);
}

// --- 测试 6：所有 prop 的 name 在 library_index.json 中存在 ---
console.log('\n[6] prop name 在库索引中存在');
{
    const layout = generateDefaultLayout();
    let notFound = 0;
    for (const p of layout.props) {
        const key = `${p.libName === 'newyear' ? 'newyear' : 'main'}:${p.name}`;
        if (!indexPropNames.has(key)) notFound++;
    }
    assert(notFound === 0, `所有 prop name 在 library_index.json 中存在（${notFound} 个未找到）`);
}

// --- 测试 7：自定义参数 + 非对称布局 ---
console.log('\n[7] 自定义参数（large/非对称/scattered）');
{
    const layout = generateLayout({
        style: 'asymmetric',
        size: 'large',
        propDensity: 'high',
        propSelection: [
            { category: 'structure', count: 20, placement: 'scattered' },
            { category: 'natural', count: 10, placement: 'perimeter' },
        ],
        seed: 7,
    });
    // 非对称 → 无镜像副本 → props 数量 = 选取数
    assert(layout.props.length === 30, `非对称 props 数量 = 30（实际 ${layout.props.length}）`);
    const half = SIZE_BOUNDS.large.half;
    let outOfBounds = 0;
    for (const p of layout.props) {
        if (Math.abs(p.pos[0]) > half || Math.abs(p.pos[2]) > half) outOfBounds++;
    }
    assert(outOfBounds === 0, `large 尺寸坐标在 [-${half}, ${half}] 内（${outOfBounds} 个越界）`);

    // 端到端序列化
    const bin = serializeMapBin(layout);
    const parsed = parseMapBin(bin);
    assert(parsed.props.length === 30, `往返 props 一致（${parsed.props.length}）`);
}

// --- 测试 8：可复现性（同 seed 产生相同布局） ---
console.log('\n[8] 可复现性（同 seed 相同布局）');
{
    const a = generateLayout({
        style: 'symmetric', size: 'medium', seed: 99,
        propSelection: [{ category: 'decoration', count: 5, placement: 'scattered' }],
        symmetry: { type: 'mirror', axis: 'x' },
    });
    const b = generateLayout({
        style: 'symmetric', size: 'medium', seed: 99,
        propSelection: [{ category: 'decoration', count: 5, placement: 'scattered' }],
        symmetry: { type: 'mirror', axis: 'x' },
    });
    assert(JSON.stringify(a.props) === JSON.stringify(b.props), '同 seed 产生相同 props');
    assert(JSON.stringify(a.materials) === JSON.stringify(b.materials), '同 seed 产生相同 materials');
}

// --- 测试 9：material shader 全为 SingleTextureShader ---
console.log('\n[9] material shader 检查');
{
    const layout = generateDefaultLayout();
    let allSingle = 0;
    for (const m of layout.materials) {
        if (m.shader === 'TankiOnline/SingleTextureShader') allSingle++;
    }
    assert(allSingle === layout.materials.length, `所有 material shader = SingleTextureShader（${allSingle}/${layout.materials.length}）`);
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
