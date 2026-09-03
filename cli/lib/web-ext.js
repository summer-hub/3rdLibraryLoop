/**
 * web-ext.js —— 3rdloop web 扩展机制
 *
 * 职责：
 *   - 扩展 manifest.json 的读取与校验（name/title/mount/server/page/order）
 *   - 扫描扩展根目录（一个根目录下含多个扩展子目录），多根合并、同名去重
 *   - 轻量 express 兼容 shim（Router/req/res），使从 AIWeb 移植的
 *     TAG / Issue / PrCheck 等二级目录模块几乎零改动即可挂载
 *   - install-ext / remove-ext 的目录安装与卸载
 *
 * 扩展目录约定（自包含，既是开发态源码也是安装单元）：
 *
 *   <ext-root>/<name>/
 *   ├── manifest.json     # { name, title, description, mount, order, server, page }
 *   ├── router.cjs        # 可选；module.exports.createExtRouter(deps) → Router
 *   ├── *.cjs             # router 的本地依赖（database/gitcodeApi 等）
 *   └── public/           # 前端静态资源（page 指向其中 html）
 *
 * createExtRouter(deps) 协议：
 *   deps.express    — shim：{ Router(): Router }（express.Router 兼容）
 *   deps.Database   — better-sqlite3 的 Database 类（由宿主解析注入）
 *   deps.dbDir      — 该扩展的数据目录（<dataDir>/web-ext/<name>）
 *   deps.serverRoot — 核心引擎 Server 根目录（vendor/Server 或仓库 Server/）
 *   deps.logger     — 日志函数
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 保留挂载路径：核心前端与后端代理专用，扩展不得占用
const RESERVED_MOUNT_PREFIXES = ['/api', '/stream'];

/** 校验扩展 name：小写字母开头，允许小写字母/数字/连字符 */
const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * 读取并校验扩展 manifest。
 * @param {string} extDir - 扩展目录（含 manifest.json）
 * @returns {{ name: string, title: string, description: string,
 *             mount: string, order: number, server: string|null,
 *             page: string|null, dir: string }}
 * @throws {Error} manifest 缺失/非法时抛错（含具体原因）
 */
export function readManifest(extDir) {
    const manifestPath = path.join(extDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`缺少 manifest.json: ${manifestPath}`);
    }

    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
        throw new Error(`manifest.json 解析失败 [${extDir}]: ${err.message}`);
    }

    const name = String(raw.name || '').trim();
    if (!NAME_RE.test(name)) {
        throw new Error(`manifest.name 非法 [${extDir}]: "${name}"（须匹配 ${NAME_RE}）`);
    }

    const mount = String(raw.mount || '').trim().toLowerCase();
    if (!/^\/[a-z][a-z0-9-]*$/.test(mount)) {
        throw new Error(`manifest.mount 非法 [${extDir}]: "${raw.mount}"（格式如 "/tag"）`);
    }
    if (RESERVED_MOUNT_PREFIXES.some((p) => mount === p || mount.startsWith(p + '/'))) {
        throw new Error(`manifest.mount 保留 [${extDir}]: "${mount}"（不得占用 /api、/stream）`);
    }

    // server / page 路径必须落在扩展目录内（防穿越）
    const server = raw.server ? path.resolve(extDir, raw.server) : null;
    if (server && !server.startsWith(extDir + path.sep)) {
        throw new Error(`manifest.server 越界 [${extDir}]: "${raw.server}"`);
    }
    if (server && !fs.existsSync(server)) {
        throw new Error(`manifest.server 不存在 [${extDir}]: "${raw.server}"`);
    }

    const page = raw.page ? path.resolve(extDir, raw.page) : null;
    if (page && !page.startsWith(extDir + path.sep)) {
        throw new Error(`manifest.page 越界 [${extDir}]: "${raw.page}"`);
    }
    if (page && !fs.existsSync(page)) {
        throw new Error(`manifest.page 不存在 [${extDir}]: "${raw.page}"`);
    }

    return {
        name,
        title: String(raw.title || name).trim(),
        description: String(raw.description || '').trim(),
        mount,
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 100,
        server,
        page,
        dir: path.resolve(extDir),
    };
}

