/**
 * KnowledgeManager —— 知识沉淀系统
 *
 * 职责：
 *   1. 将 FlexRunner 执行过程中沉淀的有效经验文档路径及元信息
 *      持久化到 db/Knowledge/ 目录，实现跨任务、跨轮次的经验复用。
 *   2. 提供经验增加/删除/更新/查询接口。
 *
 * 设计原则：
 *   - 高内聚：所有知识经验的 CRUD 逻辑集中在本模块。
 *   - 低耦合：直接复用 DbUse 的 JsonAdapter（通过 createStorage 获取），
 *     不自行操作文件系统，也不引入额外的 Store 层。
 *
 * 存储复用：
 *   通过 createStorage().json('Knowledge') 获取 JsonAdapter 实例，
 *   与 SessionStore / TaskStepStore 等共享同一套适配器基础设施。
 *
 * 目录布局：
 *   db/
 *     └── Knowledge/
 *         ├── index.json              ← 经验索引（全部记录的摘要列表）
 *         └── kn_xxxx.json            ← 单条经验详情
 *
 * 单条经验记录字段：
 *   {
 *     id,              // 经验唯一 ID（kn_时间戳base36+随机hex）
 *     docPath,         // 经验文档（Summary .md）的绝对路径
 *     taskId,          // 来源任务 ID
 *     stepId,          // 来源步骤 ID
 *     bigLoopIndex,    // 来源大循环索引
 *     retryCount,      // 来源重试次数
 *     skillDir,        // SKILL 目录（无 SKILL 时为 null）
 *     taskDescription, // 任务描述（便于检索）
 *     tags,            // 标签数组
 *     createdAt,       // 创建时间（CST）
 *     updatedAt,       // 更新时间（CST）
 *     active           // 是否有效（软删除标记）
 *   }
 *
 * 使用示例：
 *   import { KnowledgeManager } from './Knowledge/KnowledgeManager.js';
 *
 *   const km = new KnowledgeManager();
 *   await km.init();
 *
 *   // 添加经验
 *   const record = await km.addExperience({
 *     docPath: '/workspace/db/task/task-001/stepId1_Summary_0.md',
 *     taskId: 'task-001',
 *     stepId: 1,
 *     taskDescription: '分析 libcurl 鸿蒙化可行性'
 *   });
 *
 *   // 查询经验
 *   const all = await km.listExperiences();
 *
 *   // 删除经验
 *   await km.removeExperience(record.id);
 *
 *   // 更新经验
 *   await km.updateExperience(record.id, { tags: ['grpc', 'harmony'] });
 */

import { randomBytes } from 'node:crypto';
import { nowCST } from '../library/cstTime.js';

/** 知识存储子目录名（与 SubDirs 风格一致） */
const KNOWLEDGE_SUBDIR = 'Knowledge';

class KnowledgeManager {
    /**
     * @param {object} [options]
     * @param {import('../DbUse/adapters/JsonAdapter.js').default} [options.jsonAdapter]
     *        注入自定义 JSON 适配器（测试用）。未注入时通过 createStorage 获取。
     * @param {Function} [options.createStorage]
     *        注入 createStorage 工厂（测试用）。未注入时惰性 import。
     */
    constructor(options = {}) {
        this._options = options;
        /** @type {import('../DbUse/adapters/JsonAdapter.js').default|null} */
        this._json = null;
        this._initialized = false;
    }

    /**
     * 初始化存储层：获取 JsonAdapter 实例。
     *
     * 优先使用注入的 jsonAdapter；否则通过 createStorage().json('Knowledge') 获取，
     * 与其他 Store 共享同一 StorageManager / 根目录。
     *
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initialized) return;

        if (this._options.jsonAdapter) {
            this._json = this._options.jsonAdapter;
        } else {
            // 复用 DbUse 的 createStorage，确保根目录与其他 Store 一致
            const createStorage = this._options.createStorage
                ? this._options.createStorage
                : (await import('../DbUse/index.js')).createStorage;
            const storage = createStorage();
            this._json = storage.json(KNOWLEDGE_SUBDIR);
        }

        this._initialized = true;
    }

    /** @private */
    _ensureInit() {
        if (!this._initialized) {
            throw new Error('KnowledgeManager 尚未初始化，请先调用 init()');
        }
    }

    // ─── 内部工具 ──────────────────────────────────────────────────────────────

    /**
     * 生成经验唯一 ID。
     * 格式: kn_<时间戳base36><随机hex>
     * @returns {string}
     * @private
     */
    _genId() {
        const ts = Date.now().toString(36);
        const rand = randomBytes(4).toString('hex');
        return `kn_${ts}${rand}`;
    }

    /**
     * 读取经验索引（全部记录的摘要列表）。
     * 索引文件不存在时返回空数组。
     * @returns {Promise<object[]>}
     * @private
     */
    async _readIndex() {
        const idx = await this._json.read('index');
        return Array.isArray(idx) ? idx : [];
    }

    /**
     * 写入经验索引。
     * @param {object[]} index - 索引数组
     * @returns {Promise<void>}
     * @private
     */
    async _writeIndex(index) {
        await this._json.write('index', index);
    }

    // ─── 公开接口 ──────────────────────────────────────────────────────────────

