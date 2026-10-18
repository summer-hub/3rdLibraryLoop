/**
 * plugin-cmd.js —— 3rdloop plugin 插件管理命令
 *
 * 边界：本模块只做「命令层」——参数解析、人读输出、退出码。
 * 状态的**唯一读写入口**是 `plugin-store.js`（与 Web「插件」页共用同一份判定）。
 * 这里不允许另写一套 overlay 合并 / 允许性校验逻辑：两边各写一套，判定迟早漂移
 * （一边允许禁用 required、一边拒绝），那正是插件管理最难排查的一类故障。
 *
 * DSH 式语义（与 store 一致）：**一个 profile 一个目录**，插件是该目录的 npm 依赖，
 * 装/卸走包管理器（`plugin add <包 spec>` / `plugin remove <name>`），启用状态另记在
 * `<profileDir>/profile.json`。所有子命令都支持 `--profile <name>`（优先于 env
 * `3LIB_PLUGIN_PROFILE`）。
 *
 * 生效语义：profile 由 `PluginHost.load()` 在**进程启动**时读取，所以 enable/disable
 * 之后必须重启 `3rdloop serve` 才生效——命令只如实回传 requiresRestart，不假装已生效。
 *
 * 「绝不写包内 profile」：包内 `profiles/*.json` 随核心包发布，改它既越权又会在下次
 * `3rdloop update` 时丢掉。所有写盘都经 `plugin-store` 落到用户级 profile 目录。
 */

import { EXIT } from './exit-codes.js';
import { check, installPlugin, readState, removePlugin, setEnabled } from './plugin-store.js';

/** 完整用法（`--help` 走 stdout 退出 0；参数错误走 stderr 退出 1） */
const USAGE = `3rdloop plugin —— 插件管理（一个 profile 一个目录，插件是该目录的 npm 依赖）

用法:
  3rdloop plugin list   [--profile <name>] [--json]      列出全部条目（含 profile 提到但未安装的）
  3rdloop plugin info   <name> [--profile <name>] [--json]  单个插件全字段 + 禁用后果
  3rdloop plugin enable <name> [--profile <name>]        启用（写 <profileDir>/profile.json）
  3rdloop plugin disable <name> [--force] [--profile <name>]  禁用（被启用中的插件依赖时默认拒绝）
  3rdloop plugin check  [--profile <name>] [--json]      静态一致性检查（有 error 时退出码 1）
  3rdloop plugin path   [--profile <name>] [--json]      打印 profile 目录 / overlay 路径 / 插件根
  3rdloop plugin add    <包 spec> [--profile <name>]     npm 安装进 profile 目录（失败自动回滚）
  3rdloop plugin remove <name> [--profile <name>]        从当前 profile 卸载（= npm uninstall）

  <包 spec>（add）:
    m15-demo-plugin            包名（可带版本/范围：pkg@1.2.3、@scope/pkg@^1.0.0）
    file:D:/my-plugin          本机插件目录（也接受 link: 前缀或裸路径；必须含 package.json）
    github:owner/repo          git 来源（git+https://… / git@host:… 同样支持）
    https://…/plugin.tgz       tarball（本地 .tgz 亦可）
  安装前会预检目标包的 engines.3rdloop 是否兼容当前 CLI 版本：不兼容直接报错，不下载不安装。

示例:
  3rdloop plugin list
  3rdloop plugin info engines/brain
  3rdloop plugin add file:./my-plugin --profile web
  3rdloop plugin remove m15-demo-plugin --profile web

说明:
  - profile 目录 = ~/.3lib/3rdloop/profiles/<profile>/，插件装在其 node_modules 里
  - 启用状态写在 <profileDir>/profile.json，重启 3rdloop serve 后生效
  - 包内 profiles/*.json 是随包发布的只读配置，任何子命令都不会写它
  - profile 名取 --profile，缺省用 env 3LIB_PLUGIN_PROFILE，再缺省 default

全局选项: --json 结构化输出到 stdout（表格/日志改走 stderr 或省略）
`;

/** 状态机值 → 人读标签 */
const STATUS_LABEL = { enabled: '启用', disabled: '禁用', missing: '未安装' };
/** 来源 → 人读标签（profile = 装在当前 profile 的 node_modules 里） */
const SOURCE_LABEL = { builtin: '内置', profile: 'profile', user: '用户', missing: '—' };

/** 已知子命令（用于未知子命令的报错提示） */
const SUBCOMMANDS = ['list', 'info', 'enable', 'disable', 'check', 'path', 'add', 'remove'];

