---
name: flutter-code-check
description: 对 Flutter（OpenHarmony 平台适配）三方库的 Pull Request 进行自动化代码检视，包括获取 PR diff、深度分析鸿蒙平台代码（ohos/ 目录 ArkTS/C++）、跨平台一致性对比、Dart 改动必要性审查，生成结构化检视报告与合入建议分级。Use when 需要检视 Flutter 三方库 PR、审查 ohos 平台适配代码、评估 Dart 改动对跨平台的影响。
license: Apache-2.0
compatibility: 需要 MCP Gateway 运行中（script_flutter_* 脚本工具 + gitcode_ 工具），需要 curl、git、jq 及访问 GitCode/GitHub/Gitee API 的网络权限
metadata:
  version: "1.0.0"
  category: code-check
  language: Dart
---

# Flutter 代码检视

对 Flutter（OpenHarmony 平台适配）三方库的 Pull Request 进行自动化代码检视，重点关注鸿蒙平台侧实现代码（`ohos/` 目录）。

> ⚠️ **核心原则**：鸿蒙适配 PR 的本质是为已有 Flutter 库增加 ohos 平台实现。**Dart 代码（`lib/`）原则上不应修改**；若存在 Dart 变更，必须逐一论证必要性并评估对 android/iOS/Web 的影响。ohos 实现必须与 android/iOS 保持方法路由、参数类型、返回值、错误码一致。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prUrl` | string | ✅ | PR 地址，如 `https://gitcode.com/openharmony-sig/flutter_image_picker/pulls/5` |
| `outputDir` | string | ✅ | 输出目录绝对路径，如 `/path/to/codecheck/owner_repo_pr5` |
| `accessToken` | string | ❌ | GitCode / Gitee Personal Access Token；GitCode API 必须携带 |
| `branch` | string | ❌ | 目标分支名；若提供则优先使用 |

---

## 输入依赖

- **前置 SKILL**: 无（独立任务）
- **输入文件**: 无（从 `prUrl` 实时获取）
- **仓库源码**: 检视过程中克隆到 `{outputDir}/source/`

---

## 工作流程概览

```
Phase 1: 信息收集（解析 PR + 获取元数据 + 下载 patch + 克隆仓库）
    ↓
Phase 2: 差异分析（按路径分类 + 确定优先级）
    ↓
Phase 3: 代码检视（ArkTS/C++/Dart 多维度 + 跨平台一致性 + Dart 必要性）
    ↓
Phase 4: 影响分析（功能/兼容/性能/安全）
    ↓
Phase 5: 生成报告（check-report.md + changed-files.txt + result.txt）
```

---

## 工作流程

### Phase 1：信息收集

#### 1.1 解析 PR 地址

从 `prUrl` 提取：`platform`、`owner`、`repo`、`prNumber`。

| 平台 | URL 模式 | API 支持 |
|------|----------|----------|
| GitCode | `https://gitcode.com/{owner}/{repo}/pulls/{num}` | ✅ 优先 REST API |
| GitHub | `https://github.com/{owner}/{repo}/pull/{num}` | ❌ patch 下载 |
| Gitee | `https://gitee.com/{owner}/{repo}/pulls/{num}` | 部分 V5 API |
| GitLab | `https://gitlab.com/{owner}/{repo}/-/merge_requests/{num}` | ❌ patch 下载 |

