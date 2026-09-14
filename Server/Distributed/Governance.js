/**
 * Governance —— 成本计量与合规审计（Phase 4）
 *
 * 这两件事放在一起，因为它们服务同一个目的：**回答"钱花在哪了、为什么这么决策"**。
 * ROADMAP 明确指出现状"完全缺失"：`llmClient` 甚至丢弃响应里的 tokens/cost。
 *
 * ## CostMeter：token 计量与配额熔断
 *
 * 三个必须做对的点：
 *   1. **记录 usage 而不是"调用次数"**：不同模型的单价差 10 倍以上，
 *      只数调用次数无法做成本治理。
 *   2. **按租户聚合 + 按"调用来源"下钻**：需要能回答"这个任务的成本里
 *      多少花在 SKILL 匹配（SkillSelector 的两次 LLM 调用）、多少花在真正的执行"。
 *      这直接决定优化方向——本项目里 SKILL 匹配是固定成本，执行是大头。
 *   3. **配额熔断要在"调用前"预检 + "调用后"回填**：只做事后统计等于没有治理
 *      （钱已经花完了）。预检拦不住单次超大头，因此还要有"单次调用上限"。
 *
 * ## AuditLog：哈希链保证可回溯且**可验证未被篡改**
 *
 * 合规审计的价值全在"事后可信"。普通 append-only 日志的问题是无法证明没被改过
 * （尤其是被有权限的人改过）。这里用哈希链：
 *   `entryHash = sha256(prevHash + canonical(entry))`
 * 任何一条记录被修改/删除都会让后续所有 hash 不匹配——`verify()` 一次全链校验。
 *
 * 诚实边界：哈希链防的是**篡改**，不防**伪造**（拥有写权限的人可以重算整条链）。
 * 真正的抗抵赖需要外部锚定（定期把链尾 hash 写入只写介质/第三方）。本模块的
 * `getChainHead()` 就是给外部锚定用的接口。
 */

import { createHash } from 'node:crypto';

import { nowCST } from '../library/cstTime.js';

/** 内置模型的计价表（USD / 1K tokens）。**价格会变，因此必须可注入而不是写死在逻辑里**。 */
export const DEFAULT_PRICING = Object.freeze({
    'deepseek-v4-flash': Object.freeze({ input: 0.0002, output: 0.0008 }),
    'gpt-4o-mini': Object.freeze({ input: 0.00015, output: 0.0006 }),
    'qwen-plus': Object.freeze({ input: 0.0004, output: 0.0012 }),
    /** 未知模型：用最贵档估算，宁可高估（避免因"未知模型免费"而失控） */
    __unknown__: Object.freeze({ input: 0.005, output: 0.015 })
});

/**
 * LLM 成本计量器。
 */
export class CostMeter {
    /**
     * @param {object} [opts]
     * @param {object} [opts.pricing]         - 覆盖计价表
     * @param {number} [opts.singleCallMaxUsd] - 单次调用上限（超过即视为异常，需人工确认）
     * @param {(level: string, msg: string) => void} [opts.logger]
     */
    constructor(opts = {}) {
        this.pricing = { ...DEFAULT_PRICING, ...(opts.pricing || {}) };
        this.singleCallMaxUsd = Number.isFinite(opts.singleCallMaxUsd) ? opts.singleCallMaxUsd : 1;
        this._logger = typeof opts.logger === 'function' ? opts.logger : null;
        /** @type {object[]} 明细记录（有界） */
        this._records = [];
        this.maxRecords = Number.isInteger(opts.maxRecords) && opts.maxRecords > 0 ? opts.maxRecords : 20000;
        this._stats = { calls: 0, totalUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, missingUsage: 0, oversizeCalls: 0 };
    }

    /**
     * 估算一次调用的成本（调用前预检用，只需 prompt 长度）。
     *
     * @param {object} p
     * @param {string} p.model
     * @param {number} p.inputTokens
     * @param {number} [p.expectedOutputTokens=1000]
     * @returns {number} USD
     */
    estimate({ model, inputTokens, expectedOutputTokens = 1000 }) {
        const price = this.pricing[model] || this.pricing.__unknown__;
        return (inputTokens / 1000) * price.input + (expectedOutputTokens / 1000) * price.output;
    }

