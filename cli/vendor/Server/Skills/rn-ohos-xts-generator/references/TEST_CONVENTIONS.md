# 测试约定和命名规范

---

## 一、测试用例编号规范

### 1.1 编号格式

```
SUB_RNOH_[库名简写]_[API]_[类型]_[序号]
```

### 1.2 库名简写规则

| 原始库名 | 简写 | 说明 |
|---------|------|------|
| @react-native-ohos/react-native-audio | AUDIO | 取最后一段 |
| @react-native-ohos/react-native-webview | WEBVIEW | 取最后一段 |
| @react-native-ohos/react-native-camera | CAMERA | 取最后一段 |
| @react-native-ohos/react-native-ble-plx | BLE | 取核心功能词 |
| @react-native-ohos/react-native-vlc-media-player | VLC | 取核心标识 |

### 1.3 类型标识

| 标识 | 说明 | 示例 |
|------|------|------|
| PARAM | 参数测试 | SUB_RNOH_AUDIO_PREPARE_PARAM_0001 |
| ERROR | 错误码测试 | SUB_RNOH_AUDIO_PREPARE_ERROR_401_0001 |
| RETURN | 返回值测试 | SUB_RNOH_AUDIO_GETAUTH_RETURN_0001 |
| BOUNDARY | 边界值测试 | SUB_RNOH_AUDIO_PREPARE_BOUNDARY_0001 |
| EVENT | 事件测试 | SUB_RNOH_AUDIO_PROGRESS_EVENT_0001 |
| PERM | 权限测试 | SUB_RNOH_AUDIO_MIC_PERM_0001 |

---

## 二、测试用例命名规范

### 2.1 测试函数命名

```typescript
// 格式: should [expected behavior] when [condition]
it('should prepare recording with valid path and options', () => {});
it('should reject when path is empty', () => {});
it('should invoke onProgress callback with correct data', () => {});
it('should request microphone authorization successfully', () => {});
```

### 2.2 测试套件命名

```typescript
// TurboModule 方法测试
describe('AudioRecorderPrepareTest', () => {});
describe('AudioRecorderStartStopTest', () => {});
describe('AudioRecorderAuthorizationTest', () => {});

// 事件测试
describe('AudioRecorderProgressEventTest', () => {});
describe('AudioRecorderFinishEventTest', () => {});

// 常量/工具类测试
describe('AudioUtilsConstantsTest', () => {});

// NativeComponent 组件测试
describe('WebViewSourcePropertyTest', () => {});
describe('WebViewOnLoadEventTest', () => {});
```

---

## 三、JSDoc 注释规范

### 3.1 标准注释模板

```typescript
/**
 * @tc.name should prepare recording with valid path and options
 * @tc.number SUB_RNOH_AUDIO_PREPARE_PARAM_0001
 * @tc.desc 测试 AudioRecorder 的 prepareRecordingAtPath 方法 - 正常参数场景.
 * @tc.type FUNCTION
 * @tc.size MEDIUMTEST
 * @tc.level LEVEL1
 */
it('should prepare recording with valid path and options', () => {
  // ...
});
```

### 3.2 注释字段说明

| 字段 | 说明 | 规范 |
|------|------|------|
| @tc.name | 测试用例名称 | 必须与 it() 第一个参数完全一致 |
| @tc.number | 测试用例编号 | SUB_RNOH_[库名]_[API]_[类型]_[序号] |
| @tc.desc | 测试描述 | 格式：`测试 [对象] 的 [方法] - [场景].`，必须以 `. ` 结尾 |
| @tc.type | 测试类型 | FUNCTION / EVENT |
| @tc.size | 测试规模 | SMALLTEST / MEDIUMTEST / LARGETEST |
| @tc.level | 测试级别 | LEVEL0 / LEVEL1 / LEVEL2 / LEVEL3 / LEVEL4 |

---

## 四、测试文件组织规范

### 4.1 文件命名

```
[库名简写][功能模块].test.ts
```

示例：
```
AudioRecorderTest.test.ts          # 主测试文件
AudioUtilsTest.test.ts             # 工具类测试文件
AudioEventTest.test.ts             # 事件测试文件
AudioPermTest.test.ts              # 权限测试文件
```

### 4.2 文件结构

```typescript
/**
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * ...
 */

jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioRecorder: {
    prepareRecordingAtPath: jest.fn().mockReturnValue(true),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    requestAuthorization: jest.fn().mockResolvedValue(true),
    isRecording: jest.fn().mockReturnValue(false),
  },
  AudioUtils: {
    FilesDirectoryPath: '/data/app/files',
    CachesDirectoryPath: '/data/app/cache',
    MainBundlePath: '/data/app/bundle',
  },
}));

import { AudioRecorder, AudioUtils } from '@react-native-ohos/react-native-audio';

describe('AudioRecorderPrepareTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 测试用例
});
```

### 4.3 测试级别分配

| 级别 | 适用场景 | 示例 |
|------|---------|------|
| LEVEL0 | 冒烟测试、核心功能 | 基本录音流程 |
| LEVEL1 | 正常参数、核心返回值 | 正常参数、权限请求 |
| LEVEL2 | 边界值、异常参数 | 空路径、null 参数 |
| LEVEL3 | 错误码、特殊场景 | 错误码 401、超时场景 |
| LEVEL4 | 兼容性、性能 | 大文件、并发操作 |

---

## 五、RN 三方库测试特有约定

### 5.1 测试文件输出路径

```
{RN_TEST_PROJECT}/__tests__/
├── [库名简写]Test.test.ts
├── [库名简写]EventTest.test.ts
├── [库名简写]PermTest.test.ts
└── [库名简写]UtilsTest.test.ts
```

### 5.2 Mock 文件输出路径

```
{RN_TEST_PROJECT}/__mocks__/
└── @react-native-ohos/
    └── [库名]/
        └── index.ts
```

### 5.3 测试设计文档命名

```
格式: [库名].test.design.md
示例:
  - react-native-audio.test.design.md
```

### 5.4 describe 嵌套规范

```typescript
describe('AudioRecorderTest', () => {
  // 第一层：按 API 分组
  describe('prepareRecordingAtPath', () => {
    // 第二层：按场景分组（可选）
    it('should prepare with valid parameters', () => {});
    it('should reject when path is empty', () => {});
  });

  describe('startRecording', () => {
    it('should start recording successfully', () => {});
  });
});
```

### 5.5 异步测试规范

```typescript
// 异步方法测试必须使用 async/await
it('should resolve authorization to true', async () => {
  (AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);
  const result = await AudioRecorder.requestAuthorization();
  expect(result).toBe(true);
});

// 异步错误测试
it('should reject when authorization denied', async () => {
  (AudioRecorder.requestAuthorization as jest.Mock).mockRejectedValue(
    new Error('Authorization denied')
  );
  await expect(AudioRecorder.requestAuthorization()).rejects.toThrow('Authorization denied');
});
```

### 5.6 Mock 清理规范

```typescript
describe('SomeTestSuite', () => {
  beforeEach(() => {
    // 每个测试前清理所有 Mock 状态
    jest.clearAllMocks();
  });

  afterEach(() => {
    // 每个测试后恢复所有 Mock（可选）
    jest.restoreAllMocks();
  });
});
```
