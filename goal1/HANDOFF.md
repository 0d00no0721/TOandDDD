# 交接文档（HANDOFF）

> 本文档供下一个 agent 接手工作。请先通读本文，再阅读 `目标1-自然语言生成地图.md`（位于 `E:\DDD\` 根目录）和 `README.md`（位于本目录）。

---

## 1. 项目背景

实现 `E:\DDD\目标1-自然语言生成地图.md`：用自然语言描述需求，自动生成可在编辑器/游戏中载入的 Tanki Online `map.bin`。三层架构：

```
自然语言 → [层1 LLM理解层] → 高层参数 JSON
         → [层2 过程化布局层] → props[] 布局
         → [层3 序列化层] → map.bin
```

工作目录：`E:\DDD\map-generator\`
源参考：`E:\DDD\testanki1.github.io\maps\editor.html`（3758 行，Tanki 官方网页地图编辑器，所有二进制读写逻辑均移植自此文件）。

---

## 2. 当前进度

| 里程碑 | 状态 | 说明 |
|---|---|---|
| 目录结构 + package.json + README.md | ✅ 完成 | ES module，Node ≥18 |
| **M2 序列化层** | ✅ **完成并验证** | 21/21 往返测试通过；真实 Highland map.bin 解析成功 |
| **M1 道具库索引** | ✅ **完成** | 1146 props 索引就绪，`library_index.json` + `library_catalog.json` 已生成 |
| **M3 过程化布局层** | ✅ **完成并验证** | `src/layout.js` 修复 bug 后 20/20 测试通过；端到端 map.bin 生成验证通过 |
| M4 LLM 理解层 | ⬜ 未开始 | 需选 LLM API、设计 prompt |
| M5 集成与界面 | ⬜ 未开始 | `src/generate.js` 入口 + 预览/下载 |

### 已完成的文件

```
map-generator/
├── package.json                          # ES module, Node>=18
├── README.md                             # 项目说明
├── src/
│   ├── binary-writer.js     ✅ M2 核心   # BinaryStream/BinaryWriter/packHeader/wrapPacketCompressed/unwrapPacket（Node zlib 版）
│   ├── parse-map-bin.js     ✅ M2 核心   # parseMapBin 移植（解析 map.bin）
│   ├── serialize-map-bin.js ✅ M2 核心   # generateMapBin 纯数据版（无 three.js 依赖）
│   ├── library-index.js     ✅ M1        # 下载+解析+分类 library.json，输出索引
│   └── layout.js            ✅ M3        # 过程化布局层（参数→props[]），已修复 buildMaterials bug
├── data/
│   ├── cache/
│   │   ├── main_library.json     # Main Library 缓存（1020 props）
│   │   └── newyear_library.json  # New Year Library 缓存（126 props）
│   ├── library_index.json        # 完整索引（190KB，含 meshFile/textures/baseUrl）
│   └── library_catalog.json      # 精简目录（50KB，按语义类别分组，供 LLM prompt 用）
├── test/
│   ├── verify-roundtrip.js   ✅ 通过 21/21  # M2 往返验证
│   ├── parse-real-map.js     ✅ 通过        # 真实 Highland map.bin 解析
│   ├── verify-layout.js      ✅ 通过 20/20  # M3 布局层端到端验证
│   └── probe-library.js      ✅ 临时探查脚本（可删）
└── output/
    └── test-layout.bin       ✅ M3 生成    # 示例 map.bin（1804 bytes，66 props / 28 materials）
