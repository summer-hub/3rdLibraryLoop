# Jest 单元测试排错指南

RN 0.84 + React 19 环境下，为鸿蒙化组件编写 jest 单元测试时遇到的常见问题及解决方案。

本文档基于 rntpc_picker 库的实战调试经验整理。

## 问题 1：React 多副本导致 hooks 失效

### 症状 1

```text
TypeError: Cannot read properties of null (reading 'useRef')
```

组件中调用 `React.useRef()`、`React.useMemo()` 等 hooks 时崩溃。

### 根因 1

鸿蒙化工程的典型目录结构：

```
rntpc_picker/               ← 库根目录
├── node_modules/react/      ← React 副本 A
├── js/
│   └── PickerHarmony.harmony.js   ← 从此处解析 react → 副本 A
└── example/                 ← 测试工程目录
    ├── node_modules/react/  ← React 副本 B
    └── node_modules/react-test-renderer/  ← 使用副本 B
```

`PickerHarmony.harmony.js` 位于 `js/` 目录，其 `import * as React from 'react'` 解析到 `rntpc_picker/node_modules/react`（副本 A）。
而 `react-test-renderer`（安装在 `example/node_modules/`）使用 `example/node_modules/react`（副本 B）。

两个不同的 React 实例导致 hooks dispatcher 不匹配——renderer 设置的 dispatcher 在副本 B 上，但组件调用的 hooks 在副本 A 上。

### 诊断方法

```bash
# 检查 React 解析路径
node -e "
console.log('from example:', require.resolve('react', {paths: ['./example']}));
console.log('from js dir:', require.resolve('react', {paths: ['./js']}));
"
```

如果两个路径不同，即为多副本问题。

### 解决方案 1

在 `jest.config.js` 的 `moduleNameMapper` 中强制统一 React：

```javascript
moduleNameMapper: {
  '^react-native$': '<rootDir>/__mocks__/react-native.js',
  // 强制统一 React 副本
  '^react$': '<rootDir>/node_modules/react/index.js',
  '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime.js',
},
```

**关键**：`<rootDir>` 是 jest 配置文件所在目录（通常是 `example/`），映射到 `example/node_modules/react`。

## 问题 2：React 19 react-test-renderer 异步渲染

### 症状 2

Mock 组件的 `forwardRef` 回调未执行，`globalThis.__CAPTURED_PROPS__` 为 null。

### 根因 2

React 19 中 `react-test-renderer` 已弃用，默认异步渲染。`TestRenderer.create()` 返回时，组件的 render 函数（含 forwardRef）可能尚未执行。

### 解决方案 2

1. 在 `jest.setup.js` 中启用 act 环境：

```javascript
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
```

2. 用 `act()` 包裹 `TestRenderer.create()`：

```typescript
import TestRenderer, {act} from 'react-test-renderer';

function renderComponent(element: React.ReactElement) {
  let renderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}
```

3. 触发事件回调时也用 `act()` 包裹：

```typescript
act(() => {
  capturedOnChange()(mockEvent);
});
```

## 问题 3：react-native 原生模块初始化崩溃

### 症状 3

```text
Error: __fbBatchedBridgeConfig is not available
```

或类似的 native bridge 初始化错误。

### 根因 3

`react-native` 模块在 Node 环境中加载时尝试初始化原生桥接层，但测试环境中没有原生运行时。

### 解决方案 3

创建 `__mocks__/react-native.js` mock 文件，提供最小化的组件和工具函数：

```javascript
const React = require('react');

const View = (props) => React.createElement('View', props, props.children);
const Text = (props) => React.createElement('Text', props, props.children);
const StyleSheet = { create: (styles) => styles, flatten: (style) => style };
const Platform = { OS: 'harmony', select: (obj) => obj.harmony || obj.default };
const processColor = (color) => color;  // 直接透传，测试中不需要真实颜色转换

module.exports = {
  View, Text, StyleSheet, Platform, processColor,
  // 按需添加其他导出
};
```

在 `jest.config.js` 中映射：

```javascript
moduleNameMapper: {
  '^react-native$': '<rootDir>/__mocks__/react-native.js',
},
```

## 问题 4：Fabric 原生组件导入链崩溃

### 症状 4

```text
Error: Cannot find module 'react-native/Libraries/Utilities/codegenNativeComponent'
```

### 根因 4

