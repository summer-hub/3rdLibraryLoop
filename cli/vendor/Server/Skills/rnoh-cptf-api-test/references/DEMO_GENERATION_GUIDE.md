# Demo 生成指南

> Phase 2-3 的详细操作手册。核心是平台兼容性分析、可测试性设计、Demo 代码生成规范。

---

## 1. 平台兼容性分析

### 1.1 Platform.OS 分支分析

搜索入口文件中的平台分支：

```bash
grep -n "Platform.OS" {projectRoot}/node_modules/{harmonyPkgName}/index.js
grep -n "Platform.OS" {projectRoot}/node_modules/{harmonyPkgName}/src/**/*.ts
```

分析结果分类：

| 分类 | 特征 | 处理 |
|------|------|------|
| harmony 可用 | `Platform.OS === 'harmony'` 分支内定义 | 生成 Demo + Test |
| iOS/Android 专属 | 仅在其他分支定义 | 跳过，不生成 |
| 无平台分支 | TurboModule 原生适配，全部可用 | 全部生成 |
| 条件导出 | `if (Platform.OS === 'harmony')` 包裹整个导出 | 按实际导出处理 |

### 1.2 方法实现状态确认

探查 ArkTS 实现文件，排除未实现方法：

```bash
grep -r "throw new Error('not implemented')" {projectRoot}/harmony/
```

| 状态 | 处理 |
|------|------|
| 已实现 | 正常生成 Demo + Test |
| `throw new Error('not implemented')` | 跳过，不生成 |
| 部分实现 | 标注，生成但测试中放宽断言 |

### 1.3 权限需求分析

```bash
cat {projectRoot}/harmony/entry/src/main/module.json5 | grep -A5 "requestPermissions"
```

常见权限映射：

| 功能 | 权限 | Demo 处理 |
|------|------|-----------|
| 麦克风 | ohos.permission.MICROPHONE | 调用前请求权限 |
| 相机 | ohos.permission.CAMERA | 调用前请求权限 |
| 定位 | ohos.permission.LOCATION | 调用前请求权限 |
| 文件读写 | ohos.permission.FILE_READ/WRITE | 调用前请求权限 |
| 网络 | ohos.permission.INTERNET | 通常自动授予 |

### 1.4 MCP 工具辅助

调用 `script_rn_scan_exports` 交叉验证：

- `dir`：`{projectRoot}/node_modules/{harmonyPkgName}`
- `compare`：false
- 单目录扫描模式，提取 exports/interface/TurboModule 方法签名

调用 `kb_search` 查询鸿蒙平台特定约束：
- `HarmonyOS 权限 {功能}`
- `RNOH TurboModule 适配`

---

## 2. 可测试性设计规则

> ⚠️ 这是本技能与 `rnoh-lib-demo-create` 的核心差异。Demo 必须为 CPTF 自动化测试而设计。

### 2.1 testID 规则

| 元素 | testID 格式 | 示例 |
|------|------------|------|
| 触发按钮 | `{apiName}-btn` | `methodA-btn` |
| 结果文本 | `{apiName}-result` | `methodA-result` |
| 状态指示 | `{apiName}-status` | `recording-status` |

```tsx
<Button testID="methodA-btn" title="调用 methodA" onPress={...} />
<Text testID="methodA-result">methodA结果：{result}</Text>
```

### 2.2 固定文本前缀规则

所有动态值必须附加固定前缀，格式：`{API名}结果：{值}`

| 场景 | 前缀格式 | 示例 |
|------|----------|------|
| 正常结果 | `{API名}结果：{值}` | `methodA结果：success` |
| 错误信息 | `错误信息：{error}` | `错误信息：TypeError` |
| 状态值 | `{API名}状态：{值}` | `录音状态：recording` |
| 数组结果 | `{API名}结果：{JSON}` | `getList结果：[1,2,3]` |
| 布尔值 | `{API名}结果：{true/false}` | `isEnabled结果：true` |

> ⚠️ 冒号统一使用**全角** `：`（中文冒号），与 testerino demo 常见风格一致。CPTF 的 `waitForText` 是子串精确匹配，断言时可省略冒号（如 `methodA结果`）以兼容两种冒号。

### 2.3 确定性输出规则

| 数据类型 | 处理方式 | 示例 |
|----------|----------|------|
| 随机数 | 附加范围标注 | `随机数结果：{value}（范围：0-100）` |
| 时间戳 | 转为可读格式 | `时间结果：{HH:MM:SS}` |
| UUID | 仅验证格式 | `UUID结果：{uuid}（格式校验）` |
| 大数据 | 截断显示 | `数据结果：{前100字符}...` |
| null/undefined | 显示字面量 | `结果：null` |

