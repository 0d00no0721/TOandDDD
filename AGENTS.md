# AGENTS.md — 实现代理工作指南

本文件给负责实现两个目标的 agent 阅读。统筹 agent 负责仓库管理，不参与具体实现。

---

## 1. 开始工作前

### 1.1 阅读顺序
1. [README.md](README.md) —— 了解项目全貌
2. [docs/最终目标.md](docs/最终目标.md) —— 两个目标的概述
3. 你负责的目标文档：
   - 目标 1 → [docs/目标1-自然语言生成地图.md](docs/目标1-自然语言生成地图.md)
   - 目标 2 → [docs/目标2-地图简化器.md](docs/目标2-地图简化器.md)
4. [reference/editor-analysis.md](reference/editor-analysis.md) —— 上游编辑器逆向分析（含 `file:line` 引用）
5. 本文件余下部分

### 1.2 上游代码位置
上游编辑器已克隆到本地 `E:\DDD\testanki1.github.io`（**不纳入本仓库**，只作参考）。所有 `editor.html:行号` 形式的引用都指向该目录下的 `maps/editor.html`。

可复用的关键代码：
- `BinaryStream` / `BinaryWriter` —— `editor.html:753 / 790`
- `parseMapBin` / `readCols` —— `editor.html:1183 / 1234`
- `createCollisions` —— `editor.html:1986`（碰撞→three.js 几何）
- `generateMapBin` —— `editor.html:2642`（map.bin 写入）
- `parseA3D` —— `editor.html:891`
- `parseLightmapData` —— `editor.html:1317`

Node 移植版（已验证可用）：[reference/measure.js](reference/measure.js)，含 `BinaryStream` / `unwrapPacket` / `parseMapBin` / `parseLightmapData`。

### 1.3 本地测试数据
- 完整地图样本：`E:\DDD\testanki1.github.io\maps\Highland REMASTER Summer Evening\`（18MB，含 `map.bin` / `models.a3d` / 贴图 / `meta.info`）
- 地图清单：`E:\DDD\testanki1.github.io\maps\maps.json`
- CDN 资源可从 `http://res.3dtank.com/<分片ID>/文件名` 拉取（注意 `https://` 会被 301 降级到 `http://`）

---

## 2. 分支与提交约定

### 2.1 你的工作分支
- 目标 1 agent → 在 `goal1` 分支工作，代码放 `goal1/` 目录
- 目标 2 agent → 在 `goal2` 分支工作，代码放 `goal2/` 目录

**不要在 `main` 分支上写实现代码。** `main` 只含协调骨架。

### 2.2 提交信息
用中文简述，符合以下格式：
```
<类型>: <简述>

<可选的详细说明>
```
类型：`feat`（新功能）/ `fix`（修复）/ `refactor`（重构）/ `docs`（文档）/ `test`（测试）/ `chore`（杂项）

例：
```
feat: 完成 map.bin 序列化器 Node 移植
fix: 修正 OBB 旋转轴顺序（ZYX → XYZ）
docs: 补充碰撞形状语义说明
```

### 2.3 推送
- 直接 push 到你的工作分支（`goal1` 或 `goal2`）
- **不要 force push**，除非明确需要并提前沟通
- 里程碑完成时在 [PROGRESS.md](PROGRESS.md) 更新状态

---

## 3. 命令

### 3.1 测试 / 校验
目前无统一测试框架。各目标按需自建测试。建议：
- 目标 1：写出的 `map.bin` 必须能被 `parseMapBin` 读回（往返校验）
- 目标 2：生成的预览 HTML 用本地 Highland 样本的 `map.bin` 测试

```bash
# Node 运行脚本
node <your-script.js>

# 校验 map.bin 往返（目标1）
node <your-roundtrip-test.js>
```

### 3.2 Lint / 类型检查
当前无配置。如引入 lint，请把命令写到这里并通知统筹 agent。

---

## 4. 代码约定

- **语言**：Node.js（服务端）/ 浏览器 JS（编辑器集成、用户脚本）
- **不引入框架**：保持轻量，与上游编辑器风格一致（原生 JS + three.js）
- **复用优先**：上游已有的解析/写入逻辑尽量移植复用，不重写
- **注释**：仅在复杂逻辑处加注释；移植代码保留原始 `editor.html:行号` 引用便于核对
- **不提交秘密**：API key、凭据等放本地配置或环境变量，不进仓库
- **不提交大文件**：游戏资源（.a3d/.webp/map.bin）不纳入仓库，运行时从 CDN 或本地样本读取

---

## 5. 进度同步

- 每完成一个里程碑，更新 [PROGRESS.md](PROGRESS.md) 中对应项的状态（`[ ]` → `[x]`）并提交
- 遇到待定问题（各目标文档第 8 节列出）需要决策时，在 PROGRESS.md 的"阻塞项"区域登记，由统筹 agent 协调用户决策
- 不要自行修改对方目标分支的文件

---

## 6. 目录布局建议

各目标目录内部结构由实现 agent 自行决定，建议：
```
goal1/
├── src/          # 源码
├── test/         # 测试
├── README.md     # 该目标的使用说明
└── ...
```
