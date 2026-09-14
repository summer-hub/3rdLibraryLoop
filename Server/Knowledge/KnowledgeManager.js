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
 *     active           // 是否有效（历史软删除标记，当前 removeExperience 已改为硬删除）
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
 *   // 删除经验（物理删除 JSON 文件 + 从索引移除）
 *   await km.removeExperience(record.id);
 *
 *   // 更新经验
 *   await km.updateExperience(record.id, { tags: ['grpc', 'harmony'] });
 */

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { nowCST } from '../library/cstTime.js';
import { withSerializedLock } from '../library/AtomicJsonFile.js';

/** 知识存储子目录名（与 SubDirs 风格一致） */
const KNOWLEDGE_SUBDIR = 'Knowledge';

/**
 * 极简分词：ASCII 词 + CJK 二元组（F-25）。
 *
 * 不引第三方分词器的原因见 searchExperiences 的说明。ASCII 部分要求长度 ≥2
 * 以避免 "a"/"of" 之类噪声词命中一切文本。
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function _tokenize(text) {
    const terms = new Set();
    const s = String(text || '');
    if (!s) return terms;

    // ASCII 词（长度 ≥2，小写化）
    for (const m of s.toLowerCase().matchAll(/[a-z0-9][a-z0-9_+#.-]{1,}/g)) {
        terms.add(m[0]);
    }
    // CJK 二元组
    const cjk = s.match(/[\u4e00-\u9fff]+/g) || [];
    for (const run of cjk) {
        if (run.length === 1) {
            terms.add(run);
            continue;
        }
        for (let i = 0; i + 2 <= run.length; i++) {
            terms.add(run.slice(i, i + 2));
        }
    }
    return terms;
}

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

    /**
     * 本知识库的串行锁键（F-15）。
     *
     * 用存储根目录做键，使**同一进程内多个 KnowledgeManager 实例**
     * （每个 FlexRunner 都会各自 new 一个并 init）共享同一把锁——
     * 否则并发登记经验时索引的 read-modify-write 仍会互相覆盖。
     *
     * @returns {string}
     * @private
     */
    _lockKey() {
        return `knowledge:${this._json?.rootDir || KNOWLEDGE_SUBDIR}`;
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

        // 写入单条经验详情 + 更新索引。
        // F-15：整段包在串行锁内，并在锁内重新读取索引——
        // 原实现"先读索引、改完再写回"在并发登记时必然丢更新。
        await withSerializedLock(this._lockKey(), async () => {
            await this._json.write(id, record);

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
        });

        return record;
    }

    /**
     * 删除一条经验记录（硬删除）。
     *
     * 删除内容：
     *   1. 物理删除 db/Knowledge/{id}.json 文件
     *   2. 从 index.json 索引中移除该条目
     *
     * @param {string} id - 经验 ID
     * @returns {Promise<boolean>} 是否成功
     */
    async removeExperience(id) {
        this._ensureInit();
        if (!id) return false;

        // 注意：不再在锁外预读"确认存在"——那会与锁内状态产生时间差，
        // 存在性判断一律以锁内重新读取的结果为准。

        // 1. 物理删除单条经验详情 JSON 文件；2. 从索引中移除该条目。
        // F-15：两步骤必须在一个串行临界区内，否则与并发 addExperience 交错
        // 会让索引与详情不一致（索引有记录但文件已删，或反之）。
        let removed = false;
        await withSerializedLock(this._lockKey(), async () => {
            const current = await this._json.read(id);
            if (!current) return;
            await this._json.delete(id);
            const index = await this._readIndex();
            const filtered = index.filter(e => e.id !== id);
            await this._writeIndex(filtered);
            removed = true;
        });

        return removed;
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

        // F-15：详情写入与索引同步在同一串行临界区内，避免与其他写操作交错
        await withSerializedLock(this._lockKey(), async () => {
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
        });

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
     * 按相关性检索经验（F-25）。
     *
     * 为什么需要：原实现的检索只有 `taskId` 相等与 `taskDescription.includes()`
     * ——**没有打分、没有排序，且从未被 Agent 主链路调用**（只有 HTTP 路由在查）。
     * 也就是说"知识沉淀"只写不读，闭环并未闭合。本方法提供可用于注入 prompt
     * 的相关性排序检索。
     *
     * 实现取舍：当前为**词法打分**（关键词重合 + 技能目录匹配 + 时间新鲜度），
     * 刻意不引入 embedding——目标是"让经验真正被消费"，而不是把召回质量做到极致；
     * 向量检索属于 Phase 3 的演进项（见 docs/ROADMAP.md）。词法打分可复现、零依赖、
     * 无额外成本，对"同一领域重复踩坑"这个真实场景已足够。
     *
     * 中文分词说明：不引第三方分词器，CJK 用**二元组（bigram）**切片，
     * ASCII 词按非字母数字切分并小写化——对"任务描述相似度"这种粗粒度匹配够用。
     *
     * @param {object} [opts]
     * @param {string} [opts.query]        - 查询文本（通常是当前任务/步骤描述）
     * @param {number} [opts.limit=5]      - 最多返回条数
     * @param {number} [opts.minScore=2]   - 最低得分（过滤弱相关）
     * @param {string} [opts.skillDir]     - 当前 SKILL 目录：命中则加权
     * @param {boolean} [opts.withContent=false] - 是否附带文档正文（用于直接注入 prompt）
     * @param {number} [opts.maxContentChars=1200] - 单条正文最大字符数（withContent 时生效）
     * @returns {Promise<Array<object>>} 经验记录数组（按得分降序），含 `score` 字段
     */
    async searchExperiences(opts = {}) {
        this._ensureInit();
        const {
            query = '',
            limit = 5,
            minScore = 2,
            skillDir = null,
            withContent = false,
            maxContentChars = 1200,
        } = opts;

        const index = await this._readIndex();
        const active = index.filter((e) => e.active !== false);
        const terms = _tokenize(query);
        if (terms.size === 0) return [];

        const scored = [];
        for (const entry of active) {
            const full = await this._json.read(entry.id);
            if (!full) continue;

            const haystack = [
                full.taskDescription || '',
                (full.tags || []).join(' '),
                (full.docPath || '').split(/[\\/]/).pop() || '',
            ].join(' ');
            const hayTerms = _tokenize(haystack);

            let score = 0;
            for (const t of terms) {
                if (hayTerms.has(t)) score += 1;
            }
            // 同一 SKILL 的经验更可能可复用
            if (skillDir && full.skillDir && String(full.skillDir) === String(skillDir)) {
                score += 3;
            }
            if (score < minScore) continue;
            scored.push({ ...full, score });
        }

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        const top = scored.slice(0, Math.max(0, limit));
        if (!withContent) return top;

        // 附带正文（按预算截断）。失败不影响检索结果——经验正文缺失只是少一份上下文。
        const out = [];
        for (const rec of top) {
            let content = '';
            try {
                if (rec.docPath) {
                    const raw = await fs.readFile(rec.docPath, 'utf-8');
                    content = raw.length > maxContentChars
                        ? raw.slice(0, maxContentChars) + '\n…（已截断）'
                        : raw;
                }
            } catch {
                content = '';
            }
            out.push({ ...rec, content });
        }
        return out;
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
