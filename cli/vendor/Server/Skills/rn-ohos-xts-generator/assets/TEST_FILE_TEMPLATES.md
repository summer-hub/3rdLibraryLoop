# RN 三方库测试代码模板库

---

## 一、模板概述

本模块提供 RN 三方库 XTS 测试的各种 Jest 代码模板，包括 Mock 模板、测试文件头、TurboModule 测试、事件测试、组件测试等。

---

## 二、测试文件头模板

### 2.1 Apache 2.0 许可证头部

```typescript
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
```

---

## 三、Mock 模块模板

### 3.1 完整 Mock 模块

```typescript
jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioRecorder: {
    prepareRecordingAtPath: jest.fn().mockReturnValue(true),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    requestAuthorization: jest.fn().mockResolvedValue(true),
    isRecording: jest.fn().mockReturnValue(false),
    onProgress: undefined,
    onFinishRecording: undefined,
  },
  AudioUtils: {
    FilesDirectoryPath: '/data/app/files',
    CachesDirectoryPath: '/data/app/cache',
    MainBundlePath: '/data/app/bundle',
  },
}));
```

### 3.2 Mock 文件模板（__mocks__/@react-native-ohos/[库名]/index.ts）

```typescript
const audioMock = {
  AudioRecorder: {
    prepareRecordingAtPath: jest.fn().mockReturnValue(true),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    requestAuthorization: jest.fn().mockResolvedValue(true),
    isRecording: jest.fn().mockReturnValue(false),
    onProgress: undefined,
    onFinishRecording: undefined,
  },
  AudioUtils: {
    FilesDirectoryPath: '/data/app/files',
    CachesDirectoryPath: '/data/app/cache',
    MainBundlePath: '/data/app/bundle',
  },
};

export default audioMock;
```

### 3.3 Mock 数据工厂

```typescript
export const createSuccessMock = () => ({
  prepareRecordingAtPath: jest.fn().mockReturnValue(true),
  requestAuthorization: jest.fn().mockResolvedValue(true),
  isRecording: jest.fn().mockReturnValue(false),
});

export const createFailureMock = () => ({
  prepareRecordingAtPath: jest.fn().mockReturnValue(false),
  requestAuthorization: jest.fn().mockResolvedValue(false),
  isRecording: jest.fn().mockReturnValue(false),
});

export const createErrorMock = (errorMessage: string) => ({
  requestAuthorization: jest.fn().mockRejectedValue(new Error(errorMessage)),
});
```

---

## 四、完整测试文件模板

### 4.1 TurboModule 测试文件

```typescript
/*
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
  let testPath: string;
  let testOptions: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    testPath = AudioUtils.FilesDirectoryPath + '/test_prepare.aac';
    testOptions = { SampleRate: 22050, Channels: 1, AudioEncoding: 'aac' };
  });

  /**
   * @tc.name should prepare recording with valid path and options
   * @tc.number SUB_RNOH_AUDIO_PREPARE_PARAM_0001
   * @tc.desc 测试 AudioRecorder 的 prepareRecordingAtPath 方法 - 正常参数场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL1
   */
  it('should prepare recording with valid path and options', () => {
    AudioRecorder.prepareRecordingAtPath(testPath, testOptions);
    expect(AudioRecorder.prepareRecordingAtPath).toHaveBeenCalledWith(testPath, testOptions);
    expect(AudioRecorder.prepareRecordingAtPath).toHaveBeenCalledTimes(1);
  });

  /**
   * @tc.name should return false when path is empty
   * @tc.number SUB_RNOH_AUDIO_PREPARE_PARAM_0002
   * @tc.desc 测试 AudioRecorder 的 prepareRecordingAtPath 方法 - 空路径场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL2
   */
  it('should return false when path is empty', () => {
    (AudioRecorder.prepareRecordingAtPath as jest.Mock).mockReturnValue(false);
    const result = AudioRecorder.prepareRecordingAtPath('', testOptions);
    expect(result).toBe(false);
  });
});

describe('AudioRecorderAuthorizationTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @tc.name should resolve authorization to true
   * @tc.number SUB_RNOH_AUDIO_GETAUTH_RETURN_0001
   * @tc.desc 测试 AudioRecorder 的 requestAuthorization 方法 - 正常授权场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL1
   */
  it('should resolve authorization to true', async () => {
    (AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);
    const result = await AudioRecorder.requestAuthorization();
    expect(result).toBe(true);
    expect(AudioRecorder.requestAuthorization).toHaveBeenCalledTimes(1);
  });
});
```

### 4.2 事件测试文件

