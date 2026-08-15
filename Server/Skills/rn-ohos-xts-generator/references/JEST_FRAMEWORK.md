# Jest 测试框架基础

---

## 一、Jest 框架概述

Jest 是 React Native 默认的 JavaScript 测试框架，由 Facebook 开发。RN 三方库的 XTS 测试基于 Jest 框架编写，通过 `jest.mock()` 模拟原生模块，实现单元测试和集成测试。

**核心特性**：
- 零配置开箱即用（配合 `preset: 'react-native'`）
- 内置 Mock 功能（`jest.fn()`、`jest.mock()`、`jest.spyOn()`）
- 快照测试
- 异步测试支持（`async/await`）
- 覆盖率报告（`--coverage`）

---

## 二、断言方法列表

> **重要提示**：生成脚本时请从列表中选择，**不要编造方法名**

### 2.1 相等性断言

| No. | API | 功能说明 | 示例 |
|:---|:---|:---|:---|
| 1 | toBe | 严格相等（===） | `expect(value).toBe(1)` |
| 2 | toEqual | 深度相等 | `expect(obj).toEqual({a: 1})` |
| 3 | toStrictEqual | 严格深度相等（含类实例） | `expect(obj).toStrictEqual(instance)` |

### 2.2 真值断言

| No. | API | 功能说明 | 示例 |
|:---|:---|:---|:---|
| 4 | toBeTruthy | 真值 | `expect(value).toBeTruthy()` |
| 5 | toBeFalsy | 假值 | `expect(value).toBeFalsy()` |
| 6 | toBeNull | null | `expect(value).toBeNull()` |
| 7 | toBeUndefined | undefined | `expect(value).toBeUndefined()` |
| 8 | toBeDefined | 非 undefined | `expect(value).toBeDefined()` |
| 9 | toBeNaN | NaN | `expect(value).toBeNaN()` |

### 2.3 数值比较

| No. | API | 功能说明 | 示例 |
|:---|:---|:---|:---|
| 10 | toBeGreaterThan | 大于 | `expect(n).toBeGreaterThan(0)` |
| 11 | toBeGreaterThanOrEqual | 大于等于 | `expect(n).toBeGreaterThanOrEqual(1)` |
| 12 | toBeLessThan | 小于 | `expect(n).toBeLessThan(10)` |
| 13 | toBeLessThanOrEqual | 小于等于 | `expect(n).toBeLessThanOrEqual(5)` |
| 14 | toBeCloseTo | 接近（浮点数） | `expect(0.1+0.2).toBeCloseTo(0.3)` |

### 2.4 字符串/数组/对象

| No. | API | 功能说明 | 示例 |
|:---|:---|:---|:---|
| 15 | toContain | 包含（数组/字符串） | `expect(arr).toContain(item)` |
| 16 | toHaveLength | 长度 | `expect(arr).toHaveLength(3)` |
| 17 | toMatch | 正则匹配 | `expect(str).toMatch(/pattern/)` |
| 18 | toMatchObject | 部分匹配对象 | `expect(obj).toMatchObject({a: 1})` |
| 19 | toHaveProperty | 包含属性 | `expect(obj).toHaveProperty('a')` |

### 2.5 函数调用验证

| No. | API | 功能说明 | 示例 |
|:---|:---|:---|:---|
| 20 | toHaveBeenCalled | 被调用过 | `expect(fn).toHaveBeenCalled()` |
| 21 | toHaveBeenCalledTimes | 调用次数 | `expect(fn).toHaveBeenCalledTimes(2)` |
| 22 | toHaveBeenCalledWith | 以指定参数调用 | `expect(fn).toHaveBeenCalledWith(arg)` |
| 23 | toHaveBeenLastCalledWith | 最后一次调用参数 | `expect(fn).toHaveBeenLastCalledWith(arg)` |

### 2.6 异常断言

| No. | API | 功能说明 | 示例 |
|:---|:---|:---|:---|
| 24 | toThrow | 抛出异常 | `expect(fn).toThrow()` |
| 25 | toThrowError | 抛出指定错误 | `expect(fn).toThrowError('msg')` |
| 26 | rejects.toThrow | 异步抛出异常 | `await expect(promise).rejects.toThrow()` |
| 27 | resolves.toBe | 异步解析为 | `await expect(promise).resolves.toBe(value)` |

