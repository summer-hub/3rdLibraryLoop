---
name: tpc-demo-code
description: 基于 Demo 场景文档（由 TPCDemoScenarioSkill 生成）自动生成可在 OpenHarmony 系统上编译运行的 ArkTS 测试 Demo 实现代码。所有 Demo ETS 页面文件统一存放在 pages/ 目录下，文件名格式为"序号_PascalCase描述Page.ets"，通过主页面统一导航，并同步生成中英文字符串资源。场景文档已自包含接口签名，无需额外读取接口规格文档。生成代码严格遵循华为 ArkTS 编码规范，包含 hilog 日志、错误处理、必要注释和权限适配。
license: Apache-2.0
metadata:
  author: AIWeb
  version: "2.0.0"
  category: harmonyos-development
  language: ArkTS/ETS
---

# TPC Demo ArkTS 代码生成

本 Skill 读取 Demo 场景文档（由 TPCDemoScenarioSkill 生成），为每个场景生成独立的 ArkTS 页面实现代码，并生成统一的主页面导航代码，确保所有代码能够在鸿蒙系统上编译运行，正确展示三方库的功能和使用方法。场景文档的"对应函数接口"列已自包含完整接口签名，无需额外读取接口规格文档。

> ⚠️ **核心约束**：所有生成的代码必须基于场景文档中明确列出的接口和功能。严禁凭空捏造不存在的接口、参数或行为。所有代码须通过 ArkTS 严格模式编译检查。

---

### 🚨 强制规则速查（开始工作前必读）

以下规则分为三个优先级层次，违反 **P0 核心规则** 直接视为任务失败：

#### P0 核心规则（必须严格遵守）

| 规则 | 核心要求 | 常见错误 |
|------|---------|---------|
| **数量完整性** | 场景文档有 N 个 Demo → 必须生成 N 个页面，一个都不能少 | 认为功能相似可合并、Demo 太多就省略 |
| **不捏造接口** | 只调用场景文档明确列出的接口（"对应函数接口"列），签名必须匹配 | 猜测接口参数或使用不存在的方法 |

#### P1 命名与结构规则（影响代码质量）

| 规则 | 核心要求 | 常见错误 |
|------|---------|---------|
| **文件命名与无子目录** | 文件名格式 `{三位序号}_{PascalCase描述}Page.ets`，全部平铺在 `pages/` 目录 | 创建 `001_check_support/CheckPage.ets` 这样的子目录结构 |
| **多文档全局编号** | 多个场景文档时序号全局连续，后续文档从前一文档末尾序号+1 递增 | 每个文档都从 001 开始 |

#### P2 代码规范（影响可维护性）

| 规则 | 核心要求 | 常见错误 |
|------|---------|---------|
| **国际化强制** | UI `Text`/`Button` 中所有静态字符串必须 `$r('app.string.xxx')`；`DemoEntry.title/description` 字段类型为 `Resource` | 直接写中文字符串 `'检测设备支持'`、`DemoEntry.title: string` |

---

### 📋 详细约束说明

> 📐 **编码规范（强制）**：严格遵循 [华为 ArkTS 编程规范](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-coding-style-guide)：PascalCase 类名、camelCase 方法/变量、2 空格缩进、行尾分号、禁止 `any`/`ESObject`。
>
> 🔢 **Demo 数量约束（强制）**：生成的 Demo 页面数量**必须**与场景文档中的 Demo 条目数量完全一致，**严禁**以任何理由减少、合并或跳过 Demo。若场景文档列出 N 个 Demo，则必须生成 N 个独立的页面文件，缺少任意一个均视为任务未完成。
>
> 🏷️ **文件命名与目录约束（强制）**：每个 Demo 页面的 ETS 文件名**必须**以三位补零序号开头，格式为 `{序号}_{PascalCase描述}Page.ets`，例如序号 1 对应 `001_FrameGrabPage.ets`，序号 10 对应 `010_PictureMetaPage.ets`。所有 Demo 页面文件统一存放在 `pages/` 目录下，**严禁**为每个 Demo 创建子目录，**严禁**生成不带序号前缀的页面文件。路由注册（`main_pages.json`）和导航代码（`DemoIndex.ets`）中的路径也必须使用带序号前缀的完整文件名（不含子目录路径，如 `pages/001_FrameGrabPage`）。
>
> 🔗 **多文档全局编号（强制）**：当输入包含多个场景文档时，所有文档中的 Demo **必须**使用**全局连续编号**，而非每个文档独立从 001 开始。按文档的输入顺序，第一个文档的 Demo 从 001 开始编号，后续文档紧接前一个文档的末尾序号继续递增。例如：文档 A 包含 5 个 Demo（001–005），文档 B 包含 3 个 Demo（006–008），文档 C 包含 4 个 Demo（009–012）。**严禁**在不同文档之间重复使用序号。
>
> 🌐 **国际化约束（强制）**：所有出现在 UI `Text`/`Button` 组件中的静态字符串（页面标题、按钮文本、区块标签等）**必须**通过 `$r('app.string.xxx')` 引用，禁止在 ETS 代码中硬编码任何 UI 文本。每个 Demo 生成时必须同步在 `entry/src/main/resources/zh_CN/element/string.json` 和 `entry/src/main/resources/en_US/element/string.json` 中添加对应的中英文字符串。**主导航页面的 `DemoEntry` 数组**中，`title` 和 `description` 字段类型必须声明为 `Resource`，并使用 `$r('app.string.demo_NNN_title')` 和 `$r('app.string.demo_NNN_index_desc')` 赋值，禁止直接写入硬编码字符串文字。
>
> 🚫 **`@Builder` 动态数据禁用约束（强制）**：**严禁**将 `@Builder` 方法用于展示需要动态更新的 `@State` 数据（如耗时、计数器、状态标志等）。原因：`@Builder` 在调用时对参数进行 **by-value 快照复制**，ArkUI diff 算法在同一位置遇到同一 `@Builder` 调用时判断"结构未变"而**跳过重渲染**，即使外部 `@State` 已更新，`@Builder` 子作用域内的展示内容也**不会刷新**。正确做法：将涉及动态 `@State` 的 UI 节点**直接内联在 `build()` 方法中**，让 `@State` 变量直接出现在组件树属性表达式里，ArkUI 才能建立正确依赖并触发细粒度更新。`@Builder` 仅适用于静态布局复用（不依赖 `@State` 的纯展示结构）；`DemoIndex` 中的 `@Builder DemoCard(demo: DemoEntry)` 传入静态数据对象，属于合法用法。

