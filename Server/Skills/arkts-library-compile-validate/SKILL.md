---
name: arkts-library-compile-validate
description: 对鸿蒙 ArkTS 工程执行工程迁移、Code Linter 静态代码检查、devecocli 编译验证（5 轮修复循环）以及 ohpm 线上版本替换兜底，输出质量检查与编译验证报告。作为生成代码（Demo / XTS / 任意指定目录）后的质量验证收尾环节，验证生成的 ArkTS 代码能否在鸿蒙环境中编译通过。当需要对已生成或修改的 ArkTS 代码进行编码规范静态检查与编译验证时使用此技能。
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# 鸿蒙 ArkTS 代码质量检查与编译验证

本 Skill 对鸿蒙 ArkTS 工程执行端到端的**质量检查与编译验证**闭环：工程迁移 → Code Linter 静态检查 → devecocli 编译验证（5 轮修复循环）→ ohpm 线上版本替换兜底，最终输出质量检查与编译验证报告。

> ⚠️ **核心定位**：本 Skill 是生成代码后的**通用收尾验证环节**，与 Demo / XTS 场景解耦：
> - 检查目标（`checkTarget`）参数化，可指向 `entry/src/main/ets/pages`（Demo 代码）、`entry/src/ohosTest/ets/test`（XTS 测试代码）或任意指定目录/文件
> - 编译模块（`buildModule`）参数化，默认 `entry`
> - `generateCodePaths` 参数用于区分编译错误来源（生成代码 vs 源库），指导修复策略

> ⚠️ **核心约束**：
> 1. 编译是验证生成代码质量的唯一方式，源库问题也必须尝试修复——否则隐藏的生成代码错误会传给下游
> 2. 源库修复仅限**机械性**操作（SDK 版本、依赖、构建配置），不改源库业务逻辑
> 3. 任务状态仍为"完成"——代码生成本身已完成，编译验证因源库问题跳过时如实标注

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `sourcePath` | ✅ | 目标鸿蒙工程根目录（含 `entry/` 和 `library/` 模块） |
| `checkTarget` | 可选 | Code Linter 检查目标（相对 `sourcePath` 的目录或文件）；缺省 `entry/src/main/ets` |
| `buildModule` | 可选 | 编译模块名；缺省 `entry` |
| `generateCodePaths` | 可选 | 生成代码标识路径列表（相对 `sourcePath`，如 `["entry/src/main/ets/pages"]`、`["entry/src/ohosTest/ets/test"]`）。编译修复循环据此区分「生成代码错误 vs 源库错误」 |
| `outputDir` | 可选 | 报告输出目录；缺省 `{{sourcePath}}` 同级或由调用方指定 |

---

## 工作流程

### 阶段一：工程迁移（migrate.cjs，必做不可跳过）

> 🔴 **强制步骤，禁止跳过**：
> - **无论工程类型（OpenHarmony / HarmonyOS）、无论 `build-profile.json5` 的 `compileSdkVersion` 是否与已安装 SDK 匹配，都必须执行下述迁移脚本**。
> - 禁止以"工程已是新版本""`compileSdkVersion` 已匹配已安装 SDK""工程为 OpenHarmony 无需切换到 HarmonyOS"等理由自行判断并跳过本步骤。
> - 即使 SDK 版本匹配，源工程的 hvigor 文件、`oh-package.json5`、product 的 `runtimeOS`/`compatibleSdkVersion` 等配置仍可能不兼容当前构建环境，必须在编译前执行迁移。

鸿蒙原生库源码多为历史工程，`build-profile.json5` 的 SDK 版本配置、hvigor 文件、oh-package.json5 等经常不兼容当前构建环境。使用 `migrate.cjs` 脚本一次性完成华为官方 Manual Migration 全流程迁移。

