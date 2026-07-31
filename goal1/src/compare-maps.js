// 双图差异量化引擎
// 默认只评估 gameplay 相关道具 (structure/terrain/vehicle)，忽略纯视觉道具
// 用法:
//   node src/compare-maps.js <参考.bin> <生成.bin>
//   node src/compare-maps.js <参考.bin> <生成.bin> --json
//   node src/compare-maps.js <参考.bin> <生成.bin> --all    # 旧行为：统计全部道具

import { readFileSync } from 'node:fs';
import { analyzeMap, semanticCategory } from './analyze-map.js';

const GAMEPLAY_CATEGORIES = new Set(['structure', 'terrain', 'vehicle']);

function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        const va = a[k] || 0, vb = b[k] || 0;
        dot += va * vb;
        normA += va * va;
        normB += vb * vb;
    }
    return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function filterGameplay(analysis) {
    const counts = analysis.categories.counts || {};
    let totalGP = 0;
    const gpCounts = {};
    for (const cat of GAMEPLAY_CATEGORIES) {
        const c = counts[cat] || 0;
        gpCounts[cat] = c;
        totalGP += c;
    }
    const ratios = {};
    for (const cat of GAMEPLAY_CATEGORIES) {
        ratios[cat] = totalGP > 0 ? parseFloat((gpCounts[cat] / totalGP * 100).toFixed(1)) : 0;
    }
    return { total: totalGP, counts: gpCounts, ratios, dominant: Object.entries(gpCounts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([n]) => n) };
}

