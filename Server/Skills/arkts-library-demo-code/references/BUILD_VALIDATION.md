# 编译验证操作手册

> SKILL.md 阶段四（工程迁移 → Code Linter → 编译修复循环 → ohpm 兜底 → 降级）的详细操作规程。
> 核心原则：**编译是验证生成代码质量的唯一方式**；源库问题也必须尝试修复（仅限机械性操作，不改业务逻辑）。

---

## 一、工程迁移（migrate.cjs）

### 1.1 为什么必做

鸿蒙原生库源码多为历史工程，`build-profile.json5` 的 SDK 版本配置、hvigor 文件、`oh-package.json5`、product 的 `runtimeOS`/`compatibleSdkVersion` 等经常不兼容当前构建环境。

> 🔴 **无论工程类型（OpenHarmony / HarmonyOS）、无论 `compileSdkVersion` 是否与已安装 SDK 匹配，都必须执行迁移**。禁止以"工程已是新版本""compileSdkVersion 已匹配已安装 SDK""工程为 OpenHarmony 无需切换到 HarmonyOS"等理由自行判断并跳过——即使 SDK 版本匹配，hvigor、oh-package 等配置仍可能不兼容。

### 1.2 预迁移设备探测（有设备时）

```bash
hdc list targets
hdc shell param get const.ohos.apiversion
```

记录设备 API 版本（如 `23`），作为 `--compatible-api` 参数传入迁移脚本。若无设备，跳过此步（脚本将自动探测已安装 SDK API 版本）。

> ⚠️ **compatible-api 版本上限陷阱**：`migrate.cjs` 的 API_VERSION_MAP 存在版本上限（当前最高 24）。设备 API 版本超出映射表上限（如设备 API 26）时直接传入会报 `未知 compatible-api 版本` 错误。此时读取 `DevEco-Studio.app/Contents/sdk/default/sdk-pkg.json` 的 `apiVersion` 字段获取已安装 SDK API 版本，取 **min(设备 API, 已安装 SDK API)** 作为 `--compatible-api`（编译面向已安装 SDK，实际以已安装 SDK API 为准）。

### 1.3 执行

```bash
# 有设备时（deviceApi 从 1.2 获取）
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}} --compatible-api {deviceApi}

# 无设备时
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

### 1.4 执行后强制校验（未通过不得进入编译）

- 迁移脚本正常执行完成，输出以 `[migrate] 迁移完成。` 结尾
- 迁移日志包含 `[migrate] SDK版本: compatibleSdkVersion=..., targetSdkVersion=...` 行
- `{{sourcePath}}/build-profile.json5` 中每个 product 的 `runtimeOS` 已为 `HarmonyOS`
- `compatibleSdkVersion` 的 API 版本 ≤ 设备 API 版本（有设备时）或 = 已安装 SDK API 版本（无设备时）
- 任一项不满足 → 重新执行迁移脚本，直至校验通过

---

## 二、Code Linter 静态检查（code-linter.cjs）

### 2.1 脚本行为

1. 探测 `devecocli --version`；不可用 → 报「构建环境不可用」退出码 1
2. 检测工程根 `code-linter.json5`；缺失则按推荐规则集自动创建（否则 `devecocli check lint` 会报 `--config-path does not exist`）
3. 执行 `devecocli check lint "<target>" --format json --output-path code-linter-raw.json`（仅传 1 个路径，满足命令路径参数限制）
4. 解析 `{ issues }`，按 Error / Warning 统计，输出 `{{sourcePath}}/code-linter-report.json`

### 2.2 结果判定

| 退出码 | 含义 | 处理 |
|-------|------|------|
| 0 | 0 Error | 静态检查通过，进入编译验证 |
| 2 | 存在 Error | 逐条修复（属生成代码的错误按第三节签名修正协议同源修复），重跑脚本直至 0 Error；计入编译修复轮次 |
| 1 | 环境不可用 | 标注"Code Linter 环境不可用，跳过"，进入编译验证（编译同样依赖该环境，届时会暴露） |

### 2.3 Warning 处理原则

- `@hw-stylistic/file-naming-convention`：多因 `001_` 数字前缀文件名（规则要求大驼峰），**不阻塞编译**，无需强制改为大驼峰；若需零警告可调整命名，但不属于本 SKILL 阻断项
- `addTryCatch` / `addAsyncCatch` / 未使用变量等：P2 优化项，编译通过后按需处理，不阻塞进入编译
- `any`/`unknown` 说明：Linter 的 `@typescript-eslint/no-explicit-any` 仅对 `.js/.ts` 生效；`.ets` 的 any/unknown 由 ArkTS 编译器强制（`arkts-no-any-unknown`），需在编译验证中确认

---

## 三、编译修复循环（5 轮）

### 3.1 执行方式

> 🔴 必须通过 build.ps1 执行：直接调用 devecocli build 会导致 session 永久阻塞（hvigor daemon 继承 Agent pipe 句柄不释放）。

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "devecocli build --modules entry"
```

