---
name: arkts-library-demo-code
description: 基于 Demo 场景文档（由 ArkTsLibraryDemoScenarioSkill 生成）生成可在 OpenHarmony/HarmonyOS 上编译运行的 ArkTS 测试 Demo 页面代码。页面统一平铺在 pages/ 目录（{三位序号}_{PascalCase}Page.ets，多文档全局连续编号），由 DemoIndex 主页面统一导航，同步生成 base/zh_CN/en_US 三语字符串资源；接口签名逐个对照库源码与系统 API 文档查证，生成后执行工程迁移、Code Linter 与编译验证（5 轮修复 + ohpm 线上版本兜底）。当需要将 Demo 场景描述文档转化为可编译运行的鸿蒙 ArkTS Demo 代码时使用。
license: Apache-2.0
compatibility: 需要 Node.js、devecocli（docs/lint/build）、hdc（可选设备探测）、ohpm（可选兜底）、MCP Gateway 的 script_deveco_docs 工具（系统 API 查证）；Windows 用 build.ps1 执行编译，macOS/Linux 用日志重定向等效命令
metadata:
  author: lalhan
  version: "1.2.0"
---

# 鸿蒙 ArkTS 原生库 Demo 代码生成

读取 Demo 场景文档，为每个 Demo 生成独立的 ArkTS 页面、统一的主导航页面与三语字符串资源，并通过迁移 → Linter → 编译验证闭环确保代码可在鸿蒙系统上编译运行。

> ⚠️ **核心约束（违反任一项视为任务失败）**：
> 1. **数量完整**：场景文档有 N 个 Demo → 必须生成 N 个页面，禁止合并、省略、跳过。
> 2. **不捏造接口**：只调用场景文档列出的接口；签名**以库源码为准**（逐接口 read_file 核对，场景文档签名可能过时）。
> 3. **命名与结构**：`{三位序号}_{PascalCase}Page.ets` 平铺于 `pages/`（严禁子目录）；多文档全局连续编号。
> 4. **国际化**：UI 静态文本一律 `$r('app.string.xxx')`，base/zh_CN/en_US 三文件同步；`DemoEntry.title/description` 用 `Resource` 类型。
> 5. **@Builder 禁动态数据**：`@Builder` 参数按值快照，ArkUI 会跳过重渲染；动态 `@State` 节点必须内联在 `build()` 中。

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `sourcePath` | ✅ | 目标鸿蒙工程根目录（含 `entry/` 和 `library/` 模块） |
| `outputDir` | ✅ | 输出目录（场景文档和覆盖率报告所在目录） |
| `scenarioDocPath` | 可选 | 单个场景文档路径；未提供则从 `outputDir` 搜索所有 `*未覆盖接口Demo场景*.md` |
| `interfaceSpecPath` | 可选 | 接口规格文档路径（查询依赖类型的完整定义）；未提供则从 `outputDir` 搜索 `arktscoverage-interface-spec.md` |

## 输入依赖

- 前置 SKILL：`ArkTsLibraryDemoScenarioSkill`（生成 Demo 场景文档）
- 输入文件：Demo 场景文档（`*未覆盖接口Demo场景*.md`）、库源码（`sourcePath/library/`）
- 场景文档"对应函数接口"列自带签名；依赖类型细节（回调字段、枚举成员、interface/class 区分）以接口规格文档 + 库源码核对为准

## 工作流程概览

```
阶段零 准备（解析场景文档 → 探查工程 → 文件规划）
  → 阶段一 逐 Demo 生成页面 ETS + 三语字符串资源
  → 阶段二 生成 DemoIndex 主导航 + 路由注册 + 入口改造
  → 阶段三 权限与系统能力适配
  → 阶段四 工程迁移 → Code Linter → 编译验证（5 轮修复 + ohpm 兜底）→ 自查
  → 阶段五 输出报告
```

---

## 阶段零：准备工作

### 0.1 解析场景文档

