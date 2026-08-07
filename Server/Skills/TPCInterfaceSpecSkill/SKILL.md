---
name: tpc-interface-spec
description: 扫描提取鸿蒙三方库源码中对外公开的方法级接口与接口签名，解析 Index.ets 导出链生成接口规格文档，涵盖导出类、方法和函数。只分析对外公开导出项，输出完整接口签名（含参数、返回值、JSDoc）。当需要对鸿蒙三方库进行方法级接口规格提取、接口签名清单生成、Index.ets 导出链分析时调用。
license: Apache-2.0
compatibility: 适用于鸿蒙三方库工程（含 library 模块和 Index.ets 入口文件）。需要 git 命令行工具。
metadata:
  author: AIWeb
  version: "2.0.0"
  category: harmonyos-development
  language: ArkTS/ETS
  useWhen: 需要从源码（Index.ets 导出链）提取方法级接口规格或接口签名时；输入是源码或仓库
---

# TPC 鸿蒙三方库方法级接口规格提取

本 Skill 先克隆三方库源码到本地，然后通过源码静态分析提取所有对外公开导出的方法级接口，自动生成标准化的接口规格说明文档。

> ⚠️ **核心原则：只分析对外公开导出的接口，不关注内部实现细节。所有输出内容必须来自实际源码，禁止推断或捏造任何接口、参数、类型或功能描述。**

- ✅ 只提取 `public`、`export`等关键字标记的公开接口
- ❌ 不分析 `private`、`protected`、`internal`、包级私有成员
- ❌ 不分析内部实现类、内部函数、内部变量
- ❌ 不分析底层实现细节（如Native 代码、内部算法）
- ✅ 生成的是"接口规格"，而非"实现规格"

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `repoUrl` | ✅ | 鸿蒙三方库 Git 地址（如 `https://gitcode.com/CPF-ApplicationTPC/imageknifepro`） |
| `outputDir` | ✅ | 输出目录绝对路径（如 `/path/to/db/tpccoverage/imagenifepro_20260714`） |
| `repoName` | ✅ | 仓库名称（含时间戳），用于目录命名 |
| `libraryName` | ✅ | 库名称（从 URL 解析） |
| `reportPath` | ✅ | 报告文件绝对路径（由本 SKILL 从零创建） |

---

## 核心规则

- ✅ 提取 `export` 关键字标记的公开接口：`export class`、`export function`、`export const/let`、`export interface`、`export type`、`export default`
- ✅ `export { X } from './path'` 和 `export * from './path'` 是**转发导出**，须递归追踪到源文件提取原始定义
- ❌ 不分析 `private`、`protected`、以 `_` 或 `#` 开头的成员，以及 `import` 语句
- ❌ **枚举（`export enum`）不算对外接口**——枚举是类型定义，非可调用的 API，不纳入接口统计
- ❌ **构造函数（`constructor(...)`）不算对外接口**——构造函数是类的实例化机制，非可调用的 API，不纳入接口统计
- ❌ **struct 组件**（`@Component`/`@ComponentV2` 装饰的 struct）：**只提取公开成员属性，排除所有方法**——`aboutToAppear`/`aboutToDisappear`/`aboutToRecycle`/`build`/`getDefaultContext`/`@Watch` 触发的 `watchXxx()`/`@Monitor` 触发的 `monitorXxx()` 等生命周期回调和状态监听回调由框架自动调用，非用户 API
- **转发导出追踪深度**：从 Index.ets 出发沿 `export ... from` 链递归，**最大 3 层**，遇到循环依赖立即停止
- **Native 模块导出**（`export * from '*.so'`）：读取对应 `.d.ets` 类型声明文件，提取 `export const function` 和 `export class`，列入报告独立章节，**不计入 ArkTS 接口总数**

---

## 工作流程

### 步骤 1：克隆仓库源码

**目标：** 将鸿蒙三方库源码克隆到本地

**执行步骤：**
1. 在 `outputDir` 目录下执行 `git clone`：
   ```bash
   git clone --depth=1 {{repoUrl}} {{outputDir}}/source
   ```
2. 如果克隆失败，尝试 `--config http.proxy=...` 代理或去掉 `--depth=1`
3. 源码路径为 `{{outputDir}}/source`

> ⚠️ 如果克隆失败，必须在报告末尾标注 `状态: 失败` 并说明原因。

