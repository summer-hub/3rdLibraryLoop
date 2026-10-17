/**
 * M9 共用工具：断言汇总器 · 契约形状归一 · 「契约声明 ↔ 提供方实现」可执行判定
 *
 * 本文件承载的是**判定逻辑**，不是断言清单：各测试文件与负向自测复用同一份实现，
 * 因此"负向自测把假方法塞进契约后必须报红"这件事证明的是**真套件**的检测力，
 * 而不是另一段代码的检测力。
 *
 * 三条设计约束：
 *   1. **不硬编码接缝名单/数量**：契约一律从 `seams/index.js` 的 `SEAMS` 读，
 *      接缝清单与磁盘文件在 f50 里互相核对，新增接缝自动进入检查范围。
 *   2. **不静态 grep**：`materialize()` 真的调用工厂 / 真的实例化类，产物上逐条查成员。
 *   3. **不在仓库里留下任何东西**：临时目录只在 `os.tmpdir()` 下开，finally 删除；
 *      工厂产物用完调用 `close()`（若契约给了该方法）。
 *
 * 两种服务形状都要支持（见 seams/index.js 头注释的"当前标准形状"）：
 *   - `factory: true`  → 提供方是工厂函数，产物即门面/适配器对象；
 *   - `factory: false` → 提供方是类或对象；类上的**静态方法**也算能力面
 *     （`stats` 就是这种：能力全在静态方法上，实例化毫无意义，故只在静态面不够时才 new）。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 仓库根（test/m9-contract-conformance/lib/ → ../../../） */
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** 以仓库根为基准 import（核心/契约/门面都走这里，避免相对路径算错层级） */
export const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/**
 * 断言汇总器：每条断言一行 PASS/FAIL，末尾汇总「共 N 条断言，失败 M 条」。
 * @param {string} title
 */
export function createSuite(title) {
    const results = [];
    console.log(`── ${title} ──`);
    return {
        results,
        check(name, ok, detail = '') {
            results.push({ name, ok: !!ok });
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
        },
        /** 断言 fn 抛错；返回 { err, msg }，未抛错返回 null */
        async throws(fn) {
            try {
                await fn();
                return null;
            } catch (err) {
                return { err, msg: String(err?.message ?? err) };
            }
        },
        finish() {
            const failed = results.filter((r) => !r.ok);
            console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
            process.exitCode = failed.length === 0 ? 0 : 1;
            return failed.length;
        },
    };
}

/**
 * 在 os.tmpdir() 下开一个临时目录，回调结束后无条件删除。
 * @template T
 * @param {string} prefix
 * @param {(dir: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTempDir(prefix, fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `m9-${prefix}-`));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
}

// ─── 契约字段归一 ────────────────────────────────────────────────────────────

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * 把契约里的"产物必须具备的成员"声明归一成三类。
 *
 * 为什么三类一起读：
 *   - `methods`        旧形状（v1）与"产物是适配器实例"的 v2 接缝都用它，语义＝必须实现的方法；
 *   - `facadeMethods`  v2 形状（storage）：工厂产物的键，既有方法也有属性（`manager`）；
 *   - `properties`     产物上的属性/取值器（message-archive 的 `stallThresholdMs`）。
 * 三者取并集检查，契约换形状不会让测试静默变成空转（空转＝把所有字段都漏读）。
 *
 * @param {object} contract
 * @returns {{methods: string[], facadeMethods: string[], properties: string[]}}
 */
export function requiredMembers(contract) {
    return {
        methods: asArray(contract?.methods),
        facadeMethods: asArray(contract?.facadeMethods),
        properties: asArray(contract?.properties),
    };
}

/** 契约声明的成员总数（用于 PASS 行的 `n/n` 与负向自测的期望条数） */
export function memberCount(contract) {
    const m = requiredMembers(contract);
    return m.methods.length + m.facadeMethods.length + m.properties.length;
}

/**
 * 逐条比对"契约声明 vs 候选对象"。
 *
 * 候选对象可以有多个（类本体的静态能力面 + 构造出的实例），成员在**任一**候选上
 * 可用即算满足——这正好覆盖 `stats`（纯静态类，不该被实例化）与 `llm`（实例方法）两种。
 *
 * @param {object} contract
 * @param {Array<object|Function>} targets
 * @param {string} label - 报错时用来指明是谁缺了
 * @returns {string[]} 每个缺失项一条，文案里点名具体成员（负向自测据此断言"报出了哪个"）
 */
