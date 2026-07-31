// 训练报告生成器
// 读取 train-loop 产出的 progress-*.json，输出汇总分析
// 用法: node tools/report-training.js <结果目录>

import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

function loadProgress(dir) {
    const files = ['Forest_Summer_Day', 'Sandbox_Summer_Day', 'Highland_Summer_Day'];
    const results = {};
    for (const f of files) {
        const path = join(dir, `progress-${f}.json`);
        if (existsSync(path)) {
            const p = JSON.parse(readFileSync(path, 'utf8'));
            results[f] = p;
        }
    }
    return results;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function slope(arr) {
    if (arr.length < 2) return 0;
    const n = arr.length;
    const xMean = (n - 1) / 2;
    const yMean = mean(arr);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - xMean) * (arr[i] - yMean);
        den += (i - xMean) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

const MAP_PROFILES = {
    Forest_Summer_Day: { size: 'small', desc: '自然主导 89%', gameplayCount: 417 },
    Sandbox_Summer_Day: { size: 'medium', desc: '自然 75% + 结构 13%', gameplayCount: 430 },
    Highland_Summer_Day: { size: 'large', desc: '自然 70% + 结构 14%', gameplayCount: 510 },
};

function bar(v, max, width = 20) {
    return '█'.repeat(Math.max(0, Math.round(v / max * width)));
}

function analyzeMap(name, progress) {
    const rounds = progress.rounds;
    if (!rounds || rounds.length === 0) return null;

    const scores = rounds.map(r => r.scores.overall);
    const first10 = scores.slice(0, Math.min(10, scores.length));
    const last10 = scores.slice(-Math.min(10, scores.length));
    const avgFirst = mean(first10);
    const avgLast = mean(last10);
    const slp = slope(scores) * scores.length;
    const best = Math.max(...scores);
    const bestRound = scores.indexOf(best) + 1;
    const finalScore = scores[scores.length - 1];

    const profile = MAP_PROFILES[name] || {};

    // 各维度趋势
    const dims = ['scale', 'category', 'density', 'gpRatio'];
    const dimTrends = {};
    for (const d of dims) {
        const vals = rounds.map(r => r.scores[d] || 0);
        const f10 = mean(vals.slice(0, Math.min(10, vals.length)));
        const l10 = mean(vals.slice(-Math.min(10, vals.length)));
        dimTrends[d] = { first: f10, last: l10, diff: l10 - f10 };
    }

    // 判断收敛性
    let convergence;
    if (Math.abs(avgLast - avgFirst) < 0.02 && slp < 0.5) convergence = '已收敛';
    else if (slp > 1) convergence = '持续提升';
    else if (slp < -1) convergence = '已衰减';
    else convergence = '缓慢波动';

    const gpCounts = rounds.map(r => r.gpPropCount || 0);

    return {
        name, profile, rounds: rounds.length,
        first10Avg: avgFirst, last10Avg: avgLast, slope: slp,
        best, bestRound, finalScore, convergence,
        dimTrends, gpCounts,
        scores,
    };
}

function report(dir) {
    const data = loadProgress(dir);
    const names = Object.keys(data);
    if (names.length === 0) {
        console.log('未找到 progress-*.json 文件');
        return;
    }

    const results = [];
    for (const name of names) {
        const r = analyzeMap(name, data[name]);
        if (r) results.push(r);
    }

    const maxScore = Math.max(...results.map(r => r.best), 0.001);

    console.log('══════════════════════════════════════════════════');
    console.log('  训练报告');
    console.log('══════════════════════════════════════════════════');
    console.log();

    // ── 逐地图分析 ──
    for (const r of results) {
        const p = r.profile;
        console.log(`── ${r.name} (${p.size}, ${p.desc}) ──`);
        console.log();

        // 分数曲线（ASCII）
        console.log('  分数曲线:');
        const steps = 10;
        const chunk = Math.max(1, Math.floor(r.scores.length / steps));
        for (let i = 0; i < r.scores.length; i += chunk) {
            const avg = mean(r.scores.slice(i, Math.min(i + chunk, r.scores.length)));
            console.log(`  R${String(i + 1).padStart(3, ' ')} ${bar(avg, maxScore)} ${avg.toFixed(3)}`);
        }
        console.log();

        // 关键指标
        const tr = r.dimTrends;
        console.log(`  最佳:    ${r.best.toFixed(3)} (R${r.bestRound})    最终: ${r.finalScore.toFixed(3)}    状态: ${r.convergence}`);
        console.log(`  前10均:  ${r.first10Avg.toFixed(3)}  后10均: ${r.last10Avg.toFixed(3)}  变化: ${(r.last10Avg - r.first10Avg >= 0 ? '+' : '')}${(r.last10Avg - r.first10Avg).toFixed(3)}`);
        console.log();

        // 维度趋势
        console.log('  维度趋势 (前10→后10):');
        for (const [d, t] of Object.entries(tr)) {
            const arrow = t.diff > 0.03 ? '▲' : t.diff < -0.03 ? '▼' : '─';
            console.log(`  ${d.padEnd(12)} ${t.first.toFixed(2)} → ${t.last.toFixed(2)}  ${arrow} ${(t.diff >= 0 ? '+' : '')}${t.diff.toFixed(2)}`);
        }
        console.log();

        // GP 道具数量
        console.log(`  gameplay 道具: ${r.gpCounts[0]} → ${r.gpCounts[r.gpCounts.length - 1]}`);

        // 建议
        if (r.convergence === '已衰减' || r.last10Avg < r.first10Avg) {
            console.log('  ⚠ 分数下降，建议停止该地图训练');
        }
        if (r.finalScore < 0.5) {
            console.log('  ⚠ 分数过低，检查 SIZE_BOUNDS 或 propSelection 参数');
        }
        if (r.convergence === '已收敛' && r.last10Avg > 0.65) {
            console.log('  ✓ 训练收敛良好');
        }
        console.log();
    }

    // ── 全局汇总 ──
    console.log('══════════════════════════════════════════════════');
    console.log();

    // 排名表
    const sorted = [...results].sort((a, b) => b.best - a.best);
    console.log('  排名:');
    for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        console.log(`  ${i + 1}. ${s.name.padEnd(25)} best=${s.best.toFixed(3)}  final=${s.finalScore.toFixed(3)}  ${s.convergence}`);
    }
    console.log();

    // 整体收敛性
    const improvedCount = results.filter(r => r.last10Avg > r.first10Avg + 0.02).length;
    const stableCount = results.filter(r => Math.abs(r.last10Avg - r.first10Avg) <= 0.02).length;
    const degradedCount = results.filter(r => r.last10Avg < r.first10Avg - 0.02).length;
    console.log(`  收敛统计: 提升 ${improvedCount}  稳定 ${stableCount}  衰减 ${degradedCount}`);

    const avgBest = mean(results.map(r => r.best));
    const avgFinal = mean(results.map(r => r.finalScore));
    console.log(`  平均 best: ${avgBest.toFixed(3)}  平均 final: ${avgFinal.toFixed(3)}`);
    console.log();

    // 全局建议
    console.log('── 全局建议 ──');
    const lowDensity = results.filter(r => r.dimTrends.density.last < 0.5);
    if (lowDensity.length) {
        console.log(`  • density 偏低的地图: ${lowDensity.map(r => r.name).join(', ')}。考虑放宽 unique pool 限制或允许 prop 重复放置`);
    }
    const lowScale = results.filter(r => r.dimTrends.scale.last < 0.7);
    if (lowScale.length) {
        console.log(`  • scale 偏低的地图: ${lowScale.map(r => r.name).join(', ')}。检查 SIZE_BOUNDS 匹配度`);
    }
    const improving = results.filter(r => r.convergence === '持续提升');
    if (improving.length) {
        console.log(`  • 仍在提升的地图: ${improving.map(r => r.name).join(', ')}。可继续增加轮次`);
    }

    const overallConverged = results.every(r => r.convergence === '已收敛');
    if (overallConverged) {
        console.log('  ✓ 全部地图已收敛，训练可停止');
    }
    if (degradedCount > 0 && improvedCount === 0) {
        console.log('  ⚠ 所有地图均已衰减或无提升，建议停止训练并调整评价权重');
    }
}

// ── CLI ──
const dir = process.argv[2];
if (!dir || process.argv.includes('--help')) {
    console.log('用法: node tools/report-training.js <结果目录>');
    console.log('示例: node tools/report-training.js E:\\DDD\\test\\batch100');
    process.exit(0);
}

if (!existsSync(dir)) {
    console.error('目录不存在:', dir);
    process.exit(1);
}

report(dir);