---

## 适用场景

- 将 `TPCDemoScenarioSkill` 生成的 Demo 场景文档转化为可运行代码
- 为已移植鸿蒙三方库快速生成功能验证 Demo 工程
- 生成符合华为规范的三方库示例代码用于文档展示或 QA 测试

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `sourcePath` | ✅ | 目标鸿蒙工程根目录（已编译通过，含 `entry/` 和 `library/` 模块） |
| `outputDir` | ✅ | 输出目录（场景文档和覆盖率报告所在目录） |
| `interfaceSpecPath` | 可选 | 接口规格文档路径，用于查询依赖类型的完整定义（回调签名、枚举成员、interface/class 区分）；若未提供，从 `outputDir` 搜索 `tpccoverage-interface-spec.md` |
| `scenarioDocPath` | 可选 | 单个场景文档路径；若未提供，从 `outputDir` 搜索所有 `*未覆盖接口Demo场景*.md` 文件 |

---

## 工作流程

### 阶段零：准备工作

#### 0.1 解析 Demo 描述文档

**步骤清单：**
- [ ] 若提供了 `{{scenarioDocPath}}`，使用该文件；否则在 `{{outputDir}}` 下搜索所有 `*未覆盖接口Demo场景*.md` 文件
- [ ] 若找到多个文件（多文档拆分模式），按文件名中的（一）（二）（三）...排序后全部读取
- [ ] 读取所有 Demo 场景文档全文
- [ ] 提取文档中的库名称（用于代码中的 TAG 等标识符）
- [ ] 对每个文档，解析"测试 Demo 描述列表"表格，提取每行的：
  - 文档内序号（整数）
  - 测试 Demo 名称（中文）
  - 测试 Demo 描述
  - 测试 Demo 步骤
  - 测试 Demo 预期结果
  - 对应函数接口（签名列表）
- [ ] 跨文档计算全局序号：
  - 按文档输入顺序排列，第一个文档的 Demo 保持原序号
  - 后续文档的 Demo 序号 = 前面所有文档的 Demo 总数 + 文档内序号
  - 例如：文档 1 有 5 个 Demo（全局 001–005），文档 2 有 3 个 Demo（全局 006–008）
- [ ] 解析"接口覆盖矩阵"，了解每个接口所属 Demo
- [ ] 统计所有文档的 Demo 总数，规划生成文件列表

**错误处理：**
- 若 Demo 描述文档缺失必需字段（如 Demo 名称、步骤、预期结果），记录错误并跳过该 Demo，在最终报告中标注
- 若文档格式不符预期（如缺少"测试 Demo 描述列表"表格），立即停止并向用户报告文档格式问题
- 若接口签名缺失或不完整，标记该 Demo 为"需手动验证接口"，生成代码时使用占位注释提醒

#### 0.2 探查鸿蒙工程结构

**步骤清单：**
- [ ] 列出工程根目录，识别 entry/、library/ 等模块
- [ ] 读取 entry/src/main/ets/ 目录结构，了解现有页面组织方式
- [ ] 读取 entry/src/main/resources/base/profile/main_pages.json，了解路由配置
- [ ] 读取 library/index.ets（或 library/src/main/ets/index.ets），获取库导出接口
- [ ] 读取 entry/src/main/module.json5，查看已声明权限
- [ ] 读取一个现有页面 ETS 文件，了解工程的代码风格和导入惯例
- [ ] 读取 entry/src/main/resources/zh_CN/element/string.json 和 entry/src/main/resources/en_US/element/string.json（若存在），了解已有字符串键命名规范，避免键名冲突
- [ ] **确认 deveco-cli 可用**：运行 `devecocli --version` 确认 CLI 已安装且可正常调用
- [ ] **UI 组件装饰器预检**：若接口规格文档第 5 章存在，直接对照兼容性表；否则 `read_file` library/Index.ets 中导出的 `@Component` 源文件，搜索 `@ObjectLink`/`@Prop`/`@Link`，确认关联类有 `@Observed` 装饰器；标注不兼容的组件，Demo 场景规划时排除
- [ ] **读取接口规格文档建立依赖类型词典**：若提供了 `{{interfaceSpecPath}}`，读取该文件；否则从 `{{outputDir}}` 搜索 `tpccoverage-interface-spec.md`。提取以下信息供生成代码时查询：
  - 每个接口/类的 **类型种类**（`(interface)` 不可 new, `(class)` 可 new, `@ObservedV2` 需 V2 装饰器）
  - 每个回调接口的 **完整字段签名**（如 `OnLoadCallBack.onLoadFailed: (err: string, imageInfo: ImageInfo) => void`）
  - 每个类的 **属性名列表**（代码中只能使用文档列出的属性名）

#### 0.3 生成文件规划

根据解析结果，建立文件规划表：

