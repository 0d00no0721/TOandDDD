// 自动化训练循环
// 输入: 参考地图 + 轮次数 → 自动调参 → 生成 → 比对 → 记录 → 重复
// 用法: node tools/train-loop.js <参考.bin> <轮次数> [--out <输出目录>]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMap, semanticCategory } from '../src/analyze-map.js';
import { generateLayout } from '../src/layout.js';
import { serializeMapBin } from '../src/serialize-map-bin.js';
import { compareMaps } from '../src/compare-maps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

function makeInitialParams(refAnalysis) {
    const s = refAnalysis.summary;
    const sym = refAnalysis.symmetry;
    const cat = refAnalysis.categories;

    const style = sym.conclusion !== '不对称' ? 'symmetric' : 'asymmetric';
    const symmetry = style === 'symmetric' ? { type: 'mirror', axis: sym.xAxis.ratio > sym.zAxis.ratio ? 'x' : 'z' } : null;

    const sel = [{ category: 'natural', count: 80, placement: 'scattered' }];

    const sCount = cat.counts.structure || 20;
    const tCount = cat.counts.terrain || 10;
    const vCount = cat.counts.vehicle || 5;

    sel.push({ category: 'structure', count: clamp(sCount * 0.15, 10, 300), placement: 'scattered' });
    sel.push({ category: 'terrain', count: clamp(tCount * 0.2, 5, 200), placement: 'scattered' });
    if (vCount > 0) sel.push({ category: 'vehicle', count: clamp(vCount * 0.3, 3, 50), placement: 'scattered' });

    return { style, size: s.size, symmetry, propSelection: sel, seed: 1 };
}

function adjustParams(params, scores, refAnalysis, round) {
    const p = JSON.parse(JSON.stringify(params));
    p.seed = round;

    const gpCats = ['structure', 'terrain', 'vehicle'];
    const selMap = {};
    for (const s of p.propSelection) selMap[s.category] = s;

    // density 低 → 全面增加 gameplay count
    if (scores.density < 0.3) {
        const mul = 1 + (1 - scores.density) * 1.2;
        for (const cat of gpCats) {
            if (selMap[cat]) selMap[cat].count = clamp(selMap[cat].count * mul, selMap[cat].count, 500);
        }
    } else if (scores.density < 0.6) {
        const mul = 1 + (1 - scores.density) * 0.6;
        for (const cat of gpCats) {
            if (selMap[cat]) selMap[cat].count = clamp(selMap[cat].count * mul, selMap[cat].count, 500);
        }
    }

    // 所有 gp count 已达 500 上限但 density 仍低 → 增加 natural 填充
    const allAtCap = gpCats.every(c => selMap[c] && selMap[c].count >= 500);
    if (allAtCap && scores.density < 0.5) {
        if (selMap.natural) {
            selMap.natural.count = clamp(selMap.natural.count * 1.3, selMap.natural.count, 500);
        } else {
            p.propSelection.push({ category: 'natural', count: 200, placement: 'scattered' });
        }
    }

    // gpRatio 低 → 增加 gameplay 占比
    if (scores.gpRatio !== undefined && scores.gpRatio < 0.4) {
        for (const cat of gpCats) {
            if (selMap[cat]) selMap[cat].count = clamp(selMap[cat].count * 1.3, selMap[cat].count, 500);
        }
    }

    // category 低 → 按 category 调个别
    if (scores.category < 0.5) {
        const refCat = refAnalysis.categories;
        const refTotalGp = (refCat.counts.structure || 0) + (refCat.counts.terrain || 0) + (refCat.counts.vehicle || 0);
        const genTotalGp = (selMap.structure?.count || 0) + (selMap.terrain?.count || 0) + (selMap.vehicle?.count || 0);
        for (const cat of gpCats) {
            const refRatio = refTotalGp > 0 ? (refCat.counts[cat] || 0) / refTotalGp : 0;
            const genRatio = genTotalGp > 0 ? (selMap[cat]?.count || 0) / genTotalGp : 0;
            if (refRatio > genRatio * 1.5 && selMap[cat]) {
                selMap[cat].count = clamp(selMap[cat].count * 1.4, selMap[cat].count, 500);
            }
        }
    }

    // scale 低 → 调 size
    if (scores.scale < 0.5 && scores.sizeClass < 1) {
        const sizes = ['small', 'medium', 'large'];
        const idx = sizes.indexOf(p.size);
        const refIdx = sizes.indexOf(refAnalysis.summary.size);
        if (idx < refIdx) p.size = sizes[idx + 1];
        else if (idx > refIdx) p.size = sizes[idx - 1];
    }

    // 每 5 轮随机扰动
    if (round % 3 === 0) {
        for (const cat of gpCats) {
            if (selMap[cat]) selMap[cat].count = clamp(selMap[cat].count + Math.round((Math.random() - 0.5) * 15), 3, 500);
        }
    }

    return p;
}

