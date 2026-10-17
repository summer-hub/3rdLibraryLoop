/**
 * plugins/cli/deveco-code/index.js — `ai-cli` 接缝提供方：DevEco Code
 *
 * 对接华为开源的 DevEco Code（https://gitcode.com/openharmony-sig/deveco-code），
 * 面向 HarmonyOS 开发场景的 AI Agent 工具（npm 包 @deveco/deveco-code）。
 *
 * DevEco Code 基于开源项目 OpenCode 扩展开发，其 headless 服务（`deveco serve`）
 * 保留与 opencode 完全一致的 HTTP API（/session、/session/{id}/message、
 * /session/{id}/prompt_async、/session/status 等），因此本适配器直接继承 OpenCodeCLI，
 * 复用其全部 Session 管理逻辑，仅覆盖连接配置与身份标识：
 *
 *   - 环境变量：DEVECO_HOST / DEVECO_PORT（优先级低于 options.host / options.port）
 *   - 默认端口：4096（与 opencode 一致，两者同一时间只运行一个，无需改端口配置；
 *     若需与 opencode 服务同时运行，可通过 DEVECO_PORT 指定其他端口）
 *   - 存档 meta.cliType：'deveco-code'
 *
 * ── 为什么基类是「迟到绑定」而不是模块顶层 `extends Base` ──────────────────
 * 同族基类由 `cli/opencode` 插件提供（`ai-cli-impl@cli/opencode`），本插件**依赖**它。
 * 但 arch-guard R2 禁止跨插件的相对 import，模块顶层拿不到那个类；而本插件又必须
 * 导出一个可在**无宿主**时被 Server 门面直接 `new` 的类（那时没人跑 setup 注入）。
 * 因此类的 [[Prototype]] 在 `wireDevEcoBase(Base)` 之前指向占位基类，之后指向真正的
 * 基类：两条入口各绑一次——
 *   - 有宿主：`setup(ctx)` 里用 `ctx.inject('ai-cli-impl@cli/opencode')`（限定名，与加载
 *     顺序无关）拿到类再绑定；
 *   - 无宿主：`Server/CLI/deveco-code/index.js` 门面（Server → plugins 方向允许）绑定。
 * 正常部署下两个入口拿到的是同一个类对象（同一个插件模块实例），绑定是幂等的。
 *
 * 服务启动方式：
 *   deveco serve            （默认即监听 4096）
 *   deveco serve --port X   （需共存/端口冲突时显式指定）
 *   （注意：`deveco serve` 在 4096 被占用且未指定 --port 时会随机分配端口）
 *
 * @example
 * const cli = new CLIController('deveco-code');  // 连接 localhost:4096
 * await cli.checkHealth();
 */

import { definePlugin } from '../../../core/definePlugin.js';

/** 基类未绑定时的占位基类：走到它的 `constructor` 说明绑定缺失，那时已经先抛错 */
class UnboundBase {}

export class DevEcoCodeCLI extends UnboundBase {
    /** 存档 meta.cliType 标识 */
    static _cliType = 'deveco-code';

    /** 日志器名称 */
    static _loggerName = 'DevEcoCodeCLI';

    /** 已绑定的同族基类（`ai-cli-impl@cli/opencode` 提供的 OpenCodeCLI）；null = 未绑定 */
    static _base = null;

    /**
     * @param {object} options
     * @param {string} [options.host]    - deveco 服务主机（默认 DEVECO_HOST 或 localhost）
     * @param {string} [options.port]    - deveco 服务端口（默认 DEVECO_PORT 或 4096）
     * @param {string} [options.baseUrl] - 完整 baseUrl，优先级高于 host/port
     * @param {object} [options.archive] - 消息存档实例（`message-archive` 接缝产物，必填）
     */
    constructor(options = {}) {
        if (!DevEcoCodeCLI._base) {
            throw new Error(
                'DevEcoCodeCLI：同族基类尚未绑定 —— 插件模式下由 setup 注入 ai-cli-impl@cli/opencode；' +
                    '无宿主时由 Server/CLI/deveco-code 门面调用 wireDevEcoBase() 绑定'
            );
        }
        super({
            ...options,
            host: options.host || process.env.DEVECO_HOST || 'localhost',
            port: options.port || process.env.DEVECO_PORT || '4096'
        });
        // cliType / _loggerName 已通过 static 覆盖，在父类构造期间即正确初始化
    }

    // ─── 运行状态检查 ──────────────────────────────────────────────────────────

