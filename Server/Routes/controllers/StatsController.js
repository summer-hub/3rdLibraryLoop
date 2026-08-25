import { StatsService } from '../../library/StatsService.js';

/**
 * StatsController —— 统计控制器
 *
 * 职责：提供访问计数和 Session 调用计数的查询接口。
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
}

export default StatsController;
