/**
 * M10 共用工具：断言汇总器 · 假宿主 · 观测链
 *
 * 约定与 m1~m9 一致：每条断言打印一行 PASS/FAIL，末尾汇总「共 N 条断言，失败 M 条」，
 * 有失败则退出码非 0。
 *
 * 本套件不写任何文件、不读环境变量、不加载真实插件（除 f56 里用空插件根造一个
 * 真 PluginHost 验证 dispose）——它只验桥的状态机，跑完即净。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 仓库根（test/m10-host-scope/ → ../../） */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 以仓库根为基准 import HostBridge 侧模块 */
export const impBridge = (rel) => import(pathToFileURL(path.join(ROOT, 'Server', 'composition', rel)).href);

/**
 * 断言汇总器（形状与 m8/m9 相同，便于顶层 runner 用同样的 PASS/FAIL 行统计）。
 * @param {string} title - 段落标题
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
        /** 打印汇总并按需设置退出码 */
        finish() {
            const failed = results.filter((r) => !r.ok);
            console.log(`\n共 ${results.length} 条断言，失败 ${failed.length} 条`);
            process.exitCode = failed.length === 0 ? 0 : 1;
            return failed.length;
        },
    };
}

/** 让出事件循环（并发链靠它交错；ms 不必精确） */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 造一个鸭子类型的假宿主：桥只要求 has / inject（ai-cli 走 listServices）。
 *
 * `label` 是给断言用的可读标识——并发串味时报错信息要能**点名**是哪个宿主串了，
 * 所以假宿主必须有稳定可打印的身份。真实 PluginHost 没有 label 字段，这里刻意
 * 加在假宿主上，且断言只比较它，不依赖宿主的其它内部结构。
 *
 * @param {string} label - 宿主标识（断言里出现）
 * @param {Record<string, unknown>} [services] - 服务名 → 提供方
 */
export function fakeHost(label, services = {}) {
    const map = new Map(Object.entries(services));
    const host = {
        label,
        root: { name: label },
        has: (name) => map.has(name),
        inject: (name) => map.get(name),
        listServices: () => [...map].map(([service, provider]) => ({ service, provider: provider?.provider ?? null })),
    };
    return host;
}

/**
 * 在**当前上下文**里观测宿主若干次，每次先 await 让出事件循环，再读活跃宿主与
 * `llm` 提供方。调用方负责把它放进 runInHostScope 里跑。
 *
 * @param {object} bridge - hostBridge 模块（{ getActiveHost, resolveSeamProvider }）
 * @param {number} [steps=6]
 * @param {(step: number) => void} [onRead] - 每次读取后回调（用于记录交错顺序，
 *   证明两条链真的并发跑而不是先后跑完——否则"并发隔离"的绿灯可能是空转）
 * @returns {Promise<Array<{step: number, host: object|null, provider: unknown}>>}
 */
export async function observeChain(bridge, steps = 6, onRead = null) {
    const seen = [];
    for (let step = 0; step < steps; step++) {
        // 1~3ms 的微等待足以让并发的另一条链在本链两次读取之间完成若干次 set/恢复
        await sleep(1 + (step % 3));
        seen.push({ step, host: bridge.getActiveHost(), provider: bridge.resolveSeamProvider('llm') });
        onRead?.(step);
    }
    return seen;
}

/**
 * 观测顺序里是否真的存在交错：连续同标签算一块，块数多于参与链数即说明发生过
 * 「切走再切回」。反例（先后跑完）块数恰好等于链数。
 * @param {string[]} order - 每次读取时记录的链标识
 * @param {number} chainCount - 参与的链数
 * @returns {boolean}
 */
export function isInterleaved(order, chainCount) {
    let blocks = 0;
    for (let i = 0; i < order.length; i++) {
        if (i === 0 || order[i] !== order[i - 1]) blocks++;
    }
    return blocks > chainCount;
}

/**
 * 把观测链与期望值比对，返回**点名串味宿主**的失败说明（空串 = 全部符合）。
 *
 * @param {string} expectLabel - 本链期望的宿主 label
 * @param {unknown} expectProvider - 本链期望的 llm 提供方（按引用比较）
 * @param {Array<{step: number, host: object|null, provider: unknown}>} seen
 * @returns {string}
 */
export function traceViolation(expectLabel, expectProvider, seen) {
    for (const { step, host, provider } of seen) {
        const got = host?.label ?? '（无宿主）';
        if (host?.label !== expectLabel) {
            return `第 ${step} 次读取期望 ${expectLabel}，实际读到 ${got} —— 宿主串味`;
        }
        if (provider !== expectProvider) {
            const gotProvider = provider?.provider ?? String(provider);
            return `第 ${step} 次读取期望 ${expectLabel} 的 llm 提供方，实际读到 ${gotProvider} —— 接缝串味`;
        }
    }
    return '';
}
