# AGENTS.md — goal2.1 地图简化器 v1.15（纹理替换方向）

> 本文件为 goal2.1 的**唯一进度真相源**。开始工作前先读本文件第 6/7 节。
> 最后更新：2026-07-31（探针重跑 3458 后）

---

## 1. 项目定位

goal2.1 是目标 2（地图简化器）的 **v1.15 迭代方向**：不替换整个 map.bin，而是用户脚本在浏览器里拦截游戏纹理加载（texImage2D / createImageBitmap / Image.src / fetch / XHR），把地图纹理替换为**用户上传的自定义图片**或 HSL 渐变回退，并隐藏广告牌（vegetation）。

平行方向（勿混淆）：
- `goal2/`（v1.14 及更早）：map.bin 简化器，脚本 `goal2\scripts\map-simplifier-v1.14.user.js` 与 `E:\DDD\v1.14.js` 逐字相同（670 行）——HSL 渐变 alpha 手段的对照基准
- `goal2.2/`（v2.0）：three.js 碰撞叠加覆盖层，独立方向

上游参考（只读，不纳入仓库）：`E:\DDD\testanki1.github.io`（maps/editor.html）。

---

## 2. 硬性规则（用户明确要求）

1. **每次修改必须新建脚本文件**（版本号递增），**禁止原地修改旧版本文件**。改出问题时回退到"复制上一版 + 重新应用改动"，绝不复用被污染的旧文件。
2. **不主动 git commit / push**，除非用户明确要求。
3. 文件位置固定：
   - 用户脚本 → `scripts\map-simplifier-v*.user.js`
   - 日志服务器 → goal2.1 根目录 `log-server*.js`
   - 日志 → `logs\map-simplifier-YYYYMMDD-HHMMSS.log`（服务器启动时创建，0 字节=没收到过 POST）
4. **端口占用现状（2026-07-31 实测，改动前必查 `Get-NetTCPConnection`）**：
   | 端口 | 占用进程 | 归属 | 用途 |
   |---|---|---|---|
   | 3456 | goal2.2\log-server.js | goal2.2 | collision overlay 日志，勿动 |
   | 3457 | goal2.2\test-server.js | goal2.2 | 本地测试服务器（只服务 GET 静态文件，POST 一律 404）**勿动** |
   | 3458 | goal2.1\log-server-3458.js | goal2.1 | 本方向日志服务器（log-server.js 的 3458 端口副本） |
5. 改完必须验证：
   - `node --check <file>` 语法
   - `Compare-Object` 新旧脚本逐行 diff，**确认差异仅预期行**（版本号/端口/URL 之类）
6. 无 lint / 无测试框架。验证手段 = 语法检查 + diff 核对 + 用户游戏内实测。
7. 日志双通道：`log()` = `console.log` + `remoteLog`（fetch POST 失败被静默吞掉）。**服务器没收到 = 浏览器控制台里仍有数据**，取数时优先让用户贴控制台。

---

## 3. 文件清单（scripts\）

| 文件 | 行数 | 状态 | 说明 |
|---|---|---|---|
| map-simplifier-v1.15.user.js | 869 | ✅ 基线 | v1.15.0：自定义图替换全部纹理 + HSL 回退 + 隐藏植被。已恢复为 v1.15.0 状态 |
| map-simplifier-v1.15.1.user.js | 884 | ✅ 保留 | 关键词隐藏修复（classifyMaterial 植被关键词、shouldHideTexture 短路修复、VEGETATION_PATTERN+elm、fetch VP 检查） |
| map-simplifier-v1.15.2.user.js | ~950 | ✅ 保留 | 512 最大尺寸 + alpha 烘焙（bakeAlphaCanvas，v1.15.4 的直系来源） |
| map-simplifier-v1.15.3.user.js | ~1100 | ❌ 废弃 | No-Tiling uniform 全局覆盖——**方案 A 失败**，勿复用其 hook 方式 |
| map-simplifier-v1.15.4.user.js | ~970 | ✅ **当前基线** | = v1.15.2 逐字副本（仅版本号），无 uniform hook。用户在用，**滑块控全局亮度问题待解** |
| map-simplifier-v1.15.4-discovery.user.js | 1092 | ✅ 探针 v1 | 只读 GL 探针，LOG_URL=3457（已无用，3457 被 goal2.2 占用） |
| map-simplifier-v1.15.4-discovery2.user.js | 1092 | ✅ **探针 v2** | 与 discovery 逐字相同，仅 VERSION + LOG_URL→3458。**待用户重跑取数** |