### 2.7 取反

| No. | API | 功能说明 | 示例 |
|:---|:---|:---|:---|
| 28 | not | 断言取反 | `expect(value).not.toBe(null)` |

---

## 三、Mock 机制

### 3.1 jest.mock() - 模块模拟

```typescript
// 自动模拟整个模块
jest.mock('@react-native-ohos/react-native-audio');

// 自定义模拟实现
jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioRecorder: {
    prepareRecordingAtPath: jest.fn().mockReturnValue(true),
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
  },
  AudioUtils: {
    FilesDirectoryPath: '/data/app/files',
  },
}));
```

### 3.2 jest.fn() - Mock 函数

```typescript
// 创建 Mock 函数
const mockFn = jest.fn();

// 带默认返回值
const mockFn = jest.fn().mockReturnValue(true);

// 带默认 Promise 返回值
const mockFn = jest.fn().mockResolvedValue({ status: 'OK' });

// 带默认 Promise 拒绝值
const mockFn = jest.fn().mockRejectedValue(new Error('failed'));

// 带自定义实现
const mockFn = jest.fn().mockImplementation((path, options) => {
  return path.endsWith('.aac');
});
```

### 3.3 Mock 状态管理

```typescript
beforeEach(() => {
  jest.clearAllMocks();  // 清除所有 Mock 调用记录和实现
});

afterEach(() => {
  jest.restoreAllMocks();  // 恢复所有 Mock
});
```

### 3.4 Mock 属性赋值

```typescript
// Mock 回调属性
AudioRecorder.onProgress = jest.fn();
AudioRecorder.onFinished = jest.fn();

// 模拟触发回调
AudioRecorder.onProgress({ currentTime: 1.5 });
expect(AudioRecorder.onProgress).toHaveBeenCalledWith({ currentTime: 1.5 });
```

---

## 四、导入语句规范

### 4.1 标准导入（RN 三方库测试）

```typescript
// jest.mock() 必须在 import 之前
jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioRecorder: { ... },
  AudioUtils: { ... },
}));

import { AudioRecorder, AudioUtils } from '@react-native-ohos/react-native-audio';
```

### 4.2 导入合并

同一包名的导入必须合并：

```typescript
// ✅ 正确
import { AudioRecorder, AudioUtils } from '@react-native-ohos/react-native-audio';

// ❌ 错误
import { AudioRecorder } from '@react-native-ohos/react-native-audio';
import { AudioUtils } from '@react-native-ohos/react-native-audio';
```

---

## 五、RN 三方库测试常用断言模式

### 5.1 TurboModule 方法调用验证

```typescript
it('should call prepareRecordingAtPath with correct args', () => {
  AudioRecorder.prepareRecordingAtPath('/path/test.aac', { SampleRate: 22050 });
  expect(AudioRecorder.prepareRecordingAtPath).toHaveBeenCalledWith('/path/test.aac', { SampleRate: 22050 });
  expect(AudioRecorder.prepareRecordingAtPath).toHaveBeenCalledTimes(1);
});
```

### 5.2 异步方法返回值验证

```typescript
it('should resolve authorization to true', async () => {
  (AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);
  const result = await AudioRecorder.requestAuthorization();
  expect(result).toBe(true);
});
```

### 5.3 异步方法错误验证

```typescript
it('should reject when authorization denied', async () => {
  (AudioRecorder.requestAuthorization as jest.Mock).mockRejectedValue(new Error('denied'));
  await expect(AudioRecorder.requestAuthorization()).rejects.toThrow('denied');
});
```

### 5.4 事件回调验证

```typescript
it('should invoke onProgress callback with correct data', () => {
  const mockProgress = jest.fn();
  AudioRecorder.onProgress = mockProgress;
  mockProgress({ currentTime: 1.5 });
  expect(mockProgress).toHaveBeenCalledWith({ currentTime: 1.5 });
  expect(mockProgress).toHaveBeenCalledTimes(1);
});
```

### 5.5 常量值验证

```typescript
it('should export FilesDirectoryPath', () => {
  expect(AudioUtils.FilesDirectoryPath).toBeDefined();
  expect(typeof AudioUtils.FilesDirectoryPath).toBe('string');
  expect(AudioUtils.FilesDirectoryPath.length).toBeGreaterThan(0);
});
```
