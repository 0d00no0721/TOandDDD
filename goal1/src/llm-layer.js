// M4: LLM 理解层
// 将自然语言描述翻译为高层参数 JSON，供 layout.js 使用
// 支持多提供商（OpenAI / Anthropic / 本地 OpenAI 兼容 API），零依赖

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------- 推荐模型 ----------
export const PROVIDER_MODELS = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    local: ['llama3', 'qwen2.5', 'mistral', 'phi3'],
};

// ---------- 默认参数（离线模式 / 字段补全用） ----------
export const DEFAULT_PARAMS = {
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
};

// ---------- 合法值集合 ----------
const VALID = {
    style: ['symmetric', 'asymmetric'],
    size: ['small', 'medium', 'large'],
    propDensity: ['low', 'medium', 'high'],
    category: ['natural', 'structure', 'decoration', 'terrain', 'vehicle', 'other'],
    placement: ['scattered', 'perimeter', 'clustered', 'grid'],
    axis: ['x', 'z'],
};

// ---------- 加载 prompt 上下文 ----------
let _catalogCache = null;
function loadCatalog() {
    if (_catalogCache) return _catalogCache;
    _catalogCache = JSON.parse(readFileSync(join(ROOT, 'data', 'library_catalog.json'), 'utf8'));
    return _catalogCache;
}

let _refsCache = null;
function loadMapRefs() {
    if (_refsCache) return _refsCache;
    try {
        _refsCache = JSON.parse(readFileSync(join(ROOT, 'data', 'map_references.json'), 'utf8'));
    } catch {
        _refsCache = [];
    }
    return _refsCache;
}

// 构建道具目录摘要（避免完整 50KB 塞入 prompt，只列类别 + 每类前 20 个 prop 名）
function buildCatalogSummary() {
    const cat = loadCatalog().categories;
    const lines = [];
    for (const [category, props] of Object.entries(cat)) {
        const sample = props.slice(0, 20).map(p => p.name).join(', ');
        lines.push(`### ${category} (${props.length} 个)\n${sample}${props.length > 20 ? ' ...' : ''}`);
    }
    return lines.join('\n\n');
}

// 构建真实地图参考摘要
function buildMapRefSummary() {
    const refs = loadMapRefs();
    if (!refs.length) return '（无参考数据）';
    const lines = refs.filter(r => !r.error).slice(0, 6).map(r =>
        `- ${r.name}: ${r.propCount} props, ${r.mapSize.w}×${r.mapSize.h}, ` +
        `密度 ${r.densityPerKm2}/km²`
    );
    return lines.join('\n');
}

// ---------- 构建 system prompt ----------
function buildSystemPrompt() {
    return `你是 Tanki Online 地图设计助手。根据用户的自然语言描述，输出一份高层参数 JSON，用于驱动地图布局引擎。

## map.bin 格式
Tanki Online 地图文件，包含 atlases（图集）、materials（材质表）、props（道具实例）、collisionData（碰撞数据）。
坐标系：Y-up，地面 y≈0，x/z 水平面。真实地图 x 远大于 z（长条形）。

## 道具库（共 1146 props，6 个语义类别）
${buildCatalogSummary()}

## 真实地图参考
${buildMapRefSummary()}

关键规律：
- 地图 x 远大于 z（6-40 倍），非正方形
- 草地/地形道具占 50-80%（Grass_S/M/L），结构类仅 2-5%
- 小图 50-150 道具，中图 150-300，大图 300+

## 参数 JSON Schema
\`\`\`json
{
  "style": "symmetric | asymmetric",
  "size": "small | medium | large",
  "symmetry": { "type": "mirror", "axis": "x | z" },
  "propDensity": "low | medium | high",
  "propSelection": [
    { "category": "natural | structure | decoration | terrain | vehicle | other", "count": <整数>, "placement": "scattered | perimeter | clustered | grid" }
  ],
  "seed": <整数>
}
\`\`\`

字段说明：
- style: symmetric 生成镜像副本，asymmetric 不生成
- size: small(~Forest) / medium(~Sandbox) / large(~Cross)
- symmetry: 仅 style=symmetric 时有效，null 表示不对称
- propDensity: low=50 / medium=150 / high=300 道具
- propSelection: 每项选一类道具、数量、放置策略
- seed: 随机种子，同种子可复现

## few-shot 示例

输入："两座对称山丘、中间一条沟、适合1v1的小图"
输出：
{"style":"symmetric","size":"small","symmetry":{"type":"mirror","axis":"x"},"propSelection":[{"category":"terrain","count":20,"placement":"clustered"},{"category":"natural","count":15,"placement":"scattered"},{"category":"structure","count":8,"placement":"perimeter"}],"seed":7}

输入："开阔的工业仓库大图，多掩体，适合大混战"
输出：
{"style":"asymmetric","size":"large","propSelection":[{"category":"structure","count":50,"placement":"scattered"},{"category":"decoration","count":20,"placement":"perimeter"},{"category":"natural","count":30,"placement":"scattered"}],"seed":99}

## 输出要求
只输出 JSON，不要 markdown 代码块，不要解释文字。`;
}