    /**
     * 记录一次真实调用。
     *
     * `usage` 缺失时**不做静默估算**——而是显式计入 `missingUsage`。
     * 理由：把"没拿到 usage"当成"0 成本"会让成本报表系统性偏低，
     * 而这种偏低不会有任何提示；显式计数才能暴露"上游没返回 usage"这一事实。
     *
     * @param {object} p
     * @param {string} p.model
     * @param {object} [p.usage]        - `{prompt_tokens, completion_tokens}` 或 `{input, output}`
     * @param {string} [p.tenantId]
     * @param {string} [p.taskId]
     * @param {string} [p.stepId]
     * @param {string} [p.role]
     * @param {string} [p.purpose]      - 如 `skill-selection` / `execute` / `summarize` / `review`
     * @param {number} [p.durationMs]
     * @returns {object} 计量结果（含 costUsd）
     */
    record(p) {
        const input = Number(p.usage?.prompt_tokens ?? p.usage?.input ?? 0) || 0;
        const output = Number(p.usage?.completion_tokens ?? p.usage?.output ?? 0) || 0;
        const price = this.pricing[p.model] || this.pricing.__unknown__;
        const costUsd = (input / 1000) * price.input + (output / 1000) * price.output;

        if (!p.usage) this._stats.missingUsage++;
        if (costUsd > this.singleCallMaxUsd) {
            this._stats.oversizeCalls++;
            this._log('warn',
                `单次调用成本 $${costUsd.toFixed(4)} 超过上限 $${this.singleCallMaxUsd}` +
                `（model=${p.model} in=${input} out=${output} purpose=${p.purpose || '-'}）`);
        }

        const rec = {
            at: nowCST(),
            model: p.model,
            purpose: p.purpose || 'unknown',
            tenantId: p.tenantId || 'unknown',
            taskId: p.taskId || null,
            stepId: p.stepId ?? null,
            role: p.role || null,
            inputTokens: input,
            outputTokens: output,
            costUsd: Number(costUsd.toFixed(6)),
            durationMs: p.durationMs ?? null,
            usageMissing: !p.usage
        };

        if (this._records.length >= this.maxRecords) this._records.shift();
        this._records.push(rec);
        this._stats.calls++;
        this._stats.totalUsd += costUsd;
        this._stats.totalInputTokens += input;
        this._stats.totalOutputTokens += output;
        return rec;
    }

    /**
     * 聚合报表。
     *
     * @param {object} [filter]
     * @param {string} [filter.tenantId]
     * @param {string} [filter.taskId]
     * @param {'purpose'|'model'|'tenantId'|'role'} [filter.by='purpose']
     * @returns {{totalUsd: number, calls: number, byKey: object}}
     */
    report(filter = {}) {
        const by = filter.by || 'purpose';
        const rows = this._records.filter((r) =>
            (!filter.tenantId || r.tenantId === filter.tenantId)
            && (!filter.taskId || r.taskId === filter.taskId));
        const byKey = {};
        let totalUsd = 0;
        for (const r of rows) {
            const k = String(r[by] ?? 'unknown');
            if (!byKey[k]) byKey[k] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
            byKey[k].calls++;
            byKey[k].inputTokens += r.inputTokens;
            byKey[k].outputTokens += r.outputTokens;
            byKey[k].costUsd = Number((byKey[k].costUsd + r.costUsd).toFixed(6));
            totalUsd += r.costUsd;
        }
        return { totalUsd: Number(totalUsd.toFixed(6)), calls: rows.length, byKey };
    }

    /**
     * 任务级成本（SLA 的"单任务成本上限"依据）。
     * @param {string} taskId
     * @returns {number} USD
     */
    taskCost(taskId) {
        return Number(this._records
            .filter((r) => r.taskId === taskId)
            .reduce((a, r) => a + r.costUsd, 0).toFixed(6));
    }

