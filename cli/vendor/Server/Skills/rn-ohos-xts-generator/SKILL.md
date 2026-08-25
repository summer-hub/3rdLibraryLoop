---
name: rn-ohos-xts-generator
description: 为 React Native 鸿蒙化三方库（@react-native-ohos/*）生成 Jest XTS 测试用例。自动解析源码提取 API 接口，通过 jest.mock() 模拟原生模块，覆盖 TurboModule、NativeComponent、事件回调、权限管理等场景。当需要为 RN 鸿蒙化三方库生成测试用例、分析测试覆盖率、或补充缺失测试时使用。
license: Apache-2.0
compatibility: 需要 MCP Gateway 运行中（script_rn_extract_interfaces、script_rn_analyze_test_coverage 等脚本工具）；源码探查模式需配置 RN_TEST_PROJECT 路径
metadata:
  author: LoopEngine
  version: "2.1.0"
  category: testing
---

# RN 鸿蒙化三方库 XTS 测试用例生成器

为 `@react-native-ohos/*` 三方库自动生成基于 Jest 的 XTS 测试用例，支持源码探查和文档驱动两种输入模式。

> ⚠️ **核心原则：只测试 `Platform.OS === 'harmony'` 分支的 API；所有原生模块必须通过 `jest.mock()` 模拟；使用 Jest 断言方法（非 Hypium）**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libraryName` | string | ✅ | 三方库完整名（如 `@react-native-ohos/react-native-audio`） |
| `mode` | string | ❌ | 生成模式：`full`（默认）/ `doc-driven` / `coverage-driven` / `single-api` |
| `apiSpecDoc` | string | ❌ | 接口规格说明文档路径（`doc-driven` 模式必填） |
| `coverageReport` | string | ❌ | 覆盖率报告或缺失 API 列表（`coverage-driven` 模式必填） |
| `targetApi` | string | ❌ | 指定 API 名（`single-api` 模式必填） |
| `outputDir` | string | ❌ | 输出目录（源码模式默认 `{RN_TEST_PROJECT}`，文档模式默认 `./{lib}-xts/`） |

---

## 输入依赖

- **前置配置**：源码探查模式需在 `.oh-xts-config.json` 中配置 `RN_TEST_PROJECT` 路径
- **MCP 工具**：`script_rn_extract_interfaces`（接口提取）、`script_rn_analyze_test_coverage`（覆盖率分析）、`script_rn_scan_exports`（导出扫描）
- **输入文件**：三方库源码（oh_modules/node_modules）或接口规格说明文档

> 配置与使用方式详见 [使用指南](references/USAGE_GUIDE.md) 和 [配置指南](references/CONFIG_GUIDE.md)

---

## 工作流程概览

```
Phase 1: 源码分析（MCP工具提取接口 / 文档解析）
    ↓
Phase 2: 平台兼容性分析（HarmonyOS 可用 API 筛选）
    ↓
Phase 3: 覆盖率分析（可选，识别已覆盖/未覆盖 API）
    ↓
Phase 4: 测试用例生成（Mock + 测试代码 + 设计文档）
    ↓
Phase 5: 格式化验证与输出
```

---

## Phase 1：源码分析

### 1.1 源码探查模式（full / coverage-driven / single-api）

**优先使用 MCP 工具自动化提取**：

调用 `script_rn_extract_interfaces`，传入：
- `libroot`：RN 三方库的鸿蒙化仓库根目录
- `output`：输出 JSON 路径（如 `interface-spec.json`）
- `version`：上游 npm 版本号（可选，自动推断）

工具会自动拉取上游 npm 源码、提取 TurboModule Spec、解析 JS 层导出，输出完整接口规格。

**补充探查**（MCP 工具未覆盖的部分）：
- 调用 `script_rn_scan_exports` 扫描导出接口和 TurboModule Spec，支持双目录对比（上游 vs 鸿蒙侧）
- 手动探查 `harmony/` 目录下的 ArkTS 实现，确认方法实现状态

> 手动探查方法详见 [源码解析器](references/SOURCE_PARSER.md) 和 [HarmonyOS 实现探查器](references/HARMONY_SCANNER.md)

### 1.2 文档驱动模式（doc-driven）

读取接口规格说明文档，提取：
- 模块名、版本号
- API 列表（方法名、参数、返回值）
- 同步 vs 异步方法识别
- 事件回调定义、常量/枚举定义

> 也可调用 `script_rn_render_spec_doc` 将 interface-spec.json 渲染为 Markdown 文档

### 1.3 输出：API 清单

源码分析完成后，形成结构化 API 清单：导出对象、方法签名（同步/异步/事件回调）、常量、类型定义、权限需求。

---

## Phase 2：平台兼容性分析

**核心规则：只测试 `Platform.OS === 'harmony'` 分支中定义的 API**

### 2.1 分析内容

| 分析项 | 方法 | 输出 |
|--------|------|------|
| Platform.OS 分支 | 搜索入口文件中的 `Platform.OS === 'harmony'` | HarmonyOS 可用 API 列表 |
| 路径常量差异 | 对比 iOS/Android/HarmonyOS 路径常量 | 如 `FilesDirectoryPath` vs `DocumentDirectoryPath` |
| 方法实现状态 | 探查 ArkTS 实现文件，排除 `throw new Error('not implemented')` | 已实现/未实现方法列表 |
| 权限需求 | 检查 `module.json5` 中的权限声明 | HarmonyOS 权限列表 |

### 2.2 输出：兼容性报告

标记可用 API（正常生成测试）、不可用 API（跳过）、需特殊处理 API（添加超时等）。

> 详细分析方法和常见差异参见 [平台兼容性分析器](references/PLATFORM_COMPAT.md)

---

## Phase 3：覆盖率分析（可选）

当存在已有测试时，分析覆盖率以识别未覆盖的 API。

### 3.1 使用 MCP 工具

调用 `script_rn_analyze_test_coverage`，传入：
- `libroot`：库根目录路径
- `spec`：已有的 interface-spec.json 路径（Phase 1 输出）
- `output`：输出 Markdown 覆盖率报告路径
- `mode`：匹配模式 `auto`（默认）/ `ast` / `regex`

### 3.2 输出：覆盖率报告

包含已覆盖 API（含测试用例数）、未覆盖 API、测试级别分布。覆盖率驱动模式下直接基于未覆盖项生成补充测试。

> 手动分析方法详见 [覆盖率分析器](references/COVERAGE_ANALYZER.md)

---

## Phase 4：测试用例生成

### 4.1 测试用例规划

根据 API 清单和兼容性报告：
1. 过滤不可用 API（HarmonyOS 不支持）
2. 过滤未实现 API（`throw new Error('not implemented')`）
3. 按类型分类：TurboModule 方法 / 事件 / 组件 / 常量 / 权限
4. 按优先级排序：P0 核心流程 → P1 正常参数/权限 → P2 事件/边界 → P3 错误码/常量

### 4.2 Mock 模块生成

- 同步方法：`jest.fn().mockReturnValue()`
- 异步方法：`jest.fn().mockResolvedValue()` / `mockRejectedValue()`
- 事件回调：`jest.fn()`
- 常量导出：直接导出模拟值
- `beforeEach` 中 `jest.clearAllMocks()` 清理状态

> 代码模板参见 [测试文件模板](assets/TEST_FILE_TEMPLATES.md)

### 4.3 测试用例生成

按 API 类型选择测试策略：

| API 类型 | 测试场景 | 用例数/方法 |
|----------|---------|------------|
| TurboModule 同步方法 | 正常参数、错误参数、边界值、状态转换 | 3-6 |
| TurboModule 异步方法 | 正常返回、错误返回、超时 | 2-3 |
| NativeEventEmitter 事件 | 事件触发、参数验证、时序、清理 | 2-4 |
| NativeComponent | 属性测试、事件测试 | 2-3/属性 |
| 常量/枚举 | 非空验证、值验证、类型验证 | 1-2 |
| 权限 | 授权场景、拒绝场景 | 1-2 |

> 生成策略详见 [测试生成策略](references/GENERATION_STRATEGY.md)，完整流程参见 [生成流程](references/GENERATION_FLOW.md)

### 4.4 测试设计文档

同步生成 `[库名].test.design.md`，包含 API 清单、测试用例设计表、平台兼容性说明、权限需求。

> 文档模板和生成规则参见 [设计文档指南](references/DESIGN_DOC_GUIDE.md)

---

## Phase 5：格式化验证与输出

### 5.1 格式化检查

| 检查项 | 规范 |
|--------|------|
| `@tc.name` | `should...when...` 格式，与 `it()` 一致 |
| `@tc.number` | `SUB_RNOH_[库名]_[API]_[类型]_[序号]` |
| `@tc.desc` | `测试 [对象] 的 [方法] - [场景].`（以 `. ` 结尾） |
| `jest.mock()` | 在 `import` 之前，不引用外部变量 |
| Mock 清理 | `beforeEach` 中 `jest.clearAllMocks()` |
| 断言方法 | Jest 断言（`toBe`/`toEqual`/`toHaveBeenCalledWith` 等），非 Hypium |
| 导入合并 | 同包名导入合并为一条语句 |

> 编号和命名规范详见 [测试约定](references/TEST_CONVENTIONS.md)

### 5.2 输出文件

```
{outputDir}/
├── __tests__/
│   ├── [库名简写]Test.test.ts       # TurboModule 方法测试
│   ├── [库名简写]EventTest.test.ts  # 事件测试
│   ├── [库名简写]PermTest.test.ts   # 权限测试
│   └── [库名简写]UtilsTest.test.ts  # 常量/工具测试
├── __mocks__/
│   └── @react-native-ohos/[库名]/index.ts
├── jest.config.js
├── jest.setup.js
├── package.json
└── [库名].test.design.md
```

### 5.3 测试运行验证

生成完成后，运行 Jest 验证测试通过：

```bash
cd {outputDir} && npm test
```

> 构建和运行详见 [构建工作流](references/BUILD_WORKFLOW.md)

---

## 规范合规性自检

生成完成后，执行以下检查确保符合规范：

| 检查维度 | 检查项 | 方法 |
|----------|--------|------|
| **Frontmatter** | `name` 合规（字符集/长度/匹配目录名）、`description` ≤1024字符含"做什么+何时用"、`license`/`metadata` 存在 | 读取 SKILL.md frontmatter |
| **结构** | references 一层深度、文件引用用相对路径、引用文件实际存在 | 检查目录结构和路径 |
| **内容** | 任务参数表存在、Phase 工作流程完整、MCP 工具引用名含正确前缀（`script_`/`kb_`/`gitcode_`）、交叉引用文件存在 | 逐项核对 |
| **渐进式披露** | body < 500行、详细内容在 references/ 不在 body | 统计行数 |

---

## 测试用例编号规范

```
SUB_RNOH_[库名简写]_[API]_[类型]_[序号]
```

| 类型 | 说明 | 示例 |
|------|------|------|
| PARAM | 参数测试 | SUB_RNOH_AUDIO_PREPARE_PARAM_0001 |
| ERROR | 错误码测试 | SUB_RNOH_AUDIO_PREPARE_ERROR_401_0001 |
| RETURN | 返回值测试 | SUB_RNOH_AUDIO_GETAUTH_RETURN_0001 |
| BOUNDARY | 边界值测试 | SUB_RNOH_AUDIO_PREPARE_BOUNDARY_0001 |
| EVENT | 事件测试 | SUB_RNOH_AUDIO_PROGRESS_EVENT_0001 |
| PERM | 权限测试 | SUB_RNOH_AUDIO_MIC_PERM_0001 |

---

## 参考文档

### 框架与规范
- [Jest 测试框架基础](references/JEST_FRAMEWORK.md) — 断言方法、Mock 机制、导入规范
- [测试约定和命名规范](references/TEST_CONVENTIONS.md) — 编号格式、JSDoc、文件组织
- [RN 三方库测试模式](references/RN_TEST_PATTERNS.md) — TurboModule/事件/组件/权限测试示例
- [通用配置](references/COMMON_CONFIG.md) — 强制规范、默认规范、三方库配置模板

### 源码分析与覆盖率
- [源码解析器](references/SOURCE_PARSER.md) — JS 入口、TurboModule Spec、事件解析
- [HarmonyOS 实现探查器](references/HARMONY_SCANNER.md) — oh_modules 探查、方法实现确认
- [平台兼容性分析器](references/PLATFORM_COMPAT.md) — Platform.OS 分支、API 差异
- [覆盖率分析器](references/COVERAGE_ANALYZER.md) — 测试覆盖率分析

### 测试生成
- [测试生成策略](references/GENERATION_STRATEGY.md) — 参数/错误/事件/权限测试规则
- [生成流程](references/GENERATION_FLOW.md) — 完整生成流程步骤
- [设计文档指南](references/DESIGN_DOC_GUIDE.md) — 测试设计文档生成
- [测试文件模板](assets/TEST_FILE_TEMPLATES.md) — Mock 模板、测试文件模板

### 构建与故障排除
- [构建工作流](references/BUILD_WORKFLOW.md) — Jest 配置、测试运行
- [构建故障排除](references/BUILD_TROUBLESHOOTING.md) — 测试运行问题排查
- [故障排除](references/TROUBLESHOOTING.md) — 常见问题解决方案

### 使用与配置
- [使用指南](references/USAGE_GUIDE.md) — 四种使用模式详解
- [配置指南](references/CONFIG_GUIDE.md) — 配置扩展机制、三方库配置模板
