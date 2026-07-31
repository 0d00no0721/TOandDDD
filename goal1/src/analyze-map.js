// 地图深度分析器
// 输入: map.bin 文件路径或 Buffer
// 输出: 结构化分析结果（对称性 / 空间热力 / 地形 / 类别分布 / 玩法推断）
//
// 用法:
//   node src/analyze-map.js path/to/map.bin          → JSON 输出
//   node src/analyze-map.js path/to/map.bin --json   → 纯 JSON
//
// 编程调用:
//   import { analyzeMap } from './analyze-map.js';
//   const result = analyzeMap(buffer);

import { readFileSync } from 'node:fs';
import { parseMapBin } from './parse-map-bin.js';

const EPS = 1e-2;

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function std(arr, avg) { if (arr.length < 2) return 0; const m = avg ?? mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); }

function classifySize(halfX, halfZ) {
    if (halfX <= 40000) return 'small';
    if (halfX <= 105000) return 'medium';
    return 'large';
}

const CATEGORY_KEYWORDS = {
    natural: ['tree', 'ivy', 'bush', 'cliff', 'rock', 'stone', 'branch', 'leaf', 'pine', 'fir', 'trunk', 'root', 'flower', 'grass', 'mushroom', 'moss', 'fern', 'reed', 'cattail', 'lily', 'algae', 'kelp', 'coral', 'shell', 'crystal', 'icicle', 'ice', 'snow', 'snowman', 'garland', 'christmas', 'newyear', 'winter', 'frost', 'volcano', 'lava', 'geyser', 'cactus', 'palm', 'oak', 'birch', 'willow', 'spruce', 'shrub', 'log', 'stump', 'boulder', 'pebble'],
    structure: ['wall', 'bridge', 'industrial', 'conc', 'concrete', 'wooden', 'wood', 'fab', 'metal', 'steel', 'pipe', 'tank', 'barrel', 'crate', 'box', 'container', 'fence', 'gate', 'pillar', 'column', 'beam', 'rail', 'ladder', 'stair', 'platform', 'scaffold', 'tower', 'building', 'house', 'bunker', 'hangar', 'warehouse', 'factory', 'silo', 'barn', 'shed', 'ramp', 'dock', 'pier', 'tunnel', 'arch', 'ruin', 'fort', 'mast', 'crane', 'sawmill', 'mill', 'windmill', 'machine', 'engine', 'valve', 'generator', 'turbine', 'antenna', 'satellite'],
    decoration: ['balloon', 'vilhou', 'silhouette', 'flag', 'banner', 'sign', 'poster', 'billboard', 'light', 'lamp', 'lantern', 'ribbon', 'bow', 'wreath', 'scarecrow', 'statue', 'monument', 'fountain', 'well', 'bench', 'haystack', 'painting', 'graffiti'],
    terrain: ['road', 'sandal', 'sand', 'dirt', 'path', 'ground', 'slope', 'hill', 'mountain', 'valley', 'trench', 'ditch', 'mound', 'ramp', 'platform', 'splat', 'terrain', 'landscape', 'island', 'shore', 'beach', 'river', 'lake', 'pond', 'water', 'sea', 'ocean'],
    vehicle: ['body', 'car', 'truck', 'wheel', 'turret', 'hull', 'tracks', 'armor', 'weapon', 'cannon', 'missile', 'rocket', 'helicopter', 'plane', 'ship', 'boat'],
};

function semanticCategory(name) {
    const n = name.toLowerCase();
    for (const [cat, keys] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const k of keys) {
            if (n.startsWith(k) || n.includes('_' + k) || n.includes(k + '_')) return cat;
        }
    }
    return 'other';
}

export const CATEGORY_COLORS = {
    natural: 0x4CAF50,
    structure: 0x9E9E9E,
    decoration: 0x2196F3,
    terrain: 0x795548,
    vehicle: 0xF44336,
    other: 0x9C27B0,
};

