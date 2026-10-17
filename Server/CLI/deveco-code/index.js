/**
 * Server/CLI/deveco-code/index.js — 再导出门面（实现已迁入插件 `plugins/cli/deveco-code/`）
 *
 * 导出面与迁移前逐名一致：`default` 仍是 DevEcoCodeCLI 类（另加同名命名导出）。
 *
 * 与 opencode 门面的两处差别，都是"无宿主"时插件 setup 不会执行所导致的必要接线：
 *
 *   1. **基类绑定**：插件模块顶层不得 import 其它插件（arch-guard R2），因此
 *      `DevEcoCodeCLI` 的基类（`plugins/cli/opencode` 的 OpenCodeCLI）是迟到绑定的：
 *      有宿主由插件 setup 用 `ctx.inject('ai-cli-impl@cli/opencode')` 绑定，无宿主就是这一行。
 *      `wireDevEcoBase` 幂等（同一个 Base 重复绑定无副作用；换 Base 会抛错）。
 *   2. **归档兜底工厂**：写到 `DevEcoCodeCLI` 的**自有**静态属性上（不是基类那份），
 *      两个类各有一份、互不覆盖。
 *   3. **日志器兜底接线**：委托壳 `plugins/cli/opencode/lib/logger.js` 需要在启动期被
 *      指向 `app-logger` 接缝实现。正常部署里 `Server/CLI/cli.js` 会先加载 opencode 门面
 *      完成接线；但只 import 本门面（或 `Server/CLI/deveco-code.js`）时也必须能记日志，
 *      所以这里再接一次——接到的是同一个模块实例，重复接线无副作用。
 */

import MessageArchive from '../../DbUse/MessageArchive.js';
import { resolveMessageArchiveFactory } from '../../composition/hostBridge.js';
import { OpenCodeCLI } from '../../../plugins/cli/opencode/index.js';
// 注意取的是**具名导出**的类：插件入口的 default 是 definePlugin 定义（宿主用），不是类
import { DevEcoCodeCLI, wireDevEcoBase } from '../../../plugins/cli/deveco-code/index.js';
import { setLoggerImpl } from '../../../plugins/cli/opencode/lib/logger.js';
import createLogger from '../../Routes/library/logger.js';

wireDevEcoBase(OpenCodeCLI);

/**
 * 无宿主兜底归档工厂（同 opencode 门面）：宿主有 `message-archive` 就用接缝工厂，
 * 否则内置 `MessageArchive`。挂在子类自有属性上，不影响 `OpenCodeCLI`。
 * @param {object} options
 * @returns {object} 归档实例
 */
DevEcoCodeCLI.defaultArchiveFactory = (options) => {
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

export { DevEcoCodeCLI };
export default DevEcoCodeCLI;
