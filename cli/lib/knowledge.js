/**
 * knowledge.js —— 3rdloop knowledge：知识沉淀 JSON 打包回收（export）与收件（import）
 *
 * 最简人工中转通道：知识沉淀系统的数据全部是 JSON（<dataDir>/Knowledge/ 下的
 * index.json 登记表 + kn_*.json 条目），export 打包这些 JSON 为 zip 发给维护者；
 * 维护者 import 解包到收件箱目录人工评估，不直接覆盖本地知识库。
 *
 *   用户侧:  3rdloop knowledge export [--output <file>] [--note <text>]
 *   维护者侧: 3rdloop knowledge import <zip> [--dry-run]
 *
 * 设计约束：
 *   - 只打 JSON，不碰任何 md / kb-data / BadCase
 *   - export 纯本地打包，不上传
 *   - import 落位到收件箱 ~/.3lib/3rdloop/knowledge-inbox/<来源>-<日期>/，
 *     多个用户的包互不冲突，也不污染维护者自己的 Knowledge 库（人工评估后自行入库）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import process from 'node:process';

// ─── 路径 ─────────────────────────────────────────────────────────────

/**
 * 知识目录。
 * @param {string} dataDir - CLI 解析的数据目录（Knowledge = <dataDir>/Knowledge）
 */
export function knowledgePaths(dataDir) {
    return {
        knowledgeDir: path.join(dataDir, 'Knowledge'),
        inboxRoot: null, // import 侧单独解析（基于 user3libHome）
    };
}

/** 维护者收件箱根目录。 */
function inboxRoot(user3libHome) {
    return path.join(user3libHome, '3rdloop', 'knowledge-inbox');
}

// ─── zip 读写（单成员 DEFLATE zip，纯 Node 无第三方依赖）──────────────
// 一个 zip 只含一个被 deflate 压缩的 JSON 载荷文件 payload.json。

const PAYLOAD_NAME = 'payload.json';

/** 单文件 DEFLATE zip 写入（无第三方依赖）。 */
function writeSingleFileZip(filePath, content) {
    const data = Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);      // signature
    local.writeUInt16LE(20, 4);               // version needed
    local.writeUInt16LE(0, 6);                // flags
    local.writeUInt16LE(8, 8);                // method: deflate
    local.writeUInt16LE(0, 10);               // mod time
    local.writeUInt16LE(0x2d21, 12);          // mod date（任意合法值）
    local.writeUInt32LE(crc32(data), 14);     // crc32
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(PAYLOAD_NAME.length, 26);
    local.writeUInt16LE(0, 28);               // extra len

    // Central directory
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);             // version made by
    central.writeUInt16LE(20, 6);             // version needed
    central.writeUInt16LE(0, 8);              // flags
    central.writeUInt16LE(8, 10);             // method
    central.writeUInt16LE(0, 12);             // time
    central.writeUInt16LE(0x2d21, 14);        // date
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(PAYLOAD_NAME.length, 28);
    // 其余字段 0（comment/extra/disk/attrs/offset 均为 0）

    const nameBuf = Buffer.from(PAYLOAD_NAME, 'utf8');
    // central directory 大小含文件名（header 46 + name），起始偏移 = local(30) + name + data
    const centralSize = central.length + nameBuf.length;
    const centralOffset = local.length + nameBuf.length + compressed.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);                 // entries
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralSize, 12);      // central directory 总大小（含文件名）
    eocd.writeUInt32LE(centralOffset, 16);    // central directory 起始偏移

    fs.writeFileSync(filePath, Buffer.concat([local, nameBuf, compressed, central, nameBuf, eocd]));
}

/** 读取单成员 zip（自动识别 STORE/DEFLATE）。 */
function readSingleFileZip(filePath) {
    const buf = fs.readFileSync(filePath);
    // 找 EOCD
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('非法 zip：未找到 EOCD');
    const entryCount = buf.readUInt16LE(eocd + 10);
    if (entryCount !== 1) throw new Error(`非法载荷 zip：期望单成员，实际 ${entryCount} 个`);

    // Local header
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('非法 zip：缺少 local header');
    const method = buf.readUInt16LE(8);
    const compSize = buf.readUInt32LE(18);
    const nameLen = buf.readUInt16LE(26);
    const extraLen = buf.readUInt16LE(28);
    const dataStart = 30 + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);

    const data = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
    return data.toString('utf8');
}

/** crc32（IEEE 802.3，zip 标准）。 */
function crc32(buf) {
    let c;
    const table = crc32._table || (crc32._table = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })());
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// ─── export ───────────────────────────────────────────────────────────

