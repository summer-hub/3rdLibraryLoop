/**
 * Server/composition/hostBridge —— 「当前活跃插件宿主」桥的**转发门面**
 *
 * 实现在 `core/hostBridge.js`（内核模块），本文件只剩一行再导出。
 *
 * 为什么搬家：活跃宿主是**宿主模型的运行时状态**，与业务无关；而插件必须能解析宿主接缝，
 * 架构守卫 R2 又禁止插件引用 `Server/`（只允许 `node:` / npm 包 / `core/` / `seams/` /
 * 自身目录）。留在 `Server/` 里插件永远看不见，所以实现进内核。
 *
 * 为什么保留这个门面：这里是既有消费者的稳定入口（`Server/composition/*`、`Server/DbUse`、
 * `Server/CLI/*`、`Server/Agent`、`Server/Brain`、`Server/TestCheck`、`cli/lib/runner.js`、
 * `test/m10-host-scope/**`）。`export *` 让它们零改动，并且两边解析到**同一个模块实例**
 * ——同一份状态，不存在「两份 setActiveHost 各存一份」的裂缝。
 *
 * 注意：本文件是纯转发，不要在这里加任何有状态的实现（默认宿主必须是单例）。
 * 新增导出请只改 `core/hostBridge.js`。
 */

export * from '../../core/hostBridge.js';
