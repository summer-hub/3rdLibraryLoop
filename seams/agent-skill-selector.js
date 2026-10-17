/**
 * seams/agent-skill-selector.js — SKILL 语义匹配能力契约（能力接缝）
 *
 * Provider：`plugins/agent/core`（`setup` 内 `ctx.provide('agent-skill-selector', Agent)`）。
 *           同一 setup 还注册另外两条接缝（`agent-role-limiter` / `agent-multi-agent-runner`），
 *           因为 `Server/Agent/` 是一个内聚包：`SkillSelector` 是**被角色调用的能力**，
 *           其余五个目录是**角色协作的基础设施**。一个清单只有一条 `seam` 字段，因此取
 *           主能力（本条），另两条由同一插件的同一次 setup 提供 —— `plugin.json` 的
 *           `seam` 不写全，但 `host.listServices()` 会同时报出三条限定名服务。
 * Consumer：`plugins/engines/testcheck`（`lib/skillSelectorSource.js`，
 *           审核阶段挑"用哪个 SKILL 执行"）、`plugins/engines/orchestrator/FlexRunner`
 *           （`skill-selector` 兜底名）、`Server/Agent/SkillSelector/**` 门面。
 *
 * 服务形状：**类**（`factory: false`）—— 提供方的能力面是**实例方法** `selectSkill()`，
 * 消费者自己 `new` 出来再用（`testcheck` 的 `_loadSkillSelectorAgent()` 就是 `new Agent()`）。
 * 注册工厂会强迫消费方多包一层 `new (inject(...))()`；注册单例则焊死一个既有语义：
 * `Agent` 上有每实例可覆盖的检索参数（`topK` / `hitThreshold` / `weights`），共享实例
 * 会让一个调用方的阈值调整悄悄改变另一个调用方的命中判定。
 *
 * 实例方法清单从真实实现（`plugins/agent/core/SkillSelector/core/Agent.js`）推导，逐条
 * 对齐公开 API，不含私有 `_xxx`（`_ensureLlm` 是解析链内部实现，不在契约里——消费者
 * 不该 poke 它，也不该依赖"LLM 何时被解析"）。
 *
 * ⚠️ 同目录的 `scanner/` / `matcher/` / `llm/reactSteps.js` / `utils/` **不是**本接缝的
 *    一部分：它们是 `Agent` 内部装配件（`Agent` 在构造期自行组合 matcher，在
 *    `selectSkill` 内部调用 scanner 与 reactSteps）。把它们塞进契约等于把实现细节写进
 *    消费者契约（YAGNI）。同理 `Prompt` 模板表也不在契约里。
 *
 * 归属声明：`plugins/agent/core/plugin.json` 与入口 `definePlugin` 都写
 * `seam: 'agent-skill-selector'`。形状与引擎簇（`engine-*`）刻意对齐。
 *
 * 本文件是纯常量 + JSDoc：不 import 任何东西（架构守卫 R3 要求契约只碰契约）。
 */