```

---

## 3. 关键技术发现（与目标文档假设的差异，重要！）

下一个 agent 必须了解这些实测结论，它们修正了 `目标1-自然语言生成地图.md` 中的若干假设：

### 3.1 library.json 结构（与文档第 4 节假设不符）
- **文档假设**：`group.name` 可作为"类别"，两库分别 1020 / 1146 props。
- **实测**：
  - 两库的 `group.name` **都是 `null`**，无法按 group 分类。每个库只有 1 个 group。
  - Main Library: **1020 props**（库 `name="Remaster"`）
  - New Year Library: **126 props**（库 `name="LibNewYear2024_Remaster"`，文档说的 1146 是两库合计 1020+126）
  - **prop 结构**：`{ mesh:{file, lods, textures:[{diffuseMap, name}]}, name, sprite }`（无 `category` 字段）
- **应对**：`src/library-index.js` 改用 **prop.name 前缀 + 语义关键词** 做分类（见 `CATEGORY_KEYWORDS`），分为 6 类：`natural`(316) / `structure`(302) / `decoration`(168) / `terrain`(141) / `vehicle`(20) / `other`(199)。

### 3.2 真实地图坐标范围（文档第 8 节"待定"项之一）
用 Highland REMASTER Summer Evening 的 `map.bin` 实测（6875 props）：
```
x: [-259600, 156000]   宽 207800
y: [-193100, 201700]   高 394800   ← 异常大，y 可能不是高度，需进一步确认
z: [-42703, 3040]      宽 22871
```
- `src/layout.js` 中暂用 `SIZE_BOUNDS = { small:{half:800}, medium:{half:1500}, large:{half:2500} }`，地面 `y=0`。
- **注意**：真实地图的 y 范围极大（近 40 万），与 x/z 量级不符。建议下一个 agent 实测更多 map.bin 确认坐标系约定（是否 Y-up、地面是否真在 y=0）。这会影响 M3 布局的正确性。

### 3.3 材质前缀规则 `getDecimalPrefix`（editor.html:2627）
- 库 URL 的最后一段文件夹名若是八进制（仅含 0-7），转成十进制作为材质 `texName` 前缀。
- 例：URL `.../553/105167/27/302/30546776460526/library.json` → 文件夹 `30546776460526`（含 8/9，**非**八进制）→ 直接用原字符串。
- `src/layout.js` 的 `buildMaterials` 已实现此逻辑，材质 `texName = "<libFolder>_<diffuseMap>"`，shader 用 `TankiOnline/SingleTextureShader`（对应 `generateMapBin:2759-2775` 的 `_baseTexName` 分支）。

### 3.4 shader 分布（真实地图）
Highland 的 81 个材质：`SingleTextureShader`=66，`SpriteShader`=14，`Terrain`=1。M3 布局层目前只用 `SingleTextureShader`（最简单），后续若要支持地形/精灵需扩展。

---

## 4. M2 验证结论（已通过）

### 4.1 往返测试 `test/verify-roundtrip.js`（21/21 ✓）
- 完整数据往返（含碰撞 type1/2/3）
- 空地图往返
- 浮点精度与零值优化（rot/scale 的 1e-5 阈值）
- 默认空碰撞（与 `generateMapBin:2785` 行为一致）

### 4.2 真实地图解析 `test/parse-real-map.js`（✓）
- Highland `map.bin`（877.8 KB）成功解析：6875 props / 81 materials / 2 atlases
- collisionData1: type1=223, type2=929, type3=3918
- collisionData2: type1=143, type2=864, type3=1741
- 证明 `parse-map-bin.js` 对原版数据完全兼容。

---

## 5. M3 测试（已完成）

`src/layout.js` 已修复 bug 并通过全部测试。

### 5.1 已完成的 M3 端到端测试 `test/verify-layout.js`（20/20 ✓）
1. ✅ `generateDefaultLayout()` 返回合法的 `{ props, materials }`
2. ✅ 喂给 `serializeMapBin` → 生成 map.bin（不报错）
3. ✅ 用 `parseMapBin` 读回 → props/materials 数量与原始一致
4. ✅ 对称布局：props 数量应为选取消数的 2 倍
5. ✅ 所有 prop 的 `pos` 在 `SIZE_BOUNDS` 范围内
6. ✅ 所有 prop 的 `matID` 在 materials 表中存在
7. ✅ 所有 prop 的 `name` 在 `library_index.json` 中存在
8. ✅ 自定义参数（large/非对称）端到端
9. ✅ 同 seed 可复现性
10. ✅ material shader 全为 SingleTextureShader

### 5.2 已修复的 bug
- `buildMaterials` 中 `p.textures` / `p.name` 应为 `p.prop.textures` / `p.prop.name`（p 是包装对象）

### 5.3 架构转变：从独立工具 → Kun Skill
用户决定最终成品为一个 **Kun skill 工作区文件夹**，而非独立工具/网页。架构变为：
- **Agent 自身的 LLM 能力** 负责自然语言→高层参数 JSON（不绑定特定 LLM API）
- **SKILL.md** 提供完整知识库（道具目录/真实地图参考/参数schema/few-shot示例）
- **引擎代码** 负责布局+序列化（layout.js + serialize-map-bin.js）
- **数据文件** 提供资源对照（library_catalog.json / resource_urls.json / map_references.json）

### 5.4 真实地图布局参考
下载并分析了 14 张原版地图，关键发现：
- 地图 x 远大于 z（6-40 倍），非正方形
- 道具以草地/地形为主（Grass_S/M/L 占 50-80%）
- 真实地图 2000-10000 props，SIZE_BOUNDS 已更新为真实尺度
- 真实地图大量 prop 名称不在库索引中（子组件 `-sub-N` / 小写 `grass_S`）

### 5.5 仍待完善
- 用真实编辑器 `editor.html` 加载生成的 map.bin 做视觉验证
- `libName` 确认（真实 Highland 全为空字符串，当前代码已匹配）
- 镜像后 `grpName` 未加 `_inst` 后缀（可按需补上）

---

## 6. M4 / M5 展望

### M4 LLM 理解层
- 精简目录 `data/library_catalog.json` 已就绪（50KB，按 6 类分组列出所有 prop 名），可直接塞进 prompt。
- prompt 需包含：道具目录 + 格式约束（输出高层参数 JSON）+ few-shot 示例。
- 输出 JSON schema 见 `目标1-自然语言生成地图.md` 第 3 节层 1。
- LLM API 选型是**待定问题**（文档第 8 节），需与用户确认。

### M5 集成与界面
- `src/generate.js` 作为端到端入口：自然语言 → LLM → 布局 → 序列化 → map.bin。
- 界面形态待定（独立网页 / 命令行 / 编辑器内），建议先做命令行（`node src/generate.js "描述"`），再做网页。

---

## 7. 如何运行现有代码

```powershell
# 工作目录
cd E:\DDD\map-generator