export { semanticCategory };

function detectSymmetry(props) {
    if (props.length === 0) return { xAxis: { isSymmetric: false, ratio: 0, axisAt: 0 }, zAxis: { isSymmetric: false, ratio: 0, axisAt: 0 }, conclusion: 'empty' };

    const positions = props.map(p => ({ x: p.pos[0], z: p.pos[2], name: p.name }));

    function checkAxis(axis) {
        const candidateAxes = [0];
        if (axis === 'x') {
            candidateAxes.push(median(positions.map(p => p.x)));
            candidateAxes.push(mean(positions.map(p => p.x)));
        } else {
            candidateAxes.push(median(positions.map(p => p.z)));
            candidateAxes.push(mean(positions.map(p => p.z)));
        }

        let best = { axisAt: 0, ratio: 0 };

        for (const axisAt of candidateAxes) {
            const mirrored = new Map();
            for (const p of positions) {
                let mirroredCoord;
                if (axis === 'x') {
                    mirroredCoord = 2 * axisAt - p.x;
                } else {
                    mirroredCoord = 2 * axisAt - p.z;
                }
                const key = `${p.name}`;
                if (!mirrored.has(key)) mirrored.set(key, []);
                mirrored.get(key).push(mirroredCoord);
            }

            let matched = 0;
            let total = 0;
            const checked = new Set();

            for (let i = 0; i < positions.length; i++) {
                const p = positions[i];
                const coord = axis === 'x' ? p.x : p.z;
                const key = `${i}`;
                if (checked.has(key)) continue;

                const mirrorCoord = axis === 'x' ? 2 * axisAt - p.x : 2 * axisAt - p.z;
                const tolerance = Math.abs(mirrorCoord - coord) * 0.05 + 50;

                let found = false;
                for (let j = i + 1; j < positions.length; j++) {
                    const q = positions[j];
                    if (checked.has(`${j}`)) continue;
                    if (q.name !== p.name) continue;

                    const qCoord = axis === 'x' ? q.x : q.z;
                    const qMirror = Math.abs(qCoord - mirrorCoord);

                    if (qMirror < tolerance) {
                        checked.add(`${i}`);
                        checked.add(`${j}`);
                        matched += 2;
                        found = true;
                        break;
                    }
                }
                if (!found) total++;
            }
            total += matched;

            const ratio = total > 0 ? matched / total : 0;

            if (ratio > best.ratio) {
                best = { axisAt, ratio: parseFloat(ratio.toFixed(3)), matchedCount: matched, totalCount: total };
            }
        }

        return {
            isSymmetric: best.ratio > 0.8,
            ratio: best.ratio,
            axisAt: Math.round(best.axisAt),
            matchedCount: best.matchedCount ?? 0,
            totalCount: best.totalCount ?? 0,
        };
    }

    const xResult = checkAxis('x');
    const zResult = checkAxis('z');

    let conclusion;
    if (xResult.isSymmetric && zResult.isSymmetric) conclusion = '双轴对称';
    else if (xResult.isSymmetric) conclusion = 'x 轴对称';
    else if (zResult.isSymmetric) conclusion = 'z 轴对称';
    else conclusion = '不对称';

    return { xAxis: xResult, zAxis: zResult, conclusion };
}

