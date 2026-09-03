---
name: arkts-code-use
description: 根据需求编写鸿蒙原生 ArkTS 代码（页面/自定义组件/工具类/服务类），严格遵循 ArkTS 语法约束与华为编码规范，先通过官方文档查证 API（import 路径、方法签名、权限、API Level），再使用 deveco-cli（devecocli build / verify-arkts.cjs）编译验证，确保生成代码零语法错误。当需要为鸿蒙应用或三方库编写、补全、重构 ArkTS 代码，或将功能需求转化为符合规范的 ArkTS 实现时使用。
license: Apache-2.0
compatibility: 需要 Node.js、deveco-cli（devecocli 命令：工程脚手架/编译验证/文档检索）及 DevEco Studio + OHOS SDK 构建环境；可选 MCP Gateway 运行中（script_deveco_docs 文档查证、kb_search 知识库）
metadata:
  author: LoopEngine
  version: "1.0.0"
  category: code-generation
---

# ArkTS Code Use — 鸿蒙原生 ArkTS 代码编写

本技能用于**根据需求编写符合规范的鸿蒙原生 ArkTS 代码**。核心流程：理解需求 → 查证 API → 编写代码 → 编译验证 → 交付。

> ⚠️ **核心原则：所有生成的代码必须同时满足三条底线——① 零语法错误（必须通过 deveco-cli 编译验证，BUILD SUCCESSFUL）；② 符合 ArkTS 语法约束与华为编码规范（禁止 `any`/`ESObject`/动态属性访问等）；③ API 使用有据可查（import 路径、签名、权限、API Level 均经官方文档查证，禁止凭记忆臆造 API）。**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `requirement` | string | ✅ | 功能需求描述（自然语言或接口定义） |
| `targetProject` | string | ❌ | 目标鸿蒙工程路径。提供则代码写入该工程并在其中验证；不提供则独立生成，用临时工程完成语法验证 |
| `outputPath` | string | ❌ | 生成文件/目录位置。默认：有工程时为工程内对应模块目录；无工程时为当前工作目录 |
| `apiLevel` | number | ❌ | 目标 API Level（默认取工程 `build-profile.json5` 配置；独立生成时默认 12+） |
| `codeType` | string | ❌ | 代码类型提示：`page`（页面）/ `component`（自定义组件）/ `util`（工具类）/ `service`（业务服务类）。不提供则从需求推断 |

---

## 输入依赖

无前置SKILL。可作为独立任务调用。若需求涉及已有工程，需目标工程可访问且结构完整（含 `build-profile.json5`）。

---

## 工作流程概览

```
Phase 1: 需求理解与场景识别
    ↓
Phase 2: API 查证（官方文档）
    ↓
Phase 3: 代码编写（遵循 ArkTS 约束与编码规范）
    ↓
Phase 4: 编译验证与修复循环（deveco-cli）
    ↓
Phase 5: 规范自检与交付
```

---

## Phase 1：需求理解与场景识别

### 1.1 解析需求

从 `requirement` 中提取：
- **功能点列表**：拆分为可实现、可验证的具体功能点
- **代码类型**：`page` / `component` / `util` / `service`（依据 `codeType` 参数或推断）
- **技术领域**：网络 / 存储 / UI / 多媒体 / 硬件 / 加密 / 并发等（用于 Phase 2 检索）
- **涉及的系统资源**：HTTP 连接、文件句柄、订阅、Timer、Worker 等（用于 Phase 3 资源管理设计）

### 1.2 探查目标工程（如提供 `targetProject`）

```
1. 列出工程根目录，识别 entry/、library/ 等模块
2. 读取 build-profile.json5，确认 compatibleSdkVersion / 编译 SDK 版本（即目标 API Level）
3. 读取目标模块 src/main/ets/ 现有源文件与 index.ets 导出，了解代码惯例
4. 读取 module.json5，了解已声明权限
5. 若新增页面，确认 src/main/resources/base/profile/main_pages.json 的注册方式
```

