---
name: rnoh-cptf-api-test
description: >-
  根据 RN 鸿蒙三方库接口规格说明书，自动生成配套的 Demo 页面代码和 CPTF 框架自动化测试用例。
  解析接口规格中的 API 清单（方法/组件/事件/常量），按平台兼容性筛选 HarmonyOS 可用接口，
  生成 Tester 框架 Demo 页面（带 testID、固定文本前缀等可测试性设计），
  并同步生成 CPTF 测试工程（cptf.config.json + package.json link + @Test/@Step 测试文件）。
  当用户说"根据接口规格生成 demo 和测试"、"从 spec 生成 CPTF 测试"、
  "接口规格说明书驱动的测试生成"时使用。
  关键词：CPTF、RNOH、接口规格、spec-driven、Demo 生成、测试用例、Tester、harmony。
license: Apache-2.0
compatibility: >-
  需要 MCP Gateway 运行中（script_rn_extract_interfaces、script_rn_scan_exports、kb_search），
  需要 CPTF 框架源码（@cptf/framework 可 link）、pnpm、文件读写权限
allowed-tools: Read Grep Glob Bash
metadata:
  author: rnoh-team
  version: "1.0.0"
  category: rnoh-testing
  consumes: rnohLibInterfaceSpecSkill
  consumed-by: rnohCptfTestRunSkill
---

# RN 鸿蒙三方库接口规格驱动 Demo 与 CPTF 测试生成

根据 RN 鸿蒙三方库的**接口规格说明书**，一次性生成配套的 Demo 页面代码和 CPTF 自动化测试用例。与 `rnoh-lib-demo-create`（从描述文档生成 demo）和 `rnoh-cptf-demo-test`（从已有 demo 源码生成测试）不同，本技能以接口规格为唯一事实来源，**Demo 与测试协同设计**：Demo 内嵌可测试性设计（testID、固定文本前缀、确定性输出），CPTF 测试精确匹配 Demo 结构，两者从同一规格派生，保证一致性。

> ⚠️ **核心原则：Demo 与测试必须从同一接口规格派生，保证 API 覆盖一致；Demo 必须内嵌可测试性设计（testID + 固定文本前缀 + 确定性输出），不允许裸值无前缀渲染；每个 @Step 必须显式设置 stepTimeout >= 30000；所有文件格式必须通过校验脚本验证。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `specDoc` | string | ✅ | 接口规格说明书路径（Markdown 或 interface-spec.json） |
| `libName` | string | ✅ | 三方库名（如 `react-native-audio`），用于目录命名 |
| `harmonyPkgName` | string | ✅ | 鸿蒙包名（如 `@react-native-ohos/react-native-audio`），用于 import |
| `projectRoot` | string | ✅ | RN 工程根目录（含 example/demo 目录和 Tester 框架） |
| `workspaceDir` | string | ✅ | CPTF 测试工程目录（含 cptf.config.json，可新建） |
| `frameworkPath` | string | ❌ | @cptf/framework 源码路径（默认从全局 pnpm link 推导） |
| `deviceId` | string | ❌ | 鸿蒙设备 SN（写入 cptf.config.json，默认占位待填） |
| `category` | string | ❌ | Demo 分类，默认 `API`（可选 `UI`/`Media`/`Basic`/`Component`） |

**派生变量**（Phase 1 探查后确定）：
- `exampleDir`：探查到的 example/demo 目录绝对路径
- `demoDir`：`{exampleDir}/{libName}/demo/`
- `indexFile`：`{exampleDir}/{libName}/index.tsx`
- `registerFile`：探查到的 Demo 注册入口文件路径
- `hapPath`：`{projectRoot}/harmony/entry/build/default/outputs/default/entry-default-signed.hap`
- `bundleId`：从 `{projectRoot}/AppScope/app.json5` 提取

---

## 输入依赖

