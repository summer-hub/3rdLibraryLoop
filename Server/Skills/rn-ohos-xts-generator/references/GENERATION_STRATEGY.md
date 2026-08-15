# RN 三方库测试用例生成策略

---

## 一、模块概述

测试用例生成器根据 RN 三方库源码解析结果，按照 API 类型（TurboModule 方法、事件回调、NativeComponent、常量）自动生成符合 XTS 规范的测试用例。

---

## 二、TurboModule 方法测试生成

### 2.1 同步方法测试规则

| 参数类型 | 必须测试的场景 | 生成的测试用例数 |
|---------|---------------|----------------|
| **string** | 正常值、空字符串、特殊字符 | 3-4 个 |
| **number** | 正数、负数、0、边界值 | 4-5 个 |
| **boolean** | true、false | 2 个 |
| **枚举** | 每个枚举值、无效值 | 枚举值+1 个 |
| **对象** | 正常对象、空对象、缺少属性 | 3-4 个 |
| **可选参数** | 传入、不传 | 2 个 |

### 2.2 异步方法测试规则

| 场景 | 测试内容 | 测试用例数 |
|------|---------|-----------|
| 正常返回 | Promise resolve | 1 个 |
| 错误返回 | Promise reject | 1-2 个 |
| 超时 | 长时间等待 | 1 个 |

### 2.3 状态方法测试规则

对于返回状态信息的方法（如 `isRecording()`）：

| 场景 | 测试内容 |
|------|---------|
| 初始状态 | 调用前验证初始值 |
| 状态转换 | 操作后验证状态变化 |
| 多次转换 | 连续操作后验证最终状态 |

---

## 三、事件测试生成策略

### 3.1 事件测试规则

| 场景 | 测试内容 | 测试用例数 |
|------|---------|-----------|
| 事件触发 | 验证事件是否被触发 | 1 个 |
| 事件参数 | 验证回调数据正确性 | 1-2 个 |
| 事件时序 | 验证事件触发顺序 | 1 个 |
| 事件清理 | 验证移除监听器后不再触发 | 1 个 |

### 3.2 事件测试模板要点

- ✅ 必须设置超时保护（5-10 秒）
- ✅ 使用 `done: Function` 回调标记异步完成
- ✅ `afterEach` 中清理监听器
- ✅ 事件参数使用 `expect(value).not.toBeNull()` 而非具体值比较
- ❌ 不要假设事件在固定时间内触发

---

## 四、NativeComponent 测试生成策略

### 4.1 属性测试规则

| 属性类型 | 测试场景 | 测试用例数 |
|---------|---------|-----------|
| string | 正常值、空字符串、特殊字符 | 3 个 |
| number | 正数、0、负数、边界值 | 4 个 |
| boolean | true、false | 2 个 |
| enum | 每个枚举值 | 枚举值 个 |
| callback | 正常函数、null | 2 个 |

### 4.2 事件测试规则

| 场景 | 测试内容 |
|------|---------|
| 事件触发 | 验证组件事件是否被触发 |
| 事件参数 | 验证事件回调参数 |

---

## 五、常量/枚举测试生成策略

### 5.1 路径常量测试

```typescript
it('should export non-empty FilesDirectoryPath', () => {
  expect(AudioUtils.FilesDirectoryPath).toBeDefined();
  expect(typeof AudioUtils.FilesDirectoryPath).toBe('string');
  expect(AudioUtils.FilesDirectoryPath.length).toBeGreaterThan(0);
});
```

### 5.2 枚举值测试

```typescript
it('should export correct AudioEncoder AAC value', () => {
  expect(AudioEncoder.AAC).toBe('aac');
});

it('should export all AudioEncoder values', () => {
  const encodings = Object.values(AudioEncoder);
  expect(encodings.length).toBeGreaterThan(0);
});
```

---

## 六、权限测试生成策略

### 6.1 权限请求测试

```typescript
it('should request microphone authorization successfully', async () => {
  (AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(true);
  const result = await AudioRecorder.requestAuthorization();
  expect(result).toBe(true);
  expect(AudioRecorder.requestAuthorization).toHaveBeenCalledTimes(1);
});
```

### 6.2 权限状态检查

```typescript
it('should check authorization status', async () => {
  (AudioRecorder.checkAuthorizationStatus as jest.Mock).mockResolvedValue(true);
  const status = await AudioRecorder.checkAuthorizationStatus();
  expect(typeof status).toBe('boolean');
});
```

### 6.3 无权限操作测试

```typescript
it('should throw error when starting recording without permission', async () => {
  (AudioRecorder.requestAuthorization as jest.Mock).mockResolvedValue(false);
  const authorized = await AudioRecorder.requestAuthorization();
  expect(authorized).toBe(false);
});
```

---

## 七、测试用例数量估算

### 7.1 估算公式

```
总测试用例数 = Σ(每个 API 的测试用例数)

TurboModule 同步方法: 3-6 个/方法
TurboModule 异步方法: 2-3 个/方法
事件回调: 2-4 个/事件
NativeComponent 属性: 2-3 个/属性
常量: 1-2 个/常量
权限: 1-2 个/权限
```

### 7.2 估算示例

```
react-native-audio:
- prepareRecordingAtPath (同步, 2参数): 5 个
- startRecording (同步, 0参数): 2 个
- stopRecording (同步, 0参数): 2 个
- pauseRecording (同步, 0参数): 2 个
- resumeRecording (同步, 0参数): 2 个
- isRecording (同步, 0参数): 3 个
- requestAuthorization (异步): 2 个
- onProgress (事件): 3 个
- onFinishRecording (事件): 3 个
- AudioUtils 常量 (3个): 3 个
- 权限测试: 2 个
总计: 约 29 个测试用例
```

---

## 八、生成优先级

### 8.1 优先级排序

| 优先级 | 测试类型 | 理由 |
|--------|---------|------|
| P0 | 核心流程测试 | 验证库的基本功能 |
| P1 | 正常参数测试 | 验证 API 的正确行为 |
| P1 | 返回值测试 | 验证返回数据的正确性 |
| P2 | 事件测试 | 验证事件回调机制 |
| P2 | 边界值测试 | 验证边界条件处理 |
| P3 | 错误码测试 | 验证错误处理机制 |
| P3 | 常量验证 | 验证导出的常量值 |
