/**
 * plugin-cmd.js —— 3rdloop plugin 插件管理命令
 *
 * 边界：本模块只做「命令层」——参数解析、人读输出、退出码。
 * 状态的**唯一读写入口**是 `plugin-store.js`（与 Web「插件」页共用同一份判定）。
 * 这里不允许另写一套 overlay 合并 / 允许性校验逻辑：两边各写一套，判定迟早漂移
 * （一边允许禁用 required、一边拒绝），那正是插件管理最难排查的一类故障。
 *
 * 生效语义：overlay 由 `PluginHost.load()` 在**进程启动**时读取，所以 enable/disable
 * 之后必须重启 `3rdloop serve` 才生效——命令只如实回传 requiresRestart，不假装已生效。
 *
 * 「绝不写包内 profile」：包内 `profiles/*.json` 随核心包发布，改它既越权又会在下次
 * `3rdloop update` 时丢掉。所有写盘都经 `setEnabled()` 落到用户级 overlay。
 *
 * 插件安装根用 `core/PluginHost.js` 导出的 `USER_PLUGINS_DIR`（= `~/.3lib/plugins`），
 * 与宿主启动时扫描的用户根是**同一个常量**，不在这里另拼一份路径——否则改一处忘一处，
 * `plugin add` 装进去的目录宿主根本看不见。
 */

import fs from 'node:fs';
import path from 'node:path';
import { USER_PLUGINS_DIR, validateManifest } from '../../core/index.js';
import { EXIT } from './exit-codes.js';
import { check, readState, setEnabled } from './plugin-store.js';

/** 完整用法（`--help` 走 stdout 退出 0；参数错误走 stderr 退出 1） */
const USAGE = `3rdloop plugin —— 插件管理（读写用户级 overlay，不改包内 profile）

用法:
  3rdloop plugin list [--json]               列出全部条目（含 profile 提到但未安装的）
  3rdloop plugin info <name> [--json]        单个插件全字段 + 禁用后果
  3rdloop plugin enable <name>               启用插件（写用户级 overlay）
  3rdloop plugin disable <name> [--force]    禁用插件（被启用中的插件依赖时默认拒绝）
  3rdloop plugin check [--json]              静态一致性检查（有 error 时退出码 1）
  3rdloop plugin path                         打印 overlay 路径与当前 profile 名
  3rdloop plugin add <dir>                   安装插件目录到 ~/.3lib/plugins/<name>/
  3rdloop plugin remove <name>               卸载用户级插件（内置插件拒绝）

示例:
  3rdloop plugin list
  3rdloop plugin info engines/brain
  3rdloop plugin disable engines/brain
  3rdloop plugin add ./my-plugin

说明:
  - 开关写入 ~/.3lib/3rdloop/profiles/<profile>.json，重启 3rdloop serve 后生效
  - 包内 profiles/*.json 是随包发布的只读配置，任何子命令都不会写它
  - profile 名由 3LIB_PLUGIN_PROFILE 决定，缺省 default

全局选项: --json 结构化输出到 stdout（表格/日志改走 stderr 或省略）
`;

/** 状态机值 → 人读标签 */
const STATUS_LABEL = { enabled: '启用', disabled: '禁用', missing: '未安装' };
const SOURCE_LABEL = { builtin: '内置', user: '用户', missing: '—' };

/** 已知子命令（用于未知子命令的报错提示） */
const SUBCOMMANDS = ['list', 'info', 'enable', 'disable', 'check', 'path', 'add', 'remove'];

/** 本命令认识的开关（其余开关报错；全局 flag 已被 parseGlobalFlags 消费，不会到这里） */
const KNOWN_FLAGS = ['--force', '--help', '-h'];

/**
 * 解析并执行 plugin 子命令。
 *
 * @param {object} opts
 * @param {string[]} [opts.rest] - 子命令剩余参数（**必须是 `flags.rest`**：全局 flag 已被
 *        parseGlobalFlags 认领，拿原始 argv 会把 `--json` 误判成未知开关）
 * @param {boolean} [opts.jsonMode]
 * @param {(data: object) => void} [opts.out] - JSON 输出器（cli.js 传入；缺省直接写 stdout）
 * @returns {Promise<number>} 退出码
 */