---

### 步骤 2：读取 README 了解库概述

1. 优先读 `README_zh.md`（中文版），若不存在再读 `README.md`。禁止同时读取双语版本。
2. 读取库的 README.md 或文档文件，提取：
- 库的名称
- 库的功能描述
- 主要特性
- 使用限制和注意事项

---

### 步骤 3：定位库的入口文件与 Native 声明文件

1. 用 `list_dir` 列出 `{{outputDir}}/source` 的顶级目录
2. 确认 library 目录存在后，**仅确认 Index.ets 路径存在，不读取其内容**（用 `glob` 或 `list_dir` 验证文件存在即可）。Index.ets 的内容解析统一由步骤 4a 承接，避免本步骤与 4a 重复读取同一文件：
   - 先确认 `{{outputDir}}/source/library/Index.ets`
   - 上一路径不存在时再确认 `{{outputDir}}/source/library/src/main/ets/Index.ets`
3. 读取 `{{outputDir}}/source/library/oh-package.json5`，提取 `"name"` 字段作为库名
4. **定位 Native 声明文件**：用 `glob` 搜索 `library/src/main/cpp/types/*/index.d.ets`，记录实际路径供步骤 4 使用。标准路径模式为 `library/src/main/cpp/types/{模块名}/index.d.ets`，模块名通常为 `libentry` 但可能因库而异。
   > 注意：Index.ets 中是否实际包含 `export * from '*.so'` 的判断，留待步骤 4a 读取 Index.ets 时确认；本步骤仅预先 glob 定位 `.d.ets` 路径备用，若 glob 无结果则在 4a 确认无 Native 导出。

---

### 步骤 4：解析 Index.ets → 构建导出清单

> ⚠️ **这是最关键的一步，决定了接口数量是否准确一致。**

**4a. 读取 Index.ets，逐行解析所有导出项**

用 `read_file` 读取 Index.ets，**逐行**识别以下模式：

| 行模式 | 处理方式 |
|--------|----------|
| `export { X, Y } from './path'` | 记录 X、Y，追踪到 `./path` 对应源文件 |
| `export * from './path'` | 读取 `./path` 对应源文件，取其所有 `export` 项 |
| `export * as X from './path'` | 记录命名空间 X，追踪到 `./path` |
| `export class Xxx` | 直接记录类 Xxx |
| `export function xxx` | 直接记录函数 xxx |
| `export const xxx` | 直接记录常量 xxx |
| `export interface Xxx` | 直接记录接口 Xxx |
| `export type Xxx` | 直接记录类型 Xxx |
| `export enum Xxx` | 直接记录枚举 Xxx |
| `export default Xxx` | 记录默认导出 Xxx |

**4b. 递归追踪转发导出（深度 ≤ 3 层）**

对每个 `export { ... } from './path'` 或 `export * from './path'`：

1. 解析 `./path` 为实际文件路径（相对 Index.ets 所在目录），ArkTS 源文件扩展名为 `.ets`，自动补全（如 `from './model/ImageKnifeData'` → `model/ImageKnifeData.ets`）

2. 读取源文件，提取所有 `export` 声明（class/function/const/interface/type/enum）。对类/struct/接口/枚举定义文件，**必须完整读取主体**（从声明行到闭合 `}`），不可截断，以确保属性和方法的 JSDoc 注释不丢失

3. **读取后立即在 AI 工作上下文中以表格草稿形式记录**每个 export 声明的完整签名，供步骤 5 直接格式化输出。草稿须包含：类名、装饰器（`@Observed`/`@ObservedV2`/`@Component`）、公开方法（含 `static`）、公开属性（带 `@Trace` 的须标注）、interface/class 区分、函数签名，以及每个属性/方法/字段的功能描述来源（JSDoc 或行注释，无则记空）。**构造函数和枚举不纳入接口统计。**

3a. **组件装饰器交叉记录**：对 struct 组件中带 `@ObjectLink`/`@Prop`/`@Link`（V1 装饰器）的属性，草稿中额外记录：属性类型 → 回溯类定义 → 检查 `@Observed` → 标注兼容性（✅/❌）。供步骤 6 生成第 5 章表格。

4. 如果又遇到 `export { ... } from`，继续递归（深度 +1），达到深度 3 或遇到循环依赖时停止

