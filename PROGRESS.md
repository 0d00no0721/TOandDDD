# PROGRESS — 进度追踪

> 统筹 agent 维护本文件。实现 agent 完成里程碑后在此更新状态。

最后更新：2026-07-31（第九次更新，goal2.1 + goal2.2 新增）

---

## 总览

| 目标 | 分支 | 远程 HEAD | 状态 | 文件数 |
|---|---|---|---|---|
| 目标 1：自然语言 → 地图 | `main` (goal1/) | `77f0b15` | ✅ **全部完成**（M1✅ M2✅ M3✅ M4✅ M5✅） | 60 |
| 目标 2：地图简化器 | `main` (goal2/) | `77f0b15` | 🟨 进行中（M1✅ M2✅ M3✅ M4✅ M5⬜） | 75 |

状态图例：⬜ 未开始 / 🟨 进行中 / ✅ 完成 / ⛔ 阻塞

> ✅ 两个目标的实现代码均已纳入 TOandDDD 对应分支并推送到远程。

---

## 目标 1：自然语言 → 地图的生成

里程碑（详见 [docs/目标1-自然语言生成地图.md](docs/目标1-自然语言生成地图.md#6-实现里程碑)）：

- [x] **M1** 道具库索引构建（解析 2 个 library.json → `library_index.json`）
- [x] **M2** map.bin 序列化器（Node 端，BinaryWriter 移植 + 往返校验）
- [x] **M3** 过程化布局层（参数 → props[]，对称/密度/避让）— ✅ 20/20 测试通过，端到端验证
- [x] **M4** LLM 理解层（prompt 工程 + API 调用 + 端到端跑通）— `llm-layer.js`
- [x] **M5** 集成与界面（输入框 + 生成 + 预览/下载）— `generate.js` CLI

### 架构总览

```
自然语言描述
    ↓
llm-layer.js (M4) — 解析自然语言 → 参数 JSON（SKILL.md 定义知识库）
    ↓
layout.js (M3)    — 参数 JSON → props[]（过程化布局，4 种放置策略）
    ↓
serialize-map-bin.js (M2) — props[] → map.bin 二进制（BinaryWriter）
    ↓
generate.js (M5)  — CLI 入口，端到端：输入 → 输出 map.bin
```

### goal1 分支提交历史（远程 origin/goal1）

| Commit | 说明 |
|---|---|---|
| `bb73559` | feat: 同步新增工具和测试输出 — train-loop/report-training/analyze-map/compare-maps/gen-params/preview-html + 14张参考地图 + M5测试输出 |
| `03f0b09` | feat: 完成 M4 LLM理解层 + M5 CLI集成界面 |
| `32fa902` | docs: 更新 HANDOFF.md — M3测试完成 + skill架构转变 + 真实地图分析结论 |
| `aedbe35` | feat: 完成 skill 架构 — SKILL.md + 资源URL对照表 + 真实地图布局参考 |
| `45672d5` | feat: 同步 goal1 最新代码（M3验证通过+工具链+交接文档） |
| `4c07305` | feat: 导入目标1已有代码（M1道具库索引 + M2序列化器 + M3布局层） |
| `6fa808b` | chore: 初始仓库搭建 |

### goal1 分支文件清单（64 文件）

```
goal1/
├── .gitignore                      覆盖根 .gitignore（允许 *.bin/*.json）
├── package.json                    ESM, 零依赖
├── README.md                       三层架构说明 + 里程碑清单
├── HANDOFF.md                      交接文档（M1-M5 全量状态 + 技术发现）
├── SKILL.md                        Skill 定义（Agent 理解层知识库）
├── src/
│   ├── binary-writer.js            BinaryStream/Writer + 封包解压/压缩
│   ├── parse-map-bin.js            parseMapBin 移植
│   ├── serialize-map-bin.js        serializeMapBin 移植（纯数据版）
│   ├── library-index.js            M1：下载解析 library.json，构建索引
│   ├── layout.js                   M3：过程化布局层（参数→props[]）
│   ├── llm-layer.js                M4：LLM 理解层（解析自然语言 → 参数 JSON）
│   ├── generate.js                 M5：CLI 入口（端到端生成）
│   ├── gen-params.js               从参数 JSON 直接生成 map.bin（跳过 LLM）
│   ├── analyze-map.js              地图深度分析器（对称性/热力/类别分布/玩法推断）
│   ├── compare-maps.js             双图差异量化引擎（参考 vs 生成）
│   └── preview-html.js             3D 地图预览 HTML 生成器（Three.js CDN）
├── test/
│   ├── verify-roundtrip.js         M2 往返测试（21/21 通过）
│   ├── verify-layout.js            M3 布局验证（20/20 通过）
│   ├── verify-llm.js               M4 LLM 理解层测试
│   ├── verify-generate.js          M5 CLI 集成测试
│   ├── verify-analyze.js           地图分析器验证
│   ├── parse-real-map.js           真实 Highland map.bin 解析验证
│   └── probe-library.js            library.json 结构探查
├── tools/
│   ├── analyze-maps.js             批量下载+解析真实地图，提取布局模式
│   ├── check-unknown.js            检查未知 prop 名称
│   ├── train-loop.js               自动化训练循环（参考地图 → 自动调参 → 生成 → 比对）
│   └── report-training.js          训练报告生成器（汇总 train-loop 输出）
├── output/
│   ├── demo-symmetric-hills.bin    M3 输出样例
│   ├── test-m5.bin                 M5 测试输出
│   ├── test-m5-seed1.bin           M5 种子1 输出
│   ├── test-m5-seed2.bin           M5 种子2 输出
│   ├── industrial-dm.bin           工业死斗模式地图
│   ├── industrial-dm-params.json   工业死斗参数
│   ├── forest-preview.html         森林预览
│   ├── gen-preview.html            生成预览
│   ├── highland-preview.html       高地预览
│   ├── highland-nocol-preview.html 高地（无碰撞）预览
│   ├── industrial-dm-preview.html  工业死斗预览
│   └── sub/deep/test.bin           嵌套目录测试
└── data/
    ├── library_index.json          1146 props 完整索引
    ├── library_catalog.json        按语义类别分组的精简目录
    ├── map_references.json         真实地图布局参考数据
    ├── resource_urls.json          资源 URL 对照表
    ├── generation-experience.json  训练经验积累数据
    └── cache/
        ├── main_library.json       Main Library 原始 JSON（1020 props）
        ├── newyear_library.json    New Year Library 原始 JSON（126 props）
        └── maps/                   14 张真实地图 bin（Cross/Forest/Highland/Parma/Sandal/Sandbox）
```

### 各里程碑详情

- **M1 ✅**：1146 props，6 语义类别（natural 316 / structure 302 / decoration 168 / terrain 141 / other 199 / vehicle 20）。实测 group.name 均为 null，改用 prop.name 前缀+关键词分类。
- **M2 ✅**：21/21 往返测试通过 + 真实 Highland map.bin 解析成功（6875 props / 81 materials / 2 atlases）。
- **M3 ✅**：layout.js 含 seeded PRNG、库索引加载、按 semanticCategory 筛选 props、材质表构建（SingleTextureShader）、4 种放置策略（perimeter/scattered/clustered/grid）、镜像对称。20/20 测试通过，端到端 map.bin 生成验证通过（66 props / 28 materials，1804 bytes）。
- **M4 ✅**：llm-layer.js — 基于 SKILL.md 的 Agent 理解层知识库，LLM 自身能力负责自然语言→参数 JSON 翻译。无需 API key 硬编码。
- **M5 ✅**：generate.js — CLI 入口，端到端：输入自然语言描述 → 输出 map.bin。支持命令行参数或交互式输入。

### 关键技术发现（来自 HANDOFF.md）

- 真实地图坐标范围：x[-260K, 156K], y[-193K, 202K], z[-43K, 3K]——y 范围异常大，需进一步确认
- shader 分布：SingleTextureShader=66, SpriteShader=14, Terrain=1（Highland 81 材质）
- 材质前缀规则 getDecimalPrefix：库 URL 最后一段文件夹名若为八进制则转十进制
- SKILL.md 定义了 Agent 理解层知识库，LLM 自身能力负责自然语言→参数 JSON 翻译

### 待定问题（已全部解决）

- [x] ~~LLM 选型 API key 来源~~ → 已解决：Agent 理解层由 SKILL.md 定义，依赖 LLM 自身能力，无需硬编码 API key
- [x] ~~运行形态~~ → 已决策：CLI 命令行入口（generate.js）
- [x] ~~道具分类粒度~~ → 已决策：用语义关键词分类（group.name 均为 null）
- [x] ~~地图坐标范围~~ → 已实测（Highland：x±260K, y±200K, z±43K）
- [x] ~~材质/matID 分配策略~~ → 已解决：SingleTextureShader + getDecimalPrefix 前缀
- [ ] 质量校验器是否需要（后续优化时可考虑）

---

## 目标 2：地图简化器

里程碑（详见 [docs/目标2-地图简化器.md](docs/目标2-地图简化器.md#7-实现里程碑)）：

- [x] **M1** Node 端碰撞解析 + 独立 HTML 预览页生成
- [x] **M2** 配色策略完善 + "空气墙"识别
- [x] **M3** 简化 map.bin 生成器（保留碰撞数据，去除视觉 props/材质，88% 压缩率）
- [x] **M4** Tampermonkey 用户脚本（劫持 map.bin 加载 + 识别地图 + 替换简化版）
- [ ] **M5** 核心算法模块化（三端共享）

### 额外完成功能

- **全部地图下载**：download-all.js 下载全部 27 张地图并批量生成简化版（27.4MB → 2.9MB，压缩率 10.4%）
- **简化地图库**：out/library/ 包含 7 张基础地图的简化 bin + library.json 清单
- **HTML 预览**：out/ 包含全部 27 张地图的碰撞预览 HTML（three.js + 6 色配色 + 空气墙高亮）

### goal2 分支提交历史（远程 origin/goal2）

| Commit | 说明 |
|---|---|---|
| `59a5972` | feat: 添加用户脚本 v1.14 — 拦截 texImage2D/createImageBitmap/Image.src/fetch/XHR，垂直渐变纹理，隐藏广告牌 |
| `62b9c11` | feat: 上传 out/ 目录（27张地图HTML预览 + library简化地图库） |
| `5b182ba` | feat: 下载全部27张地图并生成简化版（27.4MB→2.9MB，10.4%） |
| `70d46c5` | test: 添加全链路验证脚本 |
| `c49a4fb` | fix: 移除误提交到 goal2 的 goal1 文件 |
| `fc4b965` | feat: 实现油猴用户脚本（劫持map.bin加载+识别地图+替换简化版） ← M4 |
| `5578788` | feat: 实现本地地图库构建器（下载7张基础地图+生成简化库） ← 额外 |
| `bbeb31d` | feat: 实现简化map.bin生成器（保留碰撞数据，去除视觉props/材质） ← M3 |
| `d85bb62` | feat: 完成 M2 配色完善+空气墙识别算法+预览页高亮渲染 ← M2 |
| `489f962` | feat: 导入目标2已有代码（M1碰撞解析+HTML预览页生成） ← M1 |

### goal2 分支文件清单（79 文件，含生成的预览和简化地图）

```
goal2/
├── .gitignore                     排除 out/
├── HANDOFF.md                     交接文档
├── NOTE.md                        进度文档
├── simplify.js                    CLI 入口（本地路径/URL → HTML 预览）
├── build-library.js               本地地图库构建器（下载7张基础地图+生成简化库）
├── download-all.js                批量下载全部27张地图+生成简化版
├── map-simplifier.user.js         M4：油猴用户脚本
├── src/
│   ├── parseMapBin.js             解析库 + generateSimplifiedMapBin（372行）
│   └── generatePreview.js         HTML 预览生成器（three.js + 6色配色 + 空气墙高亮）
├── tools/
│   ├── analyze.js                 碰撞分析工具
│   └── verify-all.js              全链路验证脚本
├── out/
│   ├── library/                   7张基础地图简化bin + library.json
│   └── *.html                     27张地图碰撞预览（three.js）
└── simplified-maps/
    ├── manifest.json              简化地图清单
    └── *.bin                       全部27张简化地图
```

### 各里程碑详情

- **M1 ✅**：碰撞解析 + HTML 预览。Highland 样本：碰撞组1=5070 形状，碰撞组2=2748 形状，6875 props。
- **M2 ✅**：配色完善 + 空气墙识别算法 + 预览页高亮渲染。
- **M3 ✅**：简化 map.bin 生成器（generateSimplifiedMapBin），保留碰撞数据，去除视觉 props/材质，88% 压缩率。
- **M4 ✅**：油猴用户脚本（map-simplifier.user.js），劫持 map.bin 加载，用预构建的碰撞简化版替换原始地图。@grant none，用 localStorage 存储简化库。
- **额外**：build-library.js 本地地图库构建器，download-all.js 批量下载 27 张地图，压缩率 10.4%。
- **M5 ⬜**：核心算法模块化（三端共享），未开始。

### 目标 2 待定问题

- [x] ~~"空气墙"识别算法~~ → 已实现
- [x] ~~collisionData1 vs collisionData2 语义~~ → 已分析
- [x] ~~配色具体色值~~ → 已实现 6 色方案
- [x] ~~纯色材质写入~~ → 已绕过：保留碰撞+去除视觉
- [x] ~~type2 薄片盒厚度~~ → 硬编码 5 是渲染示意值
- [ ] type3 三角面片是否需聚合以提升性能 — M5 优化时考虑

---

## 目标 2.1：地图简化器 v1.15（纹理替换 + HSL 回退）

从 v1.14 迭代，自定义图片替换统一纹理 + HSL 颜色回退机制，隐藏广告牌。

### 文件

```
goal2.1/
└── map-simplifier-v1.15.user.js    用户脚本（869行，拦截 texImage2D/createImageBitmap/Image.src/fetch/XHR）
```

---

## 目标 2.2：碰撞叠加 v2.0（three.js 覆盖层）

全新方向：不再替换纹理，而是解析 map.bin 碰撞数据后用 three.js 叠加渲染在游戏画面上。

### 文件

```
goal2.2/
├── log-server.js                    日志服务器（4296行）
└── scripts/
    └── map-simplifier-v2.0.user.js  Tanki Collision Overlay v2.0（868行，Ctrl+Shift+C 切换，uniform discovery phase）
```

---

## 全局状态

- ✅ 目标 1：全部 5 个里程碑完成，代码在 `goal1/` 目录
- 🟨 目标 2：M1-M4 完成，M5 待做，代码在 `goal2/` 目录
- 🆕 目标 2.1：v1.15 用户脚本（纹理替换 + HSL 回退），代码在 `goal2.1/`
- 🆕 目标 2.2：v2.0 碰撞叠加（three.js 覆盖层 + log-server），代码在 `goal2.2/`
- ✅ 所有代码已合并到 `main` 分支，以文件夹区分（不再使用 goal1/goal2 分支）
- ℹ️ `goal1`/`goal2` 分支已废弃，代码已全部合入 `main`

---

## 变更日志

- 2026-07-26（初始）：初始仓库搭建，创建 goal1、goal2 分支
- 2026-07-26（第二~三次）：调研实现目录，子代理自主导入代码到分支
- 2026-07-26（第四次）：全量同步 goal1 最新代码（M3 验证通过，新增 5 文件）。确认 goal2 分支代码比实现目录更新。修复 goal2 分支的 goal1 文件污染。
- 2026-07-26（第五次）：goal1 完成 M4+M5（全部里程碑完成），推送到远程。goal2 完成全部 27 张地图下载和简化，已推送。本版本两份进度文档全面同步更新。
- 2026-07-31（第九次）：新增 goal2.1（v1.15 用户脚本：自定义图片替换+HSL回退）和 goal2.2（v2.0 碰撞叠加 three.js + log-server）