export async function cmdPluginImpl({ rest = [], jsonMode = false, out } = {}) {
    const emitJson = (data) => {
        if (!jsonMode) return;
        if (typeof out === 'function') out(data);
        else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    };

    const args = (Array.isArray(rest) ? rest : []).filter((a) => typeof a === 'string');
    const positional = args.filter((a) => !a.startsWith('-'));
    const flags = args.filter((a) => a.startsWith('-'));
    const [sub, ...tail] = positional;

    // --help / -h：打印完整用法到 stdout 退出 0，**不联网、不写盘**（先于任何状态读取）
    if (flags.includes('--help') || flags.includes('-h')) {
        process.stdout.write(USAGE);
        return EXIT.OK;
    }

    // 参数类错误（缺子命令/未知子命令/未知开关/缺参数）打用法；运行期失败只报原因，
    // 把整篇用法糊在"插件目录不存在"后面只会淹掉真正的错误行
    const usageError = (message) => {
        if (message) process.stderr.write(`${message}\n`);
        process.stderr.write(USAGE);
        emitJson({ ok: false, error: message || '参数错误' });
        return EXIT.ERROR;
    };
    const fail = (message) => {
        if (!jsonMode) process.stderr.write(`${message}\n`);
        emitJson({ ok: false, error: message });
        return EXIT.ERROR;
    };

    if (sub === undefined) return usageError('缺少子命令');

    const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.includes(f));
    if (unknownFlags.length > 0) return usageError(`未知开关: ${unknownFlags.join(', ')}`);

    const ctx = {
        jsonMode,
        emitJson,
        usageError,
        fail,
        force: flags.includes('--force'),
    };

    try {
        switch (sub) {
            case 'list':
                return pluginList(ctx);
            case 'info':
                return pluginInfo(ctx, tail[0]);
            case 'enable':
                return pluginToggle(ctx, true, tail[0]);
            case 'disable':
                return pluginToggle(ctx, false, tail[0]);
            case 'check':
                return pluginCheck(ctx);
            case 'path':
                return pluginPath(ctx);
            case 'add':
                return pluginAdd(ctx, tail[0]);
            case 'remove':
                return pluginRemove(ctx, tail[0]);
            default:
                return usageError(`未知 plugin 子命令: ${sub}（可用: ${SUBCOMMANDS.join(' | ')}）`);
        }
    } catch (err) {
        // 读盘/解析失败（overlay JSON 损坏、profile 不存在等）：消息可直接展示
        const message = err?.message ?? String(err);
        if (jsonMode) emitJson({ ok: false, error: message });
        else process.stderr.write(`插件命令失败: ${message}\n`);
        return EXIT.ERROR;
    }
}

// ─── 子命令实现 ────────────────────────────────────────────────────

/** list：表格（人读）或结构化条目（--json） */
function pluginList({ jsonMode, emitJson }) {
    const state = readState();
    const items = state.plugins.map(toItem);

    if (jsonMode) {
        emitJson({
            ok: true,
            profile: state.profileName,
            overlay: state.overlay,
            roots: state.roots,
            total: items.length,
            installed: items.filter((i) => i.installed).length,
            enabled: items.filter((i) => i.status === 'enabled').length,
            disabled: items.filter((i) => i.status === 'disabled').length,
            missing: items.filter((i) => i.status === 'missing').length,
            items,
            seams: state.seams,
            conflicts: state.conflicts,
        });
        return EXIT.OK;
    }

    const header = ['插件名', '接缝', '状态', '来源', '被依赖'];
    const rows = items.map((it) => [
        it.name,
        it.seam ?? '—',
        STATUS_LABEL[it.status],
        SOURCE_LABEL[it.source],
        it.dependents.join(', ') || '—',
    ]);
    const widths = header.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i]))));

    process.stdout.write(`插件条目（profile: ${state.profileName}，共 ${items.length} 个）\n`);
    process.stdout.write(`${header.map((h, i) => pad(h, widths[i])).join('  ').trimEnd()}\n`);
    for (const row of rows) {
        process.stdout.write(`${row.map((c, i) => pad(c, widths[i])).join('  ').trimEnd()}\n`);
    }

    const count = (s) => items.filter((i) => i.status === s).length;
    process.stdout.write(
        `\n已安装 ${items.filter((i) => i.installed).length}` +
            `（启用 ${count('enabled')} / 禁用 ${count('disabled')}），未安装 ${count('missing')}\n`
    );
    process.stdout.write(`overlay: ${state.overlay.path}${state.overlay.exists ? '' : '（尚未创建，执行 enable/disable 时写入）'}\n`);
    process.stdout.write(`插件根: ${state.roots.join('、')}\n`);
    return EXIT.OK;
}

