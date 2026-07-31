// ==UserScript==
// @name         Tanki Map Simplifier v1.15.4
// @namespace    https://github.com/0d00no0721/TOandDDD
// @version      1.15.4
// @description  Intercept texImage2D + createImageBitmap + Image.src + fetch + XHR. Custom image replacement (single image, baked alpha + opacity slider) with HSL fallback, hide billboards. Safe baseline (no uniform hooks). Ctrl+Shift+M toggle.
// @match        https://*.3dtank.com/*
// @match        https://3dtank.com/*
// @match        https://*.tankionline.com/*
// @match        https://tankionline.com/*
// @match        https://*.test-eu.tankionline.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
  'use strict';

  var VERSION = '1.15.4';
  var VERSION_FULL = '1.15.4';
  var ENABLED_KEY = 'Tanki_Simplified_Maps_Enabled';
  var CUSTOM_IMG_KEY = 'Tanki_Simplified_CustomImg';
  var CUSTOM_ALPHA_KEY = 'Tanki_Simplified_CustomAlpha';
  var _msInternal = false;

  function isEnabled() { try { return localStorage.getItem(ENABLED_KEY) !== 'false'; } catch(e) { return true; } }
  function setEnabled(v) { try { localStorage.setItem(ENABLED_KEY, String(v)); } catch(e) {} }
  var LOG_URL = 'http://localhost:3457/log';
  var SESSION_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function remoteLog(level, message, data) {
    var payload = { session: SESSION_ID, level: level, message: message, time: Date.now() };
    if (data !== undefined) payload.data = data;
    var body = JSON.stringify(payload);
    try {
      if (typeof fetch !== 'undefined') {
        fetch(LOG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, mode: 'cors' }).catch(function(){});
      }
    } catch(e) {}
  }

  function log(m) { console.log('%c[MS ' + VERSION + '] ' + m, 'color:#76ff33'); remoteLog('INFO', m); }
  function logStep(n, m) { var msg = '[Step ' + n + '] ' + m; console.log('%c[MS ' + VERSION + '] ' + msg, 'color:#00ddcc'); remoteLog('INFO', msg); }
  function logWarn(m) { console.warn('[MS ' + VERSION + '] ' + m); remoteLog('WARN', m); }
  function logErr(m) { console.error('[MS ' + VERSION + '] ' + m); remoteLog('ERROR', m); }

  // ═══ State ═══
  var texNameToCategory = null;
  var categoryCounts = null;
  var textureInterceptionActive = false;

  // ═══ Maps for tracking intercepted textures ═══
  // blobUrlToMeta: blobUrl → { hsla, cat, hide }
  var blobUrlToMeta = {};
  // blobMeta: WeakMap<Blob, { hsla, cat, hide }>
  var blobMeta = new WeakMap();
  // urlToMeta: originalUrl → { hsla, cat, hide } (for Image.src that weren't replaced)
  var urlToMeta = {};

  // ═══ Transparent PNG (1x1 fully transparent, for hiding billboards) ═══
  var TRANSPARENT_PNG_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  var TRANSPARENT_PNG_BYTES = (function() {
    var bin = atob(TRANSPARENT_PNG_DATAURL.split(',')[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  })();

  // ═══ Vegetation URL pattern (for billboard hiding when texName not in map.bin) ═══
  var VEGETATION_PATTERN = /tree|bush|grass|flower|ivy|foliage|leaf|sprite|billboard|bd|elm/i;

  // ═══ Material classification ═══
  function classifyMaterial(matName, shader) {
    var lower = matName.toLowerCase();
    if (shader === 'TankiOnline/Terrain') return 'terrain';
    if (shader === 'TankiOnline/SpriteShader') return 'vegetation';
    // Some maps use SingleTextureShader for billboards (grass/bush/tree); classify by name keywords.
    var vegKW = ['tree', 'bush', 'grass', 'flower', 'ivy', 'foliage', 'leaf', 'sprite', 'billboard', 'elm'];
    for (var vi = 0; vi < vegKW.length; vi++) { if (lower.indexOf(vegKW[vi]) !== -1) return 'vegetation'; }
    var flatKW = ['roof', 'ceiling', 'floor', 'slab', 'road', 'asph', 'crater', 'tileset', 'tile_set'];
    var facadeKW = ['wall', 'fence', 'window', 'door', 'brick', 'plaster', 'pile', 'border'];
    var slopeKW = ['cliff', 'pandus', 'mountain', 'rise', 'ramp'];
    for (var i = 0; i < flatKW.length; i++) { if (lower.indexOf(flatKW[i]) !== -1) return 'flat'; }
    for (var i = 0; i < facadeKW.length; i++) { if (lower.indexOf(facadeKW[i]) !== -1) return 'facade'; }
    for (var i = 0; i < slopeKW.length; i++) { if (lower.indexOf(slopeKW[i]) !== -1) return 'slope'; }
    return 'object';
  }

  // ═══ HSL color ranges per category (v1.14: very low alpha + gradient) ═══
  var CATEGORY_RANGES = {
    flat:       { hMin: 20,  hMax: 40,  s: 60, l: 50, a: 0.15 },
    facade:     { hMin: 200, hMax: 240, s: 70, l: 50, a: 0.10 },
    slope:      { hMin: 50,  hMax: 70,  s: 65, l: 50, a: 0.15 },
    vegetation: { hMin: 100, hMax: 140, s: 55, l: 45, a: 0.70 },
    terrain:    { hMin: 80,  hMax: 100, s: 50, l: 40, a: 0.30 },
    object:     { hMin: 0,   hMax: 360, s: 75, l: 55, a: 0.20 }
  };

  var CATEGORY_SWATCH = {
    flat:       'hsl(30,60%,50%)',
    facade:     'hsl(220,70%,50%)',
    slope:      'hsl(60,65%,50%)',
    vegetation: 'hsl(120,55%,45%)',
    terrain:    'hsl(90,50%,40%)',
    object:     'hsl(0,75%,55%)'
  };

  var pngCache = {};
  var blobUrlCache = {};
  var transparentBlobUrl = null;

  function hashStr(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function getColorForTexName(texName) {
    var entry = texNameToCategory ? texNameToCategory[texName] : null;
    var cat = entry ? entry.category : 'object';
    var r = CATEGORY_RANGES[cat];
    var h = r.hMin + (hashStr(texName) % (r.hMax - r.hMin + 1));
    return { hsla: 'hsla(' + h + ',' + r.s + '%,' + r.l + '%,' + r.a + ')', cat: cat };
  }

  function getColorCanvas(hsla) {
    var canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = hsla;
    ctx.fillRect(0, 0, 64, 64);
    var grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.15)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return canvas;
  }

  function getColorPNG(hsla) {
    if (pngCache[hsla]) return pngCache[hsla];
    var canvas = getColorCanvas(hsla);
    var dataUrl = canvas.toDataURL('image/png');
    var base64 = dataUrl.split(',')[1];
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    pngCache[hsla] = bytes;
    return bytes;
  }

  function getTransparentCanvas() {
    var canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    return canvas;
  }

  function getBlobUrlForHsla(hsla) {
    if (blobUrlCache[hsla]) return blobUrlCache[hsla];
    var bytes = getColorPNG(hsla);
    var blob = new Blob([bytes], { type: 'image/png' });
    var url = URL.createObjectURL(blob);
    blobUrlCache[hsla] = url;
    blobUrlToMeta[url] = { hsla: hsla, cat: null, hide: false };
    return url;
  }

  function getTransparentBlobUrl() {
    if (transparentBlobUrl) return transparentBlobUrl;
    var blob = new Blob([TRANSPARENT_PNG_BYTES], { type: 'image/png' });
    transparentBlobUrl = URL.createObjectURL(blob);
    blobUrlToMeta[transparentBlobUrl] = { hsla: null, cat: 'vegetation', hide: true };
    return transparentBlobUrl;
  }

  // ═══ Custom image replacement (single image for all textures) ═══
  // When ready, every non-hidden texture is replaced by the user's custom image
  // (resampled to fit CUSTOM_MAX_DIM on its longest side, then baked with IMG_ALPHA
  // onto a transparent canvas so the game shader renders it faint — like v1.14 HSL).
  // When not ready, the v1.14 HSL gradient path is used as fallback.
  // Separation: localStorage stores the OPAQUE resampled PNG (alpha not baked in);
  // runtime resources (canvas/bytes/blobUrl) are re-baked from customOpaqueCanvas
  // whenever IMG_ALPHA changes — so adjusting the slider never compounds alpha.
  var CUSTOM_MAX_DIM = 512;
  var DEFAULT_ALPHA = 0.25;
  var IMG_ALPHA = DEFAULT_ALPHA;
  var customImageDataURL = null;   // runtime baked PNG dataURL (alpha applied) — used for UI thumbnail mirror only
  var customSourceDataURL = null;  // opaque resampled PNG dataURL (stored in localStorage)
  var customOpaqueCanvas = null;   // opaque resampled canvas (source for rebaking)
  var customImageReady = false;    // runtime resources are ready for use
  var customImageCanvas = null;    // baked canvas (for texImage2D / createImageBitmap)
  var customImageBytes = null;     // baked PNG bytes (for fetch / XHR response body)
  var customImageBlobUrl = null;   // baked blob: URL (for Image.src / setAttribute)
  var customImageWidth = 0;
  var customImageHeight = 0;

  function getStoredCustomImg() { try { return localStorage.getItem(CUSTOM_IMG_KEY); } catch(e) { return null; } }
  function setStoredCustomImg(dataURL) {
    try { localStorage.setItem(CUSTOM_IMG_KEY, dataURL); }
    catch(e) { logWarn('Failed to persist custom image (quota?): ' + e.message); }
  }
  function clearStoredCustomImg() { try { localStorage.removeItem(CUSTOM_IMG_KEY); } catch(e) {} }
  function getStoredAlpha() { try { var v = parseFloat(localStorage.getItem(CUSTOM_ALPHA_KEY)); return isNaN(v) ? null : v; } catch(e) { return null; } }
  function setStoredAlpha(a) { try { localStorage.setItem(CUSTOM_ALPHA_KEY, String(a)); } catch(e) {} }
  function clearStoredAlpha() { try { localStorage.removeItem(CUSTOM_ALPHA_KEY); } catch(e) {} }

  function releaseCustomImage() {
    if (customImageBlobUrl) { try { URL.revokeObjectURL(customImageBlobUrl); } catch(e) {} }
    customImageReady = false;
    customImageCanvas = null;
    customImageBytes = null;
    customImageBlobUrl = null;
    customImageWidth = 0;
    customImageHeight = 0;
    customOpaqueCanvas = null;
    customSourceDataURL = null;
    customImageDataURL = null;
  }

  function dataUrlToBytes(dataURL) {
    var base64 = dataURL.split(',')[1];
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Bake an opaque canvas onto a transparent canvas at the given alpha.
  // The game shader then renders the quad faint (like v1.14 hsla with low a),
  // so standing billboards become near-invisible while still-textured surfaces show the image faintly.
  function bakeAlphaCanvas(srcCanvas, alpha) {
    var w = srcCanvas.width, h = srcCanvas.height;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.globalAlpha = 1;
    return canvas;
  }

  // Build runtime resources (canvas/bytes/blobUrl) by baking customOpaqueCanvas with IMG_ALPHA.
  // Requires customOpaqueCanvas to be set; does NOT touch customOpaqueCanvas or customSourceDataURL.
  function buildRuntimeResources() {
    if (!customOpaqueCanvas) return;
    // Release previous runtime-only resources (keep opaque source).
    if (customImageBlobUrl) { try { URL.revokeObjectURL(customImageBlobUrl); } catch(e) {} }
    var baked = bakeAlphaCanvas(customOpaqueCanvas, IMG_ALPHA);
    customImageCanvas = baked;
    customImageWidth = baked.width;
    customImageHeight = baked.height;
    customImageDataURL = baked.toDataURL('image/png');
    customImageBytes = dataUrlToBytes(customImageDataURL);
    var blob = new Blob([customImageBytes], { type: 'image/png' });
    customImageBlobUrl = URL.createObjectURL(blob);
    blobUrlToMeta[customImageBlobUrl] = { hsla: null, cat: 'custom', hide: false };
    customImageReady = true;
  }

  // Resample (shrink OR enlarge) so the longest side equals maxDim, preserving aspect.
  // Uses high-quality bilinear interpolation via canvas image smoothing.
  function resampleToCanvas(img, maxDim) {
    var w = img.naturalWidth || img.width || 1;
    var h = img.naturalHeight || img.height || 1;
    var scale = maxDim / Math.max(w, h);
    var nw = Math.max(1, Math.round(w * scale));
    var nh = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = nw; canvas.height = nh;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = 'high'; } catch(e) {}
    ctx.drawImage(img, 0, 0, nw, nh);
    return canvas;
  }

  // Draw a loaded Image onto a fresh canvas at its natural size (opaque source carrier).
  function imageToCanvas(img) {
    var w = img.naturalWidth || img.width || 1;
    var h = img.naturalHeight || img.height || 1;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return canvas;
  }

  // Load custom image from localStorage at startup (document-start safe).
  // localStorage stores the OPAQUE resampled PNG; here we just carry it as the
  // opaque source and bake runtime resources with the stored alpha.
  function preloadCustomImage() {
    var dataURL = getStoredCustomImg();
    var storedAlpha = getStoredAlpha();
    if (storedAlpha !== null) IMG_ALPHA = storedAlpha; else IMG_ALPHA = DEFAULT_ALPHA;
    if (!dataURL) { customImageReady = false; return; }
    var img = new Image();
    img.onload = function() {
      try {
        customOpaqueCanvas = imageToCanvas(img);
        customSourceDataURL = dataURL;
        buildRuntimeResources();
        log('Custom image ready: ' + customImageWidth + 'x' + customImageHeight + ' alpha=' + IMG_ALPHA);
        updateStatus(); updateConfigUI();
      } catch(e) {
        logWarn('Custom image processing failed: ' + e.message);
        releaseCustomImage(); updateStatus(); updateConfigUI();
      }
    };
    img.onerror = function() {
      logWarn('Stored custom image unreadable; ignoring');
      releaseCustomImage(); updateStatus(); updateConfigUI();
    };
    img.src = dataURL;
  }

  // Change baked alpha at runtime (slider). Re-bakes from opaque source — never compounds.
  function changeAlpha(a) {
    IMG_ALPHA = Math.max(0, Math.min(1, a));
    setStoredAlpha(IMG_ALPHA);
    if (customOpaqueCanvas) {
      try { buildRuntimeResources(); } catch(e) { logWarn('Rebake failed: ' + e.message); }
      log('Alpha changed: ' + IMG_ALPHA);
    }
    updateStatus(); updateConfigUI();
  }

  // Replacement resource getters: custom image takes priority, HSL fallback otherwise.
  function getReplacementCanvas(meta) {
    if (meta.hide) return getTransparentCanvas();
    if (customImageReady && customImageCanvas) return customImageCanvas;
    return getColorCanvas(meta.hsla);
  }
  function getReplacementPNG(meta) {
    if (meta.hide) return TRANSPARENT_PNG_BYTES;
    if (customImageReady && customImageBytes) return customImageBytes;
    return getColorPNG(meta.hsla);
  }
  function getReplacementBlobUrl(meta) {
    if (meta.hide) return getTransparentBlobUrl();
    if (customImageReady && customImageBlobUrl) return customImageBlobUrl;
    return getBlobUrlForHsla(meta.hsla);
  }

  // ═══ Texture URL matching (exact filename match) ═══
  function isImageUrl(url) {
    return /\.(webp|png|jpg|jpeg|ktx|dds)(\?|$)/i.test(url);
  }

  function extractTexNameFromUrl(url) {
    if (!texNameToCategory) return null;
    var path = url.split('?')[0];
    var filename = path.substring(path.lastIndexOf('/') + 1);
    var basename = filename.replace(/\.(webp|png|jpg|jpeg|ktx|dds)$/i, '');
    if (texNameToCategory[filename]) return filename;
    if (texNameToCategory[basename]) return basename;
    return null;
  }

  function matchesTexName(url) {
    return extractTexNameFromUrl(url) !== null;
  }

  // ═══ Should hide texture? (vegetation / billboard) ═══
  function shouldHideTexture(texName, url) {
    if (texName && texNameToCategory[texName]) {
      if (texNameToCategory[texName].category === 'vegetation') return true;
      // Known texName classified non-veg: still hide if texName or matName matches vegetation pattern.
      if (VEGETATION_PATTERN.test(texName)) return true;
      if (VEGETATION_PATTERN.test(texNameToCategory[texName].matName)) return true;
    }
    if (url && VEGETATION_PATTERN.test(url)) return true;
    return false;
  }

  // ═══ Resolve meta for a URL (used by texImage2D when source is Image with original URL) ═══
  function resolveMetaForUrl(url) {
    if (!url) return null;
    // Check if it's a blob URL we created
    if (blobUrlToMeta[url]) return blobUrlToMeta[url];
    // Check if it's a data URL (transparent)
    if (url === TRANSPARENT_PNG_DATAURL) return { hsla: null, cat: 'vegetation', hide: true };
    // Check urlToMeta cache
    if (urlToMeta[url]) return urlToMeta[url];
    // Try to resolve from texName
    if (isImageUrl(url) && textureInterceptionActive) {
      var texName = extractTexNameFromUrl(url);
      if (texName) {
        if (shouldHideTexture(texName, url)) {
          var meta = { hsla: null, cat: 'vegetation', hide: true };
          urlToMeta[url] = meta;
          return meta;
        }
        var result = getColorForTexName(texName);
        var meta2 = { hsla: result.hsla, cat: result.cat, hide: false };
        urlToMeta[url] = meta2;
        return meta2;
      }
      // Check vegetation pattern
      if (VEGETATION_PATTERN.test(url)) {
        var meta3 = { hsla: null, cat: 'vegetation', hide: true };
        urlToMeta[url] = meta3;
        return meta3;
      }
    }
    return null;
  }

  // ═══ Hex dump ═══
  function hexDump(buf, max) {
    max = max || 64;
    var bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    var len = Math.min(bytes.length, max);
    var out = [];
    for (var i = 0; i < len; i++) { out.push(bytes[i].toString(16).padStart(2, '0')); }
    return out.join(' ') + (bytes.length > max ? ' ... (' + bytes.length + ' bytes)' : ' (' + bytes.length + ' bytes)');
  }

  // ═══ BinaryStream ═══
  function BinaryStream(buffer) {
    if (buffer instanceof Uint8Array) this.bytes = buffer;
    else if (buffer instanceof ArrayBuffer) this.bytes = new Uint8Array(buffer);
    else this.bytes = new Uint8Array(buffer);
    this.dv = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
  }
  BinaryStream.prototype.readUint8 = function() { return this.dv.getUint8(this.offset++); };
  BinaryStream.prototype.readUint16 = function(le) { var v = this.dv.getUint16(this.offset, !!le); this.offset += 2; return v; };
  BinaryStream.prototype.readUint32 = function(le) { var v = this.dv.getUint32(this.offset, !!le); this.offset += 4; return v; };
  BinaryStream.prototype.readInt32 = function(le) { var v = this.dv.getInt32(this.offset, !!le); this.offset += 4; return v; };
  BinaryStream.prototype.readFloat32 = function(le) { var v = this.dv.getFloat32(this.offset, !!le); this.offset += 4; return v; };
  BinaryStream.prototype.readFloat64 = function(le) { var v = this.dv.getFloat64(this.offset, !!le); this.offset += 8; return v; };
  BinaryStream.prototype.readBytes = function(len) { var v = this.bytes.subarray(this.offset, this.offset + len); this.offset += len; return v; };
  BinaryStream.prototype.readStringLength = function() {
    var flags = this.readUint8();
    if ((flags & 0x80) === 0) return flags & 0x7f;
    if ((flags & 0x40) === 0) return ((flags & 0x3f) << 8) + this.readUint8();
    return ((flags & 0x3f) << 16) + this.readUint16(false);
  };
  BinaryStream.prototype.readString = function() {
    var bytes = this.readBytes(this.readStringLength());
    return new TextDecoder('utf-8').decode(bytes);
  };

  // ═══ Packet unwrap ═══
  function unwrapPacket(stream) {
    var flags = stream.readUint8();
    var compressed = (flags & 0x40) > 0;
    var len = 0;
    if ((flags & 0x80) === 0) len = stream.readUint8() + ((flags & 0x3f) << 8);
    else { var b1 = stream.readUint8(), b2 = stream.readUint8(), b3 = stream.readUint8(); len = (b1 << 16) | (b2 << 8) | b3; len += (flags & 0x3f) * 16777216; }
    var data = stream.readBytes(len);
    if (compressed && typeof pako !== 'undefined') {
      try { data = pako.inflate(data); }
      catch (e) { try { data = pako.inflateRaw(data); } catch(e2) {} }
    }
    return new BinaryStream(data);
  }

  // ═══ Read option bits + capture raw bytes ═══
  function readOptionBitsRaw(packet) {
    var start = packet.offset;
    var bits = [];
    var flags = packet.readUint8();
    if ((flags & 0x80) === 0) {
      var intBits = flags << 3;
      for (var i = 7; i >= 3; i--) bits.push((intBits & (1 << i)) === 0);
      var extCount = (flags & 0x60) >> 5;
      var extBytes = packet.readBytes(extCount);
      for (var ie = 0; ie < extBytes.length; ie++)
        for (var b = 7; b >= 0; b--) bits.push((extBytes[ie] & (1 << b)) === 0);
    } else {
      var extCount2 = ((flags & 0x40) === 0) ? (flags & 0x3f) : (((flags & 0x3f) << 16) + packet.readUint16(false));
      var extBytes2 = packet.readBytes(extCount2);
      for (var ie2 = 0; ie2 < extBytes2.length; ie2++)
        for (var b2 = 7; b2 >= 0; b2--) bits.push((extBytes2[ie2] & (1 << b2)) === 0);
    }
    var rawBytes = new Uint8Array(packet.bytes.subarray(start, packet.offset));
    return { bits: bits, rawBytes: rawBytes };
  }

  // ═══ Full parse ═══
  function parseFullMapBin(buffer) {
    var stream = new BinaryStream(buffer);
    var pHdrFlags = stream.dv.getUint8(0);
    var packet = unwrapPacket(stream);
    var optResult = readOptionBitsRaw(packet);
    var bits = optResult.bits;
    var optMask = bits.slice().reverse();
    var popBit = function() { return optMask.pop(); };
    var result = { rawOptBytes: optResult.rawBytes, bits: bits, atlases: [], unknownArr: null, collisionData1: null, collisionData2: null, materials: {}, unknown28: null, props: [], pHdrFlags: pHdrFlags };
    if (popBit()) {
      var atlasLen = packet.readStringLength();
      for (var ia = 0; ia < atlasLen; ia++) {
        var aHeight = packet.readInt32(false); var aName = packet.readString(); var aFlag = packet.readUint32(false);
        var rectLen = packet.readStringLength(); var rects = [];
        for (var ir = 0; ir < rectLen; ir++) { rects.push({ u1: packet.readUint32(false), s1: packet.readString(), s2: packet.readString(), u2: packet.readUint32(false), u3: packet.readUint32(false), u4: packet.readUint32(false) }); }
        var aWidth = packet.readUint32(false);
        result.atlases.push({ name: aName, width: aWidth, height: aHeight, flag: aFlag, rects: rects });
      }
    }
    if (popBit()) {
      var uLen = packet.readStringLength(); var uArr = [];
      for (var iu = 0; iu < uLen; iu++) { var uId = packet.readUint32(false); var uName = packet.readString(); var uBytes = new Uint8Array(packet.readBytes(12)); var uStr = packet.readString(); uArr.push({ id: uId, name: uName, bytes12: uBytes, str: uStr }); }
      result.unknownArr = uArr;
    }
    function readCols() {
      var col = { shapesType1: [], shapesType2: [], shapesType3: [] };
      var l1 = packet.readStringLength();
      for (var i = 0; i < l1; i++) col.shapesType1.push([packet.readFloat32(false),packet.readFloat32(false),packet.readFloat32(false),packet.readFloat32(false),packet.readFloat32(false),packet.readFloat32(false),packet.readFloat32(false),packet.readFloat32(false),packet.readFloat32(false)]);
      var l2 = packet.readStringLength();
      for (var i2 = 0; i2 < l2; i2++) { var f1 = packet.readFloat64(false); var d = []; for (var j = 0; j < 6; j++) d.push(packet.readFloat32(false)); var f2 = packet.readFloat64(false); col.shapesType2.push({ f1: f1, data: d, f2: f2 }); }
      var l3 = packet.readStringLength();
      for (var i3 = 0; i3 < l3; i3++) { var f1b = packet.readFloat64(false); var d2 = []; for (var j2 = 0; j2 < 15; j2++) d2.push(packet.readFloat32(false)); col.shapesType3.push({ f1: f1b, data: d2 }); }
      return col;
    }
    result.collisionData1 = readCols(); result.collisionData2 = readCols();
    var matLen = packet.readStringLength();
    for (var im = 0; im < matLen; im++) {
      var matID = packet.readUint32(false); var matName = packet.readString(); var optList1 = null;
      if (popBit()) { optList1 = []; var ol1 = packet.readStringLength(); for (var x1 = 0; x1 < ol1; x1++) optList1.push({ str: packet.readString(), val: packet.readUint32(false) }); }
      var shader = packet.readString(); var texParams = []; var texLen = packet.readStringLength();
      for (var jt = 0; jt < texLen; jt++) { var libName = null; if (popBit()) libName = packet.readString(); var texParamName = packet.readString(); var texName = packet.readString(); texParams.push({ libName: libName, name: texParamName, origTexName: texName }); }
      var optList2 = null, optList3 = null, optList4 = null;
      if (popBit()) { optList2 = []; var ol2 = packet.readStringLength(); for (var x2 = 0; x2 < ol2; x2++) optList2.push({ str: packet.readString(), val: packet.readFloat64(false) }); }
      if (popBit()) { optList3 = []; var ol3 = packet.readStringLength(); for (var x3 = 0; x3 < ol3; x3++) optList3.push({ str: packet.readString(), v1: packet.readFloat32(false), v2: packet.readFloat32(false), v3: packet.readFloat32(false) }); }
      if (popBit()) { optList4 = []; var ol4 = packet.readStringLength(); for (var x4 = 0; x4 < ol4; x4++) optList4.push({ str: packet.readString(), v1: packet.readFloat32(false), v2: packet.readFloat32(false), v3: packet.readFloat32(false), v4: packet.readFloat32(false) }); }
      result.materials[matID] = { id: matID, name: matName, shader: shader, texParams: texParams, optList1: optList1, optList2: optList2, optList3: optList3, optList4: optList4 };
    }
    if (popBit()) { var u28Len = packet.readStringLength(); var u28Arr = []; for (var iu28 = 0; iu28 < u28Len; iu28++) u28Arr.push(new Uint8Array(packet.readBytes(28))); result.unknown28 = u28Arr; }
    var propLen = packet.readStringLength();
    for (var ip = 0; ip < propLen; ip++) {
      var grpName = ''; if (popBit()) grpName = packet.readString();
      var id = packet.readUint32(false); var libName2 = packet.readString(); var matID2 = packet.readUint32(false); var name2 = packet.readString();
      var pos = [packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)];
      var rot = popBit() ? [packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)] : [0, 0, 0];
      var scale = popBit() ? [packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)] : [1, 1, 1];
      result.props.push({ id: id, grpName: grpName, libName: libName2, matID: matID2, name: name2, pos: pos, rot: rot, scale: scale });
    }
    return result;
  }

  // ═══ Process map.bin: parse + classify + activate texture interception ═══
  function processMapBin(buffer) {
    var t0 = performance.now();
    var originalArray = new Uint8Array(buffer);
    remoteLog('INFO', 'ORIGINAL_HEADER', { hex: hexDump(originalArray, 64) });
    logStep(1, 'Parsing map.bin (' + (buffer.byteLength / 1024).toFixed(1) + ' KB)...');
    var parsed;
    try { parsed = parseFullMapBin(buffer); }
    catch(e) { logErr('PARSE FAILED: ' + e.message + '\n' + e.stack); throw e; }
    var t1 = performance.now();
    var c1 = parsed.collisionData1, c2 = parsed.collisionData2;
    var colTotal = c1.shapesType1.length + c1.shapesType2.length + c1.shapesType3.length + c2.shapesType1.length + c2.shapesType2.length + c2.shapesType3.length;
    var matIDs = Object.keys(parsed.materials);
    var texTotal = 0; for (var k in parsed.materials) texTotal += parsed.materials[k].texParams.length;
    logStep(2, 'Parse OK (' + (t1 - t0).toFixed(0) + 'ms) — bits=' + parsed.bits.length +
      ' atlases=' + parsed.atlases.length + ' col=' + colTotal +
      ' mat=' + matIDs.length + '(tex=' + texTotal + ')' + ' props=' + parsed.props.length);
    texNameToCategory = {};
    categoryCounts = {};
    for (var mk in parsed.materials) {
      var mat = parsed.materials[mk];
      var cat = classifyMaterial(mat.name, mat.shader);
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      for (var mt = 0; mt < mat.texParams.length; mt++) {
        var tn = mat.texParams[mt].origTexName;
        if (tn && !texNameToCategory[tn]) { texNameToCategory[tn] = { category: cat, matName: mat.name }; }
      }
    }
    for (var aa = 0; aa < parsed.atlases.length; aa++) {
      var atlas = parsed.atlases[aa];
      if (atlas.name && !texNameToCategory[atlas.name]) { texNameToCategory[atlas.name] = { category: 'object', matName: 'atlas_' + atlas.name }; }
      for (var ar = 0; ar < atlas.rects.length; ar++) {
        var r = atlas.rects[ar];
        if (r.s1 && !texNameToCategory[r.s1]) { texNameToCategory[r.s1] = { category: 'object', matName: 'atlas_rect' }; }
        if (r.s2 && !texNameToCategory[r.s2]) { texNameToCategory[r.s2] = { category: 'object', matName: 'atlas_rect' }; }
      }
    }
    // Clear caches
    urlToMeta = {};
    textureInterceptionActive = true;
    var catNames = Object.keys(categoryCounts).sort();
    var catLog = [];
    for (var ci = 0; ci < catNames.length; ci++) catLog.push(catNames[ci] + ':' + categoryCounts[catNames[ci]]);
    logStep(3, 'Texture interception ACTIVE — ' + Object.keys(texNameToCategory).length + ' texNames, categories: ' + catLog.join(', '));
    logStep(4, 'Passing through original map.bin (no modification). Total ' + (performance.now() - t0).toFixed(0) + 'ms');
    updateStatus();
    return originalArray;
  }

  // ═══ Image.src interception ═══
  var origImgSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    get: function() { return origImgSrc.get.call(this); },
    set: function(value) {
      var url = String(value);
      if (isEnabled() && textureInterceptionActive && isImageUrl(url)) {
        var texName = extractTexNameFromUrl(url);
        if (shouldHideTexture(texName, url)) {
          origImgSrc.set.call(this, getTransparentBlobUrl());
          return;
        }
        if (texName) {
          var result = getColorForTexName(texName);
          var blobUrl = getReplacementBlobUrl({ hsla: result.hsla, cat: result.cat, hide: false });
          if (blobUrlToMeta[blobUrl]) blobUrlToMeta[blobUrl].cat = result.cat;
          origImgSrc.set.call(this, blobUrl);
          return;
        }
      }
      origImgSrc.set.call(this, value);
    },
    configurable: true
  });

  // ═══ setAttribute interception for img.src ═══
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (this instanceof HTMLImageElement && name.toLowerCase() === 'src' && isEnabled() && textureInterceptionActive) {
      var url = String(value);
      if (isImageUrl(url)) {
        var texName = extractTexNameFromUrl(url);
        if (shouldHideTexture(texName, url)) {
          origSetAttribute.call(this, 'src', getTransparentBlobUrl());
          return;
        }
        if (texName) {
          var result = getColorForTexName(texName);
          var blobUrl = getReplacementBlobUrl({ hsla: result.hsla, cat: result.cat, hide: false });
          if (blobUrlToMeta[blobUrl]) blobUrlToMeta[blobUrl].cat = result.cat;
          origSetAttribute.call(this, 'src', blobUrl);
          return;
        }
      }
    }
    return origSetAttribute.call(this, name, value);
  };

  // ═══ Response.prototype.blob override (propagate meta to blob) ═══
  var origResponseBlob = Response.prototype.blob;
  Response.prototype.blob = async function() {
    var blob = await origResponseBlob.call(this);
    if (this._msMeta) { blobMeta.set(blob, this._msMeta); }
    return blob;
  };

  // ═══ createImageBitmap interception ═══
  var origCreateImageBitmap = window.createImageBitmap;
  window.createImageBitmap = async function(blob) {
    var meta = blobMeta.get(blob);
    if (meta) {
      var canvas = getReplacementCanvas(meta);
      return await origCreateImageBitmap.call(this, canvas);
    }
    return origCreateImageBitmap.apply(this, arguments);
  };

  // ═══ texImage2D / texSubImage2D interception (GPU upload level) ═══
  function interceptTexImageSource(args) {
    if (!isEnabled() || !textureInterceptionActive) return args;
    var source = args[args.length - 1];
    if (source instanceof HTMLImageElement) {
      var src = source.src;
      var meta = resolveMetaForUrl(src);
      if (meta) {
        args = args.slice();
        args[args.length - 1] = getReplacementCanvas(meta);
        return args;
      }
    }
    return args;
  }
  var origTexImage2D = WebGLRenderingContext.prototype.texImage2D;
  WebGLRenderingContext.prototype.texImage2D = function() {
    var args = interceptTexImageSource(arguments);
    return origTexImage2D.apply(this, args);
  };
  var origTexSubImage2D = WebGLRenderingContext.prototype.texSubImage2D;
  WebGLRenderingContext.prototype.texSubImage2D = function() {
    var args = interceptTexImageSource(arguments);
    return origTexSubImage2D.apply(this, args);
  };
  // WebGL2
  if (typeof WebGL2RenderingContext !== 'undefined') {
    var origTexImage2Dv2 = WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D = function() {
      var args = interceptTexImageSource(arguments);
      return origTexImage2Dv2.apply(this, args);
    };
    var origTexSubImage2Dv2 = WebGL2RenderingContext.prototype.texSubImage2D;
    WebGL2RenderingContext.prototype.texSubImage2D = function() {
      var args = interceptTexImageSource(arguments);
      return origTexSubImage2Dv2.apply(this, args);
    };
  }

  // ═══ Fetch interception ═══
  var originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    var url = (input instanceof Request) ? input.url : String(input);
    if (!_msInternal && url && url.indexOf('map.bin') !== -1 && isEnabled() && typeof pako !== 'undefined') {
      _msInternal = true;
      log('═══ Intercepted fetch: ' + url + ' ═══');
      try {
        var resp = await originalFetch.call(this, input, init);
        if (!resp.ok) { logWarn('Response not OK: ' + resp.status); _msInternal = false; return resp; }
        var buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength === 0) { logWarn('Empty response body'); _msInternal = false; return originalFetch.call(this, input, init); }
        log('Original size: ' + (buf.byteLength / 1024).toFixed(1) + ' KB');
        processMapBin(new Uint8Array(buf));
        _msInternal = false;
        log('═══ Passing through original map.bin ═══');
        return new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' }, status: 200 });
      } catch(e) {
        _msInternal = false;
        logErr('Map processing failed, using original: ' + e.message);
        try { return await originalFetch.call(this, input, init); } catch(e2) { throw e2; }
      }
    }
    if (!_msInternal && isEnabled() && textureInterceptionActive && isImageUrl(url) && (matchesTexName(url) || VEGETATION_PATTERN.test(url))) {
      var texName = extractTexNameFromUrl(url);
      if (shouldHideTexture(texName, url)) {
        var resp2 = new Response(TRANSPARENT_PNG_BYTES, { headers: { 'Content-Type': 'image/png' }, status: 200 });
        resp2._msMeta = { hide: true };
        return resp2;
      }
      var result = getColorForTexName(texName || url);
      var pngBytes = getReplacementPNG({ hsla: result.hsla, cat: result.cat, hide: false });
      var resp3 = new Response(pngBytes, { headers: { 'Content-Type': 'image/png' }, status: 200 });
      resp3._msMeta = { hsla: result.hsla, cat: result.cat, hide: false };
      return resp3;
    }
    return originalFetch.call(this, input, init);
  };

  // ═══ XHR interception ═══
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    var urlStr = String(url);
    this._msUrl = urlStr; this._msMethod = method;
    this._msMatch = (urlStr.indexOf('map.bin') !== -1 && isEnabled() && typeof pako !== 'undefined');
    this._msTexMatch = (isEnabled() && textureInterceptionActive && isImageUrl(urlStr) && (matchesTexName(urlStr) || VEGETATION_PATTERN.test(urlStr)));
    if (!this._msMatch && !this._msTexMatch) return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._msTexMatch && isEnabled() && textureInterceptionActive) {
      var self = this;
      var texName = extractTexNameFromUrl(this._msUrl);
      if (shouldHideTexture(texName, this._msUrl)) {
        var transBlob = new Blob([TRANSPARENT_PNG_BYTES], { type: 'image/png' });
        var transUrl = URL.createObjectURL(transBlob);
        this._msTexMatch = false;
        originalOpen.call(self, 'GET', transUrl); originalSend.call(self); return;
      }
      var result = getColorForTexName(texName || this._msUrl);
      var pngBytes = getReplacementPNG({ hsla: result.hsla, cat: result.cat, hide: false });
      var blob = new Blob([pngBytes], { type: 'image/png' });
      blobMeta.set(blob, { hsla: result.hsla, cat: result.cat, hide: false });
      var blobUrl = URL.createObjectURL(blob);
      this._msTexMatch = false;
      originalOpen.call(self, 'GET', blobUrl); originalSend.call(self); return;
    }
    if (this._msMatch && isEnabled()) {
      var self2 = this; var savedType = this.responseType;
      _msInternal = true;
      originalFetch.call(window, this._msUrl)
        .then(function(resp) { return resp.arrayBuffer(); })
        .then(function(buf) {
          processMapBin(new Uint8Array(buf));
          var blob = new Blob([buf], { type: 'application/octet-stream' });
          var blobUrl = URL.createObjectURL(blob);
          _msInternal = false;
          originalOpen.call(self2, 'GET', blobUrl); self2.responseType = savedType; originalSend.call(self2);
        })
        .catch(function(e) {
          _msInternal = false;
          originalOpen.call(self2, self2._msMethod, self2._msUrl); self2.responseType = savedType; originalSend.call(self2);
        });
      return;
    }
    return originalSend.call(this, body);
  };

  // ═══ Status overlay ═══
  var overlay = null;
  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'map-simplifier-status';
    overlay.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;background:rgba(0,20,40,0.92);color:#76ff33;border:1px solid rgba(118,255,51,0.3);border-radius:8px;padding:8px 12px;font-size:12px;font-family:monospace;max-width:380px;pointer-events:none;user-select:none';
    updateStatus();
    document.body.appendChild(overlay);
  }
  function updateStatus() {
    if (!overlay) return;
    var enabled = isEnabled();
    var pakoOk = typeof pako !== 'undefined';
    var texCount = texNameToCategory ? Object.keys(texNameToCategory).length : 0;
    var active = enabled && textureInterceptionActive;
    var statusColor = !pakoOk ? '#ff6644' : !enabled ? '#8a9ba8' : active ? '#76ff33' : '#f39c12';
    var statusText = !pakoOk ? 'ERROR: pako not loaded' : !enabled ? 'DISABLED' : active ? ('ACTIVE v' + VERSION + ' — ' + texCount + ' texNames') : 'WAITING for map.bin...';
    var catSwatches = '';
    if (active && categoryCounts) {
      var catOrder = ['flat', 'facade', 'slope', 'vegetation', 'terrain', 'object'];
      for (var ci = 0; ci < catOrder.length; ci++) {
        var c = catOrder[ci];
        if (categoryCounts[c]) { catSwatches += '<span style="background:' + CATEGORY_SWATCH[c] + ';display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:2px;" title="' + c + ':' + categoryCounts[c] + '"></span>'; }
      }
    }
    var catCountsLine = '';
    if (active && categoryCounts) {
      var catParts = [];
      for (var ck in categoryCounts) { catParts.push(ck + ':' + categoryCounts[ck]); }
      catCountsLine = '<div style="color:#aaa;font-size:10px;margin-top:2px;">' + catParts.join(' | ') + '</div>';
    }
    var imgLine = active ? '<div style="color:' + (customImageReady ? '#76ff33' : '#8a9ba8') + ';font-size:10px;margin-top:2px;">IMG: ' + (customImageReady ? ('ON ' + customImageWidth + 'x' + customImageHeight + ' a' + IMG_ALPHA.toFixed(2)) : 'OFF (HSL fallback)') + '</div>' : '';
    overlay.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;color:' + statusColor + ';">Map Simplifier v' + VERSION + '</div>' +
      '<div style="color:' + statusColor + ';">' + statusText + '</div>' +
      '<div style="margin-top:2px;">' + catSwatches + '</div>' + catCountsLine + imgLine +
      '<div style="color:#888;font-size:10px;margin-top:2px;">Ctrl+Shift+M toggle | Logs: localhost:3457</div>';
  }

  // ═══ Custom image config panel ═══
  var configPanel = null;
  var configThumb = null;
  var configStatus = null;
  var configAlphaSlider = null;
  var configAlphaLabel = null;
  var fileInput = null;

  function createConfigPanel() {
    configPanel = document.createElement('div');
    configPanel.id = 'map-simplifier-config';
    configPanel.style.cssText = 'position:fixed;top:44px;right:8px;z-index:2147483647;background:rgba(0,20,40,0.92);color:#76ff33;border:1px solid rgba(118,255,51,0.3);border-radius:8px;padding:8px;font-size:12px;font-family:monospace;width:220px;pointer-events:auto;user-select:none';
    configPanel.innerHTML =
      '<div style="font-weight:bold;margin-bottom:4px;">Custom Image</div>' +
      '<div id="ms-thumb-wrap" style="margin-bottom:6px;"></div>' +
      '<div id="ms-config-status" style="font-size:10px;margin-bottom:6px;"></div>' +
      '<div style="margin-bottom:6px;">' +
        '<div style="font-size:10px;color:#aaa;margin-bottom:2px;">Opacity: <span id="ms-alpha-label">0.25</span></div>' +
        '<input id="ms-alpha-slider" type="range" min="0" max="1" step="0.05" value="0.25" style="width:100%;accent-color:#76ff33;cursor:pointer;">' +
      '</div>' +
      '<div style="display:flex;gap:4px;">' +
        '<button id="ms-upload-btn" style="flex:1;background:rgba(118,255,51,0.12);color:#76ff33;border:1px solid rgba(118,255,51,0.4);border-radius:4px;padding:4px 8px;cursor:pointer;font-family:monospace;font-size:11px;">Upload</button>' +
        '<button id="ms-clear-btn" style="flex:1;background:rgba(255,102,68,0.12);color:#ff6644;border:1px solid rgba(255,102,68,0.4);border-radius:4px;padding:4px 8px;cursor:pointer;font-family:monospace;font-size:11px;">Clear</button>' +
      '</div>';
    document.body.appendChild(configPanel);
    configThumb = document.getElementById('ms-thumb-wrap');
    configStatus = document.getElementById('ms-config-status');
    configAlphaSlider = document.getElementById('ms-alpha-slider');
    configAlphaLabel = document.getElementById('ms-alpha-label');

    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    document.getElementById('ms-upload-btn').addEventListener('click', function() { fileInput.click(); });
    document.getElementById('ms-clear-btn').addEventListener('click', function() { clearCustomImage(); });
    configAlphaSlider.addEventListener('input', function(e) {
      var a = parseFloat(e.target.value);
      configAlphaLabel.textContent = (isNaN(a) ? '0.25' : a.toFixed(2));
      changeAlpha(a);
    });
    fileInput.addEventListener('change', function(e) {
      var file = e.target.files && e.target.files[0];
      if (file) applyCustomImageFile(file);
      fileInput.value = '';
    });
    updateConfigUI();
  }

  function applyCustomImageFile(file) {
    var reader = new FileReader();
    reader.onload = function() {
      var rawDataURL = reader.result;
      var img = new Image();
      img.onload = function() {
        try {
          var opaqueCanvas = resampleToCanvas(img, CUSTOM_MAX_DIM);
          var opaqueDataURL = opaqueCanvas.toDataURL('image/png');
          setStoredCustomImg(opaqueDataURL);
          releaseCustomImage();
          customOpaqueCanvas = opaqueCanvas;
          customSourceDataURL = opaqueDataURL;
          buildRuntimeResources();
          log('Custom image uploaded: ' + customImageWidth + 'x' + customImageHeight + ' alpha=' + IMG_ALPHA);
          updateStatus(); updateConfigUI();
        } catch(e) {
          logWarn('Custom image processing failed: ' + e.message);
          updateStatus(); updateConfigUI();
        }
      };
      img.onerror = function() { logWarn('Selected file is not a valid image'); updateConfigUI(); };
      img.src = rawDataURL;
    };
    reader.onerror = function() { logWarn('File read failed'); };
    reader.readAsDataURL(file);
  }

  function clearCustomImage() {
    clearStoredCustomImg();
    clearStoredAlpha();
    IMG_ALPHA = DEFAULT_ALPHA;
    releaseCustomImage();
    log('Custom image cleared — reverting to HSL fallback');
    updateStatus(); updateConfigUI();
  }

  function updateConfigUI() {
    if (!configPanel) return;
    if (configAlphaSlider) configAlphaSlider.value = IMG_ALPHA;
    if (configAlphaLabel) configAlphaLabel.textContent = IMG_ALPHA.toFixed(2);
    if (customImageReady && customSourceDataURL) {
      configThumb.innerHTML = '<img src="' + customSourceDataURL + '" style="width:100%;max-width:200px;border:1px solid rgba(118,255,51,0.3);border-radius:4px;display:block;">';
      configStatus.textContent = 'IMG: ON ' + customImageWidth + 'x' + customImageHeight + ' alpha=' + IMG_ALPHA.toFixed(2);
      configStatus.style.color = '#76ff33';
    } else {
      configThumb.innerHTML = '<div style="width:100%;height:60px;border:1px dashed rgba(118,255,51,0.3);border-radius:4px;display:flex;align-items:center;justify-content:center;color:#5a7a5a;font-size:10px;">No image (HSL fallback)</div>';
      configStatus.textContent = 'IMG: OFF';
      configStatus.style.color = '#8a9ba8';
    }
  }

  // ═══ Keyboard toggle ═══
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
      e.preventDefault(); e.stopPropagation();
      var wasEnabled = isEnabled();
      setEnabled(!wasEnabled);
      if (wasEnabled) {
        texNameToCategory = null; categoryCounts = null; textureInterceptionActive = false; urlToMeta = {};
        log('Deactivated — texture interception OFF');
      }
      log('Toggled: ' + (isEnabled() ? 'ENABLED' : 'DISABLED'));
      updateStatus();
    }
  }, true);

  function initUI() {
    if (document.getElementById('map-simplifier-status')) return;
    createOverlay();
    createConfigPanel();
    log(typeof pako === 'undefined' ? 'ERROR: pako not loaded!' : 'Ready. texImage2D + createImageBitmap + Image.src + fetch + XHR interception.');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
  else initUI();

  preloadCustomImage();
  log('Script loaded (v' + VERSION_FULL + ')');
})();
