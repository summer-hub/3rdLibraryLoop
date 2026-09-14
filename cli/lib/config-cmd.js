/**
 * config-cmd.js —— 3rdloop config 命令（配置 .env 配置项）
 *
 * 职责：
 *   - 维护白名单目录 ENV_KEYS（key/label/description/default/validate/secret/envOnly）
 *   - 读写用户级 ~/.3lib/.env（跨项目全局生效）
 *   - set/get/unset/list 子命令（密钥类 get/list 脱敏显示）
 *
 * 生效路径（无需改动核心）：
 *   loadEnvChain() 把 ~/.3lib/.env 加载进 process.env，
 *   resolveDataDir() / resolveSkillDir() 等消费对应环境变量。
 * 系统环境变量仍是最高优先级（与 dotenv 现状一致）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);

// ─── 白名单目录（与 Server/.env.example 对齐）────────────────────────────

/** 默认存储路径，集中定义便于文档/测试同步 */
export const DEFAULT_DATA_DIR = path.join('~', '.3lib', '3rdloop', 'db');

/**
 * 校验器：返回 true 合法 / false 非法。
 * 按 .env.example 中的类型约束实现。
 */
const validators = {
    /** 布尔类：true/false */
    bool: (v) => /^(true|false)$/i.test(String(v).trim()),
    /** 非负整数（top_k / max_tokens 等） */
    intPositive: (v) => /^\d+$/.test(String(v).trim()) && Number(v) > 0,
    /** 0-1 小数（采样/权重） */
    weight01: (v) => {
        const n = Number(String(v).trim());
        return Number.isFinite(n) && n >= 0 && n <= 1;
    },
    /** LLM 温度（0-1 或较大数） */
    temperature: (v) => {
        const n = Number(String(v).trim());
        return Number.isFinite(n) && n >= 0;
    },
    /** URL（http/https）或空 */
    urlOrEmpty: (v) => {
        const s = String(v).trim();
        return s === '' || /^https?:\/\//i.test(s);
    },
    /** 端口 1-65535 或空 */
    portOrEmpty: (v) => {
        const s = String(v).trim();
        if (s === '') return true;
        const n = Number(s);
        return Number.isInteger(n) && n >= 1 && n <= 65535;
    },
    /** 非空字符串 */
    nonEmpty: (v) => String(v).trim().length > 0,
    /** opencode | deveco-code */
    cliType: (v) => ['opencode', 'deveco-code'].includes(String(v).trim()),
    /** 任意（不校验） */
    any: () => true,
};

/**
 * 白名单配置项。
 * - source：配置来源说明（用于 list 展示）
 * - envOnly：仅在系统环境变量中生效，禁止 set/unset（避免 .env 失效误导）
 */
