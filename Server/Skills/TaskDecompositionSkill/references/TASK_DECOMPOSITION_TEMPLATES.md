# 常见任务拆解模板

> 常见任务的步骤图结构骨架，供 TaskDecompositionSkill 参考。模板是"图结构骨架"，需结合当前任务实际与验收标准适配；模板中括号内的 SKILL 名称仅为示意，实际执行由 SkillSelector 在运行时匹配，不绑定具体技能。

---

## 模板 1：库移植分析

```
步骤1: 源码分析（CPPAnalysisSkill / FlutterCodeCheck）
  → 成功: 步骤2    → 失败: 终止(failStepId=0)

步骤2: 接口分析（HarmonyLibraryInterface / LibraryInterface）
  → 成功: 步骤3    → 失败: 步骤4

步骤3: 编译验证（CPPCompileSkill）
  → 成功: 步骤5(终止)  → 失败: 步骤4

步骤4: 问题修复（CPPPortingSkill）
  → 成功: 步骤3(重试编译)  → 失败: 步骤5(终止)

步骤5: 生成报告（终止, nextStepId=0）
```

## 模板 2：代码质量检查

```
步骤1: 代码质量检查（XxxLibraryCodeQualityCheckSkill）
  → 成功: 步骤2    → 失败: 步骤3

步骤2: 文档质量检查（XxxLibraryDocumentationQualityCheckSkill）
  → 成功: 步骤4(终止)  → 失败: 步骤3

步骤3: 问题修复（LibraryDocFixSkill）
  → 成功: 步骤1(重试)  → 失败: 步骤4(终止)

步骤4: 终止(nextStepId=0)
```

## 模板 3：PR 代码检视

```
步骤1: 获取 PR 信息并克隆仓库
  → 成功: 步骤2    → 失败: 终止

步骤2: 分析变更文件
  → 成功: 步骤3    → 失败: 终止

步骤3: 生成检视报告
  → 成功: 终止(nextStepId=0)  → 失败: 终止(failStepId=0)
```

## 模板 4：并行检查

```
步骤1: 准备环境
  → 成功: 步骤2 + 步骤3 (并行)  → 失败: 终止

步骤2: 代码质量检查 (dependId=1)
  → 成功: 步骤4  → 失败: 步骤5

步骤3: 安全扫描 (dependId=1)
  → 成功: 步骤4  → 失败: 步骤5

步骤4: 汇总报告 (dependId=2,3)
  → 成功: 终止  → 失败: 终止

步骤5: 修复 (dependId=2 或 3)
  → 成功: 步骤2 或 步骤3 (重试)  → 失败: 步骤4(终止)
```

## 模板 5：鸿蒙ArkTs原生库补充XTS测试用例并自动化运行XTS测试

```
步骤1: 克隆仓库并扫描提取源码中对外公开的方法级接口与接口签名。
  → 成功: 步骤2  → 失败: 终止

步骤2: 分析当前源码中已有的XTS测试用例的接口覆盖率，输出markdown覆盖率报告。
  → 成功: 步骤3  → 失败: 终止

步骤3: 为未覆盖的接口生成新的XTS测试用例场景描述，输出markdown场景描述报告。
  → 成功: 步骤4  → 失败: 终止

步骤4: 根据步骤3生成的场景描述报告，生成ArkTs代码，进行XTS测试用例补充。
  → 成功: 步骤5  → 失败: 终止

步骤5: 自动执行XTS测试，输出markdown测试报告。
  → 成功: 终止(nextStepId=0)  → 失败: 步骤6

步骤6: 根据步骤5的执行/编译失败报告，修复本次生成的XTS测试代码。
  → 成功: 步骤5(重新执行XTS测试)  → 失败: 终止
```

## 模板 6：RN 三方库框架升级适配

> **适用场景**：将 RN 鸿蒙化三方库从某个 RNOH 版本升级到新版本（如 0.72→0.82、0.82→0.84），涉及版本差异分析、代码适配、测试对齐、设备验证与功能总结。
>
> **拆解依据**：此类任务天然对应 4 个执行 SKILL 的 phase（version-diff / code-adapt / test-align / func-test），加上前置克隆和设备验证独立，共 6 步。每步对应一个 SKILL phase 或其关键子集。**有推荐 SKILL 的步骤只需描述任务目标与关键参数，技术细节由 SKILL 承载；无推荐 SKILL 的步骤仍需写明具体操作。**
>
> **关键参数**：必须从任务描述中提取版本号（源版本 + 目标版本 + 框架依赖版本）、分支名（源分支 + 目标分支）、仓库 URL、库名到 `keyParameters`。

