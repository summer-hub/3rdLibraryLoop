# 鸿蒙化适配判断规则

上游版本升级后，按以下规则判断鸿蒙侧是否需要同步修改。结合版本差异分析结果，为报告的「鸿蒙化适配分析」章节提供判断依据。

## 文件路径映射

| 上游路径 | 鸿蒙对应 |
|----------|----------|
| `src/index.ts(x)` | 同路径 + `Platform.OS === 'harmony'` 分支 |
| `src/Native*.ts` | 同路径 → codegen → `harmony/**/generated/` |
| `android/` | `harmony/` ETS TurboModule + C++ Package |
| `ios/` | `harmony/` ETS TurboModule + C++ Package |
| `example/android`, `example/ios` | `example/harmony/` |

## 判断矩阵

| 上游变更 | 需鸿蒙适配 | 典型动作 |
|----------|-----------|----------|
| 纯 JS 逻辑，无 native 交互 | 通常否 | 合并 JS 即可 |
| 新增/修改 export API | 是 | 同步 `src/`，检查 harmony 调用 |
| TurboModule 方法增删改 | 是 | 改 Spec → codegen → ETS/C++ |
| Android/iOS 权限/生命周期 | 是 | 在 ETS 用 OHOS API 对等实现 |
| 事件名/NativeEventEmitter 变更 | 是 | 对齐 JS 层 + 原生 emit 事件名 |
| `package.json` peerDeps 升级 | 待评估 | 查目标 RNOH 版本兼容矩阵 |
| 仅 README/CHANGELOG | 否 | — |
| 仅 `.github`/CI | 否 | — |

## RNOH 框架版本适配要点

跨 RNOH 版本升级时（如 0.77 → 0.84）额外检查：

1. **Codegen 版本**：项目 `codegen-lib` script 与目标 RNOH CLI 是否匹配
2. **TurboModule 架构**：新架构下 Spec 路径、`TurboModuleRegistry` 用法
3. **Package 基类**：RNOHPackage（新）vs RNPackage（旧）
4. **Example 壳工程**：`example/harmony/` 中 Package 注册、依赖版本
5. **HAR 构建**（仅含 native cpp 的库）：变更后是否需要重新打 har 包

## 库类型与流程分支

| 类型 | 判定 | 后续适配流程 |
|------|------|-------------|
| `native-harmony` | 有 `harmony/` HAR + TurboModule/Fabric/cpp | 完整流程（codegen + autolinking + HAR） |
| `js-only-harmony` | 有 `harmony/` 但无 cpp/autolinking | 跳过 HAR/cpp 门禁 |
| `pure-js` | 无 native 或纯 JS 鸿蒙实现 | 跳过 codegen、autolinking、HAR |

## 升级类型 A：上游版本升级 + 框架适配

当版本状态为"落后"时，需同时处理：
1. **上游 JS 代码合并** — 应用 diff patch 中的 JS 变更
2. **TurboModule Spec 同步** — 上游方法增删改时更新 Spec + 重跑 codegen
3. **鸿蒙原生层适配** — Android/iOS 原生变更需在 `harmony/` 中对等实现
4. **RNOH 框架版本适配** — 跨版本时验证 API 兼容性 + 重新 codegen

## 升级类型 B：纯框架版本适配

当版本状态为"最新"时，上游 JS 代码无差异，只需：
1. **RNOH 框架版本升级** — 更新 package.json / oh-package.json5 中的 RNOH 依赖版本
2. **重新 codegen** — 使用目标版本 CLI 重新生成 generated/ 代码
3. **API 兼容性验证** — ETS 业务代码、Package 注册代码、C++ 层依赖的 RNOH API

## 鸿蒙 API 核查（涉及原生能力时必做）

凡涉及原生能力的「需适配」「需评估」项，**分析阶段**须完成 API 核查后再下结论：

1. 使用 **`devecocli docs search`** 搜索鸿蒙 API 文档（见 [OHOS_API_LOOKUP.md](OHOS_API_LOOKUP.md)）
2. 搜 `harmonyos-references` 确认 API 签名
3. 搜 `harmonyos-guides` 确认约束（实时性、权限、步骤）
4. 写入报告「鸿蒙 API 核查表」
5. 适配建议须引用核查表中的 Kit/API

## 输出标记

在报告中使用：
- ✅ **需要适配** / ✅ **可实现**（须有 API 核查依据）
- ❌ **无需适配** / ❌ **无法实现**（须有 API 核查依据）
- ⚠️ **待评估** / ⚠️ **部分实现**
- 🔶 **合理差异**（iOS/Android-only，文档标注 Support=No）