function analyzeSpatialLayout(props, bounds) {
    const { minX, maxX, minZ, maxZ } = bounds;
    if (props.length === 0) return { densityMap: [], hotZones: [], corridors: [], gridSummary: '' };

    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;

    // 自适应网格：目标每格约 20 个 props
    const targetPerCell = 20;
    const totalCellsTarget = Math.max(4, Math.round(props.length / targetPerCell));
    const aspectRatio = spanX / spanZ;
    const cols = Math.max(2, Math.round(Math.sqrt(totalCellsTarget * aspectRatio * 3)));
    const rows = Math.max(2, Math.round(totalCellsTarget / cols));

    const cellW = spanX / cols;
    const cellH = spanZ / rows;
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

    for (const p of props) {
        const col = Math.min(cols - 1, Math.max(0, Math.floor((p.pos[0] - minX) / cellW)));
        const row = Math.min(rows - 1, Math.max(0, Math.floor((p.pos[2] - minZ) / cellH)));
        grid[row][col]++;
    }

    const allDensities = grid.flat();
    const avgDensity = mean(allDensities);
    const stdDensity = std(allDensities, avgDensity);
    const thresholdHot = avgDensity + stdDensity * 1.5;
    const thresholdCold = Math.max(1, avgDensity - stdDensity * 0.5);

    const hotZones = [];
    const coldZones = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const d = grid[r][c];
            const cx = minX + (c + 0.5) * cellW;
            const cz = minZ + (r + 0.5) * cellH;
            if (d >= thresholdHot) hotZones.push({ row: r, col: c, cx: Math.round(cx), cz: Math.round(cz), density: d });
            if (d <= thresholdCold) coldZones.push({ row: r, col: c, cx: Math.round(cx), cz: Math.round(cz), density: d });
        }
    }

    // 通路检测：连续的低密度区域横跨地图
    const corridors = [];
    for (let r = 0; r < rows; r++) {
        let start = -1;
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] < avgDensity * 0.5) {
                if (start === -1) start = c;
            } else {
                if (start !== -1 && c - start >= Math.max(2, cols * 0.15)) {
                    corridors.push({
                        row: r,
                        fromCol: start, toCol: c - 1,
                        fromX: Math.round(minX + start * cellW),
                        toX: Math.round(minX + c * cellW),
                        cz: Math.round(minZ + (r + 0.5) * cellH),
                    });
                }
                start = -1;
            }
        }
        if (start !== -1 && cols - start >= Math.max(2, cols * 0.15)) {
            corridors.push({
                row: r, fromCol: start, toCol: cols - 1,
                fromX: Math.round(minX + start * cellW),
                toX: Math.round(minX + cols * cellW),
                cz: Math.round(minZ + (r + 0.5) * cellH),
            });
        }
    }

    const hotRatio = hotZones.length / (rows * cols);
    let gridSummary;
    if (hotRatio > 0.3) gridSummary = '密度高，覆盖均匀';
    else if (hotRatio > 0.15) gridSummary = '有明显密集区和稀疏区的对比';
    else if (hotZones.length > 0) gridSummary = '大部分区域稀疏，少数热点';
    else gridSummary = '整体稀疏，无显著密集区';

    return {
        gridSize: { cols, rows, cellW: Math.round(cellW), cellH: Math.round(cellH) },
        avgDensity: parseFloat(avgDensity.toFixed(1)),
        stdDensity: parseFloat(stdDensity.toFixed(1)),
        hotZones,
        coldZones,
        corridors,
        gridSummary,
    };
}

function analyzeTerrain(props, collisionData1, collisionData2) {
    if (props.length === 0) return { isFlat: true, description: '空地图' };

    const yVals = props.map(p => p.pos[1]);
    const yMin = Math.min(...yVals);
    const yMax = Math.max(...yVals);
    const yMean = mean(yVals);
    const yStd = std(yVals, yMean);
    const yRange = yMax - yMin;

    const col1Count = (collisionData1?.shapesType1?.length || 0) + (collisionData1?.shapesType2?.length || 0) + (collisionData1?.shapesType3?.length || 0);
    const col2Count = (collisionData2?.shapesType1?.length || 0) + (collisionData2?.shapesType2?.length || 0) + (collisionData2?.shapesType3?.length || 0);

    let description;
    let isFlat;
    if (yRange < 100) { isFlat = true; description = '完全平坦'; }
    else if (yRange < 500) { isFlat = false; description = '略有起伏'; }
    else if (yRange < 2000) { isFlat = false; description = '有明显高低差'; }
    else { isFlat = false; description = '地形复杂，高差大'; }

    return {
        isFlat,
        yMin: Math.round(yMin),
        yMax: Math.round(yMax),
        yMean: Math.round(yMean),
        yStd: Math.round(yStd),
        yRange: Math.round(yRange),
        description,
        collisionComplexity: { col1: col1Count, col2: col2Count },
    };
}

