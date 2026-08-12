# 设备运行时崩溃排错指南

RN 0.84 + React 19 + RNOH 0.84 环境下，测试 demo 移植到鸿蒙设备后遇到的运行时崩溃及解决方案。

本文档基于 rntpc_react-native-netinfo 库的实战调试经验整理。

## 崩溃 1：Element type is invalid: got: object

### 症状

应用启动即崩溃，错误信息：`Element type is invalid: got: object`。

### 根因

`example/src/index.tsx` 中定义了 `ExampleApp` 组件类，并在文件末尾调用 `AppRegistry.registerComponent('app_name', () => ExampleApp)`，但**缺少 `export default` 导出**。

`example/index.js` 中 `import App from './src/index'` 要求 `src/index.tsx` 有默认导出。缺少默认导出时，`App` 为 `undefined`，React 注册了一个 `undefined` 组件，运行时报 "Element type is invalid"。

### 诊断方法

```bash
# 检查 index.tsx 是否有 export default
grep "export default" example/src/index.tsx
```

如果没有输出，即为问题所在。

### 解决方案

在 `AppRegistry.registerComponent` **之前**添加默认导出：

```typescript
// example/src/index.tsx 末尾

export default ExampleApp;

AppRegistry.registerComponent('app_name', () => ExampleApp);
```

**注意**：`app_name` 必须与 `app.json` 中的 `"name"` 字段一致，且与 `Index.ets` 中 `RNApp` 的 `appKey` 一致。

## 崩溃 2：Cannot read property 'useState' of null

### 症状

应用启动后白屏或崩溃，错误信息：`Cannot read property 'useState' of null`。调用栈指向调用了 `useState()` 的组件（如 NetInfoHook 中的 `useNetInfo()`）。

### 根因

Metro bundler 为 `react` 创建了**两个模块实例**：

```
模块 ID 49:  node_modules/react/index.js         ← example 代码使用
模块 ID 640: ../node_modules/react/index.js       ← 库代码使用
```

两个 React 实例导致 `ReactSharedInternals.H`（hooks dispatcher）不一致：
- 渲染器在实例 A 上设置 dispatcher
- 组件在实例 B 上调用 `useState()`
- 实例 B 的 `H` 为 null → 崩溃

#### 为什么会有两个 react

库通过 `"file:.."` 安装（symlink 到父目录），目录结构：

```
rntpc_react-native-netinfo/         ← 库根目录
├── node_modules/react/             ← React 副本 A
├── src/index.ts                    ← import {useState} from 'react' → 解析到副本 A
└── example/                        ← 测试工程
    ├── node_modules/react/         ← React 副本 B
    └── src/index.tsx               ← import * as React from 'react' → 解析到副本 B
```

Metro 的 `nodeModulesPaths` 包含了两个目录，对不同的导入上下文解析到不同的 `react` 路径。

### 诊断方法

构建 dev bundle 并检查 React 模块路径：

```bash
npx react-native bundle --platform harmony --dev true \
  --entry-file index.js --bundle-output /tmp/test-bundle-dev.js

grep -oE '(node_modules|\.\./node_modules)/react/index\.js' /tmp/test-bundle-dev.js | sort | uniq -c
```

如果输出包含两个不同路径，即为多副本问题：

```
   1 node_modules/react/index.js          ← example 的
   1 ../node_modules/react/index.js       ← 库根目录的
```

### 解决方案

在 `metro.config.js` 中**包装** RNOH 的 `resolveRequest`，拦截裸 `react` 导入：

```javascript
const path = require('path');
const {mergeConfig, getDefaultConfig} = require('@react-native/metro-config');
const {createHarmonyMetroConfig} = require('@react-native-oh/react-native-harmony/metro.config');

const projectRoot = __dirname;
const libraryRoot = path.resolve(projectRoot, '..');
const exampleNodeModules = path.resolve(projectRoot, 'node_modules');

// 只拦截裸 'react' 导入，强制解析到 example 的 node_modules
const SINGLETON_MODULES = new Set(['react']);

// 先获取 RNOH 的 resolveRequest
const harmonyConfig = createHarmonyMetroConfig({
  reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
});
const rnohResolveRequest = harmonyConfig.resolver?.resolveRequest;

// 包装：先拦截 react，其余委托给 RNOH
function wrappedResolveRequest(context, moduleName, platform) {
  if (SINGLETON_MODULES.has(moduleName)) {
    return {
      filePath: path.resolve(exampleNodeModules, moduleName, 'index.js'),
      type: 'sourceFile',
    };
  }
  if (rnohResolveRequest) {
    return rnohResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
}

const config = {
  watchFolders: [libraryRoot],
  resolver: {
    nodeModulesPaths: [
      exampleNodeModules,
      path.resolve(libraryRoot, 'node_modules'),
    ],
    resolveRequest: wrappedResolveRequest,
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(
  getDefaultConfig(__dirname),
  harmonyConfig,
  config,
);
```

#### 关键约束