0. **预迁移设备探测**：

   ```powershell
   cmd /c "hdc list targets"
   ```
   - 若有设备输出，探测设备 API 版本：
     ```powershell
     cmd /c "hdc shell param get const.ohos.apiversion"
     ```
     记录设备 API 版本（如 `23`），作为 `--compatible-api` 参数传入迁移脚本。
   - 若无设备，跳过此步（迁移脚本将自动探测已安装 SDK API 版本）。

1. 执行迁移脚本：

   ```powershell
   # 有设备时（deviceApi 从步骤 0 获取）
   node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}} --compatible-api {deviceApi}

   # 无设备时
   node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
   ```

2. **执行后强制校验（未通过不得进入阶段二）**：
   - 迁移脚本必须正常执行完成，输出以 `[migrate] 迁移完成。` 结尾
   - 迁移日志包含 `[migrate] SDK版本: compatibleSdkVersion=..., targetSdkVersion=...` 行
   - 校验 `{{sourcePath}}/build-profile.json5`：每个 product 的 `runtimeOS` 已为 `HarmonyOS`
   - `compatibleSdkVersion` 的 API 版本 ≤ 设备 API 版本（有设备时）或 = 已安装 SDK API 版本（无设备时）
   - 任一项不满足 → 重新执行迁移脚本，直至校验通过后方可进入阶段二

---

### 阶段二：Code Linter 静态代码检查（编译前必做）

> 🔴 **编译前静态检查**：在进入编译验证（阶段三）之前，先通过 Code Linter 静态扫描目标代码，把可静态发现的问题（样式/正确性/性能/安全规则）前置到编译循环之外，减少编译轮次消耗。
> 由脚本 `code-linter.cjs` 自动化完成（config 检测/创建 → 执行 lint → 解析 JSON → 输出报告）。

1. **调用脚本检查（作用域：`{{checkTarget}}` 指定的目录/文件）**：

```powershell
node {{skillDir}}/scripts/code-linter.cjs --source {{sourcePath}} --target {{checkTarget}}
```

脚本行为：
- 探测 `devecocli --version`；不可用 → 报「构建环境不可用」退出码 1，本步骤标注跳过，但**不阻塞进入编译验证**（编译同样依赖该环境，届时会暴露）
- 检测工程根 `code-linter.json5`；缺失则按推荐规则集自动创建（否则 `devecocli check lint` 会报 `--config-path does not exist`）
- 执行 `devecocli check lint "<target>" --format json --output-path code-linter-raw.json`（仅传 1 个路径，满足命令路径参数限制）
- 解析 `{ issues }`，按 `Error` / `Warning` 统计，输出 `{{sourcePath}}/code-linter-report.json`

2. **结果判定**：

| 情况 | 处理 |
|------|------|
| 退出码 0（0 Error） | 静态检查通过，进入阶段三编译验证 |
| 退出码 2（存在 Error） | 逐条修复（判断属生成代码则按阶段三编译修复循环的签名修正协议同源修复），重跑脚本直至 0 Error；计入编译修复轮次 |
| 退出码 1（环境不可用） | 标注"Code Linter 环境不可用，跳过"，进入编译验证 |

3. **Warning 处理原则**：
- `@hw-stylistic/file-naming-convention` Warning：多因 `001_` 数字前缀文件名（要求大驼峰）。**不阻塞编译**，无需强制改为大驼峰；若需零警告可调整命名，但不属于本 Skill 阻断项
- 其他 Warning：`addTryCatch`/`addAsyncCatch`/未使用变量等属 P2 优化项，编译通过后按需处理，不阻塞进入编译
- **`any`/`unknown` 说明**：Linter 的 `@typescript-eslint/no-explicit-any` 仅对 `.js/.ts` 生效；`.ets` 的 any/unknown 由 ArkTS 编译器强制（`arkts-no-any-unknown`），需在编译验证中确认

---

### 阶段三：编译验证（5 轮修复策略）

> 🔴 **必须通过 build.ps1 执行**，直接调用 devecocli build 会导致 session 永久阻塞（hvigor daemon 继承 Agent pipe 句柄不释放）。
> 编译是验证生成代码质量的**唯一方式**，
> 因此源库问题也必须尝试修复——否则隐藏的生成代码错误会传给下游。
> 源库修复仅限**机械性**操作（SDK 版本、依赖、构建配置），不改源库业务逻辑。

