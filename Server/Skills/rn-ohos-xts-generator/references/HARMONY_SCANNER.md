# HarmonyOS 实现探查器

---

## 一、模块概述

HarmonyOS 实现探查器负责探查 `oh_modules` 下的 ArkTS 实现文件，确认三方库在 HarmonyOS 端的实际实现情况，包括已实现方法、未实现方法、事件名称等。

---

## 二、探查目标

### 2.1 探查目录结构

典型的 `@react-native-ohos/*` 库在 `oh_modules` 下的结构：

```
oh_modules/@react-native-ohos/[库名]/
├── harmony/                          # HarmonyOS 特有目录
│   ├── Index.ets                     # ArkTS 组件入口（如有 NativeComponent）
│   ├── package.ts                    # ArkTS Package 注册
│   └── src/main/
│       ├── ets/
│       │   ├── [ModuleName]Package.ts # TurboModule Package
│       │   └── [ModuleName]TurboModule.ts  # TurboModule 实现
│       ├── cpp/
│       │   ├── CMakeLists.txt        # C++ 构建配置
│       │   └── [ModuleName]Module.cpp # C++ 原生实现
│       └── module.json5              # 模块配置
├── src/
│   ├── index.ts / index.js           # JS/TS 入口
│   └── Native[ModuleName].ts         # TurboModule Spec
├── index.ts / index.js               # 顶层入口
└── package.json
```

### 2.2 必须探查的文件

| 文件 | 探查目的 | 关键信息 |
|------|---------|---------|
| `index.ts` / `index.js` | JS 入口 | 导出的 API、Platform 分支 |
| `src/Native*.ts` | TurboModule Spec | 方法签名、参数类型 |
| `harmony/Index.ets` | ArkTS 组件 | NativeComponent 定义 |
| `harmony/package.ts` | Package 注册 | Package 类名 |
| `harmony/src/main/ets/*.ts` | ArkTS 实现 | 实际实现的方法 |
| `harmony/src/main/cpp/*.cpp` | C++ 实现 | 底层实现细节 |
| `harmony/src/main/cpp/CMakeLists.txt` | 构建配置 | 依赖库、源文件列表 |

---

## 三、方法实现确认

### 3.1 探查方法

在 ArkTS 实现文件中搜索每个方法的实现：

```typescript
// 已实现的方法
startRecording(): void {
  // 实际实现代码
  this.nativeModule.startRecording();
}

// 未实现的方法（需要跳过测试）
someMethod(): void {
  throw new Error('not implemented');
}
```

### 3.2 实现状态分类

| 状态 | 标识 | 测试策略 |
|------|------|---------|
| 已完整实现 | 有实际代码，无 throw | 正常生成测试 |
| 部分实现 | 有代码但有 TODO/FIXME | 生成测试但标记为 LEVEL3 |
| 未实现 | `throw new Error('not implemented')` | 跳过，不生成测试 |
| 空实现 | 方法体为空 | 生成测试但预期可能失败 |

### 3.3 探查输出

```
=== HarmonyOS 实现状态 ===

[已实现方法]
✅ prepareRecordingAtPath - 完整实现
✅ startRecording - 完整实现
✅ stopRecording - 完整实现
✅ pauseRecording - 完整实现
✅ resumeRecording - 完整实现
✅ isRecording - 完整实现
✅ requestAuthorization - 完整实现

[未实现方法]
❌ checkAuthorizationStatus - throw new Error('not implemented')

[事件实现]
✅ emitDeviceEvent('recordingProgress', ...) - 已实现
✅ emitDeviceEvent('recordingFinished', ...) - 已实现
```

---

## 四、NativeComponent 探查

### 4.1 探查 Index.ets

```typescript
// harmony/Index.ets
export * from './src/main/ets/RNCWebView';

// harmony/src/main/ets/RNCWebView.ets
@ComponentV2
export struct RNCWebView {
  @Prop source: string = '';
  @Prop javaScriptEnabled: boolean = true;
  // ...
}
```

### 4.2 组件信息提取

| 提取项 | 说明 |
|--------|------|
| 组件名 | `RNCWebView` |
| 导出方式 | `export struct` |
| 属性列表 | source, javaScriptEnabled, ... |
| 事件列表 | onLoad, onError, ... |
| 类型常量 | `WebViewConstants` |

### 4.3 组件探查输出

```
=== NativeComponent 信息 ===

[组件名] RNCWebView
[导出路径] harmony/src/main/ets/RNCWebView.ets
[属性]
  - source: string (默认: '')
  - javaScriptEnabled: boolean (默认: true)
  - injectedJavaScript: string (默认: '')
[事件]
  - onLoad: () => void
  - onError: (error: ErrorEvent) => void
  - onMessage: (event: MessageEvent) => void
```

---

## 五、CMakeLists.txt 探查

### 5.1 探查目的

确认三方库的 C++ 依赖和源文件，用于测试工程的构建配置。

### 5.2 探查内容

```cmake
# harmony/src/main/cpp/CMakeLists.txt
target_sources(rn_audio PRIVATE
  AudioRecorderModule.cpp
  AudioRecorderTurboModule.cpp
)

target_link_libraries(rn_audio PUBLIC
  rnoh
  libace_ndk.z.so
  libhilog_ndk.z.so
)
```

### 5.3 探查输出

```
=== CMakeLists.txt 信息 ===

[源文件] AudioRecorderModule.cpp, AudioRecorderTurboModule.cpp
[依赖库] rnoh, libace_ndk.z.so, libhilog_ndk.z.so
[子目录路径] src/main/cpp
```

---

## 六、Package 注册探查

### 6.1 探查 package.ts

```typescript
// harmony/package.ts
import { TurboModule } from '@rnoh/react-native-openharmony/ts';
import { TM } from './src/main/ets/AudioRecorderTurboModule';

export class AudioPackage extends TurboModule {
  createTurboModule(ctx: TurboModuleContext): AudioRecorderTurboModule {
    return new AudioRecorderTurboModule(ctx);
  }
}
```

### 6.2 探查输出

```
=== Package 注册信息 ===

[Package 类名] AudioPackage
[TurboModule 类名] AudioRecorderTurboModule
[Package 文件路径] harmony/package.ts
```

---

## 七、探查流程

### 7.1 完整探查步骤

```
步骤1：定位三方库目录
  ├─ 读取 .oh-xts-config.json 中的 RN_TEST_PROJECT
  ├─ 检查 oh_modules/@react-native-ohos/[库名]/
  └─ 备选：检查 node_modules/@react-native-ohos/[库名]/

步骤2：解析 JS/TS 入口
  ├─ 读取 index.ts / index.js
  ├─ 提取导出的 API
  └─ 识别 Platform.OS === 'harmony' 分支

步骤3：解析 TurboModule Spec
  ├─ 读取 src/Native*.ts
  ├─ 提取方法签名
  └─ 提取类型定义

步骤4：探查 HarmonyOS 实现
  ├─ 读取 harmony/src/main/ets/*.ts
  ├─ 确认方法实现状态
  └─ 提取 emitDeviceEvent 事件名

步骤5：探查 NativeComponent（如有）
  ├─ 读取 harmony/Index.ets
  └─ 提取组件属性和事件

步骤6：探查构建配置
  ├─ 读取 CMakeLists.txt
  └─ 读取 package.ts

步骤7：输出综合报告
  ├─ API 清单
  ├─ 实现状态
  ├─ 事件列表
  └─ 测试优先级建议
```