根目录：`log-server.js`（原版，PORT=3457，因端口被占已停用）、`log-server-3458.js`（现行，PORT=3458，`node log-server-3458.js` 启动）。

---

## 4. 版本史与关键决策

| 版本 | 改动 | 结果 |
|---|---|---|
| v1.14 | HSL 渐变，按材质类 alpha（object 0.20 / flat 0.15 / facade 0.10 / terrain 0.30） | 无立牌矩形（alpha 低所以不明显） |
| v1.15 | 自定义图替换全部纹理，无图回退 HSL | 立牌矩形显形 + 尺寸小像素明显 |
| v1.15.1 | 植被隐藏关键词修复 | 用户实测：矩形仍在、尺寸仍小 |
| v1.15.2 | 512 上限 + alpha 烘焙 + 滑块 | 用户实测：**地图一块块拼起来，小块重复** → 触发方案调研 |
| v1.15.3 | 全局 uniform 拦截改 tiling（方案 A） | **失败**：全局 hook 无 shader 区分，误伤爆炸/粒子特效、slider 变亮度控制、图案消失 |
| v1.15.4 | = v1.15.2 副本 | 用户实测：**滑块仍控全局亮度**（alpha=0 全图漆黑，玩家正常可见且被建筑遮挡） |
| discovery | 只读探针（linkProgram/getUniformLocation/uniformMatrix4fv/drawElements/drawArrays，WebGL1+2，2 秒采样窗） | 用户跑通（"第二部流程正常"），但 3457 被占 → 报告丢失 |
| discovery2 | 同上，LOG_URL→3458 | **待重跑** |

**用户已拍板的决策**（不要反悔）：
- 单图替换全部纹理；文件上传 → dataURL 存 localStorage（键 `Tanki_Simplified_CustomImg`）
- 无图时 HSL 渐变回退；vegetation（SpriteShader+关键词）隐藏返回透明 PNG
- 全局 alpha 滑块（默认 0.25，键 `Tanki_Simplified_CustomAlpha`），图像上限 512
- 保留 v1.15.1 关键词隐藏修复
- 最终目标：**从顶上看水平方向的图案拼成完整图片，竖直方向用相邻颜色填充** → 需 GPU 层按世界位置切 UV（探针判定后再实现）
- 探针流程：v1.15.3 的失败（方案 A "每面一整图"）已证明思路相反，改走"每 prop 取整图子区域"路线

---

## 5. 技术要点

- **拦截链路**：`textureInterceptionActive` 在 processMapBin 解析出 texName 后置 true；fetch 截获 map.bin（pako 解压）→ 解析 materials/texNames → 之后所有纹理 URL 匹配 texName 或 VEGETATION_PATTERN 的都被替换。
- **alpha 烘焙**（v1.15.4 行 233）：`bakeAlphaCanvas` 用 globalAlpha 把不透明源图烘焙成运行时 PNG。**副作用**：自定义图替换所有未隐藏纹理，alpha 变成全局不透明度 → 滑块看起来是"亮度控制"，alpha=0 全图透明露出虚空（此乃单图替换的固有性质，v1.15.5 改"仅动世界几何 UV"后绕开）。
- **v1.15.3 失败根因**：`getUniformLocation` hook 丢弃了 program，loc→name 全局映射无 shader 区分 → 特效/粒子 shader 全被改。教训：**hook 必须按 program 分类放行**。
- **探针报告判定标准**（world 类 program 的 `mat4['modelToWorldMatrix']` 或等价矩阵）：
  - `unique ≈ draws` → 每 prop 独立矩阵 → 按矩阵平移取世界 XY 切 UV **可行**
  - `unique == 1` 且 draws 巨大 → 静态合批，位置不在 uniform → 不可行，走备选（需用户再决策）
