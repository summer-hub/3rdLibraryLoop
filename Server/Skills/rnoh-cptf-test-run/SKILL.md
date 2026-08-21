---
name: rnoh-cptf-test-run
description: >-
  基于 rnoh-cptf-demo-test 生成的 CPTF 测试文件，在鸿蒙设备上实机运行并调试至全部步骤通过。当用户说"运行 CPTF 测试"、"调试 CPTF 测试"、"CPTF 测试失败了怎么修"、"实机跑一下 CPTF"时使用。覆盖：前置环境检查（设备/hap/依赖解析）、运行测试（单用例/全量）、失败诊断（级联取消/全角冒号/步骤超时/模块解析）、修复迭代至全绿、交付确认。
  关键词：CPTF、RNOH、实机调试、步骤超时、级联取消、UIAutomation、harmony、hdc、测试报告。
license: Apache-2.0
compatibility: 需要 CPTF 测试工程（已由 rnoh-cptf-demo-test 生成）、hdc 工具、鸿蒙真机/模拟器、pnpm、cptf CLI
allowed-tools: Read Grep Glob Bash
metadata:
  author: rnoh-team
  version: "1.0.0"
  category: rnoh-testing
---

# RNOH 三方库 CPTF 测试实机运行与调试

基于已生成的 CPTF 测试文件，在鸿蒙设备上实机运行并调试至全部步骤通过。前置 SKILL 为 `rnoh-cptf-demo-test`（负责生成测试工程文件）。

