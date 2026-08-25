---
name: rnoh-cptf-demo-test
description: >-
  分析 RN 鸿蒙三方库已有 demo（testerino 单页应用）源码，按 CPTF 规范自动生成测试工程文件（cptf.config.json + package.json + 测试用例 .ts），保证格式与结构正确。当用户说"给这个三方库 demo 生成 CPTF 测试文件"、"用 CPTF 规范生成测试用例"、"分析 demo 源码生成测试文件"时使用。覆盖：demo 源码勘察（按钮 title/结果 Text/testID）、测试工程搭建（cptf.config.json + link 依赖）、测试文件编写（导航策略/滚动定位/文本断言）、格式校验。实机运行调试请使用 rnoh-cptf-test-run。
  关键词：CPTF、RNOH、RN 三方库、自动化测试、testerino、harmony、
  FunctionalTest、测试文件生成。
license: Apache-2.0
compatibility: 需要 CPTF 框架源码（@cptf/framework 可 link）、pnpm、demo 构建产物路径（用于配置 appPath）
allowed-tools: Read Grep Glob Bash
metadata:
  version: "1.0.0"
  category: rnoh-testing
---

# RNOH 三方库 Demo CPTF 测试文件生成

分析单个 RN 鸿蒙三方库已有 demo 源码，按 CPTF（`@cptf/framework`）规范生成对应的测试工程文件（配置 + 依赖 + 测试用例），保证格式与结构正确。实机运行与调试由后续 SKILL `rnoh-cptf-test-run` 负责。

> ⚠️ **核心原则：断言文本必须逐字符核对 demo 源码（特别是全角/半角冒号）；每个 @Step 必须显式设置 stepTimeout ≥ 30000；生成的 package.json 必须本地 link 依赖（不依赖 CLI shim 的 NODE_PATH）；所有文件格式必须通过校验脚本验证。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `demoPath` | string | ✅ | 三方库 demo 工程根目录（含 `src/`、`harmony/`） |
| `libName` | string | ✅ | 三方库名（如 `react-native-get-random-values`） |
| `workspaceDir` | string | ✅ | CPTF 测试工程目录（含 cptf.config.json，可新建） |
| `frameworkPath` | string | ❌ | @cptf/framework 源码路径（默认从全局 pnpm link 推导） |
| `deviceId` | string | ❌ | 鸿蒙设备 SN（写入 cptf.config.json，默认占位待填） |

## 输入依赖

- **前置SKILL**: 无（可独立使用；demo 应已通过 rnoh-lib-demo-create 等流程构建出 hap）
- **后续SKILL**: `rnoh-cptf-test-run`（实机运行与调试）
- **输入文件**:
  - demo 源码：`{demoPath}/src/**/*.tsx`（testerino 用例定义）
  - 构建产物路径：`{demoPath}/harmony/entry/build/default/outputs/default/entry-default-signed.hap`
  - demo 配置：`{demoPath}/AppScope/app.json5`（提取 bundleName）

---

## 工作流程概览

```
Phase 1: Demo 源码勘察（提取用例清单+精确文本）
    ↓
Phase 2: 测试工程搭建（生成 cptf.config.json + package.json link 依赖）
    ↓
Phase 3: 测试文件生成（导航策略 + @Test + @Step）
    ↓
Phase 4: 格式校验与交付（结构完整性检查 + 输出确认）
```

---

## Phase 1：Demo 源码勘察

### 1.1 定位用例定义文件

在 `{demoPath}/src/` 下查找 testerino 用例（`TestCase`/`TestSuite`/`Tester` 关键字），通常在单个 `.tsx` 文件中。

> 勘察项明细与提取方法参见 [Demo 源码勘察指南](references/DEMO_ANALYSIS.md)

### 1.2 提取三要素清单

对每个 TestCase 提取（**逐字符精确记录，不凭记忆**）：

| 要素 | 来源 | 用途 |
|------|------|------|
| 按钮 title | `<Button title="...">` | `scrollToFindElement({ textContains })` 定位 |
| 结果文本 | `<Text>前缀:{值}</Text>` | `waitForText` 断言 |
| testID | `testID` 属性（如有） | 优先用 testID 定位；无则全部走文本定位 |

### 1.3 全角/半角冒号核对（最高优先）

在源码中区分 `：`（全角）与 `:`（半角）。**`waitForText` 是子串精确匹配，半角搜索串永远匹配不到全角文本**——这是最常见的隐性失败根因。记录每个结果文本前缀时保留原始字符，直接复制源码字符串。

