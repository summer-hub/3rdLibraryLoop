# Demo 描述文档模板

> 生成 Demo 描述文档时可直接复制此模板，替换 `{占位符}` 内容。下方同时提供一份完整示例供参考。

---

## 模板

```markdown
# {库名} RN 测试 Demo 描述文档（HarmonyOS 平台）

## 概述

本文档基于 `{库名}` 库的接口规格（`interface-spec.json`）{和接口规格说明书（`{说明书文件名}`）}自动生成，
提供该库各接口在 HarmonyOS 平台可用的 React Native 测试 Demo 描述，供开发者参考实现功能验证 Demo 页面。

> **平台说明**：本文档基于 RN 鸿蒙三方库的接口规格生成，仅包含该库在 HarmonyOS 平台可用的测试 Demo。已过滤 iOS/Android 平台专用接口。

## Demo 总览

| Demo 数量 | 覆盖接口数量 | 生成日期 |
|----------|------------|---------|
| {N} 个    | {M} 个      | {YYYY-MM-DD} |

## 测试 Demo 描述列表

| 序号 | 测试 Demo 名称 | 测试 Demo 描述 | 测试 Demo 步骤 | 测试 Demo 预期结果 | 对应函数接口 |
|-----|--------------|--------------|--------------|-----------------|------------|
| 1 | {Demo名称} | {描述} | 1. 创建函数式组件...<br>2. 点击按钮触发...<br>3. 展示结果... | 1. 页面加载...<br>2. 点击后...<br>3. 验证... | `funcA(): Type`<br>`funcB(): Type` |
| 2 | {Demo名称} | {描述} | ... | ... | ... |

## 接口覆盖矩阵

| 序号 | 接口名称 | 所在 Demo | 覆盖状态 |
|-----|---------|----------|---------|
| 1 | `{接口签名}` | {Demo名称} | ✅ 已覆盖 |
| 2 | `{接口签名}` | {Demo名称} | ✅ 已覆盖 |
```

---

## 完整示例

以下为针对一个虚构的蓝牙 RN 三方库（`react-native-bluetooth-manager`）生成的 Demo 描述文档示例。

> 📌 注意：以下所有接口均为示范用途，实际生成时应严格依据真实接口规格。

