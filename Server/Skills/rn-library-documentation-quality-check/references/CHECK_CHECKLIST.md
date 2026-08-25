# 文档质量检视检查清单

本文件供 `rn-library-documentation-quality-check` 技能在 Phase 2 阶段参考使用，详细定义各维度的检查项和判定标准。

---

## 一、API 文档完整性检查

> **定位**：检查文档（README API 表/属性表、外部 usage-docs、`.d.ts` 声明、源码 TSDoc/JSDoc）中描述的**接口清单、类型、签名、平台标记、枚举值**是否与**接口规格说明书**一致。
>
> **与第七章的关系**：本章从"文档完整性"视角检查 API 是否被正确记录；第七章（XC）从"交叉验证"视角做强制复核。两者检查对象相同但目的互补，XC 章节可作为 AD 检查的兜底校验。

### 1.1 API 清单一致性

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| AD-001 | 文档 API/属性/参数在规格中不存在（幽灵接口/多列） | 从 README API 表/属性表/参数列表提取所有名称，逐一在规格说明书中检索 | Critical | README 列出 `Database.query()` 但规格无此方法；或文档多列 `onCustomEvent` 属性、多列 `callback` 参数 |
| AD-002 | 规格 API/类/接口/必选参数在文档中无描述 | 从规格说明书提取所有公开 API/类/接口/必选参数，逐一在文档中搜索 | Major | 规格定义 `configure(options)`/`SessionConfig` 接口/必选 `options` 参数，文档均未提及 |
| AD-003 | 文档 API 名称与规格拼写/大小写不一致 | 逐字对比文档 API 名与规格中的方法名 | Major | 文档写 `getSSID()`，规格为 `getWifiSSID()`；或 `insertText` vs `inserttext` |

### 1.2 类型与签名一致性

> 比对文档描述的参数类型、返回类型、联合类型、可选性、参数名/顺序/默认值是否与接口规格说明书一致。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| AD-004 | 文档参数类型/联合类型与规格不一致 | 对比文档参数类型与规格签名 | Major | 文档写 `type: string`，规格为 `type?: string \| number`；或文档写 `mode: string`，规格为 `mode: 'auto' \| 'manual'` |
| AD-005 | 文档返回类型与规格不一致 | 对比文档返回类型与规格定义 | Major | 文档写 `getConfig(): Config`，规格为 `getConfig(): Promise<Config>` |
| AD-006 | 文档遗漏 async/Promise 标注 | 检查文档标注为同步的方法在规格中是否为异步 | Critical | 文档写 `fetch(): State`，规格为 `fetch(): Promise<State>`，用户不 await 导致错误 |
| AD-007 | 文档可选性标注与规格不一致 | 对比文档标注的必选/可选与规格定义 | Minor | 文档写 `callback: Function`（必选），规格 `callback?: Function`（可选） |
| AD-008 | 文档参数名/顺序与规格不一致 | 对比文档参数名及顺序与规格签名 | Major | 文档写 `f(a, url)`，规格为 `f(b, uri)`，参数名和顺序均不同 |
| AD-009 | 文档参数默认值与规格不一致 | 对比文档标注的默认值与规格定义 | Minor | 文档写 `timeout = 5000`，规格 `timeout = 3000` |

### 1.3 平台支持标记准确性（HarmonyOS Support）

> 比对 README/外部文档 API 支持矩阵中的 HarmonyOS Support（Yes/No/Partial）标记与接口规格说明书的鸿蒙化差异是否一致。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| AD-010 | 文档标记 Yes 但规格标记为缺失 | 对比文档 Yes 标记与规格第 5.1 节缺失接口 | Critical | 文档标记 `WebViewNativeConfig` 为 Yes，规格标记为鸿蒙缺失 |
| AD-011 | 规格新增的鸿蒙特有 API 文档未标记/未描述 | 对比规格第 5.2 节新增接口与文档描述 | Major | 规格标记 `schemeList` 为新增🆕，文档未提及 |
| AD-012 | 文档标记 Partial 但未说明部分支持的范围 | 检查 Partial 标记是否说明不支持的具体子项/场景 | Major | 文档标 `ScrollView` 为 Partial 但未说明哪些属性不支持 |
| AD-013 | 文档平台支持矩阵与规格鸿蒙化差异整体不一致 | 对比文档 Yes/No/Partial 矩阵与规格第 5 章差异记录 | Major | 文档标记多个属性为 Yes 但规格记录为缺失或签名变更 |

