'use strict';

/**
 * Issue 分类模块（AI CLI 驱动）— 3rdloop web 扩展版
 *
 * 支持三种分类标签：
 *  - bug      — 缺陷（代码错误、崩溃、功能异常）
 *  - feature  — 需求（功能请求、增强建议）
 *  - question — 咨询（使用疑问、文档咨询）
 *
 * 分类策略：
 *  仅通过 AI CLI 进行分类，不使用任何兜底或关键词匹配。
 *  采用分批策略：大量 Issue 拆分为小批量（每批 30 条）逐批发送给 AI，
 *  避免单次 prompt 过大导致 AI 超时。
 *
 * 模型偏好：优先使用 GLM 和 DeepSeek（在 OpenCode 服务侧配置）。
 *
 * CLIController 来源：宿主经 setServerCliPath() 注入（vendor/Server 或仓库
 * Server 的 cli/cli.js），未注入时回退相对路径（兼容 AIWeb 原布局）。
 *
 * @module issueClassifier
 */

// ── CLI 适配器（延迟加载，避免强依赖） ────────────────────────────────────────
// 3rdloop web 扩展版：CLIController 所在的 Server/cli/cli.js 路径由宿主注入
// （vendor/Server 或仓库 Server/，见 cli/lib/web-ext.js resolveServerRoot）；
// 未注入时回退相对路径（兼容 AIWeb 原部署布局）。
let _CLIController = null;
let _serverCliPath = null;

/**
 * 注入 Server/cli/cli.js 模块路径（宿主在创建路由前调用）。
 * @param {string} p - Server 根目录下的 cli/cli.js 绝对路径
 */
function setServerCliPath(p) {
  _serverCliPath = p;
  _CLIController = null;
}

function getCLIController() {
  if (!_CLIController) {
    const cliPath = _serverCliPath || require('path').resolve(__dirname, '../Server/cli/cli.js');
    _CLIController = require(cliPath).CLIController;
  }
  return _CLIController;
}

// ── 常量定义 ──────────────────────────────────────────────────────────────────

/**
 * 分类标签映射（key → 中文显示名）
 * @type {Readonly<Record<string, string>>}
 */
const LABELS = Object.freeze({
  bug:      '缺陷',
  feature:  '需求',
  question: '咨询',
});

/** 标签 key 列表 */
const LABEL_KEYS = Object.keys(LABELS);

/**
 * 分批大小：每批发送给 AI 的 Issue 数量
 * 单批 prompt 约 3-5KB，AI 可在 30-60 秒内完成
 */
const BATCH_SIZE = 30;

/**
 * 每批最大轮询次数（约 3-4 分钟超时）
 */
const MAX_POLLS_PER_BATCH = 30;

// ── AI CLI 分类 ─────────────────────────────────────────────────────────────────

/**
 * 构建分类 prompt（发送给 AI CLI 的指令）
 *
 * 提供详细的分类规则和示例，要求 AI 对每条 Issue 做出明确判断。
 *
 * @param {Array<{ issueUrl: string, title: string }>} issues
 * @returns {string} prompt 字符串
 * @private
 */
