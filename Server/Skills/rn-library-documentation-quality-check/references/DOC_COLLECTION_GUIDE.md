# 文档收集指南

> 本文件供 `rn-library-documentation-quality-check` 技能在 Phase 1 阶段参考使用，详细定义文档模式识别、文件收集、外部文档获取的完整流程。

---

## 一、文档模式识别

RN 三方库的文档存在**两种分布模式**，必须先识别模式再进行收集：

| 模式 | 特征 | 典型库 |
|------|------|--------|
| **内嵌文档** | README.md / README_zh.md 包含完整的安装、链接、接口说明、约束与限制 | `react-native-svg`、`react-native-linear-gradient` |
| **跳转文档** | README.md 极简（仅含包名+许可证），"文档"章节指向外部集中式文档仓库 | `react-native-network-info`、`react-native-device-info` |

### 1.1 识别步骤

读取仓库根目录的 `README.md`，检查是否包含跳转特征：

```bash
# 扫描本地文档文件
find {{outputDir}}/source/ohos -type f \( -name "*.md" -o -name "*.d.ts" -o -name "*.json5" -o -name "*.txt" \)

# 识别跳转文档模式：README 中包含 usage-docs 链接
grep -i "usage-docs\|OpenHarmony-RN" {{outputDir}}/source/ohos/README.md
```

> `workdir: "{{outputDir}}"`

### 1.2 跳转文档识别信号（满足任一即为跳转模式）

| 信号 | 示例 |
|------|------|
| README 含 `OpenHarmony-RN/usage-docs` 链接 | `[中文](https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/zh-cn/react-native-network-info.md)` |
| README 仅含"文档"章节+链接，无安装/使用/接口详细说明 | README 内容少于 30 行，无代码示例 |
| README 含 `README_zh.md` 但两者都极简 | 中英文 README 均为跳转模式 |

### 1.3 内嵌文档识别信号（满足任一即为内嵌模式）

| 信号 | 示例 |
|------|------|
| README 含"安装与使用"/"链接"/"接口说明"/"约束与限制"等完整章节 | `react-native-svg` 的 README 含 7+ 章节 |
| README 长度超过 100 行且含代码示例 | 含 npm/yarn 安装命令 + 使用示例 |
| README 含 API 支持矩阵表格 | 含"HarmonyOS Support"列的属性表格 |

---

## 二、本地文档文件收集

无论哪种模式，都需要收集本地文件：

```bash
find {{outputDir}}/source/ohos -type f \( -name "*.md" -o -name "*.d.ts" -o -name "*.json5" -o -name "*.txt" \)
```

### 2.1 文件分类规则

| 文件类型 | 检视重点 | 内嵌模式 | 跳转模式 |
|----------|----------|----------|----------|
| `README.md` | 结构完整性、安装/使用说明 | ✅ 主要检视对象 | ⚠️ 仅检视链接有效性和基本信息 |
| `README_zh.md` | 中文文档结构 | ✅ 主要检视对象 | ⚠️ 同上 |
| 外部 usage-docs | 完整安装/链接/接口/约束说明 | ❌ 不存在 | ✅ **主要检视对象** |
| `CHANGELOG.md` | 鸿蒙化变更、版本规范 | ✅ 检视 | ✅ 检视（仍为本地文件） |
| `.d.ts` 文件 | TSDoc 注释完整性 | ✅ 检视 | ✅ 检视 |
| `.ets`/`.ts` 文件 | export API 的 JSDoc/TSDoc 注释 | ✅ 检视 | ✅ 检视 |
| `.json5` 文件 | 配置项注释说明 | ✅ 检视 | ✅ 检视 |

### 2.2 必须确认的文件清单

1. `{outputDir}/source/ohos/README.md`（含 README_zh.md）
2. `{outputDir}/source/ohos/CHANGELOG.md`
3. `{outputDir}/source/ohos/**/*.d.ts`
4. `{outputDir}/source/ohos/Index.ets` 或 `Index.ts`（入口文件注释）
5. `{outputDir}/source/ohos/src/main/module.json5`
6. **跳转模式专属**：`{outputDir}/external-docs/` 下的外部文档文件