##### 首次编译

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build --modules {{buildModule}}"
```

编译通过 → 跳转阶段四（ohpm 兜底判定）。

##### 修复循环（最多 5 轮）

每轮：
1. 逐条读取构建日志中的错误
2. **判断错误来源并分级修复**：

**生成代码错误**（文件路径命中 `{{generateCodePaths}}` 中任一前缀）：

> 🔴 **签名修正协议（每轮必须执行）**
>
> 生成代码的接口签名错误是系统性错误——SubAgent 未对照 Spec 生成。编译报错后按以下协议批量修正：
>
> 1. `read_file` 读取每个报错文件
> 2. 对照接口规格文档 + 库 `index.ets`（或工程导出链）按错误关键词匹配修复：
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
| 对照阶段五自查表已知模式 | 按表修复 |
| 接口签名/类型不匹配 | 执行签名修正协议（上表 6 项） |
| import 类型不存在 | 对照库导出链验证 |
| 表外新错误 | 分析 → 修复 → 记录到阶段五表 |

**源库错误**（文件路径不在 `{{generateCodePaths}}` 中，位于 `library/`、源库原有目录、CMakeLists.txt、hvigorfile.ts、build-profile.json5）：

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
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build --modules {{buildModule}}"
```

4. 编译通过 → 跳转阶段四

**终止判定（立即退出循环）**：

若构建日志中出现以下任一模式，**立即终止修复循环**，不再尝试后续轮次，直接跳转阶段四：
- 连续 2 轮出现的错误均为源库不可修复错误（❌ 行）

终止后在报告中标注编译跳过原因和修复建议。

---

### 阶段四：ohpm 线上版本替换（源库原生编译失败兜底，脚本驱动）

> 当源库**原生库（.so）需复杂构建**（GN/Ninja、FFmpeg、libyuv、NDK、prebuild 等）导致 `devecocli build` 失败时，
> 可用 **ohpm 线上发行版本** 替换本地依赖后继续编译，避免被源库构建问题阻塞验证生成代码。
> 本流程由共享脚本 `ohpm-switch.cjs` 自动化完成（定位/查询/修改/变更记录），使用方法见下文。

**触发条件（满足任意一项即进入本条，否则直接跳过）：**

| # | 条件 | 判定方式 |
|---|------|---------|
| 1 | `ohpm` 可用 | 运行 `ohpm --version` 成功 |
| 2 | README 明确源码编译步骤复杂 | 读取源工程 `README.md` / `README_zh.md`，出现以下特征词即判定命中：`.so`、`libyuv`、`FFmpeg`、`soundtouch`、`NDK`、`GN`、`Ninja`、`prebuild`、`预编译`、`编译三方依赖库`、`从源码编译` |
| 3 | 该库存在 ohpm 线上版本 | 脚本查询 `ohpm info <库包名>` 有版本列表即可，或使用 `--version` 显式指定 |

**执行步骤（与 DemoCodeSkill / XTSCodeSkill / XTSExecutionSkill 同源）：**

1. **调用共享脚本替换依赖**：

```powershell
node {{skillDir}}/scripts/ohpm-switch.cjs --source {{sourcePath}}
```

> 若脚本定位到多个本地 file 依赖，按脚本输出的候选逐个用 `--pkg <库包名>` 指定重复执行；脚本会：
> - 扫描工程内所有 `oh-package.json5`，定位 `file:` / 相对路径依赖
> - 匹配 `build-profile.json5` `modules[]` 中注册的同名本地模块
> - 通过 `ohpm info <库包名>` 自动查询最新稳定版（亦可 `--version <版本号>` 显式指定）
> - 将 `oh-package.json5` 中该库依赖改为线上版本号
> - 从工程级 `build-profile.json5` 的 `modules[]` 中**移除**该库本地模块条目
> - 保留 `@ohos/hypium` 等 devDependencies 不变；不修改 `.so`/`.aar`/`.har` 等编译产物映射依赖

