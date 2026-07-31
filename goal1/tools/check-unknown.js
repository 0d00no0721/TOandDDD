import { parseMapBin } from '../src/parse-map-bin.js';
import { readFileSync } from 'node:fs';

const idx = JSON.parse(readFileSync('data/library_index.json', 'utf8'));
const idxByLibName = new Map();
for (const p of idx.props) idxByLibName.set(`${p.libId}:${p.name}`, p);

const buf = readFileSync('data/cache/maps/Highland_Summer_Day.bin');
const data = parseMapBin(buf);

const unknownNames = new Set();
const knownNames = new Set();
for (const p of data.props) {
  const libId = p.libName || 'main';
  if (idxByLibName.has(`${libId}:${p.name}`)) knownNames.add(p.name);
  else unknownNames.add(p.name);
}

console.log('Known prop names:', knownNames.size);
console.log('Unknown prop names:', unknownNames.size);
console.log('\nUnknown (前 30):');
[...unknownNames].slice(0, 30).forEach(n => console.log('  ' + n));

console.log('\nKnown (前 10):');
[...knownNames].slice(0, 10).forEach(n => console.log('  ' + n));

// 检查 libName 分布
const libNames = {};
for (const p of data.props) {
  const ln = p.libName || '(empty)';
  libNames[ln] = (libNames[ln] || 0) + 1;
}
console.log('\nlibName 分布:', JSON.stringify(libNames));
