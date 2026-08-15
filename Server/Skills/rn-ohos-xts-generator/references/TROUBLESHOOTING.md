# RN 三方库 XTS 测试故障排除

> **rn-ohos-xts-generator** - 常见问题解决方案

## 目录

- [Q1: 测试用例调用了不存在的 API](#q1-测试用例调用了不存在的-api)
- [Q2: 事件回调测试超时](#q2-事件回调测试超时)
- [Q3: 权限相关测试失败](#q3-权限相关测试失败)
- [Q4: 路径相关测试失败](#q4-路径相关测试失败)
- [Q5: TurboModule 方法未实现](#q5-turbomodule-方法未实现)
- [Q6: 测试用例命名不符合规范](#q6-测试用例命名不符合规范)
- [Q7: 断言方法错误](#q7-断言方法错误)
- [Q8: Mock 未生效](#q8-mock-未生效)
- [Q9: TypeScript 类型错误](#q9-typescript-类型错误)
- [Q10: 测试相互影响](#q10-测试相互影响)
- [获取帮助](#获取帮助)

---

## Q1: 测试用例调用了不存在的 API

### 错误信息

```
TypeError: Cannot read property 'xxx' of undefined
TypeError: xxx is not a function
```

### 原因

使用了 iOS/Android 分支的 API，而非 HarmonyOS 分支的 API。

### 解决方案

1. 检查三方库入口文件中的 `Platform.OS === 'harmony'` 分支
2. 确认 API 在 HarmonyOS 端是否定义
3. 使用 HarmonyOS 版本的 API（如 `FilesDirectoryPath` 而非 `DocumentDirectoryPath`）

### 预防

使用 rn-ohos-xts-generator 时，确保 `.oh-xts-config.json` 中配置了 `RN_TEST_PROJECT` 路径，技能会自动探查 HarmonyOS 可用的 API。

---

## Q2: 事件回调测试超时

### 错误信息

```
Timeout - Async callback was not invoked within the 5000ms timeout
```

### 原因

HarmonyOS 端的 `emitDeviceEvent` 可能不稳定，事件未在预期时间内触发。

### 解决方案

1. 增加超时时间（如从 5000ms 增加到 10000ms）
2. 确保事件触发条件已满足（如先调用相关方法）
3. 考虑使用轮询作为兜底方案

### 预防

- 事件测试必须设置超时保护
- 事件测试完成后必须清理监听器
- 事件参数验证使用 `expect(value).not.toBeNull()` 而非具体值比较

---

## Q3: 权限相关测试失败

### 错误信息

```
Error: Permission denied
Error: please obtain microphone authorization first
```

### 原因

未在操作前请求运行时权限。

### 解决方案

1. 在测试用例中先调用权限请求方法：
   ```typescript
   let authorized = await AudioRecorder.requestAuthorization();
   expect(authorized).toBe(true);
   ```
2. 在 `module.json5` 中添加所需权限：
   ```json
   {
     "requestPermissions": [
       { "name": "ohos.permission.MICROPHONE" }
     ]
   }
   ```

### 预防

rn-ohos-xts-generator 会自动为涉及权限的 API 生成权限测试用例。

---

## Q4: 路径相关测试失败

### 错误信息

```
TypeError: Cannot read property 'DocumentDirectoryPath' of undefined
```

### 原因

使用了 iOS/Android 的路径常量，HarmonyOS 不支持。

### 解决方案

| iOS/Android | HarmonyOS |
|------------|-----------|
| `DocumentDirectoryPath` | `FilesDirectoryPath` |
| `MainBundlePath` | `BundlePath`（如有） |
| `LibraryDirectoryPath` | 不支持 |
| `ExternalDirectoryPath` | 不支持 |

---

## Q5: TurboModule 方法未实现

### 错误信息

```
Error: not implemented
```

### 原因

ArkTS 端的方法实现为 `throw new Error('not implemented')`。

### 解决方案

1. 探查 ArkTS 实现文件确认方法实现状态
2. 跳过未实现方法的测试
3. 在三方库配置中标记未实现的方法

---

## Q6: 测试用例命名不符合规范

### 错误信息

```
@tc.name format error
```

### 规范

- `@tc.name` 必须使用 `should...when...` 格式
- `@tc.name` 必须与 `it()` 第一个参数完全一致
- `@tc.number` 格式：`SUB_RNOH_[库名]_[API]_[类型]_[序号]`

---

## Q7: 断言方法错误

### 错误信息

```
TypeError: expect(...).assertNotNull is not a function
```

### 原因

使用了 Hypium 断言方法，本技能使用的是 Jest 测试框架。

### 解决方案

```typescript
// ❌ 错误（Hypium 断言）
expect(value).assertNotNull();
expect(value).assertEqual('expected');

// ✅ 正确（Jest 断言）
expect(value).toBeDefined();
expect(value).toBe('expected');
```

---

## Q8: Mock 未生效

### 错误信息

```
Cannot find module '@react-native-ohos/[库名]'
TypeError: xxx.prepareRecordingAtPath is not a function
```

### 原因

- `jest.mock()` 中的模块名与实际导入不一致
- `jest.mock()` 位置错误

### 解决方案

1. 确保 `jest.mock()` 中的模块名与 `import` 完全一致
2. Jest 会自动提升 `jest.mock()` 调用到文件顶部，但如果使用变量则不会
3. 检查 `jest.config.js` 中的 `moduleNameMapper` 配置

```typescript
// ❌ 错误：引用外部变量
const mockValue = true;
jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioRecorder: { prepareRecordingAtPath: jest.fn().mockReturnValue(mockValue) },
}));

// ✅ 正确：使用内联值
jest.mock('@react-native-ohos/react-native-audio', () => ({
  AudioRecorder: { prepareRecordingAtPath: jest.fn().mockReturnValue(true) },
}));
```

---

## Q9: TypeScript 类型错误

### 错误信息

```
Property 'mockReturnValue' does not exist on type '(path: string, options: RecordingOptions) => boolean'
```

### 原因

TypeScript 类型系统不知道 Mock 函数的类型。

### 解决方案

```typescript
// 使用 as jest.Mock 类型断言
(AudioRecorder.prepareRecordingAtPath as jest.Mock).mockReturnValue(true);
(AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);
```

---

## Q10: 测试相互影响

### 错误信息

- 测试单独运行通过，但批量运行失败
- `Expected: 1, Received: 2`（调用次数不对）

### 原因

Mock 状态未在测试之间清理。

### 解决方案

```typescript
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  AudioRecorder.onProgress = undefined;
  AudioRecorder.onFinishRecording = undefined;
});
```

---

## 获取帮助

如果以上方案无法解决问题，请提供以下信息：

1. 三方库名称和版本
2. 完整的错误信息
3. 相关的测试用例代码
4. HarmonyOS 实现文件内容