- **map.bin 实测数据**（16721 图）：99 materials 全部 SingleTextureShader、0 SpriteShader；3689 props；立牌罪魁 `grass_1`/`grass`/`bush1`/`grass_2`（被误归 object）；`elmvv512` 疑似漏网；分类 object:83 flat:2 facade:7 slope:5。
- 资源 URL 格式：`https://res.3dtank.com/<分片>/<prop>/<mat>/<texName>/map.bin`。

---

## 6. 当前进度（截至 2026-07-31 16:3x）

- ✅ v1.15.4 为安全基线（=v1.15.2 副本，已验证无 uniform hook）
- ✅ discovery2 + log-server-3458.js 已建好并启动（PID 31536，/status alive）
- ⚠️ **探针数据未取回**：discovery2 运行后 `logs\map-simplifier-20260731-162735.log` 仍是 **0 字节**（一个 POST 都没到）。上次 discovery 运行的控制台数据应仍在浏览器 F12 里（`[MS 1.15.4-discovery2]` 前缀）。
- ❌ 用户实测回传：v1.15.4 滑块控全局亮度（机制已确认，非崩溃 bug）
- ⛔ **当前阻塞**：无探针报告 → 无法判定"每 prop 独立矩阵"是否成立 → v1.15.5 无法开工

## 7. 下一步

1. 向用户要数据（按优先级）：
   a. 贴 F12 控制台 `[DISCOVERY]` 行（含 Step 8/9 标记，约 5-8 行）——最快
   b. 确认 Tampermonkey 启用的确实是 discovery2（旧的 discovery 发 3457 会打 goal2.2 test-server 被 404 吞）
   c. 确认 overlay 是否显示 `DISCOVERY: DONE`（一直 WAITING = map.bin fetch 未被截获，需强刷/关缓存）
2. 分析报告：按第 5 节判定标准分类世界 program
3. 可行 → 拟 v1.15.5：仅世界 shader、按 `modelToWorldMatrix` 平移取世界 XY → uvOffset/uvScale 映射整图子区域，竖直面相邻色纯色填充，UI/特效零接触（吸取 v1.15.3 教训：program 级判别）
4. 不可行 → 带证据回用户重新决策备选方案

---

## 8. 常用命令

```powershell
# 启动日志服务器（重跑探针前先确认 3458 空闲）
node log-server-3458.js

# 语法检查
node --check scripts\map-simplifier-v1.15.4-discovery2.user.js

# 新旧脚本差异核对（确认仅预期行）
$a = Get-Content scripts\map-simplifier-v1.15.4-discovery.user.js
$b = Get-Content scripts\map-simplifier-v1.15.4-discovery2.user.js
Compare-Object $a $b

# 端口占用
Get-NetTCPConnection -LocalPort 3456,3457,3458 | Select-Object LocalPort,State,OwningProcess

# 日志文件
Get-ChildItem logs -Filter "*.log"
```

---

## 9. 关联文件

- 仓库根 `AGENTS.md`（TOandDDD 根，统筹约定）、`PROGRESS.md`（**目标 2.1 一节已过时**，只记到 v1.15，未跟进 v1.15.x 系列）
- 对照基准：`E:\DDD\v1.14.js` / `goal2\scripts\map-simplifier-v1.14.user.js`
- 参考实现：`goal2.2\scripts\map-simplifier-v2.2.user.js`（UniformTracker 行 59-189，program 级 uniform 跟踪思路可借鉴，但注意其 hook 有区分、v1.15.3 没有）
