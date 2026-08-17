# Demo 设计规则

> 本文档详细说明 Demo 的分组原则、五要素规范、平台过滤规则、双计数器模式和 useState 强制规则。

---

## 1. Demo 分组原则

### 原则一：一函数至少一个 Demo

每个**待生成**接口（Phase 4 过滤后）必须被至少一个 Demo 覆盖。

- **全量模式**：覆盖所有 HarmonyOS 平台可用的导出函数/方法/组件
- **增量模式**：仅覆盖 Demo 覆盖率报告中未覆盖的接口

### 原则二：关联接口可合并

满足以下任一条件的接口可合并到同一 Demo：

| 合并条件 | 示例 |
|----------|------|
| 存在明确的调用依赖关系 | `init()` → `execute()` → `release()` |
| 共同完成一个完整业务场景 | "创建实例 → 配置参数 → 执行操作 → 获取结果" |
| 属于同一主题功能簇 | 所有播放控制相关方法 |
| 一个接口的输出是另一个接口的输入 | `scan()` 返回设备列表 → `connect(deviceId)` 使用列表中的 ID |
| 事件注册与移除配对 | `addListener()` 与 `removeListener()` |

> **增量模式特殊规则**：若未覆盖接口与已覆盖接口存在调用依赖，可将未覆盖接口合并到新 Demo 中独立描述。新 Demo 的步骤应自包含，不依赖已覆盖接口的 Demo 步骤。例如：若 `connect()` 已覆盖但 `writeData()` 未覆盖，`writeData()` 的 Demo 步骤中可包含简化的连接步骤作为前置条件，但重点是 `writeData()` 的验证。

### 原则三：禁止无关合并

不同功能方向、无调用关系的接口不得强行合并到同一 Demo。

### 原则四：HarmonyOS 平台过滤

- **排除 iOS 专用接口**：标注为 "iOS 专用"、"iOS Only"、"iOS Platform"、"iOS 独有" 的接口不生成 Demo
- **排除 Android 专用接口**：标注为 "Android 专用"、"Android Only"、"Android Platform"、"Android 独有" 的接口不生成 Demo
- **仅包含跨平台接口**：标记为 "跨平台"、"通用"、"Cross Platform"、"HarmonyOS 支持" 的接口生成 Demo
- **无平台标注接口**：默认视为跨平台，生成 Demo（但在预期结果中建议开发者验证）
- **平台差异说明**：在相关 Demo 步骤中标注 "本功能在 HarmonyOS 平台验证"

---

## 2. Demo 五要素规范

### ① 测试 Demo 名称

- 格式：`[功能动词/名词][操作对象][特征/场景]Demo`
- 限制：不超过 20 字
- 避免泛化词语（如"基础Demo"、"测试Demo"）

| 场景 | 推荐名称 |
|------|---------|
| 单一核心功能 | `蓝牙扫描控制Demo` |
| 生命周期管理 | `模块初始化与释放Demo` |
| 配置类接口 | `参数配置与验证Demo` |
| 异步 Promise | `异步数据加载Demo` |
| 事件监听 | `原生事件订阅与回调Demo` |
| 错误处理 | `异常捕获与错误码处理Demo` |
| 多接口组合 | `完整业务流程Demo` |
| React 组件 | `自定义组件渲染与交互Demo` |

### ② 测试 Demo 描述

模板：
```
{Demo名称}展示了如何使用 {接口名称} 实现 {功能描述}。
通过本 Demo，开发者可以了解 {接口的核心用法/参数含义/返回值处理方式}。
[可选：本 Demo 同时涵盖 {其他关联接口}，展示 {它们之间的调用关系/业务场景}。]
[标注：本 Demo 针对 HarmonyOS 平台的特性/限制。]
```

要求：2-4 句话，说明功能、目的、覆盖接口，明确标注 HarmonyOS 平台特性。

### ③ 测试 Demo 步骤

