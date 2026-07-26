'use strict';

const zlib = require('zlib');

class BinaryStream {
  constructor(buffer) {
    this.buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    this.offset = 0;
  }
  readUint8() { return this.buffer[this.offset++]; }
  readUint16(le = false) {
    const v = le ? this.buffer.readUInt16LE(this.offset) : this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }
  readUint32(le = false) {
    const v = le ? this.buffer.readUInt32LE(this.offset) : this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  readInt32(le = false) {
    const v = le ? this.buffer.readInt32LE(this.offset) : this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  readFloat32(le = false) {
    const v = le ? this.buffer.readFloatLE(this.offset) : this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return v;
  }
  readFloat64(le = false) {
    const v = le ? this.buffer.readDoubleLE(this.offset) : this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return v;
  }
  readBytes(len) {
    const v = this.buffer.subarray(this.offset, this.offset + len);
    this.offset += len;
    return v;
  }
  readStringLength() {
    const flags = this.readUint8();
    if ((flags & 0x80) === 0) return flags & 0x7f;
    if ((flags & 0x40) === 0) return ((flags & 0x3f) << 8) + this.readUint8();
    return ((flags & 0x3f) << 16) + this.readUint16(false);
  }
  readString() {
    return this.readBytes(this.readStringLength()).toString('utf8');
  }
}

function unwrapPacket(stream) {
  const flags = stream.readUint8();
  const compressed = (flags & 0x40) > 0;
  let len = 0;
  if ((flags & 0x80) === 0) {
    len = stream.readUint8() + ((flags & 0x3f) << 8);
  } else {
    const b1 = stream.readUint8(), b2 = stream.readUint8(), b3 = stream.readUint8();
    len = (b1 << 16) | (b2 << 8) | b3;
    len += (flags & 0x3f) * 16777216;
  }
  let data = stream.readBytes(len);
  if (compressed) {
    try { data = zlib.inflateSync(data); }
    catch (e) { data = zlib.inflateRawSync(data); }
  }
  return new BinaryStream(data);
}

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
    const extCount = ((flags & 0x40) === 0) ? (flags & 0x3f) : (((flags & 0x3f) << 16) + packet.readUint16(false));
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
      col.shapesType1.push([
        packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false),
        packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false),
        packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)
      ]);
    }
    len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
      const f1 = packet.readFloat64(false);
      const data = [];
      for (let j = 0; j < 6; j++) data.push(packet.readFloat32(false));
      const f2 = packet.readFloat64(false);
      col.shapesType2.push({ f1, data, f2 });
    }
    len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
      const f1 = packet.readFloat64(false);
      const data = [];
      for (let j = 0; j < 15; j++) data.push(packet.readFloat32(false));
      col.shapesType3.push({ f1, data });
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
    let grpName = ''; if (popBit()) grpName = packet.readString();
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

function extractCollisionCompact(parsed) {
  const compact = (col) => ({
    type1: col.shapesType1.map(d => [d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8]]),
    type2: col.shapesType2.map(d => [d.f1, d.data[0], d.data[1], d.data[2], d.data[3], d.data[4], d.data[5], d.f2]),
    type3: col.shapesType3.map(d => [d.f1, d.data[0], d.data[1], d.data[2], d.data[3], d.data[4], d.data[5], d.data[6], d.data[7], d.data[8], d.data[9], d.data[10], d.data[11], d.data[12], d.data[13], d.data[14]])
  });
  return {
    collisionData1: compact(parsed.collisionData1),
    collisionData2: compact(parsed.collisionData2)
  };
}

function extractPropsCompact(parsed) {
  return parsed.props.map(p => ({
    n: p.name, lib: p.libName,
    pos: p.pos, rot: p.rot, scale: p.scale
  }));
}

module.exports = { BinaryStream, unwrapPacket, parseMapBin, extractCollisionCompact, extractPropsCompact };
