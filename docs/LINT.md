# LINT —— 静态检查基线与规则取舍（F-30）

> 运行方式：`npm run lint`（CI 门禁，**0 error 才通过**）、`npm run lint:fix`（自动修可修项）。
> 当前基线：**0 errors / 296 warnings / 240 files**（warnings 只报告，不阻断）。
> 相对 M4 基线（279 / 205）增加的 17 条 warnings 与 35 个文件全部来自 Phase 2/3/4 的新增模块；
> 新增代码**没有引入任何 error**，这是门禁的实际含义。

## 为什么不是"直接开 recommended"

用 Biome 默认 `recommended: true` 跑本仓库的实测结果是 **576 errors + 766 warnings**，
其中 85% 集中在两条纯风格规则上（见下表）。这种体量的诊断有两个害处：
1. **淹没真问题**——本项目真正有价值的那几条（重复对象键、switch 穿透、未使用导入）
   混在近 600 条风格提示里，没人会去看；
2. **逼人关闭整个 lint**——阈值不可达时，实际结果往往是把 lint 从 CI 里摘掉。

因此这里采用**正确性优先的显式白名单**：`recommended: false` + 逐条启用"能抓到真缺陷"的规则。
这与 `docs/ROADMAP.md` F-30 的"先 warn 后 error 渐进收紧"一致——第一阶段先把**信号**做干净。

## 启用（视为缺陷，error 级）

| 规则 | 为什么值得开 |
|------|-------------|
| `suspicious/noDuplicateObjectKeys` | **重复对象键会静默覆盖**。本仓库在启用时真的抓到 2 处——且是我自己引入的：`LoopEngine.restoreLoop` 里后出现的 `aborted: false` 覆盖了前面按 F-24 语义设置的 `aborted: status === ABORTING`，导致该修复从未生效 |
| `suspicious/noFallthroughSwitchClause` | switch 意外穿透是经典缺陷来源 |
| `suspicious/noPrototypeBuiltins` | 避免 `obj.hasOwnProperty(...)` 被原型污染/遮蔽 |
| `suspicious/noDuplicateCase` | 重复 case 分支（后者永不可达） |
| `suspicious/noAsyncPromiseExecutor` | `new Promise(async ...)` 会吞掉异常 |
| `suspicious/useIterableCallbackReturn` | 回调里意外返回值（本篇启用后修掉 4 处 `forEach(n => set.add(n))` 的隐式返回） |
| `correctness/noUnreachable` | 不可达代码 |
| `correctness/noConstAssign` / `noSelfAssign` | 对 const 赋值、自赋值 |
| `correctness/noVoidTypeReturn` | 声明返回 void 却返回值 |

## 启用（warn 级：报告但不阻断）

| 规则 | 当前数量 | 说明 |
|------|---------|------|
| `correctness/noUnusedVariables` | 201 | 死代码信号；量大且多为回调参数，先 warn |
| `correctness/noUnusedImports` | 26 | 未使用导入 |
| `style/useNodejsImportProtocol` | 31 | `'fs'` → `'node:fs'`（显式内置协议更快且不可被 node_modules 遮蔽） |
| `style/useConst` | 11 | 可 const 却用 let |
| `suspicious/noGlobalIsFinite` / `noGlobalIsNan` | 13 / 2 | 全局版本会做隐式类型转换 |
| `suspicious/noRedundantUseStrict` | 12 | 可移除的 `'use strict'` |
| `correctness/noConstantCondition` | — | 恒定条件，常意味着写错了判断 |

## 刻意关闭（含抑制量，保持可见）

> 关闭不等于"认为它们错"，而是**当前阶段的收益/噪音比不划算**。这里逐条列出数量，
> 避免"悄悄关掉"式的掩盖。

| 规则 | 抑制量（recommended 基线） | 关闭理由 |
|------|--------------------------|---------|
| `correctness/noInnerDeclarations` | **489** | 块内函数声明在 ESM 严格模式下合法且本仓库大量使用；体积最大、价值最低 |
| `complexity/useArrowFunction` | **277** | 纯风格。本项目对"函数声明 vs 箭头函数"有明确语义偏好（方法用声明式） |
| `complexity/useOptionalChain` | **157** | 纯风格。`a && a.b` 与 `a?.b` 在本项目语义等价且前者更早报错 |
| `suspicious/noAssignInExpressions` | **69** | 本仓库用它实现关键惯用法：`while ((m = RE.exec(s)))`（正则逐段匹配） |
| `complexity/noUselessContinue` / `noStaticOnlyClass` / `useFlatMap` / `useLiteralKeys` / `noUselessTernary` | 10 / 1 / 1 / 11 / 1 | 纯风格 |
| `style/*`（`useTemplate` / `noUselessElse` / `noParameterAssign` / `noNonNullAssertion` / `useDefaultParameterLast` 等） | — | 纯风格，且部分与既有约定冲突 |
| `suspicious/noExplicitAny` / `noEmptyBlockStatements` | — | `any` 仅出现在 JSDoc/无类型上下文；空块 `catch {}` 是本项目**有意**的"尽力而为"模式 |
| `performance/noDelete` / `noAccumulatingSpread` | — | 本仓库规模下无实际性能影响 |
| `correctness/useExhaustiveDependencies` / `noInvalidUseBeforeDeclaration` | — | 面向 React/TS，不适用于本项目（无框架、纯 ESM） |

## 已知的 warning 债（下一步收敛方向）

1. **`noUnusedVariables` 201 条**——真实死代码信号。收敛方式：先按文件分批清理并逐一复核
   （有些是"预留参数"，应显式 `void x` 或删除），再把该规则从 warn 提升为 error。
2. **`noUnusedImports` 26 条**——多为重构遗留，可直接删。
3. **`useNodejsImportProtocol` 31 条**——机械可改，可一次性收敛后升为 error。

提升顺序建议：`noUnusedImports` → `useNodejsImportProtocol` → `useConst` → `noUnusedVariables`。
每提升一条，先把该规则的 warning 清零，再改 `biome.json` 的级别，避免一次性制造大批红灯。

## 与 CI 的关系

`npm run ci`（`scripts/ci.mjs`）先跑 lint（errors 门禁）再跑全部测试套件；
`.github/workflows/ci.yml` 只做环境准备并调用它。**CI 配置不重复实现校验逻辑**，
目的是本地与 CI 结果一致、且迁移 CI 平台时无需重写检查。