/** info：单插件全字段 + 禁用后果 */
function pluginInfo({ jsonMode, emitJson, usageError, fail }, name) {
    if (!name) return usageError('缺少插件名: 3rdloop plugin info <name>');

    const state = readState();
    const target = state.plugins.find((p) => p.name === name);
    if (!target) {
        const known = state.plugins.map((p) => p.name).join(', ');
        return fail(`未知插件: ${name}（已发现: ${known || '无'}）`);
    }

    const item = toItem(target);
    const impact = disableImpact(target, state);

    if (jsonMode) {
        emitJson({ ok: true, profile: state.profileName, overlay: state.overlay, plugin: item, disableImpact: impact });
        return EXIT.OK;
    }

    process.stdout.write(`插件 ${item.name}\n`);
    process.stdout.write(`  状态: ${STATUS_LABEL[item.status]}${item.reason ? `（${item.reason}）` : ''}\n`);
    process.stdout.write(`  版本: ${item.version ?? '未知'}\n`);
    process.stdout.write(`  接缝: ${item.seam ?? '—（不提供能力接缝）'}\n`);
    process.stdout.write(`  入口: ${item.entry ?? '—'}\n`);
    process.stdout.write(`  来源: ${SOURCE_LABEL[item.source]}\n`);
    process.stdout.write(`  目录: ${item.dir ?? '—（未安装）'}\n`);
    process.stdout.write(`  required: ${item.required ? '是' : '否'}\n`);
    process.stdout.write(`  依赖: ${item.dependencies.join(', ') || '—'}\n`);
    process.stdout.write(`  被依赖: ${item.dependents.join(', ') || '—'}\n`);
    process.stdout.write(`  选项: ${JSON.stringify(item.options)}\n`);
    process.stdout.write(`  已装载（本进程）: ${item.loaded ? '是' : '否'}\n`);
    process.stdout.write('  禁用后果:\n');
    for (const line of impact) process.stdout.write(`    · ${line}\n`);
    return EXIT.OK;
}

/** enable / disable：写用户级 overlay（校验与原子写都在 plugin-store） */
function pluginToggle({ jsonMode, emitJson, usageError, force }, enabled, name) {
    const verb = enabled ? 'enable' : 'disable';
    if (!name) return usageError(`缺少插件名: 3rdloop plugin ${verb} <name>`);

    let result;
    try {
        result = setEnabled({ name, enabled, force });
    } catch (err) {
        // 校验拒绝（未知插件 / 未安装 / required / 被依赖且未 --force）：消息可直接展示
        const message = err?.message ?? String(err);
        if (jsonMode) emitJson({ ok: false, error: message, name, enabled });
        else process.stderr.write(`${message}\n`);
        return EXIT.ERROR;
    }

    for (const warning of result.warnings ?? []) process.stderr.write(`警告: ${warning}\n`);

    if (jsonMode) {
        emitJson({ ok: true, ...result });
    } else {
        process.stdout.write(
            `已${result.enabled ? '启用' : '禁用'} ${result.name}。已写入 ${result.file}，重启 3rdloop serve 后生效\n`
        );
    }
    return EXIT.OK;
}

/** check：静态一致性检查（有 error 就退出码 1） */
function pluginCheck({ jsonMode, emitJson }) {
    const result = check({});
    const state = result.state;

    if (jsonMode) {
        emitJson({
            ok: result.ok,
            profile: state.profileName,
            overlay: state.overlay,
            errors: result.errors,
            warnings: result.warnings,
        });
    } else {
        process.stdout.write(`插件静态检查（profile: ${state.profileName}）\n`);
        for (const error of result.errors) process.stdout.write(`  [error] ${error}\n`);
        for (const warning of result.warnings) process.stdout.write(`  [warn]  ${warning}\n`);
        process.stdout.write(
            result.ok ? '结论: OK（overlay 与内置 profile 合并后静态自洽）\n' : `结论: 发现 ${result.errors.length} 个错误（启动会失败）\n`
        );
    }
    return result.ok ? EXIT.OK : EXIT.ERROR;
}

