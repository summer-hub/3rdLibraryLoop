import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BaseAdapter —— 所有存储适配器的抽象基类
 *
 * 职责：
 *   1. 统一根目录解析（相对路径 → 绝对路径）。
 *   2. 提供目录确保、路径拼接工具方法。
 *   3. 声明子类必须实现的接口契约（子类不实现则抛 NotImplemented）。
 *
 * 设计原则：
 *   - 高内聚：每种存储格式（JSON/JSONL/SQLite/File）的读写细节封装在各自适配器。
 *   - 低耦合：Store 层只依赖适配器接口，不感知具体格式；适配器之间互不依赖。
 *   - 可扩展：新增存储格式只需新增一个 Adapter 子类，无需改动 Store 与 Manager。
 */
class BaseAdapter {
    /**
     * @param {object} options
     * @param {string} [options.baseDir]  - 该适配器的工作根目录（绝对路径）
     * @param {string} [options.subDir]   - 根目录下的子目录名（如 'Session'、'TaskStep'）
     */
    constructor(options = {}) {
        this.subDir = options.subDir || '';
        if (options.baseDir) {
            this.baseDir = options.baseDir;
        } else {
            // 默认：本文件 (Server/DbUse/adapters/) 上溯 4 层到 workspace 根 → db/
            const here = dirname(fileURLToPath(import.meta.url));
            this.baseDir = join(here, '..', '..', '..', '..', 'db');
        }
        this.rootDir = this.subDir ? join(this.baseDir, this.subDir) : this.baseDir;
        this._ensureDirPromise = null;
    }

    // ─── 工具方法 ──────────────────────────────────────────────────────────────

    /**
     * 确保工作目录存在（幂等，并发安全）。
     * @returns {Promise<string>} 目录绝对路径
     */
    async ensureDir() {
        if (!this._ensureDirPromise) {
            this._ensureDirPromise = fs.mkdir(this.rootDir, { recursive: true }).then(() => {
                this._ensureDirPromise = null;
                return this.rootDir;
            }).catch(err => {
                this._ensureDirPromise = null;
                throw err;
            });
        }
        return this._ensureDirPromise;
    }

    /** 拼接工作目录下的路径 */
    path(...segments) {
        return join(this.rootDir, ...segments);
    }

    /** 同步版路径拼接（供 SQLite 等 sync 场景使用） */
    pathSync(...segments) {
        return join(this.rootDir, ...segments);
    }

    // ─── 子类必须实现的接口契约 ────────────────────────────────────────────────
    // 以下方法默认抛出 NotImplementedError，子类按需覆盖。

    async read(/* key */) {
        throw new Error(`${this.constructor.name}.read() 未实现`);
    }

    async write(/* key, data */) {
        throw new Error(`${this.constructor.name}.write() 未实现`);
    }

    async delete(/* key */) {
        throw new Error(`${this.constructor.name}.delete() 未实现`);
    }

    async list() {
        throw new Error(`${this.constructor.name}.list() 未实现`);
    }

    /**
     * 返回适配器类型标识，用于日志与注册表。
     * @returns {string}
     */
    get type() {
        return 'base';
    }
}

export default BaseAdapter;
