---
name: rn-library-test-coverage-check
description: 通过脚本自动化分析 RN 三方库鸿蒙化代码的用例覆盖度，执行接口提取、测试覆盖率分析、Demo 覆盖率分析三步脚本流水线，AI 基于脚本输出解读评分规则并生成严苛评分报告（0-100分）。作为 RN 仓库检视流程的第七阶段（最终阶段）。Use when 需要评估 RN 鸿蒙化库的测试用例覆盖情况、测试质量或生成覆盖度评分报告。
license: Apache-2.0
compatibility: 需要Node.js环境、Git ≥ 2.25.0（Sparse Checkout）、访问鸿蒙化仓库源码目录。AST 匹配模式需 TypeScript 模块（由 MCP 目录的 node_modules 提供，缺失时在 MCP 目录执行 `npm install`，参见 Phase 0）。脚本统一使用相对路径引用 `{SKILL_DIR}/../../../MCP/scripts/` 下的共享脚本，本 SKILL 不维护脚本副本
metadata:
  version: "1.0.0"
---

# RNLibraryTestCoverageCheckSkill

通过**脚本自动化**对 RN 三方库鸿蒙化代码进行用例覆盖度检视。三步脚本流水线（接口提取 → 测试覆盖率 → Demo 覆盖率）完成覆盖数据的精确采集，AI 基于脚本输出解读评分规则并生成最终报告。

> ⚠️ **核心定位**：覆盖率分析由脚本（AST/正则双层匹配）完成，AI 负责**评分解读**和**质量评估**（边界场景、测试框架规范），而非手动扫描代码。检视范围：
> - 鸿蒙化仓库 `source/ohos/` 下的测试代码
> - Demo 代码（RNTDEMO 工程或仓库自动查找的 example/tester/demo 目录）
> - TurboModule/NAPI 桥接层接口覆盖

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repoUrl` | string | ✅ | 鸿蒙化仓库地址 |
| `outputDir` | string | ✅ | 输出目录绝对路径 |
| `interfaceDocPath` | string | ❌ | 接口规格说明文档路径（由 rn-library-interface-analyzer 生成，可选，脚本会自行提取接口规格） |
| `repoName` | string | ✅ | 仓库名称（用于报告标识） |
| `rnRntUrl` | string | ❌ | 测试用例 demo 地址（可选）。格式为 `{rnRntGitUrl}/tree/{branch}/{projectPath}/{demoPath}`。若不传入，脚本自动从仓库 `example/`/`tester/`/`demo/` 目录查找。详见 [DEMO_LOCATION.md](references/DEMO_LOCATION.md) |
| `upstreamVersion` | string | ❌ | 上游 npm 版本号（如 "2.2.0"），不传则自动推断 |

---

## 输入依赖

本 SKILL 是 RN 仓库检视流程的**第七阶段（最终阶段）**，依赖：

- **前置 SKILL**: `rn-library-documentation-quality-check`（文档质量检视已完成）
- **输入文件**: `文档质量检视报告.md`（位于 outputDir，可选参考）
- **仓库源码**: 已克隆到 `{outputDir}/source/ohos/`

> 💡 **接口规格自提取**：本 SKILL 通过 `rn-extract-interfaces.cjs` 脚本自动从鸿蒙化仓库提取接口规格（JSON），不强制依赖前置 SKILL 的接口文档。若 `interfaceDocPath` 已提供，可交叉验证。

---

## 目录结构约定

> ⚠️ **关键约定**：所有新增文件必须存放在 `{outputDir}` 内，禁止写入系统临时目录。

```
{outputDir}/
├── 接口规格说明.md              # 前置 SKILL 输出（可选）
├── 文档质量检视报告.md          # 前置 SKILL 输出（可选）
├── clone-info.json              # 双仓库克隆元信息
├── interface-spec.json          # 脚本生成的接口规格（Phase 2 产出）
├── test-coverage-report.md      # 测试覆盖率报告（Phase 3 产出）
├── demo-coverage-report.md      # Demo 覆盖率报告（Phase 4 产出）
├── 用例覆盖度检视报告.md         # 最终统一报告（Phase 6 产出）
└── source/
    ├── RN/                      # 上游原库源码
    ├── ohos/                    # 鸿蒙化仓库源码
    └── RNTDEMO/                 # RN 测试 demo 工程（仅情况 A）
```

---

## 工作流程概览

```
Phase 0: 环境准备（检查 MCP 目录的 TypeScript 依赖）
    ↓
