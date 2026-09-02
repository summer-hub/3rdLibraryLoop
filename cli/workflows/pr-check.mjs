/**
 * pr-check.mjs —— PR 代码检视工作流
 *
 * 等价封装前端「PR 代码检视」面板（Web/public/js/codecheck.js）的单步骤固定编排：
 *   - SKILL 映射与前端 _CC_SKILL_MAP 一致
 *   - taskId 沿用 codecheck_ 前缀（前端历史页按 taskIdPrefix=codecheck_ 过滤，
 *     CLI 提交的任务在前端 PR 检视历史页可见）
 *   - title 格式 'PR检视|{libraryType}|{prUrl}'（供前端历史恢复解析）
 *
 * 注册约定见 cli/README.md「工作流机制」章节：默认导出声明对象，自动注册。
 */

// 与前端 _CC_SKILL_MAP 同构（arkts 为默认）
const SKILL_MAP = {
    arkts: 'arkts-code-check',
    flutter: 'flutter-code-check',
    rn: 'rn-code-check',
    tpccplus: 'tpc-cpp-check',
};

/**
 * 从 PR URL 解析 owner / repo / prNumber（等价前端 codecheck.js 的 _ccParsePrUrl）。
 * @param {string} prUrl
 * @returns {{ owner: string, repo: string, prNumber: string }}
 */
function parsePrUrl(prUrl) {
    const fallback = { owner: 'unknown', repo: 'unknown', prNumber: '0' };
    if (!prUrl) return fallback;
    try {
        const url = new URL(prUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        // 典型: /owner/repo/pulls/123 或 /owner/repo/pull/123
        let pullIdx = -1;
        for (let i = 0; i < parts.length; i++) {
            if (/^pulls?$/.test(parts[i])) { pullIdx = i; break; }
        }
        if (pullIdx >= 2) {
            return {
                owner: parts[0],
                repo: parts[1],
                prNumber: parts[pullIdx + 1] || '0',
            };
        }
        // 回退：用 pathname 中的段拼接
        if (parts.length >= 2) {
            return {
                owner: parts[0],
                repo: parts[1],
                prNumber: parts[parts.length - 1] || '0',
            };
        }
    } catch { /* 非法 URL，走 fallback */ }
    return fallback;
}

/** 时间戳（base36，等价前端 Date.now().toString(36)）。 */
function ts36() {
    return Date.now().toString(36);
}

export default {
    name: 'pr-check',
    description: 'PR 代码检视（等价前端 PR 检视面板，单步骤固定编排）',
    params: [
        { flag: 'pr-url', required: true, describe: 'PR 地址，如 https://gitcode.com/owner/repo/pulls/123' },
        { flag: 'library-type', required: false, describe: '库类型：arkts(默认)/flutter/rn/tpccplus' },
    ],
    buildTaskDef(params) {
        const prUrl = String(params['pr-url'] || '');
        if (!prUrl) throw new Error('缺少必填参数 --pr-url');

        const libType = String(params['library-type'] || 'arkts').toLowerCase();
        const skillName = SKILL_MAP[libType];
        if (!skillName) {
            throw new Error(`不支持的库类型: ${libType}（可选: ${Object.keys(SKILL_MAP).join(' / ')}）`);
        }

        const prInfo = parsePrUrl(prUrl);
        const taskId = `codecheck_${prInfo.owner}_${prInfo.repo}_${prInfo.prNumber}_${ts36()}`;

        // 与前端 doCodeCheck 构造的 taskDescription / title 完全一致
        const taskDescription = [
            '请对以下 PR 进行代码检视。',
            '',
            `PR 地址: ${prUrl}`,
        ].join('\n');

        return {
            taskId,
            title: `PR检视|${libType}|${prUrl}`,
            skillDirectory: '',
            loopCount: 0,
            steps: [{
                stepId: 1,
                taskDescription,
                dependId: 0,
                nextStepId: 0,
                failStepId: 0,
                maxRetries: 3,
                skillDirectory: '',
                specifiedSkill: skillName,
                inputReport: '',
            }],
        };
    },
};