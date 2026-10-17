/**
 * Server/Knowledge/KnowledgeManager.js —— 转发门面（实现已迁入 `plugins/engines/knowledge/`）
 *
 * 为什么留这一层：`Server/**` 侧 4 处消费者与既有测试都按老路径 import
 * （`Server/composition/buildApp.js`、`Server/FlexRunner/FlexRunner.js`、
 * `Server/Routes/controllers/KnowledgeImportController.js`、`test/m3/f14-f15`·`f25`），
 * 插件化不该顺手改掉它们的 import。架构守卫只禁止「插件 → Server」方向，
 * 「Server → 插件」是允许的（与 `Server/DbUse/index.js`、`Server/Routes/library/logger.js` 同一形状）。
 *
 * 导出面前后逐名一致：`default`，且**就是插件里那个类对象**（`===` 同一个），
 * 因此 `withSerializedLock` 的 `_chains` 锁表全进程仍只有一份。
 *
 * 本文件不止转发，还多做一件事：**登记无宿主兜底**（见 plugins/engines/knowledge/lib/storageSource.js）。
 * 迁入插件后 `KnowledgeManager.init()` 不能再 import `Server/DbUse/index.js`（R2），
 * 存储实现改由「宿主的 `storage` 接缝 → 本门面登记的内置实现」解析。这里登记的是
 * **惰性加载器**而非函数本身，所以无宿主时与迁移前逐字节等价：第一次 `init()` 才加载存储层，
 * 拿到的仍是同一个 `createStorage`（它自己也是宿主桥，有宿主时照样走接缝）。
 */

import { setStorageFallback } from '../../plugins/engines/knowledge/lib/storageSource.js';

setStorageFallback(async () => (await import('../DbUse/index.js')).createStorage);

export { default } from '../../plugins/engines/knowledge/KnowledgeManager.js';
