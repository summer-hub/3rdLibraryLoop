---
name: arkts-library-code-quality-check
description: 对 ArkTS 鸿蒙化库的**核心实现代码**进行编码质量检视，依据华为 ArkTS 编程规范，分析命名规范、格式规范、编程实践、代码复杂度、ArkTS 特定规范、架构模式等维度，排除 example/demo/sample 及 test 代码，生成严苛评分报告（0-100分）。作为 ArkTS 仓库检视流程的第三阶段。Use when 需要对鸿蒙化 ArkTS 库进行编码质量检视或评估代码规范遵循度。
license: Apache-2.0
compatibility: 需要访问 Git 仓库、分析 ArkTS/ETS 源码
metadata:
  author: CPPAgent
  version: "3.0"
  stage: "3"
  weight: "20"
---

# ArktsLibraryCodeQualityCheckSkill

对**已鸿蒙化的 ArkTS 库**的核心实现代码进行编码质量检视，依据华为 ArkTS 编程规范，评估命名规范、格式规范、编程实践、代码复杂度、ArkTS 特定规范、架构设计等关键质量指标。

> ⚠️ **核心定位**：本 SKILL **仅检视鸿蒙化实现代码中的库核心能力**，不关注非鸿蒙化部分的代码质量。

> ⚠️ **检视范围限定**：**排除 example、demo、sample 及 test 相关代码**。仅检视库的核心实现（对外暴露的 API、核心业务逻辑、NAPI 绑定层），不分析示例用例、演示代码、测试代码。

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `repoUrl` | ✅ | Git 仓库地址 |
| `outputDir` | ✅ | 输出目录绝对路径 |
| `interfaceDocPath` | ✅ | 接口规格说明文档路径 |
| `repoName` | ✅ | 仓库名称 |

---

## 输入依赖

- **前置 SKILL**: `ArktsLibraryStabilityCheckSkill`（稳定性检视已完成）
- **输入文件**: `接口规格说明.md`、`稳定性检视报告.md`（位于 outputDir）

---

## 编码规范依据

本 SKILL 的检视标准严格依据以下规范：

- **ArkTS/ETS**：[华为 ArkTS 编程规范](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-coding-style-guide)（命名、格式、编程实践）
- **C++ (NDK)**：[华为 C++ 编程规范](https://gitcode.com/openharmony/docs/blob/master/zh-cn/contribute/OpenHarmony-cpp-coding-style-guide.md)（若库包含 NDK 层）

---

## 工作流程

### Phase 1：源码范围识别（排除非核心代码）

**先过滤掉非核心代码**，确保检视聚焦于库的核心能力：

**排除规则**：

| 排除类型 | 目录/文件特征 | 说明 |
|----------|---------------|------|
| **示例代码** | 目录名含 `example`、`demo`、`sample`、`samples` | 库的使用示例，不代表核心能力 |
| **测试代码** | 目录名含 `test`、`tests`、`__test__`、`spec`、`unittest` | 测试代码验证功能而非实现功能 |
| **文档示例** | 文件名含 `example`、`demo`、`sample` 的 `.ets/.ts` 文件 | 嵌入文档中的示例代码 |

扫描鸿蒙化核心代码文件：

```bash
# 扫描核心源码文件（排除 example/demo/sample/test）
find {{outputDir}}/source -type f \( -name "*.ets" -o -name "*.ts" -o -name "*.json5" \) \
  -not -path "*/example*" \
  -not -path "*/demo*" \
  -not -path "*/sample*" \
  -not -path "*/samples*" \
  -not -path "*/test*" \
  -not -path "*/__test__*" \
  -not -path "*/spec*" \
  -not -path "*/unittest*"
```

> `workdir: "{{outputDir}}"`

**文件分类规则**（仅核心实现代码）：
- `.ets` 文件（排除 example/demo/sample/test）：UI/页面层核心代码，重点检视 ArkTS 特定规范（装饰器、生命周期、UI 模式）
- `.ts` 文件（排除 example/demo/sample/test）：逻辑/数据层核心代码，重点检视命名规范、编程实践、代码复杂度
- `.json5` 文件（排除 example/demo/sample/test）：配置文件，仅检视是否存在冗余/过期配置

### Phase 2：逐文件编码质量分析（核心实现代码）

对每个核心实现源码文件进行编码质量检视，重点关注以下维度：

#### 2.1 命名规范（依据 ArkTS 编程规范-命名章节）

| 检查项 | 严重度 | 规范依据 | 说明 |
|--------|--------|----------|------|
| 类名/枚举名/命名空间名非 UpperCamelCase | Major | ArkTS 规范-命名 | 类、枚举、命名空间应采用大驼峰命名（如 `User`、`UserType`） |
| 变量名/方法名/参数名非 lowerCamelCase | Major | ArkTS 规范-命名 | 变量、函数、参数应采用小驼峰命名（如 `userName`、`sendMsg`） |
| 常量名/枚举值名非全大写+下划线 | Major | ArkTS 规范-命名 | 常量与枚举值应全大写、下划线分隔（如 `MAX_USER_SIZE`、`TEACHER`） |
| 布尔变量缺少是非前缀 | Minor | ArkTS 规范-命名 | 布尔变量应使用 `is`/`has`/`can`/`should` 前缀（如 `isError` 而非 `isNotError`） |
| 标识符使用中文拼音或单字母 | Major | ArkTS 规范-命名 | 标识符应使用清晰英文单词，避免拼音和单字母（如 `a`、`b`、`zhangsan`） |
| 函数名使用模糊词 | Minor | ArkTS 规范-命名 | 函数名应避免使用 `Data`、`Info`、`Handle` 等模糊词 |

#### 2.2 格式规范（依据 ArkTS 编程规范-格式章节）

| 检查项 | 严重度 | 规范依据 | 说明 |
|--------|--------|----------|------|
| 使用 Tab 缩进而非空格 | Major | ArkTS 规范-格式 | 必须使用空格缩进，禁止 Tab，优先 2 空格 |
| 行宽超过 120 字符 | Minor | ArkTS 规范-格式 | 单行不宜超过 120 字符（不含 URL/命令注释例外） |
| 条件/循环语句缺少大括号 | Major | ArkTS 规范-格式 | if/for/while 等语句体必须使用 `{}` |
| switch case/default 未缩进 | Minor | ArkTS 规范-格式 | case/default 应缩进一层（2空格） |
| 多变量定义写在一行 | Minor | ArkTS 规范-格式 | 每个语句只声明一个变量，禁止 `let a = 1, b = 2` |
| 空格使用不规范 | Minor | ArkTS 规范-格式 | 关键字后加空格、逗号后加空格、运算符前后加空格等 |
| else/catch 未与 } 同行 | Minor | ArkTS 规范-格式 | `} else {`、`} catch {` 应在同一行 |
| 对象属性超过 4 个未换行 | Minor | ArkTS 规范-格式 | 对象字面量超过 4 个属性应统一换行 |
| 字符串使用双引号 | Minor | ArkTS 规范-格式 | 建议统一使用单引号 |
| 缩进层次不一致 | Major | ArkTS 规范-格式 | 同一文件内缩进风格必须统一 |

