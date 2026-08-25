# 平台兼容性分析器

---

## 一、模块概述

平台兼容性分析器负责分析 RN 三方库在不同平台（iOS、Android、HarmonyOS）之间的 API 差异，确保 XTS 测试只覆盖 HarmonyOS 平台实际支持的 API。

---

## 二、核心规则

> **最重要规则：只测试 `Platform.OS === 'harmony'` 分支中定义的 API**

---

## 三、Platform.OS 分支分析

### 3.1 常见分支模式

```javascript
// 模式1：if-else if 链
if (Platform.OS === 'ios') {
  // iOS 特有 API
} else if (Platform.OS === 'android') {
  // Android 特有 API
} else if (Platform.OS === 'harmony') {
  // HarmonyOS 特有 API ← 只测试这里的
}

// 模式2：三元表达式
const path = Platform.OS === 'ios'
  ? MainBundlePath
  : Platform.OS === 'harmony'
    ? FilesDirectoryPath  ← HarmonyOS 使用这个
    : DocumentDirectoryPath;

// 模式3：Platform.select
const Utils = Platform.select({
  ios: { ... },
  android: { ... },
  harmony: { ... },  ← 只测试这里的
});
```

### 3.2 分析方法

1. 在入口文件中搜索 `Platform.OS` 和 `Platform.select`
2. 提取每个分支中的 API 定义
3. 标记 HarmonyOS 分支中存在和缺失的 API

---

## 四、常见平台差异

### 4.1 路径常量差异

| iOS | Android | HarmonyOS | 说明 |
|-----|---------|-----------|------|
| `MainBundlePath` | - | `BundlePath`（如有） | 应用资源路径 |
| `DocumentDirectoryPath` | `DocumentDirectoryPath` | `FilesDirectoryPath` | 文件存储路径 |
| `CachesDirectoryPath` | `CachesDirectoryPath` | `CachesDirectoryPath` | 缓存路径 |
| `LibraryDirectoryPath` | - | - | HarmonyOS 不支持 |
| `ExternalDirectoryPath` | `ExternalDirectoryPath` | - | HarmonyOS 不支持 |
| `ExternalStorageDirectoryPath` | `ExternalStorageDirectoryPath` | - | HarmonyOS 不支持 |

### 4.2 API 功能差异

| 功能 | iOS/Android | HarmonyOS | 测试建议 |
|------|------------|-----------|---------|
| `fetch()` 写文件 | 支持 | 不支持 | 不测试文件写入 |
| `console.error()` | 正常输出 | 可能弹窗 | 使用 `console.warn()` |
| `NativeModules` | 支持 | 支持 | 正常测试 |
| `NativeEventEmitter` | 支持 | 支持（可能不稳定） | 设置超时保护 |
| `Linking` | 支持 | 部分支持 | 确认后再测试 |
| `NetInfo` | 支持 | 支持 | 正常测试 |

### 4.3 权限差异

| 权限 | iOS | Android | HarmonyOS |
|------|-----|---------|-----------|
| 麦克风 | `NSMicrophoneUsageDescription` | `RECORD_AUDIO` | `ohos.permission.MICROPHONE` |
| 相机 | `NSCameraUsageDescription` | `CAMERA` | `ohos.permission.CAMERA` |
| 定位 | `NSLocationWhenInUseUsageDescription` | `ACCESS_FINE_LOCATION` | `ohos.permission.LOCATION` |
| 存储 | - | `WRITE_EXTERNAL_STORAGE` | `ohos.permission.WRITE_MEDIA` |
| 网络 | - | `INTERNET` | `ohos.permission.INTERNET` |

---

## 五、兼容性分析输出

### 5.1 输出格式

```
=== 平台兼容性分析报告 ===

[HarmonyOS 可用 API]
✅ AudioRecorder.prepareRecordingAtPath
✅ AudioRecorder.startRecording
✅ AudioRecorder.stopRecording
✅ AudioRecorder.pauseRecording
✅ AudioRecorder.resumeRecording
✅ AudioRecorder.isRecording
✅ AudioRecorder.requestAuthorization
✅ AudioUtils.FilesDirectoryPath
✅ AudioUtils.CachesDirectoryPath
✅ AudioUtils.TempsDirectoryPath

[HarmonyOS 不可用 API - 禁止测试]
❌ AudioUtils.MainBundlePath (仅 iOS)
❌ AudioUtils.DocumentDirectoryPath (仅 iOS/Android)
❌ AudioUtils.LibraryDirectoryPath (仅 iOS)
❌ AudioUtils.ExternalDirectoryPath (仅 Android)

[需要特殊处理的 API]
⚠️ AudioRecorder.onProgress (emitDeviceEvent 可能不稳定，需要超时保护)
⚠️ AudioRecorder.onFinishRecording (emitDeviceEvent 可能不稳定，需要超时保护)

[权限需求]
🔒 ohos.permission.MICROPHONE (录音功能)
```

### 5.2 测试生成建议

根据兼容性分析结果：

1. **可用 API** → 正常生成测试用例
2. **不可用 API** → 跳过，不生成任何测试
3. **需要特殊处理的 API** → 生成测试但添加特殊处理（超时、兜底等）
4. **权限相关 API** → 生成权限测试用例

---

## 六、分析流程

```
步骤1：读取 JS/TS 入口文件
  └─ 搜索 Platform.OS 和 Platform.select

步骤2：提取各平台 API 定义
  ├─ iOS 分支 API
  ├─ Android 分支 API
  └─ HarmonyOS 分支 API

步骤3：对比分析
  ├─ HarmonyOS 独有 API
  ├─ 跨平台共有 API
  └─ HarmonyOS 缺失的 API

步骤4：检查 TurboModule Spec
  └─ 确认 Spec 中定义的方法是否在 HarmonyOS 端实现

步骤5：检查 HarmonyOS 实现
  └─ 确认 ArkTS 实现中是否有 throw new Error('not implemented')

步骤6：输出兼容性报告
  ├─ 可用 API 列表
  ├─ 不可用 API 列表
  ├─ 特殊处理 API 列表
  └─ 权限需求列表
```