步骤结构模板：
```
1. 创建函数式组件 Demo 页面（DemoScreen.tsx），使用 useState 声明所需状态变量
   [状态变量列举：const [result, setResult] = useState(''); const [callCount, setCallCount] = useState(0);]，
   使用 useEffect 处理组件挂载/卸载逻辑（事件订阅、资源初始化/释放等），
   布局中添加 [UI组件列表：TouchableOpacity 按钮、TextInput 输入框、Text 展示区、ScrollView 列表等]。
2. [用户操作]，触发 `{接口名称}({参数示例})` 调用，
   在 Promise.then() / await 后 / 事件回调中执行 setXxx() 更新状态变量。
3. 将接口返回值 / 状态变化以 <Text>{value}</Text> 形式展示在 [展示区域名称]。
4. [下一步操作，如有]，验证 [具体行为]。
[可选] 5. 对比 / 补充验证步骤。
```

步骤描述维度要求：

| 维度 | 要求 | 示例 |
|------|------|------|
| 组件构建 | 说明需要哪些 RN 组件 | "使用 View 布局、TouchableOpacity 按钮、Text 显示结果" |
| 状态声明 | 明确 useState 变量及初始值 | `const [status, setStatus] = useState('未初始化')` |
| 交互触发 | 明确用户操作和调用时机 | "点击'开始扫描'按钮，调用 `BluetoothModule.startScan(5000)`" |
| 参数传递 | 说明传入参数来源/示例值 | "传入 timeout=5000（毫秒）" |
| 状态更新 | 说明如何通过 setXxx() 更新 | "在 .then() 回调中执行 `setResult(JSON.stringify(data))`" |
| 结果展示 | 说明如何在页面显示结果 | "以 `<Text>{result}</Text>` 展示返回数据" |
| 验证方式 | 说明如何判断成功 | "确认 Text 显示有效的设备列表，无崩溃" |
| HarmonyOS 平台说明 | 标注特殊行为或限制 | "本功能在 HarmonyOS 平台验证" |

### ④ 测试 Demo 预期结果

模板：
```
1. [页面/UI 状态]：{可观测的界面变化描述}。
2. [接口返回值]：{返回值类型/内容/范围} 符合预期。
3. [功能效果]：{功能方面的可验证效果}。
4. [异常/边界]：{无异常抛出 / 错误信息正确展示 / Promise reject 被捕获}。
[可选] 5. [平台差异]：{HarmonyOS 平台表现说明}。
```

要求：每条预期结果可观测、可判断，特别标注 HarmonyOS 平台的预期行为。

### ⑤ 对应函数接口

列出该 Demo 涉及的所有函数/方法/组件名称。

格式：
- 函数：`` `funcName(paramType): ReturnType` ``
- 组件：`` `<ComponentName prop={type} />` ``
- 多个接口用换行分隔

---

## 3. HarmonyOS 可验证性前置规则（强制）

在为任何接口编写步骤和预期结果之前，必须先判断：**该接口在 HarmonyOS 设备上能否产生可被用户观测到的输出？**

| 情况 | 处理方式 |
|------|----------|
| 接口有明确跨平台标注或 HarmonyOS 支持标注 | 正常作为主步骤，预期结果描述可观测指标 |
| 接口无平台标注（默认跨平台） | 正常作为主步骤，预期结果描述可观测指标，建议开发者验证 |
| 接口标注为 iOS 专用 / Android 专用 | **禁止**作为主步骤；标注「iOS/Android 平台限制，不适用于 HarmonyOS」 |
| 接口依赖 HarmonyOS 原生事件回调 | 正常作为主步骤，预期结果描述可观测指标 |
| 接口依赖 iOS/Android 原生事件回调 | **禁止**作为主步骤；标注「iOS/Android 平台限制」 |
| 接口无任何可观测输出 | 合并到相关流程 Demo 中，通过其他接口的状态变化间接验证 |

