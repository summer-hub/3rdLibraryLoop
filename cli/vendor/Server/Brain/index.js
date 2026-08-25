/**
 * Brain 模块统一导出
 *
 * 外部使用：
 *   import { Brain, BrainStatus } from './Brain/index.js';
 *   const brain = new Brain({ sseHub, storage });
 *   const plan = await brain.planTask('对 libcurl 进行鸿蒙化分析');
 */

export { Brain, BrainStatus } from './Brain.js';
export { default } from './Brain.js';