    /**
     * 添加一条经验记录。
     *
     * @param {object} entry - 经验信息
     * @param {string} entry.docPath        - 经验文档路径（必填）
     * @param {string} [entry.taskId]       - 来源任务 ID
     * @param {number} [entry.stepId]       - 来源步骤 ID
     * @param {number} [entry.bigLoopIndex] - 来源大循环索引
     * @param {number} [entry.retryCount]   - 来源重试次数
     * @param {string} [entry.skillDir]     - SKILL 目录（无 SKILL 时为 null）
     * @param {string} [entry.taskDescription] - 任务描述
     * @param {string[]} [entry.tags]       - 标签数组
     * @returns {Promise<object>} 创建的经验记录（含 id）
     */
    async addExperience(entry = {}) {
        this._ensureInit();

        if (!entry.docPath) {
            throw new Error('KnowledgeManager.addExperience: docPath 为必填项');
        }

        const id = this._genId();
        const now = nowCST();
        const record = {
            id,
            docPath: entry.docPath,
            taskId: entry.taskId || '',
            stepId: entry.stepId || 0,
            bigLoopIndex: entry.bigLoopIndex || 0,
            retryCount: entry.retryCount || 0,
            skillDir: entry.skillDir || null,
            taskDescription: entry.taskDescription || '',
            tags: Array.isArray(entry.tags) ? entry.tags : [],
            createdAt: now,
            updatedAt: now,
            active: true
        };

        // 写入单条经验详情
        await this._json.write(id, record);

        // 更新索引
        const index = await this._readIndex();
        index.push({
            id,
            docPath: record.docPath,
            taskId: record.taskId,
            taskDescription: record.taskDescription,
            createdAt: now,
            active: true
        });
        await this._writeIndex(index);

        return record;
    }

    /**
     * 删除一条经验记录（软删除，标记 active=false）。
     *
     * @param {string} id - 经验 ID
     * @returns {Promise<boolean>} 是否成功
     */
    async removeExperience(id) {
        this._ensureInit();
        if (!id) return false;

        const record = await this._json.read(id);
        if (!record) return false;

        record.active = false;
        record.updatedAt = nowCST();
        await this._json.write(id, record);

        // 更新索引
        const index = await this._readIndex();
        const idx = index.findIndex(e => e.id === id);
        if (idx >= 0) {
            index[idx].active = false;
            await this._writeIndex(index);
        }

        return true;
    }

    /**
     * 更新一条经验记录（合并字段）。
     *
     * @param {string} id - 经验 ID
     * @param {object} patch - 要更新的字段
     * @returns {Promise<object|null>} 更新后的完整记录，不存在时返回 null
     */
    async updateExperience(id, patch = {}) {
        this._ensureInit();
        if (!id) return null;

        const record = await this._json.read(id);
        if (!record) return null;

        const updated = {
            ...record,
            ...patch,
            id: record.id,             // id 不可变
            createdAt: record.createdAt, // 创建时间不可变
            updatedAt: nowCST()
        };
        await this._json.write(id, updated);

        // 同步索引中的可变字段
        const index = await this._readIndex();
        const idx = index.findIndex(e => e.id === id);
        if (idx >= 0) {
            if (patch.docPath) index[idx].docPath = patch.docPath;
            if (patch.taskDescription) index[idx].taskDescription = patch.taskDescription;
            if (typeof patch.active === 'boolean') index[idx].active = patch.active;
            await this._writeIndex(index);
        }

        return updated;
    }

    /**
     * 根据 ID 获取单条经验记录。
     *
     * @param {string} id - 经验 ID
     * @returns {Promise<object|null>} 经验记录，不存在时返回 null
     */
    async getExperience(id) {
        this._ensureInit();
        if (!id) return null;
        return this._json.read(id);
    }

    /**
     * 列出所有有效经验（active=true）。
     *
     * @param {object} [filter] - 过滤条件
     * @param {string} [filter.taskId] - 按任务 ID 过滤
     * @param {string} [filter.taskDescription] - 按任务描述模糊匹配
     * @returns {Promise<object[]>} 经验记录数组（按创建时间倒序）
     */
    async listExperiences(filter = {}) {
        this._ensureInit();

        const index = await this._readIndex();
        let entries = index.filter(e => e.active !== false);

        if (filter.taskId) {
            entries = entries.filter(e => e.taskId === filter.taskId);
        }
        if (filter.taskDescription) {
            const kw = filter.taskDescription.toLowerCase();
            entries = entries.filter(e =>
                (e.taskDescription || '').toLowerCase().includes(kw)
            );
        }

        // 按创建时间倒序
        entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        // 返回完整记录
        const result = [];
        for (const entry of entries) {
            const full = await this._json.read(entry.id);
            if (full) result.push(full);
        }
        return result;
    }

    /**
     * 根据文档路径查找经验记录。
     * 用于判断某个 Summary .md 是否已登记到知识系统。
     *
     * @param {string} docPath - 经验文档路径
     * @returns {Promise<object|null>} 经验记录，不存在时返回 null
     */
    async findByDocPath(docPath) {
        this._ensureInit();
        if (!docPath) return null;

        const index = await this._readIndex();
        const entry = index.find(e => e.docPath === docPath && e.active !== false);
        if (!entry) return null;
        return this._json.read(entry.id);
    }
}

export default KnowledgeManager;
