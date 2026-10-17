/**
 * envBootstrap —— `Server/.env` 的唯一加载点
 *
 * 为什么单独抽出来：这段逻辑原来内联在 `Server/CLI/cli.js` 的模块顶层，
 * 属于**隐式副作用**——任何 import 了 CLI 门面的模块都会顺带改进程环境变量，
 * 读代码看不出来。装配点（`buildApp.js`）才是最合理的引导位置：它本来就是
 * "把依赖接起来"的地方，环境变量属于同一件事。
 *
 * 行为与迁移前逐字等价（原逻辑原样搬入）：
 *   - dotenv 是**可选依赖**：未安装时 `import('dotenv')` 抛错，被 catch 吞掉后跳过
 *     （纯 mock 测试 / 没装可选依赖的部署形态仍然能跑）；
 *   - `Server/.env` 不存在时 `dotenv.config()` 只是返回 `{ error }`，不抛错、不改变环境；
 *   - dotenv 默认**不覆盖**已存在的环境变量，因此 shell export / `--type` 参数
 *     的优先级仍高于 `.env`（优先级链见 `Server/CLI/AGENTS.md`）。
 *
 * 幂等：模块级标记保证同一进程内只真正加载一次。装配点（`buildApp.js`）与
 * `Server/CLI/test.js` 等入口都会调它，双调不会重复读文件、也不会重复打日志。
 *
 * ## 与 CLI 三层 env 链的关系（谁优先，谁让路）
 *
 * CLI（`cli/lib/config.js` 的 `loadEnvChain`）在**任何**核心引擎 import 之前加载三层链：
 * 系统环境变量 > `~/.3lib/.env` > 项目 `Server/.env`，加载完调 `markServerEnvLoaded()`
 * 告诉本文件"`Server/.env` 已经按更高优先级处理过了"。此后 `loadServerEnv()` 立即
 * 返回 `false`（不重复加载），于是同一份 `.env` 不会被两个加载器各读一次。
 *
 * 方向是单向的：`cli → Server`（CLI 主动登记）。本文件**不 import 任何 cli/ 模块**——
 * Server 反向依赖 cli 会破坏"Server 可独立部署"的边界。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `Server/.env`（本文件在 `Server/composition/` 下，上溯一级即 `Server/`） */
const ENV_FILE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '.env'
);

/** @type {Promise<void>|null} 已启动的加载过程；null = 尚未加载过 */
let _loading = null;

/** 外部署记：`true` = CLI 三层链已加载过 env，本文件不应再读 `Server/.env` */
let _delegated = false;

async function _load() {
    try {
        const dotenv = (await import('dotenv')).default;
        dotenv.config({ path: ENV_FILE });
    } catch {
        // dotenv 未安装或 .env 不存在，跳过
    }
}

/**
 * 登记「env 已由外部（CLI 三层链）按更高优先级加载完毕」。
 *
 * 语义：让 `Server/.env` **不再被读第二次**。调用方负责保证优先级顺序
 * （系统 env > `~/.3lib/.env` > 项目 `Server/.env`），本文件不校验、不加载。
 *
 * 幂等：重复调用只有第一次返回 `true`。
 *
 * @returns {boolean} `true` = 本次调用登记成功；`false` = 之前已登记过
 */
export function markServerEnvLoaded() {
    if (_delegated) return false;
    _delegated = true;
    return true;
}

/**
 * 加载 `Server/.env`（幂等）。
 *
 * @returns {Promise<boolean>} `true` = **本次调用**真的执行了加载；`false` = 之前已加载过
 *   （复用），或 CLI 已登记外部加载（`markServerEnvLoaded()`）——两种情况都不重复读文件
 */
export function loadServerEnv() {
    if (_delegated) return Promise.resolve(false);
    if (_loading) return _loading.then(() => false);
    _loading = _load();
    return _loading.then(() => true);
}

export default loadServerEnv;
