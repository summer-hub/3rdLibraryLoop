/**
 * FlexRunner 模块统一导出
 *
 * 外部使用：
 *   import { FlexRunner } from './FlexRunner/index.js';
 *   const runner = new FlexRunner();
 *   await runner.initContext({ taskId: 'task-001', ... });
 *   const ok = await runner.executeStart();
 */

export { FlexRunner, ControlType, StepStatus } from './FlexRunner.js';
export { default } from './FlexRunner.js';
