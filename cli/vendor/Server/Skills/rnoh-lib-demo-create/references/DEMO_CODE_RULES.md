# Demo 代码规则

> Demo 代码生成必须遵循以下规范，确保在 HarmonyOS 平台正确运行。

---

## 1. 目录结构

在 Phase 1.2 探查到的 `exampleDir` 下创建 Demo 目录：

```
{exampleDir}/{libName}/
├── index.tsx                  # 主入口（Tester 框架 + 元数据导出）
└── demo/
    ├── 001_{描述1}Page.tsx    # 每个 Demo 一个文件
    ├── 002_{描述2}Page.tsx
    └── ...
```

`{exampleDir}` 由探查确定，不硬编码。常见值：`rn-tester/examples/`、`example/src/`、`demo/src/` 等。

### 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 目录 | `{序号}_{kebab-case描述}` | `001_basic-gradient` |
| 文件 | `{描述}Page.tsx` | `BasicGradientPage.tsx` |
| 类名 | `{PascalCase}Page` | `BasicGradientPage` |
| TAG 常量 | `库_页面名` | `LinearGradient_BasicGradientPage` |

---

## 2. 导入顺序

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { ComponentName } from '@react-native-ohos/{libName}';
```

### 2.1 type 导入规范

对于仅有类型定义的导出（如 `EdgeInsets`、`Metrics`），使用 TypeScript inline type 语法，与运行时导出混写在同一条 import 语句中：

```typescript
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowSafeAreaInsets,
  type EdgeInsets,
} from 'react-native-safe-area-context';
```

> ✅ 使用 `import { type EdgeInsets }` inline type 语法
> ❌ 不使用 `import type { EdgeInsets } from '...'`（无法与运行时导出混写）

---

## 3. 组件结构规范

### 3.1 根组件

- ❌ **不要使用** `SafeAreaView` 和 `StatusBar`
- ❌ **不要使用** `ScrollView` 作为 Demo 页面的根容器
- ✅ **使用** `View` 作为 Demo 页面的根容器

```typescript
return (
  <View style={styles.container}>
    {/* Demo 内容 */}
  </View>
);
```

### 3.2 ScrollView 嵌套问题

- Tester 框架的 `TestCase` 组件内部已包含 `ScrollView`
- Demo 页面再用 `ScrollView` 作为根容器 → 嵌套 ScrollView → HarmonyOS 上内层高度塌陷为 0 → Demo 完全不可见
- **主入口文件 index.tsx 的最外层可以使用 ScrollView**（不在 TestCase 内部）
- **Demo 页面文件（00X_xxxPage.tsx）的根组件必须用 View**

### 3.3 Hook 调用位置约束

Hook 必须在组件顶层调用，不可在事件回调、条件分支、循环中调用。对于依赖 Context 值的 Hook（如 `useSafeAreaInsets()`、`useSafeArea()`），必须放在对应 Provider 的子组件中：

```typescript
// ✅ 正确：拆分 InnerComponent，Hook 在 Provider 子组件中调用
const InnerComponent = () => {
  const insets = useSafeArea(); // Hook 在组件顶层，且在 SafeAreaProvider 子组件中
  return <Text>{JSON.stringify(insets)}</Text>;
};

const DemoPage = () => {
  return (
    <View style={styles.container}>
      <SafeAreaProvider>
        <InnerComponent />
      </SafeAreaProvider>
    </View>
  );
};

// ❌ 错误：Hook 在 Provider 外部调用，Context 无值会抛出异常
const DemoPage = () => {
  const insets = useSafeArea(); // 抛出 NO_INSETS_ERROR
  return <SafeAreaProvider><Text>{JSON.stringify(insets)}</Text></SafeAreaProvider>;
};

// ❌ 错误：Hook 在事件回调中调用
const handlePress = () => {
  const insets = useSafeArea(); // 违反 Hook 规则
};
```

### 3.4 Provider 子组件拆分

当 Demo 需要验证依赖 Context 的接口时，须将使用该接口的组件拆分为独立子组件，放在 Provider 内部渲染：

| 场景 | 拆分方式 | 示例 |
|------|----------|------|
| Hook 依赖 Context | 拆分 InnerComponent，Hook 在其中调用 | `useSafeArea()` 在 `SafeAreaProvider` 子组件中 |
| Consumer 组件 | 直接在 Provider 内部渲染 | `<SafeAreaConsumer>{(insets) => ...}</SafeAreaConsumer>` |
| Provider 注入初始值 | Provider 包裹子组件，子组件读取注入值 | `<SafeAreaProvider initialSafeAreaInsets={...}><Inner /></SafeAreaProvider>` |

---

## 4. 状态管理

```typescript
const TAG = '{libName}_{DemoName}';

