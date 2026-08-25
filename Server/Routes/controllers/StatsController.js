import { StatsService } from '../../library/StatsService.js';
import { getSessionSemaphoreStats } from '../../Orchestrator/Orchestrator.js';

/**
 * StatsController —— 统计控制器
 *
 * 职责：提供访问计数、Session 调用计数、Session 并发占用的查询接口。
 */
class StatsController {

    /**
     * GET /api/stats/visit
     * 获取页面访问计数，并自增（每次页面加载调用一次）
     */
    async visit(req, res) {
        try {
            const count = await StatsService.incrementVisitCount();
            res.json({ success: true, data: { visitCount: count } });
        } catch (err) {
            res.json({ success: false, data: { visitCount: 0 }, error: err.message });
        }
    }

    /**
     * GET /api/stats/session/count
     * 获取 Session 调用计数（只读，不自增）
     */
    async sessionCount(req, res) {
        try {
            const count = await StatsService.getSessionCount();
            res.json({ success: true, data: { sessionCount: count } });
        } catch (err) {
            res.json({ success: false, data: { sessionCount: 0 }, error: err.message });
        }
    }

    /**
     * GET /api/stats/session/concurrency
     * 获取全局 Session 并发占用快照（Orchestrator 进程级信号量）。
     *
     * 返回：
     *   active   - 当前活跃 Session 数（正在执行的编排步骤数）
     *   limit    - 并发上限（MAX_CONCURRENT_SESSIONS，默认 50）
     *   waiting  - 排队等待槽位的步骤数
     *   utilization - 占用率（0-100）
     */
    async sessionConcurrency(req, res) {
        try {
            const stats = getSessionSemaphoreStats();
            res.json({ success: true, data: stats });
        } catch (err) {
            res.json({ success: false, data: null, error: err.message });
        }
    }
}

export default StatsController;
