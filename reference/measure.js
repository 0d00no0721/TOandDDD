const http = require('http');
const zlib = require('zlib');
const fs = require('fs');

const mapsJson = JSON.parse(fs.readFileSync('E:/DDD/testanki1.github.io/maps/maps.json', 'utf8'));

// ---------- BinaryStream (ported from editor.html) ----------
class BinaryStream {
  constructor(buffer) {
    this.buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    this.offset = 0;
  }
  readUint8() { return this.buffer[this.offset++]; }
  readUint16(le = false) { const v = this.buffer.readUInt16BE(this.offset, !le ? true : false); this.offset += 2; return v; }
  readUint32(le = false) { const v = le ? this.buffer.readUInt32LE(this.offset) : this.buffer.readUInt32BE(this.offset); this.offset += 4; return v; }
  readInt32(le = false) { const v = le ? this.buffer.readInt32LE(this.offset) : this.buffer.readInt32BE(this.offset); this.offset += 4; return v; }
  readFloat32(le = false) { const v = le ? this.buffer.readFloatLE(this.offset) : this.buffer.readFloatBE(this.offset); this.offset += 4; return v; }
  readFloat64(le = false) { const v = le ? this.buffer.readDoubleLE(this.offset) : this.buffer.readDoubleBE(this.offset); this.offset += 8; return v; }
  readBytes(len) { const v = this.buffer.subarray(this.offset, this.offset + len); this.offset += len; return v; }
  readStringLength() {
    const flags = this.readUint8();
    if ((flags & 0x80) === 0) return flags & 0x7F;
    if ((flags & 0x40) === 0) return ((flags & 0x3F) << 8) + this.readUint8();
    return ((flags & 0x3F) << 16) + this.readUint16(false);
  }
  readString() { return this.readBytes(this.readStringLength()).toString('utf8'); }
}
// fix readUint16
BinaryStream.prototype.readUint16 = function(le = false) {
  const v = le ? this.buffer.readUInt16LE(this.offset) : this.buffer.readUInt16BE(this.offset);
  this.offset += 2; return v;
};

// ---------- unwrapPacket ----------
function unwrapPacket(stream) {
  const flags = stream.readUint8();
  const compressed = (flags & 0x40) > 0;
  let len = 0;
  if ((flags & 0x80) === 0) {
    len = stream.readUint8() + ((flags & 0x3F) << 8);
  } else {
    const b1 = stream.readUint8(), b2 = stream.readUint8(), b3 = stream.readUint8();
    len = (b1 << 16) | (b2 << 8) | b3;
    len += (flags & 0x3F) * 16777216;
  }
  let data = stream.readBytes(len);
  if (compressed) {
    try { data = zlib.inflateSync(data); }
    catch (e) { data = zlib.inflateRawSync(data); }
  }
  return new BinaryStream(data);
}