> 无 `targetProject` 时跳过本步，采用独立生成模式（Phase 4.2 临时工程验证）。

### 1.3 明确交付边界

| 场景 | 处理方式 |
|------|---------|
| 需求可实现 | 进入 Phase 2 |
| 需求依赖设备能力（蓝牙/NFC等） | 代码中加 `canIUse()` 守卫，缺能力时降级 |
| 需求依赖不存在的系统 API | 明确告知用户不可行及原因，提供最接近的替代方案 |

---

## Phase 2：API 查证（官方文档）

> **目标：所有系统 API 的 import 路径、方法签名、参数/返回值、权限、API Level 必须有据可查，禁止凭记忆臆造。**

### 2.1 查证工具（按优先级）

| 优先级 | 工具 | 适用 |
|--------|------|------|
| 1 | MCP Gateway `script_deveco_docs`（action=search / read） | MCP 可用时，检索+精读 HarmonyOS 官方 API 参考 |
| 2 | `devecocli docs search <关键词>` / `devecocli docs read <documentId>` | 终端直接查证 |
| 3 | MCP Gateway `kb_search` / `kb-server_search_knowledge` | 补充最佳实践、平台陷阱等经验知识 |

### 2.2 查证要点（每个用到的系统 API 均须确认）

| 查证项 | 说明 |
|--------|------|
| import 路径 | `@ohos.*` 模块名或 `@kit.*`（优先 Kit 聚合导入） |
| 方法签名 | 参数名、类型、可选性、返回值/Promise/callback 形式 |
| 权限 | 是否需在 `module.json5` 声明 `ohos.permission.*`，是否运行时申请 |
| API Level | `since` 版本；高于目标 API Level 时须加版本守卫或换用旧接口 |
| 废弃标注 | `deprecated` 接口禁止使用，查替代方案 |

> 查证工具的调用参数、领域关键词速查表、三步查询法参见 [API 查证指南](references/API_VERIFICATION.md)。

### 2.3 输出查证结论

以表格形式记录（作为 Phase 3 编写依据）：

| 功能点 | API（import 路径） | 关键签名 | 权限 | since | 结论 |
|--------|-------------------|---------|------|-------|------|
| ... | ... | ... | ... | ... | ✅ 可用 / ⚠️ 需守卫 / ❌ 不可用 |

---

## Phase 3：代码编写

> 📐 本阶段生成的全部代码须符合华为 ArkTS 编程规范与 ArkTS 语法约束。

### 3.1 强制约束（编译必查）

核心禁止项（完整清单与修复方案见 [ArkTS 规范与约束](references/ARKTS_RULES.md)）：

- 禁止 `any`、`unknown`、`ESObject`、`Object` 作通用类型 → 改用具体类型或泛型 `T`
- 禁止动态属性访问 `obj['key']` → 类型安全访问
- 禁止内联匿名对象类型 / 未类型化对象字面量 → 定义命名 `interface` 或 `class`
- 禁止 `prototype` 扩展、`delete` 运算符、`arguments` 对象、`for...in`、`eval()`
- 禁止 `catch (e)` 中直接 `throw e`（`arkts-limited-throw`）→ 封装为 `Error` 实例后抛出
- 禁止结构型类型匹配 → 使用显式 `interface` 继承或 `class implements`
- 禁止在主线程执行阻塞操作 → `async/await + Promise` 或 `taskpool`

### 3.2 编码规范

- **命名**：PascalCase 类/接口/枚举/struct，camelCase 方法/变量，UPPER_SNAKE_CASE 常量
- **格式**：2 空格缩进、行尾分号、单文件 ≤ 400 行（超过拆分）
- **类型**：所有变量/参数/返回值显式标注类型；公共类型必须 `export`
- **日志**：功能模块使用 `hilog`，敏感数据用 `%{private}s`
- **资源管理**：`create/open/on/connect` 类资源必须存在对称的 `destroy/close/off/disconnect` 释放路径，置于 `try/finally` 或组件销毁回调

### 3.3 按代码类型选择模板

