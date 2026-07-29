'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { parseMapBin, generateSimplifiedMapBin } = require('./src/parseMapBin');

const OUT_DIR = path.join(__dirname, 'simplified-maps');

function fetchBuffer(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(fetchBuffer(next, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const mapsJson = JSON.parse(fs.readFileSync('E:/DDD/testanki1.github.io/maps/maps.json', 'utf8'));

  const allMaps = [];
  for (const cat of mapsJson) {
    for (const sub of cat.subgroups) {
      for (const m of sub.maps) {
        allMaps.push({ base: sub.name, theme: m.name, url: m.url });
      }
    }
  }

  const seen = new Set();
  const unique = allMaps.filter(m => {
    const key = m.base + '|' + m.theme + '|' + m.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log('Total entries: ' + allMaps.length + ', unique: ' + unique.length + '\n');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let ok = 0, fail = 0;
  const manifest = [];

  for (let i = 0; i < unique.length; i++) {
    const m = unique[i];
    const label = m.base + ' - ' + m.theme;
    process.stdout.write('[' + (i + 1) + '/' + unique.length + '] ' + label + ' ... ');

    try {
      const origBuf = await fetchBuffer(m.url);
      const parsed = parseMapBin(origBuf);
      const simpBuf = generateSimplifiedMapBin(parsed);

      const c1 = parsed.collisionData1;
      const c2 = parsed.collisionData2;
      const colCount = c1.shapesType1.length + c1.shapesType2.length + c1.shapesType3.length +
                       c2.shapesType1.length + c2.shapesType2.length + c2.shapesType3.length;

      const safeBase = m.base.replace(/[^a-zA-Z0-9_]/g, '_');
      const safeTheme = m.theme.replace(/[^a-zA-Z0-9_]/g, '_');
      const fileName = safeBase + '__' + safeTheme + '.bin';
      const filePath = path.join(OUT_DIR, fileName);
      fs.writeFileSync(filePath, simpBuf);

      const ratio = (simpBuf.length / origBuf.length * 100).toFixed(1);
      console.log((origBuf.length / 1024).toFixed(0) + 'KB -> ' + (simpBuf.length / 1024).toFixed(0) + 'KB (' + ratio + '%) col=' + colCount + ' props=' + parsed.props.length);

      manifest.push({
        base: m.base, theme: m.theme, url: m.url,
        file: fileName,
        originalSize: origBuf.length, simplifiedSize: simpBuf.length,
        collisionCount: colCount, propCount: parsed.props.length
      });
      ok++;
    } catch (e) {
      console.log('ERROR: ' + e.message);
      fail++;
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const totalOrig = manifest.reduce((a, m) => a + m.originalSize, 0);
  const totalSimp = manifest.reduce((a, m) => a + m.simplifiedSize, 0);
  console.log('\n=== Done ===');
  console.log('OK: ' + ok + ', Failed: ' + fail);
  console.log('Total original: ' + (totalOrig / 1024 / 1024).toFixed(1) + ' MB');
  console.log('Total simplified: ' + (totalSimp / 1024 / 1024).toFixed(1) + ' MB');
  console.log('Overall ratio: ' + (totalSimp / totalOrig * 100).toFixed(1) + '%');
  console.log('Output: ' + OUT_DIR);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
