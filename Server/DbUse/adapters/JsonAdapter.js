import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import BaseAdapter from './BaseAdapter.js';

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
        await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
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

    async list() {
        await this.ensureDir();
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
}

export default JsonAdapter;
