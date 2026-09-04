/**
 * knowledge.js —— 3rdloop knowledge：本地知识打包回收（export）与合入（import）
 *
 * 背景：知识沉淀产物散落在用户数据目录（npm 安装态各机器独立），需要一条
 * 人工中转通道实现"用户 → 维护者 → 仓库/其他用户"的知识回流：
 *
 *   用户侧（export，零依赖、离线可用）：
 *     3rdloop knowledge export [--output <file>] [--since <date>] [--note <text>]
 *       打包 ~/.3lib/3rdloop/kb-data/docs 新增文档 + BadCase 新规则/案例 +
 *       db/Knowledge 索引清单 → zip（含 manifest.json：来源/时间/清单/统计）
 *       默认输出 ./3rdloop-knowledge-<日期>-<主机名>.zip
 *
 *   维护者侧（import，收到 zip 后一键预检 + 合入）：
 *     3rdloop knowledge import <zip> [--dry-run] [--allow-overwrite]
 *       解包校验 manifest → 逐文件落位（docs → kb-data/docs、BadCase → BadCase、
 *       索引清单仅汇总展示不入库）→ 重建由 kb 引擎首次检索时自动完成
 *       --dry-run 只预览将发生的变更，不写任何文件
 *
 * 设计约束：
 *   - export 零网络：纯本地打包，绝不静默上传（隐私合规）
 *   - 不打 .index/（kb 检索引擎的派生产物，import 后自动重建）
 *   - BadCase 冲突默认跳过（--allow-overwrite 覆盖）；docs 同名默认跳过
 *   - 索引（db/Knowledge/index.json）只作为"待人工评估清单"随包携带，
 *     不自动导入（指针含本机绝对路径，对他机无意义）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import process from 'node:process';

// ─── 用户路径 ─────────────────────────────────────────────────────────

/**
 * 知识相关用户目录。
 * @param {string} user3libHome - ~/.3lib
 * @param {string} [dataDir] - CLI 解析的数据目录（kb-data/BadCase 固定在 loopHome，
 *   仅 Knowledge 索引跟随 dataDir——npm 安装态两者相同，仓库开发态 dataDir 可能被覆盖）
 */
export function knowledgePaths(user3libHome, dataDir = '') {
    const loopHome = path.join(user3libHome, '3rdloop');
    return {
        loopHome,
        kbDocsDir: path.join(loopHome, 'kb-data', 'docs'),
        badcaseDir: path.join(loopHome, 'BadCase'),
        knowledgeIndex: dataDir
            ? path.join(dataDir, 'Knowledge', 'index.json')
            : path.join(loopHome, 'db', 'Knowledge', 'index.json'),
    };
}

// ─── zip 读写（STORE 打包，纯 Node 无第三方依赖）──────────────────────
// zip 结构说明：为避免实现 zip 目录遍历/central directory 全套规范，
// 本实现采用"单成员 zip"约定：一个 zip 只含一个被 deflate 压缩的
// JSON 载荷文件 payload.json（STORE/DEFLATE 单文件 zip 是稳定子集）。
// payload 内部再携带多文件内容（Base64），兼顾格式标准与实现简洁。

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
 * 递归收集目录下文件相对路径（排除 .index/.DS_Store/node_modules）。
 */
function walkFiles(root, rel = '', out = []) {
    if (!fs.existsSync(root)) return out;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name === '.index' || entry.name === '.DS_Store' || entry.name === 'node_modules') continue;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walkFiles(path.join(root, entry.name), relPath, out);
        else out.push(relPath);
    }
    return out;
}

/**
 * 3rdloop knowledge export 实现。
 * @param {object} opts
 * @param {string} opts.user3libHome
 * @param {string[]} opts.rest - 命令参数（--output/--since/--note）
 * @param {boolean} opts.jsonMode
 * @returns {Promise<number>} 退出码
 */