export const AGENT_SKILL_SELECTOR_SEAM = Object.freeze({
    name: 'agent-skill-selector',
    version: 1,
    /** 提供方注册的是类（能力面是实例方法），不是工厂函数 */
    factory: false,
    description:
        'SKILL 语义匹配：用 ReAct 两段推理（LLM 拆解任务 → 模糊匹配召回 topK → LLM 排序）从 ' +
        'SKILL 目录里选出最适合的一项，返回 { best, skillPath, hit, topScore, scoreGap, ranked, analysis, trace }',
    /**
     * 构造入参：**全部可选**，因此声明为空数组。提供方必须容忍空对象构造
     * （`new Agent({})` 在任何装配形态下都成功 —— LLM 的解析推迟到首次 `selectSkill()`）。
     * 具体键：
     *   - `llm`：LLM 客户端（不传则首次使用时按 `llm/llmClient.js` 的解析链取）
     *   - `matcher`：自定义模糊匹配实现（默认 `createFuzzyMatcher(undefined)`）
     *   - `topK`：召回数量（默认 5 或读 `SELECTOR_TOP_K`）
     *   - `hitThreshold`：命中阈值（默认 60 或读 `SELECTOR_HIT_THRESHOLD`）
     *   - `weights`：`{action, domain, raw}` 三路融合权重（默认 0.4 / 0.4 / 0.2）
     * 前两项是"测试/嵌入式"通道，不属于跨提供方契约，故不进 `options`；
     * 这也是 m9 能用 `new Agent({})` 真构造一次的原因。
     */
    options: Object.freeze([]),
    /** 提供方类必须实现的实例方法 */
    methods: Object.freeze([
        // async (taskDescription, skillDirectory) => SkillSelection
        //   入参为空即抛（'Agent.selectSkill: task 不能为空' / '... skillDirectory 不能为空'）；
        //   目录下无 SKILL、召回为空也抛，错误文案点名是 selectSkill。
        'selectSkill',
    ]),
    /**
     * 产物上的属性：只声明 `llm` —— 它是**解析链的结果**，也是调用方唯一有正当理由读的
     * 实例状态（用来判断"当前是否已经接上 LLM"，例如排障与嵌入式测试）。
     * `matcher` / `topK` / `hitThreshold` / `weights` 是构造配置，消费者读它没有语义，
     * 写进契约只会变成"实现细节的假承诺"。
     *
     * 语义：构造后为 `null`（懒解析），首次 `selectSkill()` 成功后是 LLM 客户端实例；
     * 显式注入时构造后即为注入值。
     */
    properties: Object.freeze(['llm']),
    /**
     * 本接缝**不声明** `constants`：`Agent` 类上没有状态常量表。
     *
     * 迁移前 `Server/Agent/SkillSelector/` 里确实导出过若干冻结表（`MessageIntent` /
     * `RoleKind` / `BUILTIN_PLANS`），但它们分别属于 Messaging / Roles / Supervisor，
     * 不是 SKILL 选择的状态机；`selectSkill()` 的返回值里也没有状态枚举（只有布尔 `hit`
     * 与分值）。为凑一个 `constants` 字段把别处的表挂到 `Agent` 上属于编造契约，
     * 因此这里显式留空，并在 m9 里贡献 0 条断言（不制造"永远成立"的空转项）。
     */
    invariants: Object.freeze([
        'construct-never-throws-even-without-any-collaborator',
        'llm-resolved-lazily-once-per-instance',
        'explicit-injection-wins-over-host-seam-and-facade-fallback',
        'empty-arguments-rejected-with-actionable-message',
        'hit-is-top1-score-above-threshold-not-score-gap',
        'ranked-sorted-descending-and-falls-back-to-fuzzy-scores',
        'trace-records-every-react-step',
    ]),
    /** 消费者真正依赖的语义（逐条对齐现有实现） */
    notes: Object.freeze({
        construction:
            '构造只登记依赖与读取检索参数，**不发网络请求、也不解析 LLM**（`llm` 为 null）。'
            + 'LLM 的解析推迟到首次 selectSkill()：显式注入 → 活跃宿主 `llm` 接缝 → '
            + 'Server 侧门面登记的内置兜底 → fail closed。三档都没有时抛错点名缺哪个来源，'
            + '而不是静默自建一份。这条"构造不抛 / 首次使用才抛"的语义是刻意的：'
            + 'm9 要能 `new Agent({})` 真构造一次，接线错误的诊断也不该发生在构造函数里。',
        selection:
            '两段 ReAct：① analyzeTask 把任务拆成 keywords/intent/techStack；'
            + '② 模糊匹配（BM25 + 动作/领域/原文三路融合）召回 topK；③ rankSkills 打分排序。'
            + '命中判定只看 top1 分值是否达到 hitThreshold —— top1-top2 分差（scoreGap）'
            + '仅作参考信息保留，不参与判定：高分 top1 已明确是最佳选择，即使 top2 接近也不应'
            + '判为"不确定"。',
        fallbacks:
            'LLM 排序结果为空（模型没按格式返回）时用模糊匹配原始分兜底，并在 trace 上标注；'
            + 'score 不信任 LLM 返回顺序，一律稳定降序重排（topScore 判定依赖 ranked[0]）。'
            + '未命中阈值时 best/skillPath 为 null，调用方据此走自己的兜底流程。',
        logging:
            '只用 debug 级别记录入参/出参（`selectSkill 入参` / `selectSkill 输出`）。'
            + '日志经 `app-logger` 接缝取：宿主接缝 → 门面登记兜底 → 静默 noop。'
            + '日志缺失绝不会让 SKILL 选择失败（观察者不该升级成功能故障）。',
        siblings:
            '同一插件（`plugins/agent/core`）同时提供 `agent-role-limiter` 与 '
            + '`agent-multi-agent-runner` 两条接缝。`plugin.json` 的 `seam` 只能写一条，'
            + '取本条（主能力）；但 `host.has("agent-role-limiter@agent/core")` 与 '
            + '`host.has("agent-multi-agent-runner@agent/core")` 同样为真。',
    }),
});

export default AGENT_SKILL_SELECTOR_SEAM;