```markdown
# react-native-bluetooth-manager RN 测试 Demo 描述文档（HarmonyOS 平台）

## 概述

本文档基于 `react-native-bluetooth-manager` 库的接口规格说明文档自动生成，提供该库各接口的 React Native 测试 Demo 描述，供开发者参考实现功能验证页面。文档按功能相关性对接口进行分组，每组接口对应一个 Demo 页面描述。

> **平台说明**：本文档基于 RN 鸿蒙三方库的接口规格生成，仅包含该库在 HarmonyOS 平台可用的测试 Demo。已过滤 iOS/Android 平台专用接口。

## Demo 总览

| Demo 数量 | 覆盖接口数量 | 生成日期 |
|----------|------------|---------|
| 4 个      | 12 个       | 2026-08-17 |

## 测试 Demo 描述列表

| 序号 | 测试 Demo 名称 | 测试 Demo 描述 | 测试 Demo 步骤 | 测试 Demo 预期结果 | 对应函数接口 |
|-----|--------------|--------------|--------------|-----------------|------------|
| 1 | 版本查询与蓝牙状态检测Demo | 展示如何调用 `getSDKVersion()` 获取 SDK 版本号，以及使用 `isBluetoothEnabled()` 检测当前设备蓝牙是否开启。同时演示通过 `addBluetoothStateListener` 订阅蓝牙状态变化事件，实时更新 UI 展示蓝牙状态。帮助开发者理解库的基本信息查询方式和蓝牙状态监听的事件驱动模式。 | 1. 创建函数式组件 Demo 页面（BluetoothStatusScreen.tsx），使用 `useState` 声明状态变量：`const [sdkVersion, setSdkVersion] = useState('')`、`const [btEnabled, setBtEnabled] = useState<boolean \| null>(null)`、`const [btState, setBtState] = useState('未知')`、`const [checkCount, setCheckCount] = useState(0)`、`const [callbackCount, setCallbackCount] = useState(0)`，布局中添加"查询版本"按钮、"检测蓝牙"按钮和状态 Text 展示区。<br>2. 在 `useEffect` 中调用 `addBluetoothStateListener(event => { setCallbackCount(c => c + 1); setBtState(event.state); })`，将返回的 `subscription` 对象保存，并在清理函数中调用 `subscription.remove()` 取消订阅。<br>3. 点击"查询版本"按钮，调用 `getSDKVersion()`（同步函数），执行 `setSdkVersion(getSDKVersion())`，Text 区域显示"SDK 版本: {版本号}"。<br>4. 点击"检测蓝牙"按钮，执行 `setCheckCount(c => c + 1)`，随后 `await isBluetoothEnabled()`，在 `then` 中执行 `setBtEnabled(result)`，Text 区域显示"蓝牙已开启 ✅"或"蓝牙已关闭 ❌"。<br>5. 双计数器展示：`<Text>检测调用次数: {checkCount}</Text>` 和 `<Text>状态事件次数: {callbackCount}</Text>`。 | 1. 页面加载完成，所有按钮可正常点击，蓝牙状态事件监听器已注册。<br>2. 点击"查询版本"后，Text 立即显示非空的版本号字符串（如 "2.1.0"），无异常。<br>3. 点击"检测蓝牙"后，`checkCount` 更新为 1，Text 显示当前蓝牙状态，结果为 true（开启）或 false（关闭）。<br>4. 手动切换设备蓝牙开关后，`callbackCount` 增加，`btState` Text 实时更新为 "on"/"off"。<br>5. 页面卸载时，事件监听器正确移除，无警告。 | `getSDKVersion(): string`<br>`isBluetoothEnabled(): Promise<boolean>`<br>`addBluetoothStateListener(callback): EmitterSubscription` |
| 2 | 蓝牙开启与设备扫描Demo | 展示如何通过 `enableBluetooth()` 开启蓝牙（Android），使用 `startScan()` 启动设备扫描，通过 `addDeviceFoundListener` 订阅 `onDeviceFound` 事件实时接收扫描到的设备，以及调用 `stopScan()` 手动停止扫描。帮助开发者理解 NativeEventEmitter 异步事件驱动的完整模式，以及扫描生命周期的管理方式。 | 1. 创建函数式组件 Demo 页面（ScanScreen.tsx），声明状态变量：`const [devices, setDevices] = useState<BluetoothDevice[]>([])`、`const [scanning, setScanning] = useState(false)`、`const [scanCallCount, setScanCallCount] = useState(0)`、`const [deviceFoundCount, setDeviceFoundCount] = useState(0)`，布局中添加"开启蓝牙"按钮（Android 专用）、"开始扫描"按钮、"停止扫描"按钮及 FlatList 展示设备列表。<br>2. 在 `useEffect` 中调用 `addDeviceFoundListener(device => { setDeviceFoundCount(c => c + 1); setDevices(prev => [...prev, device]); })`，返回的 subscription 在清理函数中移除。<br>3. 点击"开启蓝牙"按钮（仅 Android 生效），执行 `await enableBluetooth()`，成功后 Text 显示"蓝牙已开启"；iOS/HarmonyOS 平台在按钮旁标注"仅 Android 有效，其他平台请手动开启"。<br>4. 点击"开始扫描"按钮，执行 `setScanCallCount(c => c + 1); setScanning(true); setDevices([])`，随后调用 `await startScan(10000)`，扫描过程中 FlatList 通过 `onDeviceFound` 事件实时渲染设备列表。<br>5. 点击"停止扫描"或扫描超时后，调用 `await stopScan()`，执行 `setScanning(false)`，Text 显示"扫描已停止"。<br>6. 双计数器展示：`<Text>扫描发起次数: {scanCallCount}</Text>` 和 `<Text>发现设备次数: {deviceFoundCount}</Text>`。 | 1. 点击"开启蓝牙"（Android）后，Text 显示"蓝牙已开启"；iOS/HarmonyOS 上按钮有平台限制说明。<br>2. 点击"开始扫描"后，`scanCallCount` 为 1，`scanning` 状态为 true，FlatList 开始逐条显示发现的蓝牙设备。<br>3. 每发现一台设备，`deviceFoundCount` 加 1，FlatList 列表同步更新。<br>4. 点击"停止扫描"后，`scanning` 变为 false，Text 显示"扫描已停止"。<br>5. 整个流程无 JS 红屏错误，无原生层崩溃。 | `enableBluetooth(): Promise<void>`<br>`startScan(timeoutMs?: number): Promise<void>`<br>`stopScan(): Promise<void>`<br>`addDeviceFoundListener(callback): EmitterSubscription` |
| 3 | 设备连接与断开Demo | 展示如何使用 `connect(deviceId)` 连接扫描到的蓝牙设备，通过 `addConnectionStateListener` 监听连接状态变化事件，获取实时连接状态反馈，并调用 `disconnect(deviceId)` 断开连接。帮助开发者理解连接建立的异步流程、状态变化的事件监听方式以及连接资源的正确释放。 | 1. 创建函数式组件 Demo 页面（ConnectionScreen.tsx），声明状态变量：`const [targetDeviceId, setTargetDeviceId] = useState('')`、`const [connState, setConnState] = useState('未连接')`、`const [connectCallCount, setConnectCallCount] = useState(0)`、`const [connEventCount, setConnEventCount] = useState(0)`，布局中添加设备 ID 输入框（TextInput）、"连接"按钮、"断开"按钮及连接状态 Text 展示区。<br>2. 在 `useEffect` 中调用 `addConnectionStateListener(event => { setConnEventCount(c => c + 1); setConnState(event.state); })`，返回的 subscription 在清理函数中移除。<br>3. 在 TextInput 中输入要连接的设备 ID，点击"连接"按钮，执行 `setConnectCallCount(c => c + 1); setConnState('connecting')`，随后调用 `const device = await connect(targetDeviceId)`，成功后执行 `setConnState('connected')`。<br>4. 连接过程中，`addConnectionStateListener` 事件回调实时更新 `connState`（connecting → connected）。<br>5. 点击"断开"按钮，调用 `await disconnect(targetDeviceId)`，事件回调触发 `setConnState('disconnected')`。<br>6. 双计数器展示：`<Text>连接发起次数: {connectCallCount}</Text>` 和 `<Text>连接事件次数: {connEventCount}</Text>`。 | 1. 输入有效设备 ID 后点击"连接"，`connectCallCount` 为 1，`connState` Text 立即显示"connecting"。<br>2. 连接成功后，`connEventCount` 增加，`connState` Text 更新为"connected"。<br>3. `connect()` 返回的 `BluetoothDevice` 对象中 `id`、`name` 字段有效。<br>4. 点击"断开"后，`connState` Text 更新为"disconnected"，`connEventCount` 再次增加。<br>5. 整个流程无未捕获的 Promise reject。 | `connect(deviceId: string): Promise<BluetoothDevice>`<br>`disconnect(deviceId: string): Promise<void>`<br>`addConnectionStateListener(callback): EmitterSubscription` |
| 4 | 特征数据读写Demo | 展示如何使用 `writeData()` 向已连接蓝牙设备的指定特征写入十六进制数据，以及使用 `readData()` 读取相同特征的当前数据，验证写入与读取的数据一致性。帮助开发者理解 BLE 特征读写接口的参数格式和 Promise 异步处理模式。 | 1. 创建函数式组件 Demo 页面（DataRWScreen.tsx），前提为已通过连接 Demo 建立蓝牙连接，声明状态变量：`const [deviceId, setDeviceId] = useState('')`、`const [serviceUUID, setServiceUUID] = useState('')`、`const [charUUID, setCharUUID] = useState('')`、`const [writeDataValue, setWriteDataValue] = useState('0x0A0B')`、`const [readResult, setReadResult] = useState('')`、`const [writeCallCount, setWriteCallCount] = useState(0)`、`const [readCallCount, setReadCallCount] = useState(0)`，布局中添加四个 TextInput、"写入"按钮、"读取"按钮及结果 Text 展示区。<br>2. 点击"写入"按钮，执行 `setWriteCallCount(c => c + 1)`，随后调用 `await writeData(deviceId, serviceUUID, charUUID, writeDataValue)`，成功后 Text 显示"写入成功 ✅"。<br>3. 点击"读取"按钮，执行 `setReadCallCount(c => c + 1)`，随后调用 `const data = await readData(deviceId, serviceUUID, charUUID)`，在 await 完成后执行 `setReadResult(data)`，Text 区域显示"读取结果: {data}"。<br>4. 先写入再读取，对比写入值与读取值是否一致。<br>5. 计数器展示：`<Text>写入调用次数: {writeCallCount}</Text>` 和 `<Text>读取调用次数: {readCallCount}</Text>`。 | 1. 填写有效参数后点击"写入"，`writeCallCount` 为 1，Text 显示"写入成功 ✅"。<br>2. 点击"读取"后，`readCallCount` 为 1，`readResult` Text 显示十六进制格式的返回数据，数据非空。<br>3. 先写入 "0x0A0B" 再读取，读取结果与写入内容一致。<br>4. 传入无效 UUID 时，Promise reject 被 catch 捕获，Text 展示错误信息，不崩溃。 | `writeData(deviceId, serviceUUID, characteristicUUID, data): Promise<void>`<br>`readData(deviceId, serviceUUID, characteristicUUID): Promise<string>` |

## 接口覆盖矩阵

| 序号 | 接口名称 | 所在 Demo | 覆盖状态 |
|-----|---------|----------|---------|
| 1 | `getSDKVersion(): string` | 版本查询与蓝牙状态检测Demo | ✅ 已覆盖 |
| 2 | `isBluetoothEnabled(): Promise<boolean>` | 版本查询与蓝牙状态检测Demo | ✅ 已覆盖 |
| 3 | `addBluetoothStateListener(callback): EmitterSubscription` | 版本查询与蓝牙状态检测Demo | ✅ 已覆盖 |
| 4 | `enableBluetooth(): Promise<void>` | 蓝牙开启与设备扫描Demo | ✅ 已覆盖 |
| 5 | `startScan(timeoutMs?: number): Promise<void>` | 蓝牙开启与设备扫描Demo | ✅ 已覆盖 |
| 6 | `stopScan(): Promise<void>` | 蓝牙开启与设备扫描Demo | ✅ 已覆盖 |
| 7 | `addDeviceFoundListener(callback): EmitterSubscription` | 蓝牙开启与设备扫描Demo | ✅ 已覆盖 |
| 8 | `connect(deviceId: string): Promise<BluetoothDevice>` | 设备连接与断开Demo | ✅ 已覆盖 |
| 9 | `disconnect(deviceId: string): Promise<void>` | 设备连接与断开Demo | ✅ 已覆盖 |
| 10 | `addConnectionStateListener(callback): EmitterSubscription` | 设备连接与断开Demo | ✅ 已覆盖 |
| 11 | `writeData(deviceId, serviceUUID, characteristicUUID, data): Promise<void>` | 特征数据读写Demo | ✅ 已覆盖 |
| 12 | `readData(deviceId, serviceUUID, characteristicUUID): Promise<string>` | 特征数据读写Demo | ✅ 已覆盖 |
```

---

## 示例中的关键规则应用说明

1. **基础信息合并**：`getSDKVersion()`（同步）、`isBluetoothEnabled()`（异步）和 `addBluetoothStateListener`（事件订阅）合并到同一 Demo，因为共同完成"使用前环境检查 + 状态监听"阶段。

2. **扫描生命周期组合**：`enableBluetooth()`、`startScan()`、`stopScan()`、`addDeviceFoundListener` 合并，共同描述蓝牙扫描的完整生命周期。

3. **连接状态合并**：`connect()`、`disconnect()` 和 `addConnectionStateListener` 合并，形成"连接管理"完整业务场景。

4. **平台差异标注**：`enableBluetooth()` 在 iOS/HarmonyOS 上不可用，Demo 步骤中标注"仅 Android 有效，其他平台请手动开启"。

5. **异步回调双计数器**：所有涉及 Promise 或 NativeEventEmitter 事件的 Demo 均设计了双计数器，通过 `useState` setter 更新。

6. **useState 强制更新**：所有状态变量更新均通过 `setXxx()` 执行，确保 RN 组件正确重新渲染。

7. **函数式组件为载体**：每个步骤明确描述了对应的 RN 组件和用户操作，开发者可直接按步骤实现。
