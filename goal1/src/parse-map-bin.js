// map.bin 解析器（Node 版，无浏览器依赖）
// 忠实移植自 testanki1.github.io/maps/editor.html:1183-1308 parseMapBin
//   以及 editor.html:1234-1262 readCols

import { BinaryStream, unwrapPacket, readPacketHeader } from './binary-writer.js';

// 解析碰撞数据：三段 shapesType1/2/3
// 移植自 editor.html:1234 readCols
function readCols(packet) {
    const col = { shapesType1: [], shapesType2: [], shapesType3: [] };
    let len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
        // type1: OBB 有向包围盒 = pos(3) + rot(3) + size(3) = 9×f32
        col.shapesType1.push([
            packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false),
            packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false),
            packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false),
        ]);
    }
    len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
        // type2: 薄片盒 = length(f64) + pos(3)+rot(3) = 6×f32 + width(f64)
        const f1 = packet.readFloat64(false);
        const data = [];
        for (let j = 0; j < 6; j++) data.push(packet.readFloat32(false));
        const f2 = packet.readFloat64(false);
        col.shapesType2.push({ f1, data, f2 });
    }
    len = packet.readStringLength();
    for (let i = 0; i < len; i++) {
        // type3: 三角面片 = meta(f64) + pos(3)+rot(3)+3顶点(9) = 15×f32
        const f1 = packet.readFloat64(false);
        const data = [];
        for (let j = 0; j < 15; j++) data.push(packet.readFloat32(false));
        col.shapesType3.push({ f1, data });
    }
    return col;
}

// 解析 map.bin，返回 { props, materials, atlases, collisionData1, collisionData2 }
// 移植自 editor.html:1183 parseMapBin
export function parseMapBin(buffer) {
    const stream = new BinaryStream(buffer);
    const packet = unwrapPacket(stream);
    const { popBit } = readPacketHeader(packet);

    const skipObjectArray = (p, cb) => { const len = p.readStringLength(); for (let i = 0; i < len; i++) cb(p); };
    const readV3 = () => [packet.readFloat32(false), packet.readFloat32(false), packet.readFloat32(false)];

    const result = { props: [], materials: {}, atlases: {} };

    // 位1: atlases
    if (popBit()) {
        const atlasLen = packet.readStringLength();
        for (let i = 0; i < atlasLen; i++) {
            const aHeight = packet.readInt32(false);
            const aName = packet.readString();
            const aUnknown = packet.readUint32(false);
            const rects = {};
            const rectLen = packet.readStringLength();
            for (let j = 0; j < rectLen; j++) {
                const rHeight = packet.readUint32(false);
                const rLib = packet.readString();
                const rName = packet.readString();
                const rWidth = packet.readUint32(false);
                const rx = packet.readUint32(false);
                const ry = packet.readUint32(false);
                rects[`${rLib}_${rName}`] = { x: rx, y: ry, w: rWidth, h: rHeight, originalName: rName, rLib: rLib };
            }
            const aWidth = packet.readUint32(false);
            result.atlases[aName] = { width: aWidth, height: aHeight, aUnknown, rects };
        }
    }

    // 位2: 未知对象数组
    if (popBit()) skipObjectArray(packet, p => { p.readUint32(false); p.readString(); p.offset += 12; p.readString(); });

    // 碰撞数据（必读，无位掩码）
    result.collisionData1 = readCols(packet);
    result.collisionData2 = readCols(packet);

    // materials
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

    // 未知对象数组
    if (popBit()) skipObjectArray(packet, p => { p.offset += 28; });

    // props
    let maxPropId = 0;
    const propLen = packet.readStringLength();
    for (let i = 0; i < propLen; i++) {
        let grpName = ''; if (popBit()) grpName = packet.readString();
        const id = packet.readUint32(false);
        if (id > maxPropId) maxPropId = id;
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
