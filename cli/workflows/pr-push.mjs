/**
 * pr-push.mjs —— 三方库自动提 PR 工作流
 *
 * 绑定 ohos-lib-pr-push SKILL（Server/Skills/ohos-lib-pr-push）的单步骤固定编排：
 *   总结修改点 → 源仓库建 Issue →（条件）更新 CHANGELOG → 提交推送（fork）→
 *   从 fork 向源仓库建 PR → 评论 Start build 触发 CI → 生成报告
 *
 * 与 pr-check.mjs 的差异：
 *   - 发布操作非幂等（重试可能重复建 Issue/PR），maxRetries 固定为 0（恰好执行一次）
 *   - workspace-dir 缺省时默认取 CLI 命令执行的目录（process.cwd()）
 *   - 编排成功后通过 afterRun 钩子把最终报告复制到 CLI 执行目录
 *
 * 注册约定见 cli/README_DEVELOP.md「工作流机制」章节：默认导出声明对象，自动注册。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const SKILL_NAME = 'ohos-lib-pr-push';

/** 时间戳（base36，与 pr-check.mjs 的 ts36 一致）。 */
function ts36() {
    return Date.now().toString(36);
}

/** 生成 prpush_ 前缀的 taskId（随机位 8，避免并发碰撞）。 */
function makeTaskId() {
    let rand = '';
    try {
        const bytes = crypto.randomBytes(6);
        rand = bytes.toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    } catch {
        rand = Math.random().toString(36).substring(2, 10);
    }
    if (rand.length < 8) {
        rand = (rand + Math.random().toString(36).substring(2, 10)).slice(0, 8);
    }
    return `prpush_${ts36()}${rand}`;
}

/**
 * 校验目录为 git 仓库根（且目录存在）。
 * 失败时 throw（框架捕获 → 退出码 1），不触碰引擎。
 */
function assertGitRepo(dir) {
    if (!dir || !fs.existsSync(dir)) {
        throw new Error(`workspace-dir 目录不存在: ${dir || '(空)'}`);
    }
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
        throw new Error(`workspace-dir 不是目录: ${dir}`);
    }
    try {
        const topLevel = execSync('git rev-parse --show-toplevel', {
            cwd: dir,
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf8',
        }).trim();
        if (!topLevel) throw new Error('git rev-parse 返回空');
    } catch {
        throw new Error(`workspace-dir 不是 git 仓库: ${dir}`);
    }
}

/** 目标目录下已存在同名报告 → 改名备份 .bak_<ts>，保证固定文件名。 */
function backupIfExists(targetReportPath) {
    if (!fs.existsSync(targetReportPath)) return;
    const bak = `${targetReportPath}.bak_${Date.now()}`;
    fs.renameSync(targetReportPath, bak);
    process.stderr.write(`[pr-push] 已备份旧报告: ${bak}\n`);
}

/**
 * 把 `{workspaceDir}/ohos-lib-pr-push-report.md` 复制到 CLI 执行目录。
 * 源不存在 → 提示但不抛错（AI 可能未生成，不阻断退出码）。
 */
function copyReportToCwd(workspaceDir, cwd) {
    const src = path.join(workspaceDir, 'ohos-lib-pr-push-report.md');
    if (!fs.existsSync(src)) {
        process.stderr.write(`[pr-push] 未找到报告文件（跳过复制）: ${src}\n`);
        return;
    }
    const target = path.join(cwd, 'ohos-lib-pr-push-report.md');
    backupIfExists(target);
    fs.copyFileSync(src, target);
    process.stderr.write(`[pr-push] 报告已复制到: ${target}\n`);
}