```
文件规划（内部工作记录）：
┌──────────────────────────────────────────────────────────────────────┐
│ 主页面：entry/src/main/ets/pages/DemoIndex.ets                        │
│                                                                      │
│ Demo 页面列表（所有文件统一存放于 pages/ 目录，无子目录）：               │
│   001_CheckSupportPage.ets      → Demo 1：环境检测                    │
│   002_BlurManagerLifecyclePage.ets → Demo 2：BlurManager 生命周期     │
│   003_SyncBlurImagePage.ets     → Demo 3：同步图像模糊                 │
│   ...                                                                │
│                                                                      │
│ 字符串资源：                                                           │
│   entry/src/main/resources/zh_CN/element/string.json                │
│   entry/src/main/resources/en_US/element/string.json                │
└──────────────────────────────────────────────────────────────────────┘
```

---

### 阶段一：生成各 Demo 页面代码

对每个 Demo，按以下步骤生成对应的 ArkTS 页面文件。

#### 1.1 推导 Demo 文件命名

**命名规则**：所有 Demo 页面 ETS 文件统一放在 `pages/` 目录，文件名格式为 `{序号(三位补零)}_{PascalCase功能描述}Page.ets`。

示例映射：
| 序号 | 中文 Demo 名称 | 页面文件名 |
|------|--------------|-----------|
| 1 | 环境检测与配置创建 Demo | `001_CheckSupportAndConfigPage.ets` |
| 2 | BlurManager 生命周期管理 Demo | `002_BlurManagerLifecyclePage.ets` |
| 3 | 同步图像模糊处理 Demo | `003_SyncBlurImagePage.ets` |
| 4 | 异步图像模糊处理 Demo | `004_AsyncBlurImagePage.ets` |

关键规则：
- 序号必须三位数字（`001`、`010`、`100`），保证文件排序与 Demo 顺序一致
- 文件名 PascalCase 英文描述使用大驼峰，体现该 Demo 的核心功能
- 所有 Demo 页面文件统一放在 `pages/` 目录，**严禁**为每个 Demo 创建子目录
- **⚠️ 强制**：所有描述文档中共有多少个 Demo 条目，就必须生成多少个页面文件，数量严格对应，不可减少
- **⚠️ 强制**：ETS 文件名必须以序号前缀开头（如 `001_FrameGrabPage.ets`），`main_pages.json` 路由路径和 `DemoIndex.ets` 中的 `router.pushUrl` URL 均须使用带完整序号前缀的名称（如 `pages/001_FrameGrabPage`）
- **⚠️ 强制（多文档编号）**：当存在多个描述文档时，序号在所有文档之间全局连续递增，不得在每个文档内各自从 001 重新开始。第二个文档的首个 Demo 序号 = 第一个文档的 Demo 总数 + 1，依此类推

#### 1.2 分析接口权限需求

从源码和场景文档中推断各 Demo 需要的权限：

```
权限分析方式（按优先级）：
1. 读取 Demo 场景文档的"步骤"和"描述"列，提取权限相关关键词
   （如"网络"、"文件"、"相册"、"位置"、"蓝牙"等）
2. 读取 library/ 模块源码中的 import 语句和 API 调用，识别涉及的系统能力：
   - import http → ohos.permission.INTERNET
   - import fileIo / file.fs → 文件读写权限
   - import photoAccessHelper → ohos.permission.READ_MEDIA / WRITE_MEDIA
   - import sensor → 传感器权限
   - import bluetooth → 蓝牙权限
3. 读取 entry/src/main/module.json5，列出已声明的权限（避免重复声明）
4. 分类：
   - 系统权限（module.json5 声明即可自动授权，如 INTERNET）
   - 用户授权权限（需运行时 requestPermissionsFromUser 动态申请，如 READ_MEDIA）
```

#### 1.3 逐接口对照规格文档（强制预检）

> ⚠️ **此步骤必须在生成任何代码之前执行**，逐接口对照接口规格文档，杜绝凭记忆猜测类型。

对当前 Demo 涉及的**每一个接口**，执行以下检查并记录结论：

| 检查项 | 查询来源 | 记录内容 |
|-------|---------|---------|
| **类型种类** | 接口规格文档第 4 章 | `(interface)` — 不可 `new`，用对象字面量；`(class)` — 可 `new`；`@ObservedV2` — 不可用于 `@State` |
| **返回值守卫** | 接口规格文档签名 | 返回类型是否含 `\| undefined` 或 `?:`？若含则调用后必须 `if (result)` 判空再访问属性 |
| **参数类型匹配** | 接口规格文档签名 | 参数是否声明为 `common.UIAbilityContext`？若是则传 `appContext as common.UIAbilityContext`，不可直接传 `common.Context` |
| **回调参数签名** | 接口规格文档回调接口定义 | 回调的每个字段名和参数类型，代码中必须逐字匹配 |
| **属性名准确性** | 接口规格文档第 3 章属性列表 | 该类的所有属性名，代码中只能使用列表内的名称 |
| **枚举成员名** | ① 三方库枚举：`read_file` 库源码 ② 系统SDK枚举：`devecocli docs search <枚举名> --catalog harmonyos-references` → `devecocli docs read <documentId>` | 不做大小写假设，系统枚举查 API 参考文档确认 |
| **import 类型存在性** | `library/Index.ets` | 代码中 `import { X }` 的每个 X 必须在 Index.ets 导出链中；不存在的类型用对象字面量，禁止 import |

