/**
 * M10-C 应用级作用域：withAppHost 用 runInHostScope 包裹 + dispose 语义
 *
 * 这里用的是**真 PluginHost**（空插件根：roots=[] + 空 profile，不加载任何插件、
 * 不读写仓库内文件），为的是验证两条只有真宿主才能验的事实：
 *   1. 作用域内 `getActiveHost()` 就是刚 load 好的那个宿主（root 非 null）；
 *   2. 作用域退出后宿主已被 dispose（`host.root === null`），桥里也不再有它。
 *
 * 另外钉住"不再动全局状态"这个改造要点：外层有默认宿主时，withAppHost 进出都必须
 * 让默认宿主原封不动——旧实现会在 finally 里 clearActiveHost()，把别人的默认宿主清掉。
 */
import { createSuite, fakeHost, impBridge, isInterleaved, observeChain, sleep } from './helpers.mjs';

const bridge = await impBridge('hostBridge.js');
const { clearActiveHost, getActiveHost, hasActiveHost, resolveSeamProvider, setActiveHost } = bridge;
const { createAppHost, withAppHost } = await impBridge('appHost.js');

const suite = createSuite('M10-C withAppHost 作用域化（真宿主 · dispose · 不碰全局状态）');
const { check, throws } = suite;

/** 最小宿主配置：空插件根 + 空 profile，只为拿到一个真实、可 dispose 的 PluginHost */
const MINIMAL = { roots: [], profile: {}, env: {}, logger: () => {} };

async function main() {
    clearActiveHost();
    check('C0 前置：无默认宿主时 getActiveHost() 为 null', getActiveHost() === null);

    // ── C1 作用域内看到的就是这个宿主，且它已 load ──────────────────────────
    const inside = await withAppHost(MINIMAL, async (host) => {
        await sleep(2);
        return {
            host,
            active: getActiveHost(),
            has: hasActiveHost(),
            loaded: host.root !== null,
            seam: resolveSeamProvider('llm'),
        };
    });
    check(
        'C1 withAppHost 内 getActiveHost() 就是该宿主（await 之后仍成立）',
        inside.active === inside.host && inside.has === true,
        `读到 ${inside.active === inside.host ? '同一实例' : '另一个实例'}`
    );
    check('C1 withAppHost 内宿主已 load（root 非 null）', inside.loaded === true);
    check('C1 空宿主没有 llm 接缝 → resolveSeamProvider 为 null（不抛错）', inside.seam === null);

    // ── C2 退出后：桥复位 + 宿主已 dispose ─────────────────────────────────
    check('C2 withAppHost 退出后 getActiveHost() 回到 null', getActiveHost() === null);
    check('C2 withAppHost 退出后宿主已 dispose（host.root === null）', inside.host.root === null);

    // ── C3 返回值透传 ───────────────────────────────────────────────────────
    const returned = await withAppHost(MINIMAL, async () => {
        await sleep(1);
        return 'app-result';
    });
    check('C3 withAppHost 透传 fn 的返回值', returned === 'app-result', String(returned));

    // ── C4 外层默认宿主时：作用域优先，且进出后默认宿主原封不动 ─────────────
    const defaultHost = fakeHost('alpha', { llm: { provider: 'llm/alpha' } });
    setActiveHost(defaultHost);
    try {
        let seen = null;
        const c4Error = await throws(async () => {
            seen = await withAppHost(MINIMAL, async (host) => {
                await sleep(2);
                return { active: getActiveHost(), host };
            });
        });
        check(
            'C4 外层默认宿主=A 时，withAppHost 进出不触发覆盖守卫',
            c4Error === null,
            c4Error?.msg ?? '（未抛错）'
        );
        check(
            'C4 作用域宿主优先于默认宿主',
            seen !== null && seen.active === seen.host,
            `作用域内读到 ${seen?.active === seen?.host ? '真宿主' : '默认宿主'}`
        );
        check(
            'C4 withAppHost 退出后默认宿主仍是 A（旧实现会在这里 clearActiveHost）',
            getActiveHost() === defaultHost,
            `读到 ${getActiveHost()?.label ?? '（无宿主）'}`
        );
    } finally {
        clearActiveHost();
    }

    // ── C5 两个 withAppHost 并发：各自只看自己那份宿主 ─────────────────────
    const order = [];
    const runOne = (tag) =>
        withAppHost(MINIMAL, async (host) => {
            const reads = await observeChain(bridge, 6, () => order.push(tag));
            return { host, reads };
        });
    const [one, two] = await Promise.all([runOne('C5-1'), runOne('C5-2')]);
    const leakOne = one.reads.find((r) => r.host !== one.host);
    const leakTwo = two.reads.find((r) => r.host !== two.host);
    check(
        'C5 两个并发 withAppHost 各自始终读到自己的宿主（6 次读取/链）',
        !leakOne && !leakTwo,
        leakOne || leakTwo ? `第 ${(leakOne ?? leakTwo).step} 次读取读到了另一条链的宿主` : '0 处串味'
    );
    check('C5 两个并发宿主互不相同（不是同一实例）', one.host !== two.host);
    check('C5 前置：两条并发链确实交错执行（不是先后跑完）', isInterleaved(order, 2), order.join(''));
    check('C5 两个宿主退出后都已 dispose', one.host.root === null && two.host.root === null);
    check('C5 并发 withAppHost 退出后 getActiveHost() 为 null', getActiveHost() === null);

    // ── C6 fn 抛错：错误照常上抛，宿主仍被 dispose，桥里不残留 ──────────────
    let capturedHost = null;
    const failed = await throws(async () => {
        await withAppHost(MINIMAL, async (host) => {
            capturedHost = host;
            await sleep(1);
            throw new Error('M10-C 故意失败');
        });
    });
    check('C6 fn 抛错时 withAppHost 照常上抛', failed !== null && failed.msg.includes('M10-C 故意失败'), failed?.msg ?? '（没有抛错）');
    check('C6 fn 抛错时宿主仍被 dispose（host.root === null）', capturedHost?.root === null);
    check('C6 fn 抛错后桥里没有残留活跃宿主', getActiveHost() === null && hasActiveHost() === false);

    // ── C7 createAppHost 保持原语义（只创建不激活）───────────────────────────
    const plain = await createAppHost(MINIMAL);
    try {
        check('C7 createAppHost 返回已 load 的宿主', plain.root !== null);
        check('C7 createAppHost 不设置活跃宿主（桥保持无宿主）', getActiveHost() === null);
    } finally {
        await plain.dispose();
    }
    check('C7 手工 dispose 后 host.root === null', plain.root === null);
}

await main();
suite.finish();
