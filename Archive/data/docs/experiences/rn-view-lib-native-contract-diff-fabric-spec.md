## RN View 型库的原生接口契约必须同时覆盖 Fabric 组件 Spec

### 问题现象
对 RN 三方库做版本差异分析时，diff 脚本（rn-scan-exports.cjs / generate-diff.js）自动判定为「✅ 无需原生适配 — 接口未变更」，但对 react-native-camera-kit（16.1.3 → 18.0.0）实测该结论是**假阴性**：上游 `src/specs/CameraNativeComponent.ts`（Fabric 组件 Spec，`codegenNativeComponent` 输入）新增了 4 个 props（faceDetectionEnabled / faceDetectionThrottleMs / allowedBarcodeTypes / iOsDeferredStart）+ 2 个事件（onFaceDetected / onFaceDetectionInstallStatus）。Fabric 组件 Spec 是 codegen 的直接输入，其变更意味着鸿蒙侧必须：① 同步更新组件 Spec 文件 → ② 重跑 codegen（generated/ ETS+C++ 产物变化）→ ③ ETS 原生层实现新 props/事件（人脸检测为全新原生能力）。

### 解决方案
RN 库的原生接口契约 = **TurboModule Spec + Fabric Component Spec 两部分**，只检查前者会漏掉 View 型库的主要原生变更面：

- 脚本的「TurboModule Spec 变更」检查只覆盖 `src/specs/Native*Module.ts`，不覆盖组件 Spec 文件
- 脚本判定后，务必**人工 diff** `src/specs/*Component*.ts`（或所有 `codegenNativeComponent` 输入文件），重点检查：
  - `NativeProps` / 组件 interface 的 props 增删
  - `DirectEventHandler` / `BubblingEventHandler` 事件增删
- 判定矩阵：**TurboModule Spec 变更 OR 组件 Spec 变更 → 需要原生适配（codegen + 原生实现）**

### 结果
camera-kit 正确结论为「需要原生适配（类型 A）」，人工复核推翻了脚本假阴性结论。相机/播放器/地图/WebView 等 View 型库尤其常见组件 Spec 变更，是脚本自动判定的重灾区；分析报告中应显式记录对自动结论的修正及原因，避免下游直接采信脚本结论。