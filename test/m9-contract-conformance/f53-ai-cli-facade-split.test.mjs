/**
 * M9-D `ai-cli` 专项：适配器方法 与 门面方法 的分界线
 *
 * 这条接缝的历史欠账就是"契约把门面方法写成了适配器方法"（`getType`）。所以除了
 * f51 的通用一致性断言外，这里再做一次针对性的逐条对照：
 *
 *   A 契约层面：`methods` 里没有门面自有方法；`facade.own` / `facade.forwarded` 的
 *     分类与 `methods` 自洽（转发项必须也在 methods 里）；
 *   B 提供方层面：**两个** `ai-cli` 提供方（`cli/opencode` / `cli/deveco-code`）都逐条
 *     实测契约 `methods` 的每一项——一条一行 PASS/FAIL，缺了谁一目了然；
 *   C 门面层面：真门面类 `CLIController` 必须暴露契约 `methods` 的全部方法（门面是
 *     完整委派，不能有洞），并且真的自己实现 `facade.own` 里的方法。
 *
 * 全部从契约对象读取，不写死方法名清单：契约增删方法时本文件自动跟随。
 */
import path from 'node:path';
import {
    createOptionValues,
    createSuite,
    disposeProducts,
    imp,
    materialize,
    ROOT,
    withTempDir,
} from './lib/conformance.mjs';

const { PluginHost } = await imp('core/PluginHost.js');
const { SEAMS } = await imp('seams/index.js');

const suite = createSuite('M9-D ai-cli 适配器方法 / 门面方法 分界');
const { check } = suite;

async function main() {
    const contract = SEAMS['ai-cli'];
    if (!contract) {
        check('前置：seams 里存在 ai-cli 契约', false, '缺契约');
        return;
    }
    const methods = contract.methods ?? [];
    const own = contract.facade?.own ?? [];
    const forwarded = contract.facade?.forwarded ?? [];

    // ── A 契约自洽 ───────────────────────────────────────────────────────────
    check('A 契约声明了非空 methods（适配器能力面）', methods.length > 0, `${methods.length} 项`);
    check('A 契约声明了门面自有方法清单 facade.own', own.length > 0, own.join(','));
    const leaked = own.filter((n) => methods.includes(n));
    check('A 门面自有方法没有被写进适配器 methods', leaked.length === 0, leaked.join(',') || '无重叠');
    check('A getType 归门面、不归适配器', own.includes('getType') && !methods.includes('getType'),
        methods.includes('getType') ? 'methods 里仍有 getType（v1 的偏差）' : 'getType 只在 facade.own');
    const badForwarded = forwarded.filter((n) => !methods.includes(n));
    check('A facade.forwarded 里的方法同时也在 methods 里（门面转发＝适配器能力）', badForwarded.length === 0,
        badForwarded.join(',') || forwarded.join(','));

    // ── B 两个提供方逐条实测 ─────────────────────────────────────────────────
    await withTempDir('ai-cli', async (tmpDir) => {
        const host = new PluginHost({ roots: [path.join(ROOT, 'plugins')], env: {} });
        try {
            await host.load({ profile: 'default' });
        } catch (err) {
            check('B 真宿主加载成功（否则没有提供方可对照）', false, `宿主加载失败：${err?.message ?? err}`);
            return;
        }

        const values = createOptionValues({ tmpDir, host });
        try {
            const providers = host
                .list()
                .filter((p) => p.seam === 'ai-cli')
                .map((p) => ({ plugin: p.name, service: `ai-cli@${p.name}` }));
            check('B 至少有一个插件把 seam 声明为 ai-cli', providers.length > 0,
                providers.map((p) => p.plugin).join(',') || '无');

            for (const { plugin, service } of providers) {
                const product = await materialize({ contract, provider: host.inject(service), values });
                try {
                    check(`B ${plugin}：按契约 factory 构造出适配器产物`, product.targets.length > 0,
                        product.violations.join('; ') || 'ok');
                    if (product.targets.length === 0) continue;
                    const target = product.targets[0];
                    for (const name of methods) {
                        check(
                            `B ${plugin} 实现适配器方法 ${name}()`,
                            typeof target[name] === 'function',
                            typeof target[name]
                        );
                    }
                } finally {
                    await disposeProducts(product.products);
                }
            }
        } finally {
            await values.closeAll();
            await host.dispose();
        }
    });

    // ── C 门面类 ─────────────────────────────────────────────────────────────
    let CLIController;
    try {
        ({ CLIController } = await imp('Server/CLI/cli.js'));
        check('C 门面类 CLIController 可加载', typeof CLIController === 'function');
    } catch (err) {
        check('C 门面类 CLIController 可加载', false, `加载失败：${err?.message ?? err}`);
        return;
    }
    const proto = CLIController.prototype;
    const facadeMissing = methods.filter((n) => typeof proto[n] !== 'function');
    for (const name of facadeMissing) check(`C 门面缺少委派方法 ${name}()`, false, '契约 methods 里的方法门面必须完整委派');
    check(`C 门面完整委派契约全部 ${methods.length} 个适配器方法`, facadeMissing.length === 0,
        facadeMissing.join(',') || `${methods.length}/${methods.length}`);

    const ownMissing = own.filter((n) => typeof proto[n] !== 'function');
    for (const name of ownMissing) check(`C 门面自有方法 ${name}() 不存在于 CLIController`, false, 'facade.own 声明了它');
    check(`C 门面真的实现了 facade.own 的全部 ${own.length} 个方法`, ownMissing.length === 0,
        ownMissing.join(',') || own.join(','));

    // 门面自有方法在适配器上**不需要**存在——这正是 v1 的错误：把 getType 当成适配器方法。
    check('C facade.own 里的方法不被当成适配器契约（与 A 同源，这里再确认一次形状）',
        own.every((n) => !methods.includes(n)), own.join(','));
}

await main();
suite.finish();
