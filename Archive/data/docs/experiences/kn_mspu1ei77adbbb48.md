## TurboModule 库（非 Fabric 组件）的测试策略差异

### 问题现象
NetInfo 是一个 TurboModule 库，不是 Fabric 组件库。按照 Fabric 组件库的测试策略编写 jest 单元测试时，会出现 mock 策略不匹配的问题：不需要 mock `codegenNativeComponent` 生成的 Fabric 原生组件，但需要 mock `NativeEventEmitter` 和 `NativeModules`（从 `react-native` 导入）。

### 解决方案
TurboModule 库的 jest mock 需求与 Fabric 组件库不同：
- **不需要** mock `codegenNativeComponent` 生成的 Fabric 原生组件
- **需要** mock `NativeEventEmitter` 和 `NativeModules`（从 `react-native` 导入）
- **关键**：`NativeEventEmitter.addListener` 必须返回 `{ remove: () => void }` 对象（模拟 RN 的 `NativeEventSubscription`），而非 Node EventEmitter 的默认返回值。否则 `State.tearDown()` 中的 `this._nativeEventSubscription.remove()` 会报 `TypeError: ...remove is not a function`

mock 实现示例：
```javascript
// __mocks__/react-native.js
const { EventEmitter } = require('events');
class MockNativeEventEmitter extends EventEmitter {
  addListener(eventName, handler) {
    const listener = super.addListener(eventName, handler);
    return { remove: () => super.removeListener(eventName, handler) };
  }
}
```

### 结果
TurboModule 库测试通过。这是所有 TurboModule 库通用的 mock 需求：`NativeEventEmitter`（返回 `{remove}` 对象的 `addListener`）、`NativeModules`、`Platform`。

---

## 导入路径从相对路径到包名的转换

### 问题现象
上游 demo 使用相对路径 `'../src'` 和 `'../../src'` 引用库源码。移植到 example 工程后，这些路径会解析到错误的目录（`example/src/` 自身而非库根目录的 `src/`），导致编译错误或导入了错误的模块。

### 解决方案
将所有导入路径改为包名 `'@react-native-ohos/netinfo'`，让 Metro 的 resolver 正确重定向。批量定位方法：`grep -rl "'../src'" example/src/`

### 结果
所有导入路径正确解析到库源码，编译通过。

---

## metro.config.js React 单例保护（tgz 包场景）

### 问题现象
即使通过 tgz 包安装（非 symlink 到库根目录），当 `watchFolders` 包含库根目录时，Metro 的 `nodeModulesPaths` 会包含库根目录的 `node_modules/react`，可能在不同导入上下文中解析到不同的 React 实例，导致 hooks 失效崩溃。

### 解决方案
在 `metro.config.js` 中包装 RNOH 的 `resolveRequest`：
1. 先获取 RNOH 的 `resolveRequest` 引用
2. 在包装函数中拦截裸 `react` 导入，强制解析到 example 的 `node_modules/react`
3. 其余导入委托给 RNOH 的 resolver

**关键约束**：不能直接设置 `resolveRequest` 覆盖 RNOH 的 harmony 解析器——这会导致 `.harmony.js` 平台文件解析全部失效。必须**包装** RNOH 的 `resolveRequest`，只拦截裸 `react` 导入。

验证方法：`grep -oE '(node_modules|\.\./node_modules)/react/index\.js' bundle.harmony.js | sort | uniq -c`，应只有 1 个路径。

### 结果
React 单例保证，hooks 正常工作。

---

## useNetInfoInstance 的 configuration 参数无限重渲染

### 问题现象
在测试或 demo 中向 `useNetInfoInstance` 传入内联 configuration 对象（如 `<Comp config={{reachabilityShouldRun: () => true}} />`）时，每次渲染都会创建新对象引用，触发 `useEffect` 重新执行，调用 `setNetworkInfoManager(state)` 触发再次渲染，形成无限循环导致 Jest OOM。

### 解决方案
这是上游设计限制。`useNetInfoInstance` 的 `useEffect` 依赖 `[isPaused, configuration]`，内联对象引用每次都不同。测试中需避免传入内联 configuration，应使用 `useMemo` 或将配置定义为模块级常量。

### 结果
避免无限循环，测试正常运行。

---

## Jest 测试踩坑：mockReset 后 getCurrentState 返回 undefined

### 问题现象
`Cannot read properties of undefined (reading 'isInternetReachable')` 错误。

### 解决方案
`beforeEach` 中 `mockReset()` 后 `getCurrentState` 返回 `undefined`，`configure()` 创建新 State 时构造函数调用 `_fetchCurrentState()` 拿到 undefined。需在 `beforeEach` 中 `mockReset()` 后立即 `mockResolvedValue(defaultState)`。

### 结果
State 初始化正常，不再报 undefined 错误。

---

## Jest 测试踩坑：fetch() 无参数时 getCurrentState 未被调用

### 问题现象
测试中验证 `fetch()` 调用了 `getCurrentState`，但断言失败——`getCurrentState` 未被调用。

### 解决方案
`latest()` 方法有缓存时直接返回 `Promise.resolve(this._latestState)`，不调用 `getCurrentState`。测试中需要先 emit 事件设置缓存，再验证 `fetch()` 返回缓存值，而非验证 `getCurrentState` 被调用。

### 结果
测试断言正确反映实际行为。

---

## TurboModule 库的 jest 配置模板

### 问题现象
TurboModule 库同时有 `src/__tests__/` 和 `example/` 目录，jest 配置需要正确处理模块解析和测试文件范围。

### 解决方案
`__mocks__/react-native.js` 中需要提供 `NativeEventEmitter`（返回 `{remove}` 对象的 `addListener`）、`NativeModules`、`Platform`。这是所有 TurboModule 库通用的 mock 需求。

库根目录 `jest.config.js` 模板要点：
- `moduleNameMapper` 统一 `react-native` → mock 和 `react` → 单一路径
- `testMatch` 精确限定到 `src/__tests__/*.spec.ts`，避免扫描 `example/harmony/oh_modules`
- `tsconfig.jest.json` 不继承 `@react-native/typescript-config`

### 结果
jest 配置正确，测试扫描范围精确，模块解析统一。

---

## 测试覆盖率扫描方法（TurboModule 库）

### 问题现象
对于 NetInfo 这种非组件库（TurboModule 库），覆盖率维度与 Fabric 组件库不同，需要不同的扫描方法。

### 解决方案
从 TurboModule Spec 文件（`*Native*.ts`）提取方法列表，从 `src/index.ts` 提取公开导出的函数/hook，然后对照测试文件搜索每个 API 的使用情况。

TurboModule 库的覆盖率维度包括：
- **API 覆盖**：TurboModule spec 中定义的方法
- **状态类型覆盖**：如网络状态 `cellular`、`wifi`、`none`、`unknown` 等各类型
- **配置选项覆盖**：如 `useNetInfoInstance` 的 `configuration` 参数各选项

### 结果
覆盖率报告全面覆盖 TurboModule 库的所有维度。