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

        // F-10：连接身份不再退化为共享常量。
        // 初版 `req.query.userId || 'anonymous'` 使所有浏览器连接共用同一个
        // 'anonymous' 桶，于是"单用户上限 10"实际变成了**全进程 10 连接硬上限**，
        // 第 11 个订阅者（任意标签页/任意任务）都会被拒。
        // 现在：查询参数仍可用于"同一客户端多标签页"的场景，但缺省时按连接生成
        // 独立标识；真正的保护边界是 SseHub 的全局连接上限。
        // 注意：查询参数不是安全边界（客户端可伪造），仅用于归组与展示。
        const userId = String(req.query.userId || `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

        // F-10：**先准入、后写响应头**。
        // 初版先调 res.stream() 发出 200 + SSE 头，再 subscribe，被限流时既无法
        // 返回 429，还把 error 事件广播给了该频道的其他订阅者，被拒客户端只能
        // 看到"连上即断"，触发 EventSource 自动重连风暴。
        const admission = this.sseHub.canSubscribe(userId);
        if (!admission.ok) {
            return res.error(429, admission.message, {
                code: admission.errorCode,
                retryAfterSeconds: 5,
            });
        }

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
            // 到这里响应头已发出（无法改状态码）：直接结束流即可。
            // 不再向频道广播 error——那会打扰其他正常订阅者。
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