/**
 * 扫描单个扩展根目录（其下每个子目录视为一个扩展）。
 * 单个扩展损坏只产生 warning，不阻断其他扩展。
 *
 * @param {string} rootDir - 扩展根目录
 * @param {(msg: string) => void} [warn] - 警告输出函数
 * @returns {Array<object>} manifest 数组
 */
export function scanExtRoot(rootDir, warn = () => {}) {
    const exts = [];
    if (!fs.existsSync(rootDir)) return exts;

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const extDir = path.join(rootDir, entry.name);
        try {
            exts.push(readManifest(extDir));
        } catch (err) {
            warn(`[web-ext] 跳过无效扩展: ${err.message}`);
        }
    }
    return exts;
}

/**
 * 从多个扩展根目录合并加载扩展（同名去重：先注册者优先）。
 *
 * @param {string[]} extRoots - 扩展根目录列表（优先级从高到低）
 * @param {(msg: string) => void} [warn]
 * @returns {{ extensions: Array<object>, mounts: Map<string, object> }}
 */
export function loadExtensions(extRoots, warn = () => {}) {
    const extensions = [];
    const byName = new Map();
    const byMount = new Map();

    for (const root of extRoots) {
        for (const ext of scanExtRoot(root, warn)) {
            if (byName.has(ext.name)) {
                warn(`[web-ext] 扩展重名 "${ext.name}"，忽略来自 ${ext.dir} 的副本（保留 ${byName.get(ext.name).dir}）`);
                continue;
            }
            const mountOwner = byMount.get(ext.mount);
            if (mountOwner) {
                warn(`[web-ext] 挂载点冲突 "${ext.mount}"（${ext.name} 与 ${mountOwner.name}），忽略 ${ext.name}`);
                continue;
            }
            byName.set(ext.name, ext);
            byMount.set(ext.mount, ext);
            extensions.push(ext);
        }
    }

    // 排序：order 升序 → name 字典序（导航展示顺序稳定）
    extensions.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
    return { extensions, mounts: byMount };
}

// ═══════════════════════════════════════════════════════════════════
// 轻量 express 兼容 shim
// ═══════════════════════════════════════════════════════════════════

/**
 * 编译路由模式为段数组。
 * '/delete/:id' → [{literal:'delete'}, {param:'id'}]
 */
function compilePattern(pattern) {
    const segs = String(pattern).split('/').filter((s) => s !== '');
    return segs.map((s) => (s.startsWith(':') ? { param: s.slice(1) } : { literal: s }));
}

/** express.Router() 兼容对象（仅支持本项目扩展用到的子集） */
export class ShimRouter {
    constructor() {
        /** @type {Array<{method: string, segs: Array, handler: Function}>} */
        this._routes = [];
    }

    get(p, h) { this._add('GET', p, h); }
    post(p, h) { this._add('POST', p, h); }
    put(p, h) { this._add('PUT', p, h); }
    patch(p, h) { this._add('PATCH', p, h); }
    delete(p, h) { this._add('DELETE', p, h); }

    /** 暂不支持 middleware/子路由挂载，显式报错便于扩展开发者定位 */
    use() {
        throw new Error('3rdloop web 扩展 shim 不支持 router.use()（仅支持 get/post/put/patch/delete 路由）');
    }

    _add(method, pattern, handler) {
        if (typeof handler !== 'function') {
            throw new Error(`路由 handler 必须是函数: ${method} ${pattern}`);
        }
        this._routes.push({ method, segs: compilePattern(pattern), handler });
    }