/** path：overlay 路径 + 当前 profile 名 */
function pluginPath({ jsonMode, emitJson }) {
    const state = readState();

    if (jsonMode) {
        emitJson({
            ok: true,
            profile: state.profileName,
            overlay: state.overlay,
            profileDirs: state.profileDirs,
            roots: state.roots,
        });
        return EXIT.OK;
    }

    process.stdout.write(`profile: ${state.profileName}\n`);
    process.stdout.write(`overlay: ${state.overlay.path}${state.overlay.exists ? '' : '（尚未创建）'}\n`);
    process.stdout.write(`profile 目录（低 → 高优先级）: ${state.profileDirs.join(' → ')}\n`);
    process.stdout.write(`插件根: ${state.roots.join('、')}\n`);
    return EXIT.OK;
}

/**
 * add：把插件目录复制到 `~/.3lib/plugins/<name>/`。
 *
 * 复制前先校验清单（复用内核 `validateManifest`，与宿主扫描同一套判定），复制后再用
 * `readState()` 复查——「命令说装好了」不算数，「宿主能看见且来源是 user」才算。
 * 复查失败即回滚（删掉刚复制的目录），不留一个装了个寂寞的幽灵目录。
 */
function pluginAdd({ jsonMode, emitJson, usageError, fail }, dir) {
    if (!dir) return usageError('缺少插件目录: 3rdloop plugin add <dir>');

    const source = path.resolve(dir);
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
        return fail(`插件目录不存在或不是目录: ${source}`);
    }

    const manifestFile = path.join(source, 'plugin.json');
    if (!fs.existsSync(manifestFile)) return fail(`目录里没有 plugin.json: ${manifestFile}`);

    let manifest;
    try {
        manifest = JSON.parse(stripBom(fs.readFileSync(manifestFile, 'utf8')));
    } catch (err) {
        return fail(`plugin.json 解析失败 ${manifestFile}: ${err.message}`);
    }
    try {
        validateManifest(manifest, { source: manifestFile });
    } catch (err) {
        return fail(err.message);
    }
    // 安装要求四项齐全：内置插件的清单都带齐，缺字段的清单装了也无法被发现/装载
    for (const key of ['name', 'version', 'seam', 'entry']) {
        if (typeof manifest[key] !== 'string' || manifest[key] === '') {
            return fail(`${manifestFile} 缺少 ${key}（安装要求 name/version/seam/entry 齐全）`);
        }
    }

    const name = manifest.name;
    const target = path.join(USER_PLUGINS_DIR, ...name.split('/'));
    if (!isUnder(target, USER_PLUGINS_DIR)) return fail(`插件名非法（越出用户插件根）: ${name}`);
    if (fs.existsSync(target)) {
        return fail(`目标目录已存在: ${target}\n        先卸载旧版：3rdloop plugin remove ${name}`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });

    const state = readState();
    const entry = state.plugins.find((p) => p.name === name);
    if (!entry || !entry.installed || entry.source !== 'user') {
        fs.rmSync(target, { recursive: true, force: true });
        const why = !entry
            ? '宿主没有发现这个插件'
            : entry.source === 'builtin'
              ? '同名内置插件已存在（先到者胜，内置优先）'
              : `宿主看到的是 ${entry.source} 来源`;
        return fail(`安装复查失败（已回滚 ${target}）：${why}`);
    }

    if (jsonMode) {
        emitJson({
            ok: true,
            name,
            dir: entry.dir,
            version: manifest.version,
            seam: manifest.seam,
            entry: manifest.entry,
            source: entry.source,
            enabled: entry.enabled,
            requiresRestart: true,
        });
    } else {
        process.stdout.write(`已安装 ${name} → ${entry.dir}\n`);
        process.stdout.write(`重启 3rdloop serve 后生效（宿主启动时扫描 ${USER_PLUGINS_DIR}）\n`);
        if (!entry.enabled) {
            process.stdout.write(`当前为禁用状态（${entry.reason ?? 'profile 禁用'}），启用：3rdloop plugin enable ${name}\n`);
        }
    }
    return EXIT.OK;
}