    /**
     * 检查 deveco 服务是否正常运行（复用父类轻量健康检查逻辑，仅覆盖提示文案）
     */
    async checkHealth() {
        try {
            await this.client.session.list();
            return { status: 'ok', message: 'DevEco Code CLI is healthy', target: this.baseUrl };
        } catch (error) {
            this._log('warn', `checkHealth: 连接失败 — ${error.message}`);
            return {
                status: 'error',
                message: `Health check failed: ${error.message}`,
                error: error.message
            };
        }
    }
}

/**
 * 绑定同族基类（`OpenCodeCLI`）。
 *
 * **同一 Base 重复绑定是幂等的；换一个 Base 则抛错**——这是刻意拒绝的操作，
 * 不是疏漏：原型链是**类级**共享状态，一旦中途改指向，先构造的实例仍按旧链、
 * 后构造的按新链，多宿主 / 多测试并存时就会出现"同一个类造出两种对象"的跨宿主污染
 * （R2 也保证了正常部署下两个入口拿到的是同一个类对象，这条错误分支只在真正
 * 配错/拔错插件时出现）。真要换基类，请在新的进程/模块实例里做。
 *
 * 为什么用 `setPrototypeOf` 而不是 `extends`：模块顶层禁止 import 其它插件（R2），
 * 而类又必须在无宿主时可直接 `new`——只能在拿到类之后把原型链接上去。
 * 绑定的效果与 `class DevEcoCodeCLI extends Base {}` 等价：
 *   - `Object.setPrototypeOf(DevEcoCodeCLI, Base)` → 构造函数里的 `super()` 与静态继承；
 *   - `Object.setPrototypeOf(DevEcoCodeCLI.prototype, Base.prototype)` → 实例方法与 `instanceof`。
 *
 * @param {Function} Base - 同族基类（必须是构造函数，通常是 `OpenCodeCLI`）
 * @returns {typeof DevEcoCodeCLI} 绑定后的类
 * @throws {TypeError} Base 不是函数时
 * @throws {Error} 已经绑定到**另一个** Base 时（换基类会污染已存在的实例，拒绝执行）
 */
export function wireDevEcoBase(Base) {
    if (typeof Base !== 'function') {
        throw new TypeError(`DevEcoCodeCLI：基类必须是构造函数，收到 ${typeof Base}`);
    }
    if (DevEcoCodeCLI._base === Base) return DevEcoCodeCLI; // 幂等：同一个类重复绑定无副作用
    if (DevEcoCodeCLI._base) {
        // 拒绝换基类：见函数头说明（类级共享状态，改指向会让旧实例与新实例走不同原型链）
        throw new Error(
            'DevEcoCodeCLI：基类已绑定到 ' + DevEcoCodeCLI._base.name + '，拒绝改为 ' + Base.name +
                ' —— 原型链是类级共享状态，中途换基类会让已构造的实例与新实例继承不同实现' +
                '（多宿主/多测试并存时会互相污染）。换基类请在新进程/新模块实例里做。'
        );
    }
    Object.setPrototypeOf(DevEcoCodeCLI, Base);
    Object.setPrototypeOf(DevEcoCodeCLI.prototype, Base.prototype);
    DevEcoCodeCLI._base = Base;
    return DevEcoCodeCLI;
}

export default definePlugin({
    name: 'cli/deveco-code',
    version: '1.0.0',
    seam: 'ai-cli',
    dependencies: ['cli/opencode'],
    setup(ctx) {
        // 限定名：向 cli/opencode 这个**具体插件**取基类，不依赖裸名当前指向谁
        wireDevEcoBase(ctx.inject('ai-cli-impl@cli/opencode'));
        // 启动期取归档接缝（缺 storage/core 即 load 抛错，fail closed）
        const archiveFactory = ctx.inject('message-archive');

        // 静态兜底挂在**子类自己的自有属性**上（不是基类那份）：`DevEcoCodeCLI.defaultArchiveFactory`
        // 一旦赋值就遮蔽继承来的基类值，因此两个类各有一份、互不覆盖。
        // 回收时若仍指向本宿主的工厂则删掉自有属性，恢复"经原型链读基类"的语义。
        const hadOwnFactory = Object.hasOwn(DevEcoCodeCLI, 'defaultArchiveFactory');
        const prevFactory = DevEcoCodeCLI.defaultArchiveFactory;
        DevEcoCodeCLI.defaultArchiveFactory = archiveFactory;
        ctx.addDisposer(() => {
            if (DevEcoCodeCLI.defaultArchiveFactory !== archiveFactory) return;
            if (hadOwnFactory) DevEcoCodeCLI.defaultArchiveFactory = prevFactory;
            else delete DevEcoCodeCLI.defaultArchiveFactory;
        });

        ctx.provide('ai-cli', (options = {}) => new DevEcoCodeCLI({
            ...options,
            archive: options.archive ?? archiveFactory(options),
        }));
    },
});
