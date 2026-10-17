/**
 * StatsService — 统计服务模块（实现已迁入 `plugins/stats/core`）
 *
 * 提供统一的统计功能，供路由和 CLIController 等模块直接调用。
 * 独立于 HTTP 层，可以直接在代码中调用进行计数。
 *
 * 迁移说明（原 `Server/library/StatsService.js` 整体搬入，逻辑逐行不变）：
 *   - `AtomicJsonFile` 的 import 改为同目录副本 `./AtomicJsonFile.js`（arch-guard R2
 *     禁止插件引用 `Server/`，也禁止跨插件 import），因此下面的数据目录按**本文件
 *     的新位置**重新数了 `../` 层数，解析出的绝对路径与迁移前完全一致
 *     （`<repo 上一级>/db/web/visit-stats.json`——注意原实现就是上溯三级，
 *     不是 `<repo>/db/web`，此处刻意保持原样，不顺手"修"成别的目录）。
 *
 * F-14：原实现是无锁的 read-modify-write，且用 `fs.writeFile` 直接截断重写：
 *   - 并发调用（每次 startSession 都会调一次）会丢更新：
 *     A/B 同读一份快照各自 +1 写回，最终只 +1；
 *   - 两个写入交错会让读者看到被截断的 JSON，解析失败后静默降级，
 *     表现为"统计数据莫名清零"。
 * 现统一走 AtomicJsonFile：原子写（tmp + rename）+ 按文件串行化的读改写。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, updateJson } from './AtomicJsonFile.js';

// 统计数据存储路径：db/web/visit-stats.json
// 层数与迁移前等价：Server/library/ 与 plugins/stats/core/lib/ 对仓库根的相对深度
// 分别是 2 层与 4 层，故这里多一个 `../`，解析结果仍是同一个绝对目录。
const STATS_DIR = process.env.WEB_STATS_ROOT
    ? process.env.WEB_STATS_ROOT
    : fileURLToPath(new URL('../../../../../db/web', import.meta.url));
const STATS_FILE = path.join(STATS_DIR, 'visit-stats.json');

/** 初始统计结构（文件不存在或损坏时的兜底） */
function initialStats() {
    return {
        visitCount: 0,
        sessionCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

const onCorrupt = (msg) => console.warn(`[StatsService] ${msg}（按初始值处理）`);

/**
 * 读取统计数据（不存在或损坏时返回初始结构）
 */
async function readStats() {
    const stats = await readJson(STATS_FILE, null, { onCorrupt });
    if (!stats || typeof stats !== 'object') return initialStats();
    return stats;
}

/**
 * 原子地更新统计数据（并发安全）。
 *
 * mutator 在串行锁内基于**磁盘最新值**执行，因此并发 +1 不会丢更新。
 *
 * @param {(stats: object) => object} mutator
 * @returns {Promise<object>} 更新后的统计
 */
async function patchStats(mutator) {
    return updateJson(STATS_FILE, (current) => {
        const base = (current && typeof current === 'object') ? current : initialStats();
        const next = mutator(base);
        next.updatedAt = new Date().toISOString();
        return next;
    }, { indent: 2, onCorrupt });
}

/**
 * 统计服务类
 */
export class StatsService {
    /**
     * 增加访问计数
     * @returns {Promise<number>} 返回更新后的访问次数
     */
    static async incrementVisitCount() {
        const stats = await patchStats((s) => {
            s.visitCount = (s.visitCount || 0) + 1;
            return s;
        });
        console.debug('访问计数更新', { visitCount: stats.visitCount });
        return stats.visitCount;
    }

    /**
     * 增加 Session 调用计数
     * @returns {Promise<number>} 返回更新后的 Session 调用次数
     */
    static async incrementSessionCount() {
        try {
            const stats = await patchStats((s) => {
                s.sessionCount = (s.sessionCount || 0) + 1;
                return s;
            });
            console.debug('Session 调用计数更新', { sessionCount: stats.sessionCount });
            return stats.sessionCount;
        } catch (err) {
            console.error('Session 调用计数更新失败', { error: err.message });
            // 不抛出异常，避免影响正常业务流程
            return 0;
        }
    }

    /**
     * 获取当前访问计数
     * @returns {Promise<number>}
     */
    static async getVisitCount() {
        const stats = await readStats();
        return stats.visitCount || 0;
    }

    /**
     * 获取当前 Session 调用计数
     * @returns {Promise<number>}
     */
    static async getSessionCount() {
        const stats = await readStats();
        return stats.sessionCount || 0;
    }

    /**
     * 获取完整统计数据
     * @returns {Promise<object>}
     */
    static async getAllStats() {
        return await readStats();
    }
}

/** 仅供测试：暴露统计文件路径 */
export const STATS_FILE_PATH = STATS_FILE;

export default StatsService;