`*NativeComponent.js` 文件深度导入 react-native 内部模块（codegenNativeComponent 等），mock 的 react-native 不包含这些内部路径。

### 解决方案 4

为每个 Fabric 原生组件创建独立 mock：

`__mocks__/RNCPickerNativeComponent.js`：

```javascript
const React = require('react');

const Commands = {
  setNativeSelectedIndex: jest.fn(),
};

// 使用 forwardRef 捕获 props，通过 globalThis 传递给测试
const MockNativePicker = React.forwardRef((props, ref) => {
  globalThis.__PICKER_CAPTURED_PROPS__ = props;
  globalThis.__PICKER_CAPTURED_ONCHANGE__ = props.onChange;
  React.useImperativeHandle(ref, () => ({
    setNativeProps: jest.fn(),
  }));
  return React.createElement('RNCPicker', props);
});

module.exports = {
  __esModule: true,
  default: MockNativePicker,
  Commands,
};
```

在测试文件中声明 mock：

```typescript
jest.mock('../../../js/RNCPickerNativeComponent', () => {
  return require('../../__mocks__/RNCPickerNativeComponent');
});
```

**注意**：`jest.mock()` 会被自动提升到文件顶部（hoisting），因此必须在 `import` 组件之前声明。使用 `require()` 方式引用 mock 文件可以避免变量提升问题。

## 问题 5：globalThis 变量传递 vs 模块实例不一致

### 症状 5

Mock 文件中设置的变量，在测试文件中读取时为 null 或 undefined。

### 根因 5

jest 模块缓存可能导致 mock 文件被 require 多次，产生不同的模块实例，变量不共享。

### 解决方案 5

使用 `globalThis` 而非模块级变量传递数据：

```javascript
// mock 文件中
globalThis.__PICKER_CAPTURED_PROPS__ = props;

// 测试文件中
const lastProps = () => globalThis.__PICKER_CAPTURED_PROPS__;
```

在 `beforeEach` 中重置：

```typescript
beforeEach(() => {
  globalThis.__PICKER_CAPTURED_PROPS__ = null;
  globalThis.__PICKER_CAPTURED_ONCHANGE__ = null;
});
```

## 问题 6：@react-native/typescript-config 阻塞 ts-jest

### 症状 6

```text
error TS2614: Module '"@react-native/typescript-config"' can only be default-imported using the 'esModuleInterop' flag
```

### 根因 6

RN 0.84 的 `tsconfig.json` 继承 `@react-native/typescript-config`，其 `exports` 字段导致 ts-jest 解析失败。

### 解决方案 6

创建独立的 `tsconfig.jest.json`，不继承 RN 的配置：

```json
{
  "compilerOptions": {
    "jsx": "react",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "module": "commonjs",
    "target": "es2017",
    "moduleResolution": "node",
    "types": ["react", "react-native", "jest", "node"]
  },
  "include": ["src/**/*"],
  "exclude": ["harmony", "node_modules"]
}
```

在 `jest.config.js` 中指定：

```javascript
transform: {
  '^.+\\.(ts|tsx)$': ['ts-jest', {
    tsconfig: 'tsconfig.jest.json',
    isolatedModules: true,
  }],
},
```

## 问题 7：jest 扫描 harmony/oh_modules 目录

### 症状 7

jest 启动时扫描 `harmony/oh_modules/` 下的大量文件，导致超时或内存溢出。

### 解决方案 7

在 `jest.config.js` 中用 `testMatch` 精确限定测试文件：

```javascript
testMatch: ['<rootDir>/src/__tests__/*.test.tsx'],
```

同时确保 `tsconfig.jest.json` 的 `exclude` 包含 `harmony` 目录。

## 完整配置模板

### jest.config.js

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/__tests__/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
      isolatedModules: true,
    }],
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-picker|@react-native-oh)/)',
  ],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
    '^react$': '<rootDir>/node_modules/react/index.js',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime.js',
  },
};
```

### jest.setup.js

```javascript
global.__DEV__ = true;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
```

### `__mocks__/react-native.js`

提供 `View`、`Text`、`StyleSheet`、`Platform`（OS='harmony'）、`processColor`（透传）等最小导出。

### `__mocks__/FabricComponent.js`

用 `React.forwardRef` 捕获 props，通过 `globalThis` 传递。导出 `{ __esModule: true, default: MockComponent, Commands: {...} }`。