export function compareMaps(bufRef, bufGen, options = {}) {
    const { gameplayOnly = true } = options;
    const ref = analyzeMap(bufRef);
    const gen = analyzeMap(bufGen);

    if (ref.summary.isEmpty || gen.summary.isEmpty) {
        return { overall: 0, error: '参考或生成地图为空' };
    }

    const sRef = ref.summary;
    const sGen = gen.summary;
    const gpRef = filterGameplay(ref);
    const gpGen = filterGameplay(gen);
    const totalRef = gameplayOnly ? gpRef.total : sRef.propCount;
    const totalGen = gameplayOnly ? gpGen.total : sGen.propCount;

    // ── 1. 规模匹配 ──
    const maxHalfX = Math.max(sRef.halfX, sGen.halfX, 1);
    const maxHalfZ = Math.max(sRef.halfZ, sGen.halfZ, 1);
    const scaleMatchX = 1 - Math.abs(sRef.halfX - sGen.halfX) / maxHalfX;
    const scaleMatchZ = 1 - Math.abs(sRef.halfZ - sGen.halfZ) / maxHalfZ;
    const scaleMatch = parseFloat(((scaleMatchX + scaleMatchZ) / 2).toFixed(3));

    // ── 2. 规模分类匹配 ──
    const sizeOrder = { small: 0, medium: 1, large: 2 };
    const sizeDist = Math.abs((sizeOrder[sRef.size] || 0) - (sizeOrder[sGen.size] || 0));
    const sizeClassMatch = sizeDist === 0 ? 1 : sizeDist === 1 ? 0.5 : 0;

    // ── 3. 对称性匹配 ──
    const symSame = ref.symmetry.conclusion === gen.symmetry.conclusion ? 1 :
        (ref.symmetry.xAxis.isSymmetric === gen.symmetry.xAxis.isSymmetric) ? 0.5 : 0;
    const xRatioMatch = 1 - Math.abs(ref.symmetry.xAxis.ratio - gen.symmetry.xAxis.ratio);
    const symmetryMatch = parseFloat((symSame * 0.5 + xRatioMatch * 0.5).toFixed(3));

    // ── 4. 类别分布匹配 ──
    const catRef = gameplayOnly ? gpRef.ratios : ref.categories.ratios;
    const catGen = gameplayOnly ? gpGen.ratios : gen.categories.ratios;
    const categoryMatch = parseFloat(cosineSimilarity(catRef, catGen).toFixed(3));

    // ── 5. 密度匹配 ──
    const areaRef = (sRef.mapWidth * sRef.mapHeight) || 1;
    const areaGen = (sGen.mapWidth * sGen.mapHeight) || 1;
    const densityRef = totalRef / areaRef;
    const densityGen = totalGen / areaGen;
    const maxDensity = Math.max(densityRef, densityGen, 1e-12);
    const densityMatch = parseFloat((1 - Math.abs(densityRef - densityGen) / maxDensity).toFixed(3));

    // ── 6. gameplay 占比匹配（仅在 gameplayOnly 模式） ──
    const gpRatioRef = gameplayOnly ? gpRef.total / (sRef.propCount || 1) : 1;
    const gpRatioGen = gameplayOnly ? gpGen.total / (sGen.propCount || 1) : 1;
    const maxGpRatio = Math.max(gpRatioRef, gpRatioGen, 1e-12);
    const gpRatioMatch = parseFloat((1 - Math.abs(gpRatioRef - gpRatioGen) / maxGpRatio).toFixed(3));

    // ── 7. 空间分布匹配 ──
    const spRef = ref.spatial;
    const spGen = gen.spatial;
    const zoneRatio = spRef.hotZones.length && spGen.hotZones.length
        ? 1 - Math.abs(spRef.hotZones.length - spGen.hotZones.length) / Math.max(spRef.hotZones.length, spGen.hotZones.length, 1)
        : 0;
    const avgMatch = spRef.avgDensity && spGen.avgDensity
        ? 1 - Math.abs(spRef.avgDensity - spGen.avgDensity) / Math.max(spRef.avgDensity, spGen.avgDensity, 1)
        : 0;
    const spatialMatch = parseFloat(((zoneRatio + avgMatch) / 2).toFixed(3));

    // ── 加权总分 ──
    let overall;
    if (gameplayOnly) {
        overall = parseFloat((
            scaleMatch * 0.15 +
            sizeClassMatch * 0.15 +
            symmetryMatch * 0.02 +
            categoryMatch * 0.25 +
            densityMatch * 0.28 +
            gpRatioMatch * 0.05 +
            spatialMatch * 0.10
        ).toFixed(3));
    } else {
        overall = parseFloat((
            scaleMatch * 0.20 + sizeClassMatch * 0.15 + symmetryMatch * 0.15 +
            categoryMatch * 0.25 + densityMatch * 0.20 + spatialMatch * 0.05
        ).toFixed(3));
    }

    // ── 生成改进建议 ──
    const suggestions = [];
    if (sizeDist > 0) suggestions.push(`规模不匹配：参考 ${sRef.size}，生成 ${sGen.size}。调整 size。`);
    if (sRef.halfX > 0 && sGen.halfX > 0 && Math.abs(sRef.halfX - sGen.halfX) / sRef.halfX > 0.3) {
        suggestions.push(`x 尺寸偏差：参考 ${sRef.halfX.toLocaleString()}，生成 ${sGen.halfX.toLocaleString()}。`);
    }
    if (gameplayOnly && gpRatioMatch < 0.5) {
        suggestions.push(`gameplay 道具占比偏差：参考 ${Math.round(gpRatioRef * 100)}%，生成 ${Math.round(gpRatioGen * 100)}%。${gpRatioGen < gpRatioRef ? '增加 structure/terrain/vehicle 数量。' : '减少 gameplay 道具。'}`);
    }
    if (densityMatch < 0.3) suggestions.push(`道具密度严重偏差。参考 ${totalRef} props/area，生成 ${totalGen}。调整 propSelection count。`);
    if (categoryMatch < 0.5) {
        const catDiffs = [];
        for (const cat of GAMEPLAY_CATEGORIES) {
            const rc = catRef[cat] || 0, gc = catGen[cat] || 0;
            if (Math.abs(rc - gc) > 15) catDiffs.push(`${cat}: 参考${rc}% vs 生成${gc}%`);
        }
        if (catDiffs.length) suggestions.push(`类别分布偏差：${catDiffs.join('; ')}。`);
    }

    const scores = gameplayOnly
        ? { scale: scaleMatch, sizeClass: sizeClassMatch, symmetry: symmetryMatch, category: categoryMatch, density: densityMatch, gpRatio: gpRatioMatch, spatial: spatialMatch }
        : { scale: scaleMatch, sizeClass: sizeClassMatch, symmetry: symmetryMatch, category: categoryMatch, density: densityMatch, spatial: spatialMatch };

    return {
        overall,
        mode: gameplayOnly ? 'gameplay' : 'all',
        scores,
        reference: { size: sRef.size, halfX: sRef.halfX, halfZ: sRef.halfZ, totalProps: sRef.propCount, gpProps: gpRef.total, gpRatio: Math.round(gpRatioRef * 100), symmetry: ref.symmetry.conclusion, topCategories: gameplayOnly ? gpRef.dominant.slice(0, 3) : ref.categories.dominantCategories.slice(0, 3) },
        generated: { size: sGen.size, halfX: sGen.halfX, halfZ: sGen.halfZ, totalProps: sGen.propCount, gpProps: gpGen.total, gpRatio: Math.round(gpRatioGen * 100), symmetry: gen.symmetry.conclusion, topCategories: gameplayOnly ? gpGen.dominant.slice(0, 3) : gen.categories.dominantCategories.slice(0, 3) },
        suggestions,
    };
}

