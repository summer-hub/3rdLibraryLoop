import { promises as fs } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import BaseAdapter from './BaseAdapter.js';
import { renameWithRetry } from '../lib/AtomicJsonFile.js';

/**
 * 把 OS 相对路径规范化成存储 key 形式（分隔符一律 `/`，无尾随分隔符）。
 *
 * 为什么必须规范化：`list(prefix)` 的调用方一律用 `/` 写 key（`read`/`write` 的 key 也是
 * `/` 形式），而 `path.join` 在 Windows 下产出 `\`。不规范化时 `rel.startsWith(prefix)`
 * 对任何含分隔符的前缀恒为假 —— 这正是 `list('<taskId>/testcheck_loop')` 恒返回 `[]` 的原因。
 *
 * @param {string} p
 * @returns {string}
 */
function toKey(p) {
    return p.split(sep).join('/').replace(/\/+$/, '');
}

/**
 * JsonAdapter —— JSON 文件存储适配器
 *
 * 用途：存储结构化的小型文档（meta、配置、任务快照），整文件读写。
 * 一个 key 对应一个 `<key>.json` 文件，内容为 JSON 对象。
 *
 * 适用场景：元信息、步骤状态、单文档存档。
 * 不适用：高频追加的消息流（请用 JsonlAdapter）或大量记录（请用 SqliteAdapter）。
 */
class JsonAdapter extends BaseAdapter {
    constructor(options = {}) {
        super(options);
        this._ext = options.ext || '.json';
    }

    get type() {
        return 'json';
    }

    _file(key) {
        // key 允许含子目录，自动创建
        return this.path(`${key}${this._ext}`);
    }

    async read(key) {
        try {
            const raw = await fs.readFile(this._file(key), 'utf8');
            return JSON.parse(raw);
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }

    async write(key, data) {
        await this.ensureDir();
        const file = this._file(key);
        // 确保子目录存在
        await fs.mkdir(dirname(file), { recursive: true });
        // 原子写入：先写临时文件，再 rename 覆盖目标文件。
        // 避免并发 writeFile 直接截断目标文件时，另一路仍在写尾部，
        // 产生 JSON 尾部拼接垃圾（如 orchestration.json 损坏场景）。
        // rename 在同一文件系统内是原子的，读端要么看到旧文件要么看到完整新文件。
        //
        // 注意（Windows）：目标文件正被其它句柄打开时 rename 会以 EPERM/EBUSY 失败，
        // 因此必须走 renameWithRetry——直接 rename 会在"并发写 + 并发读"下偶发丢更新。
        const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
        try {
            await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
            await renameWithRetry(tmp, file);
        } catch (err) {
            // 出错时清理临时文件，避免残留
            await fs.unlink(tmp).catch(() => {});
            throw err;
        }
        return data;
    }

    async delete(key) {
        try {
            await fs.unlink(this._file(key));
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') return false;
            throw err;
        }
    }

    /**
     * 列举 JSON 文件。
     *
     * 三种模式：
     *   - `list()`：**根目录模式**，只列 rootDir 这一层的文件，不递归。
     *   - `list(prefix)`：**key 前缀模式**，在 rootDir 下递归扫描，返回规范化 key
     *     （`/` 分隔、无扩展名、相对 rootDir）以 `prefix` 开头的条目。前缀按字符串匹配，
     *     所以 `'task-001'`（目录）与 `'task-001/stepid_'`（目录 + 文件名前缀）都成立。
     *   - `list(undefined, { recursive: true })`：**整树模式**，返回 rootDir 下全部条目。
     *
     * @param {string} [prefix] - 可选的 key 前缀（如 `'task-001/stepid_'`）；接受 `\` 分隔写法的等价形式
     * @param {object} [options]
     * @param {boolean} [options.recursive=false] - 无 prefix 时也递归列整棵树（有 prefix 时本就递归）
     * @returns {Promise<Array<{key: string, data: object}>>} key 为 `/` 分隔的存储 key
     */
    async list(prefix, options = {}) {
        await this.ensureDir();

        const recursive = options?.recursive === true;
        const prefixKey = prefix ? toKey(prefix) : '';

        if (!prefixKey && !recursive) {
            // 根目录模式（不递归，保持既有语义不变）
            const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
            const result = [];
            for (const e of entries) {
                if (e.isFile() && e.name.endsWith(this._ext)) {
                    const key = e.name.slice(0, -this._ext.length);
                    const data = await this.read(key);
                    if (data != null) result.push({ key, data });
                }
            }
            return result;
        }

        // 递归模式：扫描整棵 rootDir，用规范化 key 做前缀过滤（prefixKey 为空 = 全部条目）
        const files = await this._readdirRecursive(this.rootDir);
        const result = [];
        for (const file of files) {
            if (!file.endsWith(this._ext)) continue;
            // 从 rootDir 开始的相对路径（去掉扩展名、规范化分隔符）作为 key
            const key = toKey(file.slice(this.rootDir.length + 1, -this._ext.length));
            if (prefixKey && !key.startsWith(prefixKey)) continue;
            const data = await this.read(key);
            if (data != null) result.push({ key, data });
        }
        return result;
    }

    /**
     * 递归读取目录下所有文件路径。
     * @param {string} dir
     * @returns {Promise<string[]>}
     * @private
     */
    async _readdirRecursive(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
        const files = [];
        for (const e of entries) {
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                files.push(...await this._readdirRecursive(full));
            } else if (e.isFile()) {
                files.push(full);
            }
        }
        return files;
    }
}

export default JsonAdapter;
