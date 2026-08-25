/**
 * exit-codes.js —— 退出码约定
 *
 * 退出码语义（脚本消费方核心契约）：
 *   0    通过 / 成功
 *   1    错误（参数错误 / 环境不满足 / 任务不存在 / 通用失败）
 *   2    任务执行失败（终态为 failed / error / not passed）
 *   3    wait 超时（任务在 --timeout 内未到终态）
 *   130  SIGINT（Ctrl+C）
 *   143  SIGTERM
 *
 * CI / 管道使用方按此约定判断任务结果，与 stdout/stderr 分离策略配套。
 */
export const EXIT = Object.freeze({
    OK: 0,
    ERROR: 1,
    TASK_FAILED: 2,
    TIMEOUT: 3,
    SIGINT: 130,
    SIGTERM: 143,
});

/** 大循环终态状态集合（用于判断任务是否已结束） */
export const TERMINAL_LOOP_STATES = Object.freeze([
    'passed', 'failed', 'aborted', 'error',
]);

/** 大循环运行中状态集合 */
export const ACTIVE_LOOP_STATES = Object.freeze([
    'idle', 'planning', 'executing', 'checking',
]);