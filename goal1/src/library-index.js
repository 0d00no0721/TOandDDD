// M1: 道具库索引构建
// 下载并解析 2 个 library.json，建立可检索的 prop 目录，输出 library_index.json
//
// 实测结构（与文档假设有差异）：
//   - 两库 group.name 都是 null，无法按 group 分类 → 改用 prop.name 前缀 + 语义关键词分类
//   - Main Library: 1020 props, name="Remaster"
//   - New Year Library: 126 props, name="LibNewYear2024_Remaster"（合计 1146）
//   - prop 结构: { mesh:{file, lods, textures:[{diffuseMap,name}]}, name, sprite }
//
// 输出:
//   data/library_index.json   —— 完整索引（含 meshFile/textures/baseUrl，供布局层和序列化层用）
//   data/library_catalog.json —— 精简目录（按语义类别分组，供 LLM prompt 用）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, 'data', 'cache');

// 2 个库（URL 来自 maps.json）
const LIBRARIES = [
    { id: 'main', name: 'Main Library', url: 'https://res.3dtank.com/553/105167/27/302/30546776460526/library.json' },
    { id: 'newyear', name: 'New Year Library', url: 'https://res.3dtank.com/570/174542/371/71/31167243462337/library.json' },
];

// 语义类别关键词映射（基于实测名称前缀）
// 将 prop.name 前缀/关键词归到语义类别，便于 LLM 理解
const CATEGORY_KEYWORDS = {
    natural: ['tree', 'ivy', 'bush', 'cliff', 'rock', 'stone', 'branch', 'leaf', 'pine', 'fir', 'trunk', 'root', 'flower', 'grass', 'mushroom', 'moss', 'fern', 'reed', 'cattail', 'lily', 'algae', 'kelp', 'coral', 'shell', 'crystal', 'icicle', 'ice', 'snow', 'snowman', 'garland', 'christmas', 'newyear', 'winter', 'frost', 'volcano', 'lava', 'geyser', 'cactus', 'palm', 'oak', 'birch', 'willow', 'spruce', 'shrub', 'log', 'stump', 'boulder', 'pebble'],
    structure: ['wall', 'bridge', 'industrial', 'conc', 'concrete', 'wooden', 'wood', 'fab', 'metal', 'steel', 'pipe', 'tank', 'barrel', 'crate', 'box', 'container', 'fence', 'gate', 'pillar', 'column', 'beam', 'rail', 'ladder', 'stair', 'platform', 'scaffold', 'tower', 'building', 'house', 'bunker', 'hangar', 'warehouse', 'factory', 'silo', 'barn', 'shed', 'ramp', 'dock', 'pier', 'tunnel', 'arch', 'ruin', 'fort', 'tower', 'mast', 'crane', 'saw', 'mill', 'windmill', 'machine', 'engine', 'valve', 'generator', 'turbine', 'antenna', 'satellite'],
    decoration: ['balloon', 'vilhou', 'silhouette', 'flag', 'banner', 'sign', 'poster', 'billboard', 'light', 'lamp', 'lantern', 'garland', 'ribbon', 'bow', 'wreath', 'scarecrow', 'statue', 'monument', 'fountain', 'well', 'bench', 'barrel', 'haystack', 'scarecrow', 'painting', 'graffiti'],
    terrain: ['road', 'sandal', 'sand', 'dirt', 'path', 'ground', 'slope', 'hill', 'mountain', 'valley', 'trench', 'ditch', 'mound', 'ramp', 'platform', 'splat', 'terrain', 'landscape', 'island', 'shore', 'beach', 'river', 'lake', 'pond', 'water', 'sea', 'ocean'],
    vehicle: ['body', 'car', 'truck', 'wheel', 'turret', 'hull', 'tracks', 'armor', 'weapon', 'cannon', 'missile', 'rocket', 'helicopter', 'plane', 'ship', 'boat'],
};

// 判断 prop 的语义类别
function semanticCategory(name) {
    const n = name.toLowerCase();
    for (const [cat, keys] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const k of keys) {
            if (n.startsWith(k) || n.includes('_' + k) || n.includes(k + '_')) return cat;
        }
    }
    return 'other';
}

