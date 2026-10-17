/**
 * seams/http-router.js — HTTP 路由挂载契约（能力接缝）
 *
 * Provider：`plugins/http`（现 Server/Routes/ 的 9 个域路由 + SSE）。
 * Consumer：`Server/Routes/server.js`（保留为兼容入口，内部改走宿主事件）。
 *
 * 挂载方式从"固定 import + registerRoutes"改为**类型化事件**：
 *     await host.emit('http:mount', { router, dependencies });
 * 各路由插件监听该事件并 `router.use('/api/xxx', createXxxRouter(deps))`。
 * 好处：增删路由域不改 server.js；第三方插件也能挂自己的 /api 路由。
 *
 * 事件约定：
 *   - 事件名固定 `http:mount`，payload `{ router, dependencies }`；
 *   - 监听者 serial 模式，按加载顺序挂载（现有 9 域顺序由插件拓扑保证）；
 *   - 冲突路径（两个插件挂同一前缀）由 Router.use 行为决定（后者覆盖），
 *     ？不——现有 Router.use 同名子路由会叠加，冲突检测留给启动日志。
 */

export const HTTP_ROUTER_SEAM = Object.freeze({
    name: 'http-router',
    version: 1,
    description: 'HTTP 路由挂载：经类型化事件 http:mount 贡献路由域',
    event: 'http:mount',
    payload: Object.freeze(['router', 'dependencies']),
});

export default HTTP_ROUTER_SEAM;
