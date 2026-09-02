# 三方库版本分析报告：{repo-name}

**生成日期：** {YYYY-MM-DD}
**鸿蒙化仓库：** {owner}/{repo}
**上游 npm 包名：** {package-name}

---

## 基本信息

| 项目 | 值 |
|------|-----|
| 鸿蒙化仓库 | {owner}/{repo} |
| 上游仓库 | {upstream-url} |
| 上游 npm 包名 | {package-name} |
| 当前 RNOH 版本 | {当前分支版本，如 0.77} |
| 目标 RNOH 版本 | {目标版本，如 0.84} |
| 升级类型 | 类型 A（上游版本升级 + 框架适配） / 类型 B（纯框架适配） |
| 库类型 libraryType | {native-harmony / js-only-harmony / pure-js} |

---

## 版本差距

| 项目 | 值 |
|------|-----|
| 鸿蒙化基线版本 | v{version} |
| 任务指定对比版本 | v{version}（与 latest 不同时填写） |
| npm 最新版本 (dist-tags.latest) | v{version} |
| 版本状态 | {落后 N 个小版本 / ✅ 最新 / 超前} |
| 至任务指定版本差距 | {落后 N 个版本，主要变更概述} |
| 至 npm latest 差距 | {落后 N 个版本，latest 增量说明（如仅 patch 修复），可提示顺带对齐} |
| 最近版本列表 | {v1}, {v2}, {v3}, ... |

---

## 分支-基线核验（任务指定分支/基线与仓库不符时必填）

> 以 `README.OpenSource` Version Number（最可靠）+ `git log --all --grep` + `git branch -a --contains` 核验；不符时以实际核验结果为准，并在报告开篇澄清。

| 分支 | package.json 版本 | README.OpenSource 上游基线 | 说明 |
|------|------------------|---------------------------|------|
| {branch} | {version} | {version} | {如：任务指定分支，实际基线为 X} |
| {branch} | {version} | {version} | {如：任务指定基线实际所在分支} |

---

## 自动判定修正（人工复核推翻脚本结论时必填）

> 脚本（rn-scan-exports.cjs）自动判定仅覆盖 TurboModule Spec；Fabric 组件 Spec 变更须人工 diff `codegenNativeComponent` 输入文件复核。下游请勿直接采信 `api-diff_*.md` 的自动结论。

| 项目 | 内容 |
|------|------|
| 脚本自动结论 | {如：✅ 无需原生适配 — 接口未变更} |
| 修正后结论 | {如：需要原生适配（类型 A）} |
| 修正原因 | {如：Fabric 组件 Spec 新增 N props + M 事件，为 codegen 直接输入} |

---

## 差异概览（仅类型 A）

- 变更文件数：{N} 个
- 新增文件：{N} 个
- 删除文件：{N} 个
- 修改文件：{N} 个
- 净增行数：+{N} / -{N}

### 变更摘要（按模块分类）

| 模块 | 变更说明 | 影响程度 | 文件数 |
|------|----------|----------|--------|
| JS/TS 公共 API | {说明} | 高/中/低 | {n} |
| TurboModule Spec | {说明} | 高/中/低 | {n} |
| Fabric 组件 Spec | {说明} | 高/中/低 | {n} |
| Android 原生 | {说明} | 高/中/低 | {n} |
| iOS 原生 | {说明} | 高/中/低 | {n} |
| 构建/依赖 | {说明} | 高/中/低 | {n} |
| 文档/测试/CI | {说明} | 高/中/低 | {n} |

---

## 上游→鸿蒙目录映射（仅类型 A）

> 鸿蒙化仓库并非原样保留上游 src/ 结构。Phase 2 筛选与后续 code-adapt 阶段按此表转写文件变更，不得假设鸿蒙仓库保留上游目录结构。

| 类别 | 上游路径 | 鸿蒙仓库对应 | 说明 |
|------|----------|-------------|------|
| Fabric 组件 Spec | {path} | {path} | {重命名/扩展说明} |
| TurboModule Spec | {path} | {path} | |
| types | {path} | {path} | |
| 平台实现 | {X.android.tsx / X.ios.tsx} | {X.tsx 自有实现等} | |
| codegen 入口 | — | {scripts/codegen-lib.js 等} | {react-native-harmony-cli 调用方式、输出目录} |

