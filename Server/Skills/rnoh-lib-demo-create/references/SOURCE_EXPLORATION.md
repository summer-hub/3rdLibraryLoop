# 源码探查指南

> 生成 Demo 代码前必须完成 JS 层接口与平台兼容性探查，确保 Demo 只使用 HarmonyOS 平台实际支持的 API。本探查仅关注 RN 工程的 JS 层，不涉及鸿蒙原生侧配置。

---

## 1. 探查 JS 层导出接口

**搜索路径（优先级从高到低）：**

1. `node_modules/{harmonyPkgName}/index.js` 或 `index.ts`（推荐）
2. `node_modules/{harmonyPkgName}/src/index.js`（备选）

**提取信息**：
- 导出的函数列表：函数名、参数、返回值
- 导出的类/对象：类名（如 `NativeModules.XxxModule`）、方法列表
- React 组件：组件名、Props 类型、事件回调 Props（onXxx）
- Hooks：Hook 函数名、参数、返回值
- 常量/枚举：常量名及值

---

## 2. 探查平台兼容性 API

> ⚠️ **关键步骤**：确保 Demo 代码只使用 HarmonyOS 平台实际支持的 API、属性和常量。

### 2.1 平台条件分支（Platform.OS）

读取库的入口文件，查找 `Platform.OS === 'harmony'`、`Platform.OS === 'ios'`、`Platform.OS === 'android'` 等条件分支。不同平台分支下暴露的 API、属性、常量可能不同。

```
示例（react-native-audio）：
  if (Platform.OS === 'ios') {
    AudioUtils = { MainBundlePath, DocumentDirectoryPath, ... }
  } else if (Platform.OS === 'harmony') {
    AudioUtils = { FilesDirectoryPath, CacheDirectoryPath, TempsDirectoryPath }
  }
  → HarmonyOS 下 AudioUtils 没有 DocumentDirectoryPath
```

### 2.2 导出的常量和工具对象

检查库导出的常量对象（如 `AudioUtils`、`AudioSource`），确认 HarmonyOS 分支下实际包含哪些属性。如果某个属性只在 iOS/Android 分支中定义，在 HarmonyOS 下使用会得到 `undefined`。

### 2.3 提取信息

| 信息 | 说明 | 示例 |
|------|------|------|
| HarmonyOS 可用常量 | 只使用 harmony 分支中定义的属性 | `FilesDirectoryPath`（非 `DocumentDirectoryPath`） |
| HarmonyOS 不可用 API | 标记为禁止使用 | `DocumentDirectoryPath`、`MainBundlePath` |
| 方法调用方式 | Promise vs 同步 | `startRecording()` 返回 Promise |
| 事件名称 | DeviceEventEmitter 监听的事件名 | `recordingProgress`、`recordingFinished` |

### 2.4 核心规则

- **只使用 `Platform.OS === 'harmony'` 分支中定义的属性和 API**
- 如果某个属性只在 iOS/Android 分支中存在，**绝对不能在 Demo 中使用**
- 如果库没有 `Platform.OS === 'harmony'` 分支，说明可能未适配 HarmonyOS，需要额外确认

### 2.5 常见陷阱

| 陷阱 | iOS/Android | HarmonyOS |
|------|-------------|-----------|
| 路径常量 | `DocumentDirectoryPath` | `FilesDirectoryPath` |
| 路径常量 | `CachesDirectoryPath` | `CacheDirectoryPath` |
| 路径常量 | `MainBundlePath`（iOS） | 不存在 |

---

## 3. 探查 TurboModule Spec

**搜索路径**：`node_modules/{harmonyPkgName}/src/**/Native*.ts` 或 `generated/ts/` 目录

**提取信息**：
- 方法签名：方法名、参数类型、返回值类型
- 调用方式：Promise 返回（需 `await`）还是同步调用
- 事件定义：`addListener` 方法监听的事件名称

---

## 4. 探查类型定义

**搜索路径**：`node_modules/{harmonyPkgName}/**/*.d.ts`

**提取信息**：
- 参数详细类型（可选参数、联合类型）
- 返回值类型
- Props 接口定义（组件属性）
- 枚举/类型别名定义

---

## 5. 探查结果汇总

完成探查后，汇总为接口能力清单用于 Demo 代码生成：

| 信息 | 说明 | 示例 (audio) |
|------|------|-------------|
| JS 导出函数 | 库入口导出的函数 | `AudioRecorder.startRecording()` |
| JS 导出组件 | 库入口导出的 React 组件 | 无（纯 API 库） |
| JS 导出常量 | 库入口导出的常量对象 | `AudioUtils` |
| HarmonyOS 可用属性 | harmony 分支中定义的属性 | `FilesDirectoryPath`, `CacheDirectoryPath`, `TempsDirectoryPath` |
| HarmonyOS 不可用属性 | 仅 iOS/Android 分支存在的属性 | `DocumentDirectoryPath`, `MainBundlePath` |
| 方法调用方式 | Promise vs 同步 | `startRecording()` 返回 Promise |
| 事件名称 | DeviceEventEmitter 事件名 | `recordingProgress`, `recordingFinished` |

---

## 6. MCP 工具辅助

### 6.1 提取接口规格

调用 `script_rn_extract_interfaces` 提取接口规格 JSON，用于交叉验证描述文档中的接口签名：

```
调用 script_rn_extract_interfaces：
  - libroot: {{库源码根目录}}
  - output: {{libroot}}/interface-spec.json
```

### 6.2 查询鸿蒙知识

调用 `kb_search` 查询鸿蒙平台特定约束：

```
调用 kb_search：
  - query: "HarmonyOS 权限请求" / "ArkTS 限制" / "RNOH 事件机制"
```

---

## 7. 处理策略

1. **JS 层探查优先** - 从 `node_modules/` 读取库的 JS 入口文件
2. **平台兼容性验证** - 读取 `Platform.OS === 'harmony'` 分支，确认可用 API
3. **禁止使用 iOS/Android 专属属性** - 不照搬官方文档或 npm 示例代码
4. **参考描述文档** - Demo 描述文档中的接口签名需与源码交叉验证