按 Phase 1.1 识别的类型，从 [代码模板](assets/TEMPLATES.md) 选取对应模板起步：

| 代码类型 | 模板 | 要点 |
|---------|------|------|
| `page` | @Entry 页面模板 | 注册到 main_pages.json；aboutToDisappear 清理资源 |
| `component` | @Component 模板 | @Prop/@Link/@Builder 状态管理；通用 UI 单位用 vp/fp |
| `util` | 工具类模板 | 静态方法或单例；无状态依赖 |
| `service` | 业务服务类模板 | 状态机 + async 方法 + hilog + 资源生命周期 |

### 3.4 采用成熟代码模式

异步封装、taskpool 并发、BusinessError 错误处理、事件订阅、权限申请、HTTP/文件资源清理等标准写法，参见 [ArkTS 代码模式](references/CODE_PATTERNS.md)。

### 3.5 落盘规则

- 有 `targetProject`：新文件放入目标模块 `src/main/ets/` 对应子目录（pages/components/utils/service）；新导出同步到 `index.ets`；新页面注册到 `main_pages.json`；新权限写入 `module.json5`
- 无 `targetProject`：输出到 `outputPath`（或当前目录），保持单文件自包含或按 `utils/`、`components/` 子目录组织，相对导入路径正确

---

## Phase 4：编译验证与修复循环（deveco-cli）

> **目标：BUILD SUCCESSFUL 是交付的硬性前置条件。仅有 lint 通过或"看起来没问题"不算通过。**

> ⚠️ **验证机制**：hvigor 只编译**构建图可达**的文件（被页面/入口 import 链引用的文件）。未被引用的 .ets 文件不参与编译，不报错——因此验证前必须确保新代码已接入 import 链（或使用 verify-arkts.cjs 自动接线）。详细说明参见 [语法验证指南](references/SYNTAX_CHECK_GUIDE.md)。

### 4.1 工程模式（提供了 targetProject）

```
1. 确认新代码已接入构建图：
   - 新页面：文件在 pages/ 下且已注册 main_pages.json
   - 新类/组件：已被页面 import（直接或经由 index.ets）
2. 执行：devecocli build（在 targetProject 目录下）
3. 解析输出，只处理 ERROR（WARNING 记录但不阻断）
4. 按错误码修复 → 重新构建，循环直到 BUILD SUCCESSFUL
```

### 4.2 独立模式（无 targetProject）

使用本SKILL自带脚本自动完成"脚手架临时工程 → 接线 import → 编译验证 → 回显错误"：

```bash
node {本SKILL目录}/scripts/verify-arkts.cjs --files <生成的.ets文件...> [--work-dir <目录>] [--keep]
```

脚本行为：自动 `devecocli create` 临时工程 → 将文件复制到 `entry/src/main/ets/verify/` 并在入口页生成 side-effect import 接入构建图 → `devecocli build` → 将错误按 `规则 (文件:行:列)` 回显并映射回源文件 → 清理临时工程（`--keep` 保留）。

- 退出码 0 = 验证通过；1 = 存在编译错误；2 = 环境问题
- 多文件间的相对导入会按原目录结构保留，支持批量验证

### 4.3 错误修复速查

| 错误关键词 / 规则 | 修复方案 |
|-----------------|---------|
| `arkts-no-any-unknown` | 替换为具体类型或泛型 `T` |
| `arkts-no-untyped-obj-literals` | 对象字面量须对应显式 class/interface；先声明类型再赋值 |
| `arkts-no-obj-literals-as-types` | 内联匿名对象类型改为命名 `interface` |
| `arkts-limited-throw` | `catch (e)` 中改 `throw e instanceof Error ? e : new Error(String(e))` |
| `arkts-no-dynamic-property` | `obj['key']` 改为 `obj.key` |
| `arkts-no-structural-typing` | 类型须显式继承/implements，禁止鸭子类型赋值 |
| `Cannot find module` | 检查 import 路径大小写与相对层级；`@ohos.*` 拼写以文档为准 |
| `has been deprecated` | 查官方文档替代 API |
| `Page ... does not exist` | main_pages.json 与实际文件对齐 |
| `Permission denied` | module.json5 声明权限（Phase 2 已查证的权限清单） |