> 🚨 **系统 SDK 枚举强制验证（立即执行，不可跳过）**：
>
> 当前 Demo 涉及的**每一个**系统 SDK 枚举（如 `ImageFit`、`BorderStyle`、`FontWeight`、
> `TextAlign`、`TextOverflow` 等），**必须立即运行以下命令**确认成员名，禁止凭记忆猜测：
>
> ```
> devecocli docs search <枚举名> --catalog harmonyos-references --limit 10
> # 从上一步结果获取文档 ID，然后：
> devecocli docs read <文档ID>
> ```
>
> 验证通过后将实际成员名记录到下方，**未完成此步骤禁止进入 1.4 生成代码**。
>
> 🚨 **第二步：import 类型链强制追踪（立即执行，不可跳过）**：
>
> 代码中 `import { X, Y } from '@ohos/库名'` 的**每一个**类型，必须满足以下流程：
>
> 1. `read_file library/Index.ets` → 列出所有 `export` 的类型名
> 2. 对每个 import 的 X、Y，确认其在导出列表中；不在则**禁止 import**
> 3. 对回调签名中出现的衍生类型（如 `onLoadFailed: (err: string, imageInfo: ImageInfo)` 中的 `ImageInfo`）：
>    - `read_file` 库源码找到该类型的 class/interface 定义
>    - 若该类型未通过 Index.ets 导出 → 代码中用**对象字面量**匹配结构，**禁止 import**
>    - 若库源码中也找不到定义 → 标记为"不可用"，回调中降级为 `Record<string, Object>`
> 4. 完成后将已验证的类型列表和来源记录到下方
> 
> **未完成此步骤禁止进入 1.4 生成代码**。

完成本 Demo 所有接口的对照后，再进入 1.4 生成代码。

#### 1.4 生成 Demo 页面 ETS 代码

每个 Demo 页面文件的结构规范：

```typescript
/**
 * Demo {序号}: {英文功能描述}
 * 
 * 功能说明：{从 Demo 描述文档提取的描述}
 * 对应接口：{涉及的函数签名列表}
 * 
 * @author lalhan
 */

import hilog from '@ohos.hilog';
// 按需导入其他模块（权限、媒体、文件等）

import { LibraryClass, libraryFunc } from '{库包名}';

// ─── 日志常量（禁止在此以外的地方直接使用魔法字符串） ───────────────────────
const DOMAIN: number = 0xD001;   // 与工程其他模块保持统一域值范围
const TAG: string = '{LibraryName}_{ComponentName}';

// ─── 页面状态类型定义（禁止使用 any/Object/ESObject） ────────────────────────
interface DemoState {
  // 页面中需要响应式更新的状态字段（具体类型）
}

/**
 * {ComponentName} - {Demo 功能说明}
 *
 * 展示 {库名} 的 {核心功能} 使用方法。
 */
@Entry
@Component
struct {ComponentName} {
  // ─── 状态变量（@State 响应式）──────────────────────────────────────────────
  @State private resultText: string = '';
  @State private isLoading: boolean = false;
  // ...其他状态

  // ─── 非响应式成员 ──────────────────────────────────────────────────────────
  // （库实例、定时器 ID 等）

  // ─── 生命周期 ──────────────────────────────────────────────────────────────

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'Demo page appeared');
    // 初始化逻辑（如权限检查、资源加载）
  }

  aboutToDisappear(): void {
    hilog.info(DOMAIN, TAG, 'Demo page disappeared');
    // 必须在此处释放持有的资源（库实例、订阅、Timer 等）
  }

  // ─── 核心功能方法 ──────────────────────────────────────────────────────────

  /**
   * {方法说明}
   * {参数说明}
   */
  private async {actionMethod}(): Promise<void> {
    hilog.debug(DOMAIN, TAG, '{actionMethod} called');
    this.isLoading = true;
    try {
      // 调用三方库接口
      const result = await {libraryCall};
      hilog.info(DOMAIN, TAG, '{actionMethod} succeeded: %{public}s', String(result));
      this.resultText = `结果：${String(result)}`;
    } catch (err) {
      const msg: string = (err as Error).message ?? String(err);
      hilog.error(DOMAIN, TAG, '{actionMethod} failed: %{public}s', msg);
      this.resultText = `错误：${msg}`;
    } finally {
      this.isLoading = false;
    }
  }

  // ─── UI 构建 ──────────────────────────────────────────────────────────────

  build() {
    Column({ space: 16 }) {
      // 页面标题（通过 $r() 引用国际化字符串，禁止硬编码文本）
      Text($r('app.string.demo_{seq}_title'))
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .width('100%')
        .textAlign(TextAlign.Center)
        .padding({ top: 16 })

      // 操作控件区域
      // ...根据 Demo 步骤描述生成具体 UI（所有按钮/标签文本均须用 $r()）

      // 执行按钮
      Button($r('app.string.demo_{seq}_{action}_btn'))
        .width('100%')
        .enabled(!this.isLoading)
        .onClick(() => this.{actionMethod}())

      // 结果展示区域
      if (this.isLoading) {
        LoadingProgress().width(40).height(40)
      } else {
        Text(this.resultText)
          .fontSize(14)
          .width('100%')
          .padding(12)
          .backgroundColor('#F5F5F5')
          .borderRadius(8)
      }
    }
    .width('100%')
    .height('100%')
    .padding(16)
  }
}
```

**代码生成质量要求（逐条强制检查）**：