- **前置SKILL**: `rnoh-lib-interface-spec`（提供接口规格说明书）或直接使用 `script_rn_render_spec_doc` 生成
- **后续SKILL**: `rnoh-cptf-test-run`（实机运行与调试）
- **MCP工具**:
  - `script_rn_extract_interfaces` — 从源码提取接口规格 JSON（规格未就绪时）
  - `script_rn_scan_exports` — 扫描导出接口和 TurboModule Spec（交叉验证）
  - `script_rn_render_spec_doc` — 渲染接口规格为 Markdown 文档
  - `kb_search` — 查询鸿蒙平台特定约束（权限、ArkTS 限制）
- **输入文件**: 接口规格说明书（Markdown 或 JSON，含 API 清单、方法签名、类型定义）
- **项目结构**: RN 工程（含 example/demo 目录、Tester 框架、harmony 构建配置）

---

## 工作流程概览

```
Phase 1: 接口规格解析与工程探查
    ↓
Phase 2: 平台兼容性分析与测试规划（API → Demo → Test 映射表）
    ↓
Phase 3: Demo 代码生成（可测试性设计：testID + 固定前缀 + 确定性输出）
    ↓
Phase 4: CPTF 测试工程搭建（cptf.config.json + package.json link）
    ↓
Phase 5: CPTF 测试用例生成（@Test/@Step，精确匹配 Demo 结构）
    ↓
Phase 6: 质量校验与交付
```

---

## Phase 1：接口规格解析与工程探查

### 1.1 解析接口规格说明书

读取 `specDoc`，提取结构化 API 清单。支持两种输入格式：

| 格式 | 来源 | 解析方式 |
|------|------|----------|
| Markdown | `script_rn_render_spec_doc` 输出或手工编写 | 按标题层级提取 API 分类、方法签名、参数表 |
| JSON | `script_rn_extract_interfaces` 输出 | 直接解析结构化 JSON |

若规格未就绪，调用 `script_rn_extract_interfaces`（传入 `libroot` + `output`）从源码提取，再调用 `script_rn_render_spec_doc` 渲染为 Markdown。

> 解析方法与字段映射参见 [接口规格解析指南](references/SPEC_PARSING_GUIDE.md)

### 1.2 提取 API 清单

对每个 API 提取以下信息：

| 要素 | 提取内容 | 用途 |
|------|----------|------|
| API 名称 | 方法名/组件名/Hook 名 | Demo 按钮 title + CPTF 步骤名 |
| API 类型 | TurboModule 方法 / 组件 / 事件 / 常量 / Hook | 决定 Demo 页面结构和测试策略 |
| 参数签名 | 参数名、类型、可选性、默认值 | Demo 输入控件设计 |
| 返回值 | 返回类型、Promise/同步 | Demo 结果展示 + 断言策略 |
| 平台分支 | `Platform.OS === 'harmony'` 可用性 | 过滤不可用 API |
| 权限需求 | 麦克风/相机/定位等 | Demo 权限请求代码 |

### 1.3 探查工程目录结构

> ⚠️ 不硬编码工程路径，通过探查确定 example/demo 目录和注册入口。

**探查 example/demo 目录**（按优先级取第一个存在的）：

| 优先级 | 搜索路径 |
|--------|----------|
| 1 | `{projectRoot}/rn-tester/examples/` |
| 2 | `{projectRoot}/example/src/` |
| 3 | `{projectRoot}/examples/src/` |
| 4 | `{projectRoot}/example/` |
| 5 | `{projectRoot}/demo/src/` |
| 6 | `{projectRoot}/demo/` |

**探查 Demo 注册入口**（按优先级）：

| 优先级 | 搜索路径 |
|--------|----------|
| 1 | `{projectRoot}/**/RNTesterList.ts` |
| 2 | `{projectRoot}/**/TesterList.*` |
| 3 | `{projectRoot}/example/src/App.tsx` 或 `App.ts` |
| 4 | `{projectRoot}/**/navigation*` 或 `routes*` |

读取 `registerFile` 内容，分析现有注册模式（require/import + 数组结构），后续按相同模式追加。

