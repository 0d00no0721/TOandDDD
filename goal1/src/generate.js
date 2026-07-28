#!/usr/bin/env node
// M5: CLI 集成界面
// 用法: node src/generate.js "描述" [选项]
// 全链路: 自然语言 → llm-layer.js → layout.js → serialize-map-bin.js → map.bin

import { generateParams, PROVIDER_MODELS, getOfflineParams } from './llm-layer.js';
import { generateLayout } from './layout.js';
import { serializeMapBin } from './serialize-map-bin.js';
import { parseMapBin } from './parse-map-bin.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------- 参数解析 ----------
function parseArgs(argv) {
    const args = { _: [], _flags: {} };
    const flags = new Set([
        '--provider', '--model', '--api-key', '--base-url',
        '--output', '-o', '--seed', '--no-llm', '--list-models', '--help', '-h',
    ]);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') { args._flags.help = true; continue; }
        if (a === '--list-models') { args._flags.listModels = true; continue; }
        if (a === '--no-llm') { args._flags.noLlm = true; continue; }
        if (flags.has(a)) {
            const key = a.replace(/^--?/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
            args._flags[key] = argv[++i];
        } else if (!a.startsWith('-')) {
            args._.push(a);
        }
    }
    return args;
}

const HELP = `Tanki Online 地图生成器 (目标1 M5)

用法:
  node src/generate.js "描述" [选项]

选项:
  --provider <name>    LLM 提供商: openai / anthropic / local (默认 openai)
  --model <name>       模型名称 (如 gpt-4o-mini, claude-3-5-sonnet-20241022)
  --api-key <key>      API key (也可通过环境变量 OPENAI_API_KEY / ANTHROPIC_API_KEY)
  --base-url <url>     本地模型 API 地址 (用于 --provider local, 如 http://localhost:11434/v1)
  --output <path>      输出路径 (默认 output/generated-map.bin)
  -o <path>            --output 的简写
  --seed <num>         随机种子 (默认由 LLM 决定)
  --no-llm             离线模式，不调用 LLM，用默认参数
  --list-models        列出各 provider 推荐模型
  --help, -h           显示本帮助

示例:
  # 离线模式
  node src/generate.js "两座对称山丘" --no-llm

  # OpenAI
  export OPENAI_API_KEY=sk-xxx
  node src/generate.js "工业仓库大图" --provider openai --model gpt-4o-mini

  # 本地模型 (Ollama)
  node src/generate.js "雪地小图" --provider local --model llama3 --base-url http://localhost:11434/v1`;

function listModels() {
    console.log('可用 LLM 提供商与推荐模型:\n');
    for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        console.log(`  ${provider}:`);
        for (const m of models) console.log(`    - ${m}`);
        console.log();
    }
    console.log('环境变量:');
    console.log('  OPENAI_API_KEY    OpenAI API key');
    console.log('  ANTHROPIC_API_KEY Anthropic API key');
    console.log('  LOCAL_API_KEY     本地模型 API key (可选)');
}

// ---------- 主逻辑 ----------
async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args._flags.help) {
        console.log(HELP);
        return;
    }
    if (args._flags.listModels) {
        listModels();
        return;
    }

    const description = args._.join(' ').trim();
    if (!description && !args._flags.noLlm) {
        console.error('错误: 请提供自然语言描述，或使用 --no-llm 模式');
        console.error('用法: node src/generate.js "描述" [选项]');
        console.error('帮助: node src/generate.js --help');
        process.exit(1);
    }

    // 1. LLM 理解层
    const llmOpts = {
        provider: args._flags.provider,
        model: args._flags.model,
        apiKey: args._flags.apiKey,
        baseUrl: args._flags.baseUrl,
        noLlm: args._flags.noLlm,
    };

    let result;
    try {
        console.log(args._flags.noLlm
            ? '[1/4] 离线模式，使用默认参数...'
            : `[1/4] 调用 ${llmOpts.provider || 'openai'} (${llmOpts.model || '默认模型'})...`);
        result = await generateParams(description, llmOpts);
    } catch (e) {
        console.error('错误: ' + e.message);
        process.exit(1);
    }

    // CLI --seed 覆盖 LLM 输出的 seed
    if (args._flags.seed) {
        const s = parseInt(args._flags.seed, 10);
        if (!isNaN(s)) result.params.seed = s;
    }

    console.log('  参数 JSON:');
    console.log('  ' + JSON.stringify(result.params, null, 2).replace(/\n/g, '\n  '));
    if (result.warnings?.length) {
        for (const w of result.warnings) console.log(`  ⚠ ${w}`);
    }

    // 2. 布局层
    console.log('[2/4] 生成布局...');
    const layout = generateLayout(result.params);
    console.log(`  props: ${layout.stats.propCount}, materials: ${layout.stats.materialCount}`);

    // 3. 序列化
    console.log('[3/4] 序列化 map.bin...');
    const bin = serializeMapBin(layout);
    console.log(`  文件大小: ${bin.length} bytes`);

    // 4. 写入文件
    const outPath = args._flags.output || args._flags.o || join(ROOT, 'output', 'generated-map.bin');
    const outDir = dirname(outPath);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, bin);
    console.log(`[4/4] 已写入: ${outPath}`);

    // 5. 验证
    const parsed = parseMapBin(bin);
    const ok = parsed.props.length === layout.stats.propCount
        && Object.keys(parsed.materials).length === layout.stats.materialCount;
    console.log('\n验证:');
    console.log(`  读回 props: ${parsed.props.length} (期望 ${layout.stats.propCount})`);
    console.log(`  读回 materials: ${Object.keys(parsed.materials).length} (期望 ${layout.stats.materialCount})`);
    console.log(ok ? '  ✓ 验证通过' : '  ✗ 验证失败');
    if (!ok) process.exit(1);
}

main().catch(e => {
    console.error('未捕获错误:', e.message);
    process.exit(1);
});