| 要求 | 检查标准 |
|------|---------|
| 日志覆盖 | 每个公共方法/事件回调入口必须有 `hilog.debug`，关键成功节点有 `hilog.info`，捕获异常有 `hilog.error` |
| 错误处理 | 所有异步调用必须用 `try/catch` 包裹，同步调用失败须在 UI 上显示错误信息 |
| 资源释放 | `aboutToDisappear` 中释放库实例、取消订阅、清理 Timer |
| 类型安全 | 禁止 `any`、`ESObject`、`Object`，所有变量须声明具体类型 |
| 权限申请 | 需要用户授权的权限必须在使用前动态申请，使用 `abilityAccessCtrl.requestPermissionsFromUser` |
| 注释完整性 | 组件级 JSDoc + 每个核心方法 JSDoc + 关键逻辑行内注释 |
| UI 完整性 | 页面包含标题、操作按钮/控件、状态指示（Loading/Error）、结果展示区域 |
| **`@Builder` 动态数据禁用** | **严禁**用 `@Builder` 方法展示需动态更新的 `@State` 变量（耗时、计数器、状态标志等）。`@Builder` 参数为 by-value 快照，ArkUI diff 跳过重渲染导致数值永远不更新。所有涉及动态 `@State` 的 `Text`/`Image` 等节点**必须直接内联在 `build()` 中**，不得抽取到 `@Builder` 方法。`@Builder` 仅用于不依赖 `@State` 的静态布局复用 |

#### 1.5 生成多语言字符串资源

为每个 Demo 页面的所有 UI 文本，在中英文资源文件中添加对应条目。

**键名命名规则**：`demo_{三位序号}_{语义描述}`，例如 `demo_001_title`、`demo_001_check_btn`。

每个 Demo 生成后，在以下两个资源文件中分别追加对应条目：

`entry/src/main/resources/zh_CN/element/string.json` 追加：
```json
{ "name": "demo_001_title", "value": "【001】环境检测与配置创建" },
{ "name": "demo_001_check_btn", "value": "检测设备支持" },
{ "name": "demo_001_create_config_btn", "value": "创建模糊配置" }
```

`entry/src/main/resources/en_US/element/string.json` 追加：
```json
{ "name": "demo_001_title", "value": "[001] Check Support And Config" },
{ "name": "demo_001_check_btn", "value": "Check Device Support" },
{ "name": "demo_001_create_config_btn", "value": "Create Blur Config" }
```

**生成规范**：
- 键名需唯一，以序号前缀隔离不同 Demo 的键值，避免冲突
- 中文值使用【序号】前缀标识，方便在 UI 上区分
- 英文值使用 Title Case
- 动态文本（如运行时错误信息 `this.resultText`）不属于静态字符串，不需要添加到资源文件，在代码中直接赋值即可
- **主导航页面专用键**：每个 Demo 还须额外添加 `demo_NNN_index_desc` 键，用于主导航页面列表的描述文字（`DemoEntry.description` 字段），同样须在 zh_CN 和 en_US 中各添加一条；主导航页面标题使用 `demo_index_title` 键

#### 1.6 调用 ohos-library-feature-adder 辅助生成复杂代码

对于涉及复杂接口调用（如媒体处理、传感器、蓝牙等）的 Demo，使用 `ohos-library-feature-adder` 技能辅助生成：

```
触发条件（满足任一项）：
- Demo 涉及 PixelMap、AVPlayer、Camera 等重型系统 API
- Demo 需要实现复杂的异步状态机
- Demo 涉及 C/C++ NDK 接口调用

调用方式：
  向 ohos-library-feature-adder 提供：
  1. 鸿蒙工程路径
  2. 功能描述（从 Demo 描述文档提取的步骤和接口）
  3. 生成后需按本技能规范（命名、日志、注释）进行二次校验和修改
```

---

### 阶段二：生成主页面导航代码

#### 2.1 主页面结构

生成 `DemoIndex.ets`（或在现有主页面中添加导航入口），实现对所有 Demo 页面的跳转：

```typescript
/**
 * {LibraryName} Demo 主导航页面
 *
 * 提供所有 Demo 的入口列表，通过 router.pushUrl 跳转到各 Demo 页面。
 */

import hilog from '@ohos.hilog';
import router from '@ohos.router';

const DOMAIN: number = 0xD001;
const TAG: string = '{LibraryName}_DemoIndex';

// Demo 条目数据结构（title/description 使用 Resource 类型，支持国际化）
interface DemoEntry {
  id: string;          // Demo 编号，如 "001"
  title: Resource;     // Demo 名称，通过 $r('app.string.demo_NNN_title') 引用
  description: Resource; // Demo 简要描述，通过 $r('app.string.demo_NNN_index_desc') 引用
  route: string;       // 路由路径
}

// Demo 列表配置（按序号排列；title/description 必须用 $r() 引用，禁止硬编码字符串）
const DEMO_LIST: DemoEntry[] = [
  {
    id: '001',
    title: $r('app.string.demo_001_title'),
    description: $r('app.string.demo_001_index_desc'),
    route: 'pages/001_{PascalCaseName}Page'
  },
  // ... 其他 Demo
];

@Entry
@Component
struct DemoIndex {
  build() {
    Column() {
      Text($r('app.string.demo_index_title'))
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .padding({ top: 20, bottom: 20 })

      List({ space: 8 }) {
        ForEach(DEMO_LIST, (demo: DemoEntry) => {
          ListItem() {
            this.DemoCard(demo)
          }
        }, (demo: DemoEntry) => demo.id)
      }
      .width('100%')
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16 })
  }

  @Builder
  DemoCard(demo: DemoEntry): void {
    Row({ space: 12 }) {
      // 序号徽章（纯动态字符串，直接插入 demo.id 即可）
      Text(demo.id)
        .fontSize(14)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .width(44).height(44)
        .textAlign(TextAlign.Center)
        .backgroundColor('#3478F6')
        .borderRadius(22)

      // 标题 + 描述（Resource 类型，直接传入 Text，不可用模板字符串插入）
      Column({ space: 4 }) {
        Text(demo.title)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        Text(demo.description)
          .fontSize(11)
          .fontColor('#888888')
          .width('100%')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      // 箭头
      Text('›')
        .fontSize(20)
        .fontColor('#BBBBBB')
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .backgroundColor(Color.White)
    .onClick(() => {
      hilog.info(DOMAIN, TAG, 'Navigate to demo: %{public}s', demo.id);
      this.getUIContext().getRouter().pushUrl({ url: demo.route })
        .catch((err: Error) => {
          hilog.error(DOMAIN, TAG, 'Navigation failed: %{public}s', err.message);
        });
    })
  }
}
```

