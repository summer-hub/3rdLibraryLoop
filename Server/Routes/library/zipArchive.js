/**
 * zipArchive.js — 零依赖 ZIP 打包工具（仅用 Node 内置模块）
 *
 * 用途：将任务目录下的检视报告（.md）打包为 ZIP 供前端下载。
 * 实现：传统 ZIP 格式（PKZIP 2.0），deflate 压缩（zlib.deflateRawSync），
 *       压缩后不小于原文时回退 STORE；文件名 UTF-8（bit11 标志，支持中文）。
 *
 * 不使用 ZIP64：文件数 > 65535 或单文件/归档 > 4GB 时抛错（检视报告远小于该量级）。
 *
 * 用法：
 *   import { createZipBuffer } from '../library/zipArchive.js';
 *   const zip = createZipBuffer([
 *     { name: 'taskId/报告.md', data: buffer, mtime: new Date() },
 *   ]);
 */

import zlib from 'node:zlib';

// ─── CRC32（PKZIP 多项式 0xEDB88320）────────────────────────────────────────

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c;
    }
    return table;
})();

/**
 * @param {Buffer} buf
 * @returns {number} 无符号 CRC32
 */
function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

/**
 * JS Date → ZIP 的 DOS 时间/日期字段。
 * @param {Date|number|string} [date]
 * @returns {{time: number, day: number}}
 */
function dosDateTime(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const year = Math.min(2107, Math.max(1980, d.getFullYear()));
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, day };
}

const MAX_UINT16 = 0xFFFF;
const MAX_UINT32 = 0xFFFFFFFF;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const FLAG_UTF8 = 0x0800;         // bit11：文件名为 UTF-8 编码
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/**
 * 构建 ZIP 归档 Buffer。
 *
 * @param {Array<{name: string, data: Buffer, mtime?: Date}>} files - 文件列表（name 支持 UTF-8 中文，可含目录前缀）
 * @returns {Buffer} 完整 ZIP 归档
 * @throws {Error} 文件列表为空 / 超出传统 ZIP 格式上限
 */
export function createZipBuffer(files) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('createZipBuffer: files 不能为空');
    }
    if (files.length > MAX_UINT16) {
        throw new Error(`createZipBuffer: 文件数 ${files.length} 超过传统 ZIP 上限 65535（需 ZIP64）`);
    }

    /** @type {Buffer[]} 顺序拼接的片段（local headers + 数据） */
    const locals = [];
    /** @type {Buffer[]} 中央目录记录 */
    const centrals = [];
    /** 当前文件 local header 的起始偏移 */
    let offset = 0;

    for (const f of files) {
        const nameBuf = Buffer.from(f.name, 'utf8');
        if (nameBuf.length > MAX_UINT16) {
            throw new Error(`createZipBuffer: 文件名过长: ${f.name}`);
        }
        const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
        const crc = crc32(data);

        // deflate 压缩；不小于原文时回退 STORE
        let method = METHOD_DEFLATE;
        let payload = zlib.deflateRawSync(data, { level: 9 });
        if (payload.length >= data.length) {
            method = METHOD_STORE;
            payload = data;
        }

        if (data.length > MAX_UINT32 || payload.length > MAX_UINT32) {
            throw new Error(`createZipBuffer: 文件过大（需 ZIP64）: ${f.name}`);
        }

        const { time, day } = dosDateTime(f.mtime);

        // ── Local File Header（30 字节 + 文件名）──
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(LOCAL_HEADER_SIG, 0);
        lh.writeUInt16LE(20, 4);                      // version needed: 2.0
        lh.writeUInt16LE(FLAG_UTF8, 6);               // flags: UTF-8 文件名
        lh.writeUInt16LE(method, 8);
        lh.writeUInt16LE(time, 10);
        lh.writeUInt16LE(day, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(payload.length, 18);         // compressed size
        lh.writeUInt32LE(data.length, 22);            // uncompressed size
        lh.writeUInt16LE(nameBuf.length, 26);
        lh.writeUInt16LE(0, 28);                      // extra field length

        locals.push(lh, nameBuf, payload);

        // ── Central Directory Record（46 字节 + 文件名）──
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
        cd.writeUInt16LE(0x0314, 4);                  // version made by: UNIX(3) + ZIP 2.0
        cd.writeUInt16LE(20, 6);                      // version needed
        cd.writeUInt16LE(FLAG_UTF8, 8);
        cd.writeUInt16LE(method, 10);
        cd.writeUInt16LE(time, 12);
        cd.writeUInt16LE(day, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(payload.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt16LE(0, 30);                      // extra length
        cd.writeUInt16LE(0, 32);                      // comment length
        cd.writeUInt16LE(0, 34);                      // disk number start
        cd.writeUInt16LE(0, 36);                      // internal attrs
        cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: UNIX rw-r--r--
        cd.writeUInt32LE(offset, 42);                 // local header 偏移

        centrals.push(Buffer.concat([cd, nameBuf]));

        offset += 30 + nameBuf.length + payload.length;
    }

    if (offset > MAX_UINT32) {
        throw new Error('createZipBuffer: 归档总大小超过 4GB（需 ZIP64）');
    }
    const cdBuf = Buffer.concat(centrals);

    // ── End of Central Directory（22 字节）──
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(0, 4);                         // 当前磁盘号
    eocd.writeUInt16LE(0, 6);                         // 中央目录所在磁盘号
    eocd.writeUInt16LE(files.length, 8);              // 本磁盘条目数
    eocd.writeUInt16LE(files.length, 10);             // 总条目数
    eocd.writeUInt32LE(cdBuf.length, 12);             // 中央目录大小
    eocd.writeUInt32LE(offset, 16);                   // 中央目录起始偏移
    eocd.writeUInt16LE(0, 20);                        // 注释长度

    return Buffer.concat([...locals, cdBuf, eocd]);
}

export default { createZipBuffer };
