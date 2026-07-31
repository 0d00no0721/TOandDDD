# AGENTS.md — 目标1：自然语言生成 Tanki map.bin

> 本文件由 opencode `/init` 生成（2026-07-31），保留当前进度供后续 agent 接手。
> **工作目录说明**：最新代码在 `E:\DDD\map-generator\`（日常开发处），本 `goal1/` 文件夹为仓库内快照，**落后于最新代码**（见 §6 进度同步）。

---

## 1. 项目概览

用自然语言描述需求 → 自动生成 Tanki Online `map.bin`（可在官方编辑器/游戏中载入）。

上游参考：`E:\DDD\testanki1.github.io\maps\editor.html`（Tanki 官方网页地图编辑器，所有二进制读写逻辑均移植自此）。

```
自然语言 → [层1 LLM理解层 llm-layer.js] → 高层参数 JSON
         → [层2 过程化布局层 layout.js]  → props[] 布局
         → [层3 序列化层 serialize-map-bin.js] → map.bin
         → [分析/预览/比对/自进化工具链]
```

## 2. 代码结构

```
src/
├── binary-writer.js       # 二进制读写基元（BinaryStream/BinaryWriter/packHeader/wrapPacketCompressed/unwrapPacket）
├── parse-map-bin.js       # M2: 解析 map.bin
├── serialize-map-bin.js   # M2: 生成 map.bin（纯数据版，无 three.js）
├── library-index.js       # M1: 下载+解析+分类 library.json → 索引
├── layout.js              # M3: 过程化布局层（参数→props[]，Z-up 引擎）
├── llm-layer.js           # M4: 自然语言→高层参数 JSON（多提供商，零依赖）
├── gen-params.js          # 工具: params.json → map.bin
├── generate.js            # M5: CLI 全链路入口
├── analyze-map.js         # 地图深度分析器（对称性/空间热力/地形/类别分布）
├── preview-html.js        # 3D 预览 HTML 生成器（自包含，Three.js CDN）
└── compare-maps.js        # 双图差异量化引擎（默认仅评估 gameplay 道具）
test/
├── verify-roundtrip.js    # M2 往返 21/21 ✓
├── verify-layout.js       # M3 布局 20/20 ✓
├── verify-llm.js          # M4 LLM 37/37 ✓
├── verify-generate.js     # M5 CLI 24/24 ✓
├── verify-analyze.js      # 分析器 19/19 ✓
├── parse-real-map.js      # 真实 Highland map.bin 解析 ✓
└── probe-library.js       # 临时探查脚本（可删）
tools/
├── analyze-maps.js        # 批量分析真实地图 → data/map_references.json
├── train-loop.js          # 自进化训练循环（生成→比对→记录经验）
├── report-training.js     # 训练报告
└── check-unknown.js       # 检查未知道具名
data/
├── cache/                 # library.json 缓存（main_library 1020 + newyear_library 126）
├── library_index.json     # 完整索引（190KB）
├── library_catalog.json   # 精简目录（50KB，按语义类别，供 LLM prompt）
├── map_references.json    # 14 张真实地图参考（正方形数据，Z-up 已校正）
├── resource_urls.json     # CDN 资源 URL
└── generation-experience.json  # 训练经验库
output/                    # 生成的 map.bin / 预览 HTML
```

## 3. 常用命令

```powershell
cd E:\DDD\map-generator        # 最新代码所在处（goal1 为快照，见 §6）

npm test                       # M2+M3+M4+M5 四组测试
node test/verify-analyze.js    # 分析器测试（19）
node test/parse-real-map.js    # 真实地图解析测试

# 生成地图（全链路）
node src/generate.js "小地图，森林风格，十字对称" [-o output/xxx.bin] [--seed 42]

# 仅布局
node src/gen-params.js params.json output/generated.bin

# 分析 / 预览 / 比对
node src/analyze-map.js path/to/map.bin [--json]
node src/preview-html.js path/to/map.bin -o output/xxx.html [--no-collision]
node src/compare-maps.js <参考.bin> <生成.bin> [--json] [--all]

# 自进化训练
node tools/train-loop.js <参考.bin> <迭代次数>
```

**环境**：Node v24.14.0 / npm 11.14.1 / Windows PowerShell。**零 npm 依赖**（全用内置模块）。

## 4. 关键约定（重要！）

### 4.1 坐标系：Z-up（实测修正）
真实 Tanki map.bin 是 **Z-up**：`x/y` 水平、`z` 竖直（高度）。所有代码必须遵守：
- `pos = [x, y, z]`，z 是海拔
- 旋转 `rot = [tiltX, tiltY, yaw]`，yaw 在 `rot[2]`（绕竖直 Z 轴）
- 地图尺寸 = x×y（正方形），z 是高度
- 镜像：`mirrorPos` 翻转 x 或 y，`mirrorRot` 取反 `rot[2]`

### 4.2 SIZE_BOUNDS（layout.js）
```js
{ small:  {halfX: 28000, halfY: 26000, zMax: 2300},
  medium: {halfX: 90000, halfY: 90000, zMax: 4600},
  large:  {halfX: 210000, halfY: 197000, zMax: 25000} }