// 名称前缀（第一个下划线前的小写部分），作为细分类
function prefixCategory(name) {
    const pre = name.split('_')[0].toLowerCase();
    return pre || 'other';
}

// 下载（带缓存）。force=true 强制重新下载
async function downloadWithCache(lib, force) {
    const cachePath = join(CACHE_DIR, `${lib.id}_library.json`);
    if (!force && existsSync(cachePath)) {
        console.log(`  [缓存] ${lib.id}`);
        return JSON.parse(readFileSync(cachePath, 'utf8'));
    }
    console.log(`  [下载] ${lib.id}: ${lib.url}`);
    const res = await fetch(lib.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${lib.url}`);
    const json = await res.json();
    writeFileSync(cachePath, JSON.stringify(json));
    return json;
}

// 从 library.json URL 推导 baseUrl（去掉 library.json）
function urlToBaseUrl(url) {
    return url.replace(/\/library\.json$/, '');
}

async function buildIndex(force = false) {
    console.log('=== M1: 道具库索引构建 ===');
    const index = {
        generatedAt: new Date().toISOString(),
        libraries: [],
        props: [],
        stats: { totalProps: 0, byLibrary: {}, bySemanticCategory: {}, byPrefixCategory: {} },
    };

    for (const lib of LIBRARIES) {
        const json = await downloadWithCache(lib, force);
        const baseUrl = urlToBaseUrl(lib.url);
        const libInfo = {
            id: lib.id,
            name: json.name || lib.name,
            url: lib.url,
            baseUrl,
            propCount: 0,
        };

        // 遍历所有 group（实测只有 1 个，group.name=null，但保留遍历以兼容多 group）
        for (const grp of json.groups || []) {
            for (const p of grp.props || []) {
                if (!p.mesh || !p.mesh.file) continue; // 跳过无 mesh 的项
                const semCat = semanticCategory(p.name);
                const preCat = prefixCategory(p.name);
                const textures = (p.mesh.textures || []).map(t => t.diffuseMap).filter(Boolean);
                index.props.push({
                    libId: lib.id,
                    name: p.name,
                    semanticCategory: semCat,
                    prefixCategory: preCat,
                    meshFile: p.mesh.file,
                    textures,
                });
                libInfo.propCount++;
                index.stats.bySemanticCategory[semCat] = (index.stats.bySemanticCategory[semCat] || 0) + 1;
                index.stats.byPrefixCategory[preCat] = (index.stats.byPrefixCategory[preCat] || 0) + 1;
            }
        }
        index.libraries.push(libInfo);
        index.stats.byLibrary[lib.id] = libInfo.propCount;
        index.stats.totalProps += libInfo.propCount;
        console.log(`  ${lib.id}: ${libInfo.propCount} props (name="${libInfo.name}")`);
    }

    // 输出完整索引
    const indexPath = join(ROOT, 'data', 'library_index.json');
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
    console.log(`\n已写出: data/library_index.json (${(JSON.stringify(index).length / 1024).toFixed(1)} KB)`);
    console.log(`总 props: ${index.stats.totalProps}`);
    console.log('按语义类别:', index.stats.bySemanticCategory);

    // 输出精简目录（供 LLM prompt 用）：按 semanticCategory 分组的 prop 名称
    const catalog = {
        generatedAt: index.generatedAt,
        totalProps: index.stats.totalProps,
        libraries: index.libraries.map(l => ({ id: l.id, name: l.name })),
        categories: {},
    };
    for (const p of index.props) {
        if (!catalog.categories[p.semanticCategory]) catalog.categories[p.semanticCategory] = [];
        catalog.categories[p.semanticCategory].push({ name: p.name, libId: p.libId });
    }
    const catalogPath = join(ROOT, 'data', 'library_catalog.json');
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
    console.log(`已写出: data/library_catalog.json (${(JSON.stringify(catalog).length / 1024).toFixed(1)} KB)`);

    return index;
}

// 命令行入口：node src/library-index.js [--force]
const force = process.argv.includes('--force');
buildIndex(force).catch(err => {
    console.error('索引构建失败:', err.message);
    process.exit(1);
});
