/**
 * Server/TestCheck/index.js —— 统一导出（**转发门面**，实现已迁入 `plugins/engines/testcheck/`）
 *
 * 外部使用（与迁移前逐名一致）：
 *   import { TestCheck, CheckStatus } from './TestCheck/index.js';
 *   const checker = new TestCheck({ sseHub, storage });
 *   const result = await checker.runCheck({ taskId, taskDir, acceptanceCriteria });
 *
 * 本文件是纯转发：导出面与迁移前逐名一致（含 default），且解析到**同一批模块实例**
 * （`=== ` 插件里的 `TestCheck` / `CheckStatus`），不存在第二份实现。
 *
 * 四条无宿主兜底（llm / storage / cli / skillSelector）的登记在 `./TestCheck.js`——
 * 因为"import 门面"在既有代码里两种写法都有（`from './TestCheck/index.js'` 与
 * `from '../TestCheck/TestCheck.js'`），登记点选在**两条路径都必经**的那个文件上。
 */

export { TestCheck, CheckStatus } from './TestCheck.js';
export { default } from './TestCheck.js';
