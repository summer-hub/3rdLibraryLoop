/**
 * plugins/cli/opencode/index.js — `ai-cli` 接缝提供方：OpenCode
 *
 * 契约见 `seams/ai-cli.js`（`factory: true`，适配器方法 17 条；门面自有方法见 `facade.own`）。
 * setup 注册两条服务：
 *
 *   ctx.provide('ai-cli', (options) => new OpenCodeCLI({ ...options, archive }))
 *       注册**工厂**而非类/单例：不同调用方要不同的连接配置与不同的归档实例
 *       （`CLIController(type, options)` 每次构造都可能带自己的 options）。
 *       归档（`message-archive` 接缝）在这里补齐——适配器本身不认识任何归档实现，
 *       否则插件就得跨插件 import（arch-guard R2）。
 *
 *   ctx.provide('ai-cli-impl', OpenCodeCLI)
 *       **同族适配器的基类注入点，不是通用接缝**。DevEco Code 与 OpenCode 是同一套
 *       HTTP API（deveco 由 opencode 扩展而来），`cli/deveco-code` 需要 `extends` 这个类，
 *       而插件之间禁止相对 import，因此用「插件依赖 + 限定名注入
 *       `ai-cli-impl@cli/opencode`」把类传过去。它不参与「消费者只依赖裸名」的替换语义：
 *       消费者（CLIController 门面）只用 `ai-cli`。
 *
 * 依赖 `storage/core` 是**真实依赖**（适配器需要归档）：清单里声明后，缺了这个插件
 * 宿主会在拓扑排序阶段就失败；即便清单被改坏，setup 里的 `ctx.inject('message-archive')`
 * 也会立刻抛错——启动期 fail closed，而不是跑到一半才炸。
 *
 * 依赖 `util/logger` 同样是真实依赖：本插件的 `lib/logger.js` 已降级为**无状态委托壳**
 * （原先那份实现副本与 Server 侧各持一个 WriteStream 追加同一个日志文件，见
 * `plugins/util/logger/logger.js` 的文件头），实现由 `app-logger` 接缝提供。
 * setup 里 `ctx.inject('app-logger')` 取不到就在启动期抛错，不会把"日志器未接线"
 * 拖到第一次 `_log()` 才炸。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import { OpenCodeCLI } from './adapter.js';
import { setLoggerImpl } from './lib/logger.js';

// 供 Server 侧门面（Server/CLI/opencode/index.js）逐名再导出类
export { OpenCodeCLI };

export default definePlugin({
    name: 'cli/opencode',
    version: '1.0.0',
    seam: 'ai-cli',
    dependencies: ['storage/core', 'util/logger'],
    setup(ctx) {
        // 启动期就取接缝（失败即 load 抛错）——不要把缺依赖拖到第一次构造适配器时
        const archiveFactory = ctx.inject('message-archive');

        // 静态兜底：让**直接** `new OpenCodeCLI(options)`（不走本插件的工厂）也能拿到本宿主的归档。
        // 回收时复位，避免宿主 dispose / 热替换后把已失效宿主的能力留给后续构造。
        const hadOwnFactory = Object.hasOwn(OpenCodeCLI, 'defaultArchiveFactory');
        const prevFactory = OpenCodeCLI.defaultArchiveFactory;
        OpenCodeCLI.defaultArchiveFactory = archiveFactory;
        ctx.addDisposer(() => {
            if (OpenCodeCLI.defaultArchiveFactory !== archiveFactory) return;
            if (hadOwnFactory) OpenCodeCLI.defaultArchiveFactory = prevFactory;
            else delete OpenCodeCLI.defaultArchiveFactory;
        });

        // 日志器接线：本插件的 `lib/logger.js` 是无状态委托壳（实现已迁入 plugins/util/logger），
        // 这里把 app-logger 接缝工厂交给它。回收时复位，避免宿主 dispose / 热替换后
        // 把已失效宿主的能力留给后续调用（与上面归档静态钩子的处理同形）。
        const prevLoggerFactory = setLoggerImpl(ctx.inject('app-logger'));
        ctx.addDisposer(() => {
            if (prevLoggerFactory) setLoggerImpl(prevLoggerFactory);
        });

        // 工厂里仍显式补齐一次：`options.archive` 最优先，其次本宿主的接缝工厂
        //（与静态钩子等价，但不受"静态字段被后续宿主改写"影响）
        ctx.provide('ai-cli', (options = {}) => new OpenCodeCLI({
            ...options,
            archive: options.archive ?? archiveFactory(options),
        }));

        // 同族适配器基类注入点（约定，非通用接缝）：见本文件头部说明与 seams/ai-cli.js
        ctx.provide('ai-cli-impl', OpenCodeCLI);
    },
});
