/**
 * Server/Distributed/Semaphore.js —— **转发门面**（实现已迁至 `plugins/distributed/core/Semaphore.js`）
 *
 * 本文件只做两件事：`export * from` 再导出实现体的全部具名导出、`export { default } from`
 * 再导出它的 default。由此保证：
 *   - 既有 import 路径（`test/m7-phase4/f39`、`f40`、`f41` 与本目录内部）**零改动**；
 *   - 门面的导出与插件实现是**同一批对象**（`===`），全仓库只有一份 `Semaphore` 的实现，
 *     不存在"门面一份、插件一份"的双实现。
 *
 * 门面里**不得**写任何有状态的实现（含"顺手加一个便捷函数"）：那会让同一能力出现第二个
 * 语义来源，而 m7 的断言只覆盖门面路径，分叉会在插件路径上静默发生。新增导出请只改实现体。
 *
 * 为什么要到这里还不删门面：`Server/Distributed/` 是既有的稳定入口（进程启动路径
 * `node Server/Distributed/bootstrap.js` 就写在这里，见 `deploy/` 的三份清单），
 * 删除它等于同时改部署产物与 10 个测试的 import 路径——那是另一件事。
 */

// 副作用 import：登记四条接缝的**无宿主兜底**（见 internal/registerDistributedFallback.js）。
// 登记在每个门面而不是只在 barrel：消费者可能只 import 深层路径（m7 直接 import Lease.js），
// 只登记一处会出现"宿主在、但没有任何 barrel 被 import 过"的空槽。
import './internal/registerDistributedFallback.js';

export * from '../../plugins/distributed/core/Semaphore.js';
export { default } from '../../plugins/distributed/core/Semaphore.js';