// ── CLI ──
function parseArgs(argv) {
    const args = { _: [], json: false, all: false };
    for (const a of argv) {
        if (a === '--json') args.json = true;
        else if (a === '--all') args.all = true;
        else if (!a.startsWith('-')) args._.push(a);
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args._.length < 2) {
        console.log('用法: node src/compare-maps.js <参考.bin> <生成.bin> [--json] [--all]');
        console.log('  默认只评估 gameplay 道具（structure/terrain/vehicle），--all 统计全部');
        process.exit(0);
    }

    const [refPath, genPath] = args._;
    let bufRef, bufGen;
    try { bufRef = readFileSync(refPath); } catch (e) { console.error('无法读取参考:', e.message); process.exit(1); }
    try { bufGen = readFileSync(genPath); } catch (e) { console.error('无法读取生成:', e.message); process.exit(1); }

    const result = compareMaps(bufRef, bufGen, { gameplayOnly: !args.all });

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        const s = result.scores;
        const r = result.reference, g = result.generated;
        const bar = (v) => '█'.repeat(Math.round(v * 20));
        const modeTag = result.mode === 'gameplay' ? ' [gameplay]' : ' [全部]';

        console.log(`═══════════════════════════════════${modeTag}`);
        console.log('  地图比对报告');
        console.log('═══════════════════════════════════════');
        console.log();
        console.log(`整体相似度:  ${result.overall.toFixed(2)} / 1.00  ${bar(result.overall)}`);
        console.log();
        console.log(`  规模匹配:    ${s.scale.toFixed(2)}  参考 ${r.halfX.toLocaleString()}×${r.halfZ.toLocaleString()}  →  生成 ${g.halfX.toLocaleString()}×${g.halfZ.toLocaleString()}`);
        console.log(`  分类匹配:    ${s.sizeClass.toFixed(2)}  参考 ${r.size}  →  生成 ${g.size}`);
        console.log(`  对称性匹配:  ${s.symmetry.toFixed(2)}  参考 ${r.symmetry}  →  生成 ${g.symmetry}`);
        console.log(`  类别匹配:    ${s.category.toFixed(2)}  参考 主导: ${r.topCategories.join(', ')}  →  生成 主导: ${g.topCategories.join(', ')}`);
        console.log(`  密度匹配:    ${s.density.toFixed(2)}  参考 ${r.gpProps !== undefined ? r.gpProps + ' gameplay' : r.totalProps} props  →  生成 ${g.gpProps !== undefined ? g.gpProps + ' gameplay' : g.totalProps} props`);
        if (result.mode === 'gameplay') console.log(`  GP占比匹配:  ${s.gpRatio.toFixed(2)}  参考 ${r.gpRatio}%  →  生成 ${g.gpRatio}%`);
        console.log(`  空间匹配:    ${s.spatial.toFixed(2)}`);
        console.log();

        if (result.suggestions.length > 0) {
            console.log('改进建议:');
            for (const sug of result.suggestions) console.log(`  • ${sug}`);
        } else {
            console.log('✓ 各维度匹配良好');
        }
        console.log();
    }
}

const isMain = process.argv[1] && (process.argv[1].endsWith('compare-maps.js') || process.argv[1].includes('compare-maps'));
if (isMain) main().catch(e => { console.error(e); process.exit(1); });