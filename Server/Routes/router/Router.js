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
 * 判断 Origin 是否为本机回环来源（任意端口）。
 *
 * 后端仅监听 127.0.0.1，正常访问路径是同源反向代理（无需 CORS）。
 * 此处保留回环来源的 CORS 仅用于本地直连调试（如页面跑在 8080、直调 3000）。
 * 不再无条件返回 `*`：那会让任意网页读取本机引擎 API 的响应。
 *
 * @param {string|undefined} origin
 * @returns {boolean}
 */
function isLoopbackOrigin(origin) {
    if (!origin) return false;
    let host;
    try {
        host = new URL(origin).hostname.toLowerCase();
    } catch {
        return false;
    }
    return host === '127.0.0.1' || host === '::1' || host === 'localhost' || host === '[::1]';
}

/**
 * 解析允许的跨域来源：环境变量 3LIB_ALLOWED_ORIGINS（逗号分隔）显式追加，
 * 其余一律要求回环来源。
 * @param {string|undefined} origin
 * @returns {string|null} 允许放行的 Origin，或 null
 */
function resolveAllowedOrigin(origin) {
    if (!origin) return null;
    const extra = String(process.env['3LIB_ALLOWED_ORIGINS'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (extra.includes(origin)) return origin;
    return isLoopbackOrigin(origin) ? origin : null;
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

/**
 * 请求体大小上限（字节），可通过 MAX_JSON_BODY_BYTES 覆盖。
 *
 * 默认 2MB：本服务全部 JSON 接口里最大的合法请求体是「加载任务定义」
 * （几十个步骤的描述文字，量级几十 KB），2MB 已留出 20 倍余量；而原实现
 * 无任何上限、用 `data += chunk` 累积字符串，一个恶意/误发的超大 POST
 * 就能把进程堆打爆（V8 字符串拼接还会产生数倍于原体的中间副本）。
 */
const DEFAULT_MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

/**
 * 解析请求体上限。
 * @param {number|string|undefined} override - 构造参数覆盖值
 * @returns {number} 上限字节数（≥1）
 */
function resolveMaxJsonBodyBytes(override) {
    const pick = (v) => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    return pick(override) ?? pick(process.env.MAX_JSON_BODY_BYTES) ?? DEFAULT_MAX_JSON_BODY_BYTES;
}

/**
 * 构造带 HTTP 状态码的请求错误。
 *
 * 让 Router 能把「客户端错误」与「服务端内部错误」区分开：
 * 带 statusCode 的异常由 handle 直接转成对应响应（400/413），
 * 其余异常仍按 500 处理。
 *
 * @param {string} message
 * @param {number} statusCode
 * @param {string} [code] - 机器可读错误码（供前端区分提示）
 * @returns {Error & {statusCode: number, code: string}}
 */
function httpError(message, statusCode, code) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code || String(statusCode);
    return err;
}

class Router {
    /**
     * @param {object} [opts]
     * @param {number} [opts.maxJsonBodyBytes] - JSON 请求体上限（默认 2MB / MAX_JSON_BODY_BYTES）
     */
    constructor(opts = {}) {
        /** @type {{ method: string, path: string, compiled: {regex, keys}, middlewares: Middleware[], handler: Handler }[]} */
        this.routes = [];
        /** @type {number} JSON 请求体上限（字节），暴露给调用方/测试 */
        this.maxJsonBodyBytes = resolveMaxJsonBodyBytes(opts.maxJsonBodyBytes);
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
            const allowOrigin = resolveAllowedOrigin(req.headers.origin);
            // 带 Origin 却不在允许列表 → 明确拒绝；无 Origin 的普通 OPTIONS 不是预检，照常放行
            if (req.headers.origin && !allowOrigin) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: '跨域来源不被允许（仅允许本机回环来源）' }));
                return true;
            }
            const headers = {
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token'
            };
            if (allowOrigin) {
                headers['Access-Control-Allow-Origin'] = allowOrigin;
                headers['Vary'] = 'Origin';
            }
            res.writeHead(204, headers);
            res.end();
            return true;
        }

        // 仅对允许的来源回显 CORS 头（不再无条件 `*`）
        const corsOrigin = resolveAllowedOrigin(req.headers.origin);
        if (corsOrigin) {
            res.setHeader('Access-Control-Allow-Origin', corsOrigin);
            res.setHeader('Vary', 'Origin');
        }

        // 查找匹配路由
        for (const route of this.routes) {
            if (route.method !== req.method) continue;
            const match = ctxReq.pathname.match(route.compiled.regex);
            if (!match) continue;

            // 提取路径参数
            route.compiled.keys.forEach((key, i) => {
                ctxReq.params[key] = decodeURIComponent(match[i + 1]);
            });

            // 解析 body（POST/PUT/PATCH/DELETE）
            if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-type']?.includes('application/json')) {
                try {
                    ctxReq.body = await this._readJsonBody(req);
                } catch (err) {
                    // 请求体错误（超限 413 / JSON 非法 400 / 客户端中断）属于客户端问题，
                    // 按错误自带的状态码应答；不再让异常冒泡到调用方被统一当成 500。
                    const status = err.statusCode || 400;
                    if (err.code === 'BODY_TOO_LARGE') {
                        // 排空剩余请求体后再断开：直接 destroy 会连响应一起吞掉，
                        // 客户端只能看到 ECONNRESET 而非 413。
                        this._discardBody(req);
                    }
                    if (!res.headersSent) {
                        ctxRes.error(status, err.message, { code: err.code || String(status) });
                    }
                    return true;
                }
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

    /**
     * 读取并解析 JSON 请求体。
     *
     * 相对初版（`data += chunk` + 无上限、无中断处理）的三处加固：
     *   1. **大小上限**（默认 2MB，MAX_JSON_BODY_BYTES 可调）：按**字节数**累计
     *      （多字节 UTF-8 字符不能被少算），超限即以 413 拒绝，避免超大 body 把
     *      进程堆打爆；同时优先依据 Content-Length 提前拒绝，连读都不用读。
     *   2. **JSON 非法 → 400**：解析失败此前会冒泡到 server.js 的兜底 catch 变成 500，
     *      把客户端错误报成服务端错误。
     *   3. **中断兜底**：客户端提前断开（aborted/close）时立刻 reject，否则这个
     *      Promise 永远不会 settle，对应的 handler 与请求上下文泄漏。
     *
     * @param {import('node:http').IncomingMessage} req
     * @returns {Promise<any>} 解析后的 body（空体返回 null）
     * @private
     */
    _readJsonBody(req) {
        const limit = this.maxJsonBodyBytes;
        return new Promise((resolve, reject) => {
            // Content-Length 明确超限：直接拒绝，不进入读取流程
            const declared = Number(req.headers['content-length']);
            if (Number.isFinite(declared) && declared > limit) {
                reject(httpError(
                    `请求体过大（Content-Length=${declared}，上限 ${limit} 字节）`,
                    413,
                    'BODY_TOO_LARGE'
                ));
                return;
            }

            const chunks = [];
            let size = 0;
            let settled = false;

            const cleanup = () => {
                req.off?.('data', onData);
                req.off?.('end', onEnd);
                req.off?.('error', onError);
                req.off?.('aborted', onAborted);
                req.off?.('close', onClose);
            };
            const fail = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };
            const done = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            function onData(chunk) {
                // 按字节累计（chunk 可能是被解码前的 Buffer；统一转 Buffer 后取 length）
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                size += buf.length;
                if (size > limit) {
                    fail(httpError(`请求体过大（上限 ${limit} 字节）`, 413, 'BODY_TOO_LARGE'));
                    return;
                }
                chunks.push(buf);
            }
            function onEnd() {
                if (size === 0) {
                    done(null);
                    return;
                }
                const raw = Buffer.concat(chunks, size).toString('utf8');
                if (!raw) {
                    done(null);
                    return;
                }
                try {
                    done(JSON.parse(raw));
                } catch {
                    fail(httpError('JSON 解析失败：请求体不是合法 JSON', 400, 'INVALID_JSON'));
                }
            }
            function onError(err) {
                fail(err);
            }
            function onAborted() {
                fail(httpError('请求被客户端中断（请求体未接收完整）', 400, 'REQUEST_ABORTED'));
            }
            function onClose() {
                // Node 在正常读完 body 后也会触发 close，正常情况下 'end' 已先把
                // Promise settle 掉；此处只兜底真正的中断场景。
                fail(httpError('连接已关闭（请求体未接收完整）', 400, 'REQUEST_ABORTED'));
            }
            // close 在 res 结束或连接断开时触发；延后一个事件循环让 'end' 先执行，
            // 避免同一 tick 内 'end' 与 'close' 竞争导致把正常请求误判为中断。
            function onCloseDeferred() {
                setImmediate(onClose);
            }

            req.on('data', onData);
            req.on('end', onEnd);
            req.on('error', onError);
            req.on('aborted', onAborted);
            req.on('close', onCloseDeferred);
        });
    }

    /**
     * 排空（丢弃）一个已判定为超限的请求体。
     *
     * 不能直接 `req.destroy()`：那会连带销毁底层 socket，客户端只会看到
     * ECONNRESET/连接中断，收不到本该返回的 413。这里改为恢复读取让数据流走完，
     * 由 Node 在响应结束后按 keep-alive 规则自行处理连接。
     *
     * @param {import('node:http').IncomingMessage} req
     * @private
     */
    _discardBody(req) {
        try {
            req.on('error', () => {});
            req.resume?.();
        } catch {
            // 流已销毁等异常场景，忽略
        }
    }
}

export { Router, RequestContext, ResponseContext };
export default Router;