**提取构建信息**：

| 信息 | 来源 |
|------|------|
| bundleId | `{projectRoot}/AppScope/app.json5` → `bundleName` |
| hapPath | `{projectRoot}/harmony/entry/build/default/outputs/default/entry-default-signed.hap` |
| 依赖存在性 | `{projectRoot}/package.json` → `dependencies` 是否含 `harmonyPkgName` |

> 详细探查方法参见 [接口规格解析指南](references/SPEC_PARSING_GUIDE.md) §3

---

## Phase 2：平台兼容性分析与测试规划

### 2.1 平台兼容性筛选

**核心规则：只生成 HarmonyOS 可用 API 的 Demo 和测试。**

| 筛选维度 | 方法 | 处理 |
|----------|------|------|
| Platform.OS 分支 | 搜索入口文件 `Platform.OS === 'harmony'` | 仅保留 harmony 分支 API |
| 无平台分支库 | TurboModule 原生适配，JS 层全部可用 | 全部保留 |
| 未实现方法 | 探查 ArkTS 实现，排除 `throw new Error('not implemented')` | 跳过 |
| 权限需求 | 检查 `module.json5` 权限声明 | 标注权限，Demo 中添加请求逻辑 |

可调用 `script_rn_scan_exports` 交叉验证导出接口与 TurboModule Spec。

可调用 `kb_search` 查询鸿蒙平台特定约束（如权限要求、ArkTS 限制）。

> 详细分析方法参见 [Demo 生成指南](references/DEMO_GENERATION_GUIDE.md) §1

### 2.2 构建 API → Demo → Test 映射表

对每个可用 API，规划 Demo 页面和 CPTF 测试步骤的对应关系：

| API 类型 | Demo 页面设计 | 测试策略 | 用例数 |
|----------|--------------|----------|--------|
| TurboModule 同步方法 | 按钮 + 结果 Text（固定前缀） | scrollAndClick → waitForText → 值校验 | 1-3 |
| TurboModule 异步方法 | 按钮 + loading + 结果 Text | scrollAndClick → waitForText（含异步等待） | 1-2 |
| 事件回调 | 触发按钮 + 事件监听结果 Text | scrollAndClick → waitForText（事件标志） | 1-2 |
| 组件属性 | 属性切换按钮 + 渲染结果 Text | scrollAndClick → waitForText（属性值） | 1-2/属性 |
| 常量/枚举 | 显示常量值 Text | waitForText（启动即验证） | 1 |
| Hook | 调用按钮 + 状态 Text | scrollAndClick → waitForText（Hook 返回值） | 1-2 |
| 权限 | 权限请求按钮 + 授权状态 Text | scrollAndClick → waitForText（授权结果） | 1-2 |

### 2.3 可测试性设计规划（关键差异点）

与 `rnoh-lib-demo-create` 不同，本技能生成的 Demo **必须内嵌可测试性设计**：

| 设计要素 | 规则 | 原因 |
|----------|------|------|
| testID | 每个可交互按钮设置 `testID="{apiName}-btn"` | CPTF 优先用 testID 定位，最稳定 |
| 固定文本前缀 | 结果 Text 使用 `{API名}结果：{值}` 格式（全角冒号） | CPTF `waitForText` 子串匹配，前缀固定可可靠断言 |
| 确定性输出 | 避免裸值无前缀；随机值附加范围标注 | 消除快照差集需求，简化断言 |
| 按钮唯一标识 | 按钮 title 含 API 名，保证全局唯一 | `textContains` 定位唯一性 |
| 错误展示 | 错误用 `错误信息：{error}` 固定前缀 | 统一错误断言策略 |

> 完整设计规则参见 [Demo 生成指南](references/DEMO_GENERATION_GUIDE.md) §2

---

## Phase 3：Demo 代码生成

### 3.1 创建目录结构

