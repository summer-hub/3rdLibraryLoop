import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import BaseAdapter from './BaseAdapter.js';
import { renameWithRetry } from '../../library/AtomicJsonFile.js';

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
     * @param {string} [prefix] - 可选的子目录前缀（如 'task-001/stepid_'），
     *                           传入时递归列举该前缀下的文件，key 含子目录路径。
     *                           不传时列举根目录下的文件。
     * @returns {Promise<Array<{key: string, data: object}>>}
     */
    async list(prefix) {
        await this.ensureDir();

        if (prefix) {
            // 子目录模式：在 rootDir/prefix 的父目录下递归查找匹配文件
            const dir = dirname(this.path(prefix));
            const files = await this._readdirRecursive(dir);
            const result = [];
            for (const file of files) {
                if (!file.endsWith(this._ext)) continue;
                // 从 rootDir 开始的相对路径（去掉扩展名）作为 key
                const rel = file.slice(this.rootDir.length + 1, -this._ext.length);
                if (!rel.startsWith(prefix)) continue;
                const data = await this.read(rel);
                if (data != null) result.push({ key: rel, data });
            }
            return result;
        }

        // 根目录模式
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