```
步骤1: 克隆仓库并验证分支与结构 (dependId=0)
  从 git URL 克隆源分支到工作目录；git branch --show-current 确认分支；
  ls 确认 package.json、src/、harmony/ 三部分结构
  → 成功: 步骤2  → 失败: 终止

步骤2: 版本差异分析 (dependId=1)
  对 {库名} 进行版本差异分析，对比 {源分支} 基线版本与 {目标版本} 的差异，
  检查 {目标分支} 分支是否存在，输出版本分析报告。
  推荐使用 rnoh-lib-version-diff SKILL 执行。
  → 成功: 步骤3  → 失败: 终止

步骤3: 代码适配与编译验证 (dependId=2)
  对 {库名} 进行 0.82→0.84 框架升级代码适配与编译验证，输出适配变更清单。
  推荐使用 rnoh-lib-code-adapt SKILL 执行。
  → 成功: 步骤4  → 失败: 终止

步骤4: 测试对齐与补全 (dependId=3)
  对 {库名} 移植上游测试 demo 并执行测试验证，补充缺失测试用例，输出测试结果。
  推荐使用 rnoh-lib-test-align SKILL 执行。
  → 成功: 步骤5  → 失败: 终止

步骤5: 签名构建与设备运行时验证 (dependId=4)
  确保 build-profile.json5 中 signingConfigs 已配置且非空（p12/cer 证书）；
  构建产出 entry-default-signed.hap（已签名），确认 size > 0；
  部署到设备，获取 UI 树 JSON grep 搜索库名关键词命中（确认非残留应用）；
  获取 hilog 按 level=F/E 过滤，确认无 Fatal/Error 崩溃日志；
  输出设备验证记录
  → 成功: 步骤6  → 失败: 终止

步骤6: 功能测试总结 (dependId=5, nextStepId=0)
  基于适配变更清单与设备验证记录，生成功能测试 checklist 与 fix-summary.json，
  标注高风险场景。
  推荐使用 rnoh-lib-func-test SKILL 执行。
  → 成功: 终止  → 失败: 终止
```

### 模板 6 的 AC 覆盖模式

| 步骤 | 覆盖的任务级 AC 维度 |
|------|-------------------|
| 步骤1 | 仓库克隆 + 分支确认 + 目录结构 |
| 步骤2 | 版本分析报告（currentVersion、upstreamVersion、diffItems、风险等级、目标分支存在性） |
| 步骤3 | 不兼容变更处理 + 框架依赖版本 + example file:→npm: + 适配变更清单 + 编译通过 |
| 步骤4 | 测试结果（jest 通过率 + 覆盖率），支撑设备验证与 fix-summary |
| 步骤5 | 签名 HAP + signingConfigs + 设备 UI 树 + hilog 无崩溃 |
| 步骤6 | fix-summary.json 独立文件 + fixItems 三字段 + testResult=pass 可追溯 |

### 模板 6 的推荐 SKILL 映射

> 有推荐 SKILL 的步骤，`taskDescription` 只需描述任务目标与关键参数（版本号/分支名/库名），技术执行细节由 SKILL 承载，末尾追加`推荐使用 {SKILL目录名} SKILL 执行。`。无专用 SKILL 的步骤（步骤1、步骤5 为通用操作）仍需写明具体操作步骤。

| 步骤 | 步骤职责 | 推荐 SKILL |
|------|----------|----------|
| 步骤1 | 克隆仓库并验证分支与结构 | （无） |
| 步骤2 | 版本差异分析 | `rnoh-lib-version-diff` |
| 步骤3 | 代码适配与编译验证 | `rnoh-lib-code-adapt` |
| 步骤4 | 测试对齐与补全 | `rnoh-lib-test-align` |
| 步骤5 | 签名构建与设备运行时验证 | （无） |
| 步骤6 | 功能测试总结 | `rnoh-lib-func-test` |

### 模板 6 的变体

- **跨大版本升级**（如 0.72→0.84）：步骤结构不变，步骤 2/3 的 `taskDescription` 中标注涉及的版本范围即可，具体不兼容变更由 SKILL 处理
- **纯 JS 库（无 harmony/ 原生层）**：步骤 3/5 的 `taskDescription` 中标注"纯 JS 库"，SKILL 会自动跳过 codegen/harmony 层与设备验证
- **上游已是最新（类型 B）**：步骤 2 的 `taskDescription` 中标注"上游已最新"，SKILL 会自动聚焦框架 API 变更对比