    /**
     * 成本熔断器：按租户累计成本超过预算时打开。
     *
     * 与 Phase 1 的 `CircuitBreaker`（防"打不通的接口"）不同，
     * 这里防的是"能打通但会烧钱"——两者都需要，且触发条件不同。
     */
    createBudgetBreaker({ tenantId, budgetUsd, windowMs = 86400000 }) {
        const meter = this;
        return {
            tenantId,
            budgetUsd,
            windowMs,
            get spentUsd() {
                // 语义是**滚动窗口内的花费**（最近 windowMs），而不是"自熔断器创建以来"。
                //
                // 这里修掉过一个真实缺陷：原先的过滤条件里还有一条
                // `Date.parse(r.at) >= startedAt`（熔断器创建时刻），
                // 于是"在已有花费之后才创建熔断器"时统计恒为 0 ——
                // 也就是**一个在超支后才建立的熔断器会认为当前没花钱**，
                // 完全失去拦截作用。成本统计必须只看窗口，不看"我是什么时候开始看的"。
                const since = Date.now() - windowMs;
                return Number(meter._records
                    .filter((r) => r.tenantId === tenantId && Date.parse(r.at) >= since)
                    .reduce((a, r) => a + r.costUsd, 0).toFixed(6));
            },
            get open() {
                return this.spentUsd >= budgetUsd;
            },
            /** 调用前预检：预算已用尽则拒绝 */
            check() {
                const spent = this.spentUsd;
                if (spent >= budgetUsd) {
                    return { allowed: false, reason: 'budget-exceeded', spentUsd: spent, budgetUsd };
                }
                return { allowed: true, spentUsd: spent, budgetUsd };
            }
        };
    }

    /** @returns {object} */
    getStats() {
        return {
            ...this._stats,
            totalUsd: Number(this._stats.totalUsd.toFixed(6)),
            records: this._records.length,
            maxRecords: this.maxRecords
        };
    }

    /** @private */
    _log(level, msg) {
        if (this._logger) this._logger(level, `[CostMeter] ${msg}`);
    }
}

/**
 * 审计日志（哈希链）。
 *
 * 每条记录：
 * ```
 * { seq, at, actor, tenantId, action, resource, outcome, detail, prevHash, entryHash }
 * ```
 * `entryHash = sha256(prevHash + JSON.stringify(canonical(entry 去掉 entryHash)))`
 *
 * `verify()` 从头重算整条链并逐条比对：任何改动（改内容、删条目、换顺序）
 * 都会在第一个不一致处暴露，并给出精确的 `seq`。
 */
export class AuditLog {
    /**
     * @param {object} [opts]
     * @param {number} [opts.maxEntries=50000]
     * @param {string} [opts.genesis='3lib-genesis']
     */
    constructor(opts = {}) {
        this.maxEntries = Number.isInteger(opts.maxEntries) && opts.maxEntries > 0 ? opts.maxEntries : 50000;
        this.genesis = opts.genesis || '3lib-genesis';
        /** @type {object[]} */
        this._entries = [];
        this._seq = 0;
        /** 被淘汰的最早一条的 hash：淘汰后链无法从头校验，因此必须显式记录链的起点 */
        this._baseHash = this.genesis;
        this._baseSeq = 0;
    }

    /**
     * 追加一条审计记录。
     *
     * @param {object} p
     * @param {string} p.actor      - 谁（用户/服务）
     * @param {string} p.action     - 做了什么（如 `task.abort` / `llm.call` / `role.decision`）
     * @param {string} [p.tenantId]
     * @param {string} [p.resource]
     * @param {string} [p.outcome='ok']
     * @param {object} [p.detail]
     * @returns {object} 写入的记录（含 entryHash）
     */
    append(p) {
        if (!p?.actor || !p?.action) {
            throw new Error('AuditLog.append: actor 与 action 为必填');
        }
        const prevHash = this._entries.length
            ? this._entries[this._entries.length - 1].entryHash
            : this._baseHash;

        const base = {
            seq: ++this._seq,
            at: nowCST(),
            actor: p.actor,
            tenantId: p.tenantId || 'unknown',
            action: p.action,
            resource: p.resource || null,
            outcome: p.outcome || 'ok',
            detail: p.detail || null,
            prevHash
        };
        const entry = { ...base, entryHash: AuditLog.hashEntry(base) };

        this._entries.push(entry);
        if (this._entries.length > this.maxEntries) {
            const evicted = this._entries.shift();
            this._baseHash = evicted.entryHash;
            this._baseSeq = evicted.seq;
        }
        return { ...entry };
    }

