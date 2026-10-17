/**
 * core/cstTime.js —— 北京时间格式化原语（`nowCST`）
 *
 * ① 它是**纯函数原语**：无状态、无依赖、无资源，输入 epoch 毫秒/Date/ISO 字符串
 *    （或不传取当前时刻），输出 `+08:00` 偏移的 ISO 8601 字符串。实现体从
 *    `plugins/storage/core/lib/cstTime.js` 逐字节搬入，逻辑一行未改。
 *
 * ② 为什么进内核：5 个插件（storage/core、cli/opencode、engines/{knowledge,brain,
 *    testcheck}）都需要它，而 arch-guard 的 R2 既禁止插件互相引用、也禁止插件引用
 *    `Server/`。可选路径只有三条：继续复制（副本数随插件数线性增长，且每加一份都要
 *    同步守卫路径）、为 16 行纯函数立一条接缝（插件目录 + 清单 + 拓扑依赖 + 每次调用
 *    经 `ctx.inject`，把纯函数变成有接线顺序要求的东西）、或把纯函数放进内核。
 *    「内核提供一个纯函数原语」是一次性消掉全部副本的最便宜做法：R2 本来就允许插件
 *    引用 `core/`，消费者一句 `import { nowCST } from '../../../core/cstTime.js'` 即可，
 *    全仓库只剩一份实现，也不再需要"多份副本行为等价"这种守卫。
 *
 * ③ 它遵守 R1（`scripts/arch-guard.mjs`）：内核文件只允许 import `node:` 内置与同目录
 *    `./`。本文件**一条 import 都没有**，只用全局 `Date`，因此在 R1 下天然合规。
 *
 * 兼容：`Server/library/cstTime.js` 仍是转发门面（导出面不变），Server 侧 20 余处
 * 消费者的相对路径无需改动。
 *
 * @param {number|Date} [input] - epoch 毫秒或 Date 对象，不传则取当前时间
 * @returns {string} 如 "2026-07-27T15:12:08.774+08:00"
 */
export function nowCST(input) {
    const d = input != null ? new Date(input) : new Date();
    return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
        .replace(' ', 'T') + '+08:00';
}

export default nowCST;
