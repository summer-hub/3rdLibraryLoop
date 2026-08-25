import { CLIController } from '../../CLI/cli.js';

/**
 * HealthController —— 健康检查控制器
 *
 * 职责：封装大模型 CLI 健康检查的业务逻辑。
 * 不感知 HTTP 层细节，只接收 RequestContext / ResponseContext。
 *
 * 依赖：CLIController（通过构造注入，复用同一实例）
 */
class HealthController {
    /**
     * @param {CLIController} cli - CLI 控制器实例
     */
    constructor(cli) {
        this.cli = cli;
    }

    /**
     * GET /api/health
     * 检测大模型 CLI 服务状态
     */
    async check(req, res) {
        const result = await this.cli.checkHealth();
        res.json({
            ...result,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * GET /api/health/ping
     * 轻量探活（不调用外部服务，仅验证后端自身存活）
     */
    async ping(req, res) {
        res.json({
            status: 'ok',
            message: 'pong',
            timestamp: new Date().toISOString()
        });
    }
}

export default HealthController;