#### 2.2 更新路由配置

在 `entry/src/main/resources/base/profile/main_pages.json` 中添加所有新 Demo 页面的路由：

```json
{
  "src": [
    "pages/DemoIndex",
    "pages/001_CheckSupportPage",
    "pages/002_BlurManagerLifecyclePage"
  ]
}
```

#### 2.3 修改 EntryAbility 入口指向 DemoIndex

**必须**将 `entry/src/main/ets/entryability/EntryAbility.ts` 中 `onWindowStageCreate` 的 `loadContent` 路径从原始首页改为 `pages/DemoIndex`，使 App 启动后直接进入 Demo 导航列表：

```typescript
// 修改前
windowStage.loadContent('pages/Index', (err, data) => { ... });

// 修改后
windowStage.loadContent('pages/DemoIndex', (err, data) => { ... });
```

> ⚠️ 注意：此修改须在生成 `DemoIndex.ets` 并更新 `main_pages.json` 之后进行，否则 `pages/DemoIndex` 路由未注册会导致运行时白屏。

#### 2.4 在 DemoIndex 中保留原始库 Demo 入口

若工程中已有原始的三方库功能演示页面（如 `pages/Tab`，通过 `pages/Index` 跳转进入），**必须**在 `DemoIndex.ets` 中以视觉区分的方式保留其跳转入口，确保原有 Demo 不被覆盖：

1. 在 `DemoIndex.ets` 顶层常量区声明原始 Demo 路由：

```typescript
// 原始库 Demo 路由（保留原有演示，不纳入序号列表）
const ORIGINAL_DEMO_ROUTE: string = 'pages/Tab';
```

2. 在 `struct DemoIndex` 中添加 `@Builder OriginalDemoCard()` 方法（静态布局，无 `@State`）：

```typescript
@Builder
OriginalDemoCard(): void {
  Row({ space: 12 }) {
    Text('↗')
      .fontSize(14).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      .width(44).height(44).textAlign(TextAlign.Center)
      .backgroundColor('#FF8C00')  // 橙色，与蓝色序号徽章区分
      .borderRadius(22)

    Column({ space: 4 }) {
      Text($r('app.string.demo_original_title'))
        .fontSize(14).fontWeight(FontWeight.Medium).width('100%')
      Text($r('app.string.demo_original_index_desc'))
        .fontSize(11).fontColor('#888888').width('100%')
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .layoutWeight(1).alignItems(HorizontalAlign.Start)

    Text('›').fontSize(24).fontColor('#BBBBBB')
  }
  .width('100%')
  .padding({ left: 16, right: 16, top: 12, bottom: 12 })
  .backgroundColor('#FFF8EE')
  .borderRadius(8)
  .border({ width: 1, color: '#FFD580', style: BorderStyle.Solid })
  .onClick(() => {
    router.pushUrl({ url: ORIGINAL_DEMO_ROUTE }).catch((err: Error) => {
      hilog.error(DOMAIN, TAG, 'Original demo navigation failed: %{public}s', err.message);
    });
  })
}
```

3. 在 `build()` 的 Divider 下方、序号 Demo List 上方插入原始 Demo 卡片（用 Column 包裹确保水平边距一致）：

```typescript
Column() {
  this.OriginalDemoCard()
}
.width('100%')
.padding({ left: 16, right: 16 })
```

4. 在 zh_CN 和 en_US `string.json` 中添加对应字符串键：

```json
// zh_CN
{ "name": "demo_original_title", "value": "原始三方库示例" },
{ "name": "demo_original_index_desc", "value": "原有三方库功能演示页面（保留入口）" }

// en_US
{ "name": "demo_original_title", "value": "Original Library Demo" },
{ "name": "demo_original_index_desc", "value": "Original library feature showcase page (preserved entry)" }
```

---

### 阶段三：权限与系统能力适配

#### 3.1 更新 module.json5 权限声明

将各 Demo 所需权限汇总，更新 `module.json5`：

```json5
{
  "module": {
    "requestPermissions": [
      {
        "name": "ohos.permission.INTERNET",
        "reason": "$string:permission_internet_reason",
        "usedScene": {
          "abilities": ["EntryAbility"],
          "when": "inuse"
        }
      }
      // ... 其他权限
    ]
  }
}
```

#### 3.2 动态权限申请模板

对于需要用户授权的权限，在 Demo 页面的 `aboutToAppear` 中添加：

```typescript
import abilityAccessCtrl, { Permissions } from '@ohos.abilityAccessCtrl';
import common from '@ohos.app.ability.common';

private async requestNeededPermissions(): Promise<boolean> {
  const permissions: Permissions[] = ['ohos.permission.READ_MEDIA'];
  const context = getContext(this) as common.UIAbilityContext;
  const atManager = abilityAccessCtrl.createAtManager();
  
  try {
    const result = await atManager.requestPermissionsFromUser(context, permissions);
    const allGranted = result.authResults.every(r => r === 0);
    hilog.info(DOMAIN, TAG, 'Permission request result: %{public}s', 
               allGranted ? 'granted' : 'denied');
    return allGranted;
  } catch (err) {
    hilog.error(DOMAIN, TAG, 'Permission request failed: %{public}s', (err as Error).message);
    return false;
  }
}
```

---