- 确定 `scenarioDocPath`（或搜索 `outputDir` 下 `*未覆盖接口Demo场景*.md`）；多文档按文件名（一）（二）… 排序后全部读取
- 提取库名称（用于代码中的 TAG 等标识符）；逐行解析"测试 Demo 描述列表"表格：文档内序号 / 名称 / 描述 / 步骤 / 预期结果 / 对应函数接口
- **跨文档全局编号**：按文档输入顺序连续递增（文档 A 5 个 → 001–005，文档 B 3 个 → 006–008），禁止各文档独立从 001 开始
- 解析"接口覆盖矩阵"；统计 Demo 总数，规划生成文件列表（DemoIndex + N 个页面 + 3 个 string.json）

**错误处理**：缺必需字段的 Demo 跳过并在最终报告标注；文档缺"测试 Demo 描述列表"表格则立即停止并报告格式问题；接口签名缺失则标记"需手动验证接口"，代码用占位注释提醒。

### 0.2 探查工程结构与类型词典

- 识别 entry/、library/ 模块；读取 `entry/src/main/ets/` 目录结构、`main_pages.json`（路由）、`module.json5`（已声明权限）、一个现有页面 ETS（代码风格与导入惯例）、zh_CN/en_US `string.json`（已有键名，避免冲突）
- 运行 `devecocli --version` 确认 CLI 可用
- **UI 组件装饰器预检**：读 `library/Index.ets` 导出的 `@Component` 源码，搜索 `@ObjectLink`/`@Prop`/`@Link`，确认关联类带 `@Observed` 装饰器（接口规格文档第 5 章如有兼容性表可直接对照）；标注不兼容组件，场景规划时排除
- **建立依赖类型词典**（来源：`interfaceSpecPath` / `arktscoverage-interface-spec.md` + 库源码）：
  - 每个接口/类的**类型种类**：`(interface)` 不可 new / `(class)` 可 new / `@ObservedV2` 不可用于 `@State`
  - 每个回调接口的**完整字段签名**（如 `OnLoadCallBack.onLoadFailed: (err: string, imageInfo: ImageInfo) => void`）
  - 每个类的**属性名列表**（代码中只能使用列表内的属性名）

### 0.3 文件规划

建立内部规划表：`DemoIndex.ets` + N 个 `{序号}_{PascalCase}Page.ets`（全部平铺 `pages/`）+ base/zh_CN/en_US 三个 `string.json`。

---

## 阶段一：生成各 Demo 页面代码

### 1.1 文件命名

格式 `{三位序号}_{PascalCase功能描述}Page.ets`，如 `001_CheckSupportAndConfigPage.ets`、`010_PictureMetaPage.ets`。序号三位补零保证文件排序与 Demo 顺序一致；`main_pages.json` 路由与 `router.pushUrl` URL 均使用 `pages/001_XxxPage`（无子目录）。详见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md) 第 1 节。

### 1.2 分析权限需求

按优先级推断各 Demo 所需权限：

1. 场景文档"步骤/描述"中的权限关键词（网络、文件、相册、位置、蓝牙等）
2. `library/` 源码 import 与 API 调用（`http` → `ohos.permission.INTERNET`；`photoAccessHelper` → `READ_MEDIA`；sensor/蓝牙同理）
3. `module.json5` 已声明清单（避免重复声明）

区分系统自动授权权限（声明即可）与用户授权权限（须运行时动态申请）。常见权限速查见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md) 第 6 节。

### 1.3 接口与系统 API 预检（强制，未完成禁止生成代码）

对当前 Demo 涉及的**每一个接口**执行核心检查：