> ⚠️ 步骤 5 禁止再次 read 任何源文件，仅基于 4b 草稿做分类整理。若 4b 草稿缺失某项，回到 4b 补读该文件对应类体。

**4c. 构建最终导出清单**

将以上步骤收集到的所有导出项汇总为一个清单：

```
类：ImageKnife (@Observed), ImageKnifeOption (@Observed), ImageKnifeOptionV2 (@ObservedV2), ...
函数：getExpandSafeArea, ...
接口（interface，不可 new）：HeaderOptions, HttpRequestOption, OnLoadCallBack, ...
class（非 interface，可 new）：DnsOption, StaticDnsRuleItem, ResizableOption, ...
常量：VERSION, ...
Native 导出：createNativeRoot, initFileCache, ...（单独章节，不计入 ArkTS 接口总数）

> ⚠️ **interface 与 class 必须分开列出**，下游 Demo 代码生成依赖此区分：interface 不能 `new`（用对象字面量），class 可以 `new`。
```

> ⚠️ **禁止在此清单中添加任何未在 Index.ets 导出链中出现的项，也禁止遗漏 Index.ets 中明确导出的任何项。如有 `export * from '*.so'`，取其 `.d.ets` 中所有 `export const function` 和 `export class` 归入 Native 清单。**

**4d. 清单汇总（强制，不可跳过）**

完成导出清单后，确认各分类均已收集完毕。**本步骤不要求手工计数**——精确计数由步骤 7 用 grep 完成：

- 类（export class / struct 组件）：列出所有类名
- 接口/类型（export interface / type）：列出所有类型名
- 函数（export function）：列出所有函数名
- 变量/常量（export const/let）：列出所有变量名
- Native 导出（export * from '*.so'）：记录 `.d.ets` 路径

> ⚠️ {N}（方法级总数）和 {M}（Native 数量）的精确值在步骤 7 用 grep 计算，**禁止在本步骤估算任何数字**。

---

### 步骤 5：整理详细信息（基于 4b 草稿，禁止再读源文件）

> ⚠️ 本步骤禁止再次 read 任何源文件。所有信息须直接引用步骤 4b 草稿，仅做分类整理与格式化为报告表格。若 4b 草稿缺失某项，回到 4b 补读后再继续。

对清单中的每一项，从草稿中提取详细信息并格式化：

- **类**：类名、装饰器（`@Observed`/`@ObservedV2`/`@Component`）、公开方法（含 `static` 标注）、公开属性（带 `@Trace` 的须标注）。**构造函数（`constructor(...)`）不纳入接口统计**
  - **struct 组件**（`@Component`/`@ComponentV2`）：**只提取公开成员属性，排除所有方法**。成员装饰器（`@ObjectLink`/`@Prop`/`@Param`/`@Require`）内联到功能描述列括号中，struct 小节标题格式为 `ClassName（struct 组件）`
- **接口/类型**：名称、类型种类标注（`interface` 不可 `new`，`type` 是类型别名）、字段列表（字段名、类型、是否可选）、泛型参数
  > ⚠️ **interface vs class 必须标注**：interface 不能 `new`（用对象字面量），class 可以 `new`。下游 Demo 代码生成依赖此区分。
- **函数**：函数名、参数列表（参数名、类型、是否可选、默认值）、返回值类型
- **变量/常量**：变量名、变量类型

**功能描述提取优先级**：JSDoc `/** */` 注释（优先）→ `//` 行注释（次选）→ 源码均无注释时填 `-`。禁止填"属性"、"方法"等无意义占位符。

---

### 步骤 6：生成报告

> ⚠️ **先写正文，后补摘要。** 报告正文（第 1~10 章）写完后，摘要行用 `{PENDING}` 占位，末尾暂不标注 `状态: 成功`。精确计数由步骤 7 用 grep 计算后替换。

**报告格式如下：**