#### 2.3 编程实践（依据 ArkTS 编程规范-编程实践章节）

| 检查项 | 严重度 | 规范依据 | 说明 |
|--------|--------|----------|------|
| 类属性缺少可访问修饰符 | Minor | ArkTS 规范-实践 | 应明确标注 `private`/`protected`/`public` |
| 浮点数省略小数点前后 0 | Minor | ArkTS 规范-实践 | `.5` 应写 `0.5`，`2.` 应写 `2.0` |
| NaN 比较使用 `==` 而非 `Number.isNaN()` | Critical | ArkTS 规范-实践（要求级） | 必须使用 `Number.isNaN()` 判断 NaN |
| 数组遍历未使用 Array 方法 | Major | ArkTS 规范-实践（要求级） | 应优先使用 `forEach`/`map`/`filter` 等方法 |
| 控制条件中执行赋值 | Major | ArkTS 规范-实践（要求级） | 禁止在 if/while 条件中赋值 |
| finally 块中使用 return/break/throw | Critical | ArkTS 规范-实践（要求级） | finally 块必须正常结束 |
| 使用 ESObject 类型标注 | Major | ArkTS 规范-实践 | 非跨语言场景应避免 ESObject |
| 使用 `Array<T>` 而非 `T[]` | Minor | ArkTS 规范-实践 | 数组类型应统一使用 `T[]` 表示 |
| 使用 `as` 强制类型转换而非类型守卫 | Major | ArkTS 类型安全 | 应使用类型守卫（`typeof`/`instanceof`）而非 `as` |
| 魔法数字 | Major | 编码规范通用 | 硬编码数值未用常量定义 |
| 未使用变量/导入 | Minor | 编码规范通用 | 定义但未使用的变量或导入 |

#### 2.4 代码复杂度

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| 过深嵌套 | Major | if/for/try 嵌套超过 4 层 |
| 过长函数 | Major | 函数体超过 50 行 |
| 过长参数列表 | Minor | 函数参数超过 5 个 |
| God Class | Major | 单个类方法超过 15 个 |
| 过度耦合 | Major | 模块间高度耦合，职责不清 |
| 重复代码 | Major | 存在明显重复的代码块（超过 10 行相似代码） |
| 过长文件 | Minor | 单个源码文件超过 500 行 |

#### 2.5 ArkTS 特定规范（装饰器与 UI 模式）

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| @State/@Prop 使用不当 | Critical | 状态管理装饰器误用导致渲染异常或状态不一致 |
| @Entry/@Component 缺失 | Major | 页面/组件装饰器缺失或误用 |
| UI 生命周期误用 | Major | aboutToAppear/aboutToDisappear 使用不当或在非组件中使用 |
| @Builder 函数规范 | Minor | @Builder 函数不符合规范（参数传递、内部结构） |
| forEach 使用不当 | Major | 大数据列表渲染使用 forEach 而非 LazyForEach |
| @Watch 使用不当 | Minor | @Watch 监听回调未做防重入处理 |
| @Link/@Provide/@Consume 误用 | Major | 跨组件状态传递装饰器使用不当 |
| @Observed/@ObjectLink 缺失 | Major | 嵌套对象状态更新缺少 @Observed/@ObjectLink |

