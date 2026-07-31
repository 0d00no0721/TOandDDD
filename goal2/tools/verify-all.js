'use strict';
const fs = require('fs');
const path = require('path');
const { parseMapBin, generateSimplifiedMapBin } = require('../src/parseMapBin');

console.log('=== 全链路验证 ===\n');

// 1. Simplified map.bin round-trip
const origBuf = fs.readFileSync('E:/DDD/testanki1.github.io/maps/Highland REMASTER Summer Evening/map.bin');
const parsed = parseMapBin(origBuf);
const simpBuf = generateSimplifiedMapBin(parsed);
const reParsed = parseMapBin(simpBuf);
const o = parsed.collisionData1.shapesType1.length + parsed.collisionData1.shapesType2.length + parsed.collisionData1.shapesType3.length;
const s = reParsed.collisionData1.shapesType1.length + reParsed.collisionData1.shapesType2.length + reParsed.collisionData1.shapesType3.length;
console.log('1. 简化map.bin: ' + (origBuf.length/1024).toFixed(0) + 'KB -> ' + (simpBuf.length/1024).toFixed(0) + 'KB');
console.log('   碰撞: ' + o + ' -> ' + s + ' (' + (o === s ? 'OK' : 'FAIL') + ')');
console.log('   props: ' + parsed.props.length + ' -> ' + reParsed.props.length + ' (' + (reParsed.props.length === 0 ? 'OK' : 'FAIL') + ')');

// 2. Library
const root = path.join(__dirname, '..');
const libPath = path.join(root, 'out', 'library', 'library.json');
const lib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
const names = Object.keys(lib.maps);
let themes = 0;
for (const n of names) themes += Object.keys(lib.maps[n].themes).length;
console.log('\n2. 地图库: ' + names.length + ' base maps, ' + themes + ' themes, ' + (fs.statSync(libPath).length / 1024).toFixed(0) + ' KB');

// 3. Userscript
require('child_process').execSync('node -c "' + path.join(root, 'map-simplifier.user.js') + '"');
console.log('\n3. 用户脚本语法: OK');

console.log('\n=== 验证完成 ===');
