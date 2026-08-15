# RN 三方库源码解析器

---

## 一、模块概述

RN 三方库源码解析器负责从 `@react-native-ohos/*` 库的源码中提取 API 信息，包括 JS/TS 入口文件、TurboModule Spec 定义、NativeEventEmitter 事件等。

---

## 二、源码定位

### 2.1 定位优先级

```
1. oh_modules/@react-native-ohos/[库名]/  （推荐，最准确）
2. node_modules/@react-native-ohos/[库名]/  （备选）
```

### 2.2 定位方法

从 `.oh-xts-config.json` 中读取 `RN_TEST_PROJECT` 路径，然后：

```bash
# 探查 oh_modules（推荐）
ls {RN_TEST_PROJECT}/oh_modules/@react-native-ohos/[库名]/

# 探查 node_modules（备选）
ls {RN_TEST_PROJECT}/node_modules/@react-native-ohos/[库名]/
```

---

## 三、JS/TS 入口文件解析

### 3.1 定位入口文件

入口文件通常为以下之一：
- `index.js`
- `index.ts`
- `index.tsx`
- `src/index.ts`
- `src/index.js`

### 3.2 提取导出的 API

从入口文件中提取以下信息：

| 提取项 | 搜索模式 | 输出 |
|--------|---------|------|
| 导出的类 | `export class`, `export default class` | 类名列表 |
| 导出的方法 | `export function`, `export const.*=.*=>` | 方法名列表 |
| 导出的常量 | `export const.*=.*[^>]` | 常量名和值 |
| 导出的枚举 | `export enum` | 枚举名和成员 |
| NativeEventEmitter 事件 | `addEventListener`, `.on(`, `NativeEventEmitter` | 事件名列表 |
| Platform 分支 | `Platform.OS ===` | 各平台 API 差异 |

### 3.3 解析示例

```javascript
// react-native-audio 的入口文件
import { Platform } from 'react-native';
import { NativeModules } from 'react-native';

const AudioRecorder = NativeModules.AudioRecorder;

let AudioUtils: AudioUtilsType;
if (Platform.OS === 'ios') {
  AudioUtils = {
    MainBundlePath: '',
    DocumentDirectoryPath: '',
    CachesDirectoryPath: '',
    LibraryDirectoryPath: '',
  };
} else if (Platform.OS === 'harmony') {
  AudioUtils = {
    FilesDirectoryPath: '/data/app/...',
    CachesDirectoryPath: '/data/app/...',
    TempsDirectoryPath: '/data/app/...',
  };
}

export { AudioRecorder, AudioUtils };
```

**解析输出**：
- 导出类：无（使用 NativeModules）
- 导出对象：`AudioRecorder`, `AudioUtils`
- HarmonyOS 可用 API：`AudioRecorder`（所有方法）, `AudioUtils.FilesDirectoryPath`, `AudioUtils.CachesDirectoryPath`, `AudioUtils.TempsDirectoryPath`
- HarmonyOS 不可用 API：`AudioUtils.MainBundlePath`, `AudioUtils.DocumentDirectoryPath`, `AudioUtils.LibraryDirectoryPath`

---

## 四、TurboModule Spec 解析

### 4.1 定位 TurboModule Spec

TurboModule Spec 文件通常位于：
- `src/Native[库名].ts`
- `src/Native[库名].js`
- `Native[库名].ts`
- CodeGen 生成的文件

### 4.2 提取方法签名

从 Spec 文件中提取：

```typescript
// NativeAudioRecorder.ts
export interface Spec extends TurboModule {
  prepareRecordingAtPath(path: string, options: RecordingOptions): boolean;
  startRecording(): void;
  stopRecording(): void;
  pauseRecording(): void;
  resumeRecording(): void;
  checkAuthorizationStatus(): Promise<boolean>;
  requestAuthorization(): Promise<boolean>;
  isRecording(): boolean;
  onProgress: ?(data: ProgressData) => void;
  onFinishRecording: ?(data: Record<string, Object>) => void;
}
```

