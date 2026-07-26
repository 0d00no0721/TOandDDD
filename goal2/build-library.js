'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { parseMapBin, generateSimplifiedMapBin } = require('./src/parseMapBin');

const OUT_DIR = path.join(__dirname, 'out');

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
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function buildLibrary() {
  const mapsJson = JSON.parse(fs.readFileSync('E:/DDD/testanki1.github.io/maps/maps.json', 'utf8'));

  const baseMaps = {};
  for (const cat of mapsJson) {
    for (const sub of cat.subgroups) {
      const baseName = sub.name;
      if (!baseMaps[baseName]) {
        baseMaps[baseName] = {
          name: baseName,
          themes: sub.maps.map(m => ({ name: m.name, url: m.url, path: m.url.replace(/\/map\.bin$/, '') }))
        };
      } else {
        for (const m of sub.maps) {
          if (!baseMaps[baseName].themes.find(t => t.url === m.url)) {
            baseMaps[baseName].themes.push({ name: m.name, url: m.url, path: m.url.replace(/\/map\.bin$/, '') });
          }
        }
      }
    }
  }

  const baseList = Object.values(baseMaps);
  console.log('Found ' + baseList.length + ' base maps, ' + baseList.reduce((a, m) => a + m.themes.length, 0) + ' total themes\n');

  const library = { version: 1, maps: {} };
  const libDir = path.join(OUT_DIR, 'library');
  fs.mkdirSync(libDir, { recursive: true });

  for (const base of baseList) {
    const repTheme = base.themes[0];
    console.log('[' + base.name + '] Downloading representative: ' + repTheme.name);
    let origBuf;
    try {
      origBuf = await fetchBuffer(repTheme.url);
    } catch (e) {
      console.log('  ERROR: ' + e.message);
      continue;
    }
    console.log('  Downloaded: ' + (origBuf.length / 1024).toFixed(1) + ' KB');

    const parsed = parseMapBin(origBuf);
    const simpBuf = generateSimplifiedMapBin(parsed);
    console.log('  Simplified: ' + (simpBuf.length / 1024).toFixed(1) + ' KB (' + (simpBuf.length / origBuf.length * 100).toFixed(1) + '%)');

    const simpB64 = simpBuf.toString('base64');
    const safeName = base.name.replace(/[^a-zA-Z0-9_]/g, '_');
    fs.writeFileSync(path.join(libDir, safeName + '.bin'), simpBuf);

    library.maps[base.name] = {
      simplifiedBase64: simpB64,
      themes: {}
    };
    for (const theme of base.themes) {
      library.maps[base.name].themes[theme.path] = theme.name;
    }
    console.log('  Registered ' + base.themes.length + ' theme paths');
  }

  const libPath = path.join(libDir, 'library.json');
  fs.writeFileSync(libPath, JSON.stringify(library, null, 2));
  const libSize = fs.statSync(libPath).size;
  console.log('\nLibrary written: ' + libPath + ' (' + (libSize / 1024).toFixed(1) + ' KB)');
  console.log('Base maps in library: ' + Object.keys(library.maps).length);
}

buildLibrary().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
