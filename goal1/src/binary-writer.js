// 二进制读写 + zlib 压缩封装（Node 版）
// 忠实移植自 testanki1.github.io/maps/editor.html:753-887
//   BinaryStream (753) / BinaryWriter (790) / decompressZlib (821)
//   unwrapPacket (829) / packHeader (845) / wrapPacketCompressed (871)
// 浏览器版用 CompressionStream/DecompressionStream，Node 版改用 zlib。

import { deflateSync, inflateSync } from 'node:zlib';

// ---------------- BinaryStream（读） ----------------
export class BinaryStream {
    constructor(buffer) {
        // buffer: ArrayBuffer | Uint8Array | TypedArray
        if (buffer instanceof Uint8Array) {
            this.buffer = buffer;
        } else {
            this.buffer = new Uint8Array(buffer);
        }
        this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
        this.offset = 0;
    }
    readUint8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
    readUint16(le = false) { const v = this.view.getUint16(this.offset, le); this.offset += 2; return v; }
    readUint32(le = false) { const v = this.view.getUint32(this.offset, le); this.offset += 4; return v; }
    readInt32(le = false) { const v = this.view.getInt32(this.offset, le); this.offset += 4; return v; }
    readFloat32(le = false) { const v = this.view.getFloat32(this.offset, le); this.offset += 4; return v; }
    readFloat64(le = false) { const v = this.view.getFloat64(this.offset, le); this.offset += 8; return v; }
    readBytes(len) { const v = this.buffer.subarray(this.offset, this.offset + len); this.offset += len; return v; }
    // 变长长度前缀（1/2/3 字节），与 editor.html:766 readStringLength 一致
    readStringLength() {
        const flags = this.readUint8();
        if ((flags & 0b10000000) === 0) return flags & 0b01111111;
        if ((flags & 0b01000000) === 0) return ((flags & 0b00111111) << 8) + this.readUint8();
        return ((flags & 0b00111111) << 16) + this.readUint16(false);
    }
    readString() { return new TextDecoder().decode(this.readBytes(this.readStringLength())); }
    readNullTerminatedString() {
        let str = '';
        while (true) {
            const char = this.readUint8();
            if (char === 0) break;
            str += String.fromCharCode(char);
        }
        return str;
    }
    // A3D 用的 4 字节 LE 长度前缀 + 4 字节对齐填充
    readLengthPrefixedStringA3D() {
        const len = this.readUint32(true);
        const str = new TextDecoder().decode(this.readBytes(len));
        this.offset += (((len + 3) >> 2) << 2) - len;
        return str;
    }
}

// ---------------- BinaryWriter（写） ----------------
export class BinaryWriter {
    constructor() { this.chunks = []; this.length = 0; }
    writeUint8(v) { this._add(new Uint8Array([v & 0xFF])); }
    writeUint16(v, le = false) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, le); this._add(b); }
    writeUint32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, le); this._add(b); }
    writeInt32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, le); this._add(b); }
    writeFloat32(v, le = false) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, le); this._add(b); }
    writeFloat64(v, le = false) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, le); this._add(b); }
    writeBytes(b) { this._add(b instanceof Uint8Array ? b : new Uint8Array(b)); }
    // 变长长度前缀（与 readStringLength 对应）
    writeStringLength(len) {
        if (len <= 0b01111111) { this.writeUint8(len); }
        else if (len <= 0x3FFF) { this.writeUint8(0b10000000 | (len >> 8)); this.writeUint8(len & 0xFF); }
        else { this.writeUint8(0b11000000 | (len >> 16)); this.writeUint16(len & 0xFFFF, false); }
    }
    writeString(str) { const bytes = new TextEncoder().encode(str); this.writeStringLength(bytes.length); this.writeBytes(bytes); }
    writeLengthPrefixedStringA3D(str) {
        const bytes = new TextEncoder().encode(str);
        this.writeUint32(bytes.length, true);
        this.writeBytes(bytes);
        const pad = (((bytes.length + 3) >> 2) << 2) - bytes.length;
        for (let i = 0; i < pad; i++) this.writeUint8(0);
    }
    _add(b) { this.chunks.push(b); this.length += b.length; }
    toUint8Array() {
        const res = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) { res.set(chunk, offset); offset += chunk.length; }
        return res;
    }
}