```markdown
# {库名} 接口规格说明

> **{PENDING}**

## 1. 三方库概述

{从 README 提取的功能描述}

## 2. 入口文件与分析范围

**入口文件：** `library/Index.ets`（或实际路径）

**分析涉及的源文件：**
- `library/src/main/ets/components/Main.ets`
- `library/src/main/ets/utils/LogUtil.ets`
- ...（仅列出实际读取并分析的文件，不猜测）

## 3. 对外导出的类

### 3.1 ClassNameA `@Observed`

> 装饰器：`@Observed`（V1 状态管理，Demo 可用 @State/@Link 等 V1 装饰器）

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | ClassNameA | methodName(param: type): returnType | 方法功能描述 |
| 2    |            | static staticMethod(param: type): returnType | 静态方法描述 |
| 3    |            | @Trace propertyName: type | 属性描述（标注 @Trace 装饰器） |

### 3.2 StructComponentName（struct 组件）

> 装饰器：`@Component`/`@ComponentV2`（struct 组件，UI 组件）

> ⚠️ **struct 组件只列公开成员属性，不列方法**：生命周期回调和状态监听回调由框架自动调用，非用户 API，排除不列。成员装饰器（`@ObjectLink`/`@Prop`/`@Param`/`@Require`）标注在功能描述列括号中。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | StructComponentName | propertyName: type | 功能描述（必填，@ObjectLink） |
| 2    |                     | optionalProp?: type | 功能描述（@Prop） |

## 4. 对外导出的接口/类型

### 4.1 InterfaceNameA (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | InterfaceNameA | interface | field1 | string | 是 | 字段描述 |
| 2    |                |          | field2? | number | 否 | 可选字段描述 |

## 5. UI 组件装饰器兼容性

本节列出对外导出的 @Component/@ComponentV2 struct 组件的装饰器约束，
标注其 V1 装饰器属性（@ObjectLink/@Prop/@Link）与关联类的兼容性。
下游 Demo 代码生成阶段据此预检组件是否可直接使用。

| 组件名 | 源文件 | 属性装饰器 | 属性名 | 属性类型 | 关联类装饰器 | 兼容性 |
|-------|--------|----------|--------|---------|------------|--------|
| ComponentName | components/ComponentName.ets | @ObjectLink | optionProperty | OptionClass | 无 | ❌ |
| ComponentNameV2 | components/ComponentNameV2.ets | @Param | optionProperty | OptionClassV2 | @ObservedV2 | ✅ |

## 6. 对外导出的函数

| 序号 | 函数名称 | 返回值 | 参数列表 | 功能描述 |
|------|----------|--------|----------|----------|
| 1    | functionName | returnType | param1: type1, param2?: type2 | 功能描述 |

## 7. 对外导出的变量/常量

| 序号 | 变量名称 | 变量类型 | 功能描述 |
|------|----------|----------|----------|
| 1    | VERSION  | string   | 版本号 |

## 8. Native 模块导出

> 以下接口通过 `export * from 'libxxx.so'` 导出，为 C/C++ 原生模块的类型声明。

| 序号 | 导出名称 | 类型 | 参数 | 返回值 | 功能描述 |
|------|----------|------|------|--------|----------|
| 1    | nativeFunc | const function | param: Type | ReturnType | 功能描述 |
| 2    | NativeClassName | class | — | — | Native 类型声明（来自 index.d.ets） |

## 9. 注意事项

{从以下来源提取注意事项，覆盖以下类别：}
- **API 版本限制**：如某属性/方法在特定 API 版本以下不生效
- **不支持能力**：如某组件不支持逐帧解码、HDR、隐式动画等
- **内存管理**：如 PixelMap 使用后需调用 release 释放
- **安全风险**：如 skipValidation=true 会跳过 HTTPS 证书校验
- **使用约束**：如 syncLoad 建议只用于本地小图片、customId 不要使用纯数字

> 来源优先级：README 使用说明/约束小节 > 源码 JSDoc 注释（`/** */`）中的 API 约束 > 源码行注释（`//`）中的性能/内存警告 > 组件能力边界说明

---
{PENDING}
```

> ⚠️ 报告末尾写 `{PENDING}` 而非 `状态: 成功`，待步骤 7 验证后替换。

---

### 步骤 7：计数验证与摘要行补写（强制，不可跳过）

> ⚠️ **用 grep 精确计数，禁止凭记忆或目测。** 验证通过后替换报告中的 `{PENDING}` 为正确数值并标注 `状态: 成功`。

**7a. 统计报告数据行总数**

```bash
# 统计报告中所有表格数据行（以 | 数字 | 开头）
TOTAL=$(grep -cE "^\| \d+\s+\|" {{reportPath}})
echo "TOTAL=$TOTAL"
```

> 此命令匹配所有以 `| 1    |` 格式开头的表格数据行，不匹配 `| 序号 |` 等表头行。

**7b. 统计 Native 模块导出数量**

```bash
# 方式1：从源码 .d.ets 统计（主校验）
M=$(grep -cE "^export (const|class)" {{outputDir}}/source/library/src/main/cpp/types/libentry/index.d.ets)

