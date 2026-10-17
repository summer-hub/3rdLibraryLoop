/**
 * M10-A 作用域隔离：并发不串味 · 优先级 · await 链保持 · 嵌套
 *
 * 要证伪的命题（也是改造前模块级单例的病症）：
 *   「两条并发调用链各自 runInHostScope(hostX) 之后，每条链在任意 await 之后读到的
 *     都必须还是自己那份宿主，且彼此不可见。」
 *
 * 并发隔离用例必须先证明**真的并发了**（观测顺序里出现「切走再切回」），否则
 * 两条链先后跑完也能全绿——那是空转。见 isInterleaved 的前置断言。
 */
import {
    createSuite,
    fakeHost,
    impBridge,
    isInterleaved,
    observeChain,
    sleep,
    traceViolation,
} from './helpers.mjs';

const bridge = await impBridge('hostBridge.js');
const { clearActiveHost, getActiveHost, hasActiveHost, resolveSeamProvider, runInHostScope, setActiveHost } = bridge;

const suite = createSuite('M10-A 作用域隔离（并发 · 优先级 · await 链 · 嵌套）');
const { check } = suite;

/** 造一个可被断言的 llm 提供方（按引用比较，所以每个宿主一份） */
const llmOf = (label) => ({ provider: `llm/${label}` });