React.useEffect(() => {
  console.log(`[${TAG}] Component mounted`);
  return () => {
    console.log(`[${TAG}] Component unmounted`);
  };
}, []);

const handleAction = useCallback(() => {
  console.log(`[${TAG}] Action triggered`);
}, []);
```

---

## 5. 禁止使用的组件和 API

| 禁止项 | 原因 | 替代方案 |
|--------|------|----------|
| `Slider` | HarmonyOS 不支持 | 按钮组控制数值 |
| `SafeAreaView` | Tester 框架不需要 | `View` |
| `StatusBar` | Tester 框架不需要 | 移除 |
| `console.error()` | 触发系统弹窗 | `console.warn()` |
| `fetch` API 文件操作 | HarmonyOS 不支持 | 库自身 API 或原生文件 API |

### Slider 替代方案

```typescript
<View style={styles.buttonRow}>
  <TouchableOpacity onPress={() => handleValueChange(-0.1)}>
    <Text>-0.1</Text>
  </TouchableOpacity>
  <TouchableOpacity onPress={() => handleValueChange(0.01)}>
    <Text>+0.01</Text>
  </TouchableOpacity>
</View>
```

---

## 6. 平台兼容性

基于源码探查的 `Platform.OS === 'harmony'` 分支结果：

- **只使用** harmony 分支中定义的属性、常量和 API
- **禁止使用**仅在 iOS/Android 分支中存在的属性（HarmonyOS 下为 `undefined`，导致运行时报错）

### 常见陷阱

| 陷阱 | iOS/Android | HarmonyOS |
|------|-------------|-----------|
| 路径常量 | `DocumentDirectoryPath` | `FilesDirectoryPath` |
| 路径常量 | `CachesDirectoryPath` | `CacheDirectoryPath` |
| 路径常量 | `MainBundlePath`（iOS） | 不存在 |

### 事件监听

使用源码探查到的事件名称，不要猜测。区分 Promise 方法（需要 `async/await`）和同步方法。

---

## 6.1 废弃接口验证技巧

当 Demo 需要验证 `@deprecated` 废弃接口的兼容性时，使用以下技巧：

### 引用相等性比较

废弃别名接口通常是直接赋值（`export const SafeAreaContext = SafeAreaInsetsContext`），使用 `===` 比较引用是最可靠的验证方式：

```typescript
const [isSameContext, setIsSameContext] = useState(false);

const handleVerify = useCallback(() => {
  setIsSameContext(SafeAreaContext === SafeAreaInsetsContext);
}, []);
```

> ✅ 引用相等性比较（`===`）比功能对比更可靠
> ❌ 不要用 `JSON.stringify()` 比较后转回对象比较

### 废弃 Hook 验证

废弃 Hook（如 `useSafeArea()`）内部通常调用非废弃 Hook（如 `useSafeAreaInsets()`），验证时展示返回值一致即可：

```typescript
const insets = useSafeArea();
// 直接展示返回值，验证其为有效的 EdgeInsets 对象
<Text>useSafeArea 返回: {JSON.stringify(insets)}</Text>
```

### 废弃常量验证

废弃常量（如 `initialWindowSafeAreaInsets`）通常派生自非废弃常量（如 `initialWindowMetrics?.insets`），在 `useEffect` 中读取并展示：

```typescript
useEffect(() => {
  setWindowInsetsText(initialWindowSafeAreaInsets ? JSON.stringify(initialWindowSafeAreaInsets) : 'null');
}, []);
```

### 废弃 Props 验证

废弃 Props（如 `initialSafeAreaInsets`）作为 Provider 的 fallback 值，通过子组件读取注入的初始值来验证：

```typescript
const customInitialInsets: EdgeInsets = { top: 50, right: 0, bottom: 50, left: 0 };

<SafeAreaProvider initialSafeAreaInsets={customInitialInsets}>
  <InnerComponent onInsets={handleInsets} />
</SafeAreaProvider>
```

---

## 7. 权限请求

涉及敏感权限的操作（麦克风、相机、定位、存储等），**必须在操作前主动请求权限**：

```typescript
const handleStartRecording = useCallback(async () => {
  try {
    const authorized = await AudioRecorder.requestAuthorization();
    if (!authorized) {
      setResultInfo('权限被拒绝，请在设置中开启');
      return;
    }
    // 继续执行操作...
  } catch (error: any) {
    setResultInfo(`失败: ${error?.message || error}`);
  }
}, []);
```

**规则**：
- 涉及麦克风：录音前必须调用 `requestAuthorization()`
- 涉及相机：拍照/录像前必须请求相机权限
- 涉及定位：获取位置前必须请求位置权限
- 涉及存储：读写文件前可能需要请求存储权限
- **不要假设权限已授予**，即使 manifest 中已声明权限

---

## 8. 原生事件兜底方案

HarmonyOS 端的 `emitDeviceEvent` 事件传递可能不稳定。对于需要实时更新的数据，**使用 JS 端计时器兜底**：

```typescript
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
const startTimeRef = useRef<number>(0);

