import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import BaseAdapter from './BaseAdapter.js';

/**
 * FileAdapter —— 原始文件读写适配器
 *
 * 用途：任务的文件创建/产物落盘、二进制内容、非结构化文本等。
 * 与 JsonAdapter/JsonlAdapter 的区别：不做 JSON 序列化，原样写入/读取。
 *
 * 提供：
 *   - writeFile(key, content) / readFile(key)     文本或 Buffer
 *   - createFile(key, content)                    仅在不存在时创建
 *   - appendFile(key, content)                    追加
 *   - exists(key) / stat(key)                     元信息
 *   - list(pattern)                               列举文件
 */
class FileAdapter extends BaseAdapter {
    constructor(options = {}) {
        super(options);
        this._defaultExt = options.defaultExt || '';
    }

    get type() {
        return 'file';
    }

    _file(key) {
        // key 即相对 rootDir 的文件路径（可含子目录与扩展名）
        return this.path(key);
    }

    /**
     * 写入文件（覆盖）。
     * @param {string} key
     * @param {string|Buffer} content
     * @param {object} [opts]
     * @param {boolean} [opts.binary] - 是否二进制
     */
    async write(key, content, opts = {}) {
        await this.ensureDir();
        const file = this._file(key);
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.writeFile(file, content, opts.binary ? null : 'utf8');
        return key;
    }

    /** readFile 别名，对齐接口 */
    async read(key, opts = {}) {
        return this.readFile(key, opts);
    }

    async readFile(key, opts = {}) {
        try {
            return await fs.readFile(this._file(key), opts.binary ? null : 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }

    /**
     * 仅当文件不存在时创建（原子性：O_EXCL）。
     * @returns {Promise<boolean>} 是否实际创建
     */
    async createFile(key, content = '', opts = {}) {
        await this.ensureDir();
        const file = this._file(key);
        await fs.mkdir(dirname(file), { recursive: true });
        try {
            // 'wx' 标志：存在则失败
            const handle = await fs.open(file, 'wx');
            await handle.writeFile(content, opts.binary ? null : 'utf8');
            await handle.close();
            return true;
        } catch (err) {
            if (err.code === 'EEXIST') return false;
            throw err;
        }
    }

    async appendFile(key, content, opts = {}) {
        await this.ensureDir();
        const file = this._file(key);
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.appendFile(file, content, opts.binary ? null : 'utf8');
        return key;
    }

    async exists(key) {
        try {
            await fs.access(this._file(key));
            return true;
        } catch {
            return false;
        }
    }

    async stat(key) {
        try {
            return await fs.stat(this._file(key));
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
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
     * 列举目录下的文件名（不含目录）。pattern 为简单前缀过滤。
     * @param {string} [pattern]
     * @returns {Promise<Array<string>>}
     */
    async list(pattern) {
        await this.ensureDir();
        try {
            const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
            return entries
                .filter(e => e.isFile())
                .map(e => e.name)
                .filter(name => !pattern || name.startsWith(pattern));
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
    }
}

export default FileAdapter;