2. **核验改动清单**：脚本完成后校验 `{{sourcePath}}/ohpm-switch-report.json`，确认：依赖版本变更、build-profile modules 移除项、涉及的库包名与版本号，均与本次任务目标一致。

3. **重新安装依赖并编译：**

```powershell
cd /d {{sourcePath}} && ohpm install
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build --modules {{buildModule}}"
```

4. **版本降级 API 兼容性核验（必做，踩坑核心教训）**：线上最新版可能与本地源码版本不一致。替换后编译通过前，必须对照库 `library/index.ets` 导出链逐一确认本任务生成代码 import 的类型/常量/枚举仍存在：
   - 全部存在 → 继续后续步骤
   - 有缺失 → 优先用 `ohpm info <库包名>` 已列出的其他更接近版本重跑脚本（`--version <旧版本>`）
   - 所有线上版本均不满足 → 生成代码对缺失类型降级为对象字面量/标注"需手动验证接口"，并在报告备注

5. **结果判定：**

| 情况 | 处理 |
|------|------|
| 替换后编译通过 | 编译验证记为通过，报告「编译验证」标注"源库本地原生编译失败，已切换 @ohos/xxx 线上版本 vX.Y.Z 后编译通过"，并附 `ohpm-switch-report.json` 改动清单 |
| 替换后仍失败 | 归为源库不可修复，走下方降级路径，报告追加"已尝试 ohpm 线上替换仍失败" |
| 无对应 ohpm 线上版本 | 维持原流程，报告说明"未找到对应 ohpm 线上版本" |

> ⚠️ **修改保留不回滚**，但必须在最终报告中如实记录本次改动（依赖版本变更、build-profile.json5 modules 移除两项，可直接引用 `ohpm-switch-report.json`）。

##### 降级：5 轮仍失败 / 提前终止

- ⚠️ 编译验证未通过
- 在最终报告中列出：
  - 生成代码未修复的错误 → 标注"需加入阶段五自查表"
  - 源库不可修复的错误 → 标注"需源库作者修复"
  - 项目结构迁移类错误 → 标注"需在 DevEco Studio 中使用迁移工具升级项目结构"
- **任务状态仍为"完成"**（代码生成本身已完成，编译验证因源库问题跳过）

---

### 阶段五：代码规范自查清单

> 编译通过后，对照以下清单逐项自查目标代码（若提供了 `generateCodePaths`，仅检查其中路径的代码；否则检查 `checkTarget` 覆盖的代码）。

| 检查项 | 标准 | 状态 |
|-------|------|------|
| 文件命名规范 | `{序号}_{PascalCase描述}Page.ets` 或工程既有规范，无多余子目录 | □ |
| 日志 DOMAIN/TAG 正确 | 每个文件有独立 TAG，DOMAIN 在工程范围内统一 | □ |
| 每个方法有 hilog.debug 入口日志 | 无遗漏 | □ |
| 异步调用有 try/catch | 无裸 await | □ |
| 资源在生命周期（如 `aboutToDisappear`）释放 | 无资源泄露 | □ |
| 无 any/ESObject/Object 类型 | 全量类型安全 | □ |
| 需要权限的接口有权限申请逻辑 | 无缺失 | □ |
| UI 文本全部使用 `$r()` 引用 | 无硬编码静态 UI 文本（适用于 ArkUI 场景） | □ |
| 国际化资源已添加全部键 | 每个 UI 文本对应一条资源记录 | □ |
| 注释完整性 | 组件级 JSDoc + 每个核心方法 JSDoc | □ |
| **接口签名精确性** | 禁止猜测属性名/回调参数/枚举成员名；所有类型引用必须对照接口规格文档和源码验证 | □ |

---

### 阶段六：输入验证与输出报告

#### 6.1 接口签名精确性检查（编译前快速兜底，可选但建议）