> 完整验证策略、verify-arkts.cjs 参数、`devecocli check lint` / `check compat` 辅助用法参见 [语法验证指南](references/SYNTAX_CHECK_GUIDE.md)。

### 4.4 修复循环纪律

```
LOOP（上限 5 轮）:
  1. 构建验证（4.1 或 4.2）
  2. 收集全部 ERROR（一次修复全部已知错误，避免逐个重跑）
  3. 按速查表修复；速查表未覆盖的错误用 script_deveco_docs 查证 API 正确用法
  4. 重新验证
  5. BUILD SUCCESSFUL → 进入 Phase 5
超过 5 轮未通过：停止并向用户报告当前错误清单与已尝试方案
```

---

## Phase 5：规范自检与交付

### 5.1 交付前自查清单

**编译与正确性**
- [ ] `devecocli build` 输出 `BUILD SUCCESSFUL`（工程模式）或 verify-arkts.cjs 退出码 0（独立模式）
- [ ] 新代码已接入构建图（import 链可达 / 页面已注册）
- [ ] 所有系统 API 均经文档查证，无臆造 API，无 deprecated 接口

**ArkTS 约束**
- [ ] 无 `any` / `unknown` / `ESObject` / `Object` 通用类型；无 `as unknown as T` 双重转型
- [ ] 无动态属性访问、内联匿名类型、`prototype` 扩展、`delete`、`arguments`、`for...in`、`eval`
- [ ] `catch (e)` 重抛已封装为 `Error` 实例
- [ ] 耗时操作使用 `async/await` 或 `taskpool`，主线程无阻塞调用

**编码规范**
- [ ] 命名（PascalCase/camelCase/UPPER_SNAKE_CASE）、2 空格缩进、行尾分号
- [ ] 所有变量/参数/返回值显式类型标注；公共类型已 export
- [ ] 功能模块有 hilog 日志，敏感数据使用 `%{private}s`

**资源与安全**
- [ ] `create/open/on/connect` 类资源均有对称释放（`try/finally` 或 `aboutToDisappear`）
- [ ] 外部输入已校验；SQL 参数化；文件路径校验沙箱边界
- [ ] since > 目标 API Level 的接口有 `canIUse()` / `deviceInfo.sdkApiVersion` 守卫；硬件能力先检测再调用
- [ ] 所需权限已在 module.json5 声明（工程模式）

### 5.2 输出交付物

- 生成的 .ets 源文件（含新建/修改的 index.ets、main_pages.json、module.json5 变更说明）
- API 查证结论表（Phase 2.3）
- 验证结果：构建命令、最终状态（BUILD SUCCESSFUL / 退出码）、验证模式（工程/独立临时工程）
- 未实现或降级处理的功能点说明（如有）

---

## 参考资料

- [ArkTS 规范与约束](references/ARKTS_RULES.md) — 禁止项完整清单（错误码+修复方案）、类型系统约束、命名与格式规范、日志规范
- [ArkTS 代码模式](references/CODE_PATTERNS.md) — 异步/taskpool 并发、BusinessError 错误处理、事件订阅、权限申请、资源生命周期管理、UI 状态管理模式
- [API 查证指南](references/API_VERIFICATION.md) — script_deveco_docs / devecocli docs 用法、领域关键词速查、API Level 对照、三步查询法
- [语法验证指南](references/SYNTAX_CHECK_GUIDE.md) — 构建图可达性机制、verify-arkts.cjs 完整用法、错误输出解析、check lint / check compat 辅助检查
- [代码模板](assets/TEMPLATES.md) — 页面/自定义组件/工具类/服务类标准模板
- [华为 ArkTS 编程规范](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-coding-style-guide) — 官方编码标准
- [ArkTS 语法约束（TypeScript 到 ArkTS 适配）](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/typescript-to-arkts-migration-guide) — 官方语法约束说明