### 1.4 属性/枚举/常量值完整性

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| AD-014 | 文档遗漏规格中的枚举成员/常量/配置项 | 对比规格枚举/常量与文档说明 | Major | 规格 enum 有 `A/B/C`，文档只列 `A/B`；规格有 `DEFAULT_TIMEOUT` 常量，文档未提及 |
| AD-015 | 文档枚举值/常量值与规格不一致 | 对比文档值与规格定义的值 | Major | 文档写 `ERROR = 1`，规格 `ERROR = 0` |

---

## 二、鸿蒙化适配说明检查

> **定位**：以 [MODEL.md](../assets/MODEL.md) 文档模板为基准，检查鸿蒙化适配说明文档中每个章节是否合理存在且内容完整。
>
> 其中"简介""使用示例""使用说明""接口说明""贡献代码""开源协议"等通用章节的质量检查分别由第一章（API 文档完整性）、第五章（代码仓基础信息）、第三章（代码示例质量）、第七章（交叉验证）覆盖。本章聚焦**鸿蒙化适配特有**的章节。

### 2.1 鸿蒙化适配说明整体存在性

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-001 | 缺少鸿蒙化适配说明 | 检查是否存在任何鸿蒙化适配相关文档（README 章节/独立文档/外部 usage-docs） | Critical | 无任何鸿蒙化适配文档 |

### 2.2 版本所属关系表格检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-002 | 缺少版本所属关系表格 | 检查文档头部是否存在版本信息表格 | Major | 文档无版本所属关系表格 |
| HA-003 | 版本表格列不完整 | 检查表格是否包含：库名称、版本、发布信息、支持RN版本、Autolink、编译API版本、社区基线版本、npm地址 | Major | 表格缺少"编译API版本"或"社区基线版本"列 |
| HA-004 | 鸿蒙化包名不规范 | 检查包名是否使用 `@react-native-ohos/` 或 `@react-native-oh-tpl/` 前缀 | Major | 包名使用原库名而非鸿蒙化前缀 |
| HA-005 | 未标记废弃版本 | 检查已废弃的旧版本是否标注 `@deprecated` | Minor | 旧版本仍列为推荐版本，未标注废弃 |

### 2.3 下载安装检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-006 | 缺少下载安装章节 | 检查是否存在"下载安装"章节 | Major | 无"下载安装"章节 |
| HA-007 | 安装命令包名错误 | 检查 npm/yarn install 命令是否使用鸿蒙化包名 | Major | 安装命令使用原库名而非 `@react-native-ohos/xxx` |
| HA-008 | 缺少多种安装方式 | 检查是否提供 npm 和 yarn 安装命令 | Minor | 仅提供 npm 命令无 yarn |

### 2.4 Link 检查

> **前置跳过条件**：检查 2.2 节版本表格中的 Autolink 列，若**所有版本均标记为"否"**，则跳过本节全部检查项（HA-009~HA-018），在报告中注明"该库所有版本均不支持 AutoLink，Link 章节不适用"。

**AutoLink 矩阵**

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-009 | 缺少 AutoLink 支持矩阵 | 检查 Link 章节是否包含 AutoLink 支持矩阵表格 | Major | 无 AutoLink 是否支持及对应 RN 版本的矩阵 |
| HA-010 | AutoLink 矩阵与版本表格不一致 | 对比 AutoLink 矩阵的版本/支持情况与文档头部版本表格 | Major | 版本表格标记某版本 Autolink=否，矩阵标记为是 |