export function memberViolations(contract, targets, label) {
    const out = [];
    const usable = (name, kind) => {
        for (const t of targets) {
            if (t === null || (typeof t !== 'object' && typeof t !== 'function')) continue;
            if (kind === 'method') {
                if (typeof t[name] === 'function') return true;
            } else if (name in t && t[name] !== undefined) {
                return true;
            }
        }
        return false;
    };

    const { methods, facadeMethods, properties } = requiredMembers(contract);
    for (const name of methods) {
        if (!usable(name, 'method')) out.push(`${label} 缺少契约方法 ${name}()`);
    }
    for (const name of facadeMethods) {
        if (!usable(name, 'any')) out.push(`${label} 缺少契约成员 ${name}`);
    }
    for (const name of properties) {
        if (!usable(name, 'any')) out.push(`${label} 缺少契约属性 ${name}`);
    }
    return out;
}

// ─── 契约 `constants` 通道：提供方类上的冻结常量表 ──────────────────────────

/**
 * 判定"契约 `constants` 声明的冻结常量表是否真的挂在提供方上"。
 *
 * 为什么需要这条独立通道（而不是把常量表塞进 `methods`/`properties`）：
 * `CheckStatus` / `BrainStatus` 是**模块级 `Object.freeze` 常量表**，不是某类实例的成员。
 * 写进 `methods` 会变成"实例上必须有这个方法"的假声明，写进 `properties` 会让成员核对
 * 变成"能不能解析到 storage"这类与常量无关的判定。它们是**共享字面量表**：
 * 消费者（`plugins/engines/loopengine`）拿它做 `===` 比较，所以必须是**同一份冻结对象**，
 * 而且必须能在**不 import 提供方模块**（R2 禁止插件互相引用）的前提下取到——只能从
 * 提供方注册的那个**类**上取。
 *
 * 每个声明项给出 3 条判定（存在 / 是对象 / 已冻结），逐条报红并点名。
 *
 * @param {object} contract - 接缝契约（读 `constants` 字段；未声明即空数组）
 * @param {*} provider - `host.inject(service)` 拿到的提供方（类/函数/对象）
 * @param {string} label - 报错时用来指明是谁缺了
 * @returns {Array<{title: string, ok: boolean, detail: string}>}
 */
export function constantChecks(contract, provider, label) {
    const out = [];
    const declared = asArray(contract?.constants);
    for (const name of declared) {
        const table = provider === null || provider === undefined ? undefined : provider[name];
        const present = table !== undefined && table !== null;
        out.push({
            title: `${label} 契约 constants 声明的 ${name} 挂在提供方上`,
            ok: present,
            detail: present ? '' : '未挂到提供方类上 ⇒ constants 未实现',
        });
        const isObject = present && typeof table === 'object';
        out.push({
            title: `${label} 的 ${name} 是对象`,
            ok: isObject,
            detail: isObject ? '' : `实际 ${typeof table}`,
        });
        const frozen = isObject && Object.isFrozen(table);
        out.push({
            title: `${label} 的 ${name} 是冻结常量表（Object.isFrozen）`,
            ok: frozen,
            detail: frozen ? '' : 'Object.isFrozen=false ⇒ 可被运行期改写，同一性承诺不可信',
        });
    }
    return out;
}

// ─── 构造入参的取值表 ────────────────────────────────────────────────────────

/**
 * 契约里出现的构造入参键 → 最小可用值。
 *
 * 为什么要一张显式表：m9 必须"真的按契约声明构造一次"，而它不可能凭空知道
 * `rootDir` 该给什么。**未知键会被逐条报红**，因此新增 factoryOptions 时，
 * 契约与测试必须同步——这正是"声明与实现一致"要守的那条线，不是测试的偷懒豁免。
 */
const OPTION_VALUES = Object.freeze({
    // ai-cli
    host: () => '127.0.0.1',
    port: () => 4097,
    baseUrl: () => 'http://127.0.0.1:4097',
    requestTimeoutMs: () => 1000,
    stallThresholdMs: () => 1000,
    // storage / message-archive / skill-source
    rootDir: (ctx) => ctx.tmpDir,
    baseDir: (ctx) => ctx.tmpDir,
    skillDirectory: (ctx) => ctx.tmpDir,
    manager: (ctx) => ctx.storageManager(),
    archive: (ctx) => ctx.archive(),
    // app-logger
    tag: () => 'm9-conformance',
    level: () => 'info',
    // llm
    apiKey: () => 'm9-conformance-dummy-key',
    model: () => 'm9-conformance-model',
    temperature: () => 0,
    maxTokens: () => 16,
    enableThinking: () => false,
    fallbackModel: () => '',
    // engine-loop：构造必填的两个 Controller。只造**最小桩**（本文件不该知道
    // Controller 的实现细节）：engine-loop 的契约把这两个键声明为
    // `options`，m9 必须能按契约真构造一次 `new LoopEngine({...})`。
    brainController: () => ({ _getBrain: () => null }),
    orchestratorController: () => ({ load: async () => {}, start: async () => {}, _getOrchestrator: () => null }),
});

