#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { parseMapBin, extractCollisionCompact, extractPropsCompact, identifyAirwalls } = require('./src/parseMapBin');
const { generatePreviewHTML } = require('./src/generatePreview');

const OUT_DIR = path.join(__dirname, 'out');

function fetchBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(fetchBuffer(next, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function printUsage() {
  console.log(`
用法:
  node simplify.js <map.bin 路径或 URL> [选项]

选项:
  --name <名称>    地图显示名 (默认从路径推断)
  --out <路径>     输出 HTML 路径 (默认 out/<名称>.html)
  --json           额外导出解析后的碰撞数据 JSON
  --stats          只打印统计信息，不生成 HTML

示例:
  node simplify.js "E:\\DDD\\testanki1.github.io\\maps\\Highland REMASTER Summer Evening\\map.bin"
  node simplify.js "https://res.3dtank.com/570/174542/371/160/31656237625001/map.bin" --name "Highland Summer Evening"
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let input = null;
  let mapName = null;
  let outPath = null;
  let exportJson = false;
  let statsOnly = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name') { mapName = args[++i]; }
    else if (a === '--out') { outPath = args[++i]; }
    else if (a === '--json') { exportJson = true; }
    else if (a === '--stats') { statsOnly = true; }
    else if (!a.startsWith('-')) { input = a; }
  }

  if (!input) {
    console.error('错误: 请提供 map.bin 路径或 URL');
    printUsage();
    process.exit(1);
  }

  if (!mapName) {
    const base = path.basename(input).replace(/\.bin$/, '').replace(/^map$/, 'map');
    mapName = mapName || (input.startsWith('http') ? base : path.basename(path.dirname(input)));
  }
  if (!outPath) {
    outPath = path.join(OUT_DIR, `${mapName.replace(/[<>:"/\\|?*]/g, '_')}.html`);
  }

  let buffer;
  const isUrl = input.startsWith('http://') || input.startsWith('https://');
  if (isUrl) {
    console.log(`下载: ${input}`);
    buffer = await fetchBuffer(input);
    console.log(`已下载 ${(buffer.length / 1024).toFixed(1)} KB`);
  } else {
    console.log(`读取: ${input}`);
    buffer = fs.readFileSync(input);
    console.log(`已读取 ${(buffer.length / 1024).toFixed(1)} KB`);
  }

  console.log('解析 map.bin ...');
  const parsed = parseMapBin(buffer);

  const c1 = parsed.collisionData1;
  const c2 = parsed.collisionData2;
  const cd1Total = c1.shapesType1.length + c1.shapesType2.length + c1.shapesType3.length;
  const cd2Total = c2.shapesType1.length + c2.shapesType2.length + c2.shapesType3.length;

  console.log(`
┌─────────────────────────────────────┐
│ 解析结果: ${mapName}
├─────────────────────────────────────┤
│ 碰撞组 1:
│   Type1 (OBB 盒)    : ${String(c1.shapesType1.length).padStart(6)}
│   Type2 (薄片墙)    : ${String(c1.shapesType2.length).padStart(6)}
│   Type3 (三角面)    : ${String(c1.shapesType3.length).padStart(6)}
│   小计              : ${String(cd1Total).padStart(6)}
├─────────────────────────────────────┤
│ 碰撞组 2:
│   Type1 (OBB 盒)    : ${String(c2.shapesType1.length).padStart(6)}
│   Type2 (薄片墙)    : ${String(c2.shapesType2.length).padStart(6)}
│   Type3 (三角面)    : ${String(c2.shapesType3.length).padStart(6)}
│   小计              : ${String(cd2Total).padStart(6)}
├─────────────────────────────────────┤
│ 视觉 props          : ${String(parsed.props.length).padStart(6)}
│ 材质数              : ${String(Object.keys(parsed.materials).length).padStart(6)}
│ 图集数              : ${String(Object.keys(parsed.atlases).length).padStart(6)}
└─────────────────────────────────────┘
  `);

  if (statsOnly) return;

  const collision = extractCollisionCompact(parsed);
  const props = extractPropsCompact(parsed);
  const airwalls = identifyAirwalls(parsed);
  const aw1 = airwalls.collisionData1;
  const aw2 = airwalls.collisionData2;
  const aw1Count = aw1.airwall1.filter(Boolean).length + aw1.airwall2.filter(Boolean).length + aw1.airwall3.filter(Boolean).length;
  const aw2Count = aw2.airwall1.filter(Boolean).length + aw2.airwall2.filter(Boolean).length + aw2.airwall3.filter(Boolean).length;
  console.log(`空气墙识别: 组1=${aw1Count} 个, 组2=${aw2Count} 个 (阈值=800)`);
  const meta = { mapName, source: input, parsedAt: new Date().toISOString() };

  console.log('生成预览 HTML ...');
  const html = generatePreviewHTML(collision, props, airwalls, meta);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`已生成: ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);

  if (exportJson) {
    const jsonPath = outPath.replace(/\.html$/, '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(collision, null, 2), 'utf8');
    console.log(`已导出 JSON: ${jsonPath}`);
  }
}

main().catch((err) => {
  console.error('错误:', err.message);
  process.exit(1);
});
