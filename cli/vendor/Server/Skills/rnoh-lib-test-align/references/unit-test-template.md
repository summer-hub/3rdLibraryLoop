# 单元测试编写指南

RN 0.84 + React 19 环境下，为鸿蒙化组件编写 jest 单元测试的模板和最佳实践。

本文档基于 rntpc_picker 库的实战经验整理，适用于所有 Fabric 组件的鸿蒙化测试。

## 测试架构

### 核心思路

鸿蒙化组件（如 `PickerHarmony.harmony.js`）使用 Fabric 原生组件（如 `RNCPickerNativeComponent`）。
在单元测试中，我们 mock 掉 Fabric 原生组件，通过 `globalThis` 捕获传入的 props，从而验证组件逻辑。

```text
测试文件                    被测组件                   Mock 原生组件
PickerHarmony.test.tsx  →  PickerHarmony.harmony.js  →  __mocks__/RNCPickerNativeComponent.js
                                                          ↓
                                                     globalThis.__CAPTURED_PROPS__
                                                          ↓
                                                     测试断言读取
```

### Mock 原生组件模板

适用于所有 `codegenNativeComponent` 生成的 Fabric 组件：

```javascript
// __mocks__/<ComponentName>NativeComponent.js
const React = require('react');

// NativeCommands mock
const Commands = {
  // 替换为实际的 command 名称
  setNativeSelectedIndex: jest.fn(),
};

// forwardRef 捕获 props，通过 globalThis 传递给测试
const MockNativeComponent = React.forwardRef((props, ref) => {
  globalThis.__COMPONENT_CAPTURED_PROPS__ = props;
  globalThis.__COMPONENT_CAPTURED_ONCHANGE__ = props.onChange; // 按需捕获事件回调
  React.useImperativeHandle(ref, () => ({
    setNativeProps: jest.fn(),
  }));
  return React.createElement('NativeComponent', props);
});

module.exports = {
  __esModule: true,
  default: MockNativeComponent,
  Commands,
};
```

### Mock react-native 模板

```javascript
// __mocks__/react-native.js
const React = require('react');

const View = (props) => React.createElement('View', props, props.children);
const Text = (props) => React.createElement('Text', props, props.children);
const StyleSheet = { create: (styles) => styles, flatten: (style) => style };
const Platform = { OS: 'harmony', select: (obj) => obj.harmony || obj.default };
const processColor = (color) => color; // 透传，测试中不转换颜色

module.exports = {
  View, Text, StyleSheet, Platform, processColor,
  // 按需添加：Button, ScrollView, Switch, I18nManager 等
};
```

## 测试文件模板

### 基本结构