**ManualLink 步骤**

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-011 | 缺少 ManualLink 配置说明 | 检查是否提供手动配置原生依赖项的指导 | Major | 无 ManualLink 步骤说明 |
| HA-012 | 缺少 Overrides RN SDK 配置 | 检查是否说明 oh-package.json5 中 overrides 字段配置 | Major | 未说明如何 overrides RN SDK 版本 |
| HA-013 | 缺少引入原生端代码说明 | 检查是否说明通过 har 包或源码引入原生端代码 | Major | 未说明 har 包路径或源码链接方法 |
| HA-014 | 缺少 CMakeLists 构建配置说明 | 检查是否说明 CMakeLists.txt 中 add_subdirectory 和 target_link_libraries 配置 | Major | 无 CMakeLists 配置说明或 diff 示例 |
| HA-015 | 缺少 PackageProvider 注册说明 | 检查是否说明 PackageProvider.cpp 中引入和注册 Package | Major | 未说明 PackageProvider 中如何注册原生 Package |
| HA-016 | 缺少 ArkTs 侧组件引入说明 | 若含混合方案组件，检查是否说明 ArkTs 侧引入组件和组件名注册 | Major | 未说明 buildCustomRNComponent 和 arkTsComponentNames 配置 |
| HA-017 | 缺少 ArkTs 侧 Package 引入说明 | 检查是否说明 RNPackagesFactory.ts 中引入和创建 Package | Major | 未说明 RNPackagesFactory 中如何创建 RN Package |

**运行**

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-018 | 缺少运行说明 | 检查是否提供 sync/ohpm install 及编译运行步骤 | Minor | 无运行说明 |

### 2.5 约束与限制检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-019 | 缺少约束与限制章节 | 检查是否存在"约束与限制"章节 | Major | 无"约束与限制"章节 |
| HA-020 | 缺少兼容性说明 | 检查是否说明验证通过的 RNOH/SDK/IDE/ROM 版本 | Major | 未说明兼容的 RNOH 或 SDK 版本 |
| HA-021 | 权限说明与实际声明不一致（双向比对） | 对比文档说明的权限与 module.json5 实际声明，双向检查：声明的权限未说明用途 / 文档说明的权限未声明 | Major | 声明了 `ohos.permission.INTERNET` 但文档未说明用途；或文档说明需要网络权限但 module.json5 未声明 |
| HA-022 | 缺少资源文件放置说明 | 若使用 rawfile 等资源，检查是否说明放置路径 | Minor | 未说明图片资源需放置到 rawfile 路径 |

### 2.6 遗留问题与目录结构检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-023 | 遗留问题章节缺失或未记录已知问题 | 检查是否存在"遗留问题"章节并记录已知问题及 issue 链接 | Minor | "遗留问题"章节为空、仅写"无"或不存在该章节 |
| HA-024 | 目录结构缺失或与实际不符 | 检查是否存在"目录结构"章节，并对比文档目录树与实际项目文件组织 | Minor | 文档列出 `harmony/lottie.har` 但实际不存在；或无"目录结构"章节 |

### 2.7 跳转文档完整性检查（跳转模式专属）

> 以下检查项仅在识别为"跳转文档模式"（README 指向 `OpenHarmony-RN/usage-docs`）时适用。内嵌文档模式不适用本节。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| HA-025 | 跳转文档链接失效或内容为空 | 检查外部 usage-docs 链接是否可访问且内容非空 | Critical | 外部文档链接 404 或页面内容空白 |
| HA-026 | 跳转文档未覆盖鸿蒙特有内容 | 检查外部文档是否包含鸿蒙化适配内容而非仅复制原库文档 | Major | 外部文档完全复制原库文档，无任何鸿蒙化内容 |
| HA-027 | 跳转文档缺少使用示例章节 | 检查外部 usage-docs 是否包含"使用示例"章节 | Major | 外部文档无"使用示例"章节 |
| HA-028 | 跳转文档缺少接口说明章节 | 检查外部 usage-docs 是否包含鸿蒙平台 API 支持矩阵（组件/属性/API 表格） | Major | 外部文档无"接口说明"或 API 属性表格 |

---

## 三、代码示例质量检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| EX-001 | 跳转文档示例与本地代码不一致 | 检查外部 usage-docs 中的示例代码与本地仓库源码接口签名是否匹配 | Major | 外部文档示例调用 `getSSID()`，但本地代码实际导出为 `getWifiSSID()` |
| EX-002 | 跳转文档示例 import 路径错误 | 检查外部 usage-docs 中示例的 import 是否使用正确的包名 | Major | 外部文档示例应从社区库导入 `import { Foo } from 'original-lib'`，不应为 `@react-native-ohos/original-lib` |