# 方式2：从报告第 8 章统计（交叉校验）
M2=$(sed -n '/^## 8\./,/^## 9\./p' {{reportPath}} | grep -cE "^\| \d+\s+\|")

echo "M=$M (d.ets)  M2=$M2 (report)"
```

> M 必须 == M2。如 `.d.ets` 路径不同，按实际路径执行。若库无 Native 导出（Index.ets 中无 `export * from '*.so'`），则 M=0，跳过本步。

**7c. 计算 ArkTS 方法级总数 N**

```bash
N=$((TOTAL - M))
echo "N=$N (TOTAL=$TOTAL - M=$M)"
```

**7d. 统计类级数量 C / I / F / V（用于摘要行明细）**

```bash
# 类数量（第 3 章小节标题）
C=$(grep -cE "^### 3\.\d+" {{reportPath}})
# 接口数量（第 4 章小节标题）
I=$(grep -cE "^### 4\.\d+" {{reportPath}})
# 函数数量（第 6 章数据行）
F=$(sed -n '/^## 6\./,/^## 7\./p' {{reportPath}} | grep -cE "^\| \d+\s+\|")
# 变量数量（第 7 章数据行）
V=$(sed -n '/^## 7\./,/^## 8\./p' {{reportPath}} | grep -cE "^\| \d+\s+\|")

echo "C=$C I=$I F=$F V=$V"
S=$((C + I + F + V))
echo "S=$S"
```

> 如果库无某类导出（如第 5 章只有"无"），对应 grep 结果为 0。

**7e. 元信息标注核对（interface/class 区分 + 装饰器 + struct 排除）**

| 核对项 | grep 命令 | 期望 |
|--------|-----------|------|
| interface 标注 | `grep -c "(interface)" {{reportPath}}` | == I |
| class 标注 | `grep -c "(class)" {{reportPath}}` | ≥ 第 3 章非 struct 类数 |
| struct 标题标注 | `grep -c "（struct 组件）" {{reportPath}}` | == struct 组件数 |
| 无遗漏方法 | `grep -cE "aboutToAppear\|aboutToDisappear" {{reportPath}}` | == 0 |
| 组件装饰器表 | `grep -cE "^\| \w+\s+\|" {{reportPath}}`（第 5 章数据行） | == struct 组件数 |

> 若某项不通过，回到步骤 5 补充标注后重新生成报告，再执行步骤 7。

**7f. 补写摘要行并标记成功**

所有校验通过后，用 `sed` 替换报告中的占位文本：

```bash
# 构造摘要行
SUMMARY="> **ArkTS 类级总数 S = $S，方法级总数 N = $N，Native 导出 M = $M**"

# 替换 {PENDING} 为正确数值
sed -i "s/^> \*\*{PENDING}\*\*/$SUMMARY/" {{reportPath}}

# 标注状态: 成功
sed -i "s/{PENDING}/状态: 成功/" {{reportPath}}

echo "验证通过: S=$S N=$N M=$M"
```

> **验证未全部通过前，禁止执行 7f。** 若 grep 数量与步骤 4d 清单条目数不一致，以 grep 为准，检查报告是否有遗漏或多余的表格行。

---

## 注意事项

1. **只关注 Index.ets 导出链内的项**：不在 Index.ets 及其转发链中的 export 不算对外接口
2. **保留原始类型语法**：ArkTS 泛型、联合类型、交叉类型等保留原始写法，不简化；类型不明确时标注为 `any` 或 `unknown`
3. **Native 导出识别**：`export * from '*.so'` → 读取 `index.d.ets`，归入「Native 模块导出」独立章节，**不计入 ArkTS 接口总数**
4. **克隆失败处理**：若 git clone 失败，在报告中说明原因并标注 `状态: 失败`
5. **grep 驱动计数**：步骤 4d 不填数量，步骤 6 用 `{PENDING}` 占位，步骤 7 用 grep 精确统计后补写摘要行。{N} 为方法级总数，下游 Skills 覆盖率计算基于此值。
