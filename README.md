# TOandDDD

Tanki Online 地图工具开发仓库。基于对 [testanki1/testanki1.github.io](https://github.com/Testanki1/testanki1.github.io) 地图编辑器的逆向分析，实现两个目标。

> 本仓库只包含**自研代码与文档**，不收录游戏本体资源（建模/贴图等约 400MB 资产位于 `res.3dtank.com` CDN，运行时按需拉取）。

---

## 目标

### 目标 1：自然语言 → 地图的生成
用自然语言描述需求，自动生成可在编辑器/游戏中载入的 Tanki Online 地图（`map.bin`）。只组合游戏现有道具库，不创造新几何体。采用 LLM 理解层 + 过程化布局层 + 序列化层的三层架构。

详见 [docs/目标1-自然语言生成地图.md](docs/目标1-自然语言生成地图.md)

### 目标 2：地图简化器（脚本）：完整地图 → 碰撞结构的简化
输入完整地图，只渲染其碰撞几何（不加载贴图），用配色区分并把原本不可见的"空气墙"显示出来。既可实时预览，也可导出简化版地图。交付三端：Node 脚本 / 编辑器集成 / Tampermonkey 用户脚本。

详见 [docs/目标2-地图简化器.md](docs/目标2-地图简化器.md)

---

## 仓库结构

```
TOandDDD/
├── README.md                  # 本文件
├── AGENTS.md                  # 实现代理工作指南（命令、约定、流程）
├── PROGRESS.md                # 进度追踪（按目标/里程碑）
├── docs/                      # 目标细化文档
│   ├── 最终目标.md
│   ├── 目标1-自然语言生成地图.md
│   └── 目标2-地图简化器.md
├── reference/                 # 参考资料与分析
│   ├── editor-analysis.md     # 上游编辑器逆向分析
│   ├── resource-survey.md     # CDN 资源总量调研（~402MB）
│   └── measure.js             # 资源测量脚本（含 parseMapBin 的 Node 移植）
├── goal1/                     # 目标 1 实现（goal1 分支）
└── goal2/                     # 目标 2 实现（goal2 分支）
```

`goal1/` 与 `goal2/` 目录在各自的工作分支上填充，`main` 分支只保留协调骨架。

---

## 分支策略

| 分支 | 用途 |
|---|---|
| `main` | 协调主干，只含文档/骨架，保持稳定可读 |
| `goal1` | 目标 1（自然语言生成地图）的实现分支 |
| `goal2` | 目标 2（地图简化器）的实现分支 |

- 两个目标各自在独立分支上推进，避免互相冲突
- 里程碑完成后再合并回 `main`
- 详见 [AGENTS.md](AGENTS.md)

---

## 参考上游

本项目的格式知识、可复用代码均来自上游编辑器 `testanki1.github.io`（已克隆到本地 `E:\DDD\testanki1.github.io`，**不纳入本仓库**）。关键参考位置：

| 上游位置 | 内容 |
|---|---|
| `maps/editor.html` | 地图编辑器主体（单文件，3819 行） |
| `maps/maps.json` | 地图清单（CDN 资源 URL） |
| `maps/Re-collider.user.js` | 碰撞重生用户脚本 |
| `maps/Highland REMASTER Summer Evening/` | 完整地图样本（18MB） |

详见 [reference/editor-analysis.md](reference/editor-analysis.md)。

---

## 协作说明

本仓库由多个 agent 协作：
- **统筹 agent**（本会话）：负责仓库搭建、上传、推送、进度同步
- **目标 1 实现 agent**：在 `goal1` 分支工作
- **目标 2 实现 agent**：在 `goal2` 分支工作

实现 agent 请先阅读 [AGENTS.md](AGENTS.md) 了解工作流程与约定。