若关键文件不存在，记录为对应维度的 Critical/Major 问题。

---

## 三、外部跳转文档获取（跳转模式专属）

若识别为跳转模式，**必须**获取外部文档内容作为检视依据。

### 3.1 获取优先级

**rndocUrl（方法零） > README 链接提取（方法一） > 标准 URL 构造（方法二）**

### 3.2 方法零：使用传入的 rndocUrl（最高优先级）

若任务参数中传入了 `rndocUrl`，**优先使用 rndocUrl 直接下载文档**，无需从 README 链接提取或构造标准 URL：

```bash
# 如果 rndocUrl 已传入，直接下载（跳过方法一和方法二）
# 下载到 {outputDir}/external-docs/ 目录
curl -L "{{rndocUrl}}" -o "{{outputDir}}/external-docs/external-doc-zh.md"

# 同时尝试下载英文版本（若 rndocUrl 为中文链接，尝试替换 zh-cn 为 en）
```

> ⚠️ **rndocUrl 优先级规则**：若 rndocUrl 传入且可成功下载，直接使用，跳过方法一和方法二；若 rndocUrl 下载失败，仍需 fallback 到方法一和方法二获取文档。

**MCP 工具替代方案**：若 MCP Gateway 可用，可调用 `gitcode_get_raw_file` 工具获取 GitCode 上的外部文档，传入 `owner`、`repo`、`path`、`ref` 参数，比 curl 更可靠。

### 3.3 方法一：从 README 链接提取（rndocUrl 未传入时的推荐方法）

```bash
# 从 README 中提取 usage-docs 链接
grep -oE 'https://gitcode\.com/OpenHarmony-RN/usage-docs/blob/master/[^)]+' {{outputDir}}/source/ohos/README.md
```

### 3.4 方法二：构造标准 URL

跳转文档的标准 URL 格式：
- 中文：`https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/zh-cn/{原库名}.md`
- 英文：`https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/en/{原库名}.md`

其中 `{原库名}` 可从 `package.json` 的 `name` 字段提取（去掉 `@react-native-ohos/` 或 `@react-native-oh-tpl/` 前缀）。

> ⚠️ **跳转文档必须获取**：跳转模式下的外部文档是用户实际看到的"官方文档"，其内容完整性直接影响评分。仅检视仓库本地文件而不获取外部文档，会导致严重评分偏差——本地极简 README 本身就是跳转设计，不应被扣分为"文档缺失"。

**跳转文档保存**：获取后保存到 `{outputDir}/external-docs/` 目录，用于 Phase 2 检视。

---

## 四、边界场景处理

| 场景 | 处理方式 |
|------|----------|
| 无 README.md | 记录 RM-001 Critical；仍需检视源码注释和配置文件 |
| 无 CHANGELOG.md | 记录 CL-001 Major；检查 package.json 中是否有版本信息 |
| 无 .d.ts 文件 | 从源码 `.ts`/`.ets` 中直接提取 export 项进行注释检查 |
| 无 example/ 目录 | 记录 EX-005 Major；检查 README 或外部文档中的内联示例 |
| 多模块库 | 逐模块检视，报告中分模块列出问题 |
| 源码为纯 C++ NDK | 从头文件和 NAPI 绑定文件提取接口，检查注释 |
| **跳转链接失效** | 记录 HA-025 Critical（跳转文档链接失效或内容为空）；尝试方法二构造 URL 获取 |
| **跳转文档为空** | 外部文档页面存在但内容空白，记录 HA-025 Critical |
| **跳转文档未覆盖鸿蒙特有内容** | 外部文档仅复制原库文档无鸿蒙化说明，记录 HA-026 Major |
| **内嵌与跳转混合** | README 有部分内容+外部链接，两者均需检视 |