export default {
    name: 'pr-push',
    description: '三方库自动提 PR：fork 工作区修改 → 源仓库 Issue/PR/CHANGELOG + 触发 CI',
    params: [
        { flag: 'workspace-dir', required: false, describe: '本地 fork 仓库克隆的 git 根目录（缺省默认取 CLI 执行目录）' },
        { flag: 'upstream-url', required: false, describe: '源仓库（上游）URL，缺省按 SKILL Phase 1.1 推断' },
        { flag: 'base-branch', required: false, describe: 'PR 目标（上游）分支，缺省优先上游同名分支，否则上游默认分支' },
        { flag: 'branch-name', required: false, describe: '提交分支名（SKILL 默认用当前分支，不自动建/切分支）' },
        { flag: 'commit-message', required: false, describe: '提交信息，缺省由修改点总结自动生成' },
        { flag: 'changelog', required: false, describe: 'CHANGELOG 判定：auto(默认)/true/false' },
        { flag: 'dry-run', required: false, describe: 'SKILL 级 dry-run：true 时只总结修改点与生成报告，不执行发布（默认 false）' },
    ],
    buildTaskDef(params, env) {
        // ── workspace-dir 判定：显式传入优先，否则默认 CLI 执行目录 ──
        const rawWs = String(params['workspace-dir'] || '').trim();
        const workspaceDir = rawWs ? path.resolve(rawWs) : path.resolve(env.cwd || process.cwd());
        assertGitRepo(workspaceDir);

        const upstreamUrl = String(params['upstream-url'] || '').trim();
        const baseBranch = String(params['base-branch'] || '').trim();
        const branchName = String(params['branch-name'] || '').trim();
        const commitMessage = String(params['commit-message'] || '').trim();
        const changelog = String(params['changelog'] || '').trim().toLowerCase();
        if (changelog && !['auto', 'true', 'false'].includes(changelog)) {
            throw new Error(`changelog 取值非法: ${changelog}（可选: auto/true/false）`);
        }
        const dryRunRaw = String(params['dry-run'] || '').trim().toLowerCase();
        if (dryRunRaw && !['true', 'false'].includes(dryRunRaw)) {
            throw new Error(`dry-run 取值非法: ${dryRunRaw}（可选: true/false）`);
        }
        const dryRun = dryRunRaw === 'true';

        const taskId = makeTaskId();
        const titleBase = path.basename(workspaceDir);
        const title = `PR推送|${titleBase}|${baseBranch || 'default'}`;

        // ── taskDescription：把参数显式写明，供 AI 执行 SKILL Phase 1-8 ──
        const paramLines = [
            `workspaceDir: ${workspaceDir}`,
            `upstreamUrl: ${upstreamUrl || '（未提供，按 SKILL Phase 1.1 推断）'}`,
            `baseBranch: ${baseBranch || '（未提供，按 SKILL Phase 1.5 优先上游同名分支，否则上游默认分支）'}`,
            `branchName: ${branchName || '（未提供，默认使用当前分支，禁止创建/切换分支）'}`,
            `commitMessage: ${commitMessage || '（未提供，由修改点总结自动生成）'}`,
            `changelog: ${changelog || 'auto（按 SKILL Phase 2.4 判定是否更新 CHANGELOG）'}`,
            `dryRun: ${dryRun}`,
        ];
        const taskDescription = [
            '请执行 ohos-lib-pr-push SKILL 的三方库自动提 PR 流程。',
            '',
            '## 任务参数',
            ...paramLines,
            '',
            '## 执行要求',
            '1. 严格按照 SKILL.md 中 Phase 1-8 的顺序执行，顺序不可颠倒。',
            '2. Token 从环境变量 GIT_TOKEN 或 Server/.env 读取，绝不写入日志或报告。',
            '3. 只发布不修改：发现代码问题应停下报告，不顺手改代码。',
            '4. 禁止创建或切换分支：当前在哪个分支就在该分支提交并推送，PR head 即该分支。',
            '5. 若 dryRun=true，仅执行 Phase 1/2/8（确定工作区、总结修改点、生成报告），跳过 Issue/CHANGELOG/提交推送/PR/CI。',
            '',
            '## 产物约束',
            '1. 最终报告必须写入 `{workspaceDir}/ohos-lib-pr-push-report.md`（跳过报告导致后续无法复制，务必生成）。',
            '2. 执行完成后，把本次执行结果（`## 执行状态` 字段，值为 `成功` 或 `失败`）写入下述"结果文件输出路径"所指文件。',
            '   - 若流程成功（或失败但已按 SKILL 失败恢复逻辑产出报告），在结果文件中写 `## 执行状态: 成功`；',
            '   - 若整体失败且无法生成报告，写 `## 执行状态: 失败`。',
        ].join('\n');

        return {
            taskId,
            title,
            skillDirectory: '',
            loopCount: 0,
            steps: [{
                stepId: 1,
                taskDescription,
                dependId: 0,
                nextStepId: 0,
                failStepId: 0,
                maxRetries: 0, // 发布非幂等：恰好执行一次，绝不自动重试
                skillDirectory: '',
                specifiedSkill: SKILL_NAME,
                inputReport: '',
            }],
        };
    },

    /**
     * afterRun 钩子：编排完成后把 `{workspaceDir}` 下的最终报告复制到 CLI 执行目录。
     * 仅在任务成功（result.passed）时复制；失败时保留工作区内报告供人工查看。
     * 框架容错：本函数抛错只记录不改变退出码。
     */
    async afterRun({ params, taskDef, result, dataDir, cwd }) {
        if (!taskDef || !result || result.passed !== true) {
            if (result && result.passed !== true) {
                process.stderr.write(`[pr-push] 编排未通过（status=${result.status}），跳过报告复制（报告保留在工作区）\n`);
            }
            return;
        }
        // 同一 parser 逻辑：显式传入优先，否则默认 CLI 执行目录
        const rawWs = String(params['workspace-dir'] || '').trim();
        const workspaceDir = rawWs ? path.resolve(rawWs) : path.resolve(cwd || process.cwd());
        copyReportToCwd(workspaceDir, cwd || process.cwd());
    },
};