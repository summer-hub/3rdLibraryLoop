/**
 * M10-B 覆盖守卫 + 无宿主不变式
 *
 * 覆盖守卫要回答的问题是：默认宿主是进程级单例，**静默覆盖**会让先设置者的消费者在
 * 下一个 await 之后用上别人的实现——没有栈可查。所以第二个不同的宿主必须当场抛错，
 * 且错误信息要能把人引到正确做法（作用域隔离 / 先 clear）。
 *
 * 无宿主不变式是这条桥的底线：没有宿主时所有 resolve* 必须与"从未接入插件宿主"完全
 * 一致（返回 null 或调用方给的 fallback），hasActiveHost() 为 false——桥不能变成新的
 * 故障点。
 */
import { createSuite, fakeHost, impBridge } from './helpers.mjs';

const bridge = await impBridge('hostBridge.js');
const {
    clearActiveHost,
    createLlmFromHost,
    createStorageFromHost,
    getActiveHost,
    hasActiveHost,
    resolveAiCliFactory,
    resolveLlmClass,
    resolveMessageArchiveFactory,
    resolveSeamProvider,
    resolveStats,
    resolveStorageFactory,
    runInHostScope,
    setActiveHost,
} = bridge;

const suite = createSuite('M10-B 覆盖守卫 · 无宿主不变式');
const { check, throws } = suite;

const llmOf = (label) => ({ provider: `llm/${label}` });