#### 1.2 获取 PR 元数据

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/pulls/{prNumber}?access_token={accessToken}"
```

提取：`title`、`base.ref`、`head.sha`、`user.name`、`created_at`、`state`

#### 1.3 获取 Commit Patch

```bash
curl -s "https://api.gitcode.com/api/v5/repos/{owner}/{repo}/commit/{head.sha}/patch?access_token={accessToken}" -o {outputDir}/pr.patch
```

返回标准 unified diff 格式，包含完整 commit 信息和文件变更。

> **注意**：路径使用 `commit`（单数），不是 `commits`

#### 1.4 克隆仓库

**必须克隆**以获取完整源码上下文：

```bash
git clone --depth=50 --branch {targetBranch} https://{platform}/{owner}/{repo}.git {outputDir}/source/
```

若分支克隆失败，去掉 `--branch` 克隆默认分支。

---

### Phase 2：差异分析

按路径分类修改文件，确定检视优先级：

| 路径 | 类型 | 优先级 |
|------|------|--------|
| `ohos/src/main/ets/**/*.ets` | ArkTS Plugin | **最高** |
| `ohos/src/main/cpp/**` | C++ Native | **高** |
| `ohos/CMakeLists.txt` | 构建配置 | 中 |
| `ohos/oh-package.json5` | 包依赖 | 中 |
| `lib/**/*.dart` | Dart 接口层 | 中（需必要性审查） |
| `example/**` | 示例 | 低 |

统计改动规模，从 PR 标题和 commit message 理解改动意图。

> **Dart 改动特别关注**：鸿蒙适配 PR 的核心原则是「Dart 代码不应修改，或尽量少修改」。若 PR 包含 `lib/` 目录的 Dart 代码变更，必须进行必要性分析（详见 Phase 3.3）。

---

### Phase 3：代码检视

#### 3.1 多维度检视

按以下维度检视，详细检查项参见 [检视清单](references/CHECKLIST.md)：

| 维度 | 关键点 |
|------|--------|
| 非兼容变更 | API 删除/重命名、返回格式变更 |
| Flutter Plugin 协议 | 生命周期方法、`result.success()` 后必须 `return` |
| **Dart 改动必要性** | **Dart 代码原则上不应修改，每处变更必须论证必要性，评估对其他平台的影响** |
| **跨平台一致性** | **ohos 实现与 android/iOS 的方法路由、参数类型、返回值、错误码对比** |
| ArkTS 约束 | 禁止 `any`、`eval()`、`prototype` |
| OH API 兼容 | `minAPIVersion`、权限申请 |
| 异步处理 | `await` + `try/catch`、Promise rejection |
| 事件监听器 | `on`/`off` 对称性 |
| C++ Native | NAPI 内存管理、跨线程安全 |
| 错误处理 | `result.error()` 后 `return`、switch `break` |
| 安全性 | 无硬编码敏感信息、HTTPS 校验 |

#### 3.2 跨平台一致性对比（重点维度）

> PR 中仅包含鸿蒙代码提交，需从克隆的仓库中读取 `android/` 和 `ios/` 的已有实现，与 ohos 变更进行对比。

**对比方法**：在克隆的 `{outputDir}/source/` 中定位 android/iOS 的 Plugin 实现文件，逐方法对比。

| 对比项 | 说明 | 问题等级 |
|--------|------|----------|
| 方法路由一致性 | ohos `onMethodCall` 的 case 分支是否与 android `onMethodCall` 完全对应，缺失方法 = 功能缺失 | 🔴 Critical |
| 参数类型映射一致性 | 同一 MethodChannel 方法，ohos 解析 `call.argument` 的类型是否与 android 一致（如 `bool` vs `string`） | 🔴 Critical |
| 返回值格式一致性 | `result.success()` 返回的数据结构是否与 android 对齐 | 🟠 Major |
| 错误码一致性 | `result.error()` 的 code/message 是否与 android 对齐 | 🟠 Major |
| MethodChannel 名称一致性 | ohos 注册的 Channel 名是否与 android 注册名一致（Dart 侧共用同一 Channel） | 🔴 Critical |
| 功能实现完整性 | android 有实现但 ohos 为 Stub（返回固定值无实际操作）或完全缺失 | 🔴 Critical |
| EventChannel 对比 | EventChannel 事件名和数据格式跨平台一致 | 🟠 Major |

**对比操作步骤**：

1. 从 PR diff 中提取 ohos 变更涉及的所有 `case 'methodName'` 分支
2. 在 `{outputDir}/source/android/` 中定位对应的 Plugin 实现文件（通常为 `*Plugin.java` 或 `*Plugin.kt`）
3. 逐方法对比：方法是否存在 → 参数类型是否一致 → 返回值格式是否一致 → 错误处理是否对齐
4. 对于 EventChannel，对比事件名和事件数据格式
5. 将对比结果记录到报告的"跨平台一致性"章节

---

#### 3.3 Dart 改动必要性分析（重点维度）

> **核心原则**：鸿蒙适配 PR 的本质是为已有 Flutter 三方库增加 ohos 平台实现，Dart 代码（`lib/` 目录）理论上不应修改。若 PR 包含 Dart 代码变更，必须逐一论证其必要性，并评估对 android/iOS 平台的影响。

**分析步骤**：

1. **识别所有 Dart 变更**：从 PR diff 中提取 `lib/**/*.dart` 的所有修改点
2. **逐项分类**：将每处 Dart 变更归入以下类别

| 变更类别 | 说明 | 问题等级 | 示例 |
|----------|------|----------|------|
| ✅ 必要改动 | 鸿蒙适配必须的改动，无其他实现方式 | 无问题（需记录） | 添加 `Platform.isOHOS` 平台判断以注册 ohos Plugin |
| ⚠️ 有替代方案 | 可通过 ohos 侧实现避免，不应修改 Dart | 🟠 Major | 修改 `MethodChannel` 方法名以匹配 ohos 实现（应在 ohos 侧适配） |
| ❌ 不应修改 | 改变已有 API 行为或影响其他平台 | 🔴 Critical | 修改 `invokeMethod` 的参数结构、修改返回值解析逻辑 |
| 🔍 需评估 | 涉及平台条件分支，需判断影响范围 | 🟡 Minor | 新增 `if (Platform.isOHOS)` 条件分支 |

3. **跨平台影响评估**：对每处 Dart 变更，验证以下影响

| 影响项 | 检查方法 | 问题等级 |
|--------|----------|----------|
| android/iOS 运行时行为是否改变 | 检查变更是否在 `Platform.isOHOS` 条件内 | 🔴 Critical（若影响） |
| MethodChannel 协议是否破坏 | Dart 侧 `invokeMethod` 参数是否与 android 侧仍兼容 | 🔴 Critical（若破坏） |
| 公共 API 签名是否变更 | `pubspec.yaml` 版本号是否对应升 major | 🟠 Major（若未升版本） |
| Platform Interface 默认实现是否受影响 | 默认实现的行为是否被改变 | 🟠 Major（若改变） |

4. **Dart 变更替代方案建议**：对于每处「有替代方案」或「不应修改」的变更，给出 ohos 侧的替代实现建议

**常见 Dart 改动模式与判定**：

| Dart 改动模式 | 判定 | 说明 |
|--------------|------|------|
| 新增 `if (Platform.isOHOS)` 条件分支 | ✅ 必要 | 鸿蒙平台需要独立的初始化或注册逻辑 |
| 新增 `TargetPlatform.ohos` case | ✅ 必要 | 平台枚举扩展 |
| 修改 `MethodChannel` 名称 | ❌ 不应修改 | 应在 ohos 侧注册与 android 相同的 Channel 名 |
| 修改 `invokeMethod` 的参数 | ❌ 不应修改 | 应在 ohos 侧适配参数解析 |
| 修改 `result` 返回值的解析逻辑 | ❌ 不应修改 | 应在 ohos 侧返回与 android 相同格式 |
| 新增 `import 'dart:io'`（原无） | ⚠️ 需评估 | 若仅用于 `Platform.isOHOS` 可接受，但可能影响 Web 平台 |
| 修改 Platform Interface 方法签名 | ❌ 不应修改 | 应通过 ohos Plugin 实现来适配 |
| 新增公共 API 方法 | ⚠️ 需评估 | 若仅 ohos 使用，应考虑是否为通用需求 |
| 修改 `pubspec.yaml` 依赖 | 🔍 需评估 | 新增依赖是否为 ohos 适配必要 |
| 删除或注释已有代码 | ❌ 不应修改 | 鸿蒙适配不应删除已有功能代码 |

---

### Phase 4：影响分析

- **功能影响**：是否引入新功能或修改行为
- **兼容性影响**：Plugin API 是否向后兼容
- **性能影响**：异步处理是否改善
- **安全影响**：是否修复或引入安全问题

---

### Phase 5：生成报告

输出文件：
- `{outputDir}/check-report.md` — 检视报告
- `{outputDir}/changed-files.txt` — 修改文件列表
- `{outputDir}/result.txt` — 合入建议分级结果

> 报告格式参见 [输出模板](assets/OUTPUT_TEMPLATE.md)

### 5.1 合入建议分级标准

根据代码检视结果，将合入建议分为四个等级：

| 等级 | 标识 | 颜色建议 | 判断标准 | 举例场景 |
|------|------|----------|----------|----------|
| **建议合入** | ✅ `PASS` | 绿色 | 无或极少（≤2 Minor）修改引入问题，改动风险低，功能验证充分 | 纯文档更新、配置优化、已验证的 Bug 修复 |
| **条件合入** | ⚠️ `CONDITIONAL` | 黄色 | 存在少量（≤3 Major）可修复问题，在特定条件下可合入 | 需补充测试用例、需调整文档说明、非核心路径兼容性问题 |
| **修改后合入** | 🔧 `NEED_FIX` | 橙色 | 存在较多问题（≥1 Critical 或 ≥4 Major），需修复后方可合入 | Plugin API 兼容性破坏、内存泄漏、`result.success()` 后未 return |
| **不允许合入** | ❌ `REJECT` | 红色 | 存在严重问题（≥2 Critical），影响功能/安全/稳定性，不建议合入 | 安全漏洞、严重 NAPI 内存问题、未验证的重大架构变更 |

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

`result.txt` 用于存储分级结果和统计信息，格式详见 [输出模板](assets/OUTPUT_TEMPLATE.md) 的 result.txt 生成规范。

### 5.3 结构化指标输出（必须执行）

执行环境会在任务 prompt 中下发一个**结构化指标文件输出路径**（`stepId{X}_loop{L}_meta_{N}.json`）。
检视完成后，**必须**将分级结果以下述 JSON 对象写入该路径：

```json
{
  "mergeLevel": "PASS | CONDITIONAL | NEED_FIX | REJECT",
  "critical": 0,
  "major": 0,
  "minor": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `mergeLevel` | string | 合入等级：PASS / CONDITIONAL / NEED_FIX / REJECT |
| `critical` | number | Critical 级别问题数 |
| `major` | number | Major 级别问题数 |
| `minor` | number | Minor 级别问题数 |

**说明**：该文件由执行框架自动收割入库（前端/历史列表直接读取，无需解析报告文本）；详细的统计与理由已在 `result.txt` 中完整记录。若 prompt 未下发该路径则跳过本节。

---

## 注意事项

1. 若 PR 只修改 `android/` 或 `ios/`，无鸿蒙改动 → 注明并 APPROVED
2. 报告文件名必须是 `check-report.md`
3. **`result.success()` / `result.error()` 后必须 `return`** — 最常见严重问题
4. 若同时修改 `ohos/` 和 `lib/` → 交叉验证方法名和参数类型
5. **Dart 代码修改原则**：鸿蒙适配 PR 中 Dart 代码不应修改；若存在 Dart 变更，必须在报告中单独论证每处变更的必要性和跨平台影响
6. Dart 侧修改 `MethodChannel` 方法名/参数/返回值格式 → 应改为在 ohos 侧适配，而非修改 Dart 代码

---

## 参考文档

- [检视清单 CHECKLIST.md](references/CHECKLIST.md)
- [平台 API PLATFORMS.md](references/PLATFORMS.md)
- [输出模板 OUTPUT_TEMPLATE.md](assets/OUTPUT_TEMPLATE.md)
