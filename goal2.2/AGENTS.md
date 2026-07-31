# AGENTS.md — goal2.2 碰撞叠加渲染用户脚本

为 Tanki Online 开发碰撞几何叠加渲染用户脚本：拦截游戏加载的 `map.bin`，解析 collisionData，把空气墙/碰撞体叠加绘制在游戏画面上。

## 项目结构

```
goal2.2/
├── scripts/                      # 用户脚本（版本化，新版本新建文件，不修改旧版）
│   ├── map-simplifier-v2.0.user.js   # 初始版：three.js WebGLRenderer 叠加层
│   ├── map-simplifier-v2.1.user.js   # 加入 uniform 发现/采样与相机捕获
│   ├── map-simplifier-v2.2.user.js   # 连续画布监控/DOM 存活/心跳/WebGL context 处理
│   ├── map-simplifier-v2.3.user.js   # 改为 2D Canvas（消除第二 WebGL context），相机捕获 hook
│   └── map-simplifier-v2.4.user.js   # 当前主力：单包装 hook + 双路径相机 + 包围球剔除 + 战斗退出检测
├── test/
│   ├── test-overlay.html         # 本地可视化测试页（本地浏览器打开 http://localhost:3457/）
│   └── verify-parse.js           # 解析回归测试（Node）
├── test-server.js                # 本地测试服务器，端口 3457
│                                 #   / → test/test-overlay.html
│                                 #   /map.bin → Highland 样本
├── log-server.js                 # 日志服务器，端口 3456（用户游戏测试时需先启动）
│                                 #   POST /log、GET /status；日志写 goal2.2/logs/
└── logs/                         # 游戏测试日志（collision-overlay-<时间戳>.log）
```

## 命令

```bash
# 语法验证 userscript
node -e "new Function(require('fs').readFileSync('goal2.2/scripts/map-simplifier-v2.4.user.js','utf8')); console.log('OK')"

# 解析回归测试（从 userscript 提取解析函数，解析 Highland map.bin）
node goal2.2/test/verify-parse.js [脚本路径] [map.bin 路径]

# 启动测试服务器（3457）
node goal2.2/test-server.js

# 启动日志服务器（3456，游戏测试前必须启动）
node goal2.2/log-server.js

# 检查日志服务器状态
curl http://localhost:3456/status
```

期望回归值（Highland map.bin，未压缩 flags=0x80）：
`collisionData1: t1=223 t2=929 t3=3918`，`collisionData2: t1=143 t2=864 t3=1741`，`props=6875`，首 type1 半尺寸 45/100/500。

## 代码约定

- 全部 ES5 风格（`var`/function），单一 IIFE 包裹，`@grant none`，`@run-at document-start`
- **版本管理规则**：修复/改进一律新建版本文件（v2.x），不改已有版本
- 解析函数段用标记注释 `// ═══ BinaryStream` ～ `// ═══ Collision color scheme` 包裹，供 verify-parse.js 提取（新版本改名需同步更新该脚本）
- 调试开关集中在脚本顶部：`FLIP_FORWARD` / `FLIP_SCREEN_Y` / `PROJ_IS_VP` / `SCALE` / `EST_FOV` / `STROKE_MIN_PX` / `CAM_FRESH_MS` / `M2W_MATCH_MS`
- 日志：console + `remoteLog` 双通道；远程日志默认发 `http://localhost:3456/log`
- 依赖：pako（解压）、three.js r128（仅矩阵数学，不用 WebGLRenderer）

## 任务进度

### 已完成
- [x] v2.0/v2.1/v2.2 交付并测试（v2.2 确认崩溃：第二 WebGL context 导致闪退）
- [x] v2.3 改为 2D Canvas 方案，交付测试：内容正确，但加载慢/帧率降/大小不对/方向不贴合/退出战斗残留/相机同步失败（可拖动=manual 模式生效，cameraReady=false）
- [x] 分析 v2.3 故障根因：WebGL2 双包装 hook、每帧 mat4 采样、每帧 getBoundingClientRect 强制 layout、无剔除
- [x] v2.4 编写完成（1236 行）：单包装 hook、双路径相机（mvp×modelToWorld⁻¹ 精确 VP / camera 向量+投影+FOV 估计）、包围球剔除、尺寸缓存、战斗退出检测（GL 新鲜度 2s + 画布可见性）、D 键 debugDump
- [x] v2.4 语法验证 OK；解析回归 OK（数值与期望一致）；verify-parse.js 建立
- [x] test-overlay.html 同步包围球剔除 + drawn 计数
- [x] 日志服务器已启动（端口 3456，2026-07-31 16:37）

### 待用户实测（2026-07-31 已交付 v2.4）
- [ ] 进战斗观察：状态面板 camera 行应为绿色 GAME (VP=...) 或 GAME (proj=...)
- [ ] 若 PARTIAL/FAILED：按 D 键发回 debugDump（重点：cameraState 六项 ✓/✗、pendingM2W/pendingMvp 配对情况、uniforms discovered 列表）
- [ ] 反馈：加载速度/帧率/地图大小/方向贴合/退出战斗是否自动消失

## 下一步（待用户测试反馈后）

1. 根据 v2.4 实测结果判定相机路径是否命中：
   - 若 `vpSource='mvp×m2w'` → 精确对齐，无需开关调试
   - 若走路径A（proj=...）→ 用 `FLIP_FORWARD`/`FLIP_SCREEN_Y`/`PROJ_IS_VP` 校正
   - 若六项全 ✗ → 用 D 键 dump 找真实 uniform 名（可能需扩展 onMat4Set/captureCameraUniform 名单）
2. 修正后出 v2.5（改动最小化，仅针对实测问题）
3. 若 map.bin 压缩（pako 路径）未在游戏实测过 → 需确认
4. 长期：把碰撞叠加与目标1/目标2 主流程整合