    /**
     * 计算条目 hash。
     * @param {object} entry - 不含 entryHash
     * @returns {string}
     */
    static hashEntry(entry) {
        const canonical = AuditLog.canonicalize(entry);
        return createHash('sha256').update(canonical).digest('hex');
    }

    /**
     * 规范化（键按字典序，保证与插入顺序无关）。
     * @param {*} value
     * @returns {string}
     */
    static canonicalize(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
        if (Array.isArray(value)) return `[${value.map((v) => AuditLog.canonicalize(v)).join(',')}]`;
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${AuditLog.canonicalize(value[k])}`).join(',')}}`;
    }

    /**
     * 校验整条链。
     *
     * @returns {{ok: boolean, checked: number, brokenAt?: number, reason?: string,
     *   chainHead: string, baseSeq: number}}
     */
    verify() {
        let prev = this._baseHash;
        for (const e of this._entries) {
            if (e.prevHash !== prev) {
                return {
                    ok: false, checked: this._entries.length, brokenAt: e.seq,
                    reason: `prevHash 不连续（期望 ${prev.slice(0, 12)}…，实际 ${String(e.prevHash).slice(0, 12)}…）`,
                    chainHead: this.getChainHead(), baseSeq: this._baseSeq
                };
            }
            const { entryHash, ...rest } = e;
            const expect = AuditLog.hashEntry(rest);
            if (expect !== entryHash) {
                return {
                    ok: false, checked: this._entries.length, brokenAt: e.seq,
                    reason: 'entryHash 与内容不匹配（记录被修改）',
                    chainHead: this.getChainHead(), baseSeq: this._baseSeq
                };
            }
            prev = entryHash;
        }
        return { ok: true, checked: this._entries.length, chainHead: this.getChainHead(), baseSeq: this._baseSeq };
    }

    /**
     * 链尾 hash（供外部锚定：写入只写介质/第三方，才能真正抗抵赖）。
     * @returns {string}
     */
    getChainHead() {
        return this._entries.length ? this._entries[this._entries.length - 1].entryHash : this._baseHash;
    }

    /**
     * 查询（审计读取本身也应被记录——这里只提供查询，由调用方负责记一条 `audit.read`）。
     *
     * @param {object} [filter]
     * @param {string} [filter.tenantId]
     * @param {string} [filter.actor]
     * @param {string} [filter.action]
     * @param {number} [filter.limit=100]
     * @returns {object[]}
     */
    query(filter = {}) {
        const limit = Number.isInteger(filter.limit) && filter.limit > 0 ? filter.limit : 100;
        return this._entries
            .filter((e) => (!filter.tenantId || e.tenantId === filter.tenantId)
                && (!filter.actor || e.actor === filter.actor)
                && (!filter.action || e.action === filter.action))
            .slice(-limit)
            .map((e) => ({ ...e }));
    }

    /**
     * **仅供测试**：篡改一条记录（用于验证 verify 能发现）。
     * 生产代码不应调用——它的存在使"审计可被篡改"成为可能，
     * 因此刻意用显式命名标注其用途。
     *
     * @param {number} seq
     * @param {object} patch
     * @returns {boolean}
     */
    _tamperForTest(seq, patch) {
        const e = this._entries.find((x) => x.seq === seq);
        if (!e) return false;
        Object.assign(e, patch);
        return true;
    }

    /** @returns {number} */
    get size() {
        return this._entries.length;
    }

    /** @returns {object} */
    getStats() {
        return {
            size: this._entries.length,
            maxEntries: this.maxEntries,
            baseSeq: this._baseSeq,
            chainHead: this.getChainHead(),
            lastVerified: this.verify().ok
        };
    }
}

export default AuditLog;
