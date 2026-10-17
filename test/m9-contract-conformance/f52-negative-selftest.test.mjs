/**
 * M9-C 负向自测：证明上面的套件**不是空转**
 *
 * 一致性套件最危险的失败模式不是"报红太多"，而是"永远绿"：把契约里的字段读漏了、
 * 把产物换成永远成立的判断、或者根本没构造过提供方——都能让一个空壳套件长期全绿。
 * 这一组用**同一份判定逻辑**（`lib/conformance.mjs`）做对照实验：
 *
 *   A 往契约里塞一个不存在的假方法 → 必须报红，且**点名那个假方法**；
 *   B 塞回 v1 里那条历史偏差 `getType` → 必须报红，且点名 `getType`
 *     （它只存在于门面 CLIController，适配器没有）；
 *   C 还原成真契约 → 必须重新变绿（证明 A/B 的红来自那次注入，不是环境噪声）；
 *   D 拿一个空对象当产物 → 缺失条数必须等于契约声明的成员总数
 *     （证明逐条比对真的在逐条走，而不是只看第一项）；
 *   E 往 `storage` 的 `facadeMethods` 塞假键 → 同一套逻辑对 v2 形状同样有效。
 *
 * 只在内存里改写契约对象，**不动磁盘上的 seams/*.js**：套件的检测力靠"同一份判定逻辑
 * 对同一份真实现方实现"证明，不需要把仓库改坏再改回来。
 */
import path from 'node:path';
import {
    createOptionValues,
    createSuite,
    disposeProducts,
    imp,
    materialize,
    memberCount,
    memberViolations,
    ROOT,
    withTempDir,
} from './lib/conformance.mjs';

const { PluginHost } = await imp('core/PluginHost.js');
const { SEAMS } = await imp('seams/index.js');

const suite = createSuite('M9-C 负向自测（契约注入 → 必须报红）');
const { check } = suite;

/** 与真套件完全相同的判定路径：构造产物 → 逐条比对成员 */
async function violationsFor({ host, values, service, contract }) {
    const product = await materialize({ contract, provider: host.inject(service), values });
    try {
        return {
            construction: product.violations,
            members: product.targets.length > 0 ? memberViolations(contract, product.targets, service) : [],
        };
    } finally {
        await disposeProducts(product.products);
    }
}

async function main() {
    await withTempDir('negative', async (tmpDir) => {
        const host = new PluginHost({ roots: [path.join(ROOT, 'plugins')], env: {} });
        try {
            await host.load({ profile: 'default' });
            check('负向自测前置：真宿主加载成功', true, host.loaded.join(','));
        } catch (err) {
            check('负向自测前置：真宿主加载成功', false, `宿主加载失败：${err?.message ?? err}`);
            return;
        }

        const values = createOptionValues({ tmpDir, host });
        try {
            const real = SEAMS['ai-cli'];
            check('前置：契约 ai-cli 存在且以 factory 形状登记', real?.factory === true);
            if (real?.factory !== true) return;

            // ── A 注入一个不存在的假方法 ──────────────────────────────────────
            const fakeName = '__m9_negative_probe__';
            const injected = { ...real, methods: [...real.methods, fakeName] };
            const a = await violationsFor({ host, values, service: 'ai-cli', contract: injected });
            check(
                `A 契约多声明的假方法必须被报出来（${fakeName}）`,
                a.members.length === 1 && a.members[0].includes(fakeName),
                a.members.join(' | ') || '（没有报出任何缺失项 → 套件空转）'
            );

            // ── B 注入 v1 的历史偏差 getType ─────────────────────────────────
            const withGetType = { ...real, methods: [...real.methods, 'getType'] };
            const b = await violationsFor({ host, values, service: 'ai-cli', contract: withGetType });
            check(
                'B 往适配器契约里塞门面方法 getType 必须报红（它只存在于 CLIController）',
                b.members.length === 1 && b.members[0].includes('getType'),
                b.members.join(' | ') || '（没有报出 getType → 契约清算没被真的检验）'
            );
            check('B 现契约（v2）已不含 getType，上面那条红来自本次注入', !real.methods.includes('getType'));

            // ── C 还原真契约 → 必须变绿 ──────────────────────────────────────
            const c = await violationsFor({ host, values, service: 'ai-cli', contract: real });
            check(
                'C 还原成真契约后成员检查重新变绿',
                c.members.length === 0 && c.construction.length === 0,
                [...c.construction, ...c.members].join(' | ') || '0 项缺失'
            );

            // ── D 空对象当产物 → 缺失条数 = 契约成员总数（逐条比对没被短路） ──
            const empty = memberViolations(real, [{}], 'ai-cli');
            check(
                `D 空产物必须逐条报出契约全部 ${memberCount(real)} 项成员`,
                empty.length === memberCount(real) && memberCount(real) > 0,
                `报出 ${empty.length} 条 / 契约声明 ${memberCount(real)} 项`
            );

            // ── E v2 形状（facadeMethods）同样有效 ───────────────────────────
            const storage = SEAMS.storage;
            const storageFake = '__m9_negative_facade__';
            if (storage?.factory === true) {
                const injectedStorage = { ...storage, facadeMethods: [...storage.facadeMethods, storageFake] };
                const e = await violationsFor({ host, values, service: 'storage', contract: injectedStorage });
                check(
                    `E storage 的 facadeMethods 多一个假键必须被报出来（${storageFake}）`,
                    e.members.length === 1 && e.members[0].includes(storageFake),
                    e.members.join(' | ') || '（没有报出任何缺失项 → v2 形状被漏读）'
                );
            } else {
                check('E storage 契约存在且以 factory 形状登记', false, '契约缺失/形状变化');
            }
        } finally {
            await values.closeAll();
            await host.dispose();
        }
    });
}

await main();
suite.finish();