```
真实地图参考（data/map_references.json）：Forest 56,500×52,900 高 4,634；Sandbox 175,830×180,000 高 9,200；Highland 415,600×394,800 高 45,743。全部 x:y≈1（正方形）。

### 4.3 地面与连通性（layout.js）
- `generateFloor()`：底部 `Landscape` 道具，scale ≈ `span/900`（Sandbox 180K→scale 200 校准）
- 地面填充网格（Grass 等）铺在 x-y 平面 z=0
- **十字走廊**：6 条矩形走廊（3 条沿 y 方向 + 3 条沿 x 方向，各占跨度 10%），structure/vehicle 禁入，保证坦克可达全图
- 放置尝试上限 400 次，失败走 `nudgeOutOfCorridor()` 兜底

### 4.4 其他
- 道具分类：`natural/structure/decoration/terrain/vehicle/other`（语义关键词，非 group.name）
- 材质前缀：库 URL 文件夹名是八进制则转十进制（`getDecimalPrefix`，editor.html:2627）
- shader 仅用 `SingleTextureShader`（最简），`texName = "<libFolder>_<diffuseMap>"`
- 预览 HTML：`world` 组 `rotation.x = -Math.PI/2`（Z-up bin → Y-up Three.js）
- 提交约定（父仓库 AGENTS.md）：中文，`feat:/fix:/docs:/test:/chore:` 前缀

## 5. 里程碑状态

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M1 道具库索引 | ✅ | 1146 props（1020+126），6 类语义分类 |
| M2 序列化层 | ✅ | 21/21 往返；真实 Highland 6875 props 解析成功 |
| M3 过程化布局层 | ✅ | 20/20；Z-up 引擎 + 地面 + 十字走廊 |
| M4 LLM 理解层 | ✅ | 37/37；多提供商（OpenAI/Anthropic/本地兼容 API） |
| M5 CLI 集成 | ✅ | 24/24；`node src/generate.js "描述"` 全链路 |
| 分析/预览/比对工具 | ✅ | analyze-map / preview-html / compare-maps |
| 自进化训练 | ✅ | train-loop + generation-experience |
| **Z-up 轴系修复** | ✅ | 见 §6（最近一次大改，已验证） |

## 6. 当前进度（2026-07-31 会话）

### 本次会话完成的修复（重要！）
修复根因：**代码库原本假设 Y-up**（y=竖直），真实 Tanki map.bin 是 **Z-up**（z=竖直，x/y 水平）。此错误导致：
1. 地图呈 12:1 长条而非真实的正方形（x:y≈1）
2. 没有底面（Landscape 落在 y=0，且被当作水平轴）
3. 走廊沿竖直轴，坦克无法跨区移动

已修复文件（在 `E:\DDD\map-generator\`）：
- `src/layout.js`：Z-up 重写 — SIZE_BOUNDS halfX/halfY/zMax、`generateFloor()`、十字走廊 `makeCorridors()`/`inCorridor()`/`nudgeOutOfCorridor()`、`randZ()`、yaw→rot[2]、x-y 平面校验/放置、z=0 地面填充
- `src/preview-html.js`：world 组旋转 -90°（Z-up→Y-up），x:y 尺寸显示，camera 用 centerY/centerZ
- `src/analyze-map.js`：x/y 水平 z 竖直；对称检测 x/y 轴；`mapWidth/mapDepth/mapHeight/xyRatio`
- `tools/analyze-maps.js`：面积 = x×y，`mapSize.h` = y 跨度
- `src/compare-maps.js`：`halfZ→halfY`，`mapHeight→mapDepth`
- `src/llm-layer.js`：Z-up 文档，axis 仅 "x"/"y"
- `test/verify-layout.js`、`verify-analyze.js`、`verify-llm.js`、`parse-real-map.js`、`tools/train-loop.js`：轴断言修正
- `data/map_references.json`：重新生成，14 张地图全部 x:y≈1
- `SKILL.md`：§2/§4.1/§5/§6.5 更新

### 验证结果（全部通过）
- 测试 121/121：M2 21 + M3 20 + M4 37 + M5 24 + 分析器 19
- 生成图 `output/zup-test.bin`：729 props，**56,000×52,000（x:y=1.1:1 正方形）**，地面覆盖 94%（Grass 77.8% + Landscape 16.5%），structure+vehicle 30 个、走廊违规 **0**，真实 gameplay 道具最小间距 600/622（阈值 96%），无严重重叠
- 真实地图分析校正：Forest → 56,500×52,900 正方形（修复前误报 12:1 长条）
- 预览：`output/zup-test.html`（150KB）、`output/highland-zup.html`（2264KB，真实图现在显示正方形）

### ⚠️ 进度同步提醒
**`E:\DDD\TOandDDD\goal1\` 内的代码是快照，未包含本次 Z-up 修复。** 后续继续开发前，先同步 `E:\DDD\map-generator\src\` 下的 layout.js / preview-html.js / analyze-map.js / compare-maps.js / llm-layer.js、`tools\`、`test\`、`data\map_references.json`、`SKILL.md` 到本目录（或直接在 map-generator 工作，完成后再同步快照）。

### 下一步（建议）
1. 同步快照代码到 goal1（或确认工作目录）
2. 浏览器目检 `output/zup-test.html`（正方形、底面、连通性）
3. 用 `tools/train-loop.js` 对真实参考图训练，调优布局参数

## 7. 待定问题（来自目标文档第 8 节）

- [x] 道具分类粒度 → 语义关键词 6 类
- [x] 地图坐标范围 → Z-up 实测校正，正方形
- [x] 材质/atlas 引用 → SingleTextureShader + getDecimalPrefix
- [x] LLM 选型 → 多提供商可配（generate.js --provider / --api-key）
- [x] 运行形态 → CLI（`tanki-map` bin）
- [ ] 质量控制：生成地图"可玩性"校验器
- [ ] 出生点/旗帜/边界：map.bin 只描述视觉/碰撞物件，不含游戏逻辑点