# M2 往返测试（应输出 21/21 通过）
node test/verify-roundtrip.js

# 真实地图解析测试
node test/parse-real-map.js

# 重新构建道具库索引（已有缓存，除非 --force 否则用缓存）
node src/library-index.js
node src/library-index.js --force   # 强制重新下载

# 临时探查脚本（可删）
node test/probe-library.js
```

**环境**：Node v24.14.0，npm 11.14.1，Windows / PowerShell。无任何 npm 依赖（全部用 Node 内置模块：`node:zlib`、`node:fs`、`fetch` 全局）。

---

## 8. 核心复用代码的位置对照表

| 本项目文件 | 对应 editor.html 位置 | 说明 |
|---|---|---|
| `src/binary-writer.js` `BinaryStream` | editor.html:753 | 二进制读 |
| `src/binary-writer.js` `BinaryWriter` | editor.html:790 | 二进制写 |
| `src/binary-writer.js` `packHeader` | editor.html:845 | 位掩码头 |
| `src/binary-writer.js` `wrapPacketCompressed` | editor.html:871 | zlib 压缩+包头 |
| `src/binary-writer.js` `unwrapPacket` | editor.html:829 | 解包 |
| `src/binary-writer.js` `readPacketHeader` | editor.html:1187-1199 | 位掩码头解析 |
| `src/parse-map-bin.js` `parseMapBin` | editor.html:1183-1308 | map.bin 解析 |
| `src/parse-map-bin.js` `readCols` | editor.html:1234-1262 | 碰撞数据解析 |
| `src/serialize-map-bin.js` `serializeMapBin` | editor.html:2642-2832 | map.bin 生成（去掉 three.js） |
| `src/library-index.js` `getDecimalPrefix` | editor.html:2627 | 八进制文件夹→十进制前缀 |
| `src/layout.js` `buildMaterials` | editor.html:2759-2775 | `_baseTexName` 材质重建分支 |

---

## 9. 待定问题清单（来自目标文档第 8 节，标注已解决/仍开放）

- [x] ~~道具分类粒度~~ → 已用语义关键词分 6 类（3.1 节）
- [x] ~~地图坐标范围~~ → 已实测 Highland，但 y 范围异常待确认（3.2 节）
- [x] ~~材质/atlas 引用~~ → M3 用最简的 `SingleTextureShader` + `getDecimalPrefix` 前缀（3.3 节）
- [ ] **LLM 选型**：用哪个 API？是否需要离线/本地模型？API key 由谁提供？→ **需问用户**
- [ ] **运行形态**：生成器是独立网页、命令行工具，还是集成进编辑器？→ **需问用户**
- [ ] **质量控制**：如何验证生成的地图"可玩"？是否需要规则校验器？
- [ ] **出生点/旗帜/边界**：文档第 7 节明确不含游戏逻辑点，map.bin 只描述视觉/碰撞物件。

---

**最后更新**：本次会话结束。M3 `layout.js` 已写完待测试，请下一个 agent 从第 5 节"M3 测试"开始。
