# 入口文件模板

> 生成 index.tsx 主入口文件时可直接复制此模板，替换 `{占位符}` 内容。文件生成在 Phase 1.2 探查到的 `{exampleDir}/{libName}/index.tsx`。

---

## 标准入口模板

```tsx
import React from 'react';
import { ScrollView } from 'react-native';
import { Tester, TestCase, TestSuite } from '@rnoh/testerino';

import Demo1Page from './demo/001_{描述1}Page';
import Demo2Page from './demo/002_{描述2}Page';
import Demo3Page from './demo/003_{描述3}Page';

function MainDemo() {
  return (
    <Tester>
      <TestSuite name="{libName}">
        <TestCase itShould="{Demo1描述}">
          <Demo1Page />
        </TestCase>
        <TestCase itShould="{Demo2描述}">
          <Demo2Page />
        </TestCase>
        <TestCase itShould="{Demo3描述}">
          <Demo3Page />
        </TestCase>
      </TestSuite>
    </Tester>
  );
}

export default function {LibNamePascalCase}Tester() {
  return (
    <ScrollView style={{ height: '100%', width: '100%' }}>
      <MainDemo />
    </ScrollView>
  );
}

export const displayName = '{libName}';
export const framework = 'React';
export const category = '{category}';
export const title = '{libName}';
export const documentationURL = 'https://gitcode.com/OpenHarmony-RN/usage-docs/tree/master/zh-cn';
export const description = '{简短描述}';

export const examples = [
  {
    title: '{libName} Demo',
    render: function (): any {
      return <MainDemo />;
    },
  },
];
```

---

## Demo 注册模板

> 在 Phase 1.2 探查到的 `registerFile` 中追加注册。**按该文件现有的注册模式追加**，路径根据 `registerFile` 到 `indexFile` 的实际目录层级计算。

### 模式 A：RNTesterList.ts 数组注册

适用于 RNTester 框架（`registerFile` 为 `RNTesterList.ts` 或类似文件），在组件列表数组中添加：

```typescript
{
  key: '{libName}',
  category: '{category}',
  module: require('{相对路径}'),
}
```

**路径计算示例**：

| registerFile 位置 | indexFile 位置 | require 相对路径 |
|------------------|---------------|-----------------|
| `rn-tester/utils/RNTesterList.ts` | `rn-tester/examples/{libName}/index.tsx` | `../examples/{libName}/index` |
| `example/src/RNTesterList.ts` | `example/src/demos/{libName}/index.tsx` | `./demos/{libName}/index` |
| `example/src/App.tsx` | `example/src/examples/{libName}/index.tsx` | `./examples/{libName}/index` |

**注意事项**：
- 不使用 `.default`，直接 require 整个模块
- category 可以是 `'UI'`、`'Basic'`、`'Component'`、`'API'`、`'Media'` 等
- 路径必须从 `registerFile` 所在目录到 `indexFile` 的相对路径

### 模式 B：App.tsx 导入注册

适用于 example 工程（`registerFile` 为 `App.tsx` 或导航配置文件）：

```typescript
import {LibNamePascalCase}Tester from '{相对路径}';

// 在导航/路由配置中注册该 Demo 页面
```

### 模式 C：自定义 demos 数组注册

适用于工程自带的自定义 Tester 入口（`registerFile` 为 `example/src/index.tsx` 或类似文件，含 `demos`/`items` 数组）：

**步骤 1：在文件顶部添加 import**

```typescript
import {LibNamePascalCase}Tester from './{相对于registerFile的路径到index}';
```

**步骤 2：在 demos 数组末尾追加条目**

```typescript
const demos: IDemoItem[] = [
  // ...已有条目
  { Component: {LibNamePascalCase}Tester, name: '{Demo显示名}', key: '{LibNamePascalCase}' }
];
```

**模式识别方法**：

读取 `registerFile` 内容后，按以下特征判断是否为模式 C：

| 特征 | 判定 |
|------|------|
| 文件含 `demos` 或 `items` 数组 | 模式 C 候选 |
| 数组元素含 `Component` 字段 | 确认模式 C |
| 数组元素含 `module` 字段 + `require()` | 模式 A |
| 文件含导航/路由配置 + `import` | 模式 B |

**注意事项**：
- 追加条目时保持与已有条目相同的字段结构（`Component`、`name`、`key`）
- `key` 值需唯一，不与已有条目冲突
- import 路径为从 `registerFile` 所在目录到 `indexFile` 的相对路径

---

## 完整文件结构

```
{exampleDir}/
└── {libName}/
    ├── index.tsx                  # 主入口（上方模板）
    └── demo/
        ├── 001_{描述1}Page.tsx    # Demo 页面（参见 Demo 页面模板）
        ├── 002_{描述2}Page.tsx
        ├── 003_{描述3}Page.tsx
        └── ...
```

`{exampleDir}` 由 Phase 1.2 探查确定，常见值：
- `rn-tester/examples/`
- `example/src/`
- `examples/src/`
- `example/`
- `demo/src/`
- `demo/`

---

## 元数据字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| `displayName` | 库显示名称 | `react-native-audio` |
| `framework` | 框架 | `React` |
| `category` | 分类 | `UI` / `API` / `Media` / `Basic` / `Component` |
| `title` | 标题 | `react-native-audio` |
| `documentationURL` | 文档地址 | RNOH 官方文档 URL |
| `description` | 简短描述 | 库功能简介 |
| `examples` | 示例数组 | 包含 title 和 render 函数 |