```
{exampleDir}/{libName}/
├── index.tsx                  # 主入口（Tester 框架 + 元数据导出）
└── demo/
    ├── 001_{apiCategory1}Page.tsx
    ├── 002_{apiCategory2}Page.tsx
    └── ...
```

### 3.2 生成 Demo 页面代码

每个 Demo 页面基于 Phase 2 的映射表生成，遵循以下核心规则：

| 规则 | 说明 |
|------|------|
| 根组件用 `View` | 禁止 `ScrollView` 作为根（Tester 已有 ScrollView） |
| 每个按钮设 `testID` | 格式 `{apiName}-btn`，CPTF 优先 testID 定位 |
| 结果 Text 固定前缀 | 格式 `{API名}结果：{值}`（全角冒号），CPTF `waitForText` 可靠匹配 |
| 无裸值渲染 | 所有动态值附加固定前缀，消除快照差集需求 |
| 平台兼容性 | 只用 harmony 分支 API（基于 Phase 2.1） |
| 权限请求 | 敏感操作前请求权限 |
| 异步处理 | `async/await` + `try/catch` |
| 无注释 | 代码中不使用 `//` 或 `/* */` |
| Hook 顶层调用 | 不在事件回调中调用 Hook |

> 代码模板参见 [Demo 页面模板](assets/DEMO_PAGE_TEMPLATE.md)

### 3.3 生成主入口文件

`index.tsx` 包含 Tester 框架集成 + 元数据导出（`displayName`、`framework`、`category`、`title`、`description`、`examples`）。

### 3.4 更新 Demo 注册入口

在 `registerFile` 中注册新模块，按该文件现有注册模式追加（模式 A/B/C，与 `rnoh-lib-demo-create` 一致）。

> 详细规则参见 [Demo 生成指南](references/DEMO_GENERATION_GUIDE.md) §3-4

---

## Phase 4：CPTF 测试工程搭建

### 4.1 生成 cptf.config.json

```json
{
  "bundleId": "<从 AppScope/app.json5 提取>",
  "reportDir": "test-reports",
  "reportFormat": "html",
  "casesDir": "tests/cases",
  "timezone": "BeiJing",
  "platforms": {
    "harmony": {
      "toolPath": "hdc",
      "bundleId": "<同上>",
      "appPath": "<hapPath 绝对路径>",
      "devices": [{ "id": "<设备SN>", "screenWidth": 1280, "screenHeight": 2832 }]
    }
  }
}
```

### 4.2 建立 link 依赖

> ⚠️ cptf CLI shim 的 NODE_PATH 不可靠，必须在测试工程本地建立 node_modules。

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

### 4.3 生成 tsconfig.json

> ⚠️ **必须生成**。ts-node 注册时会向上遍历目录查找 tsconfig.json，若拾取到上级 RN 工程的 tsconfig.json（通常 extends `@react-native/typescript-config`），会导致编译失败或装饰器行为异常。

生成 `{workspaceDir}/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": false,
    "resolveJsonModule": true,
    "declaration": false,
    "outDir": "./dist"
  },
  "include": ["tests/**/*.ts"]
}
```

> ⚠️ **禁止设置 `experimentalDecorators` 和 `emitDecoratorMetadata`**。CPTF 框架的 `@Test`/`@Step` 使用 **Stage 3 装饰器**（`context.addInitializer`），而非旧版 `experimentalDecorators`。若 tsconfig 中开启 `experimentalDecorators: true`，TypeScript 会使用旧版装饰器格式，不提供 `context` 对象，运行时报 `context.addInitializer is not a function`。

执行 `pnpm install`，用 `node -e "require.resolve('@cptf/framework')"` 验证。

> 详细步骤与故障排查参见 [CPTF 测试生成指南](references/CPTF_TEST_GENERATION_GUIDE.md) §1

---

## Phase 5：CPTF 测试用例生成

### 5.1 文件拆分策略

> ⚠️ **一个 `@Test` 类 = 报告中一个用例**。若所有 `@Step` 放在同一个 `@Test` 类中，报告中只显示 1 个用例（含 N 个步骤），无法体现分类维度。

