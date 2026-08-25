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
| npm 最新版本 | v{version} |
| 版本状态 | {落后 N 个小版本 / ✅ 最新 / 超前} |
| 最近版本列表 | {v1}, {v2}, {v3}, ... |

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
| Android 原生 | {说明} | 高/中/低 | {n} |
| iOS 原生 | {说明} | 高/中/低 | {n} |
| 构建/依赖 | {说明} | 高/中/低 | {n} |
| 文档/测试/CI | {说明} | 高/中/低 | {n} |

---

## 升级风险评估

| 风险等级 | 判定依据 |
|----------|----------|
| 🟢 低风险 | 仅补丁版本差距，无 breaking change |
| 🟡 中风险 | 小版本差距，有 API 变更但向后兼容 |
| 🔴 高风险 | 大版本差距，有 breaking change 或原生层重构 |

**当前评估：** {风险等级} — {判定依据说明}

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
