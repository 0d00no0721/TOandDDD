---
id: tanki-map-generator
name: Tanki Online Map Generator
description: Generate playable Tanki Online map.bin files from natural language descriptions. Combines a prop library catalog, real-map layout references, and a binary serialization engine.
---

# Tanki Online Map Generator

从自然语言描述生成可在 Tanki Online 编辑器/游戏中载入的 `map.bin`。

## 1. 工作流程

```
用户自然语言描述
    │
    ▼
[Agent 理解]  → 高层参数 JSON（style/size/symmetry/propSelection）
    │          ← 参考本文档中的道具目录 + 真实地图样例
    ▼
[布局引擎]    → props[] + materials（layout.js）
    │
    ▼
[序列化引擎]  → map.bin（serialize-map-bin.js）
    │
    ▼
  map.bin 文件
```

Agent 自身的 LLM 能力负责将自然语言翻译为高层参数 JSON。本 skill 提供知识库（道具目录、地图样例）和引擎代码（布局 + 序列化），不绑定特定 LLM API。

## 2. map.bin 格式概述

`map.bin` 是 Tanki Online 的地图二进制格式，结构如下（读取/写入顺序）：

| 段 | 内容 | 说明 |
|---|---|---|
| 包头 | 位掩码 flags | 控制后续可选段的有无 |
| atlases | 图集引用 | 纹理图集列表（名称/宽高/子区域） |
| 碰撞数据 | collisionData1 + collisionData2 | 各含 type1(OBB)/type2(盒)/type3(三角) 三段 |
| materials | 材质表 | matID / name / shader / texParams |
| props | 道具实例 | id / grpName / libName / matID / name / pos / rot / scale |

坐标系：Y-up，地面 y≈0，x/z 为水平面。真实地图 x 远大于 z（非正方形）。

碰撞数据：生成器默认写空碰撞（与编辑器导出行为一致），由后续工具处理。

## 3. 道具库与资源 URL 对照

两个道具库，共 1146 个 props：

| 库 | id | URL | props |
|---|---|---|---|
| Main Library (Remaster) | `main` | `https://res.3dtank.com/553/105167/27/302/30546776460526/library.json` | 1020 |
| New Year Library | `newyear` | `https://res.3dtank.com/570/174542/371/71/31167243462337/library.json` | 126 |

每个 prop 的结构：`{ name, mesh:{file, textures:[{diffuseMap}]}, sprite }`

### 语义分类（6 类，按 prop.name 前缀 + 关键词）

| 类别 | 数量 | 典型 prop |
|---|---|---|
| `natural` | 316 | Tree, Bush, Grass, Rock, Flower |
| `structure` | 302 | Wall, Pipe, Building, Bridge, Tower |
| `decoration` | 168 | Balloon, Billboard, Flag, Light |
| `terrain` | 141 | Cliff, Ground, Tile, Road |
| `vehicle` | 20 | Tank, Truck, Helicopter |
| `other` | 199 | 杂项 |

完整目录见 `data/library_catalog.json`（按类别分组，50KB）。

## 4. 真实地图布局参考

以下数据从 14 张原版 Tanki 地图实测提取（见 `data/map_references.json`）。

### 4.1 地图尺寸与道具数量

| 地图 | 尺寸 (x×z) | 道具数 | 材质数 | 密度 |
|---|---|---|---|---|
| Forest | 56K × 4.6K | 2049-6694 | 102-114 | 8-26/km² |
| Sandbox | 176K × 9.2K | 4494-4616 | 111-128 | 2.8/km² |
| Sandal | 208K × 9.9K | 7487-7582 | 127-129 | 3.6/km² |
| Cross | 229K × 14K | 9372-9377 | 86 | 2.9/km² |
| Parma | 369K × 23K | 10018-10029 | 83-86 | 1.2/km² |
| Highland | 416K × 46K | 6875-6908 | 81-83 | 0.4/km² |

关键规律：
- **x 远大于 z**：地图是长条形，x 宽度是 z 的 6-40 倍
- **道具以草地/地形为主**：Grass_S/M/L 占 50-80%，是地面覆盖物
- **结构类道具是少数**：structure 类仅占 2-5%，但决定玩法
- **季节变体**：同一地图的 Summer/Autumn/Winter 版本道具数接近，只是贴图名后缀不同（`_au` / `_sn`）

### 4.2 道具类别混合（以 Highland 为例）

```
natural   (685)  ████████████████████  10%   树/灌木/岩石
structure (180)  ██████                 3%   墙/管道/建筑
terrain   (25)   █                      0.4%  悬崖/地面
decoration (6)   ▏                      0.1%  装饰物
其他      (5962) ████████████████████████████████████████████████  87%  草地/子组件
```

### 4.3 生成建议

- **小型地图**（1v1/训练）：用 `small` 尺寸，50-150 个道具，以 structure + natural 为主
- **中型地图**（团队战）：用 `medium` 尺寸，150-300 个道具，混合 structure + natural + decoration
- **大型地图**（CTF/大混战）：用 `large` 尺寸，300+ 个道具，加入 terrain 做地形起伏
- **草地覆盖**：可大量放置 Grass_S/M/L 作为地面填充（真实地图 50-80% 都是草地）
- **对称性**：竞技地图建议 `symmetric` + `mirror`，娱乐地图可用 `asymmetric`

