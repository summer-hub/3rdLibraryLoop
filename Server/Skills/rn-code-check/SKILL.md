---
name: rn-code-check
description: React Native 三方库 PR 自动化代码检视，重点检查鸿蒙平台实现（harmony/ 目录下的 CAPI/ArkTS 代码）的内存安全、线程安全和 NAPI 规范。支持 GitCode/Gitee/GitHub/GitLab 平台，生成结构化检视报告。适用于 React Native OpenHarmony 适配项目的 PR review。
license: Apache-2.0
compatibility: 需要 git、curl、网络访问（GitHub/GitCode/Gitee API）
metadata:
  author: CPPAgent
  version: "1.0"
  platform: gitcode, gitee, github, gitlab
  libraryType: rn
---

# RNCodeCheckSkill — React Native 三方库 PR 代码检视

## 概述

本 Skill 负责对 React Native（OpenHarmony 平台适配）三方库的 Pull Request 进行自动化代码检视，包括获取 PR 差异内容、深度分析修改点、生成结构化检视报告。重点关注鸿蒙平台侧实现（`harmony/` 目录下的 CAPI/ArkTS 代码）以及 JS/TS 接口层。

**关键特性**：
- GitCode 平台优先使用 REST API 快速获取结构化 diff 数据
- **必须 git clone 原仓库**获取完整源码上下文，用于深度检视和跨文件引用分析
- 重点检查线程安全、内存管理、NAPI 规范等易出错的严重问题

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `prUrl` | ✅ | PR 地址，如 `https://gitee.com/react-native-oh-library/react-native-camera/pulls/8` |
| `outputDir` | ✅ | 输出目录绝对路径，如 `/path/to/codecheck/owner_repo_pr8` |
| `libraryType` | ❌ | 固定为 `rn` |
| `branch` | ❌ | 目标分支名；若提供则优先使用 |
| `accessToken` | ❌ | GitCode/Gitee PAT；GitCode API 强烈建议提供 |

---

## 工作流程

### Phase 1：输入解析与信息收集

#### 1.1 解析 PR 地址

从 `prUrl` 提取：`platform`、`owner`、`repo`、`prNumber`。

| 平台 | URL 模式 | API 支持 |
|------|----------|----------|
| GitHub | `github.com/{owner}/{repo}/pull/{num}` | patch 下载 |
| GitCode | `gitcode.com/{owner}/{repo}/pulls/{num}` | ✅ **API 优先** |
| Gitee | `gitee.com/{owner}/{repo}/pulls/{num}` | 部分 API |
| GitLab | `gitlab.com/{owner}/{repo}/-/merge_requests/{num}` | patch 下载 |

#### 1.2 GitCode 平台：API 加速（推荐）

**适用条件**：平台为 GitCode 且提供 `accessToken`。

**详细 API 使用方法见**：[API-GUIDE.md](references/API-GUIDE.md)

**核心步骤**：
1. 调用 PR 元数据 API 获取 `title`、`base.ref`、`head.sha`
2. 调用文件变更 API 获取结构化 diff（`diffs[].content.text`）
3. 将 API diff 重建为 unified diff 格式保存至 `{outputDir}/pr.diff`
4. 将改动文件列表写入 `{outputDir}/changed-files.txt`

#### 1.3 其他平台：传统 Patch 路径

**适用条件**：非 GitCode 或无 `accessToken`。

**详细操作见**：[API-GUIDE.md](references/API-GUIDE.md)

**核心步骤**：
1. 下载 `.patch` 或 `.diff` 文件
2. 解析 patch 头部提取元数据
3. 调用平台 API 获取目标分支（或使用用户提供的 `branch`）
4. 统计新增/删除行数、文件列表

#### 1.4 克隆仓库（必要步骤）

> ⚠️ **必须执行**，用于查阅原始代码上下文和跨文件引用分析

```bash
git clone --depth=50 --branch {targetBranch} https://{platform}/{owner}/{repo}.git {outputDir}/source/
```

