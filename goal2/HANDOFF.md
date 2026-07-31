# HANDOFF — 地图简化器项目交接

> 给接替的 agent：请先读这份文档，再读 `PROGRESS.md`（更详细的调研记录）。
> 目标规格书：`E:\DDD\目标2-地图简化器.md`
> 工作目录：`E:\DDD\地图简化器\`

---

## 一句话现状

**M1 已完成并验证**：Node 端能解析 map.bin 的碰撞数据，生成独立 HTML 预览页（浏览器打开即看彩色碰撞视图）。M2–M5 未启动。

---

## 文件结构

```
E:\DDD\地图简化器\
├─ HANDOFF.md            ← 你正在读这份
├─ PROGRESS.md           ← 详细进度 + 调研发现（必读）
├─ simplify.js           ← CLI 入口
├─ src\
│   ├─ parseMapBin.js    ← Node 解析库（BinaryStream+unwrapPacket+parseMapBin+真实readCols）
│   └─ generatePreview.js← HTML 预览页生成器（three.js CDN + 6色配色）
├─ tools\                ← 空，预留给后续工具
└─ out\
    ├─ Highland Summer Evening.html   ← M1 测试产物（2.0 MB，可直接打开看）
    └─ Highland Summer Evening.json   ← 碰撞数据 JSON
```

---

## 快速验证 M1 仍能跑

```powershell
cd E:\DDD\地图简化器
node simplify.js "E:\DDD\testanki1.github.io\maps\Highland REMASTER Summer Evening\map.bin" --name "Highland Summer Evening"
```

预期输出：碰撞组1 = 5070 形状，碰撞组2 = 2748 形状，props = 6875。生成 `out\Highland Summer Evening.html`。

无需 npm install，纯 Node 标准库（zlib/fs/path/http/https）。

---

## 关键已知坑位（避免重复踩坑）

1. **`Temp\opencode\measure.js` 的 readCols 是空壳 stub**（读出浮点数全丢弃）。我已在 `src/parseMapBin.js` 重写为真实读取。不要再回退用 measure.js。
2. **`propsStatic` 不存在**：editor.html 与 measure.js 中均无此字段；第 1288 行有个 28 字节/元素的未知数组被 skip，可能是它但未解析。
3. **`generateMapBin`（editor.html:2642）始终写出空碰撞**且**不支持纯色材质**。M3 导出简化 map.bin 时需新增纯色材质分支或生成 1×1 纯色贴图。
4. **type2 厚度硬编码 5**：数据中无厚度字段，导出无法还原真实厚度。
5. **type3 的 meta(f1) 读取但未参与渲染**。
6. **字节序**：map.bin 全大端，A3D/光照贴图小端。`BinaryStream` 方法默认 `le=false`（大端）。
7. **本地仅 1 份测试样本**：Highland Summer Evening（898KB map.bin）。更多样本需从 `E:\DDD\testanki1.github.io\maps\maps.json` 所列 URL 下载。

---

## 关键代码位置（规格书引用已全部核对准确）

| 资源 | 位置 |
|---|---|
| parseMapBin | `editor.html:1183-1308` |
| readCols | `editor.html:1234-1260`（定义）+ 1261-1262（调用）|
| createCollisions | `editor.html:1986-2030` |
| BinaryStream/BinaryWriter | `editor.html:753-788 / 790-819` |
| generateMapBin | `editor.html:2642-2833`（材质 2723-2775，碰撞 2785-2786 恒空）|
| toggle-collision-btn | `editor.html:573-575`（仅切换可见性，点击处理 3057-3065）|
| FlyControls | `editor.html:614` import / `1523` 实例化 |
| Re-collider.user.js | `maps/Re-collider.user.js` v2.4.2，1262 行，fetch劫持 1212，XHR 1232，parseMapBin 971，generateMapBinLocal 1054，最佳插入点 1122 或 1168 |

---

## 下一步：M2（配色完善 + 空气墙识别）

规格书 §8 列的待定问题，M2 启动前需先实测：

1. **碰撞 vs props 对应关系**：map.bin 中是否有显式对应？还是只能靠空间 proximity（位置/包围盒邻近度）判断？
   - 建议先用 Highland 样本做实验：`out/Highland Summer Evening.json` 已有碰撞数据，props 数据可在 simplify.js 加 `--props-json` 导出，然后写脚本分析每个碰撞形状中心到最近 prop 的距离分布。
2. **collisionData1 vs collisionData2 语义**：两组碰撞分别代表什么？（静态地形 vs 触发器？主碰撞 vs 辅助？）
   - 建议：对比两组的空间分布、形状类型比例、与 props 的邻近度差异。

### M2 交付目标
- 在 `generatePreview.js` 增加"空气墙"高亮（半透明线框，区别于实心碰撞）
- 按类型/分组/空气墙三维配色
- 验证：对比 editor.html 现有红绿视图，确认识别正确

### M3–M5 概要
- **M3**：编辑器集成（扩展 createCollisions 配色 + 改造 toggle-collision-btn + 加导出简化 map.bin）。卡点：纯色材质（见坑位 #3）。
- **M4**：用户脚本（基于 Re-collider.user.js，插入点 1122/1168，注入 three.js 叠加渲染）。注意 `@grant none`，用 localStorage。
- **M5**：把 src/parseMapBin.js 抽成三端共享核心（Node/编辑器/用户脚本）。

---

## 注意事项

- 工作目录在 `E:\DDD\地图简化器\`，目标规格书在 `E:\DDD\目标2-地图简化器.md`，测试样本在 `E:\DDD\testanki1.github.io\maps\Highland REMASTER Summer Evening\`。
- 代码风格：无注释（除非用户要求），单引号，2 空格缩进，与现有 src/ 文件一致。
- 完成任务后用 bash 验证（运行 simplify.js 测试），不要假设结果。