### 2.4 按钮唯一标识规则

每个按钮 title 必须包含 API 名，保证 `textContains` 全局唯一：

```tsx
// 正确：title 含 API 名，唯一
<Button title="调用 methodA(参数1)" />
<Button title="调用 methodB" />

// 错误：title 重复或不唯一
<Button title="执行" />
<Button title="测试" />
```

---

## 3. Demo 页面代码规范

### 3.1 目录结构

```
{exampleDir}/cptf/
├── index.tsx                  # 主入口
└── demo/
    ├── 001_{apiCategory1}Page.tsx   # 按 API 分类拆分页面
    ├── 002_{apiCategory2}Page.tsx
    └── ...
```

文件命名规则：
- 前缀序号：`001_`、`002_`，按 API 分类顺序
- 分类名：kebab-case，如 `turbo-module-methods`、`component-props`、`events`
- 示例：`001_turbo-module-methods.tsx`、`002_component-props.tsx`、`003_events.tsx`

### 3.2 页面代码核心规则

| 规则 | 说明 | 原因 |
|------|------|------|
| 根组件用 `View` | 禁止 `ScrollView` 作为根 | Tester 已有 ScrollView，嵌套导致高度塌陷 |
| 不用 `SafeAreaView`/`StatusBar` | Tester 框架不需要 | 避免冗余 |
| 不用 `Slider` | HarmonyOS 不支持 | 用按钮组替代 |
| 不用 `console.error()` | 会触发系统弹窗 | 用 `console.warn()` 替代 |
| 每个按钮设 `testID` | CPTF 优先 testID 定位 | 可测试性设计核心 |
| 结果 Text 固定前缀 | CPTF `waitForText` 可靠匹配 | 可测试性设计核心 |
| 无裸值渲染 | 所有动态值附加固定前缀 | 消除快照差集需求 |
| 平台兼容性 | 只用 harmony 分支 API | 基于 Phase 2.1 |
| 权限请求 | 敏感操作前请求权限 | HarmonyOS 权限模型 |
| 异步处理 | `async/await` + `try/catch` | 不用 `.then()/.catch()` 链 |
| 无注释 | 代码中不使用 `//` 或 `/* */` | 代码规范 |
| Hook 顶层调用 | 不在事件回调中调用 Hook | React Hooks 规则 |
| type 导入 | `import { type Xxx }` inline 语法 | 避免类型进入打包 |
| Provider 子组件拆分 | 依赖 Context 的 Hook/组件拆分 | 确保 Context 有值 |
| 废弃接口验证 | 使用 `===` 引用相等性比较 | 比功能对比更可靠 |

### 3.3 各 API 类型的 Demo 页面设计

#### 3.3.1 TurboModule 同步方法

```tsx
<View>
  <Button testID="syncMethod-btn" title="调用 syncMethod(param)" onPress={() => {
    try {
      const result = NativeModule.syncMethod('param');
      setResult(`syncMethod结果：${result}`);
    } catch (e) {
      setResult(`错误信息：${e}`);
    }
  }} />
  <Text testID="syncMethod-result">{result}</Text>
</View>
```

#### 3.3.2 TurboModule 异步方法

```tsx
<View>
  <Button testID="asyncMethod-btn" title="调用 asyncMethod(param)" onPress={async () => {
    setLoading(true);
    try {
      const result = await NativeModule.asyncMethod('param');
      setResult(`asyncMethod结果：${JSON.stringify(result)}`);
    } catch (e) {
      setResult(`错误信息：${e}`);
    } finally {
      setLoading(false);
    }
  }} />
  <Text testID="asyncMethod-result">{loading ? '加载中...' : result}</Text>
</View>
```

#### 3.3.3 事件回调

```tsx
<View>
  <Button testID="startListen-btn" title="开始监听 onEvent" onPress={() => {
    const sub = DeviceEventEmitter.addListener('onEvent', (data) => {
      setEventResult(`onEvent结果：${JSON.stringify(data)}`);
    });
    setSubscription(sub);
  }} />
  <Button testID="stopListen-btn" title="停止监听 onEvent" onPress={() => {
    subscription?.remove();
    setEventResult('onEvent状态：已停止');
  }} />
  <Text testID="onEvent-result">{eventResult}</Text>
</View>
```

#### 3.3.4 组件属性

