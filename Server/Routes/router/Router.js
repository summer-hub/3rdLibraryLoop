import http from 'node:http';

/**
 * Router —— 轻量级 HTTP 路由器
 *
 * 职责：路由匹配、参数提取、请求分发。不感知业务逻辑。
 *
 * 设计要点：
 *  - 高内聚：只负责「URL → handler」的映射与分发
 *  - 低耦合：不依赖任何业务模块，handler 由各 Controller 自行注册
 *  - 统一响应：封装 sendJson / sendError，保证响应格式一致
 *  - 中间件链：支持 per-route 中间件（鉴权、日志等）
 *
 * 路由匹配规则：
 *  - 精确匹配优先：/api/health 优先于 /api/:id
 *  - 参数提取：/api/tasks/:taskId → req.params.taskId
 *  - 通配符：/api/files/* → req.params[0] 为剩余路径
 */

/**
 * @typedef {(req: RequestContext, res: ResponseContext, next: () => void) => void} Middleware
 * @typedef {(req: RequestContext, res: ResponseContext) => void|Promise<void>} Handler
 */

/**
 * 请求上下文：在原生 req 基础上注入路由参数与解析后的 body
 */
class RequestContext {
    constructor(req, url) {
        this.raw = req;
        this.method = req.method;
        this.url = url;
        this.pathname = url.pathname;
        this.query = Object.fromEntries(url.searchParams);
        this.params = {};
        this.body = null;
    }
}

/**
 * 响应上下文：封装统一响应方法
 */
class ResponseContext {
    constructor(res) {
        this.raw = res;
    }

    /** JSON 成功响应 */
    json(data, status = 200) {
        const body = JSON.stringify(data);
        this.raw.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body)
        });
        this.raw.end(body);
    }

    /** 错误响应 */
    error(status, message, extra = {}) {
        this.json({ error: message, ...extra }, status);
    }

    /** SSE 流式响应头（供实时推送端点使用） */
    stream() {
        this.raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'  // Nginx 反代时不缓冲
        });
        return this.raw;
    }
}

/**
 * 将路径转为正则 + 参数名数组
 * /api/tasks/:taskId → { regex: /^\/api\/tasks\/([^/]+)$/, keys: ['taskId'] }
 * /api/files/*       → { regex: /^\/api\/files\/(.*)$/, keys: [0] }
 */
function compilePath(path) {
    const keys = [];
    const regexStr = path
        .replace(/\*/g, () => { keys.push(0); return '(.*)'; })
        .replace(/:([^/]+)/g, (_, name) => { keys.push(name); return '([^/]+)'; });
    return { regex: new RegExp(`^${regexStr}$`), keys };
}

class Router {
    constructor() {
        /** @type {{ method: string, path: string, compiled: {regex, keys}, middlewares: Middleware[], handler: Handler }[]} */
        this.routes = [];
    }

    /**
     * 注册路由
     * @param {string} method   - HTTP 方法
     * @param {string} path     - 路径模板，支持 :param 和 *
     * @param {Handler} handler - 业务处理函数
     * @param {Middleware[]} [middlewares=[]] - 中间件链
     */
    register(method, path, handler, middlewares = []) {
        this.routes.push({ method, path, compiled: compilePath(path), middlewares, handler });
    }

    // 便捷方法
    get(path, handler, middlewares)    { this.register('GET',    path, handler, middlewares); }
    post(path, handler, middlewares)   { this.register('POST',   path, handler, middlewares); }
    put(path, handler, middlewares)    { this.register('PUT',    path, handler, middlewares); }
    delete(path, handler, middlewares) { this.register('DELETE', path, handler, middlewares); }

    /**
     * 挂载子路由（按前缀聚合）
     * @param {string} prefix  - 路径前缀，如 /api/health
     * @param {Router} router  - 子路由器
     */
    use(prefix, router) {
        for (const route of router.routes) {
            this.routes.push({
                ...route,
                path: prefix + route.path,
                compiled: compilePath(prefix + route.path)
            });
        }
    }

    /**
     * 匹配并执行路由
     * @returns {boolean} 是否命中
     */
    async handle(req, res) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const ctxReq = new RequestContext(req, url);
        const ctxRes = new ResponseContext(res);

        // CORS 预检
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            });
            res.end();
            return true;
        }

        // 注入 CORS 头到所有响应
        res.setHeader('Access-Control-Allow-Origin', '*');

        // 查找匹配路由
        for (const route of this.routes) {
            if (route.method !== req.method) continue;
            const match = ctxReq.pathname.match(route.compiled.regex);
            if (!match) continue;

            // 提取路径参数
            route.compiled.keys.forEach((key, i) => {
                ctxReq.params[key] = decodeURIComponent(match[i + 1]);
            });

            // 解析 body（POST/PUT/DELETE）
            if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-type']?.includes('application/json')) {
                ctxReq.body = await this._readJsonBody(req);
            }

            // 执行中间件链 → handler
            try {
                await this._runChain(route.middlewares, route.handler, ctxReq, ctxRes);
            } catch (err) {
                ctxRes.error(500, `内部错误: ${err.message}`);
            }
            return true;
        }

        return false;
    }

    _runChain(middlewares, handler, req, res) {
        let index = 0;
        const stack = [...middlewares, async (r, rs) => handler(r, rs)];

        const next = () => {
            if (index < stack.length) {
                return Promise.resolve(stack[index++](req, res, next));
            }
        };
        return next();
    }

    _readJsonBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', chunk => { data += chunk; });
            req.on('end', () => {
                if (!data) return resolve(null);
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('JSON 解析失败')); }
            });
            req.on('error', reject);
        });
    }
}

export { Router, RequestContext, ResponseContext };
export default Router;
