// map.bin 序列化器（Node 版，纯数据，无 three.js 依赖）
// 忠实移植自 testanki1.github.io/maps/editor.html:2642-2832 generateMapBin
//
// 写入顺序（与 parse-map-bin.js 读取顺序严格对应）：
//   位掩码: atlases位 → 未知数组位
//   atlases?（若写）
//   未知数组?（若写）
//   collisionData1（type1/type2/type3 三段）+ collisionData2
//   materials[]（matID/name/[skipArr位]/shader/texParams[libName位+name+texName]/[skipArr2,3,4位]）
//   位掩码: 未知数组位
//   未知数组?（若写）
//   props[]（grpName位+grpName?/id/libName/matID/name/pos/rot位+rot?/scale位+scale?）
//
// 注意：bitFlags 的 push 顺序必须与 parseMapBin 的 popBit 顺序完全一致。

import { BinaryWriter, packHeader, wrapPacketCompressed } from './binary-writer.js';

const EPS = 1e-5;

function writeCols(bw, col) {
    if (!col) {
        bw.writeStringLength(0); bw.writeStringLength(0); bw.writeStringLength(0);
        return;
    }
    // type1: 9×f32
    bw.writeStringLength(col.shapesType1?.length || 0);
    for (const d of (col.shapesType1 || [])) {
        for (let i = 0; i < 9; i++) bw.writeFloat32(d[i], false);
    }
    // type2: f64 + 6×f32 + f64
    bw.writeStringLength(col.shapesType2?.length || 0);
    for (const d of (col.shapesType2 || [])) {
        bw.writeFloat64(d.f1, false);
        for (let i = 0; i < 6; i++) bw.writeFloat32(d.data[i], false);
        bw.writeFloat64(d.f2, false);
    }
    // type3: f64 + 15×f32
    bw.writeStringLength(col.shapesType3?.length || 0);
    for (const d of (col.shapesType3 || [])) {
        bw.writeFloat64(d.f1, false);
        for (let i = 0; i < 15; i++) bw.writeFloat32(d.data[i], false);
    }
}

// 写 atlases 块（若 atlases 非空且 writeAtlases=true）
function writeAtlases(bw, bitFlags, atlases) {
    if (!atlases || Object.keys(atlases).length === 0) {
        bitFlags.push(false);
        return;
    }
    bitFlags.push(true);
    const names = Object.keys(atlases);
    bw.writeStringLength(names.length);
    for (const aName of names) {
        const a = atlases[aName];
        bw.writeInt32(a.height, false);
        bw.writeString(aName);
        bw.writeUint32(a.aUnknown || 0, false);
        const rectKeys = Object.keys(a.rects);
        bw.writeStringLength(rectKeys.length);
        for (const k of rectKeys) {
            const r = a.rects[k];
            bw.writeUint32(r.h, false);      // rHeight
            bw.writeString(r.rLib || '');    // rLib
            bw.writeString(r.originalName || r.name || '');
            bw.writeUint32(r.w, false);      // rWidth
            bw.writeUint32(r.x, false);
            bw.writeUint32(r.y, false);
        }
        bw.writeUint32(a.width, false);
    }
}

// 序列化 map.bin
// 输入 data: {
//   props:     [{ id, grpName, libName, matID, name, pos:[x,y,z], rot?:[x,y,z], scale?:[x,y,z] }],
//   materials: [{ id, name, shader, texParams:[{ name, texName, libName? }] }],
//   atlases?:  { name: { width, height, aUnknown, rects: { key: {x,y,w,h,originalName,rLib} } } },
//   collisionData1?: { shapesType1:[], shapesType2:[], shapesType3:[] },
//   collisionData2?: { shapesType1:[], shapesType2:[], shapesType3:[] },
// }
// 返回 Uint8Array（完整 map.bin，已 zlib 压缩 + 包头封装）
export function serializeMapBin(data) {
    const props = data.props || [];
    const materials = data.materials || [];
    const atlases = data.atlases || null;
    const col1 = data.collisionData1 || null;
    const col2 = data.collisionData2 || null;

    const bitFlags = [];
    const pushBit = (b) => bitFlags.push(b);
    const bw = new BinaryWriter();

    // 位1: atlases
    writeAtlases(bw, bitFlags, atlases);
    // 位2: 未知对象数组（始终不写）
    pushBit(false);

    // 碰撞数据（默认全空，与 editor.html:2785 一致）
    writeCols(bw, col1);
    writeCols(bw, col2);

    // materials
    bw.writeStringLength(materials.length);
    for (const m of materials) {
        bw.writeUint32(m.id, false);
        bw.writeString(m.name);
        pushBit(false); // skipArr1
        bw.writeString(m.shader);
        const texParams = m.texParams || [];
        bw.writeStringLength(texParams.length);
        for (const tp of texParams) {
            if (tp.libName != null && tp.libName !== '') {
                pushBit(true);
                bw.writeString(tp.libName);
            } else {
                pushBit(false);
            }
            bw.writeString(tp.name);
            bw.writeString(tp.texName);
        }
        pushBit(false); // skipArr2
        pushBit(false); // skipArr3
        pushBit(false); // skipArr4
    }

    // 未知对象数组（materials 后，始终不写）
    pushBit(false);

    // props
    bw.writeStringLength(props.length);
    for (const p of props) {
        if (p.grpName && p.grpName !== '') { pushBit(true); bw.writeString(p.grpName); }
        else { pushBit(false); }
        bw.writeUint32(p.id, false);
        bw.writeString(p.libName ?? '');
        bw.writeUint32(p.matID, false);
        bw.writeString(p.name);
        bw.writeFloat32(p.pos[0], false); bw.writeFloat32(p.pos[1], false); bw.writeFloat32(p.pos[2], false);
        const rot = p.rot || [0, 0, 0];
        const isRotZero = Math.abs(rot[0]) < EPS && Math.abs(rot[1]) < EPS && Math.abs(rot[2]) < EPS;
        if (!isRotZero) { pushBit(true); bw.writeFloat32(rot[0], false); bw.writeFloat32(rot[1], false); bw.writeFloat32(rot[2], false); }
        else { pushBit(false); }
        const scale = p.scale || [1, 1, 1];
        const isScaleOne = Math.abs(scale[0] - 1) < EPS && Math.abs(scale[1] - 1) < EPS && Math.abs(scale[2] - 1) < EPS;
        if (!isScaleOne) { pushBit(true); bw.writeFloat32(scale[0], false); bw.writeFloat32(scale[1], false); bw.writeFloat32(scale[2], false); }
        else { pushBit(false); }
    }

    // 组装：headerPrefix + extBytes + body
    const header = packHeader(bitFlags);
    const bodyBytes = bw.toUint8Array();
    const uncompressed = new Uint8Array(header.headerPrefix.length + header.extBytes.length + bodyBytes.length);
    uncompressed.set(header.headerPrefix, 0);
    uncompressed.set(header.extBytes, header.headerPrefix.length);
    uncompressed.set(bodyBytes, header.headerPrefix.length + header.extBytes.length);

    return wrapPacketCompressed(uncompressed);
}