/** 本命令认识的开关（其余开关报错；全局 flag 已被 parseGlobalFlags 消费，不会到这里） */
const KNOWN_FLAGS = ['--force', '--help', '-h'];

/**
 * 从剩余参数里摘出 `--profile <name>` / `--profile=<name>`（任意位置）。
 *
 * 必须在这里消费掉**值**：`plugin add --profile web file:./x` 若只把 `--profile`
 * 当开关过滤掉，`web` 会被当成位置参数，add 就会去装一个叫 `web` 的包。
 *
 * @param {string[]} args
 * @returns {{profile?: string, rest: string[]}}
 */
function extractProfileFlag(args) {
    let profile;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--profile') {
            profile = args[++i] ?? '';
            continue;
        }
        if (arg.startsWith('--profile=')) {
            profile = arg.slice('--profile='.length);
            continue;
        }
        rest.push(arg);
    }
    return { profile: profile === undefined ? undefined : profile.trim(), rest };
}

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

    const { profile, rest: stripped } = extractProfileFlag(
        (Array.isArray(rest) ? rest : []).filter((a) => typeof a === 'string')
    );
    const args = stripped;
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
    if (profile === '') return usageError('--profile 缺少 profile 名');

    const ctx = {
        jsonMode,
        emitJson,
        usageError,
        fail,
        force: flags.includes('--force'),
        profile: profile || undefined,
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
        // 读盘/解析失败（profile JSON 损坏、profile 不存在等）：消息可直接展示
        const message = err?.message ?? String(err);
        if (jsonMode) emitJson({ ok: false, error: message });
        else process.stderr.write(`插件命令失败: ${message}\n`);
        return EXIT.ERROR;
    }
}

// ─── 子命令实现 ────────────────────────────────────────────────────

/** list：表格（人读）或结构化条目（--json） */
function pluginList({ jsonMode, emitJson, profile }) {
    const state = readState({ profile });
    const items = state.plugins.map(toItem);

    if (jsonMode) {
        emitJson({
            ok: true,
            profile: state.profileName,
            profileDir: state.profileDir,
            profiles: state.profiles,
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
        SOURCE_LABEL[it.source] ?? it.source,
        it.dependents.join(', ') || '—',
    ]);
    const widths = header.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i]))));

    process.stdout.write(`插件条目（profile: ${state.profileName}，共 ${items.length} 个）\n`);
    process.stdout.write(`profile 目录: ${state.profileDir}\n`);
    process.stdout.write(`${header.map((h, i) => pad(h, widths[i])).join('  ').trimEnd()}\n`);
    for (const row of rows) {
        process.stdout.write(`${row.map((c, i) => pad(c, widths[i])).join('  ').trimEnd()}\n`);
    }

    const count = (s) => items.filter((i) => i.status === s).length;
    process.stdout.write(
        `\n已安装 ${items.filter((i) => i.installed).length}` +
            `（启用 ${count('enabled')} / 禁用 ${count('disabled')}），未安装 ${count('missing')}\n`
    );
    process.stdout.write(
        `overlay: ${state.overlay.path}${state.overlay.exists ? '' : '（尚未创建，执行 enable/disable/add 时写入）'}\n`
    );
    process.stdout.write(`插件根: ${state.roots.join('、')}\n`);
    return EXIT.OK;
}