```tsx
<View>
  <Button testID="toggleProp-btn" title="切换 prop1 值" onPress={() => setProp1(!prop1)} />
  <Text testID="componentProp-result">组件属性prop1：{String(prop1)}</Text>
  <ComponentA prop1={prop1} />
</View>
```

#### 3.3.5 常量/枚举

```tsx
<View>
  <Text testID="constant-result">常量CONSTANT_A：{NativeModule.CONSTANT_A}</Text>
</View>
```

### 3.4 权限请求模板

```tsx
import { Permissions } from 'react-native';

const requestPermission = async (permission: string): Promise<boolean> => {
  try {
    const granted = await Permissions.request(permission);
    return granted === 'granted';
  } catch (e) {
    console.warn(`权限请求失败: ${e}`);
    return false;
  }
};
```

---

## 4. 主入口文件与注册

### 4.1 index.tsx 结构

```tsx
import { Tester, TestSuite, TestCase } from '@rnoh/testerino';
import React from 'react';
import { TurboModuleMethodsPage } from './demo/001_turbo-module-methods';
import { ComponentPropsPage } from './demo/002_component-props';
import { EventsPage } from './demo/003_events';

function {LibName}Tester() {
  return (
    <Tester>
      <TestSuite name="{libName}">
        <TestCase itShould="TurboModule 方法测试" tags={['C_API']}>
          <TurboModuleMethodsPage />
        </TestCase>
        <TestCase itShould="组件属性测试" tags={['C_API']}>
          <ComponentPropsPage />
        </TestCase>
        <TestCase itShould="事件回调测试" tags={['C_API']}>
          <EventsPage />
        </TestCase>
      </TestSuite>
    </Tester>
  );
}

export default {LibName}Tester;
export const displayName = '{libName}';
export const framework = 'react';
export const category = '{category}';
export const title = '{libName}';
export const description = '{libName} 接口规格驱动 Demo';
export const examples = [
  { title: 'TurboModule 方法', description: '...' },
  { title: '组件属性', description: '...' },
  { title: '事件回调', description: '...' },
];
```

### 4.2 Demo 入口切换

> 本技能不修改现有 `registerFile`（如 `RNTesterList.ts`），而是直接修改 `{exampleDir}/index.js`，将 App 入口指向 CPTF Demo：

```js
// {exampleDir}/index.js — 修改前
import App from './src/index';
// 修改后
import App from './cptf/index';
```

这样 CPTF 测试运行时 App 直接加载 CPTF Demo 页面，无需在现有 Demo 注册体系中追加。

### 4.3 入口切换说明

本技能采用**直接修改 `index.js`** 的方式切换 Demo 入口，而非在现有 `registerFile`（如 `RNTesterList.ts`）中追加注册。原因：

1. CPTF 测试需要 App 启动即加载 CPTF Demo 页面（含 testerino Tester 框架），不经过现有 Demo 选择器
2. 不污染现有 Demo 注册体系，交付后可轻松恢复（将 `index.js` 改回 `./src/index`）
3. 无需识别 registerFile 的注册模式（A/B/C）

> ⚠️ 修改 `index.js` 后必须重新构建 HAP（`npm run dev` + `devecocli build`），否则设备上的 `bundle.harmony.js` 不含新入口。

---

## 5. 常见陷阱

### 5.1 全角/半角冒号

Demo 代码中结果文本的冒号必须统一使用全角 `：`，CPTF 测试的 `waitForText` 参数也必须逐字符匹配。

如果 Demo 代码中混用了半角 `:`，CPTF 测试将无法匹配，导致步骤超时。

### 5.2 异步渲染时序

异步方法调用后，结果 Text 可能需要一段时间才渲染。Demo 代码应：
- 异步执行期间显示 `加载中...` 文本
- CPTF 测试的 `waitForText` 应轮询等待（timeout 8000ms）

### 5.3 事件监听清理

Demo 中注册的事件监听器必须在组件卸载时清理：

```tsx
useEffect(() => {
  return () => {
    subscription?.remove();
  };
}, [subscription]);
```

否则 CPTF 测试重复进入页面时可能出现内存泄漏。

### 5.4 无平台分支库

部分库（如 `react-native-safe-area-context`）没有 `Platform.OS === 'harmony'` 分支，而是通过 TurboModule 原生适配。探查时需区分此类库，无需过滤 iOS/Android 专属属性，JS 层所有导出在 HarmonyOS 上全部可用。

### 5.5 废弃接口

部分库包含 `@deprecated` 废弃别名接口。废弃接口在 HarmonyOS 平台仍正常可用，需生成 Demo 验证其兼容性，并使用引用相等性比较（`===`）验证别名关系。