```typescript
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * ...
 */

jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioRecorder: {
    prepareRecordingAtPath: jest.fn().mockReturnValue(true),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    onProgress: undefined,
    onFinishRecording: undefined,
  },
  AudioUtils: {
    FilesDirectoryPath: '/data/app/files',
  },
}));

import { AudioRecorder, AudioUtils } from '@react-native-ohos/react-native-audio';

describe('AudioRecorderProgressEventTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    AudioRecorder.onProgress = undefined;
    AudioRecorder.onFinishRecording = undefined;
  });

  /**
   * @tc.name should invoke onProgress callback with correct data
   * @tc.number SUB_RNOH_AUDIO_PROGRESS_EVENT_0001
   * @tc.desc 测试 AudioRecorder 的 onProgress 事件 - 录音进度回调.
   * @tc.type EVENT
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL1
   */
  it('should invoke onProgress callback with correct data', () => {
    const mockProgress = jest.fn();
    AudioRecorder.onProgress = mockProgress;

    const progressData = { currentTime: 1.5 };
    mockProgress(progressData);

    expect(mockProgress).toHaveBeenCalledWith(progressData);
    expect(mockProgress).toHaveBeenCalledTimes(1);
  });

  /**
   * @tc.name should invoke onFinishRecording with status and audioFileURL
   * @tc.number SUB_RNOH_AUDIO_FINISH_EVENT_0001
   * @tc.desc 测试 AudioRecorder 的 onFinishRecording 事件 - 录音完成回调.
   * @tc.type EVENT
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL1
   */
  it('should invoke onFinishRecording with status and audioFileURL', () => {
    const mockFinish = jest.fn();
    AudioRecorder.onFinishRecording = mockFinish;

    const finishData = { status: 'OK', audioFileURL: '/data/app/files/test.aac' };
    mockFinish(finishData);

    expect(mockFinish).toHaveBeenCalledWith(finishData);
    expect(mockFinish).toHaveBeenCalledTimes(1);
  });
});
```

### 4.3 常量测试文件

```typescript
/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * ...
 */

jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioUtils: {
    FilesDirectoryPath: '/data/app/files',
    CachesDirectoryPath: '/data/app/cache',
    MainBundlePath: '/data/app/bundle',
  },
}));

import { AudioUtils } from '@react-native-ohos/react-native-audio';

describe('AudioUtilsConstantsTest', () => {
  /**
   * @tc.name should export non-empty FilesDirectoryPath
   * @tc.number SUB_RNOH_AUDIO_UTILS_RETURN_0001
   * @tc.desc 测试 AudioUtils.FilesDirectoryPath 常量 - 非空验证.
   * @tc.type FUNCTION
   * @tc.size SMALLTEST
   * @tc.level LEVEL1
   */
  it('should export non-empty FilesDirectoryPath', () => {
    expect(AudioUtils.FilesDirectoryPath).toBeDefined();
    expect(typeof AudioUtils.FilesDirectoryPath).toBe('string');
    expect(AudioUtils.FilesDirectoryPath.length).toBeGreaterThan(0);
  });

  /**
   * @tc.name should export non-empty CachesDirectoryPath
   * @tc.number SUB_RNOH_AUDIO_UTILS_RETURN_0002
   * @tc.desc 测试 AudioUtils.CachesDirectoryPath 常量 - 非空验证.
   * @tc.type FUNCTION
   * @tc.size SMALLTEST
   * @tc.level LEVEL1
   */
  it('should export non-empty CachesDirectoryPath', () => {
    expect(AudioUtils.CachesDirectoryPath).toBeDefined();
    expect(typeof AudioUtils.CachesDirectoryPath).toBe('string');
    expect(AudioUtils.CachesDirectoryPath.length).toBeGreaterThan(0);
  });
});
```

---

## 五、测试用例片段模板

### 5.1 同步方法 - 正常参数

```typescript
it('should call {methodName} with correct arguments', () => {
  {ModuleName}.{methodName}({正常参数});
  expect({ModuleName}.{methodName}).toHaveBeenCalledWith({正常参数});
  expect({ModuleName}.{methodName}).toHaveBeenCalledTimes(1);
});
```

### 5.2 同步方法 - 错误参数

```typescript
it('should return false when {condition}', () => {
  ({ModuleName}.{methodName} as jest.Mock).mockReturnValue(false);
  const result = {ModuleName}.{methodName}({错误参数});
  expect(result).toBe(false);
});
```

### 5.3 异步方法 - 正常返回

```typescript
it('should resolve {methodName} to {expectedValue}', async () => {
  ({ModuleName}.{methodName} as jest.Mock).mockResolvedValue({expectedValue});
  const result = await {ModuleName}.{methodName}({正常参数});
  expect(result).toBe({expectedValue});
  expect({ModuleName}.{methodName}).toHaveBeenCalledTimes(1);
});
```

### 5.4 异步方法 - 错误返回

```typescript
it('should reject {methodName} with error', async () => {
  ({ModuleName}.{methodName} as jest.Mock).mockRejectedValue(new Error('{errorMessage}'));
  await expect({ModuleName}.{methodName}({参数})).rejects.toThrow('{errorMessage}');
});
```

### 5.5 事件回调 - 基本验证

```typescript
it('should invoke {eventName} callback with correct data', () => {
  const mockCallback = jest.fn();
  {ModuleName}.{eventName} = mockCallback;
  const eventData = { /* 事件数据 */ };
  mockCallback(eventData);
  expect(mockCallback).toHaveBeenCalledWith(eventData);
  expect(mockCallback).toHaveBeenCalledTimes(1);
});
```

### 5.6 状态转换测试

```typescript
it('should transition through {state1}->{state2}->{state3}', () => {
  ({ModuleName}.{getState} as jest.Mock).mockReturnValue({初始状态});
  {ModuleName}.{触发操作}();
  expect({ModuleName}.{getState}()).toBe({转换后状态});
});
```

---

## 六、导入语句模板

### 6.1 标准导入（Jest 测试）

```typescript
// jest.mock() 必须在 import 之前（Jest 会自动提升）
jest.mock('@react-native-ohos/react-native-audio', () => ({ ... }));

// RN 三方库
import { ModuleName, UtilsName } from '@react-native-ohos/react-native-{name}';
```

### 6.2 导入合并规则

同一包名的导入必须合并为一条语句。