---

## 四、变更记录与版本规范检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| CL-001 | 缺少 CHANGELOG.md | 检查仓库是否存在变更记录文件 | Major | 无 `CHANGELOG.md` 或 `CHANGES.md` |
| CL-002 | CHANGELOG 未记录鸿蒙化变更 | 检查变更记录中是否标注鸿蒙化适配相关变更 | Major | CHANGELOG 有版本记录但无鸿蒙化条目 |
| CL-003 | 版本号不符合语义化版本规范 | 检查版本号是否遵循 semver 规范 | Major | 版本号 `1.2` 或 `v1.2.3-beta` 不符合 semver |
| CL-004 | 破坏性变更未标注 | 检查不兼容的 API 变更是否标注 BREAKING CHANGE | Major | 删除了公开 API 但未标注 BREAKING |
| CL-005 | CHANGELOG 格式不规范 | 检查是否使用 Keep a Changelog 格式 | Minor | 无标准格式，自由文本记录 |

---

## 五、代码仓基础信息检查

> **定位**：检查鸿蒙化仓库的**基础元数据规范性与链接正确性**——package.json 元数据、仓库链接地址、harmony 字段配置、发布配置、README 存在性、LICENSE 等基础文件完整性。
>
> **核心原则**：鸿蒙化仓库是独立维护的项目，package.json 中所有链接字段应指向当前 GitCode 仓库而非上游原库的 GitHub 地址。

### 5.1 README 存在性与基础结构

> 注意区分**内嵌文档模式**和**跳转文档模式**——跳转模式的 README 极简是设计选择，不应当作"内容缺失"扣分，转为检查外部 usage-docs 内容（见 2.7 节 HA-025~HA-028）。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| RM-001 | 缺少 README.md | 检查仓库根目录是否存在 `README.md` | Critical | 无 `README.md` 文件 |
| RM-002 | README 内容为空或仅有标题（内嵌模式） | 内嵌模式下检查 README 是否有实质内容 | Major | README 仅一行标题，无任何说明内容（非跳转模式） |
| RM-003 | 缺少 README_zh.md（中文文档） | 检查是否存在中文 README | Minor | 仅有英文 `README.md`，无 `README_zh.md` |
| RM-004 | README 基础章节不完整（内嵌模式） | 内嵌模式下检查是否包含：简介、下载安装、使用示例、接口说明、约束与限制、贡献代码、开源协议 | Major | 内嵌模式 README 缺少"约束与限制"或"使用示例"章节 |

> **跳转模式豁免**：若识别为跳转文档模式（README 含 `OpenHarmony-RN/usage-docs` 链接且内容极简），RM-002 和 RM-004 不适用，转为检查外部 usage-docs 内容完整性（见 2.7 节 HA-025~HA-028）。

### 5.2 package.json 描述与版本元数据

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| RM-005 | description 为空或缺失 | 检查 `description` 字段是否存在且为非空字符串 | Major | `"description": ""` 或无 description 字段 |
| RM-006 | license 缺失或不规范 | 检查 `license` 字段是否存在且符合 SPDX 标识符规范 | Major | 无 license 字段，或值为非标准文本 `"MIT License"` 而非 `"MIT"` |
| RM-007 | keywords 缺少鸿蒙相关关键词 | 检查 `keywords` 数组是否包含 harmony / ohos / openharmony / rnoh 等关键词 | Minor | keywords 仅含 `react-native`，无鸿蒙关键词 |
| RM-008 | version 与 oh-package.json5 不一致 | 对比 package.json 的 `version` 与 oh-package.json5 的 `version` 字段 | Major | package.json 为 `1.2.0`，oh-package.json5 为 `1.1.0` |
| RM-009 | name 未使用鸿蒙化前缀 | 检查 `name` 是否以 `@react-native-ohos/` 或 `@react-native-oh-tpl/` 开头 | Major | name 为 `react-native-webview` 而非 `@react-native-ohos/react-native-webview` |

> **注意**：RM-009 与 HA-004（版本表格中包名检查）互补——HA-004 检查文档中标注的包名，RM-009 检查 package.json 中实际的包名字段。