/** remove：只删 `source === 'user'` 的插件目录（内置插件属包产物，不由本命令删） */
function pluginRemove({ jsonMode, emitJson, usageError, fail }, name) {
    if (!name) return usageError('缺少插件名: 3rdloop plugin remove <name>');

    const state = readState();
    const target = state.plugins.find((p) => p.name === name);
    if (!target) {
        const known = state.plugins.map((p) => p.name).join(', ');
        return fail(`未知插件: ${name}（已发现: ${known || '无'}）`);
    }
    if (!target.installed) return fail(`插件 ${name} 未安装（profile 提到了它，但插件根里没有目录），无需卸载`);
    if (target.source !== 'user') {
        return fail(
            `插件 ${name} 是内置插件（${target.dir}），不能通过 plugin remove 删除。\n` +
                `        内置插件随核心包发布，卸载请走包管理器；只想起停用它：3rdloop plugin disable ${name}`
        );
    }

    const dir = path.resolve(target.dir);
    // 删除前二次确认目标在用户插件根之内：目录来自磁盘扫描结果，不该有任何越界余地
    if (!isUnder(dir, USER_PLUGINS_DIR)) return fail(`拒绝删除用户插件根之外的目录: ${dir}`);

    fs.rmSync(dir, { recursive: true, force: true });
    const after = readState().plugins.find((p) => p.name === name);
    if (after?.installed) {
        return fail(`卸载未生效：${name} 仍被发现于 ${after.dir}`);
    }

    if (jsonMode) {
        emitJson({ ok: true, name, dir, removed: true });
    } else {
        process.stdout.write(`已卸载 ${name}（删除 ${dir}）\n`);
    }
    return EXIT.OK;
}

// ─── 小工具 ───────────────────────────────────────────────────────

/**
 * 把内核 describe 的单条记录收敛成命令层条目。
 * `status` 是三态机值（enabled/disabled/missing），表格与 JSON 各自渲染，避免两处各判一次。
 */
function toItem(p) {
    return {
        name: p.name,
        version: p.version ?? null,
        seam: p.seam ?? null,
        entry: p.entry ?? null,
        status: !p.installed ? 'missing' : p.enabled ? 'enabled' : 'disabled',
        source: p.source,
        installed: Boolean(p.installed),
        enabled: Boolean(p.enabled),
        required: Boolean(p.required),
        reason: p.reason ?? null,
        dir: p.dir ?? null,
        options: p.options ?? {},
        loaded: Boolean(p.loaded),
        dependencies: [...(p.dependencies ?? [])],
        dependents: [...(p.dependents ?? [])],
    };
}

/**
 * 禁用某插件会产生什么后果。
 *
 * 三条真实后果，缺一条用户就会在启动时被咬：
 *   1. required 被禁 → `PluginHost.load()` 直接抛错（fail closed）；
 *   2. 有人依赖它 → 依赖方启动时报依赖缺失（拓扑排序拿不到节点）；
 *   3. 它是某接缝的唯一提供方 → 装配层取接缝时 fail closed
 *      （`buildApp` 的 `engine-*` 就是这么炸的）。
 */
function disableImpact(p, state) {
    if (!p.installed) return ['未安装：只能写 overlay 记录，装配阶段无变化'];
    if (!p.enabled) return ['当前已禁用（重复 disable 是幂等的）'];

    const lines = [];
    if (p.required) lines.push('required：禁用后宿主启动直接 fail closed（PluginHost.load 抛错）');
    const dependents = p.dependents ?? [];
    if (dependents.length > 0) {
        lines.push(`被以下启用中的插件依赖，禁用后它们启动时报依赖缺失: ${dependents.join(', ')}`);
    }
    if (p.seam) {
        const providers = state.seams[p.seam]?.providers ?? [];
        const others = providers.filter((name) => name !== p.name);
        lines.push(
            others.length === 0
                ? `接缝 ${p.seam} 会失去全部提供方：装配层取该接缝时 fail closed（如 buildApp 的引擎接缝）`
                : `接缝 ${p.seam} 仍有其它提供方: ${others.join(', ')}`
        );
    }
    if (lines.length === 0) lines.push('无启用插件依赖它，禁用不影响其它插件');
    return lines;
}

/** 去掉 UTF-8 BOM（Windows 记事本保存的 plugin.json 常带），否则 JSON.parse 会报非法字符 */
function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** dir 是否在 root 之下（统一分隔符与大小写，Windows 上大小写不同不该被判成越界） */
function isUnder(dir, root) {
    const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    const d = norm(dir);
    const r = norm(root);
    return d === r || d.startsWith(`${r}/`);
}

/** 显示宽度：CJK 占 2 列，否则表格里中英混排必然错位 */
function displayWidth(s) {
    let width = 0;
    for (const ch of String(s)) width += /[\u1100-\uFFFF]/.test(ch) ? 2 : 1;
    return width;
}

/** 按显示宽度右补齐 */
function pad(s, width) {
    const text = String(s);
    return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}
