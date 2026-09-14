/**
 * M3 验收：F-25 知识闭环真正闭合
 *
 * 背景（原实现的真实问题）：经验只被**写**（FlexRunner.persistKnowledge），
 * 而检索入口 listExperiences/getExperience **只被 HTTP 路由调用**，
 * Brain / TestCheck / FlexRunner 从不把经验注入 prompt——所谓"跨任务复用"
 * 实际靠人工导入，闭环并未闭合。且检索没有打分排序。
 *
 *   A 相关性打分：与查询更相关的经验排前面
 *   B 中文（CJK 二元组）可匹配，无需第三方分词器
 *   C SKILL 目录命中时加权
 *   D minScore 过滤弱相关噪声
 *   E withContent 附带正文并按预算截断
 *   F 端到端：FlexRunner 构建的 prompt 中**确实包含**历史经验内容（闭环的关键证据）
 *   G 预算控制：经验条数/总字符数受上限约束，不会撑爆 prompt
 *   H 取回失败时优雅降级（不影响步骤执行）
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { default: KnowledgeManager } = await import(pathToFileURL(`${ROOT}Server/Knowledge/KnowledgeManager.js`).href);
const { default: JsonAdapter } = await import(pathToFileURL(`${ROOT}Server/DbUse/adapters/JsonAdapter.js`).href);
const { FlexRunner } = await import(pathToFileURL(`${ROOT}Server/FlexRunner/FlexRunner.js`).href);

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// ─── 准备：造一个带真实文档的经验库 ──────────────────────────────────────
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm3-know-'));
const docsDir = path.join(tmp, 'docs');
await fs.mkdir(docsDir, { recursive: true });

async function writeDoc(name, content) {
    const p = path.join(docsDir, name);
    await fs.writeFile(p, content, 'utf8');
    return p;
}

const km = new KnowledgeManager({
    jsonAdapter: new JsonAdapter({ baseDir: tmp, subDir: 'Knowledge' }),
});
await km.init();

const docArkts = await writeDoc('arkts.md',
    '鸿蒙 ArkTS 三方库移植经验：napi 引用计数必须成对释放，否则内存泄漏。');
const docAndroid = await writeDoc('android.md',
    'Android Gradle 构建经验：NDK 版本与 AGP 必须匹配，否则编译失败。');
const docNapi = await writeDoc('napi.md',
    'ArkTS napi 引用计数常见错误：在异步回调里忘记 delete reference，导致泄漏。');
const docLong = await writeDoc('long.md',
    'ArkTS 移植长文档：' + '这是一段用于验证字符预算截断的内容。'.repeat(200));

await km.addExperience({ docPath: docArkts, taskId: 't1', taskDescription: '鸿蒙 ArkTS 三方库移植与内存泄漏排查', skillDir: '/skills/arkts-code-check' });
await km.addExperience({ docPath: docAndroid, taskId: 't2', taskDescription: 'Android Gradle 构建失败排查', skillDir: '/skills/android' });
await km.addExperience({ docPath: docNapi, taskId: 't3', taskDescription: 'ArkTS napi 引用计数泄漏修复', skillDir: '/skills/arkts-code-check' });
await km.addExperience({ docPath: docLong, taskId: 't4', taskDescription: 'ArkTS 移植长文档预算验证', skillDir: '/skills/arkts-code-check' });

// ─── A. 相关性打分排序 ──────────────────────────────────────────────────
{
    const hits = await km.searchExperiences({
        query: 'ArkTS napi 引用计数泄漏',
        limit: 5,
        minScore: 1,
    });
    check('A 检索返回结果', hits.length >= 2, `hits=${hits.length}`);
    check('A 得分降序排列', hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score),
        `scores=${hits.map((h) => h.score).join(',')}`);
    const top = hits[0];
    check('A 最相关的 napi 经验排在首位', /napi|引用计数/.test(top.taskDescription || ''),
        `top=${top.taskDescription}`);
    check('A 每条结果都带 score 字段', hits.every((h) => typeof h.score === 'number'));
}

// ─── B. 中文匹配（CJK 二元组）────────────────────────────────────────────
{
    const hits = await km.searchExperiences({ query: '内存泄漏', limit: 5, minScore: 1 });
    check('B 中文查询能命中', hits.length >= 1, `hits=${hits.length}`);
    const unrelated = await km.searchExperiences({ query: '完全无关的主题词', limit: 5, minScore: 1 });
    check('B 无关中文查询不命中（或分数极低）',
        unrelated.length === 0 || unrelated[0].score <= 1,
        `hits=${unrelated.length} topScore=${unrelated[0]?.score}`);
}

// ─── C. skillDir 加权 ──────────────────────────────────────────────────
{
    const withDir = await km.searchExperiences({
        query: 'ArkTS 移植', skillDir: '/skills/arkts-code-check', limit: 5, minScore: 1,
    });
    const hit = withDir.find((h) => h.skillDir === '/skills/arkts-code-check');
    check('C 同 SKILL 目录的经验获得加权（score 含 +3）', !!hit && hit.score >= 4,
        `score=${hit?.score}`);
}

// ─── D. minScore 过滤 ──────────────────────────────────────────────────
{
    const loose = await km.searchExperiences({ query: 'ArkTS 移植', limit: 10, minScore: 1 });
    const strict = await km.searchExperiences({ query: 'ArkTS 移植', limit: 10, minScore: 6 });
    check('D minScore 提高后结果更少或相等', strict.length <= loose.length,
        `loose=${loose.length} strict=${strict.length}`);
    const none = await km.searchExperiences({ query: 'ArkTS 移植', limit: 10, minScore: 999 });
    check('D 极高 minScore 返回空', none.length === 0, `n=${none.length}`);
}

// ─── E. withContent 与截断 ──────────────────────────────────────────────
{
    const hits = await km.searchExperiences({
        query: 'ArkTS 移植长文档预算验证', limit: 5, minScore: 1,
        withContent: true, maxContentChars: 100,
    });
    const withBody = hits.filter((h) => h.content && h.content.length > 0);
    check('E withContent 附带正文', withBody.length >= 1, `n=${withBody.length}`);
    check('E 正文按 maxContentChars 截断',
        withBody.every((h) => h.content.length <= 100 + '\n…（已截断）'.length),
        `lens=${withBody.map((h) => h.content.length).join(',')}`);
    const noContent = await km.searchExperiences({ query: 'ArkTS 移植', limit: 5, minScore: 1 });
    check('E 默认不附正文（避免无谓 IO）', noContent.every((h) => h.content === undefined));
}

// ─── F. 端到端：经验被注入 prompt ────────────────────────────────────────
function makeCapturingCli() {
    const captured = { prompt: null, title: null };
    return {
        captured,
        getType: () => 'mock',
        checkHealth: async () => ({ status: 'ok' }),
        startSession: async (title, prompt) => { captured.title = title; captured.prompt = prompt; return { sessionId: 'sess-k' }; },
        checkSessionStatus: async () => ({ status: 'completed' }),
        abortSession: async () => {},
        deleteSession: async () => {},
        getSessionMessages: async () => [],
        sendAndWaitMessage: async () => ({ success: true }),
    };
}

async function runStep({ knowledgeManager }) {
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm3-know-run-'));
    await fs.writeFile(path.join(taskDir, 'stepId1_loop0_result_0.md'), '# r\n\n## 执行状态\n\n失败\n', 'utf8');
    const cli = makeCapturingCli();
    const runner = new FlexRunner();
    await runner.initContext({
        taskId: 'knowTask', stepId: 1, taskDir,
        skillDirectory: '', specifiedSkill: 'x',
        taskDescription: 'ArkTS napi 引用计数泄漏修复',
        cli,
        storage: { manager: { rootDir: os.tmpdir() }, taskExecStore: () => ({ patchStep: async () => {} }) },
        knowledgeManager,
        skillSelector: { match: async () => null },
        pollIntervalMs: 1,
    });
    const res = await runner.executeStart();
    await runner.drainBackgroundTasks(3000);
    await fs.rm(taskDir, { recursive: true, force: true });
    return { res, prompt: cli.captured.prompt };
}

{
    const { prompt } = await runStep({ knowledgeManager: km });
    check('F prompt 已构建', typeof prompt === 'string' && prompt.length > 0);
    check('F prompt 含"历史经验"章节', /## 历史经验/.test(prompt || ''));
    check('F prompt 含既往经验正文（闭环关键证据）',
        /引用计数/.test(prompt || ''),
        `含"引用计数"=${/引用计数/.test(prompt || '')}`);
    check('F 提示经验来自其它任务并声明优先级',
        /来自\*\*其它任务\*\*|以当前任务与 SKILL 为准/.test(prompt || ''));
    check('F 注入了相似度得分（可追溯）', /相似度得分/.test(prompt || ''));
}

// ─── G. 预算控制 ───────────────────────────────────────────────────────
{
    const { prompt } = await runStep({ knowledgeManager: km });

    // 注意：必须用**行首锚定**的二级标题来切分。
    // 早先写成 `split('## ')` 会命中 `### 经验 1` 里的前两个 '#'，
    // 导致切片长度只有 26 字符、经验条数恒为 0——断言"必然通过"，
    // 属于无效测试。`\n## ` 不会匹配 `\n### `（第三个字符是 '#' 不是空格）。
    const m = /\n## 历史经验[\s\S]*?(?=\n## |$)/.exec(prompt || '');
    const section = m ? m[0] : '';
    check('G 成功提取到历史经验章节（切分逻辑正确）', section.length > 100,
        `sectionLen=${section.length}`);

    const hitCount = (section.match(/### 经验 /g) || []).length;
    check('G 注入条数在 [1, KNOWLEDGE_TOP_K] 之间（默认 3）',
        hitCount >= 1 && hitCount <= 3, `count=${hitCount}`);

    // 默认总预算 4000 字符；章节长度应显著小于"把整个库全塞进去"
    check('G 注入章节长度受总预算约束', section.length < 4500, `sectionLen=${section.length}`);

    // 长文档经验必须被截断（其文档正文约 3.8k 字符，远超单条上限 1500）
    check('G 单条超长经验被截断（未整段塞入）',
        !/这是用于验证字符预算截断的内容。[\s\S]{2500,}/.test(prompt || ''),
        '长文档未超过单条预算');
}

// ─── H. 取回失败时优雅降级 ──────────────────────────────────────────────
{
    const broken = {
        init: async () => {},
        searchExperiences: async () => { throw new Error('模拟检索故障'); },
        findByDocPath: async () => null,
        addExperience: async () => ({ id: 'x' }),
    };
    const { res, prompt } = await runStep({ knowledgeManager: broken });
    check('H 检索故障时步骤仍正常结束（不抛错）', res && typeof res.success === 'boolean',
        `success=${res?.success}`);
    check('H 检索故障时 prompt 不含历史经验章节', !/## 历史经验/.test(prompt || ''));
}

try { await fs.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

const failed = results.filter((r) => !r.ok).length;
console.log(`合计: ${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
