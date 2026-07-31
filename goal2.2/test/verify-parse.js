// Usage: node goal2.2/test/verify-parse.js <path-to-userscript.js> [path-to-map.bin]
// Extracts the BinaryStream..Collision-color-scheme section from a userscript and
// parses a map.bin, printing shape-type counts. Regression check for all versions.
const fs = require('fs');

const scriptPath = process.argv[2] || 'E:/DDD/TOandDDD/goal2.2/scripts/map-simplifier-v2.4.user.js';
const mapPath = process.argv[3] || 'E:/DDD/testanki1.github.io/maps/Highland REMASTER Summer Evening/map.bin';

const src = fs.readFileSync(scriptPath, 'utf8');
const start = src.indexOf('// ═══ BinaryStream');
const end = src.indexOf('// ═══ Collision color scheme');
if (start < 0 || end < 0) { console.error('Markers not found'); process.exit(1); }
const code = src.slice(start, end);

// Wrap the slice in an IIFE returning exports; `new Function` body must use
// an explicit `return` (function declarations hoist inside the IIFE scope).
const iife = `(() => { 'use strict'; ${code}\nreturn { BinaryStream, unwrapPacket, readOptionBitsRaw, parseFullMapBin }; })()`;
const exported = new Function('return ' + iife)();
const { BinaryStream, unwrapPacket, readOptionBitsRaw, parseFullMapBin } = exported;

const buf = fs.readFileSync(mapPath);
const result = parseFullMapBin(buf);

function summarize(col, label) {
  const counts = {};
  for (const c of col.shapesType1) counts.t1 = (counts.t1 || 0) + 1;
  for (const c of col.shapesType2) counts.t2 = (counts.t2 || 0) + 1;
  for (const c of col.shapesType3) counts.t3 = (counts.t3 || 0) + 1;
  console.log(label, JSON.stringify(counts), 'shapes:', col.shapesType1.length + col.shapesType2.length + col.shapesType3.length);
}

summarize(result.collisionData1, 'collisionData1');
summarize(result.collisionData2, 'collisionData2');
console.log('props:', result.props.length);
console.log('first type1:', result.collisionData1.shapesType1[0]);
console.log('OK');