function _buildClassifyPrompt(issues) {
  const lines = issues.map(
    (issue, i) => `${i + 1}. issueUrl="${issue.issueUrl}" title="${issue.title}"`
  );

  return [
    '你是一个专业的 GitCode Issue 分类助手。你的任务是分析以下 Issue 标题，将每一条 Issue 归入以下三种类型之一。',
    '',
    '## 分类定义',
    '',
    '### bug（缺陷）',
    'Issue 报告了软件中存在的问题或错误。特征关键词：',
    '- 程序行为异常：崩溃、闪退、白屏、黑屏、卡死、无响应',
    '- 错误信息：报错、异常、error、exception、stack trace、segfault',
    '- 功能失效：不能用、无法使用、不工作、失效、broken',
    '- 性能问题：内存泄漏、CPU 占用过高、缓慢、卡顿',
    '- 兼容性问题：在某环境/版本下无法运行',
    '',
    '### feature（需求）',
    'Issue 提出了新功能请求或改进建议。特征关键词：',
    '- 请求新增：希望、建议、能否、是否可以、提议、想要、期待',
    '- 功能增强：改进、优化、增强、提升、完善',
    '- 支持扩展：支持、新增、增加、添加',
    '- 用户体验：更方便、更好、更灵活',
    '',
    '### question（咨询）',
    'Issue 是关于使用方法、概念理解或文档的提问。特征关键词：',
    '- 求助询问：如何、怎么、为什么、请问、请教',
    '- 文档相关：文档、教程、guide、tutorial、documentation',
    '- 理解困惑：区别、不理解、confused、不清楚',
    '- 定位查找：在哪里、怎么找、哪里配置',
    '',
    '## 分类示例',
    '',
    '| 标题 | 分类 | 理由 |',
    '|------|------|------|',
    '| "应用启动后白屏" | bug | 运行异常 |',
    '| "建议支持深色模式" | feature | 新功能请求 |',
    '| "如何配置自动部署？" | question | 使用方法咨询 |',
    '| "接口返回 500 错误" | bug | 错误报告 |',
    '| "希望能增加导出 PDF 功能" | feature | 功能请求 |',
    '| "请问 SDK 的最低版本要求是什么" | question | 文档/参数咨询 |',
    '| "编译时报错 undefined reference" | bug | 编译错误 |',
    '| "是否可以支持自定义主题" | feature | 增强请求 |',
    '| "这个 API 和那个 API 有什么区别" | question | 概念澄清 |',
    '| "内存占用持续增长不释放" | bug | 内存泄漏 |',
    '| "希望支持批量导入功能" | feature | 新功能 |',
    '| "配置文件在哪里修改" | question | 查找咨询 |',
    '',
    '## 输出要求',
    '',
    '1. 必须对每一条 Issue 给出明确的分类判断',
    '2. 仅根据标题内容判断，不要猜测标题中未提及的信息',
    '3. 返回纯 JSON 数组，不要包含任何 Markdown 格式、代码块标记或额外说明',
    '4. 格式：[{"issueUrl":"Issue的URL","label":"bug|feature|question"}]',
    '',
    '待分类的 Issue：',
    ...lines,
  ].join('\n');
}

/**
 * 从 AI 响应文本中解析分类结果
 *
 * 尝试从文本中提取 JSON 数组。AI 可能把 JSON 放在代码块中或附带说明文字。
 *
 * @param {string} text - AI 响应文本
 * @returns {Array<{ issueUrl: string, label: string }>} 解析出的分类结果
 * @private
 */
function _parseAIResponse(text) {
  if (!text || typeof text !== 'string') return [];

  // 尝试直接解析
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return _filterValidResults(parsed);
  } catch { /* 不是纯 JSON，继续提取 */ }

  // 尝试从代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return _filterValidResults(parsed);
    } catch { /* 继续 */ }
  }

  // 尝试匹配最长的 JSON 数组片段
  const arrayMatch = text.match(/\[\s*(?:\{[\s\S]*?\}\s*,?)*\s*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return _filterValidResults(parsed);
    } catch { /* 放弃 */ }
  }

  console.error('[issueClassifier] 无法从 AI 响应中解析 JSON');
  return [];
}

/**
 * 过滤有效的分类结果（issueUrl 非空 + label 合法）
 *
 * @param {Array} arr - 原始解析数组
 * @returns {Array<{ issueUrl: string, label: string }>}
 * @private
 */
function _filterValidResults(arr) {
  return arr
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.issueUrl === 'string' &&
        item.issueUrl &&
        typeof item.label === 'string' &&
        LABEL_KEYS.includes(item.label)
    )
    .map(({ issueUrl, label }) => ({ issueUrl, label }));
}

/**
 * 等待指定毫秒
 * @param {number} ms
 * @returns {Promise<void>}
 * @private
 */
function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 自适应轮询间隔序列（指数退避，单位 ms）
 * 2s → 3s → 4.5s → 6.75s → 10s → 12s（上限）
 */
const POLL_INTERVALS = [2000, 3000, 4500, 6750, 10000, 12000];