> ⚠️ **核心原则：看到批量"用例已取消"时只诊断第一个超时步骤（级联取消机制）；断言文本必须逐字符核对 demo 源码（全角/半角冒号是头号失败根因）；每轮修复只针对第一个失败步骤，修复后完整重跑。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspaceDir` | string | ✅ | CPTF 测试工程目录（含 cptf.config.json + 测试文件，由 rnoh-cptf-demo-test 生成） |
| `exampleDir` | string | ❌ | RN example 工程目录（含 package.json + metro.config.js），用于 HAP 构建。默认从 `workspaceDir` 上溯推导（如 `workspaceDir` 为 `example/cptf/` 则 `exampleDir` 为 `example/`） |
| `testId` | string | ❌ | 指定运行的测试 ID（`@Test` 的 id），不传则全量运行 |
| `deviceId` | string | ❌ | 鸿蒙设备 SN（默认取 cptf.config.json 中第一个设备） |

---

## 输入依赖

- **前置SKILL**: `rnoh-cptf-demo-test`（已生成 cptf.config.json + package.json + tests/cases/functional/*.test.ts）
- **输入文件**:
  - 测试工程配置：`{workspaceDir}/cptf.config.json`
  - 测试用例文件：`{workspaceDir}/tests/cases/functional/*.test.ts`
  - demo hap 产物：`{demoPath}/harmony/entry/build/default/outputs/default/entry-default-signed.hap`

---

## 工作流程概览

```
Phase 1: 前置环境检查与构建（设备/依赖/hap 构建+安装）
    ↓
Phase 2: 运行测试（cptf run）
    ↓
Phase 3: 失败诊断与修复迭代（逐步骤修复至通过）
    ↓
Phase 4: 交付确认（全绿 + 稳定性验证）
```

---

## Phase 1：前置环境检查与构建

### 1.1 运行环境校验脚本

```bash
bash {workspaceDir}/../rnoh-cptf-test-run/scripts/validate-run-env.sh '{"workspaceDir":"<绝对路径>"}'
```

或手动逐项检查：

| 检查项 | 命令 | 预期 |
|--------|------|------|
| 设备已连接 | `hdc list targets` 或 `devecocli device list` | 输出设备 SN |
| hap 文件存在 | `ls {cptf.config.json → platforms.harmony.appPath}` | 文件存在且为绝对路径 |
| 框架依赖已 link | `node -e "require.resolve('@cptf/framework')"` (在 workspaceDir 下) | 输出解析路径 |
| reflect-metadata 已 link | `ls {workspaceDir}/node_modules/reflect-metadata` | 目录存在 |
| 测试文件存在 | `ls {workspaceDir}/tests/cases/functional/*.test.ts` | 至少 1 个文件 |

### 1.2 HAP 构建与安装

> ⚠️ **若 Demo 代码已变更（如通过 `rnoh-cptf-api-test` 生成/修改了 Demo 页面或入口文件），必须重新构建 HAP。** 旧 HAP 中的 `bundle.harmony.js` 不含新 Demo 代码，测试将找不到按钮。

**构建分两步：RN Bundle 编译 + 鸿蒙 HAP 打包。**

#### 步骤 1：RN Bundle 编译

在 `{exampleDir}`（含 `package.json` 和 `metro.config.js` 的目录）下执行：

```bash
cd {exampleDir} && npm run dev
```

> `npm run dev` 内部执行 `codegen` + `react-native bundle-harmony --dev --minify=false`，产出 `harmony/entry/src/main/resources/rawfile/bundle.harmony.js`。
>
> 若 `npm run dev` 不存在，检查 `example/package.json` 的 `scripts` 字段，可能叫 `bundle:harmony` 或类似名称。核心是执行 codegen + bundle-harmony 两步。

#### 步骤 2：鸿蒙 HAP 打包

在 `{exampleDir}/harmony` 目录下执行：

```bash
devecocli build
```

> `devecocli build` 调用 hvigor 编译 ArkTS + C++ + 打包签名，产出 `entry/build/default/outputs/default/entry-default-signed.hap`。
>
> 构建成功标志：输出 `BUILD SUCCESSFUL` 且 `SignHap` 任务完成。
>
> 若 `devecocli` 不可用，也可在 DevEco Studio 中 Build → Build Hap(s)。

#### 步骤 3：安装 HAP 到设备

```bash
hdc install "{appPath 绝对路径}"
```

若已安装旧版本，先卸载再安装（签名变更时必需）：

```bash
hdc uninstall {bundleId} && hdc install "{appPath 绝对路径}"
```

或使用 `devecocli run --uninstall` 一步完成卸载+安装。

> 详细环境检查与故障排查参见 [实战调试手册](references/DEBUG_PLAYBOOK.md) §6

---

## Phase 2：运行测试

### 2.1 单用例运行

```bash
cd {workspaceDir} && cptf run -p harmony -t {testId}
```

### 2.2 全量运行

```bash
cd {workspaceDir} && cptf run -p harmony
```

### 2.3 报告定位

```bash
ls test-reports/{timestamp}/harmony/
#   execution.log      —— 逐步骤日志（首要诊断材料）
#   screenshots/       —— 每步骤截图（失败步骤必有 -fail.jpeg）
#   report.html        —— 汇总报告
```

> 运行命令详情与报告分析技巧参见 [实战调试手册](references/DEBUG_PLAYBOOK.md) §4

---

## Phase 3：失败诊断与修复迭代

### 3.1 诊断决策树

```
运行失败
├─ Cannot find module '@cptf/framework'
│   → workspace 未正确 link 依赖（参见 rnoh-cptf-demo-test/references/CPTF_SETUP.md §3）
├─ `Invalid or unexpected token` 或 `File '@react-native/typescript-config/tsconfig.json' not found`
│   → ts-node 拾取了上级 RN 工程的 tsconfig.json
│   → 在 workspaceDir 下生成独立 tsconfig.json（不 extends 任何外部配置）
├─ `context.addInitializer is not a function`
│   → tsconfig.json 设了 `experimentalDecorators: true`
│   → 移除 `experimentalDecorators` 和 `emitDecoratorMetadata`（框架用 Stage 3 装饰器）
├─ 报告只显示 1 个用例（N 个步骤全在一个 @Test 里）
│   → 测试文件未按 API 分类拆分
│   → 每个分类拆为独立 .test.ts 文件，各自含 @Test + export testCaseExecutor
├─ 某步骤 "步骤超时(NNNNNms)"，其后全部 "UIAutomation: 用例已取消"
│   → 级联取消机制：只诊断第一个超时步骤
│   ├─ 截图显示按钮已点击、结果已渲染 → waitForText 文本不匹配 → 全角冒号问题
│   ├─ 截图显示按钮未找到/未点击 → textContains 关键字错 或 未滚动到位
│   └─ 截图显示结果渲染异常 → demo 已知 bug 或 API 未实现，放宽断言（容错模式）
├─ 回调类 API 步骤超时（按钮已点击但结果不出现）
│   → API 通过 (Module as any) 调用，JS 层可能未实现，回调不触发
│   → 使用容错断言：先等结果文本，再等错误信息，两者皆无才报错
├─ 步骤通过但断言值错误
│   → 检查动态值推断（如 isSameState ? '' : 'false' 的空串分支）
└─ 设备/hap 安装错误
    → 参见 rnoh-cptf-demo-test/references/CPTF_SETUP.md §5
```

### 3.2 级联取消机制（调试前必读）

CPTF 框架的 `FunctionalTest.execute()` 在步骤超时时设置 `_cancelled = true`，此后所有 UIAutomation 调用经 `throwIfCancelled()` 抛 `'UIAutomation: 用例已取消'`。

**结论：一个步骤超时 → 后续全部步骤级联失败。看到批量"用例已取消"，只需诊断第一个超时步骤。**

### 3.3 常见失败速查

| 现象 | 根因 | 修复方向 |
|------|------|----------|
| `Cannot find module '@cptf/framework'` | shim NODE_PATH 失效 | workspace 本地 link 依赖 |
| `Invalid or unexpected token` | ts-node 拾取上级 RN tsconfig | 生成 workspace 独立 tsconfig.json |
| `context.addInitializer is not a function` | tsconfig 设了 `experimentalDecorators` | 移除该选项（框架用 Stage 3 装饰器） |
| `File '@react-native/typescript-config/tsconfig.json' not found` | 同上，tsconfig 继承链断裂 | 同上 |
| 报告只显示 1 个用例 | 所有 @Step 在同一个 @Test 类 | 按 API 分类拆分多文件 |
| 步骤超时后批量"用例已取消" | 级联取消 | 修第一个超时步骤 |
| 单步超时但按钮已点击成功 | waitForText 匹配串错误（全角冒号） | 逐字符对照源码修断言文本 |
| 回调类 API 超时（按钮已点击结果不出现） | API 未实现，回调不触发 | 使用容错断言（等结果或错误信息） |
| 未找到按钮 | textContains 关键字不精确或未滚动到位 | 核对按钮 title，增大 maxScrolls |
| 步骤通过但值错误 | 动态值推断错误 | 检查三元表达式空串分支 |

### 3.4 迭代修复节奏

1. 修复**只针对第一个失败步骤**（后续失败多为级联）
2. 每轮修复后完整重跑（不要跳步骤）
3. 全部通过后，再跑一轮确认稳定性（随机数/异步渲染可能有偶发）
4. 连续两轮全绿 → 交付

> 完整失败案例全记录与诊断决策树参见 [实战调试手册](references/DEBUG_PLAYBOOK.md)

---

## Phase 4：交付确认

确认测试全部通过：

```bash
cd {workspaceDir} && cptf run -p harmony -t {testId}
```

确认最终报告：

```
{workspaceDir}/
└── test-reports/{timestamp}/harmony/
    ├── execution.log      # 逐步骤日志
    ├── screenshots/       # 每步骤截图
    └── report.html        # 汇总报告
```

报告内容：
- 总步骤数 / 通过数 / 每步骤耗时
- 截图目录（test-reports/{timestamp}/harmony/screenshots/）
- 连续两轮全绿 → 交付完成