export const ENV_KEYS = [
    // ── LLM（百炼 / DashScope）───────────────────────────────────────
    { key: 'DASHSCOPE_API_KEY', label: '百炼 API Key', description: '从 https://bailian.console.aliyun.com/ 获取', default: '', validate: validators.nonEmpty, secret: true },
    { key: 'LLM_BASE_URL', label: 'LLM 端点', description: '百炼 OpenAI 兼容端点（不要随意修改）', default: 'https://dashscope.aliyuncs.com/compatible-mode/v1', validate: validators.urlOrEmpty },
    { key: 'LLM_MODEL', label: '模型名', description: '经百炼调用的模型名（如 glm-5.2）', default: 'glm-5.2', validate: validators.nonEmpty },
    { key: 'LLM_TEMPERATURE', label: 'LLM 采样温度', description: '采样温度（可选）', default: '0.1', validate: validators.temperature },
    { key: 'LLM_MAX_TOKENS', label: 'LLM 最大输出 tokens', description: '单次生成上限（可选）', default: '2048', validate: validators.intPositive },
    { key: 'LLM_ENABLE_THINKING', label: 'GLM 思考模式', description: 'true=开启思考（慢，质量高）false=关闭（快，推荐）', default: 'false', validate: validators.bool },
    { key: 'FALLBACK_MODEL', label: '备用模型', description: '连续 3 次 529 过载时切换，留空则不切换', default: '', validate: validators.any },

    // ── SkillSelector 召回/命中 ──────────────────────────────────────
    { key: 'SELECTOR_TOP_K', label: '召回候选数', description: '模糊匹配召回的候选数量', default: '5', validate: validators.intPositive },
    { key: 'SELECTOR_HIT_THRESHOLD', label: '命中阈值', description: 'LLM 打分阈值 0-100（top1 >= 阈值即视为命中；分差仅作参考，不参与判定）', default: '60', validate: validators.intPositive },
    { key: 'SELECTOR_WEIGHT_ACTION', label: '动作通道权重', description: '多路召回动作通道权重（默认 0.4）', default: '0.4', validate: validators.weight01 },
    { key: 'SELECTOR_WEIGHT_DOMAIN', label: '领域通道权重', description: '多路召回领域通道权重（默认 0.4）', default: '0.4', validate: validators.weight01 },
    { key: 'SELECTOR_WEIGHT_RAW', label: '原文兜底权重', description: '多路召回原文兜底通道权重（默认 0.2）', default: '0.2', validate: validators.weight01 },

    // ── 编排并发 ─────────────────────────────────────────────────────
    { key: 'MAX_CONCURRENT_SESSIONS', label: 'AI Session 并发上限', description: '跨所有编排任务共享的全局并发信号量上限', default: '50', validate: validators.intPositive },

    // ── CLI / AI 助手后端 ────────────────────────────────────────────
    { key: 'CLI_TYPE', label: '默认 CLI 类型', description: 'opencode | deveco-code', default: 'deveco-code', validate: validators.cliType },
    { key: 'OPENCODE_HOST', label: 'opencode 主机', description: '连接配置（可选）', default: 'localhost', validate: validators.nonEmpty },
    { key: 'OPENCODE_PORT', label: 'opencode 端口', description: '连接配置（可选，默认 4096）', default: '4096', validate: validators.portOrEmpty },
    { key: 'DEVECO_HOST', label: 'deveco 主机', description: '连接配置（可选）', default: 'localhost', validate: validators.nonEmpty },
    { key: 'DEVECO_PORT', label: 'deveco 端口', description: '连接配置（可选，默认 4096）', default: '4096', validate: validators.portOrEmpty },
    { key: 'GIT_TOKEN', label: 'GitCode Token', description: '访问私有仓库用（可留空）', default: '', validate: validators.any, secret: true },

    // ── CLI 自身（3LIB_*）────────────────────────────────────────────
    { key: '3LIB_DATA_DIR', label: '默认数据目录', description: '任务中间产物根目录（默认 ~/.3lib/3rdloop/db，命令配置后可全局生效）', default: userDataDirDefault(), validate: validators.nonEmpty },
    { key: '3LIB_SKILL_DIR', label: 'SKILL 目录覆盖', description: '等效 --skill-dir', default: '', validate: validators.nonEmpty },
    { key: '3LIB_TASK_PREFIX', label: 'taskId 前缀', description: '审计用（可选）', default: '', validate: validators.any },
    { key: '3LIB_ROOT', label: '项目根覆盖', description: '仅系统环境变量生效（.env 不生效）', default: '', validate: validators.any, envOnly: true },
    { key: '3LIB_HOME', label: '用户 3lib 主目录', description: '仅系统环境变量生效（.env 不生效），含日志 logs/', default: '', validate: validators.any, envOnly: true },
];

/** 3LIB_DATA_DIR 的内置默认值（resolveDataDir 的默认），写入前展开 ~ */
function userDataDirDefault() {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || '';
    return path.join(home, '.3lib', '3rdloop', 'db');
}

/** 按 key 取白名单项 */
export function getKeyMeta(key) {
    return ENV_KEYS.find(k => k.key === key) || null;
}

/** 展开 ~ 前缀（Windows 下也兼容） */
export function expandHome(p) {
    if (typeof p !== 'string') return p;
    if (p === '~') return process.env.HOME || process.env.USERPROFILE || os.homedir() || '';
    if (p.startsWith('~/') || p.startsWith('~\\')) {
        const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || '';
        return path.join(home, p.slice(2).replace(/^[/\\]/, ''));
    }
    return p;
}

// ─── 读取用户级 .env ──────────────────────────────────────────────────