---

## 升级风险评估

| 风险等级 | 判定依据 |
|----------|----------|
| 🟢 低风险 | 仅补丁版本差距，无 breaking change |
| 🟡 中风险 | 小版本差距，有 API 变更但向后兼容 |
| 🔴 高风险 | 大版本差距，有 breaking change 或原生层重构 |

**当前评估：** {风险等级} — {判定依据说明}

> ⚠️ major 版本跨度 ≠ breaking change：须逐条核对 CHANGELOG / GitHub Releases 的 breaking 项是否触及 **JS 层接口契约**（原生侧 only 的 breaking 属性可降级处理）。

---

## 鸿蒙 API 核查（涉及原生能力时必填）

> 凡涉及原生能力的需适配项，须使用 `devecocli docs search` 完成核查后再写结论。
> 纯 JS 库标注「不适用 API 核查」并跳过下表。流程见 [references/OHOS_API_LOOKUP.md](../references/OHOS_API_LOOKUP.md)。

| 上游能力 | 上游实现摘要 | 鸿蒙 Kit/API | 能力对比 | 约束与风险 | 可行性 | 建议动作 | 核查状态 |
|----------|--------------|-------------|----------|------------|--------|----------|----------|
| {capability} | {android_ios_summary} | {kit + api + 搜索关键词} | 一致/子集/无对等 | {docs_constraints} | ✅/⚠️/🔶/❌ | {harmony_files_strategy} | 分析中/已完成 |

---

## 鸿蒙化适配分析

> 判断规则见 [references/OHOS_ADAPTATION.md](../references/OHOS_ADAPTATION.md)。

### 需适配项

| 序号 | 上游变更 | 鸿蒙侧动作 | 优先级 | 适配依据 |
|------|----------|------------|--------|----------|
| 1 | {upstream_change} | {ohos_action} | 高/中/低 | {引用 API 核查表行号} |

### 无需适配项

- {no_adapt_item_1}

### RNOH 框架版本变化（类型 B 或跨版本升级时填写）

| 项目 | 当前版本 | 目标版本 |
|------|----------|----------|
| react-native | ... | ... |
| react | ... | ... |
| @react-native-oh/react-native-harmony | ... | ... |
| CLI | ... | ... |

### 需关注的适配点

（列出 ETS 业务代码、Package 注册代码、C++ 层依赖的 RNOH API，
以及 generated/ 代码需重新 codegen 的说明）

---

## 差异文件位置（仅类型 A）

> 工作目录：`{output-dir}`

| 文件 | 完整路径 | 说明 |
|------|----------|------|
| 源码目录 (基线) | `{output-dir}/{b1}/` | 基线版本源码导出 |
| 源码目录 (目标) | `{output-dir}/{b2}/` | 目标版本源码导出 |
| diff patch | `{output-dir}/diff_{b1}_{b2}.patch` | JS/TS 核心文件变更补丁 |
| 变更摘要 | `{output-dir}/summary_{b1}_{b2}.md` | 按文件统计增删行数 |
| 接口差异检查清单 | `{output-dir}/api-diff_{b1}_{b2}.md` | TurboModule Spec 差异 |
| 适配分析报告 | `{output-dir}/structure_{b1}_{b2}.md` | 接口驱动的适配分析 |

---

## 升级步骤建议

1. 从当前分支创建新的目标分支
2. {类型 A：应用上游 diff patch 合并 JS 变更 / 类型 B：跳过}
3. 更新 package.json / oh-package.json5 中的 RNOH 依赖版本
4. 使用目标版本 CLI 重新执行 codegen
5. 验证 RNOH API 兼容性（ETS/C++ 层）
6. {类型 A：适配鸿蒙原生层变更 / 类型 B：跳过}
7. 编译构建验证 + 功能测试

---

## 下一步建议

→ 使用 code-adapt skill 进行代码适配与编译验证