**典型查阅场景**：
- diff 修改了 C++ NAPI 函数签名 → 需读取 ArkTS 胶水层确认调用侧是否同步更新
- diff 删除了 `napi_delete_reference` → 需追踪 ref 创建位置确认泄漏
- diff 新增跨线程回调 → 需确认是否使用了 `napi_threadsafe_function`

若克隆失败，在报告中注明"未能获取完整仓库上下文"并继续分析。

---

### Phase 2：Patch 差异分析

#### 2.1 识别修改文件类型

**RN 三方库典型结构**：
```
harmony/                # 鸿蒙实现（重点检视）
  src/main/
    cpp/                # C++ CAPI
    ets/                # ArkTS 胶水层
src/                    # JS/TS 接口层
```

**检视优先级**：
1. `harmony/src/main/cpp/**` - C++ CAPI（NAPI、内存、线程安全）
2. `harmony/src/main/ets/**/*.ets` - ArkTS 胶水层（TurboModule、Fabric）
3. `src/**/*.ts` - JS/TS 接口层（类型声明、平台判断）
4. `harmony/CMakeLists.txt` / `oh-package.json5` - 构建配置

#### 2.2 统计改动规模

**GitCode API 路径**：直接从响应读取 `count`、`added_lines`、`remove_lines`。

**传统路径**：从 diff 文件统计。

---

### Phase 3：代码深度检视

> ⚠️ **线程安全问题是 RN Native 模块最常见的严重问题，必须重点检查**

**详细检视清单见**：[CHECKLIST.md](references/CHECKLIST.md)

#### 3.1 重点检视项（易出错的严重问题）

**线程安全（CRITICAL 优先级）**：
- 子线程中不直接调用 NAPI 函数（必须使用 `napi_threadsafe_function`）
- 主 JS 线程与 C++ 线程间共享数据有锁保护
- `napi_threadsafe_function` 在不再使用时正确释放

**内存管理**：
- `napi_create_*` 创建的对象正确释放
- `napi_ref` 在不需要时调用 `napi_delete_reference`
- 无内存泄漏（`malloc`/`new` 有对应 `free`/`delete`）

**NAPI 规范**：
- TurboModule 正确实现 `getTurboModule()` 工厂函数
- NAPI 函数签名与 JS 声明一致
- 所有 NAPI API 返回值检查（`napi_status`）

#### 3.2 ArkTS 胶水层检视

- TurboModule 正确注册
- 无 `any` 类型使用（ArkTS 禁止）
- 日志使用 `RNLog` 而非 `console.log`

#### 3.3 JS/TS 接口层检视

- 方法类型声明完整（`Promise<T>`）
- 包含鸿蒙平台判断 `Platform.OS === 'harmony'`

#### 3.4 跨平台一致性对比（重点维度）

> PR 中通常仅包含 harmony 代码提交，需从克隆的仓库中读取 `android/` 和 `ios/` 的已有实现，与 harmony 变更进行对比。**这是 RN 三方库 PR 检视最关键的质量维度之一**——如果 harmony 的方法路由、参数类型、返回值格式与 Android 不一致，JS 侧调用同一 Native Module 时在鸿蒙平台上行为会异常。

**对比方法**：在克隆的 `{outputDir}/source/` 中定位 Android/iOS 的 Native Module 实现文件，逐方法对比。

| 对比项 | 说明 | 问题等级 |
|--------|------|----------|
| TurboModule 方法路由一致性 | harmony 的 TurboModule 方法列表是否与 Android NativeModule 完全对应，缺失方法 = 功能缺失 | 🔴 Critical |
| TurboModule 名称一致性 | harmony 注册的 TurboModule 名是否与 Android 注册名一致（JS 侧共用同一模块名） | 🔴 Critical |
| 参数类型映射一致性 | 同一 TurboModule 方法，harmony 解析的参数类型是否与 Android 一致（如 `bool` vs `string`） | 🔴 Critical |
| 返回值格式一致性 | `resolve()`/`reject()` 返回的数据结构是否与 Android 对齐 | 🟠 Major |
| 错误码/错误消息一致性 | `reject()` 的 code/message 是否与 Android 对齐 | 🟠 Major |
| 功能实现完整性 | Android 有实现但 harmony 为 Stub（返回固定值无实际操作）或完全缺失 | 🔴 Critical |
| EventEmitter 事件名一致性 | harmony 发送的事件名和数据格式是否与 Android 对齐 | 🟠 Major |

