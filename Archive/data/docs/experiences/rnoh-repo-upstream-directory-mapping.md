## 鸿蒙化仓库与上游的 JS 层目录结构存在系统性映射差异

### 问题现象
鸿蒙化仓库并非原样保留上游 src/ 结构，直接按上游路径合并 patch 时文件定位失败。以 react-native-camera-kit 为例的系统性映射差异：

| 上游路径 | 鸿蒙仓库对应 |
|----------|-------------|
| `src/specs/CameraNativeComponent.ts` | `src/CameraKitNativeComponent.ts`（重命名+扩展） |
| `src/types.ts` | `types/types.ts` |
| `src/CameraProps.ts` | `types/CameraProps.ts` |
| `src/Camera.android.tsx` / `Camera.ios.tsx` | `src/Camera.tsx`（自有实现，DeviceEventEmitter 桥接） |
| `src/specs/NativeCameraKitModule.ts` | `src/NativeCameraKit.tsx` |

### 解决方案
合并 patch 前先建立「上游→鸿蒙」目录映射表（覆盖 Spec 文件、types、平台实现文件、codegen 脚本入口的对应关系），再按映射表转写文件变更，**不得假设鸿蒙仓库保留上游目录结构**。另注意 codegen 入口不同：鸿蒙侧使用自有脚本（如 camera-kit 的 `scripts/codegen-lib.js`，调用 react-native-harmony-cli 的 `commandCodegenLibHarmony`，指定 cpp/arkts 双输出）。

### 结果
按映射表转写后，Phase 2 精简 patch 从 280KB 缩至 9.3KB / 7 个相关文件；映射表可直接供后续 code-adapt 适配阶段引用，避免二次人工摸索路径。