Phase 1: 仓库获取与 demo 代码定位
    ↓
Phase 2: 接口规格提取（rn-extract-interfaces.cjs）
    ↓
Phase 3: 测试覆盖率分析（rn-analyze-test-coverage.cjs）
    ↓
Phase 4: Demo 覆盖率分析（rn-analyze-demo-coverage.cjs）
    ↓
Phase 5: 覆盖度评分计算（AI 解读脚本输出）
    ↓
Phase 6: 报告生成
```

---

## Phase 0：环境准备（TypeScript 依赖检查）

> 覆盖率分析脚本默认使用 AST 模式（基于 TypeScript Compiler API 语义分析），精度远高于正则降级模式。脚本统一从 `{SKILL_DIR}/../../../MCP/scripts/` 引用（本 SKILL 不维护脚本副本，与 MCP Gateway 共享同一份脚本）。

### 0.1 检查 TypeScript 模块

脚本中的 `loadTypeScript()` 按以下顺序查找 TypeScript 模块（相对于**脚本所在目录**，即 `MCP/scripts/`）：

1. 环境变量 `TYPESCRIPT_PATH` 指定的路径
2. `MCP/node_modules/typescript`（`npm install` 安装位置，默认命中）
3. `MCP/scripts/node_modules/typescript`
4. 全局 `require('typescript')`

检查默认位置是否存在：

```bash
ls {SKILL_DIR}/../../../MCP/node_modules/typescript/package.json
```

若不存在，在 MCP 目录执行安装：

```bash
npm install
```

> `workdir: "{SKILL_DIR}/../../../MCP"`

若以上路径均未找到，脚本自动降级为正则模式并输出警告 `TypeScript 模块不可用，降级到正则模式`。

### 0.2 AST 模式 vs 正则模式

| 维度 | AST 模式（推荐） | 正则模式（降级） |
|------|-----------------|-----------------|
| 匹配精度 | 语义级，通过 TypeChecker 推断变量类型和属性访问 | 字符串正则匹配，存在假阳性 |
| 误报率 | 低 | 高（同名方法/属性可能被误判为覆盖） |
| 依赖 | 需要 `typescript` npm 包 | 无额外依赖 |
| 启用条件 | `npm install` 后自动启用 | TypeScript 模块不可用时自动降级 |

> ⚠️ **正则模式会产生假阳性**：宽松的 `.memberName(` 正则会把同名但无关的方法调用也计入覆盖，导致覆盖率虚高。务必确保 AST 模式可用以获得准确评分。

---

## Phase 1：仓库获取与 demo 代码定位

> 获取 demo 代码，为后续脚本分析提供 demo 目录路径。根据是否传入 `rnRntUrl` 分两种情况。

### 1.1 判断 demo 来源

**情况 A（rnRntUrl 已传入）**：解析 URL 并 Sparse Checkout 克隆 demo 工程。

解析格式：`{rnRntGitUrl}/tree/{branch}/{projectPath}/{demoPath}`

> ⚠️ projectPath 或 demoPath 为空时停止检查，评分 0 分。详细解析规则和错误处理参见 [DEMO_LOCATION.md](references/DEMO_LOCATION.md)

**情况 B（rnRntUrl 未传入）**：从 `{outputDir}/source/RN/` 和 `{outputDir}/source/ohos/` 自动查找 `example/`/`examples/`/`tester/`/`demo/` 目录。

### 1.2 获取 demo 代码

**情况 A**：

```bash
mkdir -p {outputDir}/source/RNTDEMO
cd {outputDir}/source/RNTDEMO
git init && git config core.sparseCheckout true
git remote add origin {rnRntGitUrl}
git sparse-checkout set {projectPath}/{demoPath}
git fetch origin {branch} --depth=1
git checkout {branch}
```

> `workdir: "{outputDir}"`

**情况 B**：无需额外操作，demo 代码已在已克隆仓库中。

### 1.3 确定分析路径

| 情况 | demoRoot（demo 目录路径） | libRoot（库根目录） |
|------|--------------------------|-------------------|
| A | `{outputDir}/source/RNTDEMO/{projectPath}/{demoPath}` | `{outputDir}/source/ohos` |
| B | `{outputDir}/source/RN/{demoDir}` 或 `{outputDir}/source/ohos/{demoDir}` | `{outputDir}/source/ohos` |

> 详细路径确定逻辑和失败处理参见 [DEMO_LOCATION.md](references/DEMO_LOCATION.md)

---

## Phase 2：接口规格提取（脚本执行）

> 运行 `rn-extract-interfaces.cjs` 从鸿蒙化仓库提取完整接口规格，生成 JSON 中间件供后续覆盖率分析使用。

### 2.1 执行脚本

```bash
node {SKILL_DIR}/../../../MCP/scripts/rn-extract-interfaces.cjs \
  --repoDir {outputDir}/source/ohos \
  --output {outputDir}/interface-spec.json \
  --version {upstreamVersion}
```

> `workdir: "{outputDir}"`

### 2.2 验证产出

脚本产出 `{outputDir}/interface-spec.json`，包含：

| 字段 | 说明 |
|------|------|
| `libraryName` | 库完整名称 |
| `libraryAlias` | 库别名（用于 import 匹配） |
| `interfaces[]` | 接口列表（每个含 className、memberName、fullName、kind、signature、params、returnType） |
| `summary` | 统计摘要（S=类数, N=接口数, M=方法数） |

### 2.3 失败处理

| 错误 | 处理 |
|------|------|
| npm pack 失败（网络问题） | 脚本自动降级到 latest 版本；若仍失败，报告标注错误，评分 0 分 |
| 目录不存在 | 报告标注"源码目录不可访问"，评分 0 分（归零规则 5） |
| 无有效接口提取 | 报告标注"未发现鸿蒙化代码"，评分 0 分（归零规则 4） |

> 脚本参数详情和输出结构参见 [SCRIPT_USAGE.md](references/SCRIPT_USAGE.md)

---

## Phase 3：测试覆盖率分析（脚本执行）

> 运行 `rn-analyze-test-coverage.cjs` 扫描测试源码目录，执行 AST/正则双层匹配，生成测试覆盖率报告。

### 3.1 执行脚本

```bash
node {SKILL_DIR}/../../../MCP/scripts/rn-analyze-test-coverage.cjs \
  --spec {outputDir}/interface-spec.json \
  --libroot {outputDir}/source/ohos \
  --output {outputDir}/test-coverage-report.md \
  --mode auto
```

> `workdir: "{outputDir}"`

### 3.2 脚本行为

- 自动检测测试目录：`example/src/test`、`example/__tests__`、`__tests__`、`test`、`tests` 等
- 扫描 `*.ts`/`*.tsx`/`*.js`/`*.jsx`/`*.ets` 文件
- AST 模式优先（需 TypeScript 模块，参见 Phase 0），失败自动降级正则模式
- 输出 Markdown 报告 + 覆盖率数据

### 3.3 关键输出指标

| 指标 | 说明 |
|------|------|
| `coverageRateMethodLevel` | 方法级覆盖率（百分比） |
| `coveredMethodCount` / `totalInterfacesMethodLevel` | 已覆盖/总接口数 |
| `covered[]` | 已覆盖接口列表（含覆盖文件） |
| `uncovered[]` | 未覆盖接口列表 |
| `classCoverage[]` | 按类的覆盖率统计 |

### 3.4 失败处理

| 错误 | 处理 |
|------|------|
| 测试目录不存在 | 脚本输出空报告（0%覆盖率），标注"无测试目录"，触发归零规则 3 |
| 无测试文件 | 覆盖率 0%，触发归零规则 3 |
| TypeScript 模块不可用 | 在 MCP 目录（`{SKILL_DIR}/../../../MCP`）执行 `npm install` 安装依赖后重新运行；若仍失败则降级正则模式，报告中标注 |

---

## Phase 4：Demo 覆盖率分析（脚本执行）

> 运行 `rn-analyze-demo-coverage.cjs` 扫描 Demo 源码目录，分析 Demo 对接口的覆盖情况。

### 4.1 执行脚本

**情况 A（demoRoot 为 RNTDEMO 目录）**：

```bash
node {SKILL_DIR}/../../../MCP/scripts/rn-analyze-demo-coverage.cjs \
  --spec {outputDir}/interface-spec.json \
  --libroot {outputDir}/source/ohos \
  --src {demoRoot} \
  --output {outputDir}/demo-coverage-report.md \
  --mode auto
```

**情况 B（demoRoot 为仓库内 demo 目录）**：

```bash
node {SKILL_DIR}/../../../MCP/scripts/rn-analyze-demo-coverage.cjs \
  --spec {outputDir}/interface-spec.json \
  --libroot {outputDir}/source/ohos \
  --output {outputDir}/demo-coverage-report.md \
  --mode auto
```

> `workdir: "{outputDir}"`

> 💡 情况 A 需通过 `--src` 指定 demo 目录路径（因为 demo 代码在 RNTDEMO 而非 libroot 下）；情况 B 脚本自动检测 `example/src`/`demo/src` 等目录。

### 4.2 脚本行为

- 扫描 `*.ts`/`*.tsx`/`*.js`/`*.jsx` 文件（排除 `__tests__`/`test`/`tests`）
- AST 模式优先，失败降级正则模式
- 输出 Markdown 报告 + 覆盖率数据

### 4.3 失败处理

| 错误 | 处理 |
|------|------|
| demo 目录不存在 | 脚本输出空报告，标注"未找到 demo 代码"，仅靠 test 目录覆盖评估 |
| demo 目录无 TS/JS 文件 | 覆盖率 0%，仅靠 test 目录覆盖评估 |

---

## Phase 5：覆盖度评分计算（AI 解读脚本输出）

> AI 读取 Phase 3/4 的脚本报告，提取覆盖率数据，应用评分规则计算最终得分。

### 5.1 提取覆盖率数据

从 `test-coverage-report.md` 和 `demo-coverage-report.md` 中提取：

| 数据项 | 来源 |
|--------|------|
| test 覆盖率 | `test-coverage-report.md` 的"方法级覆盖率" |
| demo 覆盖率 | `demo-coverage-report.md` 的"方法级覆盖率" |
| 综合接口覆盖率 | `max(test覆盖率, demo覆盖率)` |
| 已覆盖接口列表 | 两份报告的 `covered[]` 合并去重 |
| 未覆盖接口列表（原始） | 两份报告的 `uncovered[]` 交集（两个来源都未覆盖才算未覆盖） |

### 5.2 平台特有接口过滤（关键步骤）

> ⚠️ **核心规则**：其他平台（Android/iOS）特有的接口**不算未覆盖**，不计入扣分，不触发归零规则。因为鸿蒙化移植无需覆盖原平台专属接口。

AI 需从 `uncovered[]`（原始未覆盖列表）中识别并排除平台特有接口，得到**有效未覆盖列表**：

```
有效未覆盖列表 = 原始未覆盖列表 - 平台特有接口列表
```

#### 平台特有接口识别依据

AI 通过以下特征识别平台特有接口（满足任一即判定）：

| # | 识别特征 | 示例 |
|---|----------|------|
| 1 | 接口名/类名包含平台关键词 | `getAndroidId`、`iOSVersion`、`AndroidPermission`、`isIOSNotch` |
| 2 | 接口源文件位于 `android/` 或 `ios/` 目录 | `source: "./android/..."` |
| 3 | 接口签名或描述明确标注平台限定 | `@platform android`、`(iOS only)`、`Android-specific` |
| 4 | TurboModule 方法仅在原生 Android/iOS 代码中实现，鸿蒙侧无对应实现 | 鸿蒙化仓库 `source/ohos/` 中无该方法的 NAPI/TurboModule 实现 |
| 5 | 接口涉及平台专有 API | `Activity`、`Context`（Android）；`UIView`、`UIApplicationDelegate`（iOS） |
| 6 | 接口名含 `NativeAndroid`/`NativeIOS` 等前缀 | `NativeAndroidXxxModule`、`NativeIOSXxxSpec` |

#### 判定流程

1. 遍历 `uncovered[]` 中的每个接口
2. 检查接口名/类名是否包含平台关键词（`android`/`ios`/`Android`/`iOS`/`AndroidOnly`/`iOSOnly`）
3. 检查 `interface-spec.json` 中该接口的 `source` 字段是否指向 `android/` 或 `ios/` 目录
4. 检查鸿蒙化仓库 `source/ohos/` 中是否存在该接口的鸿蒙侧实现（若无原生实现，则该接口本身就是平台特有的，不应要求测试覆盖）
5. 满足任一特征 → 标记为「平台特有」，从有效未覆盖列表中移除
6. 边界情况：接口名同时包含多平台关键词（如 `getPlatformInfo`）且非任一平台专属 → 不排除，正常计入未覆盖

> ⚠️ **保守判定原则**：当无法确定接口是否为平台特有时，**不排除**该接口（按正常未覆盖处理），避免遗漏真实未覆盖的接口。只有明确证据表明是 Android/iOS 专属时才排除。

#### 有效覆盖率重新计算

排除平台特有接口后，需重新计算有效覆盖率：

```
有效总接口数 = 总接口数 - 平台特有接口数
有效已覆盖数 = 已覆盖接口数（平台特有接口不在已覆盖列表中，无需调整）
有效覆盖率 = (有效已覆盖数 / 有效总接口数) × 100%
```

> 💡 归零规则 6 中的"综合接口覆盖率 < 100%"使用**有效覆盖率**而非原始覆盖率判定。

### 5.3 维度评分规则

| 维度 | 权重 | 基础分 | 扣分上限 | 检查项 |
|------|------|--------|----------|--------|
| 公开接口覆盖率 | 70% | 70 | -70 | RTC-01,RTC-02,RTC-04~RTC-06 |
| 测试质量 | 30% | 30 | -30 | RTC-03,RTC-07 |

**维度得分** = max(0, 基础分 - 该维度累计扣分)

**综合评分** = Σ(各维度得分)，范围 0-100

### 5.4 公开接口覆盖率扣分（维度 1，基于脚本输出）

> 以下扣分基于 **5.2 过滤后的有效未覆盖列表**，平台特有接口不参与扣分。

| # | 检查项 | 扣分 | 数据来源 |
|---|--------|------|----------|
| RTC-01 | 核心接口未覆盖 | **-20** | 有效未覆盖列表中标注为 required/核心的接口 |
| RTC-02 | 重要接口未覆盖 | **-15** | 有效未覆盖列表中的重要公开接口 |
| RTC-04 | 可选接口未覆盖 | **-3** | 有效未覆盖列表中的可选/次要接口 |
| RTC-05 | 接口参数组合未覆盖 | **-5** | AI 分析已覆盖接口的参数组合情况 |
| RTC-06 | 回调/事件接口未覆盖 | **-8** | 有效未覆盖列表中 `isEvent=true` 的接口 |

> ⚠️ **归零规则 6**：有效综合接口覆盖率（排除平台特有接口后）未达到 100% 时，综合评分直接为 0 分。

### 5.5 测试质量扣分（维度 2，AI 评估）

| # | 检查项 | 扣分 | 评估方法 |
|---|--------|------|----------|
| RTC-03 | 边界场景缺失 | **-5**/项 | AI 逐接口分析是否需要边界场景，上限 -15 分 |
| RTC-07 | 测试框架覆盖度 | **-5**/项 | AI 检查 `@rnoh/testerino` 框架规范，上限 -15 分 |

> RTC-03 和 RTC-07 仅针对**有效接口列表**（已排除平台特有接口）进行评估。详细判定规则参见 [CHECKLIST.md](references/CHECKLIST.md)

### 5.6 零容忍归零规则

> 以下归零规则基于**有效接口列表**（排除平台特有接口后）判定。

| 规则 | 条件 | 结果 |
|------|------|------|
| 归零 1 | 核心接口完全无测试（有效未覆盖列表包含所有核心接口） | **0 分** |
| 归零 2 | 有效公开接口覆盖率 < 10% | **0 分** |
| 归零 3 | 仓库无任何测试文件（脚本报告显示 0 个源文件） | **0 分** |
| 归零 4 | 未发现鸿蒙化代码（接口提取失败） | **0 分** |
| 归零 5 | 源码目录不可访问 | **0 分** |
| 归零 6 | 有效综合接口覆盖率 < 100%（test 和 demo 均未达 100%，排除平台特有接口后） | **0 分** |

> 完整评分规则和检查清单参见 [CHECKLIST.md](references/CHECKLIST.md)

---

## Phase 6：报告生成

在 `{outputDir}` 下生成 `用例覆盖度检视报告.md`，合并脚本输出和 AI 评分结果。

> 报告格式模板参见 [REPORT_TEMPLATE.md](references/REPORT_TEMPLATE.md)

### 6.1 报告关键内容

1. **检视概览**：接口总数、有效接口数、覆盖率（test/demo/综合有效）、测试文件数
2. **平台特有接口排除清单**：被识别为平台特有而从未覆盖列表中排除的接口及判定依据
3. **综合评分**：`**综合评分：{score}/100**` + 维度评分表
4. **脚本执行记录**：三步脚本的执行参数和产出文件
5. **检视维度明细**：RTC-01~07 扣分明细
6. **覆盖度明细**：每个接口的覆盖状态（来源：test/demo/两者/平台特有排除）
7. **未覆盖接口清单**：有效未覆盖接口（已排除平台特有），按严重度排序
8. **改进建议**：P0/P1/P2 优先级

### 6.2 评分格式要求

> ⚠️ 报告必须包含 `**综合评分：XX/100**` 格式（粗体标记、中文冒号），以便后端 `_parseRNLibraryScore` 正确解析。每个维度必须包含 `**维度评分：XX/100**` 格式。

---

## 特殊情况处理

| 情况 | 处理方式 | 评分 |
|------|----------|------|
| 接口提取脚本失败 | 报告标注"接口提取失败" | 0 分（归零 4） |
| 测试目录不存在 | 脚本输出空报告，标注"无测试目录" | 0 分（归零 3） |
| demo 目录不存在 | 跳过 demo 覆盖率，仅靠 test 评估 | 按维度扣分 |
| test 和 demo 均为 0% | 标注"接口覆盖极低" | 0 分（归零 2） |
| 有效覆盖率 < 100%（排除平台特有后） | 标注"有效接口覆盖率未达 100%" | 0 分（归零 6） |
| 未覆盖列表全部为平台特有接口 | 标注"未覆盖接口均为平台特有，已排除"，有效覆盖率 100% | 正常评分（不触发归零 6） |
| rnRntUrl 格式不正确 | 停止检查，标注错误 | 0 分 |
| TypeScript 模块不可用 | 在 MCP 目录（`{SKILL_DIR}/../../../MCP`）执行 `npm install` 后重新运行；若仍失败则降级正则模式，报告中标注（正则模式存在假阳性，评分可能偏高） |
| 仅原平台测试无鸿蒙测试 | 标注"仅有原平台测试" | 0-30 分 |

---

## 输出产物

| 产物 | 文件名 | 来源 | 说明 |
|------|--------|------|------|
| 接口规格 | `interface-spec.json` | Phase 2 脚本 | JSON 中间件 |
| 测试覆盖率报告 | `test-coverage-report.md` | Phase 3 脚本 | 脚本自动生成 |
| Demo 覆盖率报告 | `demo-coverage-report.md` | Phase 4 脚本 | 脚本自动生成 |
| 用例覆盖度检视报告 | `用例覆盖度检视报告.md` | Phase 6 AI | 最终统一报告 |

所有产物写入 `{outputDir}` 目录。

> ⚠️ **输出文件自检**：写入结果文件前，先确认 `用例覆盖度检视报告.md` 已存在且内容完整（**独立文件，禁止只写入 result 执行结果文件**）；同时核对脚本产出清单（`interface-spec.json` / `test-coverage-report.md` / `demo-coverage-report.md`，demo 报告仅在执行 Demo 覆盖率分析后存在）。若报告内容仅在草稿中，必须先将其保存为上述独立文件。

### 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将最终评分以下述 JSON 对象写入该路径：

```json
{
  "testCoverageScore": 85,
  "scoreReason": "有效接口覆盖率62%扣18，未覆盖接口38个扣17等（一句话判定依据，≤50字；触发一票否决时必须注明）"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `testCoverageScore` | number | 用例覆盖度评分（0-100 整数，与报告中 `**综合评分：XX/100**` 的数值一致） |
| `scoreReason` | string | 评分判定依据摘要（可选，前端悬浮提示展示；0 分时强烈建议写明触发规则，如"有效接口覆盖率<10% 触发归零"） |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取评分，无需解析报告文本）。若 prompt 未下发该路径则跳过本节。

---

## 评分权重

本 SKILL 在 RN 仓库检视综合评分中权重为 **15%**。

---

## 与前置/后置 SKILL 的衔接

- **前置依赖**：`rn-library-documentation-quality-check`（第6阶段）
- **本 SKILL 是最终阶段**，输出的 `用例覆盖度检视报告.md` 作为综合评分输入
- 确保报告中的问题清单包含定位信息（接口名+文件路径），便于综合报告汇总

---

## 详细参考文档

| 文档 | 内容 |
|------|------|
| [CHECKLIST.md](references/CHECKLIST.md) | 完整检查清单 + 评分规则 + RTC-03/RTC-07 判定规则 |
| [SCRIPT_USAGE.md](references/SCRIPT_USAGE.md) | 三步脚本参数详解 + 输出结构 + 执行示例 |
| [DEMO_LOCATION.md](references/DEMO_LOCATION.md) | rnRntUrl 解析 + Sparse Checkout + demo 自动查找逻辑 |
| [REPORT_TEMPLATE.md](references/REPORT_TEMPLATE.md) | 最终报告格式模板 |