| 检查项 | 要点 |
|-------|------|
| 签名核对 | read_file 库源码逐接口确认参数/返回类型，**以源码为准**（场景文档签名可能过时：string/boolean/数字差异、容器类型、rest 参数差异） |
| 类型种类 | `(interface)` 不可 `new`（用对象字面量）；`(class)` 可 `new`；`@ObservedV2` 类不可用于 `@State`/`@Prop`/`@Link`，改用 `@Local`/`@Param` |
| 回调与属性 | 回调字段名与参数类型逐字匹配；只使用依赖类型词典列出的属性名 |
| undefined 守卫 | 返回 `\| undefined` 或 `?:` 的调用须 `if (result)` 判空再访问属性 |
| import 链 | 每个 `import { X }` 必须在 `library/Index.ets` 导出链中；未导出类型用对象字面量匹配结构，禁止 import；库源码也无定义则降级 `Record<string, Object>` 并标注 |
| 结构化类型 | 禁止 `new Uint8Array([..]).buffer` 赋值给 `ArrayBuffer`（`arkts-no-structural-typing`），改用 `new ArrayBuffer(n)` + 视图逐元素写入 |

完整检查表（含错误示例、场景文档差异四类专项核对）参见 [API_SIGNATURE_CHECKS.md](references/API_SIGNATURE_CHECKS.md) 第 1、2 节。

**系统 API 强制查证**：Demo 涉及的每个系统 API 依赖（`@kit.*` / `@ohos.*` / `@hms.*` 的方法签名、参数/返回值、枚举成员名、import 路径、权限、系统能力）必须调用 MCP 工具 `script_deveco_docs`（action=search → action=read）确认，**禁止凭记忆猜测**；**检索边界**：库自身 API 不在系统语料中，返回"未找到"时不检索、直接按接口规格文档/库源码编写。用法详见 [SYSTEM_API_LOOKUP.md](references/SYSTEM_API_LOOKUP.md)。

**import 类型链追踪**：代码中每个 import 的类型须验证存在于 `library/Index.ets` 导出链；回调签名中的衍生类型（如 `ImageInfo`）须在库源码中定位定义，未导出则用对象字面量匹配结构，禁止 import。详见 [API_SIGNATURE_CHECKS.md](references/API_SIGNATURE_CHECKS.md) 第 1 节 #8。

### 1.4 生成页面 ETS 代码

按 [TEMPLATE.md](references/TEMPLATE.md) 第 1/2 节标准模板生成（无权限版 / 含动态权限版），结构要点：

- 文件头 JSDoc（功能说明、对应接口）；`DOMAIN`/`TAG` 日志常量（TAG 格式 `{LibraryName}_{ComponentName}`）
- `@State` 状态变量具体类型；`aboutToAppear` 初始化，`aboutToDisappear` 释放资源（库实例、订阅、Timer）
- 核心方法：入口 `hilog.debug`、成功节点 `hilog.info`、异常 `hilog.error`；异步调用必须 `try/catch/finally`（finally 重置 Loading）

质量检查表：

| 要求 | 标准 |
|------|------|
| 日志覆盖 | 方法/事件回调入口 debug，成功节点 info，捕获异常 error |
| 错误处理 | 异步全部 try/catch；同步失败在 UI 展示错误信息 |
| 资源释放 | `aboutToDisappear` 释放库实例、取消订阅、清理 Timer |
| 类型安全 | 禁止 `any`/`unknown`/`ESObject`/`Object` |
| 权限申请 | 用户授权权限使用前通过 `abilityAccessCtrl.requestPermissionsFromUser` 动态申请 |
| 注释完整性 | 组件级 JSDoc + 核心方法 JSDoc + 关键逻辑行内注释 |
| UI 完整性 | 标题、操作控件、Loading/Error 状态指示、结果展示区域 |
| **@Builder 禁动态数据** | 展示动态 `@State`（耗时、计数器、状态标志）的节点必须内联在 `build()` 中；`@Builder` 仅用于不依赖 `@State` 的静态布局复用（如 DemoCard 传入静态数据对象属合法用法） |

ArkTS 编码规范（禁止项速查、日志格式、错误处理模式、资源生命周期、UI 规范）详见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md)。

### 1.5 生成多语言字符串资源

键名规则 `demo_{三位序号}_{语义描述}`（如 `demo_001_title`、`demo_001_check_btn`）；每个 Demo 额外添加 `demo_NNN_index_desc` 键（主导航列表描述），主导航标题用 `demo_index_title`。

