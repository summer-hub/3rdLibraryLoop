/**
 * M9-B 提供方一致性：真宿主 · 真构造 · 逐条对照
 *
 * 这是本里程碑的主断言：**不用静态 grep**，而是把真插件加载进真宿主，对
 * `host.listServices()` 报出的每个 `{service, provider}` 做三件事——
 *
 *   1. 按该接缝的契约**真构造**一次产物（`factory: true` 就调工厂，把
 *      `factoryOptions` 里声明的键全部给上；`factory: false` 就先看类本体的静态
 *      能力面，不够再按契约 `options` 实例化一次）；
 *   2. 在产物/类/对象上逐条核对契约声明的成员（`methods` / `facadeMethods` /
 *      `properties`），缺哪条就打印哪条；
 *   3. 用完回收（产物有 `close()` 就调），临时目录走 `os.tmpdir()`，仓库里不留痕。
 *
 * 覆盖两档：
 *   A 裸名服务 —— 当前生效的提供方（后注册者生效）；
 *   B 限定名服务 `seam@plugin` —— 每个 plugin.json 声明了 `seam` 的插件都必须真的
 *     `provide` 出这条服务（否则清单在说谎），且该提供方同样符合契约。
 *     这一档是必须的：`ai-cli` 被 `cli/opencode` 与 `cli/deveco-code` 同时提供，
 *     裸名只有最后一个，限定名才能把两个提供方都验一遍。
 */
import path from 'node:path';
import {
    constantChecks,
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

const suite = createSuite('M9-B 提供方一致性（真宿主 · 动态发现）');
const { check } = suite;

/**
 * 校验一个提供方：构造 + 成员逐条比对 + 回收。
 * @param {{host: object, values: object, service: string, provider: string, contract: object, via: string}} args
 */
async function checkProvider({ host, values, service, provider, contract, via }) {
    const label = `${service}（提供方 ${provider} / ${via}）`;
    const optionKeys = contract.factory === true ? (contract.factoryOptions ?? []) : (contract.options ?? []);
    const impl = host.inject(service);
    const product = await materialize({ contract, provider: impl, values });

    try {
        for (const violation of product.violations) check(violation, false, '构造阶段');
        const shapeOk = product.violations.length === 0 && product.targets.length > 0;
        // factory: false 且没实例化 = 能力面全在类的静态方法上（`stats` 就是这种）
        const staticOnly = contract.factory !== true && product.products.length === 0;
        const detail = staticOnly
            ? '类本体即能力面（静态方法），无需实例化'
            : `接受 ${optionKeys.length} 个构造入参键（${optionKeys.join(',') || '无'}）`;
        check(
            `${label} 按契约 ${product.shape} 形状取到可用产物`,
            shapeOk,
            shapeOk ? detail : product.violations.join('; ')
        );
        if (!shapeOk) return;

        const total = memberCount(contract);
        const missing = memberViolations(contract, product.targets, label);
        // 逐条报告缺失项：一条一行，文案里点名具体成员（负向自测正是据此判定"报出了哪个"）
        for (const violation of missing) check(violation, false, '契约声明 vs 实现');
        check(
            `${label} 具备契约全部 ${total} 项成员（methods/facadeMethods/properties）`,
            missing.length === 0,
            missing.length > 0 ? `缺 ${missing.length} 项` : `${total}/${total}`
        );

        // 契约 `constants`：提供方**类**上必须有这些冻结常量表（存在 / 是对象 / 已冻结）。
        // 这是"状态常量表跨插件交付"的机器判定：缺一档就红并点名，绝不放行。
        // 未声明 constants 的接缝在这里贡献 0 条断言（不制造"永远成立"的空转断言）。
        for (const v of constantChecks(contract, impl, label)) check(v.title, v.ok, v.detail);
    } finally {
        await disposeProducts(product.products);
    }
}

async function main() {
    await withTempDir('providers', async (tmpDir) => {
        const host = new PluginHost({ roots: [path.join(ROOT, 'plugins')], env: {} });
        try {
            const res = await host.load({ profile: 'default' });
            check(
                '真宿主以 profile=default 加载成功',
                Array.isArray(res.loaded) && res.loaded.length > 0,
                res.loaded.join(',')
            );
        } catch (err) {
            // 宿主起不来就没有"提供方实现"可对照——如实报红，不静默跳过（否则套件会空转）
            check('真宿主以 profile=default 加载成功', false, `宿主加载失败：${err?.message ?? err}`);
            return;
        }

        const values = createOptionValues({ tmpDir, host });
        const services = host.listServices();
        check(
            'listServices() 报出至少 1 条注册服务',
            services.length > 0,
            services.map((s) => `${s.service}@${s.provider}`).join(', ')
        );

        try {
            // ── A 裸名服务：当前生效的提供方 ──────────────────────────────────
            for (const { service, provider } of services) {
                const contract = SEAMS[service];
                if (!contract) {
                    // 没有契约声明的服务是**约定/内部注入点**（例如 ai-cli 的同族基类
                    // 注入点 ai-cli-impl，见 seams/ai-cli.js 头注释），不在本套件判定范围。
                    check(`服务 ${service}（提供方 ${provider}）无契约声明 —— 约定/内部注入点，跳过`, true, '信息项');
                    continue;
                }
                await checkProvider({ host, values, service, provider, contract, via: '裸名' });
            }

            // ── B 限定名服务：manifest 声明了 seam 的插件必须真的 provide 出来 ──
            for (const plugin of host.list()) {
                if (!plugin.seam) continue;
                const contract = SEAMS[plugin.seam];
                check(`插件 ${plugin.name} 在 plugin.json 声明的 seam '${plugin.seam}' 有契约文件`, Boolean(contract));
                if (!contract) continue;
                const qualified = `${plugin.seam}@${plugin.name}`;
                check(`限定名服务 ${qualified} 已注册（清单声明的 seam 真的被 provide 出来）`, host.has(qualified));
                if (!host.has(qualified)) continue;
                await checkProvider({
                    host,
                    values,
                    service: qualified,
                    provider: plugin.name,
                    contract,
                    via: '限定名',
                });
            }
        } finally {
            await values.closeAll();
            await host.dispose();
        }
    });
}

await main();
suite.finish();