> ⚠️ 以下错误高频出现，编译前快速兜底检查可减少编译轮次。

| 检查项 | 错误示例 | 正确做法 | 检查方法 |
|-------|---------|---------|---------|
| **枚举成员名** | `ImageFit.CONTAIN` | `ImageFit.Contain` | 🚨 系统枚举立即调用 MCP 工具 `script_deveco_docs`：`action=search` 取目标枚举 → `action=read` 带 `section=<枚举名>` 精确定位成员名，不执行禁止继续 |
| **组件名/类名准确性** | `ImageKnifeComponentV2` | `ImageKnifeComponent` | 组件名/类名必须与库 `Index.ets` 导出名**逐字符一致**，禁止自行追加"V2"/"New"等后缀 |
| **interface/class 区分** | `new HttpRequestOption()` | `{ ... } as HttpRequestOption` | 查接口规格文档：`(interface)` 不能用 `new`；`(class)` 可以用 `new` |
| **回调参数类型** | `(errorInfo: ErrorInfo) => void` | `(err: string, imageInfo: ImageInfo) => void` | 查接口规格文档的回调接口定义，严格匹配字段类型 |
| **属性名准确** | `obj.transformationType` | `obj.type` | 查文档该类的属性列表，只能使用文档列出的属性名 |
| **`\| undefined` 返回值守卫** | `result.imageWidth`（result 可能为 undefined） | `if (result) { ... }` | 签名含 `\| undefined` 或 `?:` 的返回值，访问其属性前必须显式判空 |
| **import 类型存在性** | `import { ImageInfo } from '库名'` 但库未导出 | 每个 import 类型名必须在库导出链中 | import 前追踪：不存在的类型用对象字面量，禁止 import |
| **新增未知错误** | 编译失败出现表外错误 | 对照接口规格文档+源码分析修复 → 记录模式 → 下次合并到本表 | 编译失败时对照本表，表外错误修复后必须记录 |

#### 6.2 输出质量检查与编译验证报告

`write_file` `{{outputDir}}/arkts-compile-validate-report.md`（若未指定 `outputDir`，输出到 `{{sourcePath}}/arkts-compile-validate-report.md`）：

```markdown
## 质量检查与编译验证完成

### 工程迁移
{结果：通过 / 失败（重跑校验后）}
- 引用迁移脚本日志（须含 `[migrate] 迁移完成。` 及 product 强制校验结论）

### Code Linter 检查
{结果：通过（0 Error / N Warning）/ 有 Error（已修复，见编译验证）/ 环境不可用跳过}
- 引用 `{{sourcePath}}/code-linter-report.json`
- 关键 Warning 需人工确认：{如 @hw-stylistic/file-naming-convention 等，不阻塞编译}

### 编译验证
{编译结果：通过 / 存在警告（已修复） / ⚠️ 已跳过}

（若已执行 ohpm 线上版本替换，需附加：）
- 源库本地原生编译失败：{原因简述}
- 已切换 ohpm 线上版本：`{库包名}@{版本号}`
- 依赖改动记录：{entry/oh-package.json5 的依赖变更、build-profile.json5 modules[] 移除的模块，可直接引用 `{{sourcePath}}/ohpm-switch-report.json`}
- **版本降级 API 兼容核验**：{线上版本对照 library/index.ets 导出链的结果，所有 import 类型是否仍存在；缺失类型的降级处理}

（若跳过，需附以下信息：）
- 跳过原因：
- 修复建议：

### 代码规范自查
{逐项列出阶段五自查清单结果，未通过项标注处理方式}
```

---

## 参考资料

- 共享脚本：`scripts/migrate.cjs` / `scripts/build.ps1` / `scripts/code-linter.cjs` / `scripts/ohpm-switch.cjs`
- 与以下 SKILL 同源（脚本一致性）：`ArkTsLibraryDemoCodeSkill`（阶段四）、`arkts-library-xts-code`、`ArkTsLibraryXTSExecutionSkill`