/**
 * 构造入参取值器：惰性产出（一次测试里 `manager` / `archive` 只造一份），并负责回收。
 *
 * @param {{tmpDir: string, host: object|null}} opts
 * @returns {{has: (k: string) => boolean, make: (k: string) => any, closeAll: () => Promise<void>}}
 */
export function createOptionValues({ tmpDir, host = null }) {
    const ctx = { tmpDir, host };
    let storageFacade = null;
    let archiveInstance = null;

    const make = (key) => {
        const factory = OPTION_VALUES[key];
        if (!factory) return undefined;
        if (key === 'manager') {
            storageFacade ??= host.inject('storage')({ rootDir: tmpDir });
            return storageFacade.manager;
        }
        if (key === 'archive') {
            archiveInstance ??= host.inject('message-archive')({ baseDir: tmpDir });
            return archiveInstance;
        }
        return factory(ctx);
    };

    return {
        has: (key) => Object.hasOwn(OPTION_VALUES, key),
        make,
        async closeAll() {
            if (storageFacade) {
                try {
                    await storageFacade.close();
                } catch {
                    /* 清理失败不影响断言结论 */
                }
                storageFacade = null;
            }
            archiveInstance = null;
        },
    };
}

// ─── 真构造 ──────────────────────────────────────────────────────────────────

/**
 * 按契约声明真构造一次提供方产物，返回"成员检查候选对象"。
 *
 * @param {object} args
 * @param {object} args.contract
 * @param {*} args.provider - `host.inject(service)` 拿到的提供方（工厂/类/对象）
 * @param {ReturnType<typeof createOptionValues>} [args.values]
 * @returns {Promise<{targets: Array<object|Function>, products: object[], violations: string[], shape: string}>}
 */
export async function materialize({ contract, provider, values = null }) {
    const violations = [];
    const products = [];
    const targets = [];
    const val = values ?? { has: () => false, make: () => undefined };
    const optionKeys = asArray(contract.factoryOptions);

    if (contract.factory === true) {
        if (typeof provider !== 'function') {
            violations.push(`契约声明 factory: true，但提供方不是函数（实际 ${typeof provider}）`);
            return { targets, products, violations, shape: 'factory' };
        }
        const unknown = optionKeys.filter((k) => !val.has(k));
        if (unknown.length > 0) {
            violations.push(`m9 没有这些 factoryOptions 的构造值：${unknown.join(', ')}（请在 lib/conformance.mjs 的 OPTION_VALUES 补一行）`);
            return { targets, products, violations, shape: 'factory' };
        }
        const positional = contract.factorySignature === 'positional';
        const args = positional
            ? optionKeys.map((k) => val.make(k))
            : Object.fromEntries(optionKeys.map((k) => [k, val.make(k)]));
        let product;
        try {
            product = await (positional ? provider(...args) : provider(args));
        } catch (err) {
            violations.push(`工厂调用抛错：${err?.message ?? err}`);
            return { targets, products, violations, shape: 'factory' };
        }
        if (product === null || product === undefined) {
            violations.push('工厂返回空（null/undefined）');
            return { targets, products, violations, shape: 'factory' };
        }
        if (typeof product !== 'object' && typeof product !== 'function') {
            violations.push(`工厂产物不是对象/函数（实际 ${typeof product}）`);
            return { targets, products, violations, shape: 'factory' };
        }
        targets.push(product);
        products.push(product);
        return { targets, products, violations, shape: 'factory' };
    }

    // factory: false —— 类（能力面可以是静态方法）或对象
    if (typeof provider !== 'function' && (provider === null || typeof provider !== 'object')) {
        violations.push(`契约声明 factory: false，但提供方既不是类/工厂也不是对象（实际 ${typeof provider}）`);
        return { targets, products, violations, shape: 'class' };
    }
    targets.push(provider);

    // 静态能力面不够时，才按契约的 `options` 实例化一次（`stats` 纯静态，这里不会触发）
    const missingOnClass = memberViolations(contract, targets, '提供方本体');
    if (missingOnClass.length > 0 && typeof provider === 'function') {
        const unknown = asArray(contract.options).filter((k) => !val.has(k));
        if (unknown.length > 0) {
            violations.push(`m9 没有这些 options 的构造值：${unknown.join(', ')}（请在 lib/conformance.mjs 的 OPTION_VALUES 补一行）`);
        } else {
            try {
                const instance = new provider(
                    Object.fromEntries(asArray(contract.options).map((k) => [k, val.make(k)]))
                );
                targets.push(instance);
                products.push(instance);
            } catch (err) {
                violations.push(`按契约 options 实例化失败：${err?.message ?? err}`);
            }
        }
    }
    return { targets, products, violations, shape: 'class' };
}