const startTimer = useCallback(() => {
  startTimeRef.current = Date.now();
  timerRef.current = setInterval(() => {
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    setRecordingTime(elapsed);
  }, 100);
}, []);

const clearTimer = useCallback(() => {
  if (timerRef.current !== null) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }
}, []);

// 开始录音时启动计时器
startTimer();

// 停止录音时只清除计时器，不重置时长（保留最终值）
clearTimer();
```

**规则**：
- 可同时保留原生事件回调（`onProgress`）和 JS 计时器，以原生事件为主、JS 计时器为兜底
- 停止操作时**只清除计时器，不要重置时长**（用户需要看到最终时长）
- 涉及暂停/恢复功能时，计时器需支持暂停（停止 interval）和恢复（重新启动 interval，累计已过时长）
- 组件卸载时必须清除计时器，防止内存泄漏

---

## 9. 日志输出规范

| 方法 | 行为 | 使用场景 |
|------|------|----------|
| `console.error()` | ❌ 触发系统弹窗，阻断用户操作 | **禁止使用** |
| `console.warn()` | ✅ 仅输出黄色警告日志，不弹窗 | 错误信息输出 |
| `console.log()` | ✅ 正常日志输出 | 调试日志 |

```typescript
// ❌ 错误：会弹窗
console.error(`[${TAG}] Failed: ${error}`);

// ✅ 正确：只输出警告
console.warn(`[${TAG}] Failed: ${error?.message || error}`);
```

---

## 10. 异步处理

使用 `async/await` + `try/catch`，不用 `.then()/.catch()` 链式调用：

```typescript
// ✅ 正确
const handleAction = useCallback(async () => {
  try {
    const result = await someAsyncAPI();
    setResult(result);
  } catch (error: any) {
    console.warn(`[${TAG}] Failed: ${error?.message || error}`);
  }
}, []);

// ❌ 禁止
someAsyncAPI()
  .then(result => setResult(result))
  .catch(error => console.error(error));
```

---

## 11. 样式定义

使用 `StyleSheet.create` 定义所有样式，包含完整的 UI 元素样式：

```typescript
const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5', marginBottom: 12 },
  button: { padding: 12, borderRadius: 6, backgroundColor: '#007AFF', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 14 },
  buttonRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  text: { fontSize: 14, color: '#333' },
});
```

---

## 12. 组件定义风格

```typescript
const ComponentName = () => {
  // hooks
  // handlers
  return (
    <View style={styles.container}>
      {/* 内容 */}
    </View>
  );
};

export default ComponentName;
```

---

## 13. 禁止事项汇总

❌ **不要**：
- 添加任何注释（代码中不使用 `//` 或 `/* */`）
- 创建不必要的文件（如 README.md，除非明确要求）
- 生成 TODO/FIXME 占位符
- 使用不存在的组件或 API
- 使用 iOS/Android 的 API 属性，必须检查 `Platform.OS === 'harmony'` 分支
- 照搬官方文档或 npm 上的示例代码，未验证 HarmonyOS 平台兼容性
- 使用 `ScrollView` 作为 Demo 页面的根组件
- 使用 `console.error()` 输出错误日志
- 使用 `fetch` API 进行文件系统读写操作
- 在涉及敏感权限的操作前不请求权限
- 停止操作时重置计时/计数值为 0（应保留最终值）
- 使用 `Slider` 组件
- 在事件回调/条件分支/循环中调用 Hook
- 在 Provider 外部调用依赖 Context 的 Hook
- 使用 `import type { ... }` 单独导入类型（应使用 inline `type` 语法混写）
- 用 `JSON.stringify()` 比较废弃别名（应使用 `===` 引用比较）

✅ **应该**：
- 所有状态更新通过 setState() 进行
- 使用 React 最佳实践（hooks, memoization）
- 保持代码简洁和可读
- 遵循现有项目的代码风格
- 先探查 JS 层接口与平台兼容性再生成 Demo 代码
- 使用 `View` 作为 Demo 页面的根组件
- 使用 `console.warn()` 替代 `console.error()`
- 在涉及敏感权限的操作前主动调用权限请求 API
- 对需要实时更新的数据使用 JS 端计时器兜底
- 停止操作时保留最终计时/计数值
- 使用 `async/await` + `try/catch`
- Hook 在组件顶层调用，依赖 Context 的 Hook 放在 Provider 子组件中
- 使用 `import { type EdgeInsets }` inline type 语法
- 废弃别名验证使用 `===` 引用相等性比较
- 依赖 Context 的组件拆分为 Provider 子组件
