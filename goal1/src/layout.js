// M3: 过程化布局层
// 输入: 高层参数 JSON（来自 LLM 或硬编码）
// 输出: { props, materials } —— 与 parseMapBin 输出同构，可直接喂给 serializeMapBin
//
// 算法：
//   1. 道具选取：从 library_index.json 按 semanticCategory 筛选具体 prop
//   2. 材质表构建：每个 prop 用其 mesh.textures[0].diffuseMap 作为贴图，
//      shader="TankiOnline/SingleTextureShader"，texName="<libFolder>_<diffuseMap>"
//      （对应 generateMapBin:2759-2775 的 _baseTexName 分支）
//   3. 布局生成：
//      - size → 地图边界（x/z 范围）
//      - placement 策略：perimeter / scattered / clustered / grid
//      - symmetry: mirror 沿 x 或 z 轴生成镜像副本
//      - 避让：网格法（把地图划成格子，每格至多 1 个 prop）
//   4. 坐标系：Y-up，地面 y=0，x/z 水平面。prop 默认贴地放置（y=0）

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------- 配置 ----------
const SIZE_BOUNDS = {
    small:  { half: 800,  yMax: 300 },   // 1600×1600
    medium: { half: 1500, yMax: 500 },   // 3000×3000
    large:  { half: 2500, yMax: 800 },   // 5000×5000
};

const DENSITY_COUNT = { low: 30, medium: 70, high: 130 };

// 简易确定性 PRNG（seeded，便于复现）
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------- 库索引加载 ----------
let _indexCache = null;
function loadIndex() {
    if (_indexCache) return _indexCache;
    const p = join(ROOT, 'data', 'library_index.json');
    _indexCache = JSON.parse(readFileSync(p, 'utf8'));
    return _indexCache;
}

// 从库 baseUrl 提取八进制文件夹名并转十进制（移植自 editor.html:2627 getDecimalPrefix）
function getDecimalPrefix(url) {
    if (!url) return 'common';
    const folder = url.split('/').pop();
    if (folder === 'null' || !folder) return 'common';
    if (/^[0-7]+$/.test(folder)) {
        try { return BigInt('0o' + folder).toString(10); } catch { return folder; }
    }
    return folder;
}

// 按 semanticCategory 从索引中筛选 props
// category 可用: natural / structure / decoration / terrain / vehicle / other
function selectPropsFromCategory(category, count, rng, libIdFilter = null) {
    const index = loadIndex();
    let pool = index.props.filter(p => p.semanticCategory === category);
    if (libIdFilter) pool = pool.filter(p => p.libId === libIdFilter);
    if (pool.length === 0) return [];
    // 随机抽样（不重复）
    const chosen = [];
    const used = new Set();
    let tries = 0;
    while (chosen.length < count && tries < count * 5) {
        const p = pool[Math.floor(rng() * pool.length)];
        const key = p.libId + ':' + p.name;
        if (!used.has(key)) { used.add(key); chosen.push(p); }
        tries++;
    }
    return chosen;
}

// ---------- 材质表构建 ----------
// 输入：props 列表（每项含 libId, name, textures, baseUrl）
// 输出：{ materials, propMatID } —— materials 是数组，propMatID 是 prop→matID 的 Map
function buildMaterials(propsWithLib) {
    const materials = [];
    const keyToMatID = new Map();
    let nextMatID = 0;
    const propMatID = new Map();

    for (const p of propsWithLib) {
        const libFolder = getDecimalPrefix(p.baseUrl);
        const baseTex = p.prop.textures[0] || (p.prop.name + '.png');
        const baseName = baseTex.split('/').pop();
        const uniqueTexName = baseName.startsWith(libFolder + '_') ? baseName : `${libFolder}_${baseName}`;
        const texKey = `${p.baseUrl}_${baseName}`;
        let matID = keyToMatID.get(texKey);
        if (matID === undefined) {
            matID = nextMatID++;
            keyToMatID.set(texKey, matID);
            materials.push({
                id: matID,
                name: uniqueTexName,
                shader: 'TankiOnline/SingleTextureShader',
                texParams: [{ name: '_MainTex', texName: uniqueTexName, libName: null }],
            });
        }
        propMatID.set(p, matID);
    }
    return { materials, propMatID };
}