### 5.3 仓库链接地址检查（指向当前仓库而非上游）

> 鸿蒙化仓库是独立 Fork，package.json 中 `homepage`、`repository`、`bugs` 等链接字段及 README 中链接应指向当前 GitCode 鸿蒙化仓库，而非上游原库的 GitHub 地址。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| RM-010 | package.json 链接字段指向上游仓库 | 对比 `homepage`/`repository.url`/`bugs.url` 与当前仓库地址，若域名为 `github.com` 且路径不含当前仓库 owner/repo 则判定为指向上游 | Major | `"homepage": "https://github.com/xxx/original-lib"`，`"bugs": {"url": "https://github.com/xxx/original-lib/issues"}` |
| RM-011 | README/LICENSE 中链接指向上游 | 检查 README"贡献代码""开源协议"章节及 LICENSE 文件中的 Issue/PR/源码 tree/Releases 链接是否指向当前仓库 | Major | README 写 `[Issue](https://github.com/xxx/original-lib/issues)` 而非当前 gitcode 仓库 |

### 5.4 harmony 字段配置检查

> `harmony.alias` 应指向上游原库的 npm 包名，使 `import xxx from 'original-lib'` 能正确映射到鸿蒙化包。alias 必须等于上游 npm 包名（含 scope），而非鸿蒙化包名自身。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| RM-012 | 缺少 harmony 字段或 alias 缺失/为空 | 检查 package.json 是否存在 `harmony` 对象且 `harmony.alias` 为非空字符串 | Critical | 无 `harmony` 字段；或有 `harmony` 对象但无 `alias` 字段；或 `"alias": ""` |
| RM-013 | harmony.alias 与上游包名不一致 | 对比 `harmony.alias` 值与上游原库 package.json 的 `name` 字段（含 scope），检查是否指向自身包名或遗漏 scope | Critical | alias 为 `@react-native-ohos/react-native-webview`（自身包名），应为上游 `react-native-webview`；或 alias 为 `async-storage` 但上游实际为 `@react-native-community/async-storage` |

### 5.5 发布配置检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| RM-014 | 包设置为私有 | 检查 `package.json` 是否包含 `private` 且取值为 `true` | Major | 当前包为私有状态，无法发布 |
| RM-015 | 缺少 publishConfig 或 registry 配置错误 | 检查 `publishConfig` 是否配置了正确的发布 registry | Minor | 无 publishConfig 或 registry 指向非官方源 |

### 5.6 LICENSE 与其他基础文件检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| RM-016 | 缺少 LICENSE 文件 | 检查仓库根目录是否存在 `LICENSE` / `LICENSE.md` / `LICENSE.txt` 文件 | Major | 无 LICENSE 文件 |
| RM-017 | LICENSE 类型与 package.json license 字段不一致 | 对比 LICENSE 文件实际协议类型与 package.json `license` 字段 | Minor | LICENSE 文件为 Apache-2.0，package.json 写 `"MIT"` |
| RM-018 | 缺少 .gitignore | 检查是否存在 `.gitignore` 文件 | Minor | 无 .gitignore，`node_modules` 等可能被误提交 |
| RM-019 | 缺少 .npmignore 或 files 配置不当 | 检查是否通过 `.npmignore` 或 `files` 字段正确控制发布范围 | Minor | 无 files 也无 .npmignore，发布包含源码和测试文件 |
| RM-020 | 缺少 COMMITTERS.md | 检查仓库根目录是否存在 COMMITTERS 文件 | Major | 无 COMMITTERS.md |

---

## 六、文档准确性与国际化检查

