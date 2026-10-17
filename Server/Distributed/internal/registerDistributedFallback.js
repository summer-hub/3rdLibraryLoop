/**
 * Server/Distributed/internal/registerDistributedFallback.js —— 装配层登记：四条接缝的无宿主兜底
 *
 * 为什么需要这个文件：`plugins/distributed/core` 自己**不消费**它注册的四条接缝——消费者是
 * 别处的装配（未来的编排/服务装配插件、`Server/**` 门面链上的调用方）。而插件之间不得互相
 * import（架构守卫 R2），所以"无宿主时用哪份实现"只能由**装配层**登记：
 * `plugins/distributed/core/lib/seamSource.js` 的第 2 档就等这张表。
 *
 * 为什么登记**加载器**而不是类（与 `Server/Agent/internal/registerFlexRunnerFallback.js` 同形）：
 * 保持"第一次真正要用这个能力时才解析"的时机，且这张表是本插件唯一的跨层登记点——
 * 只写一处，改路径只改这里；分散写在 10 个门面里会让"哪些文件会登记"变成需要全文搜索才能
 * 知道的隐形契约。
 *
 * 为什么登记点是**每一个** `Server/Distributed/*.js` 门面（import 期副作用）：
 *   - 消费者可能只 import 深层路径（m7 f39 直接 `import('Server/Distributed/Lease.js')`，
 *     根本不经过目录 barrel）。若只在 `index.js` 登记，"宿主在、但没有 barrel 被 import 过"
 *     就会出现一个空槽；
 *   - 每个门面本来就已经静态再导出同一个实现体，这里的动态 `import()` 只是模块缓存命中，
 *     不会额外加载任何东西，也不改变启动时机。
 *
 * 幂等：`setDistributedFallback` 是"先登记先赢"（`??=` 语义），重复 import 无副作用。
 * 正常部署下 10 个门面指向**同一批模块实例**，所以第 2 档与第 1 档解析到 `===` 相同的类。
 */

import {
    setDistributedFallbacks,
} from '../../../plugins/distributed/core/lib/seamSource.js';

setDistributedFallbacks({
    'distributed-lease': async () => (await import('../../../plugins/distributed/core/Lease.js')).LeaseStore,
    'distributed-queue': async () => (await import('../../../plugins/distributed/core/Queue.js')).MessageQueue,
    'distributed-tokens': async () =>
        (await import('../../../plugins/distributed/core/Semaphore.js')).DistributedSemaphore,
    'distributed-observer': async () => (await import('../../../plugins/distributed/core/Trace.js')).Tracer,
});
