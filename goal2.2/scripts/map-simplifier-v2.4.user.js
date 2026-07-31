// ==UserScript==
// @name         Tanki Collision Overlay v2.4
// @namespace    https://github.com/0d00no0721/TOandDDD
// @version      2.4.0
// @description  2D canvas overlay, dual-path game camera sync (exact VP from mvp×modelToWorld⁻¹, or camera vectors+projection), battle exit detection, frustum culling, low-overhead WebGL hooks. Alt+C toggle, M manual, D debug dump. Default ON.
// @match        https://*.3dtank.com/*
// @match        https://3dtank.com/*
// @match        https://*.tankionline.com/*
// @match        https://tankionline.com/*
// @match        https://*.test-eu.tankionline.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
  'use strict';

  var OVERLAY_KEY = 'Tanki_Collision_Overlay_Enabled';

  // Debug constants — flip these if the overlay is misaligned in the game
  var FLIP_FORWARD = false;    // true if overlay appears mirrored horizontally
  var FLIP_SCREEN_Y = false;   // true if overlay appears vertically flipped
  var PROJ_IS_VP = false;      // true if captured projection matrix is actually full view-projection
  var SCALE = 1;               // world unit scale factor (1 = assume same units as game)
  var EST_FOV = 65;            // estimated FOV (degrees) used when game projection cannot be captured
  var STROKE_MIN_PX = 3;       // minimum screen radius (px) for a shape to be stroked (below: fill only)
  var CAM_FRESH_MS = 2000;     // max gap of GL activity before considering the battle over
  var M2W_MATCH_MS = 80;       // max age of paired modelToWorld/mvp uniforms for VP derivation

  function isOverlayEnabled() { try { return localStorage.getItem(OVERLAY_KEY) !== 'false'; } catch(e) { return true; } }
  function setOverlayEnabled(v) { try { localStorage.setItem(OVERLAY_KEY, v ? 'true' : 'false'); } catch(e) {} }

  var LOG_URL = 'http://localhost:3456/log';
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

  function log(m) { console.log('%c[CO v2.4] ' + m, 'color:#00ccff'); remoteLog('INFO', m); }
  function logStep(n, m) { var msg = '[Step ' + n + '] ' + m; console.log('%c[CO v2.4] ' + msg, 'color:#00ff99'); remoteLog('INFO', msg); }
  function logWarn(m) { console.warn('[CO v2.4] ' + m); remoteLog('WARN', m); }
  function logErr(m) { console.error('[CO v2.4] ' + m); remoteLog('ERROR', m); }

  // ═══ State ═══
  var collisionData1 = null;
  var collisionData2 = null;
  var collisionReady = false;
  var overlayActive = false;
  var depsReady = false;
  var gameCanvas = null;
  var overlayCanvas = null;
  var renderer2d = null;
  var renderGroups = null;
  var totalShapes = 0;
  var bounds = null;
  var animFrameId = null;
  var uniformTracker = null;
  var pakoOk = false;
  var threeOk = false;
  var _msInternal = false;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Camera state captured from game uniforms (dual path)
  var cameraState = {
    position: null, right: null, up: null,       // Path A: camera basis
    projection: null, projName: null,            // Path A: projection matrix
    vp: null, vpSource: null,                    // Path B: exact view-projection (mvp × modelToWorld⁻¹)
    viewMatrix: null,                            // Path A fallback: view from viewToModelMatrix⁻¹
    vpLogged: false
  };
  var pendingM2W = null;   // { v: [16], t: ms } recent modelToWorldMatrix
  var pendingMvp = null;   // { v: [16], t: ms } recent mvp
  var lastGLActivity = 0;  // last WebGL uniform activity (battle liveness)

  function cameraReady() {
    if (cameraState.vp) return true;
    if (cameraState.position && cameraState.right && cameraState.up && cameraState.projection) return true;
    if (cameraState.viewMatrix && cameraState.projection) return true;
    return false;
  }
  function glFresh() { return (performance.now() - lastGLActivity) < CAM_FRESH_MS; }

  // Manual orbit camera (inspection only, via M key)
  var manualCam = { yaw: 0.8, pitch: 0.45, dist: 1.4, mode: 'orbit' };
  var forceManual = false;
  var currentCameraMode = 'none';
  var manualDragging = false, lastPointerX = 0, lastPointerY = 0;

  // THREE math objects (lazily created)
  var viewMatrix = null, projMatrix = null, vpMatrix = null;
  var manualViewMatrix = null, manualProjMatrix = null;
  var reuseEuler = null, reuseMat = null, reuseVec = null;

  var heartbeatCounter = 0;
  var lastHeartbeatTime = 0;
  var drawnShapes = 0;

  // Cached canvas metrics (updated at most every 300ms to avoid layout thrash)
  var canvasMetrics = { left: 0, top: 0, w: 0, h: 0, visible: false, lastCheck: 0 };
  var lastSizeKey = null;

  // ═══ Uniform Tracker (lightweight: name registry only) ═══
  function UniformTracker() {
    this.locToName = new Map();
    this.uniqueUniformNames = {};
  }

  UniformTracker.prototype.registerLocation = function(loc, name) {
    if (!loc || !name) return;
    if (!this.locToName.has(loc)) {
      this.locToName.set(loc, { name: name });
      if (!this.uniqueUniformNames[name]) {
        this.uniqueUniformNames[name] = { type: null, firstSeen: Date.now() };
        log('Uniform discovered: "' + name + '"');
      }
    }
  };

  // ═══ Camera uniform capture (cheap) ═══
  function captureCameraUniform(name, v) {
    if (!v || v.length < 3) return;
    lastGLActivity = performance.now();
    if (name === 'cameraPosition') {
      if (!cameraState.position) log('Camera position captured: ' + v[0].toFixed(0) + ',' + v[1].toFixed(0) + ',' + v[2].toFixed(0));
      cameraState.position = [v[0], v[1], v[2]];
    } else if (name === 'cameraRight') {
      if (!cameraState.right) log('Camera right captured');
      cameraState.right = [v[0], v[1], v[2]];
    } else if (name === 'cameraUp') {
      if (!cameraState.up) log('Camera up captured');
      cameraState.up = [v[0], v[1], v[2]];
    }
  }

  // ═══ Matrix capture: projection, modelToWorld, mvp, viewToModel ═══
  function looksLikeVP(e) {
    return isFinite(e[0]) && isFinite(e[15])
      && Math.abs(e[3]) < 0.01 && Math.abs(e[7]) < 0.01 && Math.abs(e[15]) < 0.01
      && Math.abs(e[11]) > 0.5;
  }
  function looksLikeView(e) {
    return Math.abs(e[3]) < 0.01 && Math.abs(e[7]) < 0.01 && Math.abs(e[11]) < 0.01 && Math.abs(e[15] - 1) < 0.01;
  }

  function tryDeriveVP() {
    var now = performance.now();
    if (!pendingM2W || !pendingMvp) return;
    if (now - pendingM2W.t > M2W_MATCH_MS || now - pendingMvp.t > M2W_MATCH_MS) return;
    try {
      var mvpM = new THREE.Matrix4().fromArray(pendingMvp.v);
      var m2w = new THREE.Matrix4().fromArray(pendingM2W.v);
      var inv = m2w.clone().invert();
      var vp = new THREE.Matrix4().multiplyMatrices(mvpM, inv);
      var e = vp.elements;
      if (looksLikeVP(e)) {
        cameraState.vp = Array.prototype.slice.call(e, 0, 16);
        cameraState.vpSource = 'mvp×m2w';
        if (!cameraState.vpLogged) {
          cameraState.vpLogged = true;
          log('Exact VP derived from mvp × modelToWorld⁻¹');
        }
        lastGLActivity = performance.now();
      }
    } catch(err) {}
    pendingM2W = null;
    pendingMvp = null;
  }

  function onMat4Set(name, value) {
    if (!name || !value || value.length < 16) return;
    lastGLActivity = performance.now();
    if (name === 'vertexProjectionMatrix' || name === 'projectionMatrix' || name === 'projection') {
      if (!cameraState.projection) log('Projection matrix captured via "' + name + '"');
      cameraState.projection = Array.prototype.slice.call(value, 0, 16);
      cameraState.projName = name;
    } else if (name === 'modelToWorldMatrix') {
      pendingM2W = { v: Array.prototype.slice.call(value, 0, 16), t: performance.now() };
      tryDeriveVP();
    } else if (name === 'mvp' || name === 'modelViewProjectionMatrix' || name === 'uMVP') {
      pendingMvp = { v: Array.prototype.slice.call(value, 0, 16), t: performance.now() };
      tryDeriveVP();
    } else if (name === 'viewToModelMatrix') {
      try {
        var v2m = new THREE.Matrix4().fromArray(value);
        var vm = v2m.clone().invert();
        var ve = vm.elements;
        if (looksLikeView(ve)) {
          cameraState.viewMatrix = Array.prototype.slice.call(ve, 0, 16);
        }
      } catch(err) {}
    }
  }

  // ═══ Hook WebGL (no double-wrap: natives saved before patching) ═══
  function installUniformHooks() {
    if (uniformTracker) return;
    uniformTracker = new UniformTracker();

    var g1 = WebGLRenderingContext.prototype;
    var n1 = {
      gul: g1.getUniformLocation, um4: g1.uniformMatrix4fv,
      u3fv: g1.uniform3fv, u3f: g1.uniform3f, u4fv: g1.uniform4fv
    };
    var has2 = typeof WebGL2RenderingContext !== 'undefined';
    var g2 = has2 ? WebGL2RenderingContext.prototype : null;
    var n2 = has2 ? {
      gul: g2.getUniformLocation, um4: g2.uniformMatrix4fv,
      u3fv: g2.uniform3fv, u3f: g2.uniform3f, u4fv: g2.uniform4fv
    } : null;

    function makeHooks(nats) {
      return {
        gul: function(program, name) {
          var loc = nats.gul.call(this, program, name);
          if (loc !== null && name) { try { uniformTracker.registerLocation(loc, name); } catch(e) {} }
          return loc;
        },
        um4: function(location, transpose, value) {
          if (uniformTracker) {
            var info = uniformTracker.locToName.get(location);
            if (info && info.name) { try { onMat4Set(info.name, value); } catch(e) {} }
          }
          return nats.um4.call(this, location, transpose, value);
        },
        u3fv: function(location, value) {
          if (uniformTracker) {
            var info = uniformTracker.locToName.get(location);
            if (info && info.name) { try { captureCameraUniform(info.name, value); } catch(e) {} }
          }
          return nats.u3fv.call(this, location, value);
        },
        u3f: function(location, x, y, z) {
          if (uniformTracker) {
            var info = uniformTracker.locToName.get(location);
            if (info && info.name) { try { captureCameraUniform(info.name, [x, y, z]); } catch(e) {} }
          }
          return nats.u3f.call(this, location, x, y, z);
        },
        u4fv: function(location, value) {
          if (uniformTracker) {
            var info = uniformTracker.locToName.get(location);
            if (info && info.name) { try { captureCameraUniform(info.name, value); } catch(e) {} }
          }
          return nats.u4fv.call(this, location, value);
        }
      };
    }

    var h1 = makeHooks(n1);
    g1.getUniformLocation = h1.gul;
    g1.uniformMatrix4fv = h1.um4;
    g1.uniform3fv = h1.u3fv;
    g1.uniform3f = h1.u3f;
    g1.uniform4fv = h1.u4fv;

    if (has2) {
      var h2 = makeHooks(n2);
      // If WebGL2 methods are aliased/inherited from WebGL1's natives, reuse h1 (same implementation → safe).
      // If WebGL2 has independent natives, use h2 (calls the true WebGL2 native).
      function patch(method, key) {
        if (n2[key] === n1[key]) g2[method] = h1[key];
        else g2[method] = h2[key];
      }
      patch('getUniformLocation', 'gul');
      patch('uniformMatrix4fv', 'um4');
      patch('uniform3fv', 'u3fv');
      patch('uniform3f', 'u3f');
      patch('uniform4fv', 'u4fv');
    }

    logStep(5, 'WebGL uniform hooks installed (single-wrap, camera capture)');
  }

  // ═══ Hex dump helper ═══
  function hexDump(buf, max) {
    max = max || 64;
    var bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    var len = Math.min(bytes.length, max);
    var out = [];
    for (var i = 0; i < len; i++) { out.push(bytes[i].toString(16).padStart(2, '0')); }
    return out.join(' ') + (bytes.length > max ? ' ... (' + bytes.length + ' bytes)' : ' (' + bytes.length + ' bytes)');
  }

  // ═══ BinaryStream (ported from v1.14) ═══
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

  // ═══ Packet unwrap (from v1.14) ═══
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

  // ═══ Read option bits (from v1.14) ═══
  function readOptionBitsRaw(packet) {
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
    return { bits: bits };
  }

  // ═══ Full parse map.bin (from v1.14) ═══
  function parseFullMapBin(buffer) {
    var stream = new BinaryStream(buffer);
    var packet = unwrapPacket(stream);
    var optResult = readOptionBitsRaw(packet);
    var bits = optResult.bits;
    var optMask = bits.slice().reverse();
    var popBit = function() { return optMask.pop(); };
    var result = { atlases: [], unknownArr: null, collisionData1: null, collisionData2: null, materials: {}, unknown28: null, props: [] };

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
      for (var iu = 0; iu < uLen; iu++) { uArr.push({ id: packet.readUint32(false), name: packet.readString(), bytes12: new Uint8Array(packet.readBytes(12)), str: packet.readString() }); }
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

  // ═══ Collision color scheme: type-based with group light/dark ═══
  var COLORS = {
    coll1: { type1: 0x3399FF, type2: 0xFFCC33, type3: 0xCC66FF },
    coll2: { type1: 0x2266AA, type2: 0xCC9922, type3: 0x8844CC }
  };

  function hexToRgb(hex) {
    return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
  }

  // ═══ Precompute world-space vertices + bounding spheres (once) ═══
  var BOX_CORNERS = [
    -1,-1,-1,  1,-1,-1,  1,1,-1,  -1,1,-1,
    -1,-1,1,   1,-1,1,   1,1,1,   -1,1,1
  ];

  function computeBoxVerts(pos, rot, half) {
    var out = new Float32Array(24);
    reuseEuler.set(rot[0], rot[1], rot[2], 'ZYX');
    reuseMat.makeRotationFromEuler(reuseEuler);
    for (var i = 0; i < 8; i++) {
      var ix = i * 3;
      reuseVec.set(BOX_CORNERS[ix] * half[0], BOX_CORNERS[ix + 1] * half[1], BOX_CORNERS[ix + 2] * half[2]);
      reuseVec.applyMatrix4(reuseMat);
      out[ix] = reuseVec.x + pos[0];
      out[ix + 1] = reuseVec.y + pos[1];
      out[ix + 2] = reuseVec.z + pos[2];
    }
    return out;
  }

  function computeTriVerts(pos, rot, verts9) {
    var out = new Float32Array(9);
    reuseEuler.set(rot[0], rot[1], rot[2], 'ZYX');
    reuseMat.makeRotationFromEuler(reuseEuler);
    for (var i = 0; i < 3; i++) {
      var ix = i * 3;
      reuseVec.set(verts9[ix], verts9[ix + 1], verts9[ix + 2]);
      reuseVec.applyMatrix4(reuseMat);
      out[ix] = reuseVec.x + pos[0];
      out[ix + 1] = reuseVec.y + pos[1];
      out[ix + 2] = reuseVec.z + pos[2];
    }
    return out;
  }

  // Generic bounding sphere: center = vertex average, radius = max distance from center
  function computeSphere(verts) {
    var n = verts.length / 3;
    var cx = 0, cy = 0, cz = 0;
    for (var i = 0; i < n; i++) { cx += verts[i * 3]; cy += verts[i * 3 + 1]; cz += verts[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    var r2 = 0;
    for (var j = 0; j < n; j++) {
      var dx = verts[j * 3] - cx, dy = verts[j * 3 + 1] - cy, dz = verts[j * 3 + 2] - cz;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) r2 = d2;
    }
    return { x: cx, y: cy, z: cz, r: Math.sqrt(r2) };
  }

  function makeGroup(hex, shapes) {
    var rgb = hexToRgb(hex);
    var spheres = new Float32Array(shapes.length * 4);
    for (var s = 0; s < shapes.length; s++) {
      var sp = computeSphere(shapes[s]);
      spheres[s * 4] = sp.x; spheres[s * 4 + 1] = sp.y; spheres[s * 4 + 2] = sp.z; spheres[s * 4 + 3] = sp.r;
    }
    return {
      fill: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.35)',
      stroke: 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.9)',
      shapes: shapes,
      spheres: spheres
    };
  }

  function buildRenderShapes() {
    var t0 = performance.now();
    if (!reuseEuler) { reuseEuler = new THREE.Euler(); reuseMat = new THREE.Matrix4(); reuseVec = new THREE.Vector3(); }
    renderGroups = [];
    totalShapes = 0;
    var pair = [['coll1', collisionData1], ['coll2', collisionData2]];
    var typeCounts = { t1: 0, t2: 0, t3: 0 };
    var parts = [];

    for (var p = 0; p < pair.length; p++) {
      var colKey = pair[p][0], colData = pair[p][1];
      if (!colData) continue;
      var colorSet = COLORS[colKey];

      var t1 = [];
      if (colData.shapesType1) {
        for (var i = 0; i < colData.shapesType1.length; i++) {
          var d = colData.shapesType1[i];
          t1.push(computeBoxVerts([d[0], d[1], d[2]], [d[3], d[4], d[5]], [d[6] / 2, d[7] / 2, d[8] / 2]));
          typeCounts.t1++;
        }
      }
      var t2 = [];
      if (colData.shapesType2) {
        for (var j = 0; j < colData.shapesType2.length; j++) {
          var d2 = colData.shapesType2[j];
          t2.push(computeBoxVerts([d2.data[0], d2.data[1], d2.data[2]], [d2.data[3], d2.data[4], d2.data[5]], [d2.f2 / 2, d2.f1 / 2, 2.5]));
          typeCounts.t2++;
        }
      }
      var t3 = [];
      if (colData.shapesType3) {
        for (var k = 0; k < colData.shapesType3.length; k++) {
          var d3 = colData.shapesType3[k];
          t3.push(computeTriVerts([d3.data[0], d3.data[1], d3.data[2]], [d3.data[3], d3.data[4], d3.data[5]], [d3.data[6], d3.data[7], d3.data[8], d3.data[9], d3.data[10], d3.data[11], d3.data[12], d3.data[13], d3.data[14]]));
          typeCounts.t3++;
        }
      }
      if (t1.length) { parts.push(makeGroup(colorSet.type1, t1)); totalShapes += t1.length; }
      if (t2.length) { parts.push(makeGroup(colorSet.type2, t2)); totalShapes += t2.length; }
      if (t3.length) { parts.push(makeGroup(colorSet.type3, t3)); totalShapes += t3.length; }
    }
    renderGroups = parts;
    logStep(3, 'Precomputed world vertices + spheres (' + typeCounts.t1 + ' type1, ' + typeCounts.t2 + ' type2, ' + typeCounts.t3 + ' type3, ' + renderGroups.length + ' groups) in ' + (performance.now() - t0).toFixed(0) + 'ms');
    computeBounds();
  }

  function computeBounds() {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    if (renderGroups) {
      for (var g = 0; g < renderGroups.length; g++) {
        var shapes = renderGroups[g].shapes;
        for (var s = 0; s < shapes.length; s++) {
          var v = shapes[s];
          for (var i = 0; i < v.length; i += 3) {
            if (v[i] < minX) minX = v[i]; if (v[i] > maxX) maxX = v[i];
            if (v[i + 1] < minY) minY = v[i + 1]; if (v[i + 1] > maxY) maxY = v[i + 1];
            if (v[i + 2] < minZ) minZ = v[i + 2]; if (v[i + 2] > maxZ) maxZ = v[i + 2];
          }
        }
      }
    }
    if (!isFinite(minX)) { minX = minY = minZ = -1000; maxX = maxY = maxZ = 1000; }
    bounds = {
      minX: minX, maxX: maxX, minY: minY, maxY: maxY, minZ: minZ, maxZ: maxZ,
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2,
      size: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1)
    };
    log('Collision bounds: x=[' + minX.toFixed(0) + ',' + maxX.toFixed(0) + '] y=[' + minY.toFixed(0) + ',' + maxY.toFixed(0) + '] z=[' + minZ.toFixed(0) + ',' + maxZ.toFixed(0) + '] size=' + bounds.size.toFixed(0));
  }

  // ═══ Find game canvas ═══
  function findGameCanvas() {
    var canvases = document.querySelectorAll('canvas');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var c = canvases[i];
      if (c.id === 'tanki-collision-overlay') continue;
      var area = c.width * c.height;
      if (c.width > 100 && c.height > 100 && area > bestArea) { best = c; bestArea = area; }
    }
    return best;
  }

  function isGameReady() {
    return !!(gameCanvas && gameCanvas.width > 1000 && gameCanvas.height > 1000);
  }

  // Throttled canvas metrics (avoids per-frame getBoundingClientRect layout thrash)
  function updateCanvasMetrics() {
    var now = performance.now();
    if (now - canvasMetrics.lastCheck < 300) return;
    canvasMetrics.lastCheck = now;
    if (!gameCanvas) { canvasMetrics.visible = false; return; }
    var rect = gameCanvas.getBoundingClientRect();
    canvasMetrics.left = rect.left;
    canvasMetrics.top = rect.top;
    canvasMetrics.w = rect.width;
    canvasMetrics.h = rect.height;
    var visible = rect.width >= 50 && rect.height >= 50
      && rect.bottom > 0 && rect.right > 0
      && rect.top < window.innerHeight && rect.left < window.innerWidth;
    if (visible) {
      try {
        var cs = getComputedStyle(gameCanvas);
        visible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') !== 0;
      } catch(e) {}
    }
    canvasMetrics.visible = visible;
  }

  function isGameCanvasVisible() {
    updateCanvasMetrics();
    return canvasMetrics.visible;
  }

  var canvasWatchStarted = false;

  function waitForGameCanvas(callback) {
    var found = findGameCanvas();
    if (found) { gameCanvas = found; callback(); return; }
    var timeoutId = null;
    var observer = new MutationObserver(function(mutations) {
      for (var mi = 0; mi < mutations.length; mi++) {
        for (var ni = 0; ni < mutations[mi].addedNodes.length; ni++) {
          var node = mutations[mi].addedNodes[ni];
          if (node.nodeName === 'CANVAS') {
            var canvas = findGameCanvas();
            if (canvas) { observer.disconnect(); if (timeoutId) clearTimeout(timeoutId); gameCanvas = canvas; callback(); return; }
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timeoutId = setTimeout(function() {
      observer.disconnect();
      var canvas = findGameCanvas();
      if (canvas) { gameCanvas = canvas; callback(); } else { logErr('Game canvas not found after timeout'); }
    }, 15000);
    log('Waiting for game canvas...');
  }

  function startCanvasWatch() {
    if (canvasWatchStarted) return;
    canvasWatchStarted = true;
    var lastCanvasW = 0, lastCanvasH = 0;
    function checkCanvas() {
      var best = findGameCanvas();
      if (best && best !== gameCanvas) {
        log('Canvas switched: ' + (gameCanvas ? gameCanvas.width + 'x' + gameCanvas.height : 'null') + ' → ' + best.width + 'x' + best.height);
        gameCanvas = best;
        lastSizeKey = null;
      }
      if (best) {
        if (best.width !== lastCanvasW || best.height !== lastCanvasH) {
          if (lastCanvasW > 0) log('Canvas resized: ' + lastCanvasW + 'x' + lastCanvasH + ' → ' + best.width + 'x' + best.height);
          lastCanvasW = best.width; lastCanvasH = best.height;
          lastSizeKey = null;
        }
      }
      setTimeout(checkCanvas, 2000);
    }
    checkCanvas();
    log('Canvas watch started (continuous monitoring)');
  }

  // ═══ Create 2D overlay canvas ═══
  function createOverlay() {
    if (!threeOk || !gameCanvas) return false;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'tanki-collision-overlay';
    overlayCanvas.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:none;';
    document.body.appendChild(overlayCanvas);
    renderer2d = overlayCanvas.getContext('2d');
    if (!renderer2d) { logErr('Canvas 2D context unavailable'); return false; }
    viewMatrix = new THREE.Matrix4();
    projMatrix = new THREE.Matrix4();
    vpMatrix = new THREE.Matrix4();
    manualViewMatrix = new THREE.Matrix4();
    manualProjMatrix = new THREE.Matrix4();
    syncOverlaySize();
    log('2D overlay created');
    return true;
  }

  function syncOverlaySize() {
    if (!gameCanvas || !overlayCanvas || !renderer2d) return;
    updateCanvasMetrics();
    if (!canvasMetrics.visible) return;
    var w = canvasMetrics.w, h = canvasMetrics.h;
    if (w < 10 || h < 10) { w = window.innerWidth; h = window.innerHeight; }
    var key = canvasMetrics.left + '|' + canvasMetrics.top + '|' + w + '|' + h;
    if (lastSizeKey === key) return;
    lastSizeKey = key;
    overlayCanvas.style.left = canvasMetrics.left + 'px';
    overlayCanvas.style.top = canvasMetrics.top + 'px';
    overlayCanvas.style.width = w + 'px';
    overlayCanvas.style.height = h + 'px';
    overlayCanvas.width = Math.max(1, Math.round(w * dpr));
    overlayCanvas.height = Math.max(1, Math.round(h * dpr));
    renderer2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ═══ Projection math ═══
  function norm3(v) {
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (l < 1e-6) return [0, 0, 0];
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function buildViewMatrix() {
    var r = norm3(cameraState.right);
    var u = norm3(cameraState.up);
    var p = cameraState.position;
    var fx, fy, fz;
    if (FLIP_FORWARD) {
      fx = u[1] * r[2] - u[2] * r[1];
      fy = u[2] * r[0] - u[0] * r[2];
      fz = u[0] * r[1] - u[1] * r[0];
    } else {
      fx = r[1] * u[2] - r[2] * u[1];
      fy = r[2] * u[0] - r[0] * u[2];
      fz = r[0] * u[1] - r[1] * u[0];
    }
    viewMatrix.set(
      r[0], r[1], r[2], -(r[0] * p[0] + r[1] * p[1] + r[2] * p[2]),
      u[0], u[1], u[2], -(u[0] * p[0] + u[1] * p[1] + u[2] * p[2]),
      fx, fy, fz, -(fx * p[0] + fy * p[1] + fz * p[2]),
      0, 0, 0, 1
    );
  }

  function ensureProjection() {
    if (cameraState.projection) return;
    var aspect = overlayCanvas ? overlayCanvas.width / Math.max(overlayCanvas.height, 1) : 1;
    var near = 1, far = 1000000;
    var f = 1 / Math.tan((EST_FOV * Math.PI / 180) / 2);
    cameraState.projection = [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ];
    cameraState.projName = 'ESTIMATED(' + EST_FOV + '°)';
    logWarn('Projection not captured — using estimated FOV=' + EST_FOV + '° (game alignment will be approximate)');
  }

  // Build the view-projection matrix using the best available path
  function buildGameVP() {
    if (cameraState.vp) {
      vpMatrix.fromArray(cameraState.vp);
      if (PROJ_IS_VP) return;
      return;
    }
    if (cameraState.position && cameraState.right && cameraState.up) {
      buildViewMatrix();
    } else if (cameraState.viewMatrix) {
      viewMatrix.fromArray(cameraState.viewMatrix);
    } else {
      currentCameraMode = 'none';
      return;
    }
    ensureProjection();
    if (PROJ_IS_VP) {
      vpMatrix.fromArray(cameraState.projection);
    } else {
      projMatrix.fromArray(cameraState.projection);
      vpMatrix.multiplyMatrices(projMatrix, viewMatrix);
    }
  }

  function lookAtMatrix(eye, target, up, out) {
    var zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var ux = up[0], uy = up[1], uz = up[2];
    var xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    var yl = Math.sqrt(yx * yx + yy * yy + yz * yz) || 1; yx /= yl; yy /= yl; yz /= yl;
    out.set(
      xx, xy, xz, -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      yx, yy, yz, -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      zx, zy, zz, -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      0, 0, 0, 1
    );
  }

  function updateManualCamera() {
    if (!bounds) return;
    var cy = manualCam.pitch, cx = manualCam.yaw, dist = manualCam.dist * bounds.size;
    var sp = Math.sin(cy), cp = Math.cos(cy);
    var ex = bounds.cx + dist * cp * Math.sin(cx);
    var ey = bounds.cy + dist * sp;
    var ez = bounds.cz + dist * cp * Math.cos(cx);
    lookAtMatrix([ex, ey, ez], [bounds.cx, bounds.cy, bounds.cz], [0, 1, 0], manualViewMatrix);
    var near = Math.max(bounds.size * 0.001, 1);
    var far = bounds.size * 10;
    var fov = 50 * Math.PI / 180;
    var aspect = overlayCanvas.width / Math.max(overlayCanvas.height, 1);
    var top = near * Math.tan(fov / 2), bottom = -top;
    var right = top * aspect, left = -right;
    manualProjMatrix.makePerspective(left, right, top, bottom, near, far);
  }

  function projectVertex(x, y, z, m, out) {
    var e = m.elements;
    var sx = x * SCALE, sy = y * SCALE, sz = z * SCALE;
    var w = e[3] * sx + e[7] * sy + e[11] * sz + e[15];
    if (w <= 0.0001) return false;
    var iw = 1 / w;
    out[0] = (e[0] * sx + e[4] * sy + e[8] * sz + e[12]) * iw;
    out[1] = (e[1] * sx + e[5] * sy + e[9] * sz + e[13]) * iw;
    return true;
  }

  // ═══ Render (2D canvas) with bounding-sphere culling ═══
  var ndcBuf = [0, 0];
  var scratchBuf = new Float32Array(16);

  function draw2D() {
    var ctx = renderer2d;
    var w = overlayCanvas.width / dpr;
    var h = overlayCanvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    drawnShapes = 0;

    for (var g = 0; g < renderGroups.length; g++) {
      var group = renderGroups[g];
      var shapes = group.shapes;
      var spheres = group.spheres;
      var fillPath = new Path2D();
      var strokePath = new Path2D();
      var anyFill = false, anyStroke = false;

      for (var s = 0; s < shapes.length; s++) {
        var cx = spheres[s * 4], cy = spheres[s * 4 + 1], cz = spheres[s * 4 + 2], cr = spheres[s * 4 + 3];

        // Quick cull: project sphere center
        if (!projectVertex(cx, cy, cz, vpMatrix, ndcBuf)) continue;
        var cSX = (ndcBuf[0] + 1) / 2 * w;
        var cSY = (1 - ndcBuf[1]) / 2 * h;

        // Estimate screen radius (project center + radius along X)
        if (projectVertex(cx + cr, cy, cz, vpMatrix, ndcBuf)) {
          var rSX = (ndcBuf[0] + 1) / 2 * w;
          var rSY = (1 - ndcBuf[1]) / 2 * h;
          var screenR = Math.sqrt((rSX - cSX) * (rSX - cSX) + (rSY - cSY) * (rSY - cSY));
        } else {
          var screenR = cr * 0.05;
        }
        if (screenR < 0.8) continue; // sub-pixel: invisible
        if (cSX < -screenR * 2 || cSX > w + screenR * 2 || cSY < -screenR * 2 || cSY > h + screenR * 2) continue;

        // Project all vertices
        var verts = shapes[s];
        var n = verts.length / 3;
        var allFront = true;
        for (var i = 0; i < n; i++) {
          if (!projectVertex(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2], vpMatrix, ndcBuf)) { allFront = false; break; }
          scratchBuf[i * 2] = (ndcBuf[0] + 1) / 2 * w;
          scratchBuf[i * 2 + 1] = FLIP_SCREEN_Y ? (ndcBuf[1] + 1) / 2 * h : (1 - ndcBuf[1]) / 2 * h;
        }
        if (!allFront) continue;

        fillPath.moveTo(scratchBuf[0], scratchBuf[1]);
        for (var j = 1; j < n; j++) fillPath.lineTo(scratchBuf[j * 2], scratchBuf[j * 2 + 1]);
        fillPath.closePath();
        anyFill = true;
        drawnShapes++;

        if (screenR >= STROKE_MIN_PX) {
          strokePath.moveTo(scratchBuf[0], scratchBuf[1]);
          for (var j2 = 1; j2 < n; j2++) strokePath.lineTo(scratchBuf[j2 * 2], scratchBuf[j2 * 2 + 1]);
          strokePath.closePath();
          anyStroke = true;
        }
      }

      if (anyFill) {
        ctx.fillStyle = group.fill;
        ctx.fill(fillPath);
      }
      if (anyStroke) {
        ctx.strokeStyle = group.stroke;
        ctx.lineWidth = 1;
        ctx.stroke(strokePath);
      }
    }
  }

  function startRenderLoop() {
    function render() {
      animFrameId = requestAnimationFrame(render);
      var now = performance.now();

      // DOM survival check: re-append overlayCanvas if removed
      if (overlayCanvas && overlayCanvas.parentNode !== document.body) {
        logWarn('overlayCanvas removed from DOM! Re-appending...');
        try { document.body.appendChild(overlayCanvas); } catch(e) { logErr('Re-append failed: ' + e.message); }
      }

      // Heartbeat every 15s
      if (overlayActive && now - lastHeartbeatTime > 15000) {
        lastHeartbeatTime = now;
        heartbeatCounter++;
        var gcInfo = gameCanvas ? (gameCanvas.width + 'x' + gameCanvas.height) : 'null';
        var camPos = cameraState.position ? cameraState.position.map(function(v) { return v.toFixed(0); }).join(',') : 'null';
        remoteLog('HEARTBEAT', 'Heartbeat #' + heartbeatCounter, {
          overlayActive: overlayActive, collisionReady: collisionReady, inGame: isGameReady(),
          cameraMode: currentCameraMode, cameraReady: cameraReady(),
          cameraPos: camPos, projName: cameraState.projName || null, vpSource: cameraState.vpSource || null,
          glFresh: glFresh(), canvasVisible: isGameCanvasVisible(),
          gameCanvas: gcInfo, groups: renderGroups ? renderGroups.length : 0, totalShapes: totalShapes, drawnShapes: drawnShapes
        });
      }

      if (!overlayActive || !collisionReady || !renderer2d) {
        if (overlayCanvas) overlayCanvas.style.pointerEvents = 'none';
        return;
      }

      updateCanvasMetrics();

      // Display gating:
      // - forceManual: user-driven inspection → show if canvas big & visible
      // - game camera: show if canvas big & visible & GL activity fresh (battle running)
      // - fallback (camera sync failed): do NOT auto-show (press M to inspect)
      var displayAllowed = false;
      if (forceManual) {
        currentCameraMode = 'manual';
        updateManualCamera();
        vpMatrix.multiplyMatrices(manualProjMatrix, manualViewMatrix);
        displayAllowed = isGameReady() && canvasMetrics.visible;
      } else if (cameraReady()) {
        currentCameraMode = 'game';
        buildGameVP();
        displayAllowed = isGameReady() && canvasMetrics.visible && glFresh();
      } else {
        currentCameraMode = 'none';
        displayAllowed = false;
      }

      overlayCanvas.style.display = displayAllowed ? 'block' : 'none';
      if (!displayAllowed) {
        overlayCanvas.style.pointerEvents = 'none';
        return;
      }

      syncOverlaySize();
      overlayCanvas.style.pointerEvents = currentCameraMode === 'manual' ? 'auto' : 'none';
      if (renderGroups) draw2D();
    }
    animFrameId = requestAnimationFrame(render);
    log('Render loop started (2D + culling)');
  }

  // ═══ Controls ═══
  function debugDump() {
    console.log('[CO v2.4] ===== DEBUG DUMP =====');
    console.log('cameraState:', JSON.stringify(cameraState));
    console.log('cameraReady:', cameraReady(), 'glFresh:', glFresh(), 'forceManual:', forceManual, 'mode:', currentCameraMode);
    console.log('pendingM2W:', pendingM2W ? ((performance.now() - pendingM2W.t).toFixed(0) + 'ms ago') : null,
      'pendingMvp:', pendingMvp ? ((performance.now() - pendingMvp.t).toFixed(0) + 'ms ago') : null);
    console.log('canvas:', gameCanvas ? gameCanvas.width + 'x' + gameCanvas.height : null,
      'metrics:', JSON.stringify(canvasMetrics));
    console.log('bounds:', bounds ? (bounds.cx.toFixed(0) + ',' + bounds.cy.toFixed(0) + ',' + bounds.cz.toFixed(0) + ' size=' + bounds.size.toFixed(0)) : null);
    console.log('groups:', renderGroups ? renderGroups.length : 0, 'totalShapes:', totalShapes, 'drawn:', drawnShapes);
    console.log('viewMatrix:', viewMatrix ? viewMatrix.elements.join(',') : null);
    console.log('uniforms discovered:', uniformTracker ? Object.keys(uniformTracker.uniqueUniformNames).length : 0);
    console.log('[CO v2.4] ===== END =====');
  }

  function setupControls() {
    // Alt+C toggle
    document.addEventListener('keydown', function(e) {
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault(); e.stopPropagation();
        toggleOverlay();
      }
      if (e.key === 'm' || e.key === 'M') {
        if (overlayActive) { forceManual = !forceManual; log('Manual camera ' + (forceManual ? 'ON (inspection)' : 'OFF (auto)')); updateStatusOverlay(); }
      }
      if (e.key === 'd' || e.key === 'D') {
        debugDump();
      }
    }, true);

    // Manual orbit controls
    document.addEventListener('pointerdown', function(e) {
      if (currentCameraMode === 'manual') { manualDragging = true; lastPointerX = e.clientX; lastPointerY = e.clientY; }
    }, true);
    document.addEventListener('pointermove', function(e) {
      if (manualDragging && currentCameraMode === 'manual') {
        var dx = e.clientX - lastPointerX, dy = e.clientY - lastPointerY;
        lastPointerX = e.clientX; lastPointerY = e.clientY;
        manualCam.yaw -= dx * 0.005;
        manualCam.pitch += dy * 0.005;
        if (manualCam.pitch > 1.5) manualCam.pitch = 1.5;
        if (manualCam.pitch < -1.5) manualCam.pitch = -1.5;
      }
    }, true);
    document.addEventListener('pointerup', function() { manualDragging = false; }, true);
    document.addEventListener('wheel', function(e) {
      if (currentCameraMode === 'manual') {
        e.preventDefault();
        manualCam.dist *= (1 + e.deltaY * 0.001);
        if (manualCam.dist < 0.05) manualCam.dist = 0.05;
        if (manualCam.dist > 100) manualCam.dist = 100;
      }
    }, { passive: false, capture: true });
  }

  // ═══ Toggle overlay ═══
  function toggleOverlay() {
    overlayActive = !overlayActive;
    setOverlayEnabled(overlayActive);
    if (overlayActive && !overlayCanvas) {
      if (!createOverlay()) { overlayActive = false; setOverlayEnabled(false); return; }
    }
    log('Overlay ' + (overlayActive ? 'active' : 'inactive') + ' (ready=' + collisionReady + ')');
    updateStatusOverlay();
  }

  // ═══ processMapBin + fetch/XHR interception ═══
  function processMapBin(buffer) {
    var t0 = performance.now();
    remoteLog('INFO', 'MAPBIN_INTERCEPTED', { size: buffer.byteLength, hex: hexDump(new Uint8Array(buffer), 64) });
    logStep(1, 'Parsing map.bin (' + (buffer.byteLength / 1024).toFixed(1) + ' KB)...');

    var parsed;
    try { parsed = parseFullMapBin(buffer); } catch(e) {
      logErr('Parse failed: ' + e.message + '\n' + e.stack);
      throw e;
    }

    collisionData1 = parsed.collisionData1;
    collisionData2 = parsed.collisionData2;

    var t1 = performance.now();
    var c1 = collisionData1.shapesType1.length + collisionData1.shapesType2.length + collisionData1.shapesType3.length;
    var c2 = collisionData2.shapesType1.length + collisionData2.shapesType2.length + collisionData2.shapesType3.length;
    logStep(2, 'Parse OK (' + (t1 - t0).toFixed(0) + 'ms) — collisionData1=' + c1 + ' shapes, collisionData2=' + c2 + ' shapes, props=' + parsed.props.length);

    if (threeOk) {
      buildRenderShapes();
      collisionReady = true;
    }

    updateStatusOverlay();
    return buffer;
  }

  // ═══ Fetch interception ═══
  var originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    var url = (input instanceof Request) ? input.url : String(input);
    if (!_msInternal && url && url.indexOf('map.bin') !== -1 && pakoOk) {
      _msInternal = true;
      log('Intercepted fetch: ' + url);
      try {
        var resp = await originalFetch.call(this, input, init);
        if (!resp.ok) { logWarn('Response not OK: ' + resp.status); _msInternal = false; return resp; }
        var buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength === 0) { logWarn('Empty response'); _msInternal = false; return originalFetch.call(this, input, init); }
        var arr = new Uint8Array(buf);
        processMapBin(arr);
        _msInternal = false;
        return new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' }, status: 200 });
      } catch(e) {
        _msInternal = false;
        logErr('Map processing failed: ' + e.message);
        try { return await originalFetch.call(this, input, init); } catch(e2) { throw e2; }
      }
    }
    return originalFetch.call(this, input, init);
  };

  // ═══ XHR interception ═══
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    var urlStr = String(url);
    this._msUrl = urlStr; this._msMethod = method;
    this._msMatch = (urlStr.indexOf('map.bin') !== -1 && pakoOk);
    if (!this._msMatch) return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._msMatch && pakoOk) {
      var self = this; var savedType = this.responseType;
      _msInternal = true;
      originalFetch.call(window, this._msUrl)
        .then(function(resp) { return resp.arrayBuffer(); })
        .then(function(buf) {
          var arr = new Uint8Array(buf);
          processMapBin(arr);
          var blob = new Blob([buf], { type: 'application/octet-stream' });
          var blobUrl = URL.createObjectURL(blob);
          _msInternal = false;
          originalOpen.call(self, 'GET', blobUrl); self.responseType = savedType; originalSend.call(self);
        })
        .catch(function(e) {
          _msInternal = false;
          originalOpen.call(self, self._msMethod, self._msUrl); self.responseType = savedType; originalSend.call(self);
        });
      return;
    }
    return originalSend.call(this, body);
  };

  // ═══ Status overlay ═══
  var statusOverlay = null;
  var lastStatusUpdate = 0;

  function createStatusOverlay() {
    statusOverlay = document.createElement('div');
    statusOverlay.id = 'tanki-collision-status';
    statusOverlay.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;background:rgba(0,10,30,0.92);color:#00ccff;border:1px solid rgba(0,204,255,0.3);border-radius:8px;padding:8px 12px;font-size:12px;font-family:monospace;max-width:400px;user-select:none;cursor:pointer';
    statusOverlay.title = 'Click to toggle collision overlay';
    statusOverlay.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      toggleOverlay();
    }, true);
    document.body.appendChild(statusOverlay);
    updateStatusOverlay();
  }

  function camItem(name, ok) {
    return '<span style="color:' + (ok ? '#76ff33' : '#ff6644') + ';">' + name + (ok ? '✓' : '✗') + '</span>';
  }

  function updateStatusOverlay() {
    var now = performance.now();
    if (statusOverlay && now - lastStatusUpdate < 2000) return;
    lastStatusUpdate = now;
    if (!statusOverlay) return;
    var pakoStatus = pakoOk ? 'OK' : 'MISSING';
    var threeStatus = threeOk ? 'OK' : 'MISSING';
    var mapStatus = collisionData1 ? 'LOADED' : 'WAITING';
    var c1Count = collisionData1 ? (collisionData1.shapesType1.length + collisionData1.shapesType2.length + collisionData1.shapesType3.length) : 0;
    var c2Count = collisionData2 ? (collisionData2.shapesType1.length + collisionData2.shapesType2.length + collisionData2.shapesType3.length) : 0;

    var camText, camColor;
    if (forceManual) { camText = 'MANUAL (M)'; camColor = '#f39c12'; }
    else if (cameraState.vp) { camText = 'GAME (VP=' + cameraState.vpSource + ')'; camColor = '#76ff33'; }
    else if (cameraState.position && cameraState.right && cameraState.up && cameraState.projection) { camText = 'GAME (proj=' + cameraState.projName + ')'; camColor = '#76ff33'; }
    else if (cameraState.position || cameraState.projection || cameraState.viewMatrix) { camText = 'PARTIAL — press D to dump'; camColor = '#f39c12'; }
    else { camText = 'FAILED (press M to inspect)'; camColor = '#ff6644'; }

    statusOverlay.innerHTML =
      '<div style="font-weight:bold;margin-bottom:4px;color:#00ccff;">Collision Overlay v2.4</div>' +
      '<div style="color:#aaa;font-size:10px;">Alt+C toggle | M manual | D dump | Click to toggle | Logs: localhost:3456</div>' +
      '<div style="margin-top:4px;font-size:11px;">' +
        '<span style="color:' + ((pakoOk && threeOk) ? '#76ff33' : '#ff6644') + ';">pako:' + pakoStatus + ' three:' + threeStatus + '</span> ' +
        '<span>canvas:' + (gameCanvas ? 'OK' : 'WAIT') + (isGameReady() ? ' (game)' : '') + '</span>' +
      '</div>' +
      '<div style="font-size:11px;margin-top:2px;">' +
        'map.bin: <span style="color:' + (collisionData1 ? '#76ff33' : '#f39c12') + ';">' + mapStatus + '</span>' +
        ' (C1=' + c1Count + ' C2=' + c2Count + ' shapes=' + totalShapes + ')' +
      '</div>' +
      '<div style="font-size:11px;margin-top:2px;color:' + camColor + ';">' +
        'camera: ' + camText + '<br>' +
        '<span style="font-size:10px;">' + camItem('pos', !!cameraState.position) + ' ' + camItem('right', !!cameraState.right) + ' ' + camItem('up', !!cameraState.up) + ' ' + camItem('proj', !!cameraState.projection) + ' ' + camItem('vp', !!cameraState.vp) + '</span>' +
      '</div>' +
      '<div style="font-size:10px;margin-top:2px;color:#888;">' +
        'overlay: ' + (overlayActive ? 'ON' : 'OFF') + ' | gl:' + (glFresh() ? 'fresh' : 'stale') + ' | vis:' + (canvasMetrics.visible ? 'yes' : 'no') + ' | drawn:' + drawnShapes + '/' + totalShapes +
      '</div>' +
      '<div style="font-size:9px;margin-top:3px;color:#666;">' +
        'flags: FLIP_F=' + (FLIP_FORWARD ? 1 : 0) + ' FLIP_Y=' + (FLIP_SCREEN_Y ? 1 : 0) + ' PROJ_VP=' + (PROJ_IS_VP ? 1 : 0) + ' SCALE=' + SCALE + ' FOV=' + EST_FOV +
      '</div>' +
      '<div style="font-size:9px;margin-top:2px;color:#666;">' +
        'manual: drag=rotate wheel=zoom' +
      '</div>';
  }

  // ═══ Resize observer ═══
  function setupResizeObserver() {
    if (!gameCanvas) return;
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function() { if (overlayActive) { lastSizeKey = null; syncOverlaySize(); } });
      ro.observe(gameCanvas);
    }
    window.addEventListener('resize', function() { if (overlayActive) { lastSizeKey = null; syncOverlaySize(); } });
  }

  // ═══ Check dependencies ═══
  function checkDeps() {
    pakoOk = typeof pako !== 'undefined';
    threeOk = typeof THREE !== 'undefined';
    depsReady = pakoOk && threeOk;
    if (!pakoOk) logWarn('pako not available, map.bin parsing disabled');
    if (!threeOk) logWarn('THREE not available, projection math disabled');
    return depsReady;
  }

  // ═══ Init ═══
  function init() {
    if (!checkDeps()) {
      var retries = 0;
      var interval = setInterval(function() {
        if (checkDeps() || retries++ > 50) {
          clearInterval(interval);
          if (depsReady) initAfterDeps();
        }
      }, 200);
      return;
    }
    initAfterDeps();
  }

  function initAfterDeps() {
    log('Init: pako=' + pakoOk + ' three=' + threeOk);
    installUniformHooks();
    setupControls();
    startCanvasWatch();

    setTimeout(function() {
      var uCount = uniformTracker ? Object.keys(uniformTracker.uniqueUniformNames).length : 0;
      log('Discovery summary: ' + uCount + ' unique uniforms (sampling is off — camera capture only)');
    }, 20000);

    waitForGameCanvas(function() {
      log('Game canvas found: ' + gameCanvas.width + 'x' + gameCanvas.height);
      setupResizeObserver();
      if (isOverlayEnabled()) {
        createOverlay();
        toggleOverlay();
      }
      startRenderLoop();
    });

    createStatusOverlay();
    log('v2.4 ready — dual-path camera sync + culling + battle detection');
  }

  // Start
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  log('Collision Overlay v2.4 script loaded');
})();
