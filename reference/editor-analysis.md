# 上游编辑器逆向分析

> 对 `testanki1.github.io` 仓库 `maps/` 目录的逆向分析结果。供本仓库两个目标的实现 agent 参考。
> 上游本地路径：`E:\DDD\testanki1.github.io\maps\`（不纳入本仓库）

---

## 1. 仓库概况

`testanki1.github.io` 是面向《Tanki Online（3D坦克）》中国玩家社区的 GitHub Pages 站点，作者 Testanki。其中 `maps/` 目录是一个网页地图编辑器（"Tanki Online Map Editor. Remaster"）。

`maps/` 目录内容：
| 文件 | 说明 |
|---|---|
| `editor.html` | 编辑器主体，单文件 3819 行（约 200KB），含全部 HTML/CSS/JS |
| `maps.json` | 地图清单，27 张地图 + 2 个共享库的 CDN URL |
| `Re-collider.user.js` | Tampermonkey 用户脚本（75KB），碰撞重生 + 离线模式 |
| `Map Edit & Re-collider.user.js` | 上述的增强版（383KB） |
| `special/collision-regenerate.html` | 碰撞重生变体 |
| `special/glb-export.html` | GLB 导出变体（Tanki → GLB 单向） |
| `special/test.html` | 测试变体（含 type3 碰撞重生逻辑） |
| `Highland REMASTER Summer Evening/` | 完整地图样本（18MB，14 文件） |

---

## 2. editor.html 代码结构

| 行范围 | 内容 |
|---|---|
| 1–490 | `<head>` + 内联 `<style>`（Material 3 暗色主题） |
| 491–498 | importmap：从 jsdelivr 加载 `three` 及 `three/addons/` |
| 500–611 | `<body>`：UI（地图列表、Props 列表、浮动工具栏、右键菜单、对话框、画布） |
| 612–3819 | 内联 `<script type="module">`：全部 JS 逻辑 |

外部依赖：
- `jszip.min.js`（cdnjs，第 9 行）
- `three.js` + addons（FlyControls、EffectComposer/RenderPass/SSAOPass/OutputPass/UnrealBloomPass、RoomEnvironment、Timer）

---

## 3. 关键函数索引

### 二进制读写
- `BinaryStream` 类（`editor.html:753`）—— 读 uint8/16/32、int32、float32/64、长度前缀字符串
- `BinaryWriter` 类（`editor.html:790`）—— 对应的写入器
- `unwrapPacket`（`editor.html:829`）—— 解包（含可选 zlib 解压）
- `wrapPacketCompressed`（`editor.html:871`）—— 压缩封包
- `packHeader`（`editor.html:845`）—— 可选位掩码头
- `decompressZlib`（`editor.html:821`）—— deflate 解压

### 解析
- `parseMapBin`（`editor.html:1183`）—— **map.bin 解析**，输出 `{props[], materials{}, atlases{}, collisionData1, collisionData2}`
- `parseA3D`（`editor.html:891`）—— **.a3d 模型解析**（Alternativa3D 私有格式）
- `parseLightmapData`（`editor.html:1317`）—— 光照贴图元数据解析

### 写入
- `generateMapBin`（`editor.html:2642`）—— **map.bin 写入**（编辑器导出用）
- `exportOptimizedA3D`（`editor.html:1085`）—— .a3d 写入

### 加载
- `loadMapLibrary`（`editor.html:2533`）—— 加载一张地图（map.bin + lightmapdata + library.json）
- `processMap`（`editor.html:1848`）—— 核心，构建 three.js 场景（约 600 行）
- `getPropDict`（`editor.html:1761`）—— 解析 library.json 建 prop 字典
- `loadTextureDirect`（`editor.html:1725`）—— 加载贴图（.webp）

### 碰撞
- `readCols`（`editor.html:1234`，在 `parseMapBin` 内）—— 读碰撞数据
- `createCollisions`（`editor.html:1986`）—— **碰撞 → three.js 几何渲染**（语义权威）

### 其他
- `getBaseUrl`（`editor.html:1855`）—— 根据 libName 选 baseUrl（libBase 或 mapBase）
- `getDecimalPrefix`（`editor.html:2627`）—— 导出时给文件名加前缀
- `autoCropAtlas`（`editor.html:3225`）—— 图集裁切
- `setupUIEvents`（`editor.html:2902`）—— UI 事件绑定

---

## 4. map.bin 格式（来自 parseMapBin:1183）

```
包封装: unwrapPacket (可选 zlib)
  ├─ flags + 可选位掩码 (fullOriginalBits → optMask → popBit())
  ├─ [位1] atlases[]: { height, name, unknown, rects[]{height,lib,name,w,x,y}, width }
  ├─ [位2] 未知对象数组
  ├─ collisionData1 = readCols():  shapesType1[] + shapesType2[] + shapesType3[]
  ├─ collisionData2 = readCols():  同上
  ├─ materials[]: { matID, name, shader, texParams[]{libName, name, texName} }
  ├─ [位] 未知对象数组
  └─ props[]: { grpName, id, libName, matID, name, pos[3], rot[3], scale[3] }