按 Phase 2 的 API 分类拆分测试文件，每个分类一个独立 `.test.ts` 文件：

```
tests/cases/functional/
├── 001_{apiCategory1}.test.ts    # @Test id='{lib}-cat1', N 个 @Step
├── 002_{apiCategory2}.test.ts    # @Test id='{lib}-cat2', M 个 @Step
└── ...
```

每个文件包含完整的 NavigationStrategy 注册 + JPushBaseTest 基类 + `@Test` 类 + `export const testCaseExecutor`。

### 5.2 文件骨架

每个 `.test.ts` 文件结构：

```
import 'reflect-metadata' + @cptf/framework 导入
  → NavigationStrategyFactory.registerStrategy('single-page', ...)
  → abstract class BaseTest extends FunctionalTest（辅助方法）
  → @Test({ navigationStrategy: 'single-page', waitAfterAction: 300 })
  → class XxxTest extends BaseTest
  → 每个 Demo API 一个 @Step
  → export const testCaseExecutor = new XxxTest()
```

### 5.3 编码规则

| 规则 | 原因 |
|------|------|
| 每个文件首行 `import 'reflect-metadata'` | `Reflect.defineMetadata` 运行时依赖 |
| **按 API 分类拆分多个 `.test.ts` 文件** | 一个 `@Test` = 报告一个用例，不拆分只显示 1 个用例 |
| **tsconfig.json 禁止 `experimentalDecorators`** | 框架用 Stage 3 装饰器，旧版会报 `context.addInitializer is not a function` |
| 每个 @Step 显式 `stepTimeout: 30000` | 默认 10s 不够滚动+点击+等待 |
| 断言文本从 Phase 3 Demo 代码逐字符复制 | 全角/半角冒号差异是头号失败根因 |
| 优先用 testID 定位（Demo 已设置） | testID 比 textContains 更稳定 |
| `captureScreenshot: false`（常规步骤） | 减少耗时；失败步骤框架自动截图 |
| 文件末尾 `export const testCaseExecutor` | CLI 用例发现约定 |
| 回调类 API 用容错断言 | 见 §5.4 |

### 5.4 回调类 API 容错断言

部分 API 通过 `(Module as any)` 调用，可能在 JS 层未实现，回调永不触发导致 `waitForText` 超时。对此类 API 使用容错断言：

```typescript
await this.scrollAndClickByTestId('{apiName}-btn', '调用 {apiName}');
await this.sleep(2000);
let el = await this.waitForText('{apiName}结果', 8000);
if (!el) { el = await this.waitForText('错误信息', 3000); }
if (!el) { throw new Error('点击后未出现{apiName}结果或错误信息文本'); }
const text = this.getChildText(el) || el.text || '';
this.report(text.includes('{apiName}结果') || text.includes('错误信息'), `结果: "${text.trim()}"`);
```

适用条件：API 在 `index.js` 中通过 `(Module as any)` 调用，或 `index.d.ts` 声明但 `NativeXxx.ts` Spec 未定义。

### 5.5 Demo-Test 对齐保证

由于 Demo 和 Test 从同一规格派生（Phase 2 映射表），对齐保证：

| 对齐维度 | 保证方式 |
|----------|----------|
| API 覆盖 | 映射表中每个 API 同时有 Demo 步骤和 Test 步骤 |
| testID 一致 | Demo 中设置的 testID 在 Test 中直接引用 |
| 断言文本一致 | Test 的 waitForText 参数 = Demo 的 Text 前缀（逐字符复制） |
| 按钮定位一致 | Test 的 scrollAndClick 关键字 = Demo 的按钮 title 子串 |

> 完整测试模板参见 [CPTF 测试模板](assets/CPTF_TEST_TEMPLATE.md)

---

## Phase 6：质量校验与交付

### 6.1 运行校验脚本

