# RN 三方库测试模式

---

## 一、RN 三方库测试分类

RN 鸿蒙化三方库的测试按 API 类型分为以下几类：

| 测试类型 | 适用对象 | 说明 |
|---------|---------|------|
| TurboModule 方法测试 | 通过 TurboModule 暴露的原生方法 | 同步/异步方法、参数、返回值、错误码 |
| NativeEventEmitter 事件测试 | 通过 NativeEventEmitter 发送的事件 | 事件回调、事件参数、事件时序 |
| NativeComponent 组件测试 | ArkTS 原生 UI 组件 | 属性、事件、生命周期 |
| 常量/枚举测试 | 导出的常量和枚举值 | 值验证、类型验证 |
| 权限相关测试 | 涉及敏感权限的 API | 授权、拒绝、权限状态 |

---

## 二、TurboModule 方法测试模式

### 2.1 同步方法测试

```typescript
describe('AudioRecorderPrepareTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    const path = AudioUtils.FilesDirectoryPath + '/test_prepare.aac';
    const options = { SampleRate: 22050, Channels: 1, AudioEncoding: 'aac' };
    AudioRecorder.prepareRecordingAtPath(path, options);
    expect(AudioRecorder.prepareRecordingAtPath).toHaveBeenCalledWith(path, options);
    expect(AudioRecorder.prepareRecordingAtPath).toHaveBeenCalledTimes(1);
  });
});
```

### 2.2 异步方法测试（Promise）