#### 2.6 架构模式

| 检查项 | 严重度 | 说明 |
|--------|--------|------|
| MVVM 遵循 | Major | 未遵循 MVVM 架构，数据与 UI 混合 |
| 职责划分 | Major | ViewModel/Model/View 职责混淆 |
| 依赖注入 | Minor | 硬编码依赖而非通过注入或接口 |
| 单例滥用 | Minor | 过度使用单例模式导致状态难以管理 |
| 组件拆分不足 | Major | 单个组件代码过多（超过 200 行）应拆分为子组件 |

### Phase 3：编码质量评分计算

基于检视结果进行**严苛评分**（0-100分），采用维度加权扣分制：

```
基础分 = 100

维度权重分配：
- 命名规范（权重 15%）：扣分上限 -15
- 格式规范（权重 15%）：扣分上限 -15
- 编程实践（权重 20%）：扣分上限 -20
- 代码复杂度（权重 15%）：扣分上限 -15
- ArkTS 特定规范（权重 25%）：扣分上限 -25
- 架构模式（权重 10%）：扣分上限 -10

每个维度内扣分规则：
- Critical 级别问题：每项 -8 分
- Major 级别问题：每项 -4 分
- Minor 级别问题：每项 -1 分

维度实际扣分 = min(扣分上限, Critical扣分 + Major扣分 + Minor扣分)

最终分 = max(0, 100 - 各维度实际扣分之和)
```

> **评分说明**：仅对库核心实现代码评分，example/demo/sample/test 代码不参与评分。

**评分标准说明**：
- 90-100 分：优秀，代码规范完善，架构清晰，无明显问题
- 80-89 分：良好，存在少量 Minor 问题，不影响整体质量
- 70-79 分：一般，存在 Major 级别问题需改进
- 60-69 分：较差，多个维度存在 Major 级别问题或架构混乱
- 50-59 分：严重不足，存在 Critical 级别问题或多项 Major 问题
- <50 分：极差，代码质量严重不足，需全面重构

### Phase 4：报告生成

在 `{outputDir}` 下生成 `编码质量检视报告.md`：

```markdown
# {repoName} 编码质量检视报告

## 一、检视概览

| 字段 | 内容 |
|------|------|
| **仓库名称** | {repoName} |
| **检视类型** | ArkTS 编码质量检视（核心实现） |
| **检视时间** | {timestamp} |
| **分析文件数** | {fileCount} |
| **编码规范依据** | 华为 ArkTS 编程规范 |
| **排除范围** | example/demo/sample/test 相关代码 |

## 二、综合评分

**综合评分：{score}/100**

评分等级：{grade}

## 三、各维度评分明细

| 检视维度 | 权重 | 扣分 | 维度得分 | Critical数 | Major数 | Minor数 |
|----------|------|------|----------|-----------|---------|---------|
| 命名规范 | 15% | {命名扣分} | {命名得分} | {c1} | {m1} | {n1} |
| 格式规范 | 15% | {格式扣分} | {格式得分} | {c2} | {m2} | {n2} |
| 编程实践 | 20% | {实践扣分} | {实践得分} | {c3} | {m3} | {n3} |
| 代码复杂度 | 15% | {复杂度扣分} | {复杂度得分} | {c4} | {m4} | {n4} |
| ArkTS 特定规范 | 25% | {ArkTS扣分} | {ArkTS得分} | {c5} | {m5} | {n5} |
| 架构模式 | 10% | {架构扣分} | {架构得分} | {c6} | {m6} | {n6} |

## 四、检视维度详情

### 4.1 命名规范
（逐项列出发现的问题，每项标注严重度、文件、行号）

### 4.2 格式规范
……

### 4.3 编程实践
……

### 4.4 代码复杂度
……

### 4.5 ArkTS 特定规范
……

### 4.6 架构模式
……

## 五、问题清单

| # | 文件 | 行号 | 严重度 | 检视维度 | 描述 | 修复建议 |
|---|------|------|----------|----------|------|----------|

## 六、改进建议

（按维度优先级排序，给出改进路线图）

---

**报告生成时间**：{timestamp}
```

> **重要**：报告必须包含 `**综合评分：XX/100**` 格式，且评分值位于"二、综合评分"章节，确保可被 `_parseArktsLibraryScore` 函数正确解析。评分正则匹配优先级为 `综合评分` > `总体评分/评分` > `得分`。

---

## 输出产物

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 编码质量检视报告 | `编码质量检视报告.md` | 各维度评分明细 + 问题清单 + 修复建议 |

---

## 评分权重

本 SKILL 在 ArkTS 仓库检视综合评分中权重为 **20%**。

---

## 与前置 SKILL 的衔接

本 SKILL 的输出 `编码质量检视报告.md` 将作为后置 SKILL `ArktsLibraryMemoryLeakCheckSkill`（第4阶段）的输入依赖。确保报告中的问题清单包含足够的定位信息（文件路径+行号），便于后续 SKILL 参考和综合报告汇总。