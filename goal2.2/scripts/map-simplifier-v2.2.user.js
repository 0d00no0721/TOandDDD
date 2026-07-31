// ==UserScript==
// @name         Tanki Collision Overlay v2.2
// @namespace    https://github.com/0d00no0721/TOandDDD
// @version      2.2.0
// @description  Continuous canvas tracking, DOM survival check, heartbeat logs, context loss handling. Alt+C toggle or click status panel. Default ON.
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

  function log(m) { console.log('%c[CO v2.2] ' + m, 'color:#00ccff'); remoteLog('INFO', m); }
  function logStep(n, m) { var msg = '[Step ' + n + '] ' + m; console.log('%c[CO v2.2] ' + msg, 'color:#00ff99'); remoteLog('INFO', msg); }
  function logWarn(m) { console.warn('[CO v2.2] ' + m); remoteLog('WARN', m); }
  function logErr(m) { console.error('[CO v2.2] ' + m); remoteLog('ERROR', m); }

  // ═══ State ═══
  var collisionData1 = null;
  var collisionData2 = null;
  var collisionReady = false;
  var overlayActive = false;
  var depsReady = false;
  var gameCanvas = null;
  var overlayCanvas = null;
  var renderer = null;
  var scene = null;
  var camera = null;
  var collisionGroup = null;
  var fallCamera = { posY: 0, zoom: 1, panX: 0, panZ: 0, rotY: 0, mode: 'topdown' };
  var animFrameId = null;
  var uniformTracker = null;
  var keysDown = {};
  var pakoOk = false;
  var threeOk = false;
  var _msInternal = false;

  // ═══ Uniform Tracker (discovery phase) ═══
  function UniformTracker() {
    this.locToName = new Map();
    this.uniqueUniformNames = {};
    this.mat4UniformNames = {};
    this.mat4Samples = {};
    this.totalSamples = 0;
    this.maxSamplesPerName = 30;
    this.flushed = false;
  }

  UniformTracker.prototype.registerLocation = function(loc, name) {
    if (!loc) return;
    var key = 'gl' + this.locToName.size;
    this.locToName.set(loc, { name: name, key: key });
    if (!this.uniqueUniformNames[name]) {
      this.uniqueUniformNames[name] = { type: null, firstSeen: Date.now() };
      log('Uniform discovered: "' + name + '"');
    }
  };

  UniformTracker.prototype.markMat4 = function(loc, name) {
    if (!name) return;
    if (!this.mat4UniformNames[name]) {
      this.mat4UniformNames[name] = { count: 0, samples: [] };
      log('Matrix4 uniform found: "' + name + '"');
    }
    this.mat4UniformNames[name].count++;
  };

  UniformTracker.prototype.sampleMat4 = function(name, matrix) {
    var entry = this.mat4UniformNames[name];
    if (!entry || entry.samples.length >= this.maxSamplesPerName) return;
    var rowSums = [0, 0, 0, 0];
    var colSums = [0, 0, 0, 0];
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        rowSums[r] += Math.abs(matrix[r * 4 + c]);
        colSums[c] += Math.abs(matrix[r * 4 + c]);
      }
    }

    var sample = {
      frame: this.totalSamples,
      m10: matrix[10], m11: matrix[11], m14: matrix[14], m15: matrix[15],
      rowSums: rowSums, colSums: colSums,
      isIdentity: Math.abs(matrix[0] - 1) < 0.001 && Math.abs(matrix[5] - 1) < 0.001 && Math.abs(matrix[10] - 1) < 0.001 && Math.abs(matrix[15] - 1) < 0.001,
      likeView: Math.abs(matrix[3]) < 0.01 && Math.abs(matrix[7]) < 0.01 && Math.abs(matrix[11]) < 0.01 && Math.abs(matrix[15]) > 0.1,
      likeProj: Math.abs(matrix[10]) > 0.01 && Math.abs(matrix[11]) > 0.01 && Math.abs(matrix[14]) > 0.01
    };
    entry.samples.push(sample);
    this.totalSamples++;
  };

  UniformTracker.prototype.flush = function() {
    if (this.flushed) return;
    this.flushed = true;
    var report = {
      phase: 'discovery',
      session: SESSION_ID,
      uniqueUniformCount: Object.keys(this.uniqueUniformNames).length,
      mat4UniformCount: Object.keys(this.mat4UniformNames).length,
      uniforms: Object.keys(this.uniqueUniformNames).sort(),
      mat4Uniforms: {}
    };
    var names = Object.keys(this.mat4UniformNames).sort();
    for (var i = 0; i < names.length; i++) {
      report.mat4Uniforms[names[i]] = {
        totalFrames: this.mat4UniformNames[names[i]].count,
        samples: this.mat4UniformNames[names[i]].samples.slice(0, 5)
      };
    }
    logStep(6, 'Flushing discovery report: ' + report.uniqueUniformCount + ' uniforms, ' + report.mat4UniformCount + ' mat4');
    remoteLog('DISCOVERY_REPORT', 'Uniform discovery complete', report);
  };

  // ═══ Hook WebGL for uniform discovery ═══
  function installUniformHooks() {
    if (uniformTracker) return;
    uniformTracker = new UniformTracker();

    var origGetUniformLocation = WebGLRenderingContext.prototype.getUniformLocation;
    WebGLRenderingContext.prototype.getUniformLocation = function(program, name) {
      var loc = origGetUniformLocation.call(this, program, name);
      if (loc !== null && name) {
        try { uniformTracker.registerLocation(loc, name); } catch(e) {}
      }
      return loc;
    };

    var origUniformMatrix4fv = WebGLRenderingContext.prototype.uniformMatrix4fv;
    WebGLRenderingContext.prototype.uniformMatrix4fv = function(location, transpose, value) {
      if (uniformTracker) {
        var info = uniformTracker.locToName.get(location);
        if (info && info.name && value && value.length >= 16) {
          uniformTracker.markMat4(location, info.name);
          uniformTracker.sampleMat4(info.name, value);
        }
      }
      return origUniformMatrix4fv.call(this, location, transpose, value);
    };

    if (typeof WebGL2RenderingContext !== 'undefined') {
      var origGULv2 = WebGL2RenderingContext.prototype.getUniformLocation;
      WebGL2RenderingContext.prototype.getUniformLocation = function(program, name) {
        var loc = origGULv2.call(this, program, name);
        if (loc !== null && name) {
          try { uniformTracker.registerLocation(loc, name); } catch(e) {}
        }
        return loc;
      };
      var origUM4v2 = WebGL2RenderingContext.prototype.uniformMatrix4fv;
      WebGL2RenderingContext.prototype.uniformMatrix4fv = function(location, transpose, value) {
        if (uniformTracker) {
          var info = uniformTracker.locToName.get(location);
          if (info && info.name && value && value.length >= 16) {
            uniformTracker.markMat4(location, info.name);
            uniformTracker.sampleMat4(info.name, value);
          }
        }
        return origUM4v2.call(this, location, transpose, value);
      };
    }

    logStep(5, 'WebGL uniform hooks installed');
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
    coll1: {
      type1: 0x3399FF, // light blue (OBB)
      type2: 0xFFCC33, // light yellow (thin sheet)
      type3: 0xCC66FF  // light purple (triangle)
    },
    coll2: {
      type1: 0x2266AA, // dark blue
      type2: 0xCC9922, // dark yellow
      type3: 0x8844CC  // dark purple
    }
  };

  // ═══ Collision Geometry Builder ═══
  function buildCollisionGroup(colData, colorSet) {
    var group = new THREE.Group();
    if (!colData) return group;

    // Shared template: unit box (1x1x1) for type1
    var unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    var unitVerts = unitBoxGeo.getAttribute('position').array; // 24 verts × 3 = 72 floats
    var unitIndices = unitBoxGeo.getIndex().array; // 36 ints
    var vertsPerBox = unitVerts.length / 3;
    var reuseEuler = new THREE.Euler();
    var reuseMatrix = new THREE.Matrix4();
    var reuseVec = new THREE.Vector3();
    unitBoxGeo.dispose();

    // Type 1: OBB boxes
    if (colData.shapesType1 && colData.shapesType1.length > 0) {
      var shapes = colData.shapesType1;
      var allVerts = new Float32Array(shapes.length * unitVerts.length);
      var allIndices = new Uint32Array(shapes.length * unitIndices.length);

      for (var s = 0; s < shapes.length; s++) {
        var d = shapes[s];
        var hx = d[6] / 2, hy = d[7] / 2, hz = d[8] / 2;
        reuseEuler.set(d[3], d[4], d[5], 'ZYX');
        reuseMatrix.makeRotationFromEuler(reuseEuler);

        var vBase = s * unitVerts.length;
        for (var i = 0; i < unitVerts.length; i += 3) {
          reuseVec.set(unitVerts[i] * hx, unitVerts[i + 1] * hy, unitVerts[i + 2] * hz);
          reuseVec.applyMatrix4(reuseMatrix);
          allVerts[vBase + i] = reuseVec.x + d[0];
          allVerts[vBase + i + 1] = reuseVec.y + d[1];
          allVerts[vBase + i + 2] = reuseVec.z + d[2];
        }

        var iBase = s * unitIndices.length;
        for (var ii = 0; ii < unitIndices.length; ii++) {
          allIndices[iBase + ii] = unitIndices[ii] + s * vertsPerBox;
        }
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(allVerts, 3));
      geo.setIndex(new THREE.BufferAttribute(allIndices, 1));
      geo.computeVertexNormals();
      var mat = new THREE.MeshBasicMaterial({ color: colorSet.type1, transparent: true, opacity: 0.35, depthWrite: false });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'coll_type1';
      group.add(mesh);
    }

    // Type 2: thin sheets (BoxGeometry, length/width from float64)
    if (colData.shapesType2 && colData.shapesType2.length > 0) {
      var shapes2 = colData.shapesType2;
      var allVerts2 = new Float32Array(shapes2.length * unitVerts.length);
      var allIndices2 = new Uint32Array(shapes2.length * unitIndices.length);

      for (var s2 = 0; s2 < shapes2.length; s2++) {
        var d2 = shapes2[s2];
        var hw = d2.f2 / 2, hl = d2.f1 / 2, hth = 2.5;
        reuseEuler.set(d2.data[3], d2.data[4], d2.data[5], 'ZYX');
        reuseMatrix.makeRotationFromEuler(reuseEuler);

        var vb2 = s2 * unitVerts.length;
        for (var i2 = 0; i2 < unitVerts.length; i2 += 3) {
          reuseVec.set(unitVerts[i2] * hw, unitVerts[i2 + 1] * hl, unitVerts[i2 + 2] * hth);
          reuseVec.applyMatrix4(reuseMatrix);
          allVerts2[vb2 + i2] = reuseVec.x + d2.data[0];
          allVerts2[vb2 + i2 + 1] = reuseVec.y + d2.data[1];
          allVerts2[vb2 + i2 + 2] = reuseVec.z + d2.data[2];
        }

        var ib2 = s2 * unitIndices.length;
        for (var ii2 = 0; ii2 < unitIndices.length; ii2++) {
          allIndices2[ib2 + ii2] = unitIndices[ii2] + s2 * vertsPerBox;
        }
      }

      var geo2 = new THREE.BufferGeometry();
      geo2.setAttribute('position', new THREE.BufferAttribute(allVerts2, 3));
      geo2.setIndex(new THREE.BufferAttribute(allIndices2, 1));
      geo2.computeVertexNormals();
      var mat2 = new THREE.MeshBasicMaterial({ color: colorSet.type2, transparent: true, opacity: 0.35, depthWrite: false });
      var mesh2 = new THREE.Mesh(geo2, mat2);
      mesh2.name = 'coll_type2';
      group.add(mesh2);
    }

    // Type 3: triangles
    if (colData.shapesType3 && colData.shapesType3.length > 0) {
      var shapes3 = colData.shapesType3;
      var allVerts3 = new Float32Array(shapes3.length * 9);
      var reuseVec2 = new THREE.Vector3();

      for (var s3 = 0; s3 < shapes3.length; s3++) {
        var d3 = shapes3[s3];
        reuseEuler.set(d3.data[3], d3.data[4], d3.data[5], 'ZYX');
        reuseMatrix.makeRotationFromEuler(reuseEuler);

        var vb3 = s3 * 9;
        for (var vi = 0; vi < 3; vi++) {
          var off = 6 + vi * 3;
          reuseVec2.set(d3.data[off], d3.data[off + 1], d3.data[off + 2]);
          reuseVec2.applyMatrix4(reuseMatrix);
          allVerts3[vb3 + vi * 3] = reuseVec2.x + d3.data[0];
          allVerts3[vb3 + vi * 3 + 1] = reuseVec2.y + d3.data[1];
          allVerts3[vb3 + vi * 3 + 2] = reuseVec2.z + d3.data[2];
        }
      }

      var geo3 = new THREE.BufferGeometry();
      geo3.setAttribute('position', new THREE.BufferAttribute(allVerts3, 3));
      geo3.computeVertexNormals();
      var mat3 = new THREE.MeshBasicMaterial({ color: colorSet.type3, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
      var mesh3 = new THREE.Mesh(geo3, mat3);
      mesh3.name = 'coll_type3';
      group.add(mesh3);
    }

    return group;
  }

  function buildAllCollisionGeometry() {
    if (!threeOk) return null;
    var t0 = performance.now();
    var group = new THREE.Group();
    group.name = 'collision_overlay';

    var c1Shapes = (collisionData1.shapesType1 ? collisionData1.shapesType1.length : 0)
      + (collisionData1.shapesType2 ? collisionData1.shapesType2.length : 0)
      + (collisionData1.shapesType3 ? collisionData1.shapesType3.length : 0);
    var c2Shapes = (collisionData2.shapesType1 ? collisionData2.shapesType1.length : 0)
      + (collisionData2.shapesType2 ? collisionData2.shapesType2.length : 0)
      + (collisionData2.shapesType3 ? collisionData2.shapesType3.length : 0);

    logStep(3, 'Building collision geometry (group1=' + c1Shapes + ' shapes, group2=' + c2Shapes + ' shapes)...');

    var g1 = buildCollisionGroup(collisionData1, COLORS.coll1);
    g1.name = 'collision_group1';
    group.add(g1);

    var g2 = buildCollisionGroup(collisionData2, COLORS.coll2);
    g2.name = 'collision_group2';
    group.add(g2);

    var t1 = performance.now();
    logStep(4, 'Collision geometry built in ' + (t1 - t0).toFixed(0) + 'ms (' + (c1Shapes + c2Shapes) + ' shapes → ' + group.children.length + '×2 meshes)');

    // Compute bounds for fallback camera
    var bbox = new THREE.Box3();
    group.traverse(function(c) { if (c.isMesh && c.geometry) { c.geometry.computeBoundingBox(); bbox.expandByObject(c); } });
    fallCamera.centerX = (bbox.min.x + bbox.max.x) / 2;
    fallCamera.centerZ = (bbox.min.z + bbox.max.z) / 2;
    fallCamera.size = Math.max(bbox.max.x - bbox.min.x, bbox.max.z - bbox.min.z) * 1.2;
    fallCamera.posY = fallCamera.size * 0.7;
    if (fallCamera.posY < 5000) fallCamera.posY = 5000;
    log('Collision bounds: x=[' + bbox.min.x.toFixed(0) + ',' + bbox.max.x.toFixed(0) + '] z=[' + bbox.min.z.toFixed(0) + ',' + bbox.max.z.toFixed(0) + '] size=' + fallCamera.size.toFixed(0) + ' cameraY=' + fallCamera.posY.toFixed(0));

    return group;
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

  var canvasWatchStarted = false;

  function waitForGameCanvas(callback) {
    var found = findGameCanvas();
    if (found) { gameCanvas = found; callback(); return; }
    var timeoutId = null;
    var observer = new MutationObserver(function(mutations) {
      for (var mi = 0; mi < mutations.length; mi++) {
        for (var ni = 0; ni < mutations[mi].addedNodes.length; ni++) {
          var node = mutations[mi].addedNodes[ni];
          if (node.nodeName === 'CANVAS' || (node.querySelectorAll && node.querySelectorAll('canvas').length > 0)) {
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
        if (overlayActive) syncOverlaySize();
      }
      if (best) {
        if (best.width !== lastCanvasW || best.height !== lastCanvasH) {
          if (lastCanvasW > 0) log('Canvas resized: ' + lastCanvasW + 'x' + lastCanvasH + ' → ' + best.width + 'x' + best.height);
          lastCanvasW = best.width; lastCanvasH = best.height;
          if (overlayActive) syncOverlaySize();
        }
      }
      setTimeout(checkCanvas, 2000);
    }
    checkCanvas();
    log('Canvas watch started (continuous monitoring)');
  }

  // ═══ Create overlay + three.js renderer ═══
  function createOverlay() {
    if (!threeOk || !gameCanvas) return false;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'tanki-collision-overlay';
    overlayCanvas.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:none;border:1px solid rgba(255,255,255,0.1)';
    document.body.appendChild(overlayCanvas);

    overlayCanvas.addEventListener('webglcontextlost', function(e) {
      e.preventDefault();
      logWarn('WebGL context lost on overlay canvas');
    }, false);
    overlayCanvas.addEventListener('webglcontextrestored', function() {
      log('WebGL context restored on overlay canvas');
      if (renderer) { renderer.dispose(); renderer = null; }
      try {
        renderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, alpha: true, antialias: true, preserveDrawingBuffer: false });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        syncOverlaySize();
        log('Renderer recreated after context restore');
      } catch(e) { logErr('Renderer recreation failed: ' + e.message); }
    }, false);

    try {
      renderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, alpha: true, antialias: true, preserveDrawingBuffer: false });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } catch(e) {
      logErr('WebGLRenderer creation failed: ' + e.message);
      return false;
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 100, 1000000);
    camera.up.set(0, 1, 0);

    syncOverlaySize();
    log('Overlay created: ' + overlayCanvas.width + '×' + overlayCanvas.height);
    return true;
  }

  function syncOverlaySize() {
    if (!gameCanvas || !overlayCanvas || !renderer) return;
    var rect = gameCanvas.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    if (w < 10 || h < 10) { w = window.innerWidth; h = window.innerHeight; }
    overlayCanvas.style.left = rect.left + 'px';
    overlayCanvas.style.top = rect.top + 'px';
    overlayCanvas.width = w; overlayCanvas.height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  // ═══ Update fallback camera ═══
  function updateFallbackCamera() {
    var zoom = fallCamera.zoom;
    var y = (fallCamera.posY || 50000) / zoom;
    var cx = fallCamera.centerX + fallCamera.panX;
    var cz = fallCamera.centerZ + fallCamera.panZ;

    if (fallCamera.mode === 'topdown') {
      camera.position.set(cx, y, cz);
      camera.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
    } else if (fallCamera.mode === 'isometric') {
      var dist = y * 0.7;
      var ang = fallCamera.rotY * Math.PI;
      camera.position.set(cx + Math.sin(ang) * dist, y * 0.5, cz + Math.cos(ang) * dist);
      camera.lookAt(cx, 0, cz);
    }
  }

  function setupKeyboardControls() {
    keysDown = {};
    document.addEventListener('keydown', function(e) {
      keysDown[e.key.toLowerCase()] = true;
    }, true);
    document.addEventListener('keyup', function(e) {
      keysDown[e.key.toLowerCase()] = false;
    }, true);
  }

  function processKeyboardInput() {
    if (!overlayActive || !collisionReady) return;
    var speed = (fallCamera.size || 5000) * 0.05;
    var panSpeed = speed * 0.3;

    if (keysDown['w']) fallCamera.zoom *= 1.03;
    if (keysDown['s']) fallCamera.zoom /= 1.03;
    if (keysDown['a']) fallCamera.panX -= panSpeed;
    if (keysDown['d']) fallCamera.panX += panSpeed;
    if (keysDown['q']) fallCamera.panZ -= panSpeed;
    if (keysDown['e']) fallCamera.panZ += panSpeed;
    if (keysDown['r']) { fallCamera.mode = fallCamera.mode === 'topdown' ? 'isometric' : 'topdown'; keysDown['r'] = false; }
    if (fallCamera.zoom < 0.1) fallCamera.zoom = 0.1;
    if (fallCamera.zoom > 100) fallCamera.zoom = 100;
  }

  // ═══ render loop ═══
  var heartbeatCounter = 0;
  var lastHeartbeatTime = 0;

  function startRenderLoop() {
    function render() {
      animFrameId = requestAnimationFrame(render);

      // DOM survival check: re-append overlayCanvas if removed from DOM
      if (overlayCanvas && overlayCanvas.parentNode !== document.body) {
        logWarn('overlayCanvas removed from DOM! Re-appending...');
        try { document.body.appendChild(overlayCanvas); } catch(e) { logErr('Re-append failed: ' + e.message); }
      }

      // Heartbeat log every 5 seconds (when overlay active)
      var now = performance.now();
      if (overlayActive && now - lastHeartbeatTime > 5000) {
        lastHeartbeatTime = now;
        heartbeatCounter++;
        var gcInfo = gameCanvas ? (gameCanvas.width + 'x' + gameCanvas.height) : 'null';
        var ocInfo = overlayCanvas ? (overlayCanvas.width + 'x' + overlayCanvas.height) : 'null';
        var ocInDom = overlayCanvas && overlayCanvas.parentNode === document.body;
        remoteLog('HEARTBEAT', 'Heartbeat #' + heartbeatCounter, {
          overlayActive: overlayActive, collisionReady: collisionReady,
          gameCanvas: gcInfo, overlayCanvas: ocInfo, overlayInDOM: ocInDom,
          renderer: !!renderer, scene: !!(scene && scene.children.length),
          camera: camera ? (camera.position.x.toFixed(0) + ',' + camera.position.y.toFixed(0) + ',' + camera.position.z.toFixed(0)) : 'null',
          fps_raf: Math.round(now)
        });
      }

      if (!overlayActive || !collisionReady || !renderer) return;

      syncOverlaySize();
      processKeyboardInput();
      updateFallbackCamera();

      if (scene && collisionGroup) {
        if (!scene.children.includes(collisionGroup)) scene.add(collisionGroup);
      }

      renderer.render(scene, camera);
    }
    animFrameId = requestAnimationFrame(render);
    log('Render loop started');
  }

  // ═══ toggle overlay ═══
  function toggleOverlay() {
    overlayActive = !overlayActive;
    setOverlayEnabled(overlayActive);

    if (overlayActive) {
      if (!overlayCanvas && !createOverlay()) { overlayActive = false; setOverlayEnabled(false); return; }
      overlayCanvas.style.display = 'block';
      if (collisionData1 && collisionData2 && !collisionGroup) {
        collisionGroup = buildAllCollisionGeometry();
        if (collisionGroup) {
          collisionReady = true;
          syncOverlaySize();
        }
      } else if (collisionGroup) {
        collisionReady = true;
      }
    } else {
      if (overlayCanvas) overlayCanvas.style.display = 'none';
    }

    log('Overlay ' + (overlayActive ? 'active' : 'inactive') + ' (ready=' + collisionReady + ')');
    updateStatusOverlay();
  }

  // ═══ Keyboard toggle: Alt+C ═══
  document.addEventListener('keydown', function(e) {
    if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault(); e.stopPropagation();
      toggleOverlay();
    }
  }, true);

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
      collisionGroup = buildAllCollisionGeometry();
      collisionReady = true;
      if (overlayActive && overlayCanvas) {
        overlayCanvas.style.display = 'block';
        syncOverlaySize();
      }
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

  function createStatusOverlay() {
    statusOverlay = document.createElement('div');
    statusOverlay.id = 'tanki-collision-status';
    statusOverlay.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;background:rgba(0,10,30,0.92);color:#00ccff;border:1px solid rgba(0,204,255,0.3);border-radius:8px;padding:8px 12px;font-size:12px;font-family:monospace;max-width:380px;user-select:none;cursor:pointer';
    statusOverlay.title = 'Click to toggle collision overlay';
    statusOverlay.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      toggleOverlay();
    }, true);
    document.body.appendChild(statusOverlay);
    updateStatusOverlay();
  }

  function updateStatusOverlay() {
    if (!statusOverlay) return;
    var pakoStatus = pakoOk ? 'OK' : 'MISSING';
    var threeStatus = threeOk ? 'OK' : 'MISSING';
    var canvasStatus = gameCanvas ? 'OK' : 'WAITING';
    var mapStatus = collisionData1 ? 'LOADED' : 'WAITING';
    var uniformCount = uniformTracker ? Object.keys(uniformTracker.uniqueUniformNames).length : 0;
    var mat4Count = uniformTracker ? Object.keys(uniformTracker.mat4UniformNames).length : 0;
    var c1Count = collisionData1 ? (collisionData1.shapesType1.length + collisionData1.shapesType2.length + collisionData1.shapesType3.length) : 0;
    var c2Count = collisionData2 ? (collisionData2.shapesType1.length + collisionData2.shapesType2.length + collisionData2.shapesType3.length) : 0;

    var depsColor = (pakoOk && threeOk) ? '#76ff33' : '#ff6644';
    var uniformColor = mat4Count > 0 ? '#76ff33' : '#00ccff';
    var overlayColor = overlayActive ? '#76ff33' : '#8a9ba8';

    statusOverlay.innerHTML =
      '<div style="font-weight:bold;margin-bottom:4px;color:' + overlayColor + ';">Collision Overlay v2.2</div>' +
      '<div style="color:#aaa;font-size:10px;">Alt+C toggle | Click here to toggle | Logs: localhost:3456</div>' +
      '<div style="margin-top:4px;font-size:11px;">' +
        '<span style="color:' + depsColor + ';">pako:' + pakoStatus + ' three:' + threeStatus + '</span> ' +
        '<span>canvas:' + canvasStatus + '</span>' +
      '</div>' +
      '<div style="font-size:11px;margin-top:2px;">' +
        'map.bin: <span style="color:' + (collisionData1 ? '#76ff33' : '#f39c12') + ';">' + mapStatus + '</span>' +
        ' (C1=' + c1Count + ' C2=' + c2Count + ')' +
      '</div>' +
      '<div style="font-size:11px;margin-top:2px;color:' + uniformColor + ';">' +
        'uniforms: ' + uniformCount + ' unique, ' + mat4Count + ' mat4' +
      '</div>' +
      '<div style="font-size:10px;margin-top:2px;color:#888;">' +
        'overlay: ' + (overlayActive ? 'ON' : 'OFF') + ' | camera: fallback' +
      '</div>' +
      '<div style="font-size:9px;margin-top:3px;color:#666;">' +
        'W/S=zoom A/D/Q/E=pan R=isometric' +
      '</div>';
  }

  // ═══ Resize observer ═══
  function setupResizeObserver() {
    if (!gameCanvas) return;
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function() {
        if (overlayActive) syncOverlaySize();
      });
      ro.observe(gameCanvas);
    }
    window.addEventListener('resize', function() {
      if (overlayActive) syncOverlaySize();
    });
  }

  // ═══ Check dependencies ═══
  function checkDeps() {
    pakoOk = typeof pako !== 'undefined';
    threeOk = typeof THREE !== 'undefined';
    depsReady = pakoOk && threeOk;
    if (!pakoOk) logWarn('pako not available, map.bin parsing disabled');
    if (!threeOk) logWarn('THREE not available, overlay rendering disabled');
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
    setupKeyboardControls();
    startCanvasWatch();

    waitForGameCanvas(function() {
      log('Game canvas found: ' + gameCanvas.width + '×' + gameCanvas.height);
      setupResizeObserver();

      if (isOverlayEnabled()) {
        createOverlay();
        toggleOverlay();
      }

      startRenderLoop();
    });

    createStatusOverlay();
    log('v2.2 ready — continuous canvas tracking + heartbeat');
  }

  // Start
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  log('Collision Overlay v2.2 script loaded');
})();