/**
 * 将数组拆分为固定大小的批次
 *
 * @param {Array} arr - 原始数组
 * @param {number} size - 每批大小
 * @returns {Array<Array>} 批次数组
 * @private
 */
function _chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * 对单个批次的 Issue 执行 AI 分类
 *
 * 创建 Session → 轮询等待完成 → 解析 JSON 结果。
 * 仅返回 AI 成功分类的结果。
 *
 * @param {Array<{ issueUrl: string, title: string }>} batch - 单批 Issue
 * @param {Object} cli - CLIController 实例
 * @param {number} batchIdx - 批次序号（从 1 开始）
 * @param {number} totalBatches - 总批次数
 * @param {Function} log - 日志函数
 * @returns {Promise<Array<{ issueUrl: string, label: string, source: string }>>}
 *          AI 分类成功的结果
 * @private
 */
async function _classifyBatch(batch, cli, batchIdx, totalBatches, log) {
  const prefix = `批次 ${batchIdx}/${totalBatches}`;

  // 构建 prompt 并创建 Session
  const prompt = _buildClassifyPrompt(batch);
  const title = `issue-classify/${Date.now()}-${batchIdx}`;

  log(`${prefix}: 正在创建 AI 分类会话（${batch.length} 条）…`);
  let sessionResult;
  try {
    sessionResult = await cli.startSession(title, prompt);
  } catch (err) {
    log(`${prefix}: 创建会话失败：${err.message}`);
    return [];
  }

  const sessionId =
    typeof sessionResult === 'string' ? sessionResult : sessionResult.sessionId;
  if (!sessionId) {
    log(`${prefix}: 创建会话失败：未获取到 sessionId`);
    return [];
  }
  log(`${prefix}: 会话已创建，等待 AI 分析完成…`);

  // 自适应轮询等待完成
  for (let i = 0; i < MAX_POLLS_PER_BATCH; i++) {
    const interval = POLL_INTERVALS[Math.min(i, POLL_INTERVALS.length - 1)];
    await _sleep(interval);

    let statusResult;
    try {
      statusResult = await cli.checkSessionStatus(sessionId);
    } catch (err) {
      log(`${prefix}: 轮询状态异常（第 ${i + 1} 次）：${err.message}`);
      continue;
    }

    const status = statusResult.status;

    if (status === 'completed') {
      log(`${prefix}: AI 分析完成，正在解析结果…`);
      let messages;
      try {
        messages = await cli.getSessionMessages(sessionId);
      } catch (err) {
        log(`${prefix}: 获取消息失败：${err.message}`);
        return [];
      }

      // 找到 AI 的最后一条文本回复
      // OpenCode 消息结构：{ info: { role, finish, error }, parts: [{ type: 'text', text }] }
      const assistantMessages = (messages || []).filter(
        (m) => m.info?.role === 'assistant'
      );
      const lastReply =
        assistantMessages.length > 0
          ? assistantMessages[assistantMessages.length - 1]
          : null;

      // 从 parts 中提取文本内容
      let text = '';
      if (lastReply && Array.isArray(lastReply.parts)) {
        text = lastReply.parts
          .filter((p) => p.type === 'text' && p.text)
          .map((p) => p.text)
          .join('\n');
      }

      if (!text) {
        log(`${prefix}: AI 未返回有效回复`);
        return [];
      }

      const aiResults = _parseAIResponse(text);
      log(`${prefix}: 解析完成 ${aiResults.length}/${batch.length} 条`);

      // 尝试删除已完成会话（不影响主流程）
      try { await cli.deleteSession(sessionId); } catch { /* 忽略 */ }

      return aiResults.map((r) => ({ ...r, source: 'ai' }));
    }

    if (status === 'error') {
      log(`${prefix}: AI 分析失败：${statusResult.lastMessage || '未知错误'}`);
      // 尝试删除出错会话
      try { await cli.deleteSession(sessionId); } catch { /* 忽略 */ }
      return [];
    }

    // 仍在运行中，继续轮询
    if (i % 5 === 0) {
      log(`${prefix}: 仍在分析中…（已轮询 ${i + 1} 次）`);
    }
  }

  log(`${prefix}: 轮询超时，AI 分析未在预期时间内完成`);
  // 超时后尝试终止会话
  try { await cli.abortSession(sessionId); } catch { /* 忽略 */ }
  return [];
}

