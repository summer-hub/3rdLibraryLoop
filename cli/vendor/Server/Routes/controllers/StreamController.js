import SseHub from '../sse/SseHub.js';

/**
 * StreamController —— SSE 实时推送控制器
 *
 * 职责：处理 SSE 订阅请求，将 HTTP 响应注册到 SseHub。
 * 不感知具体业务事件（步骤状态等），只负责连接管理。
 *
 * 事件由业务层（Agent Loop）通过 sseHub.emit() 推送，本控制器不产生事件。
 */
class StreamController {
    /**
     * @param {SseHub} sseHub
     */
    constructor(sseHub) {
        this.sseHub = sseHub;
    }

    /**
     * GET /stream/tasks/:taskId
     * 订阅指定任务的实时事件流
     *
     * 前端用法：
     *   const es = new EventSource('/stream/tasks/task-xxx');
     *   es.addEventListener('step:status', (e) => { ... });
     *   es.addEventListener('step:completed', (e) => { ... });
     */
    async subscribeTask(req, res) {
        const { taskId } = req.params;
        const userId = req.query.userId || 'anonymous';

        // 响应头已在 ResponseContext.stream() 中设置
        res.stream();

        const result = this.sseHub.subscribe(taskId, res.raw, {
            userId,
            initialData: {
                taskId,
                message: 'SSE 连接已建立',
                timestamp: new Date().toISOString()
            }
        });

        if (!result.ok) {
            // 订阅被拒（限流等），已写入流头无法改 HTTP 状态码，
            // 通过 SSE 事件通知客户端后关闭连接
            this.sseHub.emit(taskId, 'error', {
                code: result.errorCode,
                message: result.message
            });
            res.raw.end();
        }
    }

    /**
     * GET /stream/stats
     * 返回 SSE Hub 全局统计信息（REST 接口，非 SSE 流）
     */
    async stats(req, res) {
        res.json({
            ...this.sseHub.getStats(),
            timestamp: new Date().toISOString()
        });
    }
}

export default StreamController;