function analyzeCategories(props) {
    const counts = { natural: 0, structure: 0, decoration: 0, terrain: 0, vehicle: 0, other: 0 };
    let known = 0, unknown = 0;

    for (const p of props) {
        const cat = semanticCategory(p.name);
        if (cat in counts) { counts[cat]++; known++; }
        else { unknown++; }
    }

    const total = props.length || 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const dominantCategories = sorted.filter(([, c]) => c / total > 0.05).map(([n]) => n);

    return {
        counts,
        ratios: Object.fromEntries(sorted.map(([k, v]) => [k, parseFloat((v / total * 100).toFixed(1))])),
        dominantCategories,
        knownRatio: parseFloat((known / total * 100).toFixed(1)),
    };
}

function analyzeShaders(materials) {
    const shaderCounts = {};
    for (const m of Object.values(materials)) {
        shaderCounts[m.shader] = (shaderCounts[m.shader] || 0) + 1;
    }
    return shaderCounts;
}

function getTopProps(props, n = 15) {
    const freq = {};
    for (const p of props) freq[p.name] = (freq[p.name] || 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
}

export function analyzeMap(buffer) {
    let data;
    try {
        data = parseMapBin(buffer);
    } catch {
        return { summary: { propCount: 0, size: 'empty', isEmpty: true } };
    }
    const props = data.props;

    if (props.length === 0) {
        return { summary: { propCount: 0, size: 'empty', isEmpty: true } };
    }

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of props) {
        minX = Math.min(minX, p.pos[0]); maxX = Math.max(maxX, p.pos[0]);
        minZ = Math.min(minZ, p.pos[2]); maxZ = Math.max(maxZ, p.pos[2]);
    }

    const halfX = Math.round((maxX - minX) / 2);
    const halfZ = Math.round((maxZ - minZ) / 2);
const w = Math.round(maxX - minX);
const h = Math.round(maxZ - minZ);

const symmetry = detectSymmetry(props);
    const categories = analyzeCategories(props);
    const terrain = analyzeTerrain(props, data.collisionData1, data.collisionData2);
    const spatial = analyzeSpatialLayout(props, { minX, maxX, minZ, maxZ });
    const shaders = analyzeShaders(data.materials);
    const topProps = getTopProps(props);
    const size = classifySize(halfX, halfZ);

    return {
        summary: {
            propCount: props.length,
            materialCount: Object.keys(data.materials).length,
            atlasCount: Object.keys(data.atlases).length,
            size,
            boundaryX: [Math.round(minX), Math.round(maxX)],
            boundaryZ: [Math.round(minZ), Math.round(maxZ)],
            halfX,
            halfZ,
            mapWidth: w,
            mapHeight: h,
            xzRatio: w / (h || 1),
        },
        symmetry,
        categories,
        terrain,
        spatial,
        shaders,
        topProps,
    };
}