/** 用户级 .env 绝对路径 */
export function userEnvPath(user3libHome) {
    return path.join(user3libHome, '.env');
}

/** 用 dotenv.parse 解析；文件不存在返回 {}；失败返回 {} 并置 error */
export function readUserEnv(user3libHome) {
    const p = userEnvPath(user3libHome);
    if (!fs.existsSync(p)) return { values: {}, source: p, exists: false };
    try {
        const dotenv = _dotenv();
        const values = dotenv.parse(fs.readFileSync(p, 'utf8'));
        return { values, source: p, exists: true };
    } catch {
        return { values: {}, source: p, exists: true };
    }
}

/**
 * 读取项目级 .env（<projectRoot>/Server/.env 或 <projectRoot>/.env），
 * 合并为 values（前者优先，与 loadEnvChain 顺序一致）。
 */
export function readProjectEnv(projectRoot) {
    const dotenv = _dotenv();
    const values = {};
    const candidates = [
        projectRoot ? path.join(projectRoot, 'Server', '.env') : '',
        projectRoot ? path.join(projectRoot, '.env') : '',
    ];
    for (const p of candidates) {
        if (!p) continue;
        try {
            if (fs.existsSync(p)) {
                Object.assign(values, dotenv.parse(fs.readFileSync(p, 'utf8')));
            }
        } catch { /* 单个 .env 损坏不影响整体 */ }
    }
    return { values };
}