/** info：单插件全字段 + 禁用后果 */
function pluginInfo({ jsonMode, emitJson, usageError, fail, profile }, name) {
    if (!name) return usageError('缺少插件名: 3rdloop plugin info <name>');

    const state = readState({ profile });
    const target = state.plugins.find((p) => p.name === name);
    if (!target) {
        const known = state.plugins.map((p) => p.name).join(', ');
        return fail(`未知插件: ${name}（已发现: ${known || '无'}）`);
    }

    const item = toItem(target);
    const impact = disableImpact(target, state);

    if (jsonMode) {
        emitJson({
            ok: true,
            profile: state.profileName,
            profileDir: state.profileDir,
            overlay: state.overlay,
            plugin: item,
            disableImpact: impact,
        });
        return EXIT.OK;
    }

    process.stdout.write(`插件 ${item.name}\n`);
    process.stdout.write(`  状态: ${STATUS_LABEL[item.status]}${item.reason ? `（${item.reason}）` : ''}\n`);
    process.stdout.write(`  版本: ${item.version ?? '未知'}\n`);
    process.stdout.write(`  接缝: ${item.seam ?? '—（不提供能力接缝）'}\n`);
    process.stdout.write(`  入口: ${item.entry ?? '—'}\n`);
    process.stdout.write(`  来源: ${SOURCE_LABEL[item.source] ?? item.source}\n`);
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

/** enable / disable：写 profile 的 overlay（校验与原子写都在 plugin-store） */
function pluginToggle({ jsonMode, emitJson, usageError, force, profile }, enabled, name) {
    const verb = enabled ? 'enable' : 'disable';
    if (!name) return usageError(`缺少插件名: 3rdloop plugin ${verb} <name>`);

    let result;
    try {
        result = setEnabled({ name, enabled, force, profile });
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
function pluginCheck({ jsonMode, emitJson, profile }) {
    const result = check({ profile });
    const state = result.state;

    if (jsonMode) {
        emitJson({
            ok: result.ok,
            profile: state.profileName,
            profileDir: state.profileDir,
            overlay: state.overlay,
            errors: result.errors,
            warnings: result.warnings,
        });
    } else {
        process.stdout.write(`插件静态检查（profile: ${state.profileName}，目录 ${state.profileDir}）\n`);
        for (const error of result.errors) process.stdout.write(`  [error] ${error}\n`);
        for (const warning of result.warnings) process.stdout.write(`  [warn]  ${warning}\n`);
        process.stdout.write(
            result.ok ? '结论: OK（profile 与内置 profile 合并后静态自洽）\n' : `结论: 发现 ${result.errors.length} 个错误（启动会失败）\n`
        );
    }
    return result.ok ? EXIT.OK : EXIT.ERROR;
}

/** path：profile 目录 + overlay 路径 + 插件根 */
function pluginPath({ jsonMode, emitJson, profile }) {
    const state = readState({ profile });

    if (jsonMode) {
        emitJson({
            ok: true,
            profile: state.profileName,
            profileDir: state.profileDir,
            profiles: state.profiles,
            overlay: state.overlay,
            profileDirs: state.profileDirs,
            roots: state.roots,
        });
        return EXIT.OK;
    }

    process.stdout.write(`profile: ${state.profileName}\n`);
    process.stdout.write(`profile 目录: ${state.profileDir}\n`);
    process.stdout.write(`overlay: ${state.overlay.path}${state.overlay.exists ? '' : '（尚未创建）'}\n`);
    process.stdout.write(`可用 profile: ${state.profiles.join('、') || '（无）'}\n`);
    process.stdout.write(`profile 根（低 → 高优先级）: ${state.profileDirs.join(' → ')}\n`);
    process.stdout.write(`插件根: ${state.roots.join('、')}\n`);
    return EXIT.OK;
}

/**
 * add：把包 spec 用 npm 装进当前 profile 目录（`file:` / git / tarball / registry 名）。
 *
 * 逻辑在 `plugin-store.installPlugin()`（前端「安装插件」共用同一实现）：
 * spec 分类 → engines 预检 → npm install → 从 dependencies 差集推注册名 → 写启用状态 →
 * 用 readState() 复查宿主是否真的看得见、来源是否 profile → 任一步失败逐字节回滚。
 * 这里只负责 CLI 的输出契约（人读文案 / --json）。
 */
function pluginAdd({ jsonMode, emitJson, usageError, fail, profile }, spec) {
    if (!spec) {
        return usageError('缺少包 spec: 3rdloop plugin add <包名 | file:<目录> | git 地址 | tarball>');
    }

    let result;
    try {
        result = installPlugin({ spec, profile });
    } catch (err) {
        return fail(err.message);
    }

    for (const warning of result.warnings ?? []) process.stderr.write(`警告: ${warning}\n`);

    if (jsonMode) {
        emitJson({ ok: true, ...result });
    } else {
        process.stdout.write(`已从 ${result.spec} 安装 ${result.name}@${result.version} → ${result.dir}\n`);
        process.stdout.write(`插件名: ${result.pluginName}（profile: ${result.profile}，已启用）\n`);
        process.stdout.write(`重启 3rdloop serve 后生效（插件根含 ${result.profileDir}/node_modules）\n`);
    }
    return EXIT.OK;
}

/** remove：从当前 profile 卸载（profile 来源走 npm uninstall，user 来源删目录，内置拒绝） */
function pluginRemove({ jsonMode, emitJson, usageError, fail, profile }, name) {
    if (!name) return usageError('缺少插件名: 3rdloop plugin remove <name>');

    let result;
    try {
        result = removePlugin({ name, profile });
    } catch (err) {
        return fail(err.message);
    }

    if (jsonMode) {
        emitJson({ ok: true, ...result });
    } else if (result.packageName) {
        process.stdout.write(`已从 profile ${result.profile} 卸载 ${result.name}（npm 包 ${result.packageName}）\n`);
    } else {
        process.stdout.write(`已卸载 ${result.name}（删除 ${result.dir}）\n`);
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
