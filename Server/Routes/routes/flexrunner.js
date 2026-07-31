import { Router } from '../router/Router.js';
import FlexRunnerController from '../controllers/FlexRunnerController.js';

/**
 * FlexRunner 路由注册
 *
 * 挂载点：/api/flexrunner/*
 *
 * 路由列表：
 *  POST   /init              — 初始化 FlexRunner 实例
 *  POST   /execute           — 执行单次 executeStart
 *  POST   /execute-loop      — 自动循环执行直到成功/不可重试
 *  GET    /status            — 查询实例状态
 *  GET    /live-messages     — 获取实时对话消息
 *  GET    /session           — 获取会话归档内容
 *  POST   /control           — 控制执行（暂停/继续/终止）
 *  POST   /check-result      — 检查结果文件状态
 *  POST   /inject-prompt     — 向会话注入提示词（不触发 AI 回复）
 *  POST   /send-and-wait     — 发送消息并同步等待 AI 回复
 *  GET    /steps             — 列出任务步骤和文件
 *  GET    /file              — 读取指定文件内容
 *  GET    /runners           — 列出所有已注册实例
 *  DELETE /runner            — 移除一个实例
 *
 * @param {object} dependencies - 共享依赖
 * @returns {Router}
 */
export function createFlexRunnerRouter(dependencies) {
    // FlexRunnerController 是有状态的（管理多个实例），
    // 使用 dependencies 中的共享实例，或自行创建单例
    const controller = dependencies.flexRunnerController || new FlexRunnerController();

    const router = new Router();

    // ── 初始化与执行 ──
    router.post('/init',          controller.init.bind(controller));
    router.post('/execute',       controller.execute.bind(controller));
    router.post('/execute-loop',  controller.executeLoop.bind(controller));

    // ── 查询 ──
    router.get('/status',         controller.status.bind(controller));
    router.get('/live-messages',  controller.liveMessages.bind(controller));
    router.get('/session',        controller.session.bind(controller));
    router.get('/steps',          controller.steps.bind(controller));
    router.get('/file',           controller.file.bind(controller));
    router.get('/runners',        controller.runners.bind(controller));

    // ── 控制与检查 ──
    router.post('/control',       controller.control.bind(controller));
    router.post('/check-result',  controller.checkResult.bind(controller));

    // ── 会话注入 ──
    router.post('/inject-prompt', controller.injectPrompt.bind(controller));

    // ── 会话交互 ──
    router.post('/send-and-wait', controller.sendAndWaitMessage.bind(controller));

    // ── 实例管理 ──
    router.delete('/runner',      controller.removeRunner.bind(controller));

    return router;
}

export default createFlexRunnerRouter;