> 🔴 **三文件同步（强制）**：每个 `$r('app.string.xxx')` 键必须同时在 `base/element/string.json`（默认值，建议中文）、`zh_CN/element/string.json`（值用【序号】前缀）、`en_US/element/string.json`（值用 Title Case）添加同名条目。遗漏 base 会报 `Warning: the string of 'xxx' does not have a base resource.`。键名以序号前缀隔离避免冲突。

- 动态文本（运行时错误信息 `this.resultText` 等）不属于静态字符串，不需要资源键，代码中直接赋值
- `reason` 等资源引用同理必须走 `$string:xxx`

### 1.6 复杂 Demo 辅助生成

满足任一条件时调用 `ohos-library-feature-adder` 技能辅助生成：涉及 PixelMap/AVPlayer/Camera 等重型系统 API、需实现复杂异步状态机、涉及 C/C++ NDK 接口调用。提供工程路径 + 功能描述（从场景文档提取的步骤和接口），生成后须按本技能规范（命名、日志、注释）二次校验和修改。

---

## 阶段二：生成主页面导航

### 2.1 DemoIndex.ets

按 [TEMPLATE.md](references/TEMPLATE.md) 第 3 节模板生成。要点：

- `DemoEntry { id: string; title: Resource; description: Resource; route: string }`，title/description 用 `$r('app.string.demo_NNN_title')` / `$r('app.string.demo_NNN_index_desc')` 赋值，禁止硬编码字符串
- `DEMO_LIST` 覆盖全部 Demo（数量与场景文档一致），route 为 `pages/001_XxxPage`（带序号前缀、无子目录）
- 跳转使用 `this.getUIContext().getRouter().pushUrl({ url })`，`.catch` 记录 `hilog.error`
- 若工程已有原始库演示页面（如 `pages/Tab`，经 `pages/Index` 跳转），**必须**保留其入口：按 [TEMPLATE.md](references/TEMPLATE.md) 第 6 节 OriginalDemoCard 模板（橙色徽章与蓝色序号卡片视觉区分）追加，字符串键 `demo_original_title` / `demo_original_index_desc` 同样三文件同步

### 2.2 路由注册与入口改造

- `main_pages.json`：`pages/DemoIndex` 列首位，其余按序号顺序排列（模板见 TEMPLATE.md 第 4 节）
- **EntryAbility**：将 `entry/src/main/ets/entryability/EntryAbility.ts` 中 `onWindowStageCreate` 的 `loadContent` 路径改为 `pages/DemoIndex`。⚠️ 须在 DemoIndex 生成并注册路由**之后**执行，否则路由未注册导致运行时白屏

---

## 阶段三：权限与系统能力适配

- 汇总各 Demo 所需权限，更新 `module.json5` 的 `requestPermissions`（`reason` 必须引用 `$string:xxx` 资源并在 string.json 添加对应键；模板见 TEMPLATE.md 第 5 节）
- 用户授权权限在页面 `aboutToAppear` 中动态申请，标准代码模式见 [CODE_STANDARDS.md](references/CODE_STANDARDS.md) 第 6.2 节

---

## 阶段四：质量检查与编译验证

> 核心原则：**编译是验证生成代码质量的唯一方式**；源库问题也必须尝试修复（仅限机械性操作：SDK 版本、依赖、构建配置，不改业务逻辑）。详细操作手册（迁移校验细节、Linter 判定、源库错误修复表、ohpm 兜底全流程）参见 [BUILD_VALIDATION.md](references/BUILD_VALIDATION.md)。

### 4.1 工程迁移（migrate.cjs，必做不可跳过）

> 🔴 无论工程类型（OpenHarmony/HarmonyOS）、无论 `compileSdkVersion` 是否与已安装 SDK 匹配，都必须执行迁移——源工程 hvigor 文件、`oh-package.json5`、`runtimeOS`/`compatibleSdkVersion` 等配置仍可能不兼容当前构建环境。禁止自行判断跳过。

