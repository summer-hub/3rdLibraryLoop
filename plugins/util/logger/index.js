/**
 * plugins/util/logger/index.js — `app-logger` 接缝提供方：全仓库唯一日志实现
 *
 * 契约见 `seams/app-logger.js`。setup 注册一条服务：
 *
 *   ctx.provide('app-logger', (options) => createLogger(options.tag))
 *       注册**工厂**而非单例：消费者（CLI 适配器）既有写法是 `createLogger(tag)`，
 *       按 tag 产出独立的日志器对象；而**文件写入流**被工厂背后的模块级状态唯一持有，
 *       所以「多个日志器」不等于「多份实现」——这正是本插件存在的理由。
 *       实现签名实测为 `createLogger(tag)`（单参），故工厂只透传 `options.tag`。
 *
 * 为什么单列一条接缝（而不是让 `plugins/cli/opencode` 继续自带副本）：
 *   本实现持有模块级可变状态（`_stream` / `_streamDate`）+ 按天轮转 + 保留期清理。
 *   两份副本 = 两个流追加同一个文件、两套轮转各自关流重建、两套清理互相删对方的活文件。
 *   无状态的纯函数可以共享一份实现（`nowCST` 已归一到内核 `core/cstTime.js`），
 *   但**有状态资源不行**：副本数直接等于资源份数。因此 logger 必须接缝化，副本必须删掉。
 *
 * 实现体经 `export *` 透出，供 `Server/Routes/library/logger.js` 逐名转发
 * （门面用 `export * from` 转发，不是重新实现——重新实现会立刻变回第二份流）。
 */

import { definePlugin } from '../../../core/definePlugin.js';
import createLogger from './logger.js';

export * from './logger.js';

export default definePlugin({
    name: 'util/logger',
    version: '1.0.0',
    seam: 'app-logger',
    dependencies: [],
    setup(ctx) {
        // 服务回收由 ctx.provide 自动登记的 disposer 负责（见 core/Context.js）：
        // 本插件不持有可回收的进程级资源（`_stream` 的生命周期由 process 'exit' 兜底），
        // 故 setup 无需返回值。
        //
        // 配置透传：`ctx.config` 是 profile 里 `plugins."util/logger".options` 合并后的结果，
        // 用它做**默认值**；调用方显式传入的同名项优先（?? 只在 undefined/null 时回落）。
        // `rootDir` / `level` 的实现面见 `logger.js` 的 createLogger(tag, options)。
        const conf = ctx.config ?? {};
        ctx.provide('app-logger', (options = {}) =>
            createLogger(options.tag, {
                rootDir: options.rootDir ?? conf.rootDir,
                level: options.level ?? conf.level,
            })
        );
    },
});
