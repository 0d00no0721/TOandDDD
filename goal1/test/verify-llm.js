// M4 测试：LLM 理解层
// 测试 JSON 解析容错、参数校验、离线模式（不实际调用 API）

import { parseLLMJson, validateParams, getOfflineParams, generateParams, PROVIDER_MODELS, DEFAULT_PARAMS } from '../src/llm-layer.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log(`  ✓ ${msg}`); }
    else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('=== M4 LLM 理解层测试 ===\n');

// --- 测试 1：JSON 解析容错 ---
console.log('[1] JSON 解析容错');
{
    // 纯 JSON
    const r1 = parseLLMJson('{"style":"symmetric","size":"small"}');
    assert(r1 && r1.style === 'symmetric', '纯 JSON 正确解析');

    // ```json 包裹
    const r2 = parseLLMJson('```json\n{"style":"asymmetric","size":"large"}\n```');
    assert(r2 && r2.style === 'asymmetric', '```json 包裹正确剥离');

    // ``` 无语言标记包裹
    const r3 = parseLLMJson('```\n{"seed":42}\n```');
    assert(r3 && r3.seed === 42, '``` 无标记包裹正确剥离');

    // 前后有解释文字
    const r4 = parseLLMJson('好的，这是参数：\n{"style":"symmetric","size":"medium"}\n希望你喜欢。');
    assert(r4 && r4.size === 'medium', '前后有文字时提取 JSON');

    // 空输入
    assert(parseLLMJson('') === null, '空输入返回 null');
    assert(parseLLMJson(null) === null, 'null 输入返回 null');
    assert(parseLLMJson('not json at all') === null, '非 JSON 返回 null');
}

// --- 测试 2：参数校验 - 缺失字段补默认值 ---
console.log('\n[2] 参数校验 - 缺失字段补默认值');
{
    const { params, warnings } = validateParams({});
    assert(params.style === 'symmetric', 'style 缺失补为 symmetric');
    assert(params.size === 'small', 'size 缺失补为 small');
    assert(params.propDensity === 'medium', 'propDensity 缺失补为 medium');
    assert(params.symmetry.axis === 'x', 'symmetry 缺失补为 mirror/x');
    assert(params.propSelection.length === 3, 'propSelection 缺失补为默认 3 项');
    assert(params.seed === 42, 'seed 缺失补为 42');
    assert(warnings.length > 0, '有 warning 提示');
}

// --- 测试 3：参数校验 - 非法值修正 ---
console.log('\n[3] 参数校验 - 非法值修正');
{
    const { params, warnings } = validateParams({
        style: 'invalid', size: 'huge', propDensity: 'extreme',
        symmetry: { type: 'mirror', axis: 'y' },
        propSelection: [{ category: 'magic', count: -5, placement: 'random' }],
        seed: 'abc',
    });
    assert(params.style === 'symmetric', '非法 style 修正为 symmetric');
    assert(params.size === 'small', '非法 size 修正为 small');
    assert(params.propDensity === 'medium', '非法 propDensity 修正为 medium');
    assert(params.symmetry.axis === 'x', '非法 axis 修正为 x');
    assert(params.propSelection[0].category === 'structure', '非法 category 修正为 structure');
    assert(params.propSelection[0].count === 10, '非法 count 修正为 10');
    assert(params.propSelection[0].placement === 'scattered', '非法 placement 修正为 scattered');
    assert(params.seed === 42, '非法 seed 修正为 42');
}

// --- 测试 4：参数校验 - 合法输入无 warning ---
console.log('\n[4] 参数校验 - 合法输入');
{
    const good = {
        style: 'asymmetric', size: 'large', propDensity: 'high',
        propSelection: [{ category: 'natural', count: 30, placement: 'grid' }],
        seed: 99,
    };
    const { params, warnings } = validateParams(good);
    assert(params.style === 'asymmetric', 'style 保留');
    assert(params.size === 'large', 'size 保留');
    assert(params.symmetry === null, 'asymmetric 时 symmetry 设为 null');
    assert(params.propSelection[0].category === 'natural', 'category 保留');
    assert(warnings.length === 0, '无 warning');
}

// --- 测试 5：离线模式 ---
console.log('\n[5] 离线模式');
{
    const { params, warnings } = getOfflineParams();
    assert(params.style === DEFAULT_PARAMS.style, '离线模式返回默认 style');
    assert(params.size === DEFAULT_PARAMS.size, '离线模式返回默认 size');
    assert(params.propSelection.length === DEFAULT_PARAMS.propSelection.length, '离线模式返回默认 propSelection');
    assert(warnings[0].includes('离线'), '离线模式有提示');
}

// --- 测试 6：generateParams 离线模式 ---
console.log('\n[6] generateParams --no-llm');
{
    const result = await generateParams('测试描述', { noLlm: true });
    assert(result.params.style === 'symmetric', 'generateParams 离线返回默认参数');
    assert(result.params.seed === 42, '离线 seed 为 42');
}

// --- 测试 7：generateParams 缺少 API key 报错 ---
console.log('\n[7] 缺少 API key 报错');
{
    // 清除环境变量确保没有 key
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
        await generateParams('测试', { provider: 'openai', apiKey: null });
        assert(false, '应该抛出错误');
    } catch (e) {
        assert(e.message.includes('API key'), '缺少 key 时报错: ' + e.message.slice(0, 40));
    }
    if (savedKey) process.env.OPENAI_API_KEY = savedKey;
}

// --- 测试 8：PROVIDER_MODELS 完整性 ---
console.log('\n[8] PROVIDER_MODELS 完整性');
{
    assert(PROVIDER_MODELS.openai.length >= 3, 'openai 至少 3 个模型');
    assert(PROVIDER_MODELS.anthropic.length >= 2, 'anthropic 至少 2 个模型');
    assert(PROVIDER_MODELS.local.length >= 2, 'local 至少 2 个模型');
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