```bash
# 有设备：先探测设备 API 版本（记录作为 --compatible-api）
hdc list targets
hdc shell param get const.ohos.apiversion

node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}} --compatible-api {deviceApi}

# 无设备（脚本自动探测已安装 SDK API 版本）
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

**执行后校验（未通过不得进入 4.2）**：输出以 `[migrate] 迁移完成。` 结尾；日志含 `[migrate] SDK版本: compatibleSdkVersion=...` 行；`build-profile.json5` 每个 product 的 `runtimeOS` 为 `HarmonyOS`；API 版本 ≤ 设备 API（有设备）或 = 已安装 SDK API（无设备）。任一项不满足 → 重新执行直至通过。

### 4.2 Code Linter 静态检查（编译前必做）

```bash
node {{skillDir}}/scripts/code-linter.cjs --source {{sourcePath}} --target entry/src/main/ets/pages
```

| 退出码 | 含义 | 处理 |
|-------|------|------|
| 0 | 0 Error | 进入 4.3 |
| 2 | 存在 Error | 逐条修复（生成代码错误按签名修正协议同源修复，见 API_SIGNATURE_CHECKS.md 第 3 节），重跑直至 0 Error，计入编译修复轮次 |
| 1 | 环境不可用（devecocli 不可用） | 标注"跳过"，进入 4.3（编译同样依赖该环境，届时会暴露） |

Warning 不阻塞编译：`file-naming-convention`（数字前缀与大驼峰规则的固有冲突）属可接受项；`addTryCatch`/未使用变量等为 P2 优化项；`.ets` 的 any/unknown 由 ArkTS 编译器强制把关。

### 4.3 编译验证（5 轮修复循环）

> 🔴 必须通过 build.ps1 执行——直接调用 devecocli build 会因 hvigor daemon 继承 Agent 管道句柄导致 session 永久阻塞。
> macOS/Linux（无 PowerShell）等效替代：`devecocli build --modules entry > build.log 2>&1`（重定向到文件同样规避句柄继承，实测多轮无阻塞），错误从 build.log 读取。

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build --modules entry"
```

编译通过 → 进入 4.4。失败则进入修复循环（最多 5 轮），每轮：

1. 逐条读取构建日志错误
2. **判断错误来源分级修复**：
   - **生成代码错误**（文件在 `entry/src/main/ets/pages/0XX_*`、`DemoIndex.ets`）：执行签名修正协议——按编译错误关键词对照 8 类修复表批量修正（见 [API_SIGNATURE_CHECKS.md](references/API_SIGNATURE_CHECKS.md) 第 3 节）；同文件同类错误一次性批量替换
   - **源库错误**（文件在 `library/`、源库原有 pages/、CMakeLists.txt、hvigorfile.ts、build-profile.json5）：仅机械性修复（SDK 版本/依赖/构建配置，修复表见 BUILD_VALIDATION.md 第 3.3 节）；业务逻辑错误不修复仅标注
3. 重新编译

**终止判定**：连续 2 轮错误均为源库不可修复错误 → 立即终止循环，标注原因后跳转 4.4。

**ohpm 线上版本兜底**（源库原生库 .so 需复杂构建导致编译失败时，触发条件与脚本行为详见 BUILD_VALIDATION.md 第 4 节）：

```bash
node {{skillDir}}/scripts/ohpm-switch.cjs --source {{sourcePath}}
cd {{sourcePath}} && ohpm install
# 然后按上述方式重新编译
```

替换后**必须做版本降级 API 兼容核验**：对照 `library/index.ets` 导出链逐一确认生成代码 import 的类型/常量/枚举仍存在；缺失则换更接近版本重跑脚本，或降级为对象字面量并标注。改动保留不回滚，但在报告中如实记录（引用 `ohpm-switch-report.json`）。

**降级（5 轮仍失败 / 提前终止）**：编译验证标注"跳过"，报告中分类列出未修复错误（需加入检查表 / 需源库作者修复 / 需 DevEco Studio 迁移工具升级项目结构）；任务状态仍为"完成"（代码生成本身已完成）。