**禁止「死按钮」**：Demo 中每个按钮（每个步骤中调用的接口）必须对应至少一条 UI 上可观测的预期结果。若无法提供，该按钮/步骤必须删除或改为平台限制说明。

---

## 4. useState 强制规则

Demo 步骤中包含「计数器（如回调次数、调用次数）」或「状态标志（如是否已初始化）」等运行时变化量时，在步骤或预期结果描述中**必须**注明：

> **该变量须通过 `setXxx()` 更新**

否则 React Native 不会触发重新渲染，计数器将始终显示初始值（如永远显示 0），导致 Demo 验证逻辑完全失效。

正确示例：
```
const [checkCount, setCheckCount] = useState(0);
// 点击按钮时：
setCheckCount(c => c + 1);  // ✅ 通过 setter 更新
```

---

## 5. 异步回调链双计数器诊断模式（强制）

对任何 Demo 中涉及「调用库函数 → 等待 Promise / 监听事件回调」的异步链路，**必须**在 Demo 设计中规划双计数器：

| 计数器位置 | 变量名建议 | 说明 |
|-----------|----------|------|
| 调用/触发前（在触发代码中） | `xxxCallCount` | 接口调用动作的执行次数（通过 `setXxxCallCount(c => c + 1)` 更新） |
| 回调/resolve 内部 | `xxxCallbackCount` | Promise resolve 或事件回调实际触发的次数（通过 `setXxxCallbackCount(c => c + 1)` 更新） |

两个计数器都必须在 Demo 页面的**验证区域**中展示（使用 `<Text>` 组件），且**必须通过 `useState` 的 setter 函数更新**。

### 诊断规则

| 计数器状态 | 诊断结论 |
|-----------|----------|
| `callCount > 0` 且 `callbackCount = 0` | 调用成功但回调未触发，问题在回调注册或原生事件链 |
| `callCount = 0` | 触发代码未执行，问题在 Demo 的触发逻辑 |
| `callCount = callbackCount > 0` | 链路完全正常 |

### 步骤写作规范

```
步骤示例：
1. 在组件中声明计数器：
   const [xxxCallCount, setXxxCallCount] = useState(0);
   const [xxxCallbackCount, setXxxCallbackCount] = useState(0);
2. 触发按钮：setXxxCallCount(c => c + 1)，然后调用 module.doXxx()
3. 在 .then() / await 后 / 事件回调中：setXxxCallbackCount(c => c + 1)，更新其他 UI 状态
4. 验证区域展示：
   <Text>调用次数: {xxxCallCount}</Text>
   <Text>回调次数: {xxxCallbackCount}</Text>
```

---

## 6. RN 常用接口调用模式速查

### NativeModules 调用模式

```typescript
import { NativeModules } from 'react-native';
const { XxxModule } = NativeModules;

// Promise
const result = await XxxModule.someMethod(param);

// Callback
XxxModule.someMethod(param, (error, result) => { ... });
```

### NativeEventEmitter 事件监听模式

```typescript
import { NativeModules, NativeEventEmitter } from 'react-native';
const eventEmitter = new NativeEventEmitter(NativeModules.XxxModule);

// 订阅事件（在 useEffect 中注册）
const subscription = eventEmitter.addListener('eventName', (data) => {
  setXxx(data);
  setCallbackCount(c => c + 1);
});

// 取消订阅（在清理函数中）
return () => subscription.remove();
```

### async/await Promise 调用模式

```typescript
const handlePress = async () => {
  setCallCount(c => c + 1);
  try {
    const result = await SomeModule.doSomething(param);
    setResult(JSON.stringify(result));
    setCallbackCount(c => c + 1);
  } catch (error) {
    setErrorMsg((error as Error).message);
  }
};
```

### React 组件事件回调模式

```typescript
<SomeNativeComponent
  prop1={value1}
  onEvent={(data) => {
    setCallbackCount(c => c + 1);
    setResult(JSON.stringify(data));
  }}
  onError={(err) => setErrorMsg(err.message)}
/>
```