/**
 * 使用 AI CLI 对 Issue 标题进行分类
 *
 * 采用分批策略：将 Issue 拆分为每批 BATCH_SIZE 条，
 * 逐批创建 Session 进行分类，合并所有批次的结果。
 *
 * 模型偏好：优先使用 GLM 和 DeepSeek（在 OpenCode 服务侧配置）。
 *
 * @param {Array<{ issueUrl: string, title: string }>} issues - 待分类 Issue 列表
 * @param {Object}  [cliOptions] - CLI 配置，默认 { type: 'opencode' }
 * @param {string}  [cliOptions.type] - CLI 类型：'opencode' | 'copilot'
 * @param {Function} [onProgress]    - 进度回调 (message: string) => void
 * @returns {Promise<Array<{ issueUrl: string, label: string, source: string }>>}
 *          AI 分类成功的结果（source: 'ai'），未分类的不包含
 */
async function classifyByAI(issues, cliOptions = {}, onProgress) {
  const log = typeof onProgress === 'function' ? onProgress : () => {};

  if (!Array.isArray(issues) || issues.length === 0) {
    return [];
  }

  // 延迟加载 CLIController
  let CLIController;
  try {
    CLIController = getCLIController();
  } catch (err) {
    log(`CLI 模块加载失败：${err.message}`);
    return [];
  }

  const cli = new CLIController(cliOptions.type || 'opencode', cliOptions);

  // 健康检查
  const health = await cli.checkHealth();
  if (health.status !== 'ok') {
    log(`CLI 服务不可用：${health.message}`);
    return [];
  }

  // 分批处理
  const batches = _chunk(issues, BATCH_SIZE);
  const totalBatches = batches.length;
  log(`共 ${issues.length} 条 Issue，拆分为 ${totalBatches} 批（每批 ${BATCH_SIZE} 条）`);

  const allResults = [];

  for (let i = 0; i < batches.length; i++) {
    const batchResults = await _classifyBatch(
      batches[i],
      cli,
      i + 1,
      totalBatches,
      log
    );
    allResults.push(...batchResults);

    const classified = allResults.length;
    const total = issues.length;
    log(`进度：${classified}/${total} 条已分类（批次 ${i + 1}/${totalBatches} 完成）`);

    // 批次间短暂等待，避免请求过于频繁
    if (i < batches.length - 1) {
      await _sleep(1000);
    }
  }

  log(`全部分类完成：${allResults.length}/${issues.length} 条`);
  return allResults;
}

/**
 * 对 Issue 列表执行分类（AI CLI 驱动）
 *
 * 调用 AI CLI 进行分批分类，仅返回 AI 成功分类的结果。
 *
 * @param {Array<{ issueUrl: string, title: string }>} issues - 待分类 Issue 列表
 * @param {Object}  [options]           - 配置选项
 * @param {Object}  [options.cliOptions]- AI CLI 配置 { type: 'opencode' | 'copilot' }
 * @param {Function} [options.onProgress] - 进度回调
 * @returns {Promise<Array<{ issueUrl: string, label: string, source: string }>>}
 *          AI 分类成功的结果（source: 'ai'）
 */
async function classifyIssues(issues, options = {}) {
  const { cliOptions, onProgress } = options;
  const log = typeof onProgress === 'function' ? onProgress : () => {};

  if (!Array.isArray(issues) || issues.length === 0) return [];

  log(`开始 AI 分类 ${issues.length} 条 Issue…`);
  const results = await classifyByAI(issues, cliOptions, onProgress);
  log(`分类完成：${results.length}/${issues.length} 条`);

  return results;
}

module.exports = {
  LABELS,
  LABEL_KEYS,
  BATCH_SIZE,
  setServerCliPath,
  classifyByAI,
  classifyIssues,
};
