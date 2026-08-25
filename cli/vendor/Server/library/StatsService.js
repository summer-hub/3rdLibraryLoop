/**
 * StatsService — 统计服务模块
 *
 * 提供统一的统计功能，供路由和 CLIController 等模块直接调用。
 * 独立于 HTTP 层，可以直接在代码中调用进行计数。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 统计数据存储路径：db/web/visit-stats.json
const STATS_DIR = process.env.WEB_STATS_ROOT
    ? process.env.WEB_STATS_ROOT
    : fileURLToPath(new URL('../../../db/web', import.meta.url));
const STATS_FILE = path.join(STATS_DIR, 'visit-stats.json');

/**
 * 确保统计目录和文件存在
 */
async function ensureStatsFile() {
    try {
        await fs.mkdir(STATS_DIR, { recursive: true });
        try {
            await fs.access(STATS_FILE);
        } catch {
            // 文件不存在，创建初始数据
            const initialData = {
                visitCount: 0,
                sessionCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await fs.writeFile(STATS_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
            console.info('统计数据文件已创建', { path: STATS_FILE });
        }
    } catch (err) {
        console.error('确保统计文件失败', { error: err.message });
        throw err;
    }
}

/**
 * 读取统计数据
 */
async function readStats() {
    await ensureStatsFile();
    const content = await fs.readFile(STATS_FILE, 'utf-8');
    return JSON.parse(content);
}

/**
 * 写入统计数据
 */
async function writeStats(data) {
    await ensureStatsFile();
    data.updatedAt = new Date().toISOString();
    await fs.writeFile(STATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
        try {
            const stats = await readStats();
            stats.visitCount += 1;
            await writeStats(stats);
            console.debug('访问计数更新', { visitCount: stats.visitCount });
            return stats.visitCount;
        } catch (err) {
            console.error('访问计数更新失败', { error: err.message });
            throw err;
        }
    }

    /**
     * 增加 Session 调用计数
     * @returns {Promise<number>} 返回更新后的 Session 调用次数
     */
    static async incrementSessionCount() {
        try {
            const stats = await readStats();
            stats.sessionCount = (stats.sessionCount || 0) + 1;
            await writeStats(stats);
            console.debug('Session 调用计数更新', { sessionCount: stats.sessionCount });
            return stats.sessionCount;
        } catch (err) {
            console.error('Session 调用计数更新失败', { error: err.message });
            // 不抛出异常，避免影响正常业务流程
            return stats?.sessionCount || 0;
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

export default StatsService;