/**
 * 3rdloop knowledge export 实现：打包 <dataDir>/Knowledge/ 下全部 JSON。
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string[]} opts.rest - 命令参数（--output/--note）
 * @param {boolean} opts.jsonMode
 * @returns {Promise<number>} 退出码
 */
export async function knowledgeExport({ dataDir, rest = [], jsonMode = false }) {
    const out = (data) => { if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n'); };
    const log = (msg) => process.stderr.write(`${msg}\n`);

    const output = _flagValue(rest, '--output');
    const note = _flagValue(rest, '--note') || '';

    const knowledgeDir = path.join(dataDir, 'Knowledge');
    if (!fs.existsSync(knowledgeDir)) {
        log(`未找到知识目录: ${knowledgeDir}`);
        log('提示: 知识在任务执行后自动沉淀（db/Knowledge），先跑几个任务再看。');
        return 0;
    }

    // 收集全部 .json（index.json 登记表 + kn_*.json 知识条目）
    const files = {};
    for (const entry of fs.readdirSync(knowledgeDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        files[entry.name] = fs.readFileSync(path.join(knowledgeDir, entry.name), 'utf8');
    }
    if (Object.keys(files).length === 0) {
        log(`知识目录为空: ${knowledgeDir}`);
        return 0;
    }

    const manifest = {
        format: '3rdloop-knowledge/1',
        exportedAt: new Date().toISOString(),
        host: os.hostname(),
        platform: process.platform,
        note,
        stats: {
            files: Object.keys(files).length,
            entries: files['index.json']
                ? _countIndexEntries(files['index.json'])
                : Object.keys(files).filter(n => n.startsWith('kn_')).length,
        },
    };
    const payload = JSON.stringify({ manifest, knowledgeFiles: files }, null, 2);

    // 默认文件名：./3rdloop-knowledge-<YYYYMMDD>-<主机名>.zip
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const defaultName = `3rdloop-knowledge-${date}-${os.hostname().split('.')[0]}.zip`;
    const target = output ? path.resolve(output) : path.join(process.cwd(), defaultName);

    writeSingleFileZip(target, payload);

    if (jsonMode) {
        out({ ok: true, file: target, ...manifest.stats });
    } else {
        log(`[3rdloop knowledge] 知识包已生成: ${target}`);
        log(`  JSON 文件: ${manifest.stats.files} 个（index.json + kn_*.json）`);
        log(`  知识条目: ${manifest.stats.entries} 条`);
        if (note) log(`  备注: ${note}`);
        log(`  大小: ${(fs.statSync(target).size / 1024).toFixed(1)} KB`);
        log(`请将 zip 发送给维护者（微信/邮件均可）；内容由你本机知识 JSON 打包而成，可先解压自查。`);
    }
    return 0;
}

/** 解析 index.json 统计条目数（容错：解析失败返回 0）。 */
function _countIndexEntries(indexRaw) {
    try {
        const arr = JSON.parse(indexRaw);
        return Array.isArray(arr) ? arr.length : 0;
    } catch {
        return 0;
    }
}

// ─── import ───────────────────────────────────────────────────────────

/**
 * 3rdloop knowledge import 实现（维护者侧：收 zip → 解到收件箱目录）。
 * 收件箱按 <来源主机>-<导出时间> 隔离，多包互不冲突；不覆盖本地 Knowledge 库。
 * @param {object} opts
 * @param {string} opts.user3libHome
 * @param {string[]} opts.rest - <zip> --dry-run
 * @param {boolean} opts.jsonMode
 */
export async function knowledgeImport({ user3libHome, rest = [], jsonMode = false }) {
    const out = (data) => { if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n'); };
    const log = (msg) => process.stderr.write(`${msg}\n`);

    const dryRun = rest.includes('--dry-run');
    const zipPath = rest.find(a => !a.startsWith('--'));
    if (!zipPath) {
        log('缺少 zip 路径。用法: 3rdloop knowledge import <zip> [--dry-run]');
        return 1;
    }
    const absZip = path.resolve(zipPath);
    if (!fs.existsSync(absZip)) {
        log(`错误: 文件不存在: ${absZip}`);
        return 1;
    }

    let payload;
    try {
        payload = JSON.parse(readSingleFileZip(absZip));
    } catch (err) {
        log(`错误: 解析知识包失败: ${err.message}`);
        return 1;
    }
    const { manifest, knowledgeFiles } = payload;
    if (!manifest || manifest.format !== '3rdloop-knowledge/1') {
        log(`错误: 未知知识包格式: ${manifest?.format || '(缺失 manifest)'}`);
        return 1;
    }

    // 收件箱：~/.3lib/3rdloop/knowledge-inbox/<主机名>-<导出日期>/
    const date = String(manifest.exportedAt).slice(0, 10);
    const host = String(manifest.host || 'unknown').split('.')[0];
    const inboxDir = path.join(inboxRoot(user3libHome), `${host}-${date}`);

    if (dryRun) {
        if (jsonMode) out({ ok: true, dryRun: true, manifest, inboxDir, files: Object.keys(knowledgeFiles || {}) });
        else {
            log(`[3rdloop knowledge] 预演（不写入任何文件）`);
            log(`  知识包: ${absZip}`);
            log(`  导出时间: ${manifest.exportedAt}  来源: ${manifest.host}（${manifest.platform}）`);
            if (manifest.note) log(`  备注: ${manifest.note}`);
            log(`  JSON 文件: ${Object.keys(knowledgeFiles || {}).length} 个 → 收件箱 ${inboxDir}`);
        }
        return 0;
    }

    let written = 0;
    for (const [name, content] of Object.entries(knowledgeFiles || {})) {
        fs.mkdirSync(inboxDir, { recursive: true });
        fs.writeFileSync(path.join(inboxDir, name), content);
        written++;
    }

    if (jsonMode) {
        out({ ok: true, inboxDir, written, manifest });
    } else {
        log(`[3rdloop knowledge] 已解包到收件箱: ${inboxDir}`);
        log(`  JSON 文件: ${written} 个（含 index.json + kn_*.json）`);
        log(`  来源: ${manifest.host}  导出时间: ${manifest.exportedAt}${manifest.note ? `  备注: ${manifest.note}` : ''}`);
        log(`人工评估后可将有价值条目拷入仓库或本地 <dataDir>/Knowledge/。`);
    }
    return 0;
}

// ─── 帮助 / 入口 ──────────────────────────────────────────────────────

function _flagValue(rest, name) {
    const idx = rest.indexOf(name);
    return idx !== -1 ? rest[idx + 1] : undefined;
}

/** 该 flag 是否携带值。 */
function _hasValue(flag) {
    return flag === '--output' || flag === '--note';
}

export function printKnowledgeHelp() {
    process.stdout.write(`3rdloop knowledge —— 知识沉淀 JSON 打包回收（人工中转通道）

用法（用户侧：打包发给维护者）:
  3rdloop knowledge export [选项]
      打包 <dataDir>/Knowledge/ 下的全部 JSON（index.json 登记表 + kn_*.json 知识条目）
  选项:
    --output <file>   输出路径（默认 ./3rdloop-knowledge-<日期>-<主机名>.zip）
    --note <text>     备注（写入 manifest，如 "mp3agic 检视批次"）
    --json            结构化输出

用法（维护者侧：收到 zip 后解包到收件箱）:
  3rdloop knowledge import <zip> [--dry-run]
      解包到 ~/.3lib/3rdloop/knowledge-inbox/<来源主机>-<日期>/
      多个用户的包互不冲突；不覆盖本地知识库，人工评估后自行入库

说明:
  - export 纯本地打包，不上传任何数据；可先解压自查内容再发送
  - 只含知识沉淀 JSON，不含 md / kb 文档 / BadCase
`);
}

/**
 * 3rdloop knowledge 命令入口。
 * @param {object} opts
 * @param {string[]} opts.rest
 * @param {string} opts.user3libHome
 * @param {string} opts.dataDir
 * @param {boolean} opts.jsonMode
 * @returns {Promise<number>}
 */
export async function cmdKnowledge({ rest = [], user3libHome = '', dataDir = '', jsonMode = false }) {
    if (rest.includes('--help') || rest.includes('-h')) {
        printKnowledgeHelp();
        return 0;
    }
    // 定位位置子命令（第一个非 flag 参数），并从参数中剥离子命令词
    let subIdx = -1;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i].startsWith('--')) {
            if (_hasValue(rest[i]) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) i++;
            continue;
        }
        subIdx = i;
        break;
    }
    const args = subIdx === -1 ? [] : [...rest.slice(0, subIdx), ...rest.slice(subIdx + 1)];

    if (subIdx === -1) {
        printKnowledgeHelp();
        return rest.length === 0 ? 0 : 1;
    }
    const sub = rest[subIdx];
    if (sub === 'export') return knowledgeExport({ dataDir, rest: args, jsonMode });
    if (sub === 'import') return knowledgeImport({ user3libHome, rest: args, jsonMode });
    process.stderr.write(`未知子命令: ${sub}\n`);
    printKnowledgeHelp();
    return 1;
}
