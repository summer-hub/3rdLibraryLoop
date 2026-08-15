# RN Jest 测试问题排查

---

## 一、常见问题

### Q1: Mock 未生效 - 模块导入失败

**错误信息**：
```
Cannot find module '@react-native-ohos/[库名]'
```

**原因**：
- `jest.mock()` 中的模块名与实际导入不一致
- `jest.config.js` 中缺少 `moduleNameMapper`

**解决方案**：
1. 确保 `jest.mock()` 中的模块名与 `import` 完全一致
2. 在 `jest.config.js` 中配置 `moduleNameMapper`：
   ```javascript
   moduleNameMapper: {
     '^@react-native-ohos/(.*)$': '<rootDir>/__mocks__/@react-native-ohos/$1',
   }
   ```
3. 确保 `transformIgnorePatterns` 包含 `@react-native-ohos`

---

### Q2: TypeScript 类型错误

**错误信息**：
```
Property 'mockReturnValue' does not exist on type '(path: string, options: RecordingOptions) => boolean'
```

**原因**：
- TypeScript 类型系统不知道 Mock 函数的类型

**解决方案**：
```typescript
// 使用 as jest.Mock 类型断言
(AudioRecorder.prepareRecordingAtPath as jest.Mock).mockReturnValue(true);
(AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);
```

---

### Q3: 测试相互影响

**错误信息**：
- 测试单独运行通过，但批量运行失败
- `Expected: 1, Received: 2`（调用次数不对）

**原因**：
- Mock 状态未在测试之间清理

**解决方案**：
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

### Q4: 测试用例调用了不存在的 API

**错误信息**：
```
TypeError: Cannot read property 'xxx' of undefined
```

**原因**：
- 测试用例使用了 iOS/Android 分支的 API
- HarmonyOS 端未实现该 API

**解决方案**：
1. 检查源码中 `Platform.OS === 'harmony'` 分支
2. 确认 API 在 HarmonyOS 端已实现
3. 移除对不支持 API 的测试

---

### Q5: 异步测试超时

**错误信息**：
```
Timeout - Async callback was not invoked within the 5000 ms timeout
```

**原因**：
- 异步 Mock 未正确设置返回值
- Promise 未 resolve/reject

**解决方案**：
```typescript
// 确保异步 Mock 返回 Promise
(AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);

// 或增加超时时间
it('should handle slow operation', async () => {
  // ...
}, 10000);
```

---

### Q6: jest.mock() 位置错误

**错误信息**：
```
The module factory of `jest.mock()` is not allowed to reference any out-of-scope variables.
```

**原因**：
- `jest.mock()` 的工厂函数中引用了外部变量

**解决方案**：
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

### Q7: 测试用例命名不符合规范

**错误信息**：
```
@tc.name format error
```

**解决方案**：
1. `@tc.name` 必须与 `it()` 第一个参数完全一致
2. `@tc.number` 格式：`SUB_RNOH_[库名]_[API]_[类型]_[序号]`

---

## 二、调试技巧

### 2.1 本地运行验证

```bash
# 运行所有测试
npm test

# 运行指定文件
npx jest __tests__/AudioRecorderTest.test.ts

# 详细输出
npx jest --verbose

# 覆盖率报告
npx jest --coverage
```

### 2.2 Mock 调试

```typescript
// 打印 Mock 调用记录
console.log(AudioRecorder.prepareRecordingAtPath.mock.calls);

// 打印最后一次调用参数
console.log(AudioRecorder.prepareRecordingAtPath.mock.lastCall);
```

### 2.3 逐步排查

1. 先确认 `jest.mock()` 正确配置
2. 再确认 `import` 语句正确
3. 最后确认断言方法正确