### 4.4 代码规范自查清单

| 检查项 | 标准 |
|-------|------|
| 文件命名 | `{三位序号}_{PascalCase}Page.ets`，平铺 `pages/` 无子目录，数量与场景文档一致 |
| 日志 | 每文件独立 TAG、工程统一 DOMAIN；方法入口/异常日志无遗漏 |
| 异步与资源 | 无裸 await（全部 try/catch）；资源在 `aboutToDisappear` 释放 |
| 类型安全 | 无 any/ESObject/Object |
| 权限 | module.json5 声明 + 运行时动态申请齐全 |
| 国际化 | UI 文本全部 `$r()`；base/zh_CN/en_US 三文件键完全同步（含 `demo_NNN_index_desc`） |
| 主导航 | DEMO_LIST 数量一致；title/description 为 `Resource` 类型；main_pages.json 已注册全部路由；原始 Demo 入口已保留（如有） |
| 接口签名 | 全部对照库源码/规格文档验证，无猜测的属性名/回调参数/枚举成员（编译前快速兜底对照表见 [API_SIGNATURE_CHECKS.md](references/API_SIGNATURE_CHECKS.md)） |

### 4.5 功能验证点

按场景文档"预期结果"，在代码中贴近产生该结果的代码行添加注释标记（规范见 CODE_STANDARDS.md 第 8 节）：

```typescript
// ✅ 验证点 1: {从 Demo 预期结果提取的可观测指标}
// ✅ 验证点 2: {下一条预期结果}
```

---

## 阶段五：输出 Demo 代码生成报告

`write_file` 到 `{{outputDir}}/arkts-demo-code-report.md`，包含以下章节：

- **生成文件列表**：`DemoIndex.ets`（主导航）+ N 个 `{序号}_XxxPage.ets`（各 Demo 名称）
- **路由配置更新**：main_pages.json 新增 N 个路由（格式 `pages/{序号}_{PascalCaseName}Page`，无子目录）
- **字符串资源更新**：base / zh_CN / en_US 三个 string.json 新增键数量
- **权限变更**：module.json5 新增权限及用途说明
- **Code Linter 检查**：结果（通过 0 Error / 已修复 / 环境不可用跳过）；引用 `{{sourcePath}}/code-linter-report.json`；需人工确认的 Warning（如 file-naming-convention）
- **编译验证**：通过 / ⚠️ 跳过（原因与修复建议）。若执行了 ohpm 替换，附加：源库原生编译失败原因、切换的 `{库包名}@{版本号}`、依赖改动记录（引用 `ohpm-switch-report.json`）、版本降级 API 兼容核验结论、base 资源同步检查结论
- **验证步骤**：DevEco Studio 打开工程运行到鸿蒙设备 → 主导航点击 [001] 验证 → 按各 Demo 页面内"验证点"注释检查功能

---

## 参考资料

| 文档 | 内容 |
|------|------|
| [references/CODE_STANDARDS.md](references/CODE_STANDARDS.md) | 命名规则、ArkTS 禁止项、日志/错误处理/资源管理/权限/UI 规范速查 |
| [references/TEMPLATE.md](references/TEMPLATE.md) | Demo 页面、主导航、OriginalDemoCard、路由、权限声明代码模板 |
| [references/API_SIGNATURE_CHECKS.md](references/API_SIGNATURE_CHECKS.md) | 接口签名预检表、场景文档差异四类核对、编译错误签名修正协议 |
| [references/BUILD_VALIDATION.md](references/BUILD_VALIDATION.md) | 工程迁移、Code Linter、编译修复循环、ohpm 线上版本兜底操作手册 |
| [references/SYSTEM_API_LOOKUP.md](references/SYSTEM_API_LOOKUP.md) | 系统 API 检索工具 `script_deveco_docs` 使用指南 |
| [references/EXAMPLES.md](references/EXAMPLES.md) | ohos-blur-kit 完整生成示例（输入文档 → 页面代码 → 资源文件） |
