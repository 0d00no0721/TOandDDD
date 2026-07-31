// M5 测试：CLI 集成界面
// 测试 --no-llm 全链路 + 参数解析（不实际调用 API）

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMapBin } from '../src/parse-map-bin.js';
import { generateParams, validateParams } from '../src/llm-layer.js';
import { generateLayout } from '../src/layout.js';
import { serializeMapBin } from '../src/serialize-map-bin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GEN = join(ROOT, 'src', 'generate.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.error(`  ✗ ${msg}`); }
}

// 运行 CLI 命令
function run(args) {
    return execFileSync('node', [GEN, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30000,
    });
}

console.log('=== M5 CLI 集成界面测试 ===\n');

// --- 测试 1：--no-llm 全链路 ---
console.log('[1] --no-llm 全链路生成 map.bin');
{
    const outPath = join(ROOT, 'output', 'test-m5.bin');
    if (existsSync(outPath)) rmSync(outPath);

    const output = run(['测试', '--no-llm', '--output', outPath]);
    assert(existsSync(outPath), 'map.bin 文件已生成');

    const buf = readFileSync(outPath);
    assert(buf.length > 0, '文件非空');

    const parsed = parseMapBin(buf);
    assert(parsed.props.length > 0, `props 非空（${parsed.props.length}）`);
    assert(Object.keys(parsed.materials).length > 0, `materials 非空（${Object.keys(parsed.materials).length}）`);
    assert(output.includes('验证通过'), '输出包含"验证通过"');
}

// --- 测试 2：--help ---
console.log('\n[2] --help 显示帮助');
{
    const output = run(['--help']);
    assert(output.includes('用法'), '--help 包含"用法"');
    assert(output.includes('--provider'), '--help 包含 --provider');
    assert(output.includes('--no-llm'), '--help 包含 --no-llm');
    assert(output.includes('--list-models'), '--help 包含 --list-models');
    assert(output.includes('--seed'), '--help 包含 --seed');
}

// --- 测试 3：--list-models ---
console.log('\n[3] --list-models 列出模型');
{
    const output = run(['--list-models']);
    assert(output.includes('openai'), '包含 openai');
    assert(output.includes('anthropic'), '包含 anthropic');
    assert(output.includes('local'), '包含 local');
    assert(output.includes('gpt-4o'), '包含 gpt-4o');
    assert(output.includes('claude'), '包含 claude');
}

// --- 测试 4：--no-llm + --seed 可复现 ---
console.log('\n[4] --no-llm + --seed 可复现');
{
    const out1 = join(ROOT, 'output', 'test-m5-seed1.bin');
    const out2 = join(ROOT, 'output', 'test-m5-seed2.bin');
    run(['测试', '--no-llm', '--seed', '123', '--output', out1]);
    run(['测试', '--no-llm', '--seed', '123', '--output', out2]);
    const buf1 = readFileSync(out1);
    const buf2 = readFileSync(out2);
    assert(buf1.length === buf2.length, '同 seed 生成相同大小文件');
    // 逐字节比较
    let same = true;
    for (let i = 0; i < buf1.length; i++) {
        if (buf1[i] !== buf2[i]) { same = false; break; }
    }
    assert(same, '同 seed 生成完全相同的 map.bin');
}

// --- 测试 5：无描述且无 --no-llm 报错 ---
console.log('\n[5] 无描述且无 --no-llm 报错');
{
    try {
        run([]);
        assert(false, '应该报错');
    } catch (e) {
        const out = e.stdout || e.stderr || '';
        assert(out.includes('请提供') || out.includes('错误'), '提示需要描述或 --no-llm');
    }
}

// --- 测试 6：全链路 API 调用模拟（不实际调 API，测试模块拼装） ---
console.log('\n[6] 模块拼装验证（离线全链路）');
{
    // 模拟 generate.js 的全链路：llm → layout → serialize
    const { params } = await generateParams('测试', { noLlm: true });
    assert(params.style === 'symmetric', 'LLM 层返回默认参数');

    const layout = generateLayout(params);
    assert(layout.props.length > 0, '布局层生成 props');

    const bin = serializeMapBin(layout);
    assert(bin.length > 0, '序列化层生成 map.bin');

    const parsed = parseMapBin(bin);
    assert(parsed.props.length === layout.stats.propCount, '读回 props 数量一致');
    assert(Object.keys(parsed.materials).length === layout.stats.materialCount, '读回 materials 数量一致');
}

// --- 测试 7：--output 路径自动创建目录 ---
console.log('\n[7] --output 自动创建目录');
{
    const deepPath = join(ROOT, 'output', 'sub', 'deep', 'test.bin');
    if (existsSync(deepPath)) rmSync(deepPath);
    run(['测试', '--no-llm', '--output', deepPath]);
    assert(existsSync(deepPath), '深层目录自动创建且文件生成');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