**对比操作步骤**：

1. 从 PR diff 中提取 harmony 变更涉及的所有 TurboModule 方法 / NAPI 函数名称
2. 在 `{outputDir}/source/android/` 中定位对应的 NativeModule 实现文件（通常为 `*Module.java` 或 `*Module.kt`，TurboModule 项目为 `*TurboModule.java`）
3. 逐方法对比：方法是否存在 → 参数类型是否一致 → 返回值格式是否一致 → 错误处理是否对齐
4. 对于 EventEmitter，对比事件名和事件数据格式
5. 将对比结果记录到报告的"跨平台一致性"章节

> **注意**：本 SKILL 的一致性对比仅针对 PR diff 涉及的方法，不是全量对比。全量一致性评估由 `rn-library-consistency-check` SKILL 负责。

---

### Phase 4：影响分析

分析本次改动对以下方面的影响：
- **功能影响**：是否引入新功能或修改现有行为
- **兼容性影响**：TurboModule API 是否向后兼容
- **性能影响**：是否优化跨线程调用或内存占用
- **安全影响**：是否修复或引入内存/线程安全问题

---

### Phase 5：生成检视报告

**报告模板见**：[REPORT-TEMPLATE.md](references/REPORT-TEMPLATE.md)

**生成要求**：
- 文件名必须为 `check-report.md`，路径在 `{outputDir}` 下
- 同时生成 `changed-files.txt`（每行一个文件路径）
- 同时生成 `result.txt`（合入建议分级结果）
- 若 PR 只修改 `android/` 或 `ios/`，注明"本次 PR 无鸿蒙平台代码变更"并 APPROVED
- 对 C++ CAPI 的内存安全和线程安全问题标记为 CRITICAL

### 5.1 合入建议分级标准

根据代码检视结果，将合入建议分为四个等级：

| 等级 | 标识 | 颜色建议 | 判断标准 | 举例场景 |
|------|------|----------|----------|----------|
| **建议合入** | ✅ `PASS` | 绿色 | 无或极少（≤2 Minor）修改引入问题，改动风险低，功能验证充分 | 纯文档更新、配置优化、已验证的 Bug 修复 |
| **条件合入** | ⚠️ `CONDITIONAL` | 黄色 | 存在少量（≤3 Major）可修复问题，在特定条件下可合入 | 需补充测试用例、需调整文档说明、非核心路径兼容性问题 |
| **修改后合入** | 🔧 `NEED_FIX` | 橙色 | 存在较多问题（≥1 Critical 或 ≥4 Major），需修复后方可合入 | TurboModule API 兼容性破坏、线程安全问题、NAPI 内存泄漏 |
| **不允许合入** | ❌ `REJECT` | 红色 | 存在严重问题（≥2 Critical），影响功能/安全/稳定性，不建议合入 | 安全漏洞、子线程直接调用 NAPI 导致崩溃风险、严重内存问题 |

**分级判断流程**：

```
统计问题数量：
  - Critical 级别问题数
  - Major 级别问题数  
  - Minor 级别问题数

判断逻辑：
  IF Critical ≥ 2 → ❌ REJECT
  IF Critical ≥ 1 → 🔧 NEED_FIX
  IF Major ≥ 4    → 🔧 NEED_FIX
  IF Major ≥ 1    → ⚠️ CONDITIONAL
  IF Minor ≤ 2    → ✅ PASS
  ELSE            → ⚠️ CONDITIONAL
```

