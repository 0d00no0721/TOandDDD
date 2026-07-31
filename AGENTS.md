# AGENTS.md — 仓库内部协作指南

> 本文件是 `E:\DDD\AGENTS.md`（会话级协作协议，含"同步进度"/"推送代码"规则、代理坑、目录结构）的仓库内补充。进入本仓库工作前先读根目录那份。

---

## 1. 本仓库是什么

Tanki Online 地图工具项目，全部代码在 `main` 分支，以文件夹区分目标（**分支策略已废弃**，见根 AGENTS.md §1）：

- `goal1/` — 自然语言 → 地图生成器（M1-M5 全部完成）。注意：**日常开发在 `E:\DDD\map-generator\`**，本目录是快照，可能落后；开发新功能先同步快照再改，或改完 map-generator 后同步回来。
- `goal2/` — 地图简化器（M1-M4 完成，M5 未开始）。核心：`simplify.js` + `src/parseMapBin.js` + `src/generatePreview.js`。
- `goal2.1/`、`goal2.2/` — 用户直接在此迭代脚本（v1.15 系 / v2 系），未跟踪文件常见，别随意清理。
- `docs/` — 三份目标规格书（最终目标/目标1/目标2）。`reference/` — 上游逆向分析。`PROGRESS.md` — 进度（只读，更新看根 AGENTS.md §0）。

## 2. 各目标验证方式

- **goal1**（在 `E:\DDD\map-generator\` 下执行）：`npm test` = M2+M3+M4+M5 四组；单项 `npm run test:m2|m3|m4|m5`。生成地图 `node src/generate.js "描述"`。**零 npm 依赖**，Node >= 18。
- **goal2**：`node goal2/simplify.js <map.bin路径> --name xxx` 生成 HTML 预览。测试样本在 `E:\DDD\testanki1.github.io\maps\Highland REMASTER Summer Evening\map.bin`。
- **goal2.1/2.2**：用户脚本（Tampermonkey），无自动化测试；日志服务器 `log-server.js` 运行时会写 `logs/`。

## 3. 本仓库特有约定

- **提交**：中文，`feat:/fix:/docs:/test:/chore:` 前缀。只推 `main`（不带 proxy 参数）。
- **不要**在已废弃的 `goal1`/`goal2` 分支上提交（本地/远程分支仍在，但内容已合入 main）。
- **.gitignore**：根屏蔽 `*.bin` 等；`goal1/.gitignore` 用 `!*.bin` 反选放行输出。新增需要提交 bin 的目录参照此模式。
- **代码风格**：原生 JS + three.js，零依赖；移植代码保留 `editor.html:行号` 注释（上游文件在 `E:\DDD\testanki1.github.io\maps\editor.html`，不纳入仓库）。
- 不提交秘密与大文件（.a3d/.webp/原始 map.bin）。
