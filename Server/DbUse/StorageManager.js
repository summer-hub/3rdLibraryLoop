import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import JsonAdapter from './adapters/JsonAdapter.js';
import JsonlAdapter from './adapters/JsonlAdapter.js';
import SqliteAdapter from './adapters/SqliteAdapter.js';
import FileAdapter from './adapters/FileAdapter.js';

/**
 * StorageManager —— 统一存储管理器
 *
 * 职责：
 *   1. 集中解析存储根目录（db/），所有适配器共享同一根，避免路径散落。
 *   2. 按子域（subDir）创建并缓存适配器实例，同一子域复用同一实例。
 *   3. 提供工厂方法 get(type, subDir)，对上层 Store 屏蔽适配器构造细节。
 *   4. 统一生命周期管理（closeAll）。
 *
 * 分层关系：
 *   ┌─────────────────────────────────────────────┐
 *   │  Store 层 (SessionStore / TaskStepStore)    │  业务语义
 *   ├─────────────────────────────────────────────┤
 *   │  StorageManager                             │  工厂/注册表/根目录
 *   ├─────────────────────────────────────────────┤
 *   │  Adapter 层 (Json/Jsonl/Sqlite/File)        │  存储格式实现
 *   └─────────────────────────────────────────────┘
 *
 * 扩展方式：
 *   - 新增存储格式：实现 BaseAdapter 子类 → 注册到 _ADAPTERS → Manager 自动可用
 *   - 新增业务存储：实现 Store，依赖 Manager.get() 获取适配器，不感知格式
 */
class StorageManager {
    /**
     * @param {object} [options]
     * @param {string} [options.rootDir] - 存储根目录绝对路径。默认落在**仓库所在目录的上一级**下的 db/
     */
    constructor(options = {}) {
        if (options.rootDir) {
            this.rootDir = options.rootDir;
        } else if (process.env['3LIB_DATA_DIR']) {
            // CLI 数据目录策略（与 WEB_STATS_ROOT 同模式）：
            // 3rdloop serve/run 等命令将解析后的数据目录注入 env，
            // 使内部所有自建 createStorage()（FlexRunner/KnowledgeManager/
            // MessageArchive 等）统一落到用户数据目录，而非模块相对路径。
            this.rootDir = resolve(process.env['3LIB_DATA_DIR']);
        } else {
            // 本文件 (Server/DbUse/) 上溯 3 层 = **仓库所在目录的上一级** → 其下的 db/
            // （注意：不是"仓库根"——实测默认 rootDir 为 <仓库父目录>\db）
            const here = dirname(fileURLToPath(import.meta.url));
            this.rootDir = join(here, '..', '..', '..', 'db');
        }
        /** @type {Map<string, import('./adapters/BaseAdapter.js').default>} */
        this._instances = new Map();
    }

    static get _ADAPTERS() {
        return {
            json: JsonAdapter,
            jsonl: JsonlAdapter,
            sqlite: SqliteAdapter,
            file: FileAdapter
        };
    }

    /**
     * 获取（或创建）指定类型与子域的适配器实例。
     * 同一 (type, subDir) 复用同一实例。
     *
     * @param {'json'|'jsonl'|'sqlite'|'file'} type - 适配器类型
     * @param {string} subDir - 根目录下的子域（如 'Session'、'TaskStep'、'Artifacts'）
     * @param {object} [adapterOpts] - 传递给适配器的额外选项
     * @returns {import('./adapters/BaseAdapter.js').default}
     */
    get(type, subDir, adapterOpts = {}) {
        const AdapterClass = StorageManager._ADAPTERS[type];
        if (!AdapterClass) {
            throw new Error(
                `未知的存储类型: "${type}"，可选: ${Object.keys(StorageManager._ADAPTERS).join(', ')}`
            );
        }
        const cacheKey = `${type}:${subDir}`;
        let instance = this._instances.get(cacheKey);
        if (!instance) {
            instance = new AdapterClass({
                baseDir: this.rootDir,
                subDir,
                ...adapterOpts
            });
            this._instances.set(cacheKey, instance);
        }
        return instance;
    }

    /** 便捷方法 */
    json(subDir, opts) { return this.get('json', subDir, opts); }
    jsonl(subDir, opts) { return this.get('jsonl', subDir, opts); }
    sqlite(subDir, opts) { return this.get('sqlite', subDir, opts); }
    file(subDir, opts) { return this.get('file', subDir, opts); }

    /**
     * 关闭所有适配器（释放数据库连接等）。
     */
    async closeAll() {
        const tasks = [];
        for (const instance of this._instances.values()) {
            if (typeof instance.close === 'function') {
                tasks.push(Promise.resolve(instance.close()).catch(() => {}));
            }
        }
        await Promise.all(tasks);
        this._instances.clear();
    }
}

export default StorageManager;