```

`readStringLength`（`editor.html:766`）变长整数：
- 高位 0：`flags & 0x7F`
- 高位 10：`(flags & 0x3F) << 8 + nextByte`
- 高位 11：`(flags & 0x3F) << 16 + nextUint16(BE)`

`unwrapPacket` 头（`editor.html:829`）：
- bit7=0：`len = nextByte + (flags & 0x3F) << 8`
- bit7=1：`len = (b1<<16)|(b2<<8)|b3 + (flags & 0x3F) * 16777216`
- bit6=1：payload 是 zlib(deflate) 压缩

---

## 5. 碰撞形状语义（来自 createCollisions:1986）

| 类型 | 几何 | 数据布局 | 渲染 |
|---|---|---|---|
| **type1** | OBB 有向包围盒 | `pos(3)+rot(3)+size(3)` = 9×f32 | `BoxGeometry(d[6],d[7],d[8])` 于 `(d[0],d[1],d[2])` 旋转 `(d[3],d[4],d[5])` ZYX |
| **type2** | 薄片盒（墙/地面） | `length(f64)+pos(3)+rot(3)+width(f64)` | `BoxGeometry(width, length, 5)` 厚度硬编码 5 |
| **type3** | 三角面片（每条=1三角形） | `meta(f64)+pos(3)+rot(3)+3顶点(9×f32)` | 3 顶点 BufferGeometry，DoubleSide |

- `collisionData1` 渲染为红 `0xFF3333`（`editor.html:2032`）
- `collisionData2` 渲染为绿 `0x33FF33`（`editor.html:2033`）
- 两组渲染方式相同，似为两个碰撞层

**导出时碰撞被清零**：`generateMapBin:2785-2786` 写六个 `writeStringLength(0)`（两组 × 三类型 = 全空）。
对比：`special/test.html:2905-2963` 有从 prop 几何重生 type3 三角碰撞的逻辑。

---

## 6. 资源加载机制

编辑器**不打包资源**，运行时从 `res.3dtank.com` CDN 拉取：
1. `maps.json` 给出 `map.bin` URL 和 `library.json` URL
2. `baseUrl = url.substring(0, url.lastIndexOf('/'))`
3. `libraryBaseUrl = libraryJsonUrl 去最后一段`
4. 对每个 prop：`libName ? libraryBaseUrl : mapBaseUrl` 作为 baseUrl（`getBaseUrl:1855`）
5. 模型：`${baseUrl}/${mesh.file 或 'models.a3d'}`
6. 贴图：`${baseUrl}/${texName}.webp`（材质贴图有 libBase→mapBase 回退，`editor.html:1913-1915`）
7. 光照贴图：`${mapBaseUrl}/${lmName}.webp`（来自 lightmapdata）

CDN 行为：`https://res.3dtank.com/` 根路径返回 1 字节空白；具体资源路径正常返回；`https://` 会被 301 降级到 `http://`。

---

## 7. 现有"导入"能力

**仅支持 Tanki 原生格式 ZIP**（`editor.html:524` `accept=".zip,.bin"`）：
- ZIP 内含 `map.bin` + `models.a3d` + 若干 `.webp/.png/.jpg`
- 解压后存入 `rawFileCache`，走与远程相同的渲染管线

**无任何外部 3D 格式导入**：全 `maps/` 目录无 `GLTFLoader`/`OBJLoader`/`FBXLoader`。`glb-export.html` 只有 `GLTFExporter`（Tanki → GLB 单向导出）。

---

## 8. 用户脚本（Re-collider.user.js）

- Tampermonkey 脚本，`@match *://*.tankionline.com/play*` 等游戏客户端
- 劫持 `window.fetch`（`:1212`）和 `WebSocket`（`:24-72`）拦截地图加载
- `generateMapBinLocal`（`:1054`）：**暴力逐三角形复制**生成碰撞（只产出 type3，无简化）
  - 对每个 prop 加载 `.a3d`，迭代每个三角形，emit 一条 type3
  - `parseA3DSimple`（`:857`）bakes 每个_mesh 的 transform 到顶点
  - `Settings.isModelFiltered()`（`:1074`）排除植被（bush/flower/grass/bd）
- 把新碰撞字节 splice 进原 packet，blob URL 替换原 map.bin

---

## 9. Node 移植版

`reference/measure.js` 已含可在 Node 直接运行的：
- `BinaryStream`（Buffer 版）
- `unwrapPacket`（用 `zlib.inflateSync`）
- `parseMapBin`（完整移植）
- `parseLightmapData`
- HTTP fetch / HEAD 工具

已验证可正确解析 26 个 CDN 上的 map.bin。实现 agent 可直接复用。