// ---------- JSON 解析容错 ----------
export function parseLLMJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let text = raw.trim();
    // 剥离 ```json ... ``` 包裹
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) text = fenceMatch[1].trim();
    // 尝试提取第一个 { 到最后一个 } 之间的内容
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        text = text.slice(start, end + 1);
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// ---------- 参数校验与补全 ----------
export function validateParams(raw) {
    const warnings = [];
    if (!raw || typeof raw !== 'object') {
        return { params: { ...DEFAULT_PARAMS }, warnings: ['输入为空或非对象，使用全部默认值'] };
    }

    // 逐字段检查：缺失则补默认值并 warning，存在但非法则修正并 warning
    const p = {};

    // style
    if (raw.style === undefined) {
        warnings.push('style 缺失，补为 symmetric');
        p.style = 'symmetric';
    } else if (!VALID.style.includes(raw.style)) {
        warnings.push(`style "${raw.style}" 非法，修正为 symmetric`);
        p.style = 'symmetric';
    } else {
        p.style = raw.style;
    }
    // size
    if (raw.size === undefined) {
        warnings.push('size 缺失，补为 small');
        p.size = 'small';
    } else if (!VALID.size.includes(raw.size)) {
        warnings.push(`size "${raw.size}" 非法，修正为 small`);
        p.size = 'small';
    } else {
        p.size = raw.size;
    }
    // propDensity
    if (raw.propDensity === undefined) {
        warnings.push('propDensity 缺失，补为 medium');
        p.propDensity = 'medium';
    } else if (!VALID.propDensity.includes(raw.propDensity)) {
        warnings.push(`propDensity "${raw.propDensity}" 非法，修正为 medium`);
        p.propDensity = 'medium';
    } else {
        p.propDensity = raw.propDensity;
    }
    // symmetry
    if (p.style === 'symmetric') {
        if (!raw.symmetry || typeof raw.symmetry !== 'object') {
            warnings.push('symmetry 缺失，补为默认 mirror/x');
            p.symmetry = { type: 'mirror', axis: 'x' };
        } else {
            p.symmetry = { ...raw.symmetry };
            if (!VALID.axis.includes(p.symmetry.axis)) {
                warnings.push(`symmetry.axis "${p.symmetry.axis}" 非法，修正为 x`);
                p.symmetry.axis = 'x';
            }
        }
    } else {
        p.symmetry = null;
    }

    // propSelection
    if (!Array.isArray(raw.propSelection) || raw.propSelection.length === 0) {
        warnings.push('propSelection 缺失或为空，补为默认值');
        p.propSelection = DEFAULT_PARAMS.propSelection;
    } else {
        p.propSelection = raw.propSelection.map((sel, i) => {
            const s = { ...sel };
            if (!VALID.category.includes(s.category)) {
                warnings.push(`propSelection[${i}].category "${s.category}" 非法，修正为 structure`);
                s.category = 'structure';
            }
            if (typeof s.count !== 'number' || s.count < 1 || s.count > 500) {
                warnings.push(`propSelection[${i}].count ${s.count} 非法，修正为 10`);
                s.count = 10;
            }
            if (!VALID.placement.includes(s.placement)) {
                warnings.push(`propSelection[${i}].placement "${s.placement}" 非法，修正为 scattered`);
                s.placement = 'scattered';
            }
            return s;
        });
    }

    // seed
    if (raw.seed === undefined || typeof raw.seed !== 'number' || !Number.isInteger(raw.seed)) {
        warnings.push('seed 缺失或非整数，补为 42');
        p.seed = 42;
    } else {
        p.seed = raw.seed;
    }

    return { params: p, warnings };
}

// ---------- 离线模式 ----------
export function getOfflineParams() {
    return { params: { ...DEFAULT_PARAMS }, warnings: ['使用离线模式（--no-llm），默认参数'] };
}

// ---------- API 调用 ----------
async function callOpenAI(prompt, userMsg, opts) {
    const baseUrl = opts.baseUrl || 'https://api.openai.com/v1';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
            model: opts.model,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: userMsg },
            ],
            temperature: 0.7,
        }),
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenAI API ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(prompt, userMsg, opts) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: opts.model,
            max_tokens: 1024,
            system: prompt,
            messages: [{ role: 'user', content: userMsg }],
        }),
    });
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Anthropic API ${resp.status}: ${errText}`);
    }
    const data = await resp.json();
    return data.content?.[0]?.text || '';
}

// ---------- 主入口 ----------
// options: { provider, model, apiKey, baseUrl, noLlm }
export async function generateParams(naturalLanguage, options = {}) {
    // 离线模式
    if (options.noLlm) {
        return getOfflineParams();
    }

    const provider = options.provider || 'openai';
    const model = options.model || PROVIDER_MODELS[provider]?.[0];
    if (!model) {
        throw new Error(`未知的 provider "${provider}"，可选: openai / anthropic / local`);
    }

    // 解析 API key：参数 > 环境变量
    let apiKey = options.apiKey;
    if (!apiKey) {
        const envKey = {
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            local: 'LOCAL_API_KEY',
        }[provider];
        if (envKey) apiKey = process.env[envKey];
    }

    // local 提供商走 OpenAI 兼容接口，通常不需要 key，但允许传
    if (!apiKey && provider !== 'local') {
        throw new Error(
            `缺少 API key。请通过 --api-key 参数或环境变量 ${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} 提供。`
        );
    }

    if (!naturalLanguage || typeof naturalLanguage !== 'string') {
        throw new Error('自然语言描述不能为空');
    }

    const systemPrompt = buildSystemPrompt();

    let raw;
    if (provider === 'anthropic') {
        raw = await callAnthropic(systemPrompt, naturalLanguage, { apiKey, model });
    } else {
        // openai 和 local 都走 OpenAI 兼容接口
        raw = await callOpenAI(systemPrompt, naturalLanguage, { apiKey, model, baseUrl: options.baseUrl });
    }

    const parsed = parseLLMJson(raw);
    if (!parsed) {
        throw new Error('LLM 返回的 JSON 解析失败，请重试或更换模型。\n原始输出:\n' + raw.slice(0, 500));
    }

    const { params, warnings } = validateParams(parsed);
    return { params, warnings, raw };
}