export async function knowledgeExport({ user3libHome, dataDir = '', rest = [], jsonMode = false }) {
    const out = (data) => { if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n'); };
    const log = (msg) => process.stderr.write(`${msg}\n`);

    const output = _flagValue(rest, '--output');
    const since = _flagValue(rest, '--since'); // ISO 日期：仅收该日期后新增的文件（按 mtime）
    const note = _flagValue(rest, '--note') || '';
    const sinceMs = since ? Date.parse(since) : null;
    if (since && Number.isNaN(sinceMs)) {
        log(`错误: 非法 --since 日期: ${since}（示例: 2026-09-01）`);
        return 1;
    }

    const up = knowledgePaths(user3libHome, dataDir);

    // ── 收集三类知识 ──
    const docsFiles = walkFiles(up.kbDocsDir);
    const badcaseFiles = walkFiles(up.badcaseDir);
    const knowledgeIndex = fs.existsSync(up.knowledgeIndex)
        ? JSON.parse(fs.readFileSync(up.knowledgeIndex, 'utf8'))
        : [];

    const sinceFilter = (absPath) => sinceMs == null || fs.statSync(absPath).mtimeMs >= sinceMs;

    // docs：结构化知识文档（export 全量，包小；--since 可裁剪）
    const docs = {};
    let docsSkipped = 0;
    for (const rel of docsFiles) {
        const abs = path.join(up.kbDocsDir, rel);
        if (!sinceFilter(abs)) { docsSkipped++; continue; }
        docs[rel] = fs.readFileSync(abs, 'utf8');
    }

    // BadCase：规则/案例/日志（排除种子自带内容：仅收 INDEX 之外的新增 + 用户改动，
    // 简化策略 = 全量携带，import 端与种子比对去重）
    const badcase = {};
    let badcaseSkipped = 0;
    for (const rel of badcaseFiles) {
        const abs = path.join(up.badcaseDir, rel);
        if (!sinceFilter(abs)) { badcaseSkipped++; continue; }
        badcase[rel] = fs.readFileSync(abs, 'utf8');
    }

    if (Object.keys(docs).length === 0 && Object.keys(badcase).length === 0 && knowledgeIndex.length === 0) {
        log('未发现可导出的知识（kb-data/docs、BadCase 均为空）。');
        log('提示: 知识在任务执行后由 knowledge-import SKILL 沉淀，先跑几个任务再看。');
        return 0;
    }

    // ── 载荷与 manifest ──
    const manifest = {
        format: '3rdloop-knowledge/1',
        exportedAt: new Date().toISOString(),
        host: os.hostname(),
        platform: process.platform,
        note,
        since: since || null,
        stats: {
            docs: Object.keys(docs).length,
            badcase: Object.keys(badcase).length,
            knowledgeIndexEntries: knowledgeIndex.length,
        },
    };
    const payload = JSON.stringify({ manifest, docs, badcase, knowledgeIndex }, null, 2);

    // 默认文件名：./3rdloop-knowledge-<YYYYMMDD>-<hostname>.zip
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const defaultName = `3rdloop-knowledge-${date}-${os.hostname().split('.')[0]}.zip`;
    const target = output
        ? path.resolve(output)
        : path.join(process.cwd(), defaultName);

    writeSingleFileZip(target, payload);

    if (jsonMode) {
        out({ ok: true, file: target, ...manifest.stats, docsSkippedBySince: docsSkipped });
    } else {
        log(`[3rdloop knowledge] 知识包已生成: ${target}`);
        log(`  结构化知识文档: ${manifest.stats.docs} 篇${docsSkipped ? `（--since 裁剪 ${docsSkipped} 篇）` : ''}`);
        log(`  BadCase 规则/案例: ${manifest.stats.badcase} 个文件`);
        log(`  知识索引条目: ${manifest.stats.knowledgeIndexEntries} 条（仅作人工评估清单）`);
        if (note) log(`  备注: ${note}`);
        log(`  大小: ${(fs.statSync(target).size / 1024).toFixed(1)} KB`);
        log(`请将 zip 发送给维护者（微信/邮件均可）；内容由你本机知识文件打包而成，可先解压自查。`);
    }
    return 0;
}

// ─── import ───────────────────────────────────────────────────────────

/**
 * 3rdloop knowledge import 实现（维护者侧：收 zip → 校验 → 落位）。
 * @param {object} opts
 * @param {string} opts.user3libHome
 * @param {string[]} opts.rest - <zip> --dry-run --allow-overwrite
 * @param {boolean} opts.jsonMode
 */
export async function knowledgeImport({ user3libHome, dataDir = '', rest = [], jsonMode = false }) {
    const out = (data) => { if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n'); };
    const log = (msg) => process.stderr.write(`${msg}\n`);

    const dryRun = rest.includes('--dry-run');
    const allowOverwrite = rest.includes('--allow-overwrite');
    const zipPath = rest.find(a => !a.startsWith('--'));
    if (!zipPath) {
        log('缺少 zip 路径。用法: 3rdloop knowledge import <zip> [--dry-run] [--allow-overwrite]');
        return 1;
    }
    const absZip = path.resolve(zipPath);
    if (!fs.existsSync(absZip)) {
        log(`错误: 文件不存在: ${absZip}`);
        return 1;
    }

    // ── 解包 ──
    let payload;
    try {
        payload = JSON.parse(readSingleFileZip(absZip));
    } catch (err) {
        log(`错误: 解析知识包失败: ${err.message}`);
        return 1;
    }
    const { manifest, docs, badcase, knowledgeIndex } = payload;
    if (!manifest || manifest.format !== '3rdloop-knowledge/1') {
        log(`错误: 未知知识包格式: ${manifest?.format || '(缺失 manifest)'}`);
        return 1;
    }

    const up = knowledgePaths(user3libHome, dataDir);

    // ── 预演：统计冲突 ──
    const plan = { docsAdd: [], docsSkip: [], badcaseAdd: [], badcaseSkip: [] };
    for (const rel of Object.keys(docs || {})) {
        (fs.existsSync(path.join(up.kbDocsDir, rel)) ? plan.docsSkip : plan.docsAdd).push(rel);
    }
    for (const rel of Object.keys(badcase || {})) {
        (fs.existsSync(path.join(up.badcaseDir, rel)) ? plan.badcaseSkip : plan.badcaseAdd).push(rel);
    }

    if (dryRun) {
        if (jsonMode) out({ ok: true, dryRun: true, manifest, plan });
        else {
            log(`[3rdloop knowledge] 预演（不写入任何文件）`);
            log(`  知识包: ${absZip}`);
            log(`  导出时间: ${manifest.exportedAt}  来源: ${manifest.host}（${manifest.platform}）`);
            if (manifest.note) log(`  备注: ${manifest.note}`);
            log(`  将新增 docs: ${plan.docsAdd.length} 篇${plan.docsAdd.length ? `（如 ${plan.docsAdd.slice(0, 3).join(', ')}${plan.docsAdd.length > 3 ? ' ...' : ''}）` : ''}`);
            log(`  将新增 BadCase: ${plan.badcaseAdd.length} 个${plan.badcaseAdd.length ? `（如 ${plan.badcaseAdd.slice(0, 3).join(', ')}${plan.badcaseAdd.length > 3 ? ' ...' : ''}）` : ''}`);
            log(`  跳过同名冲突: docs ${plan.docsSkip.length} / BadCase ${plan.badcaseSkip.length}（--allow-overwrite 可覆盖）`);
            log(`  知识索引条目: ${(knowledgeIndex || []).length} 条（仅展示，不入库）`);
        }
        return 0;
    }

    // ── 落位 ──
    let added = 0, skipped = 0;
    for (const rel of Object.keys(docs || {})) {
        const target = path.join(up.kbDocsDir, rel);
        if (fs.existsSync(target) && !allowOverwrite) { skipped++; continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, docs[rel]);
        added++;
    }
    for (const rel of Object.keys(badcase || {})) {
        const target = path.join(up.badcaseDir, rel);
        if (fs.existsSync(target) && !allowOverwrite) { skipped++; continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, badcase[rel]);
        added++;
    }

    // 知识索引：打印摘要供人工评估（不入库：含他机绝对路径指针）
    if (knowledgeIndex && knowledgeIndex.length > 0 && !jsonMode) {
        log(`[3rdloop knowledge] 携带知识索引 ${knowledgeIndex.length} 条（未入库；含导出者机器的本地路径，仅供参考）`);
    }

    if (jsonMode) {
        out({ ok: true, added, skipped, plan });
    } else {
        log(`[3rdloop knowledge] 导入完成: 新增 ${added} 个文件${skipped ? `，跳过同名冲突 ${skipped} 个` : ''}`);
        log(`  docs → ${up.kbDocsDir}`);
        log(`  BadCase → ${up.badcaseDir}`);
        log(`  检索索引将在下次 kb_search 时自动重建（.index/ 为派生产物）`);
    }
    return 0;
}

// ─── 帮助 / 入口 ──────────────────────────────────────────────────────

function _flagValue(rest, name) {
    const idx = rest.indexOf(name);
    return idx !== -1 ? rest[idx + 1] : undefined;
}

export function printKnowledgeHelp() {
    process.stdout.write(`3rdloop knowledge —— 本地知识打包回收 / 合入（人工中转通道）

用法（用户侧：打包发给维护者）:
  3rdloop knowledge export [选项]
      打包 ~/.3lib/3rdloop/ 下的知识产物为 zip：
        - kb-data/docs/    结构化知识文档（knowledge-import SKILL 的沉淀）
        - BadCase/         已知问题规则/案例（泛化 SKILL 的沉淀）
        - db/Knowledge/    索引清单（仅作人工评估参考，不入库）
  选项:
    --output <file>   输出路径（默认 ./3rdloop-knowledge-<日期>-<主机名>.zip）
    --since <date>    仅打包该日期后新增的文件（示例: 2026-09-01）
    --note <text>     备注（写入 manifest，如 "mp3agic 检视批次"）
    --json            结构化输出

用法（维护者侧：收到 zip 后合入）:
  3rdloop knowledge import <zip> [--dry-run] [--allow-overwrite]
      --dry-run           仅预览将发生的变更，不写入
      --allow-overwrite   覆盖同名文件（默认跳过）
      解包后 docs → ~/.3lib/3rdloop/kb-data/docs、BadCase → ~/.3lib/3rdloop/BadCase

说明:
  - export 纯本地打包，不上传任何数据；可先解压自查内容再发送
  - 不含检索索引（.index/），导入后首次检索自动重建
  - 维护者审核后可把精选内容合入仓库 Archive/data 与 BadCase/，随版本分发
`);
}

/**
 * 3rdloop knowledge 命令入口。
 * @param {object} opts
 * @param {string[]} opts.rest
 * @param {string} opts.user3libHome
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
            // flag 值（如 --note 后面的文本）不是子命令，跳过
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
    if (sub === 'export') return knowledgeExport({ user3libHome, dataDir, rest: args, jsonMode });
    if (sub === 'import') return knowledgeImport({ user3libHome, dataDir, rest: args, jsonMode });
    process.stderr.write(`未知子命令: ${sub}\n`);
    printKnowledgeHelp();
    return 1;
}

/** 该 flag 是否携带值（--output/--since/--note）。 */
function _hasValue(flag) {
    return flag === '--output' || flag === '--since' || flag === '--note';
}
