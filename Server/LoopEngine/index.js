/**
 * LoopEngine 模块入口
 *
 * 导出：
 *   - LoopEngine（命名导出 + 默认导出）
 *   - LoopStatus（循环状态常量）
 *   - ABORTED_ERROR（大循环终止专用错误，供 Controller/测试识别终止语义）
 */

export { LoopEngine, LoopStatus, ABORTED_ERROR } from './LoopEngine.js';
export { default } from './LoopEngine.js';
