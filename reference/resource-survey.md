# CDN 资源总量调研

> 对 `res.3dtank.com` 上编辑器所需资源的测量结果（2026-07-26）。
> 测量脚本：[measure.js](measure.js)

---

## 测量方法

方案 D（混合估算，实际执行）：
1. 解析本地 `maps.json`（27 张地图 + 2 个共享库 URL）
2. **下载并解析**（仅元数据，约 28MB）：
   - 2 个 `library.json`（~350KB）→ 枚举库内全部 `mesh.file`(.a3d) 与 `mesh.textures.diffuseMap`(.webp)
   - 26 个 `map.bin`（去重后 26，~23MB）→ 移植 `parseMapBin` 解析 atlases/materials/props
   - 26 个 `lightmapdata`（~1.6MB）→ 移植 `parseLightmapData` 解析光照贴图名
3. 按 `getBaseUrl(libName)` 规则 + 编辑器的 libBase→mapBase 回退，构造全部资源 URL 去重
4. 对 2987 个唯一 URL 发 HEAD（失败再 Range GET 取头），并发 10，累加 `Content-Length`

**未下载任何资源本体**（.a3d/.webp），只读响应头。

---

## 测量结果

**总量：约 402 MB**（精确 421,848,873 字节，跨 1244 个真实存在的文件）

### 按类别

| 类别 | 文件数 | 体积 | 缺失 |
|---|---:|---:|---:|
| lightmap（光照贴图 .webp）| 45 | 118.97 MB | 0 |
| atlas（图集 .webp）| 59 | 104.45 MB | 0 |
| map-model（地图本地 models.a3d）| 11 | 80.86 MB | 0 |
| lib-model（共享库 .a3d）| 774 | 35.59 MB | 3 |
| map.bin（地图数据）| 26 | 25.80 MB | 0 |
| lib-texture（共享库贴图 .webp）| 221 | 22.40 MB | 0 |
| mat-texture（材质贴图 .webp）| 1825 | 12.58 MB | 1740 |
| lightmapdata（光照元数据）| 26 | 1.66 MB | 0 |
| **合计** | **1244** | **402.31 MB** | 1743 |

### 按地图分组

| 分组 | 体积 |
|---|---:|
| Main Library Maps（Sandbox/Forest/Sandal + 共享库资产）| 192.02 MB |
| Maps Without Specific Library（Highland/Cross/Parma，各带本地 models.a3d）| 191.26 MB |
| New Year Library Map（新年库 + 1 张图）| 19.02 MB |

### Top 10 最大文件

| 体积 | 类型 | URL |
|---|---|---|
| 8.54 MB | map-model | .../371/133/31656237623140/models.a3d |
| 8.50 MB | map-model | .../371/130/31656237623152/models.a3d |
| 8.50 MB | map-model | .../371/146/31656237623143/models.a3d |
| 7.37 MB | map-model | .../371/136/31656237623161/models.a3d |
| 7.15 MB | map-model | .../371/104/31656237623400/models.a3d |
| 7.11 MB | map-model | .../371/107/31656237623367/models.a3d |
| 7.10 MB | map-model | .../371/121/31656237623231/models.a3d |
| 6.98 MB | map-model | .../371/116/31656237623240/models.a3d |
| 6.98 MB | map-model | .../371/160/31656237625001/models.a3d |
| 6.92 MB | map-model | .../371/112/31656237623407/models.a3d |

---

## 关于 1743 个"缺失"

- **1740 个是 mat-texture 404**：`map.bin` 材质里引用、但已**烘焙进 atlas**（不再作为独立文件存在）的贴图名。编辑器的 `loadTextureDirect` 遇 404 静默跳过——脚本行为一致。已抽样到共享库目录二次确认，同样 404，证实确实不存在。
- **3 个是 lib-model 404**：库清单里个别 `.a3d` 文件名已失效，影响可忽略。
- 这些 404 **不贡献体积**，所以 402 MB 不含水分。

---

## 单张地图实际下载量（参考）

编辑器按需加载，一次只载一张图：
- **无库地图**（Highland/Cross/Parma）：`map.bin`+`models.a3d`+`atlas`+`lightmap`+地形贴图 ≈ **15–18 MB/张**
- **有库地图**（Sandbox 等）：首张需下载共享库资产（~58 MB），之后同库其他图只需 **8–10 MB/张**

---

## 对两个目标的意义

- **目标 1（生成）**：只需引用库内 prop 名 + matID，不需要下载任何资源本体；生成的 map.bin 体积小（类似现有 26 个 map.bin，平均 ~1MB）
- **目标 2（简化器）**：只需 `map.bin`（平均 ~1MB）即可解析碰撞，**完全不需要** 400MB 贴图/.a3d 视觉资源——这正是"简化"的核心价值
