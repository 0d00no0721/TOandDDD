import { generateLayout } from './layout.js';
import { serializeMapBin } from './serialize-map-bin.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const paramsPath = process.argv[2];
const outPath = process.argv[3] || 'output/generated.bin';

if (!paramsPath) {
    console.error('用法: node src/gen-params.js <params.json> [output.bin]');
    process.exit(1);
}

const params = JSON.parse(readFileSync(paramsPath, 'utf8'));
const layout = generateLayout(params);
const bin = serializeMapBin(layout);

const outDir = dirname(outPath);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, bin);

console.log(JSON.stringify({ propCount: layout.stats.propCount, materialCount: layout.stats.materialCount, size: bin.length }));