> 本章检查文档的**通用准确性**和**国际化**，不重复第一章（AD）和第七章（XC）已覆盖的"文档 vs 规格/代码"逐接口比对，仅保留 AD/XC 未覆盖的通用维度。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| AC-001 | 文档与代码实现整体不一致 | 对比文档描述的接口签名、参数、行为与实际代码（非逐条比对，检查整体一致性） | Major | 文档写 `getConfig(): Config`，实际 `getConfig(): Promise<Config>` |
| AC-002 | 包含过时/错误信息 | 检查文档中的信息与当前版本是否相符 | Major | 文档写"使用 Legacy Bridge"，实际已迁移至 TurboModule |
| AC-003 | 缺少中文或英文文档（未提供双语本地化） | 检查是否同时提供中文和英文文档 | Minor | 仅有英文 README，无中文；或仅有中文无英文 |
| AC-004 | 术语翻译不准确 | 检查鸿蒙特有术语翻译是否规范 | Minor | "TurboModule" 翻译为"涡轮模块" |
| AC-005 | 文档截图与实际 UI 不符 | 检查文档中的截图是否与当前版本 UI 一致 | Minor | 截图为旧版界面 |
| AC-006 | 文档外部链接失效 | 检查文档中的外部链接（非跳转文档链接）是否可访问 | Minor | 引用的官方文档链接已失效 |

> **已移至其他章节的检查项**：API 不存在 → 见 AD-001；示例 import 路径 → 见 EX-002；版本号不一致 → 见 XC-012；跳转文档支持矩阵不符 → 见 AD-013。

---

## 七、文档与接口规格交叉验证检查

> 本维度为 Phase 2.5 强制环节。以 `接口规格说明.md` 为权威基准，与用户文档进行比对。
>
> **与第一章的关系**：第一章（AD）从"文档完整性"视角逐项检查；本章从"交叉验证"视角做双向强制复核。两者检查对象相同但目的互补。本章合并了方向性检查（规格→文档 / 文档→规格）以减少冗余。

### 7.1 接口规格文档可用性检查

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| XC-001 | 接口规格说明文档不存在 | 检查 `{outputDir}/接口规格说明.md` 是否存在 | Critical | 前置 SKILL 未执行，无接口规格说明文档 |

> 若 XC-001 命中，跳过后续 XC-002~XC-013 检查项，在报告中注明"前置接口规格文档缺失，无法进行交叉验证"。

### 7.2 接口清单双向比对（规格↔文档）

> 合并规格→文档和文档→规格两个方向的检查。每个方向发现的问题分别记录。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| XC-002 | 接口规格中的 API/类/TurboModule 方法在文档中无描述（规格→文档方向） | 从接口规格提取所有公开 API/类/TurboModule 方法，逐一在用户文档中搜索 | Major | 接口规格定义 `configure()`/`SessionConfig`/`getCurrentState()` 但文档均未提及 |
| XC-003 | 文档中描述的 API 或示例引用了接口规格中不存在的方法（文档→规格方向） | 从用户文档提取所有 API 名称，在接口规格中搜索；检查示例中的方法调用是否在规格中有定义 | Critical | 文档描述 `Database.query(sql)` 或示例调用 `NetInfo.getConnectionInfo()` 但接口规格无此方法 |
| XC-004 | 文档方法名与接口规格不一致 | 对比文档 API 名称与接口规格中的方法名 | Major | 文档写 `getSSID()`，接口规格为 `getWifiSSID()` |

### 7.3 签名与类型比对

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| XC-005 | 文档参数/返回类型与接口规格不一致 | 对比文档中的参数名/类型/返回类型与接口规格中的签名 | Major | 文档写 `fetch(type: string)`，接口规格为 `fetch(type?: string)`；文档写 `getConfig(): Config`，接口规格为 `getConfig(): Promise<Config>` |
| XC-006 | 文档遗漏 async/Promise 标注 | 检查文档描述的同步方法在接口规格中是否为异步 | Critical | 文档写 `fetch(): NetInfoState`，接口规格为 `fetch(): Promise<NetInfoState>` |
| XC-007 | 文档参数可选性/默认值与接口规格不一致 | 对比文档中标注的必选/可选参数及默认值与接口规格定义 | Minor | 文档写 `callback: Function`（必选），接口规格 `callback?: Function`（可选）；文档写 `timeout = 5000`，接口规格 `timeout = 3000` |

### 7.4 鸿蒙化差异与文档一致性