async function main() {
    const hostA = fakeHost('alpha', { llm: llmOf('alpha') });
    const hostB = fakeHost('beta', { llm: llmOf('beta') });

    clearActiveHost();
    try {
        // ── B1 正常设置 ──────────────────────────────────────────────────────
        setActiveHost(hostA);
        check('B1 setActiveHost(A) 后 getActiveHost() === A', getActiveHost() === hostA);
        check('B1 hasActiveHost() 为 true', hasActiveHost() === true);

        // ── B2 不同实例再 set 必须抛错 ───────────────────────────────────────
        const guarded = await throws(() => setActiveHost(hostB));
        check('B2 setActiveHost(A) 后再 setActiveHost(B) 抛错', guarded !== null, guarded?.msg ?? '（没有抛错）');
        const msg = guarded?.msg ?? '';

        // ── B3 错误信息必须给出三条出路 ──────────────────────────────────────
        check(
            'B3 错误信息说明「一个进程只应有一个默认宿主」',
            msg.includes('一个进程只应有一个默认宿主'),
            msg.includes('一个进程只应有一个默认宿主') ? '' : `实际：${msg}`
        );
        check(
            'B3 错误信息指向 runInHostScope(host, fn) 做作用域隔离',
            msg.includes('runInHostScope(host, fn)') && msg.includes('作用域隔离'),
            msg
        );
        check(
            'B3 错误信息提示「确实要替换请先 clearActiveHost()」',
            msg.includes('clearActiveHost()'),
            msg
        );

        // ── B4 错误信息不含宿主实参（不泄露实例内部、不二次踩 toString）──────
        check(
            'B4 错误信息不插值宿主对象（安全：不含实例标识 / [object Object]）',
            !msg.includes('alpha') && !msg.includes('beta') && !msg.includes('[object'),
            msg
        );

        // ── B5 守卫是纯拒绝：抛错之后状态没有被改 ────────────────────────────
        check('B5 覆盖被拒后默认宿主仍是 A（守卫不改状态）', getActiveHost() === hostA);

        // ── B6 同实例重复 set 幂等，不抛 ─────────────────────────────────────
        const repeat = await throws(() => setActiveHost(hostA));
        check('B6 同实例重复 setActiveHost 幂等不抛', repeat === null, repeat?.msg ?? '');
        check('B6 重复 set 后仍是 A', getActiveHost() === hostA);

        // ── B7 setActiveHost(null) 幂等不抛，等价于 clear ─────────────────────
        const nullSet = await throws(() => setActiveHost(null));
        check(
            'B7 setActiveHost(null) 不抛且清除默认宿主',
            nullSet === null && getActiveHost() === null && hasActiveHost() === false,
            nullSet?.msg ?? `getActiveHost()=${getActiveHost()}`
        );

        // ── B8 clearActiveHost() 之后可以设置另一个宿主 ──────────────────────
        setActiveHost(hostA);
        clearActiveHost();
        const afterClear = await throws(() => setActiveHost(hostB));
        check(
            'B8 clearActiveHost() 后可以 setActiveHost(B)（替换的合法路径）',
            afterClear === null && getActiveHost() === hostB,
            afterClear?.msg ?? ''
        );

        // ── B9 作用域不算「覆盖默认宿主」：守卫不拦作用域 ─────────────────────
        clearActiveHost();
        setActiveHost(hostA);
        const scoped = await runInHostScope(hostB, async () => getActiveHost());
        check(
            'B9 默认宿主=A 时进入 runInHostScope(B) 不触发守卫（作用域不是覆盖）',
            scoped === hostB && getActiveHost() === hostA,
            `作用域内=${scoped?.label} / 作用域外=${getActiveHost()?.label}`
        );
    } finally {
        clearActiveHost();
    }

    // ── B10 无宿主不变式：所有 resolve* 返回 null / fallback ────────────────
    check('B10 无宿主：getActiveHost() 为 null', getActiveHost() === null);
    check('B10 无宿主：hasActiveHost() 为 false', hasActiveHost() === false);
    check('B10 无宿主：resolveSeamProvider 各接缝均为 null', ['llm', 'storage', 'stats', 'message-archive', 'ai-cli'].every((s) => resolveSeamProvider(s) === null));
    check('B10 无宿主：resolveStats() 为 null', resolveStats() === null);
    check('B10 无宿主：resolveAiCliFactory(type) 为 null', resolveAiCliFactory('opencode') === null && resolveAiCliFactory('deveco-code') === null);

    class FallbackLLM {}
    check('B10 无宿主：resolveLlmClass(fallback) === fallback', resolveLlmClass(FallbackLLM) === FallbackLLM);
    check('B10 无宿主：createLlmFromHost(fallback) 用 fallback 实例化', createLlmFromHost(FallbackLLM) instanceof FallbackLLM);
    const llmNoFallback = await throws(() => resolveLlmClass());
    check(
        'B10 无宿主且无 fallback：resolveLlmClass 明确抛错（fail closed）',
        llmNoFallback !== null && llmNoFallback.msg.includes('兜底必须由调用方注入'),
        llmNoFallback?.msg.slice(0, 60) ?? '（没有抛错）'
    );

    check('B10 无宿主：resolveStorageFactory() 为 null', resolveStorageFactory() === null);
    const storageFallback = (options) => ({ kind: 'fallback-storage', options });
    check('B10 无宿主：resolveStorageFactory(fallback) === fallback', resolveStorageFactory(storageFallback) === storageFallback);
    const builtStorage = createStorageFromHost({ rootDir: 'x' }, storageFallback);
    check(
        'B10 无宿主：createStorageFromHost 用 fallback 且透传 options',
        builtStorage.kind === 'fallback-storage' && builtStorage.options.rootDir === 'x',
        JSON.stringify(builtStorage)
    );

    check('B10 无宿主：resolveMessageArchiveFactory() 为 null', resolveMessageArchiveFactory() === null);
    const archiveFallback = () => 'archive';
    check(
        'B10 无宿主：resolveMessageArchiveFactory(fallback) === fallback',
        resolveMessageArchiveFactory(archiveFallback) === archiveFallback
    );

    // ── B11 作用域内的宿主同样喂饱各条 resolve*（作用域 = 一等宿主）────────
    const cliFactory = Object.assign(() => 'opencode-adapter', { provider: 'cli/opencode' });
    const seamHost = fakeHost('seamHost', { llm: llmOf('seamHost'), stats: { id: 'stats' }, 'ai-cli': cliFactory });
    const scopedReads = await runInHostScope(seamHost, async () => ({
        llm: resolveSeamProvider('llm'),
        stats: resolveStats(),
        byType: resolveAiCliFactory('opencode'),
        wrongType: resolveAiCliFactory('deveco-code'),
    }));
    check('B11 作用域宿主注册的 llm / stats 被 resolve* 取到', scopedReads.llm === seamHost.inject('llm') && scopedReads.stats === seamHost.inject('stats'));
    check(
        'B11 作用域宿主的裸名 ai-cli 只对「提供方就是该类型」的 type 生效',
        scopedReads.byType === cliFactory && scopedReads.wrongType === null,
        `opencode=${scopedReads.byType === cliFactory} / deveco-code=${scopedReads.wrongType}`
    );
    check('B11 作用域退出后 resolveSeamProvider 重新为 null', resolveSeamProvider('llm') === null);
}

await main();
suite.finish();
