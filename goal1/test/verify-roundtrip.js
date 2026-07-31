// M2 验证：序列化 → 解析 往返一致性测试
// 验证 serialize-map-bin.js 写出的 map.bin 能被 parse-map-bin.js 正确读回

import { serializeMapBin } from '../src/serialize-map-bin.js';
import { parseMapBin } from '../src/parse-map-bin.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.error(`  ✗ ${msg}`); }
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// 把测试用的 material（含 id、texParams 字段顺序任意）规范化为 parseMapBin 的输出格式
// parseMapBin 输出: { name, shader, texParams:[{ libName, name, texName }] }（无 id，id 是 key）
function normMat(m) {
    return {
        name: m.name,
        shader: m.shader,
        texParams: m.texParams.map(tp => ({ libName: tp.libName ?? null, name: tp.name, texName: tp.texName })),
    };
}

// 构造测试数据：覆盖 grpName/rot/scale 的有无组合
// 注意：parseMapBin 读回时会补全默认值（rot=[0,0,0], scale=[1,1,1], texParam.libName=null），
//       所以这里显式写出所有字段，便于精确比较。
//       浮点值用 2 的幂次（Float32 可精确表示），避免精度损失。
function makeTestData() {
    return {
        materials: [
            {
                id: 0, name: 'test_mat_0', shader: 'TankiOnline/SingleTextureShader',
                texParams: [{ name: '_MainTex', texName: 'tex0', libName: null }],
            },
            {
                id: 1, name: 'terrain_1', shader: 'TankiOnline/Terrain',
                texParams: [
                    { name: '_Control', texName: 'ctrl', libName: 'libA' },
                    { name: '_Splat0', texName: 's0', libName: null },
                ],
            },
        ],
        props: [
            // 有 grpName + 有 rot + 有 scale
            { id: 0, grpName: 'g0', libName: '', matID: 0, name: 'wall', pos: [10, 0, 20], rot: [0, 1.5, 0], scale: [2, 1, 2] },
            // 无 grpName + 无 rot + 无 scale（读回为 [0,0,0] / [1,1,1]）
            { id: 1, grpName: '', libName: '', matID: 1, name: 'hill', pos: [-10, 0, -20], rot: [0, 0, 0], scale: [1, 1, 1] },
            // 无 grpName + 有 rot + 有 scale
            { id: 2, grpName: '', libName: 'libX', matID: 0, name: 'crate', pos: [0, 5, 0], rot: [0, 0, 0.5], scale: [1, 1, 1] },
            // 有 grpName + 无 rot + 无 scale
            { id: 3, grpName: 'g1', libName: '', matID: 1, name: 'tree', pos: [50, 0, 50], rot: [0, 0, 0], scale: [1, 1, 1] },
        ],
        collisionData1: {
            // 浮点用 2 的幂次，Float32 精确
            shapesType1: [[1, 2, 3, 0.25, 0.5, 0.125, 5, 6, 7]],
            shapesType2: [{ f1: 12.5, data: [1, 2, 3, 0.25, 0.5, 0.125], f2: 4.5 }],
            shapesType3: [{ f1: 0.5, data: [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3] }],
        },
        collisionData2: { shapesType1: [], shapesType2: [], shapesType3: [] },
    };
}

console.log('=== M2 往返验证 ===\n');

// --- 测试 1：完整数据往返 ---
console.log('[1] 完整数据往返（含碰撞）');
{
    const data = makeTestData();
    const bin = serializeMapBin(data);
    assert(bin instanceof Uint8Array, 'serializeMapBin 返回 Uint8Array');
    assert(bin.length > 0, `生成的 map.bin 非空（${bin.length} 字节）`);

    const parsed = parseMapBin(bin);
    assert(parsed.props.length === data.props.length, `props 数量一致（${parsed.props.length}）`);
    assert(deepEq(parsed.props, data.props), 'props 内容一致');
    assert(Object.keys(parsed.materials).length === 2, 'materials 数量一致');
    assert(deepEq(parsed.materials[0], normMat(data.materials[0])), 'material 0 一致');
    assert(deepEq(parsed.materials[1], normMat(data.materials[1])), 'material 1 一致（含 libName）');
    assert(parsed.collisionData1.shapesType1.length === 1, 'col1 type1 数量一致');
    assert(deepEq(parsed.collisionData1, data.collisionData1), 'collisionData1 一致');
    assert(deepEq(parsed.collisionData2, data.collisionData2), 'collisionData2 一致（全空）');
}

// --- 测试 2：空地图（无 props/materials/碰撞） ---
console.log('\n[2] 空地图往返');
{
    const data = { props: [], materials: [] };
    const bin = serializeMapBin(data);
    const parsed = parseMapBin(bin);
    assert(parsed.props.length === 0, 'props 为空');
    assert(Object.keys(parsed.materials).length === 0, 'materials 为空');
    assert(parsed.collisionData1.shapesType1.length === 0, 'col1 type1 为空');
    assert(parsed.collisionData2.shapesType3.length === 0, 'col2 type3 为空');
}

// --- 测试 3：浮点精度（rot/scale 边界值） ---
console.log('\n[3] 浮点精度与零值优化');
{
    const data = {
        materials: [{ id: 0, name: 'm', shader: 'S', texParams: [] }],
        props: [
            // rot 极小（应被当作 0，不写 rot 位）
            { id: 0, grpName: '', libName: '', matID: 0, name: 'a', pos: [0, 0, 0], rot: [1e-7, 0, 0], scale: [1, 1, 1] },
            // scale 极接近 1（应被当作 1，不写 scale 位）
            { id: 1, grpName: '', libName: '', matID: 0, name: 'b', pos: [1, 1, 1], rot: [0, 0, 0], scale: [1 + 1e-7, 1, 1] },
            // 正常 rot + scale
            { id: 2, grpName: '', libName: '', matID: 0, name: 'c', pos: [2, 2, 2], rot: [1, 2, 3], scale: [3, 2, 1] },
        ],
    };
    const bin = serializeMapBin(data);
    const parsed = parseMapBin(bin);
    // 零值优化的 prop 读回应是 [0,0,0] / [1,1,1]
    assert(deepEq(parsed.props[0].rot, [0, 0, 0]), '极小 rot 读回为 [0,0,0]');
    assert(deepEq(parsed.props[0].scale, [1, 1, 1]), '默认 scale 读回为 [1,1,1]');
    assert(deepEq(parsed.props[1].scale, [1, 1, 1]), '极接近1的 scale 读回为 [1,1,1]');
    assert(deepEq(parsed.props[2].rot, [1, 2, 3]), '正常 rot 精确保留');
    assert(deepEq(parsed.props[2].scale, [3, 2, 1]), '正常 scale 精确保留');
}

// --- 测试 4：与编辑器导出行为一致的空碰撞 ---
console.log('\n[4] 默认空碰撞（与 generateMapBin:2785 一致）');
{
    const data = { props: [{ id: 0, grpName: '', libName: '', matID: 0, name: 'x', pos: [0,0,0] }], materials: [{ id: 0, name: 'm', shader: 'S', texParams: [] }] };
    const bin = serializeMapBin(data);
    const parsed = parseMapBin(bin);
    assert(parsed.collisionData1.shapesType1.length === 0 && parsed.collisionData1.shapesType2.length === 0 && parsed.collisionData1.shapesType3.length === 0, 'collisionData1 三段全空');
    assert(parsed.collisionData2.shapesType1.length === 0 && parsed.collisionData2.shapesType2.length === 0 && parsed.collisionData2.shapesType3.length === 0, 'collisionData2 三段全空');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
