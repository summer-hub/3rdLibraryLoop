# Demo 页面模板

> Phase 3 生成 Demo 页面时复制此模板，替换 `{占位符}` 内容。模板体现可测试性设计：testID + 固定文本前缀 + 确定性输出。

---

## 1. 完整页面骨架

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { NativeModule, type Result } from '{harmonyPkgName}';

function {ApiCategory}Page() {
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const handleResult = (apiName: string, value: string) => {
    setResult(`${apiName}结果：${value}`);
  };

  const handleError = (apiName: string, error: unknown) => {
    setResult(`错误信息：${error}`);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{apiCategory}</Text>

      {}
      <View style={styles.item}>
        <Button
          testID="syncMethod-btn"
          title="调用 syncMethod(param)"
          onPress={() => {
            try {
              const res = NativeModule.syncMethod('param');
              handleResult('syncMethod', String(res));
            } catch (e) {
              handleError('syncMethod', e);
            }
          }}
        />
        <Text testID="syncMethod-result">{result}</Text>
      </View>

      {}
      <View style={styles.item}>
        <Button
          testID="asyncMethod-btn"
          title="调用 asyncMethod(param)"
          onPress={async () => {
            setLoading(true);
            try {
              const res = await NativeModule.asyncMethod('param');
              handleResult('asyncMethod', JSON.stringify(res));
            } catch (e) {
              handleError('asyncMethod', e);
            } finally {
              setLoading(false);
            }
          }}
        />
        <Text testID="asyncMethod-result">{loading ? '加载中...' : result}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  item: { marginBottom: 16 },
});

export default {ApiCategory}Page;
```

---

## 2. 各 API 类型的 Demo 片段

### 2.1 TurboModule 同步方法

```tsx
<View style={styles.item}>
  <Button
    testID="{apiName}-btn"
    title="调用 {apiName}({params})"
    onPress={() => {
      try {
        const res = NativeModule.{apiName}({args});
        setResult(`{apiName}结果：${res}`);
      } catch (e) {
        setResult(`错误信息：${e}`);
      }
    }}
  />
  <Text testID="{apiName}-result">{result}</Text>
</View>
```

### 2.2 TurboModule 异步方法

```tsx
<View style={styles.item}>
  <Button
    testID="{apiName}-btn"
    title="调用 {apiName}({params})"
    onPress={async () => {
      setLoading(true);
      try {
        const res = await NativeModule.{apiName}({args});
        setResult(`{apiName}结果：${JSON.stringify(res)}`);
      } catch (e) {
        setResult(`错误信息：${e}`);
      } finally {
        setLoading(false);
      }
    }}
  />
  <Text testID="{apiName}-result">{loading ? '加载中...' : result}</Text>
</View>
```

### 2.3 事件回调

```tsx
function {EventName}Section() {
  const [eventResult, setEventResult] = useState('');
  const [subscription, setSubscription] = useState<NativeEventSubscription | null>(null);

  useEffect(() => {
    return () => {
      subscription?.remove();
    };
  }, [subscription]);

  return (
    <View style={styles.item}>
      <Button
        testID="start{EventName}-btn"
        title="开始监听 {eventName}"
        onPress={() => {
          const sub = DeviceEventEmitter.addListener('{eventName}', (data) => {
            setEventResult(`{eventName}结果：${JSON.stringify(data)}`);
          });
          setSubscription(sub);
          setEventResult('{eventName}状态：监听中');
        }}
      />
      <Button
        testID="stop{EventName}-btn"
        title="停止监听 {eventName}"
        onPress={() => {
          subscription?.remove();
          setSubscription(null);
          setEventResult('{eventName}状态：已停止');
        }}
      />
      <Text testID="{eventName}-result">{eventResult}</Text>
    </View>
  );
}
```

### 2.4 组件属性

```tsx
function {ComponentName}PropsSection() {
  const [propValue, setPropValue] = useState(false);

  return (
    <View style={styles.item}>
      <Button
        testID="toggle{PropName}-btn"
        title="切换 {propName} 值"
        onPress={() => setPropValue(!propValue)}
      />
      <Text testID="{propName}-result">{propName}属性：{String(propValue)}</Text>
      <{ComponentName} {propName}={propValue} />
    </View>
  );
}
```

### 2.5 常量/枚举

```tsx
<View style={styles.item}>
  <Text testID="{constantName}-result">{constantName}常量：{NativeModule.{constantName}}</Text>