```bash
bash {skillDir}/scripts/validate-rnoh-cptf-api-test.sh '{"workspaceDir":"<绝对路径>","demoDir":"<绝对路径>"}'
```

校验项：

| 检查项 | 规则 |
|--------|------|
| Demo 页面文件 | 存在且含 testID + 固定文本前缀 |
| Demo 入口文件 | 含 Tester 框架集成 + 元数据导出 |
| Demo 注册入口 | 已追加新 Demo 注册 |
| cptf.config.json | 存在且含 bundleId / casesDir / platforms.harmony.appPath / devices |
| tsconfig.json | 存在且**不含** `experimentalDecorators` / `emitDecoratorMetadata` |
| package.json | 声明 @cptf/framework link + reflect-metadata link |
| 测试文件 | 首行 import reflect-metadata / 已设 stepTimeout / 导出 testCaseExecutor / **按分类拆分多文件** |
| Demo-Test 对齐 | testID 一致 / 断言文本前缀匹配 / API 覆盖一致 |
| 全角冒号风险 | 扫描 waitForText 参数含半角冒号的行（警告） |

### 6.2 交付物确认

确认输出目录包含所有文件：

```
{exampleDir}/{libName}/
├── index.tsx                              # Demo 主入口
└── demo/
    ├── 001_{apiCategory1}Page.tsx         # Demo 页面（含 testID）
    └── ...

{workspaceDir}/
├── cptf.config.json                       # CPTF 设备/应用配置
├── tsconfig.json                          # TS 编译配置（禁止 experimentalDecorators）
├── package.json                           # link 依赖
├── node_modules/                          # pnpm install 产物
└── tests/cases/functional/
    ├── 001_{apiCategory1}.test.ts         # 按分类拆分的测试文件
    ├── 002_{apiCategory2}.test.ts
    └── ...                                # 每个文件一个 @Test = 报告一个用例

{registerFile}                             # 已追加 Demo 注册
```

### 6.3 交付报告

输出确认信息，包含：
- 生成的文件列表
- 探查到的工程结构（exampleDir、registerFile、bundleId、hapPath）
- 接口规格解析结果（API 总数、HarmonyOS 可用数、已生成 Demo/Test 数）
- API → Demo → Test 映射表摘要
- 需用户后续确认的事项（如设备 SN、hap 构建）

> 完整检查清单参见 [质量检查清单](references/QUALITY_CHECKLIST.md)

校验脚本全部 PASS 后，交付完成。后续实机运行调试使用 `rnoh-cptf-test-run` SKILL。

> ⚠️ **交付后必须重新构建 HAP**。本技能修改了 Demo 入口（`index.js` 指向新 Demo）和新增了 Demo 页面文件，旧 HAP 中的 `bundle.harmony.js` 不含新代码。在运行 CPTF 测试前，需执行：
> 1. `cd {exampleDir} && npm run dev` — 编译 RN Bundle（codegen + bundle-harmony）
> 2. `devecocli build`（在 `{exampleDir}/harmony` 下）— 打包鸿蒙 HAP
> 3. `hdc install "{hapPath}"` — 安装到设备
>
> 详细构建步骤参见 `rnoh-cptf-test-run` SKILL Phase 1.2。

---

## 参考文档

- [接口规格解析指南](references/SPEC_PARSING_GUIDE.md) — 规格文档解析、API 清单提取、工程探查
- [Demo 生成指南](references/DEMO_GENERATION_GUIDE.md) — 平台兼容性、可测试性设计、代码规范、注册模式
- [CPTF 测试生成指南](references/CPTF_TEST_GENERATION_GUIDE.md) — 工程搭建、测试编码规则、Demo-Test 对齐
- [质量检查清单](references/QUALITY_CHECKLIST.md) — 完整校验项
- [Demo 页面模板](assets/DEMO_PAGE_TEMPLATE.md) — 可复制的页面代码模板
- [CPTF 测试模板](assets/CPTF_TEST_TEMPLATE.md) — 可复制的测试文件模板
