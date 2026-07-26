# PROGRESS — 进度追踪

> 统筹 agent 维护本文件。实现 agent 完成里程碑后在此更新状态。

最后更新：2026-07-26 19:00（第四次更新，全量同步后）

---

## 总览

| 目标 | 分支 | 本地 HEAD | 状态 | 文件数 |
|---|---|---|---|---|
| 目标 1：自然语言 → 地图 | `goal1` | `45672d5` | 🟨 进行中（M1✅ M2✅ M3✅） | 20 |
| 目标 2：地图简化器 | `goal2` | `70d46c5` | 🟨 进行中（M1✅ M2✅ M3✅ M4✅） | 11 |

状态图例：⬜ 未开始 / 🟨 进行中 / ✅ 完成 / ⛔ 阻塞

> ✅ 两个目标的代码已纳入 TOandDDD 对应分支。所有推送由统筹 agent 统一执行。

---

## 目标 1：自然语言 → 地图的生成

里程碑（详见 [docs/目标1-自然语言生成地图.md](docs/目标1-自然语言生成地图.md#6-实现里程碑)）：

- [x] **M1** 道具库索引构建（解析 2 个 library.json → `library_index.json`）
- [x] **M2** map.bin 序列化器（Node 端，BinaryWriter 移植 + 往返校验）
- [x] **M3** 过程化布局层（参数 → props[]，对称/密度/避让）— ✅ 20/20 测试通过，端到端验证
- [ ] **M4** LLM 理解层（prompt 工程 + API 调用 + 端到端跑通）
- [ ] **M5** 集成与界面（输入框 + 生成 + 预览/下载）

### goal1 分支提交历史

| Commit | 说明 |
|---|---|
| `4c07305` | feat: 导入目标1已有代码（M1道具库索引 + M2序列化器 + M3布局层） |
| `45672d5` | feat: 同步 goal1 最新代码（M3验证通过+工具链+交接文档） |

### goal1 分支文件清单（20 文件）

```
goal1/
├── package.json                    ESM, 零依赖
├── README.md                       三层架构说明 + 里程碑清单
├── HANDOFF.md                      交接文档（M1-M3 完成状态 + 技术发现）
├── SKILL.md                        Skill 定义（Agent 理解层知识库）
├── src/
│   ├── binary-writer.js            BinaryStream/Writer + 封包解压/压缩
│   ├── parse-map-bin.js            parseMapBin 移植
│   ├── serialize-map-bin.js        serializeMapBin 移植（纯数据版）
│   ├── library-index.js            M1：下载解析 library.json，构建索引
│   └── layout.js                   M3：过程化布局层（参数→props[]）
├── test/
│   ├── verify-roundtrip.js         M2 往返测试（21/21 通过）
│   ├── verify-layout.js            M3 布局验证（20/20 通过）
│   ├── parse-real-map.js           真实 Highland map.bin 解析验证
│   └── probe-library.js            library.json 结构探查
├── tools/
│   ├── analyze-maps.js             批量下载+解析真实地图，提取布局模式
│   └── check-unknown.js            检查未知 prop 名称
└── data/
    ├── library_index.json          1146 props 完整索引
    ├── library_catalog.json        按语义类别分组的精简目录
    ├── map_references.json         真实地图布局参考数据
    └── cache/
        ├── main_library.json       Main Library 原始 JSON（1020 props）
        └── newyear_library.json    New Year Library 原始 JSON（126 props）
```

### 目标 1 待定问题（需用户决策）
- [ ] LLM 选型（GPT-4 / Claude / 本地模型？API key 来源？）— **阻塞 M4**
- [ ] 运行形态（独立网页 / 命令行 / 编辑器内？）— **阻塞 M5**
- [x] ~~道具分类粒度~~ → 已决策：用语义关键词分类（group.name 均为 null）
- [x] ~~地图坐标范围~~ → 已实测（Highland：x±260K, y±200K, z±43K）
- [x] ~~材质/matID 分配策略~~ → 已解决：SingleTextureShader + getDecimalPrefix 前缀
- [ ] 质量校验器是否需要

---

## 目标 2：地图简化器

里程碑（详见 [docs/目标2-地图简化器.md](docs/目标2-地图简化器.md#7-实现里程碑)）：

- [x] **M1** Node 端碰撞解析 + 独立 HTML 预览页生成
- [x] **M2** 配色策略完善 + "空气墙"识别
- [x] **M3** 简化 map.bin 生成器（保留碰撞数据，去除视觉 props/材质，88% 压缩率）
- [x] **M4** Tampermonkey 用户脚本（劫持 map.bin 加载 + 识别地图 + 替换简化版）
- [ ] **M5** 核心算法模块化（三端共享）

### goal2 分支提交历史

| Commit | 说明 |
|---|---|
| `489f962` | feat: 导入目标2已有代码（M1碰撞解析+HTML预览页生成） |
| `d85bb62` | feat: 完成 M2 配色完善+空气墙识别算法+预览页高亮渲染 |
| `bbeb31d` | feat: 实现简化map.bin生成器（保留碰撞数据，88%压缩率） |
| `5578788` | feat: 实现本地地图库构建器（下载7张基础地图+生成简化库） |
| `fc4b965` | feat: 实现油猴用户脚本（劫持map.bin加载+替换简化版） |
| `c49a4fb` | fix: 移除误提交到 goal2 的 goal1 文件 |
| `70d46c5` | test: 添加全链路验证脚本 |

### goal2 分支文件清单（11 文件）

```
goal2/
├── .gitignore                     排除 out/
├── HANDOFF.md                     交接文档
├── NOTE.md                        进度文档
├── simplify.js                    CLI 入口（本地路径/URL → HTML 预览）
├── build-library.js               本地地图库构建器（下载7张基础地图+生成简化库）
├── map-simplifier.user.js         M4：油猴用户脚本
├── src/
│   ├── parseMapBin.js             解析库 + generateSimplifiedMapBin（372行）
│   └── generatePreview.js         HTML 预览生成器（three.js + 6色配色 + 空气墙高亮）
└── tools/
    ├── analyze.js                 碰撞分析工具
    └── verify-all.js              全链路验证脚本
```

### 目标 2 待定问题
- [x] ~~"空气墙"识别算法~~ → 已实现
- [x] ~~collisionData1 vs collisionData2 语义~~ → 已分析
- [x] ~~配色具体色值~~ → 已实现 6 色方案
- [x] ~~纯色材质写入~~ → 已绕过：保留碰撞+去除视觉
- [x] ~~type2 薄片盒厚度~~ → 硬编码 5 是渲染示意值
- [ ] type3 三角面片是否需聚合以提升性能 — M5 优化时考虑

---

## 阻塞项

1. **[目标1] LLM 选型 + API key 来源** → 待用户决策，阻塞 M4
2. **[目标1] 运行形态** → 待用户决策，阻塞 M5
3. ~~[全局] 实现成果未版本化~~ → **已解决**

---

## 变更日志

- 2026-07-26（初始）：初始仓库搭建，创建 goal1、goal2 分支
- 2026-07-26（第二~三次）：调研实现目录，子代理自主导入代码到分支
- 2026-07-26（第四次）：全量同步 goal1 最新代码（M3 验证通过，新增 5 文件）。确认 goal2 分支代码比实现目录更新。准备统一推送所有分支。