    /**
     * 匹配请求。
     * @param {string} method - HTTP 方法（大写）
     * @param {string} pathname - 相对挂载点的子路径（如 '/list'、'/delete/42'）
     * @returns {{ handler: Function, params: object } | null}
     */
    match(method, pathname) {
        const segs = String(pathname).split('/').filter((s) => s !== '');
        for (const route of this._routes) {
            if (route.method !== method) continue;
            if (route.segs.length !== segs.length) continue;

            const params = {};
            let ok = true;
            for (let i = 0; i < segs.length; i++) {
                const rs = route.segs[i];
                if (rs.literal !== undefined) {
                    if (rs.literal !== segs[i]) { ok = false; break; }
                } else {
                    try { params[rs.param] = decodeURIComponent(segs[i]); }
                    catch { params[rs.param] = segs[i]; }
                }
            }
            if (ok) return { handler: route.handler, params };
        }
        return null;
    }
}

/** express 模块 shim：仅提供 Router 工厂 */
export function createExpressShim() {
    return { Router: () => new ShimRouter() };
}

/**
 * 读取请求体并解析 JSON（上限 limitBytes，超出返回 413 错误对象）。
 * 非 JSON 内容解析失败时返回 {}（与扩展路由的容错语义一致）。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limitBytes]
 * @returns {Promise<{ ok: boolean, body: object, error?: string }>}
 */
export function readJsonBody(req, limitBytes = 1024 * 1024) {
    return new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        let done = false;

        req.on('data', (chunk) => {
            if (done) return;
            size += chunk.length;
            if (size > limitBytes) {
                done = true;
                resolve({ ok: false, body: {}, error: 'payload too large' });
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (done) return;
            done = true;
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({ ok: true, body: {} });
            try {
                resolve({ ok: true, body: JSON.parse(raw) });
            } catch {
                resolve({ ok: true, body: {} });
            }
        });
        req.on('error', () => {
            if (done) return;
            done = true;
            resolve({ ok: false, body: {}, error: 'request stream error' });
        });
    });
}

/**
 * 构造 express Response 兼容对象（包一层 node ServerResponse）。
 * 支持：status()（链式）、json()、send()、setHeader()、end()、sendFile()。
 */
export function createResShim(res) {
    return {
        _status: 200,
        status(code) {
            this._status = code;
            return this;
        },
        setHeader(k, v) {
            res.setHeader(k, v);
            return this;
        },
        json(obj) {
            const body = JSON.stringify(obj);
            if (!res.headersSent) {
                res.writeHead(this._status, { 'Content-Type': 'application/json; charset=utf-8' });
            }
            res.end(body);
        },
        send(data) {
            if (data === undefined || data === null) {
                if (!res.headersSent) res.writeHead(this._status);
                res.end();
                return;
            }
            if (typeof data === 'string' || Buffer.isBuffer(data)) {
                // 尊重 handler 已 setHeader 的 Content-Type（如 CSV 导出），否则默认 html
                if (!res.headersSent && !res.getHeader('Content-Type')) {
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                }
                if (!res.headersSent) res.writeHead(this._status);
                res.end(data);
                return;
            }
            // 对象退化为 JSON（与 express send 语义一致）
            this.json(data);
        },
        end(data) {
            if (!res.headersSent) res.writeHead(this._status);
            res.end(data);
        },
        sendFile(absPath) {
            try {
                const data = fs.readFileSync(absPath);
                if (!res.headersSent && !res.getHeader('Content-Type')) {
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                }
                if (!res.headersSent) res.writeHead(this._status);
                res.end(data);
            } catch {
                if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: 'file not found' }));
            }
        },
    };
}

// ═══════════════════════════════════════════════════════════════════
// 扩展路由初始化
// ═══════════════════════════════════════════════════════════════════

/**
 * 解析核心引擎 Server 根目录（vendor 优先，开发期回退仓库源码）。
 * @param {string} cliRoot
 * @returns {string | null}
 */
export function resolveServerRoot(cliRoot) {
    const vendorServer = path.join(cliRoot, 'vendor', 'Server');
    if (fs.existsSync(vendorServer)) return vendorServer;
    const repoServer = path.resolve(cliRoot, '..', 'Server');
    if (fs.existsSync(repoServer)) return repoServer;
    return null;
}