</View>
```

### 2.6 权限请求

```tsx
import { Permissions } from 'react-native';

function {PermissionApiName}Section() {
  const [result, setResult] = useState('');

  const requestPermission = async (permission: string): Promise<boolean> => {
    try {
      const granted = await Permissions.request(permission);
      return granted === 'granted';
    } catch (e) {
      console.warn(`权限请求失败：${e}`);
      return false;
    }
  };

  return (
    <View style={styles.item}>
      <Button
        testID="{apiName}-btn"
        title="调用 {apiName}（需权限）"
        onPress={async () => {
          const hasPermission = await requestPermission('{permission}');
          if (!hasPermission) {
            setResult('错误信息：权限被拒绝');
            return;
          }
          try {
            const res = await NativeModule.{apiName}();
            setResult(`{apiName}结果：${JSON.stringify(res)}`);
          } catch (e) {
            setResult(`错误信息：${e}`);
          }
        }}
      />
      <Text testID="{apiName}-result">{result}</Text>
    </View>
  );
}
```

---

## 3. 主入口文件模板

```tsx
import { Tester, TestSuite, TestCase } from '@rnoh/testerino';
import React from 'react';
import TurboModuleMethodsPage from './demo/001_turbo-module-methods';
import ComponentPropsPage from './demo/002_component-props';
import EventsPage from './demo/003_events';
import ConstantsPage from './demo/004_constants';

function {LibName}Tester() {
  return (
    <Tester>
      <TestSuite name="{libName}">
        <TestCase itShould="TurboModule 方法" tags={['C_API']}>
          <TurboModuleMethodsPage />
        </TestCase>
        <TestCase itShould="组件属性" tags={['C_API']}>
          <ComponentPropsPage />
        </TestCase>
        <TestCase itShould="事件回调" tags={['C_API']}>
          <EventsPage />
        </TestCase>
        <TestCase itShould="常量/枚举" tags={['C_API']}>
          <ConstantsPage />
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
  { title: 'TurboModule 方法', description: '{libName} 的 TurboModule 同步/异步方法' },
  { title: '组件属性', description: '{libName} 的组件属性切换' },
  { title: '事件回调', description: '{libName} 的事件监听与回调' },
  { title: '常量/枚举', description: '{libName} 的常量与枚举值' },
];
```

---

## 4. 编码规则速查

| 规则 | 原因 |
|------|------|
| 根组件用 `View` | Tester 已有 ScrollView，嵌套导致塌陷 |
| 每个按钮设 `testID="{apiName}-btn"` | CPTF 优先 testID 定位，最稳定 |
| 结果 Text 固定前缀 `{API名}结果：` | CPTF `waitForText` 子串匹配可靠 |
| 冒号统一全角 `：` | 与 testerino 风格一致，避免半角匹配失败 |
| 无裸值渲染 | 消除快照差集需求，简化断言 |
| 按钮 title 含 API 名 | `textContains` 全局唯一 |
| 不用 `Slider` | HarmonyOS 不支持 |
| 不用 `console.error()` | 会触发系统弹窗 |
| 异步用 `async/await` | 不用 `.then()/.catch()` |
| 无注释 | 代码规范 |
| Hook 顶层调用 | React Hooks 规则 |
| 事件监听 useEffect 清理 | 避免内存泄漏 |
| type 导入用 inline 语法 | `import { type Xxx }` 避免类型进入打包 |
