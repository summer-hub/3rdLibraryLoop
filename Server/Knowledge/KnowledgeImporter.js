/**
 * Server/Knowledge/KnowledgeImporter.js —— 转发门面（实现已迁入 `plugins/engines/knowledge/`）
 *
 * 导出面前后逐名一致：具名 `KnowledgeImporter` + `default`，且都是插件里那两个
 * **同一个绑定**（`===`），不存在第二份实现。
 *
 * 与 KnowledgeManager 门面不同，这里**不需要**任何兜底登记：KnowledgeImporter 的协作者
 * （cli / storage / knowledgeManager）一律由调用方注入（迁移前唯一的例外是
 * `await import('../CLI/cli.js')` 自建 CLIController，那条路径在插件里改为 fail closed，
 * 见插件实现的 `_getCLI()` 注释）。
 */

export { KnowledgeImporter } from '../../plugins/engines/knowledge/KnowledgeImporter.js';
export { default } from '../../plugins/engines/knowledge/KnowledgeImporter.js';