### 5.2 result.txt 文件格式

`result.txt` 用于存储分级结果和统计信息，格式如下：

```txt
=== 合入建议分级报告 ===
PR 地址：{prUrl}
仓库：{owner}/{repo}
PR 编号：#{prNumber}
生成时间：{YYYY-MM-DD HH:mm:ss}

【合入建议】：✅ 建议合入

【问题统计】
- Critical 级别：0 个
- Major 级别：0 个  
- Minor 级别：2 个
- Suggest 级别：1 个

【分级理由】
本次修改仅包含少量 Minor 级别优化建议，无功能性问题，改动风险低，建议直接合入。

【详细分析】
━━━ Critical 级别问题 ━━━
{列出所有 Critical 问题，每个占一行，重点关注线程安全/内存/跨平台一致性问题}

━━━ Major 级别问题 ━━━
{列出所有 Major 问题，每个占一行}

━━━ Minor 级别问题 ━━━
1. [文件类型：代码质量] 删除了无用导入，代码更简洁
2. [文件类型：可观测性] RNLog 日志添加了详细上下文信息

━━━ Suggest 级别问题 ━━━
1. [文件类型：代码规范] 建议补充 JSDoc 注释

━━━ 合入建议 ━━━
建议合入：本次修改质量良好，无功能性风险。

=== 分级结束 ===
```

### 5.3 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将分级结果以下述 JSON 对象写入该路径：

```json
{
  "mergeLevel": "PASS | CONDITIONAL | NEED_FIX | REJECT",
  "critical": 0,
  "major": 0,
  "minor": 0,
  "suggest": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `mergeLevel` | string | 合入等级：PASS / CONDITIONAL / NEED_FIX / REJECT |
| `critical` | number | Critical 级别问题数 |
| `major` | number | Major 级别问题数 |
| `minor` | number | Minor 级别问题数 |
| `suggest` | number | Suggest 级别问题数 |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取，无需解析报告文本）；详细的统计与理由已在 `result.txt` 中完整记录。若 prompt 未下发该路径则跳过本节。

---

## 注意事项

1. **GitCode API 优先**：减少 patch 解析时间，但仍需 clone 获取上下文
2. **线程安全最高优先级**：子线程直接调用 NAPI 会导致崩溃，必须使用 `napi_threadsafe_function`
3. **必须克隆仓库**：用于跨文件引用分析、上下文理解，以及跨平台一致性对比
4. **交叉验证**：若 PR 同时修改 `harmony/` 和 `src/`，需验证 NAPI 函数名与 JS 声明一致
5. **报告路径**：`check-report.md` 必须在 `outputDir` 下，不能在其他路径
6. **跨平台一致性**：PR diff 涉及的 TurboModule 方法必须与 Android/iOS 实现对比，缺失或行为不一致标记为 CRITICAL/MAJOR
7. **大 PR 处理策略**：当 PR 涉及文件数超过 30 个时，按优先级分批检视：
   - **第一批（必检视）**：`harmony/src/main/cpp/**` — C++ CAPI（NAPI、内存、线程安全、跨平台一致性）
   - **第二批（必检视）**：`harmony/src/main/ets/**/*.ets` — ArkTS 胶水层（TurboModule 注册、跨平台一致性）
   - **第三批（按需检视）**：`src/**/*.ts` — JS/TS 接口层 + 构建配置文件
   - **跳过**：`android/`、`ios/`、`example/`、`docs/` 等非鸿蒙代码
   - 在报告开头标注"本次 PR 涉及 N 个文件，已按优先级分批检视，第三批文件已简化检视"

---

## 文件引用

- **详细检视清单**：[references/CHECKLIST.md](references/CHECKLIST.md)
- **平台 API 指南**：[references/API-GUIDE.md](references/API-GUIDE.md)
- **报告模板**：[references/REPORT-TEMPLATE.md](references/REPORT-TEMPLATE.md)