> 接口规格说明文档第 5 章记录了鸿蒙化差异（缺失接口、新增接口、签名变更）。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| XC-008 | 接口规格标记为"缺失"的 API，文档仍标记为支持 | 对比接口规格第 5.1 节缺失接口与文档中的支持状态 | Critical | 接口规格标记 `WebViewNativeConfig` 缺失，外部文档标记 Yes |
| XC-009 | 接口规格标记为"新增"的 API，文档未描述 | 对比接口规格第 5.2 节新增接口与文档描述 | Major | 接口规格标记 `schemeList` 新增🆕，文档未提及 |
| XC-010 | 接口规格记录的签名变更在文档中未反映 | 对比接口规格第 5 章签名差异与文档描述 | Major | 接口规格记录 `OverScrollModeType` 缺少 'content' 值，文档未标注 |

### 7.5 配置与版本比对

> 权限检查已在第二章 HA-021 覆盖，此处不再重复。本节聚焦配置步骤和版本号的一致性。

| # | 检查项 | 检查方法 | 严重度 | 不匹配示例 |
|---|--------|---------|--------|-----------|
| XC-011 | 文档描述的配置步骤与实际项目结构不匹配 | 对比文档中的 CMakeLists/PackageProvider 步骤与实际文件 | Major | 文档写"修改 CMakeLists.txt"但项目使用 build-profile.json5 |
| XC-012 | 文档版本号与接口规格/package.json 不一致 | 对比用户文档中标注的版本号与接口规格第 1 章版本号、package.json/oh-package.json5 版本号 | Major | 文档写 v1.0.0，接口规格记录 1.2.0，package.json 版本为 1.2.0 |
| XC-013 | 文档描述的最低 API Version 与代码要求不一致 | 对比文档声明的 API Version 与 module.json5 中的配置 | Minor | 文档写 API 9+，module.json5 配置 API 10 |

---

## 八、检查结果判定规则

### 8.1 严重度定义

| 严重度 | 单项扣分 | 定义 | 典型场景 |
|--------|----------|------|----------|
| Critical | -8 | 文档严重缺失导致用户无法使用核心功能 | 核心 API 无任何文档、示例使用已废弃 API |
| Major | -4 | 文档缺失或不规范，影响用户理解和使用 | 缺少参数说明、缺少安装步骤、版本不一致 |
| Minor | -1 | 文档轻微不规范，不影响功能使用 | 格式不统一、缺少许可证链接 |

### 8.2 归零规则

- 文档完全空白（无 README、无 API 注释、无任何示例）→ 文档质量评分直接 **0 分**
- 核心 TurboModule/NAPI 接口无任何文档说明 → 文档质量评分直接 **0 分**

### 8.3 评分计算

```
基础分 = 100

维度权重与扣分上限：
- API 文档完整性（权重 20%）：扣分上限 -20
- 鸿蒙化适配说明（权重 20%）：扣分上限 -20
- 代码示例质量（权重 10%）：扣分上限 -10
- 变更记录与版本规范（权重 10%）：扣分上限 -10
- 代码仓基础信息（权重 15%）：扣分上限 -15
- 文档与代码交叉验证（权重 15%）：扣分上限 -15
- 文档准确性与国际化（权重 10%）：扣分上限 -10

每个维度内扣分规则：
- Critical 级别问题：每项 -8 分
- Major 级别问题：每项 -4 分
- Minor 级别问题：每项 -1 分

维度实际扣分 = min(扣分上限, Critical扣分 + Major扣分 + Minor扣分)

最终分 = max(0, 100 - 各维度实际扣分之和)
```

### 8.4 评分等级说明

| 分数范围 | 等级 | 说明 |
|----------|------|------|
| 90-100 | 优秀 | 文档完善，API 注释规范，适配说明详尽，示例丰富 |
| 80-89 | 良好 | 文档基本完整，存在少量 Minor 问题 |
| 70-79 | 一般 | 存在 Major 级别缺失，部分 API 缺少文档 |
| 60-69 | 较差 | 多个维度存在 Major 问题，用户使用困难 |
| 50-59 | 严重不足 | 核心文档缺失，Critical 级别问题存在 |
| <50 | 极差 | 文档几乎不可用，需全面补充文档 |

### 8.5 批量判定简化规则

- 同一文件中多个同类 Minor 问题（如多个方法缺少 `@since`）可合并为一条记录，但在问题清单中列出所有涉及的文件和方法名
- 同一 API 的多个检查项均为 Critical 时，取最高严重度记录一次，其余在描述中注明
- 同一示例代码存在多个静态问题时，每个问题作为单独行记录