/** 同步加载 dotenv（避免 Promise 化），失败回退手写解析 */
function _dotenv() {
    try {
        const dotenv = _require('dotenv');
        if (dotenv && typeof dotenv.parse === 'function') return dotenv;
    } catch { /* 回退手写解析 */ }
    return {
        parse: (s) => {
            const r = {};
            for (const line of String(s).split('\n')) {
                const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
                if (m) r[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
            }
            return r;
        },
    };
}

/**
 * 行级写入：保留注释/其他键，目标键存在则覆写值、不存在则在末尾追加。
 * 返回 true 表示写入成功。
 */
export function applyEnvKey(user3libHome, key, value) {
    const p = userEnvPath(user3libHome);
    fs.mkdirSync(user3libHome, { recursive: true });
    const lines = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n') : [];
    const outLines = [];
    let found = false;
    for (const line of lines) {
        // 保留空白/纯注释/其他键；只对 "KEY=" 开头（允许行首空白）覆写
        const m = line.match(/^\s*([\w.]+)\s*=/);
        if (m && m[1] === key) {
            outLines.push(`${key}=${formatValue(value)}`);
            found = true;
        } else {
            outLines.push(line);
        }
    }
    if (!found) {
        // 末尾补空行再追加，保证与前面内容分隔
        if (outLines.length > 0 && outLines[outLines.length - 1].trim() !== '') outLines.push('');
        outLines.push(`${key}=${formatValue(value)}`);
    }
    fs.writeFileSync(p, outLines.join('\n').replace(/\n+$/, '\n'), { encoding: 'utf8' });
    return true;
}

/** 行级删除：只删目标键行（保留注释/其他键） */
export function removeEnvKey(user3libHome, key) {
    const p = userEnvPath(user3libHome);
    if (!fs.existsSync(p)) return false;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const outLines = lines.filter(line => {
        const m = line.match(/^\s*([\w.]+)\s*=/);
        return !(m && m[1] === key);
    });
    fs.writeFileSync(p, outLines.join('\n').replace(/\n+$/, '\n') + '\n', { encoding: 'utf8' });
    return true;
}

/** 值写入 .env 的引号策略：含特殊字符时加引号 */
function formatValue(v) {
    const s = String(v ?? '');
    if (/[\s#"'$`]/.test(s)) {
        return `"${s.replace(/"/g, '\\"')}"`;
    }
    return s;
}

/** 脱敏：AK/Token 类只显示部分 */
export function maskSecret(value) {
    const s = String(value ?? '');
    if (!s) return '';
    if (s.length <= 8) return '****';
    if (s.length <= 16) return `${s.slice(0, 4)}****${s.slice(-4)}`;
    return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

/**
 * 计算"当前生效值"及来源。
 *
 * 由于 loadEnvChain 会把 .env 链全部加载进 process.env，无法用 process.env 反推真实来源。
 * 改为读各层文件，依次判定：
 *   1. 系统环境变量（process.env 中存在，且不等同于用户/项目 .env 中的值）
 *   2. 用户级 ~/.3lib/.env
 *   3. 项目级 <projectRoot>/Server/.env（及 <projectRoot>/.env）
 *   4. 默认值
 *
 * @param {string} key
 * @param {object} userEnv - readUserEnv(user3libHome).values
 * @param {object} projectEnv - readProjectEnv(projectRoot).values
 */
export function effectiveValue(key, userEnv, projectEnv) {
    const envVal = process.env[key];
    const uVal = (userEnv && userEnv[key] !== undefined) ? String(userEnv[key]).trim() : '';
    const pVal = (projectEnv && projectEnv[key] !== undefined) ? String(projectEnv[key]).trim() : '';

    // 系统环境变量优先：只要它不是来自两个 .env 的值，就算系统级
    if (envVal !== undefined && envVal !== '' && envVal !== uVal && envVal !== pVal) {
        return { value: envVal, source: 'env' };
    }
    // 用户 .env
    if (uVal !== '') return { value: uVal, source: 'user-env' };
    // 项目 .env
    if (pVal !== '') return { value: pVal, source: 'project-env' };
    // 默认值（3LIB_DATA_DIR 为展开后的绝对路径）
    const meta = getKeyMeta(key);
    const def = meta && meta.default ? expandHome(meta.default) : '';
    return { value: def, source: 'default' };
}

// ─── 子命令实现（供 cli.js 调用）──────────────────────────────────

/**
 * 解析并执行 config 子命令。
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.user3libHome
 * @param {boolean} opts.jsonMode
 * @param {function} opts.out
 * @param {string[]} opts.rest - config 子命令剩余参数（[sub, key, ...value]）
 * @returns {Promise<number>} 退出码
 */
export async function cmdConfigImpl({ projectRoot, user3libHome, jsonMode, out, rest = [] }) {
    const [sub, key, ...valueParts] = rest;
    const value = valueParts.join(' ');

    switch (sub) {
        case undefined:
        case '--help':
        case '-h':
            return configHelp();
        case 'set':
            return configSet({ user3libHome, key, value, jsonMode, out });
        case 'get':
            return configGet({ projectRoot, user3libHome, key, jsonMode, out });
        case 'unset':
            return configUnset({ user3libHome, key, jsonMode, out });
        case 'list':
        case 'ls':
            return configList({ projectRoot, user3libHome, jsonMode, out });
        default:
            process.stderr.write(`未知 config 子命令: ${sub}\n`);
            configHelp();
            return 1;
    }
}

// ─── 子命令实现 ─────────────────────────────────────────────────

function configHelp() {
    process.stdout.write(`3rdloop config —— 配置 .env 配置项（默认读写 ~/.3lib/.env）

用法:
  3rdloop config list                列出全部配置项及当前生效值
  3rdloop config get <KEY>           查看某项当前生效值
  3rdloop config set <KEY> <VALUE>   设置某项（密钥不回显）
  3rdloop config unset <KEY>         删除用户级 .env 中的某项（恢复默认）

示例:
  3rdloop config set 3LIB_DATA_DIR D:\\code\\team\\db
  3rdloop config get LLM_MODEL
  3rdloop config list --json

优先级（从高到低）：系统环境变量 > ~/.3lib/.env > 默认值
`);
    return 0;
}

function fmtErr(key, meta) {
    return `未知配置项: ${key}
已知配置项见 "3rdloop config list"。`;
}

async function configSet({ user3libHome, key, value, jsonMode, out }) {
    const meta = getKeyMeta(key);
    if (!meta) {
        if (jsonMode) out({ ok: false, error: fmtErr(key) });
        else process.stderr.write(`${fmtErr(key)}\n`);
        return 1;
    }
    if (meta.envOnly) {
        const msg = `${key} 仅支持系统环境变量（3LIB_ROOT/3LIB_HOME），写入 ~/.3lib/.env 不生效。请用 setx / export 设置。`;
        if (jsonMode) out({ ok: false, error: msg });
        else process.stderr.write(`${msg}\n`);
        return 1;
    }
    if (!value) {
        const msg = `缺少值: 3rdloop config set ${key} <VALUE>`;
        if (jsonMode) out({ ok: false, error: msg });
        else process.stderr.write(`${msg}\n`);
        return 1;
    }
    if (!meta.validate(value)) {
        const msg = `配置项 ${key} 的值不合法: "${value}"（${meta.description}）`;
        if (jsonMode) out({ ok: false, error: msg });
        else process.stderr.write(`${msg}\n`);
        return 1;
    }
    applyEnvKey(user3libHome, key, value);
    if (jsonMode) {
        out({ ok: true, key, value: meta.secret ? maskSecret(value) : value });
    } else {
        const shown = meta.secret ? '<已设置（密钥不回显）>' : value;
        process.stdout.write(`已设置 ${key} = ${shown}\n`);
    }
    return 0;
}

async function configGet({ projectRoot, user3libHome, key, jsonMode, out }) {
    const meta = getKeyMeta(key);
    if (!meta) {
        if (jsonMode) out({ ok: false, error: fmtErr(key) });
        else process.stderr.write(`${fmtErr(key)}\n`);
        return 1;
    }
    const { value, source } = effectiveValue(key, readUserEnv(user3libHome).values, readProjectEnv(projectRoot).values);
    if (meta.envOnly && source === 'default') {
        const msg = `${key} 为系统环境变量专用，未检测到已设置`;
        if (jsonMode) out({ ok: true, key, value: '', source, envOnly: true });
        else process.stderr.write(`${msg}\n`);
        return 0;
    }
    const shown = meta.secret ? maskSecret(value) : value;
    if (jsonMode) out({ ok: true, key, value: shown, source, secret: !!meta.secret });
    else process.stdout.write(`${shown}\n`);
    return 0;
}

async function configUnset({ user3libHome, key, jsonMode, out }) {
    const meta = getKeyMeta(key);
    if (!meta) {
        if (jsonMode) out({ ok: false, error: fmtErr(key) });
        else process.stderr.write(`${fmtErr(key)}\n`);
        return 1;
    }
    if (meta.envOnly) {
        const msg = `${key} 仅支持系统环境变量，无法从 ~/.3lib/.env 删除。请直接移除系统环境变量。`;
        if (jsonMode) out({ ok: false, error: msg });
        else process.stderr.write(`${msg}\n`);
        return 1;
    }
    const removed = removeEnvKey(user3libHome, key);
    if (jsonMode) out({ ok: true, key, removed });
    else process.stdout.write(removed ? `已删除 ${key}（恢复默认）\n` : `${key} 未在 ~/.3lib/.env 中，无需删除\n`);
    return 0;
}

async function configList({ projectRoot, user3libHome, jsonMode, out }) {
    const userEnv = readUserEnv(user3libHome).values;
    const projectEnv = readProjectEnv(projectRoot).values;
    const rows = ENV_KEYS.map(meta => {
        const { value, source } = effectiveValue(meta.key, userEnv, projectEnv);
        const shown = meta.secret ? maskSecret(value) : (meta.envOnly ? (source === 'default' ? '' : value) : value);
        return {
            key: meta.key,
            value: shown,
            source,
            secret: !!meta.secret,
            envOnly: !!meta.envOnly,
            default: meta.default ? expandHome(meta.default) : '',
            description: meta.description,
        };
    });
    if (jsonMode) {
        out({ ok: true, total: rows.length, items: rows });
        return 0;
    }
    process.stdout.write(`配置项（优先级：系统环境变量 > ~/.3lib/.env > 默认值）\n`);
    for (const r of rows) {
        const v = r.secret && r.value ? `${maskSecret(r.value)}` : (r.value || (r.source === 'default' ? `默认: ${r.default || '(空)'}` : '(未设置)'));
        const tag = r.envOnly ? ' [envOnly]' : '';
        process.stdout.write(`  ${r.key}${tag.padEnd(4)} = ${v}\n`);
        if (r.description) process.stdout.write(`      ${r.description}（${sourceLabel(r.source)}）\n`);
    }
    return 0;
}

function sourceLabel(s) {
    return { env: '系统环境变量', 'user-env': '~/.3lib/.env', 'project-env': '项目 Server/.env', default: '默认值' }[s] || s;
}