async function runTraining(refPath, totalRounds, outDir) {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const refBuf = readFileSync(refPath);
    const refAnalysis = analyzeMap(refBuf);
    const refName = refPath.replace(/^.*[\\/]/, '').replace(/\.bin$/, '');

    console.log(`=== 训练开始: ${refName} × ${totalRounds} 轮 ===`);
    console.log(`参考: ${refAnalysis.summary.size}, ${refAnalysis.summary.propCount} props, 对称性=${refAnalysis.symmetry.conclusion}`);
    console.log();

    let params = makeInitialParams(refAnalysis);
    const progress = { reference: refName, totalRounds, rounds: [], bestOverall: 0, bestRound: 0 };

    for (let round = 1; round <= totalRounds; round++) {
        process.stdout.write(`Round ${String(round).padStart(3, ' ')}  `);

        // 生成
        params.seed = round;
        const layout = generateLayout(params);
        const bin = serializeMapBin(layout);
        const genPath = join(outDir, `round-${round}-generated.bin`);
        writeFileSync(genPath, bin);

        // 比对
        const cmp = compareMaps(refBuf, bin, { gameplayOnly: true });

        // 保存
        const roundData = {
            round, params: JSON.parse(JSON.stringify(params)),
            scores: { ...cmp.scores, overall: cmp.overall },
            propCount: layout.stats.propCount,
            gpPropCount: cmp.generated.gpProps,
        };
        progress.rounds.push(roundData);

        // 输出
        const gpStr = `gp=${cmp.generated.gpProps}`.padEnd(8);
        const scoresLine = `o=${cmp.overall.toFixed(3)}  sc=${cmp.scores.scale.toFixed(2)}  sz=${cmp.scores.sizeClass.toFixed(2)}  sy=${cmp.scores.symmetry.toFixed(2)}  ca=${cmp.scores.category.toFixed(2)}  de=${cmp.scores.density.toFixed(2)}  gp=${cmp.scores.gpRatio?.toFixed(2) || '-'}`;
        const trend = cmp.overall > progress.bestOverall ? ' ▲' : '  ';
        console.log(`${gpStr} ${scoresLine}${trend}`);

        if (cmp.overall > progress.bestOverall) {
            progress.bestOverall = cmp.overall;
            progress.bestRound = round;
        }

        // 调整参数
        params = adjustParams(params, cmp.scores, refAnalysis, round);
    }

    // 保存进度
    writeFileSync(join(outDir, `progress-${refName}.json`), JSON.stringify(progress, null, 2));
    writeFileSync(join(outDir, `${refName}-final-params.json`), JSON.stringify(params, null, 2));

    console.log();
    console.log(`=== ${refName} 完成 ===`);
    console.log(`最佳: Round ${progress.bestRound} (${progress.bestOverall.toFixed(3)})`);
    console.log(`最终评分: ${progress.rounds[progress.rounds.length - 1].scores.overall.toFixed(3)}`);
    console.log(`最终参数: ${outDir}/${refName}-final-params.json`);

    return progress;
}

async function batchRun(refPaths, roundsPerMap, outDir) {
    const all = [];
    for (const refPath of refPaths) {
        const progress = await runTraining(refPath, roundsPerMap, outDir);
        all.push(progress);
    }

    // 全局汇总
    const summary = {
        completedAt: new Date().toISOString(),
        maps: all.map(p => ({
            reference: p.reference,
            rounds: p.totalRounds,
            bestOverall: p.bestOverall,
            bestRound: p.bestRound,
            finalOverall: p.rounds[p.rounds.length - 1].scores.overall,
            scores: p.rounds[p.rounds.length - 1].scores,
        })),
    };
    writeFileSync(join(outDir, 'progress-summary.json'), JSON.stringify(summary, null, 2));

    console.log('\n═══ 全局汇总 ═══');
    for (const m of summary.maps) {
        console.log(`${m.reference}: 最佳 ${m.bestOverall.toFixed(3)} (R${m.bestRound})  最终 ${m.finalOverall.toFixed(3)}`);
    }
}

// ── CLI ──
const argv = process.argv.slice(2);
if (argv.length < 2 || argv.includes('--help')) {
    console.log('用法: node tools/train-loop.js <参考.bin> <轮次数> [--out <目录>]');
    console.log('       node tools/train-loop.js --batch <参考1.bin>,<参考2.bin> <每图轮次数> [--out <目录>]');
    console.log();
    console.log('默认输出: E:\\DDD\\test');
    process.exit(0);
}

let outDir = join(ROOT, '..', 'test');
let refPath, totalRounds, isBatch = false, batchPaths;

for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
        outDir = argv[++i] || outDir;
    } else if (a === '--batch') {
        isBatch = true;
        batchPaths = argv[++i] ? argv[i].split(',') : [];
    } else if (!refPath && !isBatch) {
        refPath = a;
    } else if (totalRounds === undefined) {
        totalRounds = parseInt(a, 10);
    }
}

if (isBatch) {
    batchRun(batchPaths, totalRounds || 33, outDir);
} else if (refPath && totalRounds) {
    runTraining(refPath, totalRounds, outDir);
} else {
    console.error('参数错误。用法: node tools/train-loop.js <参考.bin> <轮次数>');
    process.exit(1);
}