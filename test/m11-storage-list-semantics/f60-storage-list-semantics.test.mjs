/**
 * M11-A 存储 list 语义 + 两个公开方法的回归锁
 *
 * 背景（本套件锁的缺陷）：`JsonAdapter.list(prefix)` 的 prefix 是**整个存储 key 的前缀**
 * （`/` 分隔、相对 rootDir、无扩展名），实现里用 `rel.startsWith(prefix)` 比较；而 Windows 下
 * `path.join` 产出的 rel 用 `\` —— 于是任何含分隔符的前缀恒不匹配，下列调用点静默恒返回空：
 *
 *   - `TestCheck.listCheckResults()`            → `list('<taskId>/testcheck_loop')`
 *   - `TaskExecutionStore.listSteps()`          → `list('<taskId>/stepid_')`
 *   - `PlanPersistence.{listPlans,loadPlanHistory,loadPlan}` → `list()`（根目录模式不递归，
 *     而计划都在 `db/task/{taskId}/` 子目录里）
 *
 * 本套件分四组：
 *   A `list()` 的**既有语义**未被改变（无参=只列根层文件；`list('<taskId>')` 仍返回该目录条目）
 *   B 「目录 + 文件名前缀」组合矩阵（修复后新增成立的那一档）
 *   C 回归锁：两个公开方法对真实存储返回**非空且内容正确**的条目
 *   D 查不到时仍是空（错误语义不变，不误报）
 *
 * 全部用 `os.tmpdir()` 下的临时数据目录，仓库里不留痕。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let pass = 0;
let fail = 0;
const failures = [];

/**
 * 单条断言。
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(name, ok, detail = '') {
    if (ok) {
        pass++;
        console.log(`PASS  ${name}`);
    } else {
        fail++;
        failures.push(name);
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const keys = (entries) => entries.map((e) => e.key).sort();
const same = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

const { createStorage } = await imp('plugins/storage/core/createStorage.js');
const { PlanPersistence } = await imp('plugins/engines/brain/PlanPersistence.js');
const { TestCheck } = await imp('plugins/engines/testcheck/TestCheck.js');

// ─── 临时数据目录 + 真实文件布局 ──────────────────────────────────────────────
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'm11-list-'));
const baseDir = path.join(tmp, 'db');
const TASK = 'task_x';
const TASK_PREFIX_SIBLING = 'task'; // 与 task_x 同前缀的兄弟任务：用于证明过滤不靠字符串前缀

const write = async (rel, data) => {
    const file = path.join(baseDir, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data), 'utf8');
};

await write('task/ROOTFILE.json', { where: 'root' });
await write(`task/${TASK}/brain.json`, { planId: 'p1', taskId: TASK, loopCount: 0, createdAt: '2024-01-01T00:00:00.000Z' });
await write(`task/${TASK}/brain_loop0.json`, { planId: 'p1', taskId: TASK, loopCount: 0, createdAt: '2024-01-01T00:00:00.000Z' });
await write(`task/${TASK}/brain_loop1.json`, { planId: 'p2', taskId: TASK, loopCount: 1, createdAt: '2024-02-01T00:00:00.000Z' });
await write(`task/${TASK}/testcheck_loop0.json`, { taskId: TASK, loopCount: 0, passed: true });
await write(`task/${TASK}/testcheck_loop1.json`, { taskId: TASK, loopCount: 1, passed: false });
await write(`task/${TASK}/stepid_1_loop0.json`, { taskId: TASK, stepId: '1', startTime: '2024-01-01T00:00:00' });
await write(`task/${TASK}/stepid_2_loop1.json`, { taskId: TASK, stepId: '2', startTime: '2024-02-01T00:00:00' });
await write(`task/${TASK}/sub/testcheck_loop9.json`, { taskId: TASK, loopCount: 9, passed: true }); // 非规范位置
await fs.writeFile(path.join(baseDir, 'task', TASK, 'notes.md'), '# 不是 JSON，必须被忽略\n', 'utf8');
await write(`task/${TASK_PREFIX_SIBLING}/testcheck_loop0.json`, { taskId: TASK_PREFIX_SIBLING, loopCount: 0, passed: true });

const storage = createStorage({ rootDir: baseDir });
const json = storage.json('task');

try {
    // ─── A. list() 的既有语义未被改变 ────────────────────────────────────────
    console.log('\n── A 既有语义：根目录模式 --');
    check('A1 `list()` 无参只列根层 JSON 文件（不递归）',
        same(keys(await json.list()), ['ROOTFILE']),
        keys(await json.list()).join(','));
    check('A2 `list(\'\')`（falsy）与无参同义',
        same(keys(await json.list('')), ['ROOTFILE']),
        keys(await json.list('')).join(','));
    check('A3 `list(\'<taskId>\')` 仍返回该任务目录下的条目（既有语义，被其它调用点依赖）',
        keys(await json.list(TASK)).length === 8,
        keys(await json.list(TASK)).join(','));
    const taskEntries = await json.list(TASK);
    check(`A4 \`list('${TASK}')\` 的 key 全部以 \`${TASK}/\` 开头`,
        taskEntries.every((e) => e.key.startsWith(`${TASK}/`)));
    check('A5 返回的 key 是 `/` 分隔、无扩展名的存储 key',
        taskEntries.every((e) => !e.key.includes('\\') && !e.key.endsWith('.json')),
        taskEntries.map((e) => e.key).join(','));
    check('A6 非 JSON 文件（notes.md）不出现在结果里',
        taskEntries.every((e) => !e.key.endsWith('notes')),
        taskEntries.map((e) => e.key).join(','));
    check('A7 `list(\'<taskId>\')` 不串到同前缀的兄弟任务（task vs task_x）',
        taskEntries.every((e) => !e.key.includes(`${TASK_PREFIX_SIBLING}/`)),
        taskEntries.map((e) => e.key).join(','));
    check('A8 `list(undefined, { recursive: true })` 列整棵树（根层 + 两个任务目录，共 10 个 JSON 文件）',
        same(keys(await json.list(undefined, { recursive: true })), [
            'ROOTFILE',
            `${TASK_PREFIX_SIBLING}/testcheck_loop0`,
            `${TASK}/brain`,
            `${TASK}/brain_loop0`,
            `${TASK}/brain_loop1`,
            `${TASK}/stepid_1_loop0`,
            `${TASK}/stepid_2_loop1`,
            `${TASK}/sub/testcheck_loop9`,
            `${TASK}/testcheck_loop0`,
            `${TASK}/testcheck_loop1`,
        ]),
        keys(await json.list(undefined, { recursive: true })).join(','));
    check('A9 `list(\'<taskId>\', { recursive: false })` 与 `list(\'<taskId>\')` 等价',
        same(keys(await json.list(TASK, { recursive: false })), keys(taskEntries)));

    // ─── B. 「目录 + 文件名前缀」组合矩阵 ───────────────────────────────────
    console.log('\n── B 组合矩阵：目录 / 目录+文件名前缀 --');
    check('B1 `list(\'<taskId>/testcheck_loop\')` 只命中该任务的审核结果',
        same(keys(await json.list(`${TASK}/testcheck_loop`)), [`${TASK}/testcheck_loop0`, `${TASK}/testcheck_loop1`]),
        keys(await json.list(`${TASK}/testcheck_loop`)).join(','));
    check('B2 `list(\'<taskId>/stepid_\')` 只命中步骤记录',
        same(keys(await json.list(`${TASK}/stepid_`)), [`${TASK}/stepid_1_loop0`, `${TASK}/stepid_2_loop1`]),
        keys(await json.list(`${TASK}/stepid_`)).join(','));
    check('B3 `list(\'<taskId>/brain\')` 前缀匹配含 brain.json 与 brain_loop{n}.json',
        same(keys(await json.list(`${TASK}/brain`)), [`${TASK}/brain`, `${TASK}/brain_loop0`, `${TASK}/brain_loop1`]),
        keys(await json.list(`${TASK}/brain`)).join(','));
    check('B4 `list(\'<taskId>/brain_loop\')` 不含 brain.json',
        same(keys(await json.list(`${TASK}/brain_loop`)), [`${TASK}/brain_loop0`, `${TASK}/brain_loop1`]),
        keys(await json.list(`${TASK}/brain_loop`)).join(','));
    check('B5 尾随分隔符 `list(\'<taskId>/\')` 与不带尾随分隔符等价',
        same(keys(await json.list(`${TASK}/`)), keys(taskEntries)),
        keys(await json.list(`${TASK}/`)).join(','));
    const winPrefix = await json.list(`${TASK}\\testcheck_loop`); // 反斜杠写法的等价形式
    check('B6 反斜杠写法的前缀与 `/` 写法等价',
        same(keys(winPrefix), [`${TASK}/testcheck_loop0`, `${TASK}/testcheck_loop1`]),
        keys(winPrefix).join(','));
    check('B7 不存在的目录 `list(\'no_such_task/x\')` 返回 `[]` 且不抛',
        (await json.list('no_such_task/x')).length === 0);
    check('B8 不存在的文件名前缀 `list(\'<taskId>/nothing_\')` 返回 `[]` 且不抛',
        (await json.list(`${TASK}/nothing_`)).length === 0);
    check('B9 前缀模式下也只收 JSON 文件（notes.md 不命中）',
        (await json.list(`${TASK}/notes`)).length === 0);

    // ─── C. 回归锁：两个公开方法返回真实条目 ────────────────────────────────
    console.log('\n── C 回归锁：公开方法对真实存储返回真实条目 --');
    const tester = new TestCheck({ storage, llm: {} });
    const checks = await tester.listCheckResults(TASK);
    check('C1 `listCheckResults(taskId)` 返回非空（修复前恒为 []）', checks.length > 0, `len=${checks.length}`);
    check('C2 `listCheckResults` 恰好 2 条（只含规范位置的 testcheck_loop{n}）',
        checks.length === 2, JSON.stringify(checks));
    check('C3 `listCheckResults` 按 loopCount 升序',
        JSON.stringify(checks.map((c) => c.loopCount)) === '[0,1]',
        JSON.stringify(checks.map((c) => c.loopCount)));
    check('C4 `listCheckResults` 内容正确（passed 与落盘一致）',
        checks[0]?.passed === true && checks[1]?.passed === false,
        JSON.stringify(checks.map((c) => c.passed)));
    check('C5 `listCheckResults` 不混入同前缀兄弟任务 / 非规范子目录的条目',
        checks.every((c) => c.taskId === TASK) && checks.every((c) => c.loopCount !== 9),
        JSON.stringify(checks.map((c) => c.loopCount)));

    const pp = new PlanPersistence({ storage });
    const history = await pp.loadPlanHistory(TASK);
    check('C6 `loadPlanHistory(taskId)` 返回非空（修复前恒为 []）', history.length > 0, `len=${history.length}`);
    check('C7 `loadPlanHistory` 只含 brain_loop{n}.json，按轮次升序',
        JSON.stringify(history.map((p) => p.planId)) === '["p1","p2"]',
        JSON.stringify(history.map((p) => p.planId)));
    const plans = await pp.listPlans();
    check('C8 `listPlans()` 返回非空（修复前恒为 []）', plans.length > 0, `len=${plans.length}`);
    check('C9 `listPlans` 按 planId 去重后按 createdAt 倒序',
        JSON.stringify(plans.map((p) => p.planId)) === '["p2","p1"]',
        JSON.stringify(plans.map((p) => p.planId)));
    const byPlanId = await pp.loadPlan('p2');
    check('C10 `loadPlan(planId)` 回退路径（不传 taskId）能命中磁盘计划',
        byPlanId?.planId === 'p2', JSON.stringify(byPlanId));
    check('C11 `loadPlan` 走 taskId 快路径读的仍是 brain.json 快照',
        (await pp.loadPlan('p1', { taskId: TASK }))?.planId === 'p1');
    const steps = await storage.taskExecStore().listSteps(TASK);
    check('C12 `taskExecStore.listSteps(taskId)` 返回 2 条并按 startTime 升序',
        JSON.stringify(steps.map((s) => s.stepId)) === '["1","2"]',
        JSON.stringify(steps.map((s) => s.stepId)));

    // 写入端 ↔ 读取端 key 契约一致（用各自的真实写路径落盘，再用公开读方法读回）
    const ROUNDTRIP = 'task_roundtrip';
    await tester._persistCheckResult(ROUNDTRIP, { taskId: ROUNDTRIP, loopCount: 0, passed: true });
    await tester._persistCheckResult(ROUNDTRIP, { taskId: ROUNDTRIP, loopCount: 1, passed: true });
    const rtChecks = await tester.listCheckResults(ROUNDTRIP);
    check('C13 本模块写路径 `_persistCheckResult` 落盘 → `listCheckResults` 能读回 2 条',
        rtChecks.length === 2 && rtChecks.every((c) => c.taskId === ROUNDTRIP),
        JSON.stringify(rtChecks));
    await pp.persistPlan({ planId: 'p9', taskId: ROUNDTRIP, loopCount: 0, createdAt: '2024-03-01T00:00:00.000Z' });
    await pp.persistPlan({ planId: 'p8', taskId: ROUNDTRIP, loopCount: 1, createdAt: '2024-04-01T00:00:00.000Z' });
    const rtHistory = await pp.loadPlanHistory(ROUNDTRIP);
    const rtPlans = await pp.listPlans();
    check('C14 `persistPlan` 落盘 → `loadPlanHistory` 读回按轮次升序的 2 轮',
        JSON.stringify(rtHistory.map((p) => p.planId)) === '["p9","p8"]',
        JSON.stringify(rtHistory.map((p) => p.planId)));
    check('C15 `persistPlan` 落盘 → `listPlans` 含新计划且仍按 createdAt 倒序',
        rtPlans.some((p) => p.planId === 'p8') &&
        JSON.stringify(rtPlans.map((p) => p.planId)) === '["p8","p9","p2","p1"]',
        JSON.stringify(rtPlans.map((p) => p.planId)));

    // ─── D. 查不到仍是空（错误语义不变） ───────────────────────────────────
    console.log('\n── D 错误语义不变：查不到返回空，不误报 --');
    check('D1 `listCheckResults("no_such_task")` → `[]`', (await tester.listCheckResults('no_such_task')).length === 0);
    check('D2 `loadPlanHistory("no_such_task")` → `[]`', (await pp.loadPlanHistory('no_such_task')).length === 0);
    check('D3 `listPlans()` 在空数据目录上 → `[]`',
        await (async () => {
            const emptyBase = path.join(tmp, 'db-empty');
            await fs.mkdir(path.join(emptyBase, 'task'), { recursive: true });
            const emptyStorage = createStorage({ rootDir: emptyBase });
            const emptyPp = new PlanPersistence({ storage: emptyStorage });
            const emptyTester = new TestCheck({ storage: emptyStorage, llm: {} });
            const ok = (await emptyPp.listPlans()).length === 0 &&
                (await emptyTester.listCheckResults(TASK)).length === 0;
            await emptyStorage.close();
            return ok;
        })());
    check('D4 `loadPlan(planId)` 查不到 → `null`', (await pp.loadPlan('no_such_plan')) === null);
    check('D5 `taskExecStore.listSteps("no_such_task")` → `[]`',
        (await storage.taskExecStore().listSteps('no_such_task')).length === 0);
} finally {
    await fs.rm(tmp, { recursive: true, force: true });
}

console.log('\n═══ M11-A 汇总 ═══');
console.log(`共 ${pass + fail} 条断言，通过 ${pass} 条，失败 ${fail} 条`);
if (fail > 0) {
    console.log(`失败项：${failures.join(' / ')}`);
}
process.exit(fail === 0 ? 0 : 1);
