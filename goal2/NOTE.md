# 地图简化器 — 进度文档

> 目标来源: `E:\DDD\目标2-地图简化器.md`
> 工作目录: `E:\DDD\地图简化器\`

---

## M1 完成 ✅ — Node 端碰撞解析 + HTML 预览页生成

### 交付物

| 文件 | 作用 |
|---|---|
| `src/parseMapBin.js` | Node 解析库：`BinaryStream` + `unwrapPacket` + `parseMapBin`（含**真实 readCols**，修正了 measure.js 的空壳 stub）+ 紧凑提取器 + `module.exports` |
| `src/generatePreview.js` | 独立 HTML 生成器：three.js CDN（importmap）+ 内嵌 JSON + 按类型/分组 6 色配色 + OrbitControls + 线框/props/网格切换 + FPS |
| `simplify.js` | CLI 入口：支持本地路径或 URL 输入、`--name`/`--out`/`--json`/`--stats` 选项 |
| `out/Highland Summer Evening.html` | 测试产物（2.0 MB），浏览器打开即看 |
| `out/Highland Summer Evening.json` | 碰撞数据 JSON 导出 |

### 测试结果（Highland REMASTER Summer Evening）

```
碰撞组 1:  Type1=223  Type2=929  Type3=3918  (小计 5070)
碰撞组 2:  Type1=143  Type2=864  Type3=1741  (小计 2748)
视觉 props: 6875    材质: 81    图集: 2
```

数据合理性已验证：坐标 ±15000 范围、π 旋转值、尺寸正值，与 Tanki 地图尺度吻合。

### 用法

```powershell
cd E:\DDD\地图简化器
node simplify.js "<map.bin 路径或 URL>" --name "地图名" --json
```

---

## 调研发现（影响后续里程碑）

### 规格书引用的代码位置全部准确
8 处引用（parseMapBin:1183 / readCols:1234 / createCollisions:1986 / BinaryStream:753 / generateMapBin:2642 / toggle-collision-btn:573 / FlyControls:614/1523）行号全部核对无误。

### 关键差异/坑位

1. **`propsStatic` 不存在**：editor.html 与 measure.js 中均无此字段；第 1288 行有个 28 字节/元素的未知数组被 skip，可能是该段但未解析。
2. **`generateMapBin` 始终写出空碰撞**（6 个 `writeStringLength(0)`），既不保留也不生成碰撞——是真正的"简化器"行为。
3. **`generateMapBin` 不支持纯色/无贴图材质**：只有 `TankiOnline/Terrain` 和 `TankiOnline/SingleTextureShader` 两种，均需贴图。M3 的"导出简化 map.bin"需新增纯色材质分支或生成 1×1 纯色贴图。
4. **type2 厚度硬编码 5**：数据中无厚度字段，导出时无法还原真实厚度。
5. **type3 的 meta(f1) 读取但未参与渲染**：简化时若要保留语义需自行处理。
6. **Re-collider.user.js 是 M4 的完美底座**：v2.4.2，fetch+XHR 双劫持已就位，`parseMapBin`+`generateMapBinLocal` 全链路已实现，最佳插入点在 1122 行或 1168 行。无 three.js，无 `@grant`（用 localStorage）。
7. **本地仅 1 份测试样本**：Highland Summer Evening（898KB map.bin + 7.3MB models.a3d）。更多样本需从 maps.json 所列 URL 下载。

---

## 后续里程碑（待启动）

| 里程碑 | 状态 | 说明 |
|---|---|---|
| **M1** Node 解析 + HTML 预览 | ✅ 完成 | 当前 |
| **M2** 配色完善 + 空气墙识别 | 待启动 | 需实测 collisionData 与 props 的空间对应关系 |
| **M3** 编辑器集成 + 导出简化 map.bin | 待启动 | 需解决纯色材质问题（见上 #3） |
| **M4** 用户脚本叠加渲染 | 待启动 | 基于 Re-collider.user.js，插入点已定位 |
| **M5** 核心算法模块化 | 待启动 | 三端共享同一解析/渲染核心 |

### M2 启动前的待定问题
- map.bin 中碰撞形状与 props 是否有显式对应关系？还是只能靠空间 proximity 判断？（需实测多个样本）
- collisionData1 vs collisionData2 的语义差异？（静态地形 vs 触发器？）