// ---------------- zlib 解压/压缩 ----------------
// 浏览器 DecompressionStream("deflate") 接受 zlib-wrapped (RFC 1950) 数据；
// Node zlib.inflateSync 同样处理 zlib-wrapped，二者兼容。
export function decompressZlib(uint8array) {
    return inflateSync(uint8array);
}
export function compressZlib(uint8array) {
    // 浏览器 CompressionStream("deflate") 输出 zlib-wrapped deflate；
    // Node zlib.deflateSync 默认也是 zlib-wrapped（含 2 字节头 + 4 字节 adler32）。
    return deflateSync(uint8array);
}

// ---------------- unwrapPacket（解包） ----------------
// 移植自 editor.html:829
export function unwrapPacket(stream) {
    const flags = stream.readUint8();
    const compressed = (flags & 0b01000000) > 0;
    let len = 0;
    if ((flags & 0b10000000) === 0) {
        len = stream.readUint8() + ((flags & 0b00111111) << 8);
    } else {
        const b1 = stream.readUint8(), b2 = stream.readUint8(), b3 = stream.readUint8();
        len = (b1 << 16) | (b2 << 8) | b3;
        len += (flags & 0b00111111) * 16777216;
    }
    let data = stream.readBytes(len);
    if (compressed) data = decompressZlib(data);
    return new BinaryStream(data);
}

// ---------------- packHeader（位掩码头） ----------------
// 移植自 editor.html:845
// bits[i] === true  → 该位"存在/启用"，编码为 0
// bits[i] === false → 该位"不存在/禁用"，编码为 1（extBytes 默认 fill 255）
export function packHeader(bits) {
    const extCount = Math.ceil(bits.length / 8);
    const extBytes = new Uint8Array(extCount);
    extBytes.fill(255);
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) {
            const byteIdx = Math.floor(i / 8);
            const bitIdx = 7 - (i % 8);
            extBytes[byteIdx] &= ~(1 << bitIdx);
        }
    }
    let flags = 0b10000000;
    let headerPrefix;
    if (extCount <= 63) {
        flags |= extCount;
        headerPrefix = new Uint8Array([flags]);
    } else {
        flags |= 0b01000000;
        flags |= (extCount >> 16) & 0b00111111;
        headerPrefix = new Uint8Array(3);
        headerPrefix[0] = flags;
        new DataView(headerPrefix.buffer).setUint16(1, extCount & 0xFFFF, false);
    }
    return { headerPrefix, extBytes };
}

// 解析位掩码头（parseMapBin 用），返回 { bits, stream }，bits[i]===true 表示该可选字段存在
// 移植自 editor.html:1187-1199
export function readPacketHeader(packet) {
    const fullOriginalBits = [];
    const flags = packet.readUint8();
    if ((flags & 0b10000000) === 0) {
        const intBits = flags << 3;
        for (let i = 7; i >= 3; i--) fullOriginalBits.push((intBits & (1 << i)) === 0);
        const extCount = (flags & 0b01100000) >> 5;
        const extBytes = packet.readBytes(extCount);
        for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);
    } else {
        let extCount = ((flags & 0b01000000) === 0) ? (flags & 0b00111111) : (((flags & 0b00111111) << 16) + packet.readUint16(false));
        const extBytes = packet.readBytes(extCount);
        for (let i = 0; i < extBytes.length; i++) for (let b = 7; b >= 0; b--) fullOriginalBits.push((extBytes[i] & (1 << b)) === 0);
    }
    const optMask = [...fullOriginalBits].reverse();
    const popBit = () => optMask.pop();
    return { popBit };
}

// ---------------- wrapPacketCompressed（打包） ----------------
// 移植自 editor.html:871
// 包结构：flags(1) + len(3, big-endian) + compressedPayload
// flags = 0b11000000 | (len >> 24 & 0x3F)  → 同时设置 bit7(长格式) 和 bit6(压缩)
export function wrapPacketCompressed(payload) {
    const compressed = compressZlib(payload);
    const bw = new BinaryWriter();
    const len = compressed.length;
    const flags = 0b11000000 | ((len >> 24) & 0b00111111);
    bw.writeUint8(flags);
    bw.writeUint8((len >> 16) & 0xFF);
    bw.writeUint8((len >> 8) & 0xFF);
    bw.writeUint8(len & 0xFF);
    bw.writeBytes(compressed);
    return bw.toUint8Array();
}