## 5. 高层参数 JSON

Agent 将自然语言翻译为以下 JSON 结构，喂给布局引擎：

```json
{
  "style": "symmetric",
  "size": "small",
  "symmetry": { "type": "mirror", "axis": "x" },
  "propDensity": "medium",
  "propSelection": [
    { "category": "structure", "count": 15, "placement": "perimeter" },
    { "category": "natural", "count": 12, "placement": "scattered" },
    { "category": "decoration", "count": 6, "placement": "clustered" }
  ],
  "seed": 42
}
```

| 字段 | 可选值 | 说明 |
|---|---|---|
| `style` | `symmetric` / `asymmetric` | 是否生成镜像副本 |
| `size` | `small` / `medium` / `large` | 地图尺寸（见 §4.1 实测数据） |
| `symmetry` | `{type:"mirror", axis:"x"\|"z"}` 或 null | 镜像轴 |
| `propDensity` | `low` / `medium` / `high` | 道具密度（50/150/300） |
| `propSelection` | 数组 | 每项选一类道具、数量、放置策略 |
| `propSelection[].category` | `natural`/`structure`/`decoration`/`terrain`/`vehicle`/`other` | 道具类别 |
| `propSelection[].count` | 整数 | 该类道具数量 |
| `propSelection[].placement` | `scattered`/`perimeter`/`clustered`/`grid` | 放置策略 |
| `seed` | 整数 | 随机种子，同种子可复现 |

### few-shot 示例

**输入**："两座对称山丘、中间一条沟、适合1v1的小图"
```json
{
  "style": "symmetric", "size": "small",
  "symmetry": { "type": "mirror", "axis": "x" },
  "propSelection": [
    { "category": "terrain", "count": 20, "placement": "clustered" },
    { "category": "natural", "count": 15, "placement": "scattered" },
    { "category": "structure", "count": 8, "placement": "perimeter" }
  ],
  "seed": 7
}
```

**输入**："开阔的工业仓库大图，多掩体，适合大混战"
```json
{
  "style": "asymmetric", "size": "large",
  "propSelection": [
    { "category": "structure", "count": 50, "placement": "scattered" },
    { "category": "decoration", "count": 20, "placement": "perimeter" },
    { "category": "natural", "count": 30, "placement": "scattered" }
  ],
  "seed": 99
}
```

## 6. 引擎代码调用

引擎代码位于 `src/`，无第三方依赖（纯 Node.js 内置模块），Node ≥ 18。

### 6.1 生成 map.bin

```javascript
import { generateLayout } from './src/layout.js';
import { serializeMapBin } from './src/serialize-map-bin.js';
import { writeFileSync } from 'node:fs';

// 1. Agent 产出高层参数
const params = { style: "symmetric", size: "small", /* ... */ };

// 2. 布局引擎 → props[] + materials
const layout = generateLayout(params);

// 3. 序列化 → map.bin
const bin = serializeMapBin(layout);
writeFileSync('output/map.bin', bin);
```

### 6.2 验证生成的 map.bin

```javascript
import { parseMapBin } from './src/parse-map-bin.js';
import { readFileSync } from 'node:fs';

const parsed = parseMapBin(readFileSync('output/map.bin'));
console.log(`props: ${parsed.props.length}, materials: ${Object.keys(parsed.materials).length}`);
```

### 6.3 运行测试

```bash
node test/verify-roundtrip.js   # M2 序列化往返（21/21）
node test/verify-layout.js      # M3 布局层端到端（20/20）
```

## 7. 文件清单

| 路径 | 说明 |
|---|---|
| `SKILL.md` | 本文档 |
| `src/binary-writer.js` | 二进制读写引擎 |
| `src/parse-map-bin.js` | map.bin 解析器 |
| `src/serialize-map-bin.js` | map.bin 序列化器 |
| `src/layout.js` | 过程化布局引擎 |
| `src/library-index.js` | 道具库下载+索引工具 |
| `data/library_catalog.json` | 道具目录（按类别分组，供 Agent 参考） |
| `data/library_index.json` | 完整道具索引（含 URL/mesh/贴图） |
| `data/map_references.json` | 14 张真实地图布局分析数据 |
| `data/resource_urls.json` | 资源 URL 对照表（库 URL + 参考地图 URL + 资源路径规则） |
| `test/verify-roundtrip.js` | 序列化往返测试 |
| `test/verify-layout.js` | 布局层端到端测试 |
| `tools/analyze-maps.js` | 批量下载+解析真实地图的工具脚本 |

## 8. 注意事项

- **只组合现有库内 props**，不生成新建模/新贴图
- **不含游戏逻辑点**（出生点/旗帜/边界）——map.bin 只描述视觉/碰撞物件
- **碰撞数据默认清零**，由后续工具处理
- **材质 shader** 目前只用 `SingleTextureShader`（最简），真实地图还含 `SpriteShader` 和 `Terrain`
- **libName**：main 库 props 的 `libName` 为空字符串 `""`，newyear 库为 `"newyear"`
- **材质前缀规则**：库 URL 最后一段文件夹名若为八进制（仅 0-7），转十进制作为 texName 前缀