```typescript
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

### 2.3 错误码测试

```typescript
describe('AudioRecorderPrepareErrorTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @tc.name should reject when path is empty
   * @tc.number SUB_RNOH_AUDIO_PREPARE_ERROR_401_0001
   * @tc.desc 测试 AudioRecorder 的 prepareRecordingAtPath 方法 - 空路径错误场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL3
   */
  it('should reject when path is empty', async () => {
    (AudioRecorder.prepareRecordingAtPath as jest.Mock).mockReturnValue(false);
    const result = AudioRecorder.prepareRecordingAtPath('', {});
    expect(result).toBe(false);
  });
});
```

### 2.4 边界值测试

```typescript
describe('AudioRecorderPrepareBoundaryTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @tc.name should prepare recording with long path
   * @tc.number SUB_RNOH_AUDIO_PREPARE_BOUNDARY_0001
   * @tc.desc 测试 AudioRecorder 的 prepareRecordingAtPath 方法 - 超长路径边界场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL2
   */
  it('should prepare recording with long path', () => {
    const longName = 'a'.repeat(200);
    const path = AudioUtils.FilesDirectoryPath + '/' + longName + '.aac';
    const options = { SampleRate: 22050, Channels: 1, AudioEncoding: 'aac' };
    AudioRecorder.prepareRecordingAtPath(path, options);
    expect(AudioRecorder.prepareRecordingAtPath).toHaveBeenCalledWith(path, options);
  });
});
```

### 2.5 状态转换测试

```typescript
describe('AudioRecorderStateTransitionTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @tc.name should transition through prepare->start->stop states
   * @tc.number SUB_RNOH_AUDIO_STATE_RETURN_0001
   * @tc.desc 测试 AudioRecorder 录音状态转换 - 准备→开始→停止.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL0
   */
  it('should transition through prepare->start->stop states', () => {
    const path = AudioUtils.FilesDirectoryPath + '/test_state.aac';
    const options = { SampleRate: 22050, Channels: 1, AudioEncoding: 'aac' };

    (AudioRecorder.isRecording as jest.Mock).mockReturnValue(false);
    AudioRecorder.prepareRecordingAtPath(path, options);
    expect(AudioRecorder.isRecording()).toBe(false);

    (AudioRecorder.isRecording as jest.Mock).mockReturnValue(true);
    AudioRecorder.startRecording();
    expect(AudioRecorder.isRecording()).toBe(true);

    (AudioRecorder.isRecording as jest.Mock).mockReturnValue(false);
    AudioRecorder.stopRecording();
    expect(AudioRecorder.isRecording()).toBe(false);
  });
});
```

---

## 三、NativeEventEmitter 事件测试模式

### 3.1 事件回调验证

```typescript
describe('AudioRecorderProgressEventTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @tc.name should invoke onProgress callback with correct data
   * @tc.number SUB_RNOH_AUDIO_PROGRESS_EVENT_0001
   * @tc.desc 测试 AudioRecorder 的 onProgress 事件回调 - 录音进度事件.
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
});
```

### 3.2 事件参数验证

```typescript
describe('AudioRecorderFinishEventTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @tc.name should invoke onFinishRecording with status and audioFileURL
   * @tc.number SUB_RNOH_AUDIO_FINISH_EVENT_0001
   * @tc.desc 测试 AudioRecorder 的 onFinishRecording 事件 - 验证回调数据.
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

---

## 四、NativeComponent 组件测试模式

### 4.1 组件属性测试

```typescript
describe('WebViewSourcePropertyTest', () => {
  /**
   * @tc.name should accept source with valid URL
   * @tc.number SUB_RNOH_WEBVIEW_SOURCE_PARAM_0001
   * @tc.desc 测试 WebView 组件的 source 属性 - URL 加载场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL1
   */
  it('should accept source with valid URL', () => {
    const source = { uri: 'https://www.example.com' };
    expect(source.uri).toBe('https://www.example.com');
  });
});
```

### 4.2 组件事件测试

```typescript
describe('WebViewOnLoadEventTest', () => {
  /**
   * @tc.name should handle onLoad event
   * @tc.number SUB_RNOH_WEBVIEW_ONLOAD_EVENT_0001
   * @tc.desc 测试 WebView 组件的 onLoad 事件 - 页面加载完成事件.
   * @tc.type EVENT
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL1
   */
  it('should handle onLoad event', () => {
    const onLoad = jest.fn();
    const event = { nativeEvent: { url: 'https://www.example.com' } };
    onLoad(event);
    expect(onLoad).toHaveBeenCalledWith(event);
  });
});
```

---

## 五、常量/枚举测试模式

```typescript
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

## 六、权限相关测试模式

### 6.1 权限请求测试

```typescript
describe('AudioRecorderAuthorizationTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * @tc.name should request microphone authorization successfully
   * @tc.number SUB_RNOH_AUDIO_MIC_PERM_0001
   * @tc.desc 测试 AudioRecorder 的 requestAuthorization 方法 - 授权场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL1
   */
  it('should request microphone authorization successfully', async () => {
    (AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);
    const result = await AudioRecorder.requestAuthorization();
    expect(result).toBe(true);
    expect(AudioRecorder.requestAuthorization).toHaveBeenCalledTimes(1);
  });
});
```

### 6.2 权限拒绝测试

```typescript
  /**
   * @tc.name should handle authorization denial
   * @tc.number SUB_RNOH_AUDIO_MIC_PERM_0002
   * @tc.desc 测试 AudioRecorder 的 requestAuthorization 方法 - 拒绝场景.
   * @tc.type FUNCTION
   * @tc.size MEDIUMTEST
   * @tc.level LEVEL3
   */
  it('should handle authorization denial', async () => {
    (AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(false);
    const result = await AudioRecorder.requestAuthorization();
    expect(result).toBe(false);
  });
```

---

## 七、测试生命周期管理

### 7.1 beforeAll / afterAll

```typescript
describe('AudioRecorderFullFlowTest', () => {
  let testPath: string = '';

  beforeAll(() => {
    testPath = AudioUtils.FilesDirectoryPath + '/test_full_flow.aac';
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    AudioRecorder.onProgress = undefined;
    AudioRecorder.onFinishRecording = undefined;
  });
});
```

### 7.2 测试隔离原则

- ✅ 每个测试用例应独立运行，不依赖其他测试的执行结果
- ✅ `beforeEach` 中调用 `jest.clearAllMocks()` 清理 Mock 状态
- ✅ `afterEach` 中清理事件回调
- ❌ 不要在测试用例之间共享可变状态

---

## 八、RN 三方库特有注意事项

### 8.1 平台兼容性

- ✅ 只测试 `Platform.OS === 'harmony'` 分支中定义的 API
- ❌ 禁止测试仅在 iOS/Android 分支中存在的 API
- ✅ 路径常量使用 HarmonyOS 版本

### 8.2 HarmonyOS 特有 API 替代

| iOS/Android API | HarmonyOS 替代 | 说明 |
|----------------|---------------|------|
| `DocumentDirectoryPath` | `FilesDirectoryPath` | 文件存储路径 |
| `MainBundlePath` | `BundlePath`（如有） | 应用资源路径 |
| `fetch()` 写文件 | 不支持 | 使用原生文件 API |
| `console.error()` | `console.warn()` | 避免系统弹窗 |

### 8.3 Mock 使用原则

- 所有原生模块必须通过 `jest.mock()` 模拟
- Mock 必须覆盖所有导出的方法和常量
- 使用 `jest.clearAllMocks()` 在 `beforeEach` 中清理
- 异步方法使用 `mockResolvedValue` / `mockRejectedValue`
- 同步方法使用 `mockReturnValue`

### 8.4 权限处理

- 涉及敏感权限的 API 必须先请求权限
- 权限测试需要考虑授权和拒绝两种场景
- 使用 Mock 模拟权限结果，无需实际系统权限
