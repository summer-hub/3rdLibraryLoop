/**
 * Server/library/cstTime.js — 转发门面（实现已迁入内核 `core/cstTime.js`）
 *
 * 为什么在内核：`nowCST()` 是 16 行无状态纯函数，被 5 个插件
 * （storage/core、cli/opencode、engines/{knowledge,brain,testcheck}）与 Server 侧共用。
 * arch-guard 的 R2 既禁止插件互相引用、也禁止插件引用 `Server/`，而允许插件引用 `core/`——
 * 所以纯函数放进内核是唯一既能消灭全部副本、又不需要为 16 行代码立接缝的落点。
 *
 * 导出面与迁移前一致：`nowCST`（命名导出）+ default（同一函数），
 * 门面与内核是**同一个函数对象**（`export *` 再导出，不是第二份实现）。
 * 20 余处消费者（Brain / FlexRunner / Distributed / Orchestrator …）路径不变。
 */

export * from '../../core/cstTime.js';
export { default } from '../../core/cstTime.js';
