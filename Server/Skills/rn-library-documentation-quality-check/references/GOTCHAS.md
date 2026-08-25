# 常见陷阱（Gotchas）

> 本文件记录 `rn-library-documentation-quality-check` 技能在检视过程中容易踩坑的场景和注意事项。

---

## 一、接口与命名陷阱

| 陷阱 | 说明 | 影响 |
|------|------|------|
| **TurboModule Spec 接口归零判定** | `.d.ts` 中 `Spec extends TurboModule` 接口完全无注释时触发归零，但若 README 有该 API 的用法说明则不触发——需同时检查源码注释和 README 描述 | 归零规则误判 |
| **`delete` 是 JS 保留字** | 源码 `export { delete }` 合法，README 可能写作 `axios.delete()` 或 `axios.del()` | 方法名比对误报 |
| **命名导出 vs 默认导出** | `export { lottie }` 是命名导出，示例必须用 `import { lottie }` 而非 `import lottie`，这是最常见的示例 Blocker | 示例质量误判 |
| **`@react-native-ohos/` 前缀** | 鸿蒙化包名通常以 `@react-native-ohos/` 开头，README 示例可能使用原库名导致 import 路径错误 | 示例 import 检查 |

## 二、ArkTS 与鸿蒙特有陷阱

| 陷阱 | 说明 | 影响 |
|------|------|------|
| **ArkTS 严格模式** | ArkTS 比 TS 更严格（不允许 `any`、强制类型标注），示例代码需以 ArkTS 规范为准 | 示例质量评估偏差 |
| **Codegen 配置** | TurboModule 库需在 `react-native.config.js` 中配置 Codegen，该文件无说明是常见遗漏 | 适配说明遗漏 |
| **module.json5 不是 JSON** | 允许注释和尾逗号，不能按严格 JSON 解析 | 解析报错 |

## 三、版本与变更陷阱

| 陷阱 | 说明 | 影响 |
|------|------|------|
| **版本号多处不一致** | package.json、oh-package.json5、README、CHANGELOG 中的版本号可能不一致，需交叉对比 | 版本规范误判 |
| **CHANGELOG 未记录鸿蒙化变更** | CHANGELOG 存在但仅含原库版本历史，无鸿蒙化适配条目是常见遗漏 | 变更记录遗漏 |
| **文档描述的 API 可能是旧版签名** | 代码重构后 API 签名变更但文档未同步更新，这是最常见的准确性问题，必须通过交叉验证环节发现 | 交叉验证遗漏 |

## 四、异步与类型陷阱

| 陷阱 | 说明 | 影响 |
|------|------|------|
| **async/Promise 返回类型遗漏** | 文档写 `getConfig(): Config` 但代码实际为 `getConfig(): Promise<Config>`，这是最常见的签名不一致模式 | 签名比对误报 |
| **示例代码未处理异步** | TurboModule 方法多为 Promise 返回，示例未 await 是常见 Major 问题 | 示例质量扣分 |
| **可选参数差异** | 文档写 `callback: Function` 但代码签名 `callback?: Function`（可选性未标注），或反向文档标注可选但代码实际必选 | 参数比对误报 |

## 五、跳转文档模式陷阱

| 陷阱 | 说明 | 影响 |
|------|------|------|
| **跳转文档模式误判为"文档缺失"** | 跳转模式的 README 极简是设计选择，不应直接扣分为 RM-002/RM-004，应转而检视外部 usage-docs 内容完整性 | 评分严重偏差 |
| **跳转文档链接指向统一仓库** | `OpenHarmony-RN/usage-docs` 是集中式文档仓库，一个库的文档对应 `zh-cn/{库名}.md` 和 `en/{库名}.md`，需分别获取中英文版本 | 文档获取遗漏 |
| **跳转文档可能未同步更新** | usage-docs 仓库的文档可能滞后于代码仓库更新，需通过 Phase 2.5 交叉验证环节强制比对（XC-001/XC-006） | 文档过时未发现 |
| **跳转文档的库名映射** | URL 中的库名是原库名（如 `react-native-network-info`），不是鸿蒙化包名（如 `@react-native-ohos/react-native-network-info`），提取时需去掉 `@org/` 前缀和版本号 | URL 构造错误 |
| **跳转文档接口支持矩阵过时** | 外部 usage-docs 的 Yes/No/Partial 标记可能基于旧版代码，需与接口规格说明文档中的鸿蒙化差异（第 5 章）逐项比对 | 支持矩阵不准 |
| **rndocUrl 优先使用** | 当任务参数传入 rndocUrl 时，跳转模式下应优先使用 rndocUrl 下载文档，而非从 README 提取链接或构造标准 URL。rndocUrl 通常是用户确认过的正确文档地址，可靠性最高 | 文档获取失败 |

## 六、交叉验证陷阱

| 陷阱 | 说明 | 影响 |
|------|------|------|
| **接口规格说明文档是权威基准** | 由 `RNLibraryInterfaceAnalyzer` 从上游原库和鸿蒙化仓库双仓库提取生成，已包含完整 API 清单和鸿蒙化差异，交叉验证时直接使用，无需再从源码逐条提取 | 重复工作 |
| **接口规格说明文档缺失时无法交叉验证** | 若 `{outputDir}/接口规格说明.md` 不存在（前置 SKILL 未执行），记录为 XC-001 Critical，跳过交叉验证环节，在报告中注明 | 交叉验证跳过 |
| **内嵌文档模板版本** | 内嵌模式的 README 通常遵循模板格式（如 `模板版本：v0.4.1`），可通过模板版本判断文档规范性 | 文档规范性判断 |