/**
 * 回收构造出来的产物：契约产物如果有 `close()` 就调用（storage 门面就是这么收的）。
 * 回收失败不改变断言结论（已经断完），但绝不静默吞掉真实异常之外的副作用。
 * @param {object[]} products
 */
export async function disposeProducts(products) {
    for (const product of products) {
        if (product && typeof product.close === 'function') {
            try {
                await product.close();
            } catch {
                /* 见上 */
            }
        }
    }
}

// ─── 契约自身的形状判定（不需要宿主） ────────────────────────────────────────

/**
 * 契约对象的形状是否自洽：字段类型、重复声明、"旧形状 + v2 形状"互相矛盾之处。
 * 这里只判**契约内部**，不碰提供方（提供方的判定在 f51/f53）。
 *
 * @param {string} key - `SEAMS` 的键
 * @param {object} contract
 * @returns {string[]} 每条一个形状问题
 */
export function shapeViolations(key, contract) {
    const out = [];
    if (contract === null || typeof contract !== 'object') return [`${key}: 契约不是对象`];
    if (contract.name !== key) out.push(`${key}: 契约 name 字段（${contract.name}）与 SEAMS 的键不一致`);
    if (typeof contract.version !== 'number' || !Number.isFinite(contract.version)) {
        out.push(`${key}: version 必须是数字（实际 ${typeof contract.version}）`);
    }
    if (!Object.isFrozen(contract)) out.push(`${key}: 契约必须 Object.freeze（防止运行期被改写）`);
    if (typeof contract.description !== 'string' || contract.description.length === 0) {
        out.push(`${key}: description 必须是非空字符串`);
    }
    if (contract.factory !== undefined && typeof contract.factory !== 'boolean') {
        out.push(`${key}: factory 只能是布尔值（实际 ${typeof contract.factory}）`);
    }
    if (contract.factory === true) {
        const keys = asArray(contract.factoryOptions);
        if (keys.length === 0) out.push(`${key}: factory: true 必须声明非空 factoryOptions`);
        if (keys.some((k) => typeof k !== 'string' || k.length === 0)) {
            out.push(`${key}: factoryOptions 只能是非空字符串`);
        }
        if (new Set(keys).size !== keys.length) out.push(`${key}: factoryOptions 有重复项`);
        if (contract.factorySignature !== undefined && !['positional', 'options-object'].includes(contract.factorySignature)) {
            out.push(`${key}: factorySignature 只支持 positional / options-object`);
        }
    }

    const { methods, facadeMethods, properties } = requiredMembers(contract);
    for (const [field, list] of [
        ['methods', methods],
        ['facadeMethods', facadeMethods],
        ['properties', properties],
    ]) {
        if (list.some((n) => typeof n !== 'string' || n.length === 0)) {
            out.push(`${key}: ${field} 只能是非空字符串`);
        }
        if (new Set(list).size !== list.length) out.push(`${key}: ${field} 有重复项`);
    }
    const overlap = methods.filter((n) => facadeMethods.includes(n) || properties.includes(n));
    if (overlap.length > 0) out.push(`${key}: methods 与 facadeMethods/properties 重复声明：${overlap.join(', ')}`);

    // `constants`：提供方**类**上必须挂的冻结常量表名（不是实例成员，故与上面三类分开判）
    const constants = asArray(contract.constants);
    if (constants.some((n) => typeof n !== 'string' || n.length === 0)) {
        out.push(`${key}: constants 只能是非空字符串`);
    }
    if (new Set(constants).size !== constants.length) out.push(`${key}: constants 有重复项`);

    // 门面自有方法不得同时被当作适配器/产物契约（v1 → v2 就是这么错的）
    const own = asArray(contract.facade?.own);
    const leaked = own.filter((n) => methods.includes(n) || facadeMethods.includes(n));
    if (leaked.length > 0) {
        out.push(`${key}: 门面自有方法被写进了提供方契约：${leaked.join(', ')}`);
    }
    const forwarded = asArray(contract.facade?.forwarded);
    const notDeclared = forwarded.filter((n) => !methods.includes(n) && !facadeMethods.includes(n));
    if (notDeclared.length > 0) {
        out.push(`${key}: facade.forwarded 里的方法没有出现在 methods 中：${notDeclared.join(', ')}`);
    }
    return out;
}