// ---------- 放置策略 ----------
// perimeter: 沿地图边界放置
// scattered: 随机散布
// clustered: 聚团（一个中心点附近）
// grid: 网格均匀分布
function placeProp(prop, placement, bounds, rng, occupied) {
    const { half } = bounds;
    const margin = 50;
    let x, z;
    let attempts = 0;
    do {
        switch (placement) {
            case 'perimeter': {
                // 沿四条边随机
                const side = Math.floor(rng() * 4);
                const t = rng() * 2 - 1;
                if (side === 0) { x = t * half; z = -half + margin; }
                else if (side === 1) { x = t * half; z = half - margin; }
                else if (side === 2) { x = -half + margin; z = t * half; }
                else { x = half - margin; z = t * half; }
                break;
            }
            case 'clustered': {
                // 围绕中心聚团
                const cx = (rng() - 0.5) * half * 0.3;
                const cz = (rng() - 0.5) * half * 0.3;
                x = cx + (rng() - 0.5) * half * 0.4;
                z = cz + (rng() - 0.5) * half * 0.4;
                break;
            }
            case 'grid': {
                const cells = Math.ceil(Math.sqrt(64));
                const step = (half * 2) / cells;
                const ci = Math.floor(rng() * cells);
                const cj = Math.floor(rng() * cells);
                x = -half + ci * step + step / 2 + (rng() - 0.5) * step * 0.3;
                z = -half + cj * step + step / 2 + (rng() - 0.5) * step * 0.3;
                break;
            }
            case 'scattered':
            default: {
                x = (rng() - 0.5) * half * 1.8;
                z = (rng() - 0.5) * half * 1.8;
            }
        }
        attempts++;
    } while (occupied.has(`${Math.round(x / 100)},${Math.round(z / 100)}`) && attempts < 20);
    occupied.add(`${Math.round(x / 100)},${Math.round(z / 100)}`);
    return [x, 0, z];
}

// ---------- 镜像 ----------
function mirrorPos(pos, axis, bounds) {
    if (axis === 'x') return [-pos[0], pos[1], pos[2]];
    if (axis === 'z') return [pos[0], pos[1], -pos[2]];
    return pos;
}
function mirrorRot(rot, axis) {
    // 镜像后绕轴的旋转需反转。简化处理：mirror x → rot.y 取反；mirror z → rot.y 取反
    if (!rot || (rot[0] === 0 && rot[1] === 0 && rot[2] === 0)) return rot || [0, 0, 0];
    if (axis === 'x') return [rot[0], -rot[1], rot[2]];
    if (axis === 'z') return [rot[0], -rot[1], rot[2]];
    return rot;
}

// ---------- 主布局入口 ----------
// 输入 params:
//   {
//     style: "symmetric"|"asymmetric",
//     size: "small"|"medium"|"large",
//     symmetry: { type:"mirror", axis:"x"|"z" } | null,
//     propDensity: "low"|"medium"|"high",
//     propSelection: [ { category, count, placement } ],
//     seed: number  // 可选，默认 1
//   }
// 输出: { props, materials, params }
export function generateLayout(params) {
    const index = loadIndex();
    const libUrlById = {};
    for (const l of index.libraries) libUrlById[l.id] = { url: l.url, baseUrl: l.baseUrl };

    const size = params.size || 'medium';
    const bounds = SIZE_BOUNDS[size] || SIZE_BOUNDS.medium;
    const seed = params.seed ?? 1;
    const rng = mulberry32(seed);
    const occupied = new Set();

    // 1. 选取 props（带库信息）
    const selected = []; // { prop(索引项), baseUrl, category, placement }
    const selections = params.propSelection && params.propSelection.length > 0
        ? params.propSelection
        : [{ category: 'structure', count: DENSITY_COUNT[params.propDensity || 'medium'], placement: 'scattered' }];

    for (const sel of selections) {
        const count = sel.count || 10;
        const chosen = selectPropsFromCategory(sel.category, count, rng);
        for (const prop of chosen) {
            selected.push({
                prop,
                baseUrl: libUrlById[prop.libId].baseUrl,
                category: sel.category,
                placement: sel.placement || 'scattered',
            });
        }
    }

    // 2. 构建材质表
    const { materials, propMatID } = buildMaterials(selected);

    // 3. 放置
    const props = [];
    let nextId = 0;
    const symmetry = (params.style === 'symmetric' && params.symmetry) ? params.symmetry : null;

    for (const item of selected) {
        const pos = placeProp(item.prop, item.placement, bounds, rng, occupied);
        const matID = propMatID.get(item);
        const rot = [0, rng() * Math.PI * 2, 0]; // 随机 Y 旋转
        const scale = [1, 1, 1];
        const baseProp = {
            id: nextId++,
            grpName: '',
            libName: item.prop.libId === 'newyear' ? 'newyear' : '',
            matID,
            name: item.prop.name,
            pos,
            rot,
            scale,
        };
        props.push(baseProp);

        // 镜像副本
        if (symmetry && symmetry.type === 'mirror') {
            props.push({
                ...baseProp,
                id: nextId++,
                pos: mirrorPos(pos, symmetry.axis, bounds),
                rot: mirrorRot(rot, symmetry.axis),
            });
        }
    }

    return { props, materials, params, bounds, stats: { propCount: props.length, materialCount: materials.length } };
}

// 便捷函数：用默认参数生成一个示例布局
export function generateDefaultLayout() {
    return generateLayout({
        style: 'symmetric',
        size: 'small',
        symmetry: { type: 'mirror', axis: 'x' },
        propDensity: 'medium',
        propSelection: [
            { category: 'structure', count: 15, placement: 'perimeter' },
            { category: 'natural', count: 12, placement: 'scattered' },
            { category: 'decoration', count: 6, placement: 'clustered' },
        ],
        seed: 42,
    });
}