// ---------- parseMapBin (ported) ----------
function parseMapBin(buffer) {
  const stream = new BinaryStream(buffer);
  const packet = unwrapPacket(stream);
  const fullOriginalBits = [];
  const flags = packet.readUint8();
  if ((flags & 0x80) === 0) {
    const intBits = flags << 3;
    for (let i = 7; i >= 3; i--) fullOriginalBits.push((intBits & (1 << i)) === 0);
    const extCount = (flags & 0x60) >> 5;
    const extBytes = packet.readBytes(extCount);
    for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);
  } else {
    let extCount = ((flags & 0x40) === 0) ? (flags & 0x3F) : (((flags & 0x3F) << 16) + packet.readUint16(false));
    const extBytes = packet.readBytes(extCount);
    for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);
  }
  const optMask = [...fullOriginalBits].reverse();
  const popBit = () => optMask.pop();
  const skipObjectArray = (p, cb) => { const len = p.readStringLength(); for (let i = 0; i < len; i++) cb(p); };
  const readV3 = () => [packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)];
  const result = { props: [], materials: {}, atlases: {} };

  if (popBit()) {
    const atlasLen = packet.readStringLength();
    for (let i = 0; i < atlasLen; i++) {
      const aHeight = packet.readInt32(false);
      const aName = packet.readString();
      packet.readUint32(false);
      const rects = {};
      const rectLen = packet.readStringLength();
      for (let j = 0; j < rectLen; j++) {
        packet.readUint32(false);
        packet.readString();
        packet.readString();
        packet.readUint32(false);
        packet.readUint32(false);
        packet.readUint32(false);
      }
      const aWidth = packet.readUint32(false);
      result.atlases[aName] = { width: aWidth, height: aHeight };
    }
  }
  if (popBit()) skipObjectArray(packet, p => { p.readUint32(false); p.readString(); p.offset += 12; p.readString(); });
  const readCols = () => {
    const col = { shapesType1: [], shapesType2: [], shapesType3: [] };
    let len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
      for (let j = 0; j < 9; j++) packet.readFloat32(false);
    }
    len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
      packet.readFloat64(false);
      for (let j = 0; j < 6; j++) packet.readFloat32(false);
      packet.readFloat64(false);
    }
    len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
      packet.readFloat64(false);
      for (let j = 0; j < 15; j++) packet.readFloat32(false);
    }
    return col;
  };
  result.collisionData1 = readCols();
  result.collisionData2 = readCols();
  const matLen = packet.readStringLength();
  for (let i = 0; i < matLen; i++) {
    const matID = packet.readUint32(false);
    const matName = packet.readString();
    if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 4; });
    const shader = packet.readString();
    const texParams = [];
    const texLen = packet.readStringLength();
    for (let j = 0; j < texLen; j++) {
      let libName = null;
      if (popBit()) libName = packet.readString();
      const texParamName = packet.readString();
      const texName = packet.readString();
      texParams.push({ libName, name: texParamName, texName });
    }
    if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 8; });
    if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 12; });
    if (popBit()) skipObjectArray(packet, p => { p.readString(); p.offset += 16; });
    result.materials[matID] = { name: matName, shader, texParams };
  }
  if (popBit()) skipObjectArray(packet, p => { p.offset += 28; });
  const propLen = packet.readStringLength();
  for (let i = 0; i < propLen; i++) {
    let grpName = ""; if (popBit()) grpName = packet.readString();
    const id = packet.readUint32(false);
    const libName = packet.readString();
    const matID = packet.readUint32(false);
    const name = packet.readString();
    const pos = readV3();
    const rot = popBit() ? readV3() : [0, 0, 0];
    const scale = popBit() ? readV3() : [1, 1, 1];
    result.props.push({ id, grpName, libName, matID, name, pos, rot, scale });
  }
  return result;
}

// ---------- parseLightmapData ----------
function parseLightmapData(buffer) {
  const stream = new BinaryStream(buffer);
  const version = stream.readUint32(true);
  if (version !== 2) return null;
  stream.readUint32(true); stream.readUint32(true);
  stream.readFloat32(true); stream.readFloat32(true);
  const lightmapCount = stream.readUint32(true);
  const lightmaps = [];
  for (let i = 0; i < lightmapCount; i++) lightmaps.push(stream.readString());
  return { version, lightmaps };
}

// ---------- HTTP helpers ----------
function fetchBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('too many redirects'));
    const client = url.startsWith('https') ? require('https') : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return resolve(fetchBuffer(next, redirectCount + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), len: res.headers['content-length'] }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function headSize(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) return resolve({ status: 0, size: null, error: 'too many redirects' });
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : http;
    const req = lib.request({ method: 'HEAD', host: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return resolve(headSize(next, redirectCount + 1));
      }
      const size = res.headers['content-length'] ? parseInt(res.headers['content-length'], 10) : null;
      res.resume();
      resolve({ status: res.statusCode, size, type: res.headers['content-type'] });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, size: null, error: 'timeout' }); });
    req.on('error', e => resolve({ status: 0, size: null, error: e.message }));
    req.end();
  });
}

// ---------- concurrency ----------
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0, done = 0;
  const total = items.length;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      done++;
      if (done % 25 === 0 || done === total) process.stderr.write(`  ${done}/${total}\r`);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  process.stderr.write('\n');
  return results;
}

const fmt = b => b == null ? '?' : (b >= 1073741824 ? (b/1073741824).toFixed(2)+' GB' : b >= 1048576 ? (b/1048576).toFixed(2)+' MB' : b >= 1024 ? (b/1024).toFixed(2)+' KB' : b+' B');