**解析输出**：

| 方法名 | 参数 | 返回值 | 类型 |
|--------|------|--------|------|
| prepareRecordingAtPath | path: string, options: RecordingOptions | boolean | 同步 |
| startRecording | 无 | void | 同步 |
| stopRecording | 无 | void | 同步 |
| pauseRecording | 无 | void | 同步 |
| resumeRecording | 无 | void | 同步 |
| checkAuthorizationStatus | 无 | Promise\<boolean\> | 异步 |
| requestAuthorization | 无 | Promise\<boolean\> | 异步 |
| isRecording | 无 | boolean | 同步 |
| onProgress | data: ProgressData | void | 事件回调 |
| onFinishRecording | data: Record\<string, Object\> | void | 事件回调 |

### 4.3 提取类型定义

```typescript
// 提取 RecordingOptions 接口
export interface RecordingOptions {
  SampleRate?: number;
  Channels?: number;
  AudioQuality?: string;
  AudioEncoding?: string;
  OutputFormat?: string;
  MeteringEnabled?: boolean;
  AudioEncodingBitRate?: number;
}

// 提取 ProgressData 接口
export interface ProgressData {
  currentTime: number;
  currentMetering: number;
}
```

---

## 五、NativeEventEmitter 事件解析

### 5.1 事件发现方法

在源码中搜索以下模式：

```javascript
// 模式1：直接赋值回调
AudioRecorder.onProgress = (data) => { ... };
AudioRecorder.onFinishRecording = (data) => { ... };

// 模式2：addEventListener
NativeEventEmitter.addListener('recordingProgress', callback);
NativeEventEmitter.addListener('recordingFinished', callback);

// 模式3：DeviceEventEmitter
DeviceEventEmitter.addListener('recordingProgress', callback);

// 模式4：直接导出事件名常量
export const RECORDING_PROGRESS_EVENT = 'recordingProgress';
```

### 5.2 事件信息提取

| 事件名 | 触发时机 | 回调参数 | 说明 |
|--------|---------|---------|------|
| recordingProgress | 录音进行中 | { currentTime, currentMetering } | 进度事件 |
| recordingFinished | 录音完成 | { status, audioFileURL } | 完成事件 |

---

## 六、解析输出格式

### 6.1 API 清单

解析完成后，输出结构化的 API 清单：

```
=== @react-native-ohos/react-native-audio API 清单 ===

[导出对象]
- AudioRecorder (NativeModule)
  - 同步方法: prepareRecordingAtPath, startRecording, stopRecording, pauseRecording, resumeRecording, isRecording
  - 异步方法: checkAuthorizationStatus, requestAuthorization
  - 事件回调: onProgress, onFinishRecording

- AudioUtils (常量对象)
  - HarmonyOS 可用: FilesDirectoryPath, CachesDirectoryPath, TempsDirectoryPath
  - HarmonyOS 不可用: MainBundlePath, DocumentDirectoryPath, LibraryDirectoryPath

[类型定义]
- RecordingOptions: { SampleRate?, Channels?, AudioQuality?, AudioEncoding?, OutputFormat?, MeteringEnabled?, AudioEncodingBitRate? }
- ProgressData: { currentTime, currentMetering }

[事件列表]
- onProgress: 录音进度事件
- onFinishRecording: 录音完成事件

[权限需求]
- ohos.permission.MICROPHONE (录音功能)
```

### 6.2 测试优先级建议

根据 API 的重要性和使用频率，建议测试优先级：

| 优先级 | API | 理由 |
|--------|-----|------|
| P0 | 核心流程方法 | prepareRecordingAtPath + startRecording + stopRecording |
| P1 | 状态查询方法 | isRecording, checkAuthorizationStatus |
| P1 | 权限方法 | requestAuthorization |
| P2 | 事件回调 | onProgress, onFinishRecording |
| P2 | 辅助方法 | pauseRecording, resumeRecording |
| P3 | 常量验证 | AudioUtils 各路径常量 |