1. **不能直接设置 `resolveRequest` 覆盖 RNOH**：`mergeConfig` 按从左到右应用，后面的 config 的 `resolveRequest` 会完全覆盖前面的。RNOH 的 `createHarmonyMetroConfig` 提供了自己的 `resolveRequest`，处理 `.harmony.js` 平台文件解析、`react-native` → `@react-native-oh/react-native-harmony` 重定向等。如果直接覆盖，harmony 平台构建会失败。

2. **不要拦截 `react-native`**：RNOH 的 resolver 会将 `react-native` 重定向到 `@react-native-oh/react-native-harmony`。如果也拦截 `react-native`，会破坏这个重定向。只需拦截 `react`（裸导入）。

3. **必须先获取 RNOH 的 resolveRequest 引用，再在 config 中包装**：通过 `harmonyConfig.resolver?.resolveRequest` 提取引用，在 `wrappedResolveRequest` 中调用它。

#### 验证

```bash
npx react-native bundle --platform harmony --dev true \
  --entry-file index.js --bundle-output /tmp/test-bundle-dev.js

grep -oE '(node_modules|\.\./node_modules)/react/index\.js' /tmp/test-bundle-dev.js | sort | uniq -c
```

正确结果应只有 1 个：

```
   1 node_modules/react/index.js
```

## 崩溃 3：白屏无渲染（加载旧 bundle）

### 症状

修复 metro.config.js 后 `npm run dev` 构建成功，但设备上仍然白屏或崩溃。Metro dev server 未运行时尤其明显。

### 根因

鸿蒙应用启动时按优先级尝试多个 bundle 来源（见 `Index.ets` 中的 `AnyJSBundleProvider`）：

1. `MetroJSBundleProvider` — 从 Metro dev server 加载（需要 Metro 运行中）
2. `FileJSBundleProvider('/data/storage/el2/base/files/bundle.harmony.js')` — 从设备文件加载
3. `ResourceJSBundleProvider('hermes_bundle.hbc')` — 从编译好的 Hermes 字节码加载
4. `ResourceJSBundleProvider('bundle.harmony.js')` — 从 rawfile 资源加载

如果 Metro 未运行，且 HAP 未重新构建，设备会加载**编译进 HAP 的旧 `rawfile/bundle.harmony.js`**（包含修复前的重复 React 实例）。

### 诊断方法

```bash
# 检查 rawfile 中的 bundle 是否有重复 React
grep -oE '(node_modules|\.\./node_modules)/react/index\.js' \
  harmony/entry/src/main/resources/rawfile/bundle.harmony.js | sort | uniq -c
```

如果输出两个路径，说明 rawfile 中是旧 bundle。

### 解决方案

重新构建 bundle 并重新部署 HAP：

```bash
# 1. 重新构建 bundle（会更新 harmony/entry/src/main/resources/rawfile/bundle.harmony.js）
npm run dev

# 2. 在 DevEco Studio 中 Build → Run，重新编译 HAP 并安装到设备
```

**注意**：`npm run dev` 只更新源文件目录中的 `bundle.harmony.js`，DevEco Studio 构建时才会将其打包进 HAP。仅执行 `npm run dev` 不重新构建 HAP 是不够的。

#### 快速验证（不重新构建 HAP）

启动 Metro dev server，让设备实时加载最新 bundle：

```bash
# 设置端口转发
hdc fport tcp:8081 tcp:8081

# 启动 Metro（会自动执行 hdc rport）
npm run start
```

在设备上重新打开应用，Metro 会提供最新的 bundle。如果应用正常渲染，说明问题已解决，接下来只需重新构建 HAP 即可。

## 崩溃 4：Jest 单元测试中的 React 多副本

### 症状

Jest 测试中调用 hooks 时崩溃：`Cannot read properties of null (reading 'useRef')` 或 `reading 'useState'`。

### 根因

与崩溃 2 相同的根因——库根目录和 example 目录各有一份 `node_modules/react`。但 Jest 环境下的解决方式不同。

### 解决方案

在 `jest.config.js` 的 `moduleNameMapper` 中强制统一 React 路径：

```javascript
moduleNameMapper: {
  '^react-native$': '<rootDir>/__mocks__/react-native.js',
  '^react$': '<rootDir>/node_modules/react/index.js',
  '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime.js',
},
```

详见 [jest-troubleshooting.md](jest-troubleshooting.md) 问题 1。

## 检查清单

修复运行时崩溃后，逐项确认：

- [ ] `example/src/index.tsx` 有 `export default ExampleApp;`
- [ ] `export default` 在 `AppRegistry.registerComponent` 之前
- [ ] `app.json` 的 `name` 与 `Index.ets` 的 `appKey` 一致
- [ ] `metro.config.js` 包装了 RNOH 的 `resolveRequest`（未直接覆盖）
- [ ] dev bundle 中只有 1 个 `react/index.js` 路径
- [ ] `npm run dev` 重新生成了 `rawfile/bundle.harmony.js`
- [ ] DevEco Studio 重新 Build → Run 部署了新 HAP
- [ ] 设备上应用正常启动渲染，无崩溃