async function main() {
    check('A0 前置：无默认宿主、无作用域时 getActiveHost() 为 null', getActiveHost() === null);
    check('A0 前置：无默认宿主、无作用域时 hasActiveHost() 为 false', hasActiveHost() === false);

    // ── A1 两条并发链，各自始终看到自己的宿主与 llm 提供方 ──────────────────
    const hostA = fakeHost('hostA', { llm: llmOf('hostA') });
    const hostB = fakeHost('hostB', { llm: llmOf('hostB') });
    const order = [];
    const [seenA, seenB] = await Promise.all([
        runInHostScope(hostA, () => observeChain(bridge, 8, () => order.push('A'))),
        runInHostScope(hostB, () => observeChain(bridge, 8, () => order.push('B'))),
    ]);
    const vA = traceViolation('hostA', hostA.inject('llm'), seenA);
    const vB = traceViolation('hostB', hostB.inject('llm'), seenB);
    check(
        'A1 两条并发链各自始终读到自己那份宿主与 llm 提供方（8 次读取/链）',
        !vA && !vB,
        vA || vB || '0 处串味'
    );
    check('A1 前置：两条链确实交错执行（不是先后跑完）', isInterleaved(order, 2), order.join(''));

    // ── A2 四条并发链（多宿主并存，验证不是"只抗住两条"）────────────────────
    const many = ['h1', 'h2', 'h3', 'h4'].map((label) => fakeHost(label, { llm: llmOf(label) }));
    const manyOrder = [];
    const manySeen = await Promise.all(
        many.map((host) =>
            runInHostScope(host, () => observeChain(bridge, 6, () => manyOrder.push(host.label)))
        )
    );
    const manyViolations = many
        .map((host, i) => traceViolation(host.label, host.inject('llm'), manySeen[i]))
        .filter(Boolean);
    check(
        'A2 四条宿主的并发链互不可见（6 次读取/链）',
        manyViolations.length === 0,
        manyViolations.join(' | ') || '0 处串味'
    );
    check(
        'A2 前置：四条链确实交错执行',
        new Set(manyOrder).size === 4 && isInterleaved(manyOrder, 4),
        manyOrder.join('')
    );

    // ── A3 作用域优先于默认宿主，作用域外仍是默认宿主 ────────────────────────
    clearActiveHost();
    setActiveHost(hostA);
    try {
        const inside = await runInHostScope(hostB, async () => {
            await sleep(10);
            return { host: getActiveHost(), provider: resolveSeamProvider('llm') };
        });
        const outside = getActiveHost();
        check(
            'A3 默认宿主=A 时，runInHostScope(B) 内看到 B（含 await 之后）',
            inside.host === hostB && inside.provider === hostB.inject('llm'),
            `作用域内读到 ${inside.host?.label ?? '（无宿主）'}`
        );
        check('A3 作用域退出后仍看到默认宿主 A', outside === hostA, `作用域外读到 ${outside?.label ?? '（无宿主）'}`);
    } finally {
        clearActiveHost();
    }

    // ── A4 作用域在 await 链上保持（含更深一层的调用，不只看直接作用域）────
    const deepRead = async () => {
        await sleep(10);
        return getActiveHost();
    };
    const beforeSleep = await runInHostScope(hostA, async () => {
        const immediate = getActiveHost();
        await sleep(10);
        const afterSleep = getActiveHost();
        const deep = await deepRead();
        return { immediate, afterSleep, deep };
    });
    check(
        'A4 作用域内 await sleep(10) 之后、以及跨一层函数调用后仍读到该宿主',
        beforeSleep.immediate === hostA && beforeSleep.afterSleep === hostA && beforeSleep.deep === hostA,
        `立即=${beforeSleep.immediate?.label} / await 后=${beforeSleep.afterSleep?.label} / 深层=${beforeSleep.deep?.label}`
    );

    // ── A5 嵌套作用域：内层覆盖外层，退出后回到外层 ─────────────────────────
    const nested = await runInHostScope(hostA, async () => {
        const outer = getActiveHost();
        const inner = await runInHostScope(hostB, async () => {
            await sleep(5);
            return getActiveHost();
        });
        const back = getActiveHost();
        return { outer, inner, back };
    });
    check(
        'A5 嵌套作用域：外层 A 内嵌 B，内层看到 B，退出后回到 A',
        nested.outer === hostA && nested.inner === hostB && nested.back === hostA,
        `外层=${nested.outer?.label} / 内层=${nested.inner?.label} / 回外层=${nested.back?.label}`
    );
    check('A5 嵌套全部退出后回到无宿主', getActiveHost() === null);

    // ── A6 返回值透传：同步值原样返回，Promise 原样透传 ─────────────────────
    const syncValue = runInHostScope(hostA, () => 42);
    const asyncValue = await runInHostScope(hostA, async () => {
        await sleep(1);
        return 'done';
    });
    check('A6 同步 fn 的返回值原样透传（同步返回，不被包成 Promise）', syncValue === 42, String(syncValue));
    check('A6 async fn 的返回值原样透传', asyncValue === 'done', String(asyncValue));

    // ── A7 host 为 null / undefined 时不进入作用域，默认宿主仍然可见 ────────
    clearActiveHost();
    setActiveHost(hostA);
    try {
        const viaNull = await runInHostScope(null, async () => {
            await sleep(2);
            return getActiveHost();
        });
        const viaUndefined = runInHostScope(undefined, () => getActiveHost());
        check(
            'A7 runInHostScope(null/undefined, fn) 不遮蔽默认宿主，fn 照常执行',
            viaNull === hostA && viaUndefined === hostA,
            `null→${viaNull?.label ?? '（无宿主）'} / undefined→${viaUndefined?.label ?? '（无宿主）'}`
        );
    } finally {
        clearActiveHost();
    }

    // ── A8 参数校验：fn 不是函数立即抛 TypeError ─────────────────────────────
    const bad = await suite.throws(() => runInHostScope(hostA, 'not-a-function'));
    check(
        'A8 runInHostScope(host, 非函数) 抛 TypeError',
        bad !== null && bad.err instanceof TypeError,
        bad?.msg ?? '（没有抛错）'
    );

    // ── A9 作用域宿主不落到默认宿主（作用域退出后没有残留）──────────────────
    await runInHostScope(hostB, async () => {
        await sleep(2);
    });
    check('A9 作用域退出后默认宿主未被写入（getActiveHost() 仍为 null）', getActiveHost() === null);
}

await main();
suite.finish();
