/**
 * Server/CLI/opencode/index.js — 再导出门面（实现已迁入插件 `plugins/cli/opencode/`）
 *
 * 为什么留这一层：`cli.js` / `opencode.js` / `Server/CLI/test.js` 与既有的部署脚本都按
 * 这个路径 import，插件化不该顺手改掉它们的 import；而架构守卫只禁止「插件 → Server」
 * 方向，「Server → plugins」是允许的（与 `Server/Agent/SkillSelector/llm/llmClient.js`、
 * `Server/DbUse/*.js` 同一形状）。
 *
 * 导出面与迁移前**逐名一致**：`default` 仍是 OpenCodeCLI 类；另加一个同名命名导出，
 * 供门面/插件按具名方式取用（同一类对象，不是副本）。
 *
 * 除了再导出，本文件还有**两处无宿主兜底接线**（有宿主时都由插件 setup 接，见
 * `plugins/cli/opencode/index.js`）：
 *
 *   1. 归档（下面这段）：适配器自己不认识任何归档实现
 * （插件不得跨插件 import），历史上它内部 `new MessageArchive()` 的能力改由类上的
 * `defaultArchiveFactory` 静态钩子提供。有宿主时这个钩子由插件 setup 挂成
 * `message-archive` 接缝的工厂；无宿主（= 默认部署形态、以及 `new OpenCodeCLI()` 这种
 * 文档里公开的快捷用法）就由这里挂内置实现，行为与迁移前一致。
 *   2. 日志器（文件末尾）：`plugins/cli/opencode/lib/logger.js` 是**无状态委托壳**
 *      （原实现副本已删除，实现迁入 `plugins/util/logger`，两处向同一个日志文件追加的
 *      WriteStream 因此合流）。委托目标由 `app-logger` 接缝提供；无宿主时就接
 *      `Server/Routes/library/logger.js` —— 那份文件只是插件实现的转发门面，
 *      同一个模块实例。
 */

import MessageArchive from '../../DbUse/MessageArchive.js';
import { resolveMessageArchiveFactory } from '../../composition/hostBridge.js';
import { OpenCodeCLI } from '../../../plugins/cli/opencode/index.js';
import { setLoggerImpl } from '../../../plugins/cli/opencode/lib/logger.js';
import createLogger from '../../Routes/library/logger.js';

/**
 * 无宿主兜底归档工厂：有宿主且宿主提供 `message-archive` 就用接缝工厂，
 * 否则用内置 `MessageArchive`（等价于迁移前的 `new MessageArchive()`）。
 * 显式 `options.archive` 永远优先级更高（由适配器构造函数保证）。
 * @param {object} options
 * @returns {object} 归档实例
 */
OpenCodeCLI.defaultArchiveFactory = (options) => {
    const factory = resolveMessageArchiveFactory(null);
    return factory ? factory(options) : new MessageArchive(options);
};

/**
 * 无宿主日志接线：插件的 `lib/logger.js` 已降级为**无状态委托壳**（实现迁入
 * `plugins/util/logger`，见该文件头），委托目标由 `app-logger` 接缝提供。
 * 有宿主时由 `plugins/cli/opencode` 的 setup 接线；无宿主（= 默认部署形态、
 * 以及 `new CLIController()` / `new OpenCodeCLI()` 这类不经宿主的用法）就是这一行。
 *
 * 指向 `Server/Routes/library/logger.js`：它只是 `plugins/util/logger/logger.js` 的
 * **转发门面**（`export *`），同一个模块实例 —— 因此这里接的是唯一那份实现，
 * 不会凭空造出第二个 WriteStream。
 */
setLoggerImpl((options = {}) => createLogger(options?.tag));

export { OpenCodeCLI };
export { OpenCodeCLI as default };