// ---------- main ----------
(async () => {
  const urlSet = new Set();
  const urlMeta = new Map();
  function add(url, category, kind) {
    if (!urlSet.has(url)) { urlSet.add(url); urlMeta.set(url, { category, kind }); }
  }

  // Force http:// (CDN 301s https -> http anyway)
  function httpize(url) { return url.replace(/^https:\/\//, 'http://'); }

  // propDict: key `${libUrl}_${grpName}_${propName}` and `${libUrl}_${propName}` -> prop object
  const propDict = new Map();
  function texNameWithExt(n) { return (n && n.match(/\.(webp|png|jpg|jpeg|ktx)$/i)) ? n : n + '.webp'; }

  // 1. Download libraries + add all library assets + build propDict
  for (const cat of mapsJson) {
    const libUrl = cat.libraryJsonUrl ? httpize(cat.libraryJsonUrl) : null;
    const libBase = libUrl ? libUrl.substring(0, libUrl.lastIndexOf('/')) : null;
    if (libUrl) {
      try {
        const { buf } = await fetchBuffer(libUrl);
        const lib = JSON.parse(buf.toString('utf8'));
        let pCount = 0, mCount = 0, tCount = 0;
        for (const grp of (lib.groups || [])) {
          const gName = grp.name || "";
          for (const p of (grp.props || [])) {
            pCount++;
            propDict.set(`${libUrl}_${gName}_${p.name}`, p);
            propDict.set(`${libUrl}_${p.name}`, p);
            if (p.mesh && p.mesh.file) { add(`${libBase}/${p.mesh.file}`, cat.category, 'lib-model'); mCount++; }
            // textures live under p.mesh.textures (and sometimes p.textures)
            const texList = (p.mesh && p.mesh.textures) ? p.mesh.textures : (p.textures || []);
            for (const t of texList) {
              if (t && t.diffuseMap) { add(`${libBase}/${texNameWithExt(t.diffuseMap)}`, cat.category, 'lib-texture'); tCount++; }
            }
          }
        }
        console.error(`Library parsed: ${cat.category} -> ${pCount} props, ${mCount} mesh refs, ${tCount} texture refs`);
      } catch (e) { console.error(`Library fetch failed ${libUrl}: ${e.message}`); }
    }
  }

  // 2. Download each map's map.bin + lightmapdata, parse, add URLs
  let mapCount = 0;
  for (const cat of mapsJson) {
    const libUrl = cat.libraryJsonUrl ? httpize(cat.libraryJsonUrl) : null;
    const libBase = libUrl ? libUrl.substring(0, libUrl.lastIndexOf('/')) : null;
    for (const sg of cat.subgroups) {
      for (const mp of sg.maps) {
        const mapUrl = httpize(mp.url);
        const mapBase = mapUrl.substring(0, mapUrl.lastIndexOf('/'));
        mapCount++;
        add(mapUrl, cat.category, 'map.bin');
        add(`${mapBase}/lightmapdata`, cat.category, 'lightmapdata');

        // download + parse map.bin
        let mapData = null;
        try {
          const { buf } = await fetchBuffer(mapUrl);
          mapData = parseMapBin(buf);
        } catch (e) { console.error(`map.bin parse failed ${mp.name}: ${e.message}`); }

        // download + parse lightmapdata
        try {
          const { buf } = await fetchBuffer(`${mapBase}/lightmapdata`);
          const lm = parseLightmapData(buf);
          if (lm && lm.lightmaps) for (const lmName of lm.lightmaps) add(`${mapBase}/${lmName}.webp`, cat.category, 'lightmap');
        } catch (e) { /* no lightmapdata */ }

        if (mapData) {
          const libUrlThis = cat.libraryJsonUrl ? httpize(cat.libraryJsonUrl) : null;
          // atlases
          for (const aName of Object.keys(mapData.atlases)) add(`${mapBase}/${aName}.webp`, cat.category, 'atlas');
          // material textures (editor falls back libBase -> mapBase for lib textures)
          for (const mat of Object.values(mapData.materials)) {
            for (const tp of mat.texParams) {
              const base = (tp.libName && libBase) ? libBase : mapBase;
              add(`${base}/${texNameWithExt(tp.texName)}`, cat.category, 'mat-texture');
              if (tp.libName && libBase) add(`${mapBase}/${texNameWithExt(tp.texName)}`, cat.category, 'mat-texture');
            }
          }
          // prop models: resolve via propDict (library props -> lib-model already added; only add map-local)
          for (const prop of mapData.props) {
            if (!prop.libName) {
              add(`${mapBase}/models.a3d`, cat.category, 'map-model');
            } else {
              // lookup in library; if found, its mesh.file is already counted as lib-model.
              // only add a map-local fallback if NOT found in library dict.
              const pInfo = propDict.get(`${libUrlThis}_${prop.grpName}_${prop.name}`) || propDict.get(`${libUrlThis}_${prop.name}`);
              if (!pInfo || !pInfo.mesh || !pInfo.mesh.file) {
                add(`${mapBase}/${prop.name}.a3d`, cat.category, 'map-model');
              }
            }
          }
        }
      }
    }
  }
  console.error(`Maps processed: ${mapCount}`);
  console.error(`Unique URLs to HEAD: ${urlSet.size}`);

  // 3. HEAD all
  const urls = Array.from(urlSet);
  const results = await mapLimit(urls, 10, async (url) => {
    let r = await headSize(url);
    // some servers don't support HEAD well; if HEAD gives non-2xx or no size, try GET headers
    if (r.status !== 200 || r.size == null) {
      const g = await new Promise(resolve => {
        const u = new URL(url); const lib = u.protocol === 'https:' ? require('https') : http;
        const req = lib.request({ method: 'GET', host: u.hostname, path: u.pathname, headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-0' }, timeout: 30000 }, res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(headSize(new URL(res.headers.location, url).href)); }
          let sz = res.headers['content-length'] ? parseInt(res.headers['content-length'],10) : null;
          const cr = res.headers['content-range'];
          if (cr && sz === 1) { const m = cr.match(/\/(\d+)/); if (m) sz = parseInt(m[1],10); }
          res.resume(); resolve({ status: res.statusCode, size: sz, type: res.headers['content-type'] });
        });
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, size: null, error: 'timeout' }); });
        req.on('error', e => resolve({ status: 0, size: null, error: e.message }));
        req.end();
      });
      if (g && g.size != null) r = g;
    }
    return { url, ...r };
  });

  // 4. Report
  let total = 0, known = 0, failed = 0, counted = 0;
  const byKind = {};
  const byCategory = {};
  const top = [];
  for (const r of results) {
    const meta = urlMeta.get(r.url);
    byKind[meta.kind] = byKind[meta.kind] || { count: 0, bytes: 0, missing: 0 };
    byCategory[meta.category] = byCategory[meta.category] || { count: 0, bytes: 0, missing: 0 };
    byKind[meta.kind].count++;
    byCategory[meta.category].count++;
    if (r.size != null && r.status === 200) {
      total += r.size; known++; byKind[meta.kind].bytes += r.size; byCategory[meta.category].bytes += r.size;
      top.push({ url: r.url, size: r.size, kind: meta.kind });
    } else {
      failed++; byKind[meta.kind].missing++; byCategory[meta.category].missing++;
    }
  }
  top.sort((a,b) => b.size - a.size);

  console.log('==== RESOURCE ESTIMATE ====');
  console.log(`Total unique URLs: ${urlSet.size}`);
  console.log(`Measured (200 + Content-Length): ${known}`);
  console.log(`Missing/failed: ${failed}`);
  console.log(`TOTAL SIZE: ${fmt(total)}  (${total} bytes)`);
  console.log('');
  console.log('== By kind ==');
  for (const [k,v] of Object.entries(byKind).sort((a,b)=>b[1].bytes-a[1].bytes)) {
    console.log(`  ${k.padEnd(16)} files=${String(v.count).padStart(4)}  bytes=${fmt(v.bytes).padStart(12)}  missing=${v.missing}`);
  }
  console.log('');
  console.log('== By category ==');
  for (const [k,v] of Object.entries(byCategory).sort((a,b)=>b[1].bytes-a[1].bytes)) {
    console.log(`  ${k.padEnd(34)} files=${String(v.count).padStart(4)}  bytes=${fmt(v.bytes).padStart(12)}  missing=${v.missing}`);
  }
  console.log('');
  console.log('== Top 15 largest files ==');
  for (const t of top.slice(0,15)) console.log(`  ${fmt(t.size).padStart(12)}  [${t.kind}]  ${t.url}`);

  // dump missing for inspection
  const missing = results.filter(r => r.size == null || r.status !== 200).slice(0, 50);
  if (missing.length) {
    console.log('');
    console.log('== Sample missing (up to 50) ==');
    for (const m of missing) console.log(`  [${m.status || m.error}] ${m.url}`);
  }
})();