/**
 * 初始化扩展的 API 路由（require server 模块并注入依赖）。
 *
 * @param {object} ext - readManifest 返回的扩展描述
 * @param {object} opts
 * @param {string} opts.cliRoot - cli 包根目录（解析 better-sqlite3 / Server）
 * @param {string} opts.dataDir - CLI 数据目录（扩展数据落在 <dataDir>/web-ext/<name>）
 * @param {Function} opts.logger
 * @returns {ShimRouter | null} 路由实例（无 server 或加载失败返回 null）
 */
export function initExtRouter(ext, { cliRoot, dataDir, logger = console.error }) {
    if (!ext.server) return null;

    try {
        // 以扩展目录为基准 require（扩展内部相对依赖正常解析；.cjs 无包类型歧义）
        const requireFromExt = createRequire(path.join(ext.dir, 'manifest.json'));
        const mod = requireFromExt(ext.server);
        const factory = mod && (mod.createExtRouter || mod.default);
        if (typeof factory !== 'function') {
            throw new Error(`${ext.server} 未导出 createExtRouter(deps)`);
        }

        // better-sqlite3 从 cli 包解析（cli 已声明该依赖）
        let Database = null;
        try {
            const requireFromCli = createRequire(path.join(cliRoot, 'package.json'));
            Database = requireFromCli('better-sqlite3');
        } catch (err) {
            logger(`[web-ext] better-sqlite3 解析失败（${ext.name} 将不可用）: ${err.message}`);
        }

        const dbDir = path.join(dataDir, 'web-ext', ext.name);
        const serverRoot = resolveServerRoot(cliRoot);

        const router = factory({
            express: createExpressShim(),
            Database,
            dbDir,
            serverRoot,
            logger,
        });
        if (!router || typeof router.match !== 'function') {
            throw new Error('createExtRouter 未返回 Router 实例');
        }
        return router;
    } catch (err) {
        logger(`[web-ext] 扩展路由初始化失败 [${ext.name}]: ${err.message}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════
// install-ext / remove-ext
// ═══════════════════════════════════════════════════════════════════

/** 安装时排除的文件/目录 */
const INSTALL_EXCLUDE = new Set(['node_modules', '.git', '.DS_Store', '.env']);

/**
 * 安装扩展：校验源目录 manifest 后整目录复制到 <userExtRoot>/<name>/。
 * 已存在同名扩展时先删除再复制（覆盖更新）。
 *
 * @param {string} srcDir - 源扩展目录
 * @param {string} userExtRoot - 用户扩展根目录（安装目标）
 * @returns {{ name: string, title: string, dest: string }}
 * @throws {Error} 校验失败时抛错
 */
export function installExtension(srcDir, userExtRoot) {
    const manifest = readManifest(path.resolve(srcDir));
    const dest = path.join(userExtRoot, manifest.name);

    fs.rmSync(dest, { recursive: true, force: true });
    _copyDirFiltered(path.resolve(srcDir), dest);
    return { name: manifest.name, title: manifest.title, dest };
}

/**
 * 移除已安装扩展（仅作用于用户扩展根目录）。
 * @returns {string} 被移除的目录路径
 * @throws {Error} 扩展不存在时抛错
 */
export function removeExtension(name, userExtRoot) {
    if (!NAME_RE.test(name)) {
        throw new Error(`非法扩展名: "${name}"`);
    }
    const dest = path.join(userExtRoot, name);
    if (!fs.existsSync(dest)) {
        throw new Error(`未安装扩展 "${name}"（查找目录: ${dest}）`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    return dest;
}

function _copyDirFiltered(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (INSTALL_EXCLUDE.has(entry.name)) continue;
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) _copyDirFiltered(s, d);
        else if (entry.isFile()) fs.copyFileSync(s, d);
        // 符号链接等特殊类型跳过（扩展不应包含）
    }
}
