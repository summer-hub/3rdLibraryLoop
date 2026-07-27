import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import BaseAdapter from './BaseAdapter.js';

/**
 * JsonlAdapter —— JSONL 流式追加存储适配器
 *
 * 用途：append-only 消息流、事件日志等高频追加场景。
 * 一个 key 对应一个 `<key>.jsonl` 文件，每行一条 JSON。
 *
 * 优势：
 *   - 追加写入 O(1)，无需读改写整文件
 *   - 天然增量，便于按行读取/流式处理
 *   - 单文件损坏只影响该 key
 */
class JsonlAdapter extends BaseAdapter {
    constructor(options = {}) {
        super(options);
        this._ext = options.ext || '.jsonl';
    }

    get type() {
        return 'jsonl';
    }

    _file(key) {
        return this.path(`${key}${this._ext}`);
    }

    /**
     * 追加一条记录。
     * @param {string} key
     * @param {object} record
     * @returns {Promise<object>} 实际写入的记录
     */
    async append(key, record) {
        await this.ensureDir();
        const file = this._file(key);
        await fs.mkdir(dirname(file), { recursive: true });
        const line = JSON.stringify(record) + '\n';
        await fs.appendFile(file, line, 'utf8');
        return record;
    }

    /**
     * 批量追加。
     * @param {string} key
     * @param {Array<object>} records
     * @returns {Promise<number>} 实际写入条数
     */
    async appendBatch(key, records) {
        await this.ensureDir();
        const file = this._file(key);
        await fs.mkdir(dirname(file), { recursive: true });
        const content = records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
        if (content) await fs.appendFile(file, content, 'utf8');
        return records.length;
    }

    /**
     * 读取全部记录（按行顺序）。
     * @param {string} key
     * @returns {Promise<Array<object>>}
     */
    async read(key) {
        try {
            const raw = await fs.readFile(this._file(key), 'utf8');
            const lines = raw.split('\n').filter(Boolean);
            const out = [];
            for (const line of lines) {
                try { out.push(JSON.parse(line)); }
                catch { /* 跳过损坏行 */ }
            }
            return out;
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
    }

    /**
     * 读取最后一条记录（高效：从尾部读取）。
     * @param {string} key
     * @returns {Promise<object|null>}
     */
    async readLast(key) {
        const records = await this.read(key);
        return records.length > 0 ? records[records.length - 1] : null;
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

    async list() {
        await this.ensureDir();
        const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
        const result = [];
        for (const e of entries) {
            if (e.isFile() && e.name.endsWith(this._ext)) {
                result.push(e.name.slice(0, -this._ext.length));
            }
        }
        return result;
    }
}

export default JsonlAdapter;