### 1.4 识别 demo 结构特征

- 单页 ScrollView（无 deep link、无模块首页）→ 需注册 `single-page` 导航策略
- 按钮是否在屏幕外 → 需要 `scrollToFindElement` 智能滚动
- 结果文本有无固定前缀（裸数字等）→ 决定断言策略（waitForText vs 快照差集）

---

## Phase 2：测试工程搭建

### 2.1 生成 cptf.config.json

```json
{
  "bundleId": "<demo bundleId，见 AppScope/app.json5>",
  "reportDir": "test-reports",
  "reportFormat": "html",
  "casesDir": "tests/cases",
  "platforms": {
    "harmony": {
      "toolPath": "hdc",
      "bundleId": "<同上>",
      "appPath": "<demoPath>/harmony/entry/build/default/outputs/default/entry-default-signed.hap",
      "devices": [{ "id": "<设备SN>", "screenWidth": 1280, "screenHeight": 2832 }]
    }
  }
}
```

### 2.2 建立 link 依赖（关键）

> ⚠️ cptf CLI shim 的 NODE_PATH 不可靠（pnpm link 全局安装后 `.pnpm/node_modules` 可能不存在），**必须在测试工程本地建立 node_modules**。

生成 `{workspaceDir}/package.json`：

```json
{
  "name": "cptf-workspace",
  "private": true,
  "dependencies": {
    "@cptf/framework": "link:<frameworkPath>",
    "reflect-metadata": "link:<frameworkPath>/node_modules/reflect-metadata"
  }
}
```

执行 `pnpm install`，然后用 `node -e "require.resolve('@cptf/framework')"` 验证解析成功。

> 详细步骤与故障排查参见 [CPTF 工程搭建指南](references/CPTF_SETUP.md)

---

## Phase 3：测试文件生成

### 3.1 文件骨架

生成 `tests/cases/functional/{libName 短名}.test.ts`，结构：

```
import 'reflect-metadata' + @cptf/framework 导入
  → NavigationStrategyFactory.registerStrategy('single-page', ...)
  → @Test({... navigationStrategy: 'single-page', waitAfterAction: 300})
  → class XxxTest extends FunctionalTest
  → 辅助方法（scrollAndClick / waitForText / report / snapshot 差集）
  → 每个 TestCase 一个 @Step
  → export const testCaseExecutor = new XxxTest()
```

### 3.2 编码规则（全部来自实战踩坑）

1. **每个 @Step 显式 `stepTimeout: 30000`**——默认 10s 不够滚动+点击+等待
2. **断言文本从 Phase 1 清单逐字符复制**，全角冒号原样保留
3. **无固定前缀的结果**（如裸数字）用快照差集：点击前 `getLayout(true)` 快照 → 点击后再快照 → 差集中提取
4. **demo 已知渲染 bug**（如 "Text strings must be rendered within a <Text>"）时断言放宽为"错误输出已触发"，代码注释注明原因
5. **步骤失败即 throw**（经 report 辅助方法），保证报告准确归因

> 完整可运行模板参见 [测试文件模板](assets/TEST_TEMPLATE.md)

---

## Phase 4：格式校验与交付

### 4.1 运行校验脚本

```bash
bash {skillDir}/scripts/validate-rnoh-cptf-test.sh '{"workspaceDir":"<绝对路径>"}'
```

校验项：

| 检查项 | 规则 |
|--------|------|
| cptf.config.json | 存在且含 bundleId / casesDir / platforms.harmony.appPath（绝对路径）/ devices |
| package.json | 声明 @cptf/framework link + reflect-metadata link |
| node_modules | @cptf/framework + reflect-metadata 已建立 |
| 测试文件 | 首行 import reflect-metadata / 已设 stepTimeout / 导出 testCaseExecutor |
| 全角冒号风险 | 扫描 waitForText 参数含半角冒号的行（警告） |

### 4.2 交付物确认

确认输出目录包含所有文件：

```
{workspaceDir}/
├── cptf.config.json          # 设备/应用配置
├── package.json              # link 依赖
├── node_modules/             # pnpm install 产物
└── tests/cases/functional/
    └── {libName}.test.ts     # 测试文件（格式校验通过）
```

校验脚本全部 PASS 后，交付完成。后续实机运行调试使用 `rnoh-cptf-test-run` SKILL。