### 阶段四：代码质量检查与编译验证

生成所有文件后，执行以下检查：

#### 4.1 工程迁移（migrate.cjs）

三方库源码多为历史工程，`build-profile.json5` 的 SDK 版本配置、hvigor 文件、oh-package.json5 等经常不兼容当前构建环境。使用 `migrate.cjs` 脚本一次性完成华为官方 Manual Migration 全流程迁移。

1. 执行迁移脚本：

```powershell
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

#### 4.2 编译验证（5 轮修复策略）

> 🔴 **必须通过 build.ps1 执行**，直接调用 devecocli build 会导致 session 永久阻塞（hvigor daemon 继承 Agent pipe 句柄不释放）。
> 编译是验证生成代码质量的**唯一方式**，
> 因此源库问题也必须尝试修复——否则隐藏的生成代码错误会传给下游。
> 源库修复仅限**机械性**操作（SDK 版本、依赖、构建配置），不改源库业务逻辑。

##### 首次编译

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build --modules entry"
```

编译通过 → 跳转 4.2。

##### 修复循环（最多 5 轮）

每轮：
1. 逐条读取构建日志中的错误
2. **判断错误来源并分级修复**：

**生成代码错误**（文件路径在 `entry/src/main/ets/pages/0XX_*`、`DemoIndex.ets`）：

> 🔴 **签名修正协议（每轮必须执行）**
>
> 生成代码的接口签名错误是系统性错误——SubAgent 未对照 Spec 生成。编译报错后按以下协议批量修正：
>
> 1. `read_file` 读取每个报错文件
> 2. 对照 `{{interfaceSpecPath}}` + `library/Index.ets`，按错误关键词匹配修复：
>
> | # | 编译错误关键词 | 修复方式 |
> |---|--------------|---------|
> | 1 | `Property 'xxx' does not exist` | 方法名拼写错误 → 查 Spec 替换（如 `rawQuery` → `queryRaw`） |
> | 2 | `Expected N arguments, but got M` | 参数数量不匹配 → 查 Spec 参数表补全/删除 |
> | 3 | `Argument of type 'X[]' is not assignable` | rest 参数当数组传 → `func(...arr)` 展开 |
> | 4 | `Property 'xxx' does not exist on type 'Y'` | 方法归属类错误 → 补中间链（`qb.list()` → `qb.build().list()`） |
> | 5 | `arkts-no-any-unknown` / `arkts-no-inferred-generic-params` | any/unknown 类型 → 定义具体 interface，禁 `as` |
> | 6 | `Module has no exported member` | import 不存在 → 对照 Index.ets，改用对象字面量 |
>
> 3. 同文件同类错误一次性 `replace_string_in_file` 批量替换

| 错误类型 | 修复方式 |
|---------|---------|
| 对照 4.3 表已知模式 | 按表修复 |
| 接口签名/类型不匹配 | 执行签名修正协议（上表 6 项） |
| import 类型不存在 | 对照 `library/Index.ets` 验证导出链 |
| 表外新错误 | 分析 → 修复 → 记录到 4.3 表 |

**源库错误**（文件路径在 `library/`、源库原有 pages/、CMakeLists.txt、hvigorfile.ts、build-profile.json5）：

| 错误类型 | 修复方式 | 可修复？ |
|---------|---------|---------|
| SDK 版本不匹配（compileSdkVersion） | 修正 `build-profile.json5` | ✅ |
| 依赖缺失（oh-package.json5） | 补充 devDependencies | ✅ |
| CMake 选项冲突（-D 参数覆盖） | 修改 `build-profile.json5` 的 `externalNativeOptions` | ✅ |
| 缺失头文件（如 avif.h） | 关闭对应 CMake 选项或补充子模块 | ⚠️ 尝试 |
| hvigorfile.ts 缺失 | `git submodule update --init --recursive` | ✅ |
| 源库 ArkTS 类型错误 | 修正类型注解/补充 @Observed | ⚠️ 仅机械性 |
| 源库业务逻辑错误 | 不修复，标注 | ❌ |


