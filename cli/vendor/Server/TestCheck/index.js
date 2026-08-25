/**
 * TestCheck 模块统一导出
 *
 * 外部使用：
 *   import { TestCheck, CheckStatus } from './TestCheck/index.js';
 *   const checker = new TestCheck({ sseHub, storage });
 *   const result = await checker.runCheck({ taskId, taskDir, acceptanceCriteria });
 */

export { TestCheck, CheckStatus } from './TestCheck.js';
export { default } from './TestCheck.js';