**macOS/Linux（无 PowerShell）等效替代**：bash 重定向到日志文件执行：

```bash
devecocli build --modules entry > build.log 2>&1
```

原理：daemon 继承的是文件句柄而非管道句柄，同样规避 pipe 句柄继承导致的 session 阻塞（实测多轮编译无阻塞）。构建错误从 build.log 读取。

### 3.2 每轮流程

1. 逐条读取构建日志中的错误
2. 判断错误来源并分级修复：
   - **生成代码错误**（文件路径在 `entry/src/main/ets/pages/0XX_*`、`DemoIndex.ets`）：执行签名修正协议（见 [API_SIGNATURE_CHECKS.md](API_SIGNATURE_CHECKS.md) 第 3 节）
   - **源库错误**：按 3.3 修复表处理
   - 表外新错误：分析 → 修复 → 记录到修复表
3. 重新编译

### 3.3 源库错误修复表

源库错误（文件路径在 `library/`、源库原有 pages/、CMakeLists.txt、hvigorfile.ts、build-profile.json5）：

| 错误类型 | 修复方式 | 可修复？ |
|---------|---------|---------|
| SDK 版本不匹配（compileSdkVersion） | 修正 `build-profile.json5` | ✅ |
| 依赖缺失（oh-package.json5） | 补充 devDependencies | ✅ |
| CMake 选项冲突（-D 参数覆盖） | 修改 `build-profile.json5` 的 `externalNativeOptions` | ✅ |
| hvigorfile.ts 缺失 | `git submodule update --init --recursive` | ✅ |
| 缺失头文件（如 avif.h） | 关闭对应 CMake 选项或补充子模块 | ⚠️ 尝试 |
| 源库 ArkTS 类型错误 | 修正类型注解/补充 @Observed | ⚠️ 仅机械性 |
| 源库业务逻辑错误 | 不修复，标注 | ❌ |

### 3.4 终止判定（立即退出循环）

构建日志中连续 2 轮出现的错误均为源库不可修复错误（❌ 行）→ **立即终止修复循环**，不再尝试后续轮次，直接进入代码规范自查，在报告中标注编译跳过原因和修复建议。

### 3.5 降级（5 轮仍失败 / 提前终止）

- 编译验证标注"⚠️ 已跳过"，报告中列出：
  - 生成代码未修复的错误 → 标注"需加入检查表"
  - 源库不可修复的错误 → 标注"需源库作者修复"
  - 项目结构迁移类错误 → 标注"需在 DevEco Studio 中使用迁移工具升级项目结构"
- 任务状态仍为"完成"（代码生成本身已完成，编译验证因源库问题跳过）

---

## 四、ohpm 线上版本替换（源库原生编译失败兜底）

> 当源库**原生库（.so）需复杂构建**（GN/Ninja、FFmpeg、libyuv、NDK、prebuild 等）导致 `devecocli build` 失败时，用 **ohpm 线上发行版本**替换本地依赖后继续编译，避免被源库构建问题阻塞验证。
> 本流程由共享脚本 `ohpm-switch.cjs` 自动化完成（与 XTSCodeSkill / XTSExecutionSkill 同源）。

