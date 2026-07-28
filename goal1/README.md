# Tanki Online 自然语言地图生成器

实现 `目标1-自然语言生成地图.md`：用自然语言描述需求，自动生成可在编辑器/游戏中载入的 Tanki Online `map.bin`。

## 架构（三层）

```
自然语言 → [层1 LLM理解层] → 高层参数 JSON
         → [层2 过程化布局层] → props[] 布局
         → [层3 序列化层] → map.bin
```

## 目录结构

```
map-generator/
├── src/
│   ├── binary-writer.js     # BinaryStream/BinaryWriter/packHeader/wrapPacketCompressed（Node zlib 版）
│   ├── parse-map-bin.js     # parseMapBin 移植（解析 map.bin，用于验证）
│   ├── serialize-map-bin.js # generateMapBin 纯数据版（无 three.js 依赖）
│   ├── library-index.js     # M1: 下载解析 library.json，构建 prop 索引
│   ├── layout.js            # M3: 过程化布局层（参数 → props[]）
│   ├── llm-layer.js         # M4: LLM 理解层（prompt + API 调用）
│   └── generate.js          # 端到端入口
├── data/
│   ├── cache/               # 下载的 library.json 缓存
│   └── library_index.json   # M1 输出的精简目录
├── output/                  # 生成的 map.bin
└── test/
    └── verify-roundtrip.js  # 验证：序列化后能被 parseMapBin 读回
```

## 里程碑

- [x] **M1 道具库索引**：`library-index.js` 下载并解析 2 个 library.json（1146 props，6 语义类别）
- [x] **M2 序列化层**：`binary-writer.js` + `parse-map-bin.js` + `serialize-map-bin.js`（21/21 往返测试通过）
- [x] **M3 过程化布局层**：`layout.js`（20/20 端到端测试通过）
- [x] **M4 LLM 理解层**：`llm-layer.js`（多提供商 + 离线模式）
- [x] **M5 CLI 集成界面**：`generate.js`（端到端 CLI 入口）

## 复用来源

二进制读写、压缩封装、map.bin 解析/生成逻辑全部移植自 `testanki1.github.io/maps/editor.html`：
- `BinaryStream` / `BinaryWriter` (editor.html:753 / 790)
- `packHeader` / `wrapPacketCompressed` / `unwrapPacket` (editor.html:845 / 871 / 829)
- `parseMapBin` (editor.html:1183)
- `generateMapBin` (editor.html:2642)

## 使用

```bash
# 构建 prop 索引（首次运行，需联网下载 library.json）
node src/library-index.js

# 离线模式（无需 LLM，用默认参数）
node src/generate.js "两座对称山丘" --no-llm

# 使用 OpenAI
export OPENAI_API_KEY=sk-xxx
node src/generate.js "工业仓库大图" --provider openai --model gpt-4o-mini

# 使用本地模型（Ollama）
node src/generate.js "雪地小图" --provider local --model llama3 --base-url http://localhost:11434/v1

# 指定输出路径和种子
node src/generate.js "描述" --no-llm --output output/mymap.bin --seed 42

# 列出可用模型
node src/generate.js --list-models

# 帮助
node src/generate.js --help

# 运行全部测试
npm test
```