3. 重新编译：

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build --modules entry"
```

4. 编译通过 → 跳转 4.3

**终止判定（立即退出循环）**：

若构建日志中出现以下任一模式，**立即终止修复循环**，不再尝试后续轮次，直接跳转 4.3 代码规范自查：
- 连续 2 轮出现的错误均为源库不可修复错误（❌ 行）

终止后在报告中标注编译跳过原因和修复建议。

##### 降级：5 轮仍失败 / 提前终止

- ⚠️ 编译验证未通过
- 在最终报告中列出：
  - 生成代码未修复的错误 → 标注"需加入 4.3 检查表"
  - 源库不可修复的错误 → 标注"需源库作者修复"
  - 项目结构迁移类错误 → 标注"需在 DevEco Studio 中使用迁移工具升级项目结构"
- **任务状态仍为"完成"**（代码生成本身已完成，编译验证因源库问题跳过）

#### 4.3 代码规范自查清单

| 检查项 | 标准 | 状态 |
|-------|------|------|
| 文件命名规范 | `{三位序号}_{PascalCase描述}Page.ets`，所有文件平铺于 `pages/` 目录，无子目录 | □ |
| 日志 DOMAIN/TAG 正确 | 每个文件有独立 TAG，DOMAIN 在工程范围内统一 | □ |
| 每个方法有 hilog.debug 入口日志 | 无遗漏 | □ |
| 异步调用有 try/catch | 无裸 await | □ |
| 资源在 aboutToDisappear 释放 | 无资源泄露 | □ |
| 无 any/ESObject/Object 类型 | 全量类型安全 | □ |
| 需要权限的接口有权限申请逻辑 | 无缺失 | □ |
| UI 文本全部使用 $r() 引用 | 无硬编码中文或英文静态 UI 文本 | □ |
| zh_CN string.json 已添加全部键 | 每个 UI 文本对应一条中文记录 | □ |
| en_US string.json 已添加全部键 | 每个 UI 文本对应一条英文记录 | □ |
| 主页面 DEMO_LIST 包含全部 Demo | 与描述文档数量一致；`DemoEntry.title/description` 类型为 `Resource`，值为 `$r()` 引用 | □ |
| main_pages.json 路由已更新 | 所有新页面已注册 | □ |
| **接口签名精确性** | 禁止猜测属性名/回调参数/枚举成员名；所有类型引用必须对照接口规格文档和源码验证 | □ |

#### 4.4 接口签名精确性检查（强制，编译前快速兜底）

> ⚠️ 以下错误高频出现，1.3 预检应已预防大部分。本表是**编译前快速兜底**——生成代码后逐文件对照一遍，若 1.3 严格执行到位，本表应 Zero-hit。

| 检查项 | 错误示例 | 正确做法 | 检查方法 |
|-------|---------|---------|---------|
| **枚举成员名** | `ImageFit.CONTAIN` | `ImageFit.Contain` | 🚨 系统枚举立即运行：`devecocli docs search <枚举名> --catalog harmonyos-references` → `devecocli docs read <id>`，不执行禁止继续 |
| **组件名/类名准确性** | `ImageKnifeComponentV2` | `ImageKnifeComponent` | 组件名/类名必须与库 `Index.ets` 导出名**逐字符一致**，禁止自行追加"V2"/"New"等后缀 |
| **interface/class 区分** | `new HttpRequestOption()` | `{ ... } as HttpRequestOption` | 查接口规格文档第 4 章：`(interface)` 不能用 `new`；`(class)` 可以用 `new` |
| **回调参数类型** | `(errorInfo: ErrorInfo) => void` | `(err: string, imageInfo: ImageInfo) => void` | 查接口规格文档第 4 章的回调接口定义，严格匹配字段类型 |
| **属性名准确** | `obj.transformationType` | `obj.type` | 查接口规格文档第 3 章该类的属性列表，只能使用文档列出的属性名 |
| **`@ObservedV2` + `@State` 冲突** | `@State option: ImageKnifeOptionV2`（类型为 @ObservedV2 类） | 改用 `@Local option: ImageKnifeOptionV2 = new ...` 或使用 `!!` 语法 | `@ObservedV2` 装饰的类不能用于 `@State`/`@Prop`/`@Link`（V1 装饰器），须改用 V2 装饰器 `@Local`/`@Param`/`@Provider`/`@Consumer` |
| **`\| undefined` 返回值守卫** | `result.imageWidth`（result 可能为 undefined） | `if (result) { expect(result.imageWidth)... }` | 签名含 `\| undefined` 或 `?:` 的返回值，访问其属性前必须显式判空 |
| **组件装饰器兼容** | `ImageKnifeComponent({ option })` 但 ImageKnifeOption 未 @Observed | 0.2 预检应已识别：库组件 @ObjectLink/@Prop/@Link 需关联类带 @Observed | 查接口规格文档第 5 章/组件源码装饰器 |
| **import 类型存在性** | `import { ImageInfo } from '库名'` 但库未导出 | 每个 import 类型名必须在 library/Index.ets 导出链中 | 1.3 预检应已追踪：不存在的类型用对象字面量，禁止 import |
| **新增未知错误** | 编译失败出现表外错误 | 对照接口规格文档+源码分析修复 → 记录模式 → 下次合并到本表 | 编译失败时对照本表，表外错误修复后必须记录 |

#### 4.5 功能验证点

针对 Demo 描述文档中的"预期结果"，在代码中添加注释标记，方便开发者在设备上验证：

```typescript
// ✅ 验证点 1: {从 Demo 预期结果提取的可观测指标}
// ✅ 验证点 2: {下一条预期结果}
```

---

### 阶段五：输出Demo代码生成报告

`write_file` `{{outputDir}}/tpccoverage-demo-code-report.md`：

生成完成后，向用户输出以下信息： 

```markdown
## 代码生成完成

### 生成文件列表

| 文件路径 | 说明 |
|---------|------|
| entry/src/main/ets/pages/DemoIndex.ets | 主导航页面 |
| entry/src/main/ets/pages/001_XxxPage.ets | Demo 1：{名称} |
| ... | ... |

### 路由配置更新
已更新 `main_pages.json`，新增 N 个路由（路径格式：`pages/{序号}_{PascalCaseName}Page`，无子目录）。

### 字符串资源更新
已在以下文件中新增 N 个字符串键：
- `entry/src/main/resources/zh_CN/element/string.json`：中文 UI 文本
- `entry/src/main/resources/en_US/element/string.json`：英文 UI 文本

### 权限变更
已在 `module.json5` 中新增以下权限声明：
- `ohos.permission.XXX`：{用途说明}

### 编译验证
{编译结果：通过 / 存在警告（已修复） / ⚠️ 已跳过}

（若跳过，需附以下信息：）
- 跳过原因：
- 修复建议：

### 验证步骤
1. 在 DevEco Studio 中打开工程，运行到鸿蒙设备
2. 进入主导航页，点击 [001] {Demo 1 名称} 进行验证
3. 按各 Demo 页面内的"验证点"注释检查功能是否正常
```

---

## 参考资料

- 代码规范与禁止项速查：[references/CODE_STANDARDS.md](references/CODE_STANDARDS.md)
- 页面代码模板：[references/TEMPLATE.md](references/TEMPLATE.md)
- 生成示例对比：[references/EXAMPLES.md](references/EXAMPLES.md)