```typescript
import * as React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

// 1. Mock Fabric 原生组件（jest.mock 会被自动提升到文件顶部）
jest.mock('<相对路径>/<ComponentName>NativeComponent', () => {
  return require('<相对路径>/__mocks__/<ComponentName>NativeComponent');
});

// 2. 导入被测组件（此时原生组件已被 mock）
import MyComponent from '<相对路径>/<ComponentName>.harmony';

const {Item} = MyComponent as any; // 如有子组件

// 3. 快捷访问器
const lastProps = (): any => globalThis.__COMPONENT_CAPTURED_PROPS__;
const lastOnChange = (): any => globalThis.__COMPONENT_CAPTURED_ONCHANGE__;

// 4. act() 包裹的渲染辅助函数（React 19 必须）
function renderComponent(element: React.ReactElement) {
  let renderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

// 5. 测试用例
describe('MyComponent', () => {
  beforeEach(() => {
    globalThis.__COMPONENT_CAPTURED_PROPS__ = null;
    globalThis.__COMPONENT_CAPTURED_ONCHANGE__ = null;
  });

  // 渲染基础测试
  describe('渲染基础测试', () => {
    it('should render with children', () => {
      renderComponent(<MyComponent prop1="value" />);
      expect(lastProps()).toBeTruthy();
    });

    it('should render without crashing with empty children', () => {
      renderComponent(<MyComponent prop1="value">{null}</MyComponent>);
      expect(lastProps()).toBeTruthy();
    });
  });

  // 状态计算测试
  describe('状态计算', () => {
    it('should calculate correct state based on prop', () => {
      renderComponent(<MyComponent selectedValue="key1" />);
      expect(lastProps().selectedIndex).toBe(1);
    });
  });

  // 事件处理测试
  describe('事件处理', () => {
    it('should call onChange and onValueChange', () => {
      const onChange = jest.fn();
      const onValueChange = jest.fn();
      renderComponent(<MyComponent onChange={onChange} onValueChange={onValueChange} />);

      const mockEvent = {
        nativeEvent: { newValue: 'key1', newIndex: 1 },
      };
      act(() => {
        lastOnChange()(mockEvent);
      });

      expect(onChange).toHaveBeenCalledWith(mockEvent);
      expect(onValueChange).toHaveBeenCalledWith('key1', 1);
    });

    it('should not crash when callbacks not provided', () => {
      renderComponent(<MyComponent />);
      expect(() => {
        act(() => { lastOnChange()({ nativeEvent: {} }); });
      }).not.toThrow();
    });
  });

  // Prop 传递测试
  describe('prop 传递到原生组件', () => {
    it('should pass testID to native', () => {
      renderComponent(<MyComponent testID="my-id" />);
      expect(lastProps().testID).toBe('my-id');
    });

    it('should pass enabled to native', () => {
      renderComponent(<MyComponent enabled={false} />);
      expect(lastProps().enabled).toBe(false);
    });
  });

  // ref 转发测试
  describe('ref forwarding', () => {
    it('should forward ref to native', () => {
      const ref = React.createRef() as any;
      renderComponent(<MyComponent ref={ref} />);
      expect(ref.current).toBeTruthy();
    });
  });

  // 静态属性测试
  describe('static properties', () => {
    it('should expose Item as static property', () => {
      expect(MyComponent.Item).toBeDefined();
    });
  });
});
```

## 测试用例设计原则

### 1. 覆盖率维度

| 维度 | 覆盖内容 | 示例 |
| ---- | -------- | ---- |
| 渲染 | 组件能正常渲染，props 正确传递 | `expect(lastProps()).toBeTruthy()` |
| 状态计算 | useMemo/useState 计算结果正确 | `expect(lastProps().selectedIndex).toBe(1)` |
| 数据映射 | children → items 映射正确 | `expect(lastProps().items[0]).toEqual({...})` |
| 类型转换 | String/Number 转换正确 | `expect(lastProps().items[0].label).toBe('123')` |
| 事件处理 | onChange/onValueChange 正确调用 | `expect(onValueChange).toHaveBeenCalledWith('key1', 1)` |
| 边界值 | null/undefined/默认值处理 | `expect(lastProps().numberOfLines).toBe(1)` |
| 数值处理 | round/clamp 逻辑 | `expect(lastProps().numberOfLines).toBe(3)` |
| Prop 透传 | 所有 prop 正确传递到原生组件 | `expect(lastProps().testID).toBe('my-id')` |
| Ref 转发 | ref 正确转发 | `expect(ref.current).toBeTruthy()` |
| 静态属性 | 子组件作为静态属性暴露 | `expect(MyComponent.Item).toBeDefined()` |

### 2. 测试优先级

1. **P0 — 核心逻辑**: 状态计算（useMemo）、数据映射（children → items）
2. **P0 — 事件处理**: onChange/onValueChange 回调验证
3. **P1 — Prop 传递**: 所有 props 正确传递到原生组件
4. **P1 — 边界值**: null/undefined/默认值/数值处理
5. **P2 — Ref 转发**: ref 正确转发到原生组件
6. **P2 — 静态属性**: 子组件（如 Item）正确暴露

### 3. 不适合单元测试的内容

以下内容依赖原生运行时，不适合在 jest 单元测试中覆盖，应在真机集成测试中验证：

- `useLayoutEffect` 中通过 `global.nativeFabricUIManager` 调用 NativeCommands
- `setNativeProps` 实际效果
- `processColor` 的真实颜色转换（mock 中透传即可）
- 原生组件的实际渲染行为

在覆盖率报告中标注为「不适用（原生环境）」。