### 4.1 触发条件（必须全部满足，任一条不满足则跳过本分支直接走降级）

| # | 条件 | 判定方式 |
|---|------|---------|
| 1 | `ohpm` 可用 | 运行 `ohpm --version` 成功 |
| 2 | README 明确源码编译步骤复杂 | 读取 `README.md` / `README_zh.md`，出现以下特征词即判定命中：`.so`、`libyuv`、`FFmpeg`、`soundtouch`、`NDK`、`GN`、`Ninja`、`prebuild`、`预编译`、`编译三方依赖库`、`从源码编译` |
| 3 | 该库存在 ohpm 线上版本 | `ohpm info <库包名>` 有版本列表，或使用 `--version` 显式指定 |
| 4 | 出现在修复循环内且编译仍失败 | 首次编译失败后即可尝试；或连续 2 轮为源库不可修复错误（❌ 行）时触发 |

### 4.2 执行

```bash
node {{skillDir}}/scripts/ohpm-switch.cjs --source {{sourcePath}}
```

若脚本定位到多个本地 file 依赖，按脚本输出的候选逐个用 `--pkg <库包名>` 指定重复执行。脚本行为：

- 扫描工程内所有 `oh-package.json5`，定位 `file:` / 相对路径依赖
- 匹配 `build-profile.json5` `modules[]` 中注册的同名本地模块
- 通过 `ohpm info <库包名>` 自动查询最新稳定版（亦可 `--version <版本号>` 显式指定，如 `--version 2.0.9`）
- 将 `oh-package.json5` 中该库依赖改为线上版本号（如 `"@ohos/ijkplayer": "2.0.9"`）
- 从工程级 `build-profile.json5` 的 `modules[]` 中**移除**该库本地模块条目，避免本地原生库模块再次参与构建触发相同失败
- 保留 `@ohos/hypium` 等 devDependencies 不变；不修改 `.so`/`.aar`/`.har` 等编译产物映射依赖

### 4.3 核验改动清单

脚本完成后校验 `{{sourcePath}}/ohpm-switch-report.json`，确认：依赖版本变更、build-profile modules 移除项、涉及的库包名与版本号，均与本次任务目标一致。

### 4.4 重新安装依赖并编译

```bash
cd {{sourcePath}} && ohpm install
# 然后按 3.1 的方式重新编译
```

### 4.5 版本降级 API 兼容性核验（必做，踩坑核心教训）

线上最新版可能与本地源码版本不一致（如 ijkplayer 本地 `2.0.11-rc.0`，线上最新稳定版 `2.0.9`）。替换后编译通过前，必须对照 `library/index.ets` 导出链逐一确认本任务生成代码 import 的类型/常量/枚举仍存在（如 IjkMediaPlayer、MessageType、PropertiesType、LogUtils、AudioInterrupt、AudioDeviceChange、InterruptEvent）：

- 全部存在 → 继续后续步骤
- 有缺失 → 优先用 `ohpm info <库包名>` 已列出的其他更接近版本重跑脚本（`--version <旧版本>`）
- 所有线上版本均不满足 → 生成代码对缺失类型降级为对象字面量/标注"需手动验证接口"，并在报告备注

### 4.6 结果判定

| 情况 | 处理 |
|------|------|
| 替换后编译通过 | 编译验证记为通过，报告标注"源库本地原生编译失败，已切换 @ohos/xxx 线上版本 vX.Y.Z 后编译通过"，并附 `ohpm-switch-report.json` 改动清单 |
| 替换后仍失败 | 归为源库不可修复，走降级路径，报告追加"已尝试 ohpm 线上替换仍失败" |
| 无对应 ohpm 线上版本 | 维持原流程，报告说明"未找到对应 ohpm 线上版本" |

> ⚠️ **修改保留不回滚**，但必须在最终报告中如实记录本次改动（依赖版本变更、build-profile.json5 modules 移除两项，可直接引用 `ohpm-switch-report.json`）。