// ---- CLI ----
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log('用法: node src/analyze-map.js <map.bin路径> [--json]');
        console.log('  --json  输出纯 JSON（不含自然语言摘要）');
        process.exit(0);
    }

    const path = args[0];
    const jsonOnly = args.includes('--json');

    let buf;
    try {
        buf = readFileSync(path);
    } catch (e) {
        console.error('无法读取文件:', e.message);
        process.exit(1);
    }

    const result = analyzeMap(buf);

    if (jsonOnly) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        const s = result.summary;
        const sym = result.symmetry;
        const cat = result.categories;
        const t = result.terrain;
        const sp = result.spatial;

        console.log('═══════════════════════════════════');
        console.log('  地图分析报告');
        console.log('═══════════════════════════════════');
        console.log();
        console.log(`道具总数:   ${s.propCount}`);
        console.log(`材质数:     ${s.materialCount}`);
        console.log(`图集数:     ${s.atlasCount}`);
        console.log(`规模:       ${s.size} (${s.halfX.toLocaleString()} × ${s.halfZ.toLocaleString()})`);
        console.log(`            ${s.mapWidth.toLocaleString()} × ${s.mapHeight.toLocaleString()} (x:z = ${s.xzRatio.toFixed(1)}:1)`);
        console.log();
        console.log('── 对称性 ──');
        console.log(`判断:       ${sym.conclusion}`);
        console.log(`x轴:        ratio=${sym.xAxis.ratio} axis=${sym.xAxis.axisAt} matched=${sym.xAxis.matchedCount}/${sym.xAxis.totalCount}`);
        console.log(`z轴:        ratio=${sym.zAxis.ratio} axis=${sym.zAxis.axisAt} matched=${sym.zAxis.matchedCount}/${sym.zAxis.totalCount}`);
        console.log();
        console.log('── 类别分布 ──');
        for (const [catName, ratio] of Object.entries(cat.ratios)) {
            const bar = '█'.repeat(Math.round(ratio / 2));
            console.log(`  ${catName.padEnd(12)} ${String(cat.counts[catName]).padStart(5)}  ${String(ratio).padStart(5)}%  ${bar}`);
        }
        console.log(`  主导类别:   ${cat.dominantCategories.join(', ')}`);
        console.log(`  已知类别:   ${cat.knownRatio}%`);
        console.log();
        console.log('── 地形 ──');
        console.log(`  y 范围:     [${t.yMin.toLocaleString()}, ${t.yMax.toLocaleString()}]  均值 ${t.yMean.toLocaleString()}  范围 ${t.yRange.toLocaleString()}`);
        console.log(`  判断:       ${t.description}`);
        console.log(`  碰撞形状:   col1=${t.collisionComplexity.col1}  col2=${t.collisionComplexity.col2}`);
        console.log();
        console.log('── 空间分布 ──');
        console.log(`  网格:       ${sp.gridSize.cols}×${sp.gridSize.rows} (每格 ${sp.gridSize.cellW.toLocaleString()}×${sp.gridSize.cellH.toLocaleString()})`);
        console.log(`  平均密度:   ${sp.avgDensity} props/格`);
        console.log(`  热点:       ${sp.hotZones.length} 个`);
        console.log(`  冷区:       ${sp.coldZones.length} 个`);
        console.log(`  通路:       ${sp.corridors.length} 条`);
        console.log(`  总览:       ${sp.gridSummary}`);
        if (sp.hotZones.length > 0) {
            console.log('  热点位置:');
            for (const hz of sp.hotZones.slice(0, 5)) console.log(`    (${hz.cx.toLocaleString()}, ${hz.cz.toLocaleString()}) 密度=${hz.density}`);
        }
        if (sp.corridors.length > 0) {
            console.log('  通路:');
            for (const cor of sp.corridors.slice(0, 3)) console.log(`    行${cor.row} x[${cor.fromX.toLocaleString()}, ${cor.toX.toLocaleString()}] z≈${cor.cz.toLocaleString()}`);
        }
        console.log();
        console.log('── 高频道具 (Top 10) ──');
        for (const { name, count } of result.topProps.slice(0, 10)) {
            const cat = semanticCategory(name);
            console.log(`  ${cat.padEnd(12)} ${name.padEnd(35)} ×${count}`);
        }
        console.log();
        console.log('── Shader 分布 ──');
        for (const [sh, cnt] of Object.entries(result.shaders)) {
            console.log(`  ${sh}: ${cnt}`);
        }
    }
}

const isMain = process.argv[1] && (process.argv[1].endsWith('analyze-map.js') || process.argv[1].includes('analyze-map'));
if (isMain) main().catch(e => { console.error(e); process.exit(1); });