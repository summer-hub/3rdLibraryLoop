# Demo 页面模板

> 生成 Demo 页面 .tsx 文件时可直接复制此模板，替换 `{占位符}` 内容。

---

## 标准 Demo 页面模板

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ComponentName } from '@react-native-ohos/{libName}';

const TAG = '{libName}_{DemoName}';

const {DemoName}Page = () => {
  const [result, setResult] = useState<string>('');
  const [callCount, setCallCount] = useState<number>(0);
  const [callbackCount, setCallbackCount] = useState<number>(0);

  useEffect(() => {
    console.log(`[${TAG}] Component mounted`);
    return () => {
      console.log(`[${TAG}] Component unmounted`);
    };
  }, []);

  const handleAction = useCallback(async () => {
    setCallCount(prev => prev + 1);
    try {
      const res = await ComponentName.someMethod();
      setResult(JSON.stringify(res));
      setCallbackCount(prev => prev + 1);
    } catch (error: any) {
      console.warn(`[${TAG}] Failed: ${error?.message || error}`);
      setResult(`Error: ${error?.message || error}`);
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{DemoName}</Text>
        <TouchableOpacity style={styles.button} onPress={handleAction}>
          <Text style={styles.buttonText}>Execute</Text>
        </TouchableOpacity>
        <View style={styles.resultRow}>
          <Text style={styles.label}>Call Count:</Text>
          <Text style={styles.value}>{callCount}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.label}>Callback Count:</Text>
          <Text style={styles.value}>{callbackCount}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.label}>Result:</Text>
          <Text style={styles.value}>{result}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  card: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  button: {
    padding: 12,
    borderRadius: 6,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
  },
  resultRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    color: '#666',
    width: 120,
  },
  value: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
});

export default {DemoName}Page;
```

---

## 带权限请求的 Demo 页面模板

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AudioRecorder } from '@react-native-ohos/{libName}';

const TAG = '{libName}_{DemoName}';

const {DemoName}Page = () => {
  const [resultInfo, setResultInfo] = useState<string>('');
  const [callCount, setCallCount] = useState<number>(0);

  useEffect(() => {
    console.log(`[${TAG}] Component mounted`);
    return () => {
      console.log(`[${TAG}] Component unmounted`);
    };
  }, []);

  const handleAction = useCallback(async () => {
    setCallCount(prev => prev + 1);
    try {
      const authorized = await AudioRecorder.requestAuthorization();
      if (!authorized) {
        setResultInfo('权限被拒绝，请在设置中开启');
        return;
      }
      const result = await AudioRecorder.startRecording();
      setResultInfo(`Success: ${JSON.stringify(result)}`);
    } catch (error: any) {
      console.warn(`[${TAG}] Failed: ${error?.message || error}`);
      setResultInfo(`Error: ${error?.message || error}`);
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{DemoName}</Text>
        <TouchableOpacity style={styles.button} onPress={handleAction}>
          <Text style={styles.buttonText}>Start</Text>
        </TouchableOpacity>
        <Text style={styles.text}>Call Count: {callCount}</Text>
        <Text style={styles.text}>Result: {resultInfo}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  button: { padding: 12, borderRadius: 6, backgroundColor: '#007AFF', alignItems: 'center', marginBottom: 12 },
  buttonText: { color: '#fff', fontSize: 14 },
  text: { fontSize: 14, color: '#333', marginBottom: 4 },
});

export default {DemoName}Page;
```

---

## 带计时器兜底的 Demo 页面模板

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AudioRecorder } from '@react-native-ohos/{libName}';

const TAG = '{libName}_{DemoName}';

const {DemoName}Page = () => {
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    console.log(`[${TAG}] Component mounted`);
    return () => {
      console.log(`[${TAG}] Component unmounted`);
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setRecordingTime(elapsed);
    }, 100);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleStart = useCallback(async () => {
    try {
      const authorized = await AudioRecorder.requestAuthorization();
      if (!authorized) {
        return;
      }
      await AudioRecorder.startRecording();
      setIsRecording(true);
      startTimer();
    } catch (error: any) {
      console.warn(`[${TAG}] Start failed: ${error?.message || error}`);
    }
  }, []);

  const handleStop = useCallback(async () => {
    try {
      await AudioRecorder.stopRecording();
      setIsRecording(false);
      clearTimer();
    } catch (error: any) {
      console.warn(`[${TAG}] Stop failed: ${error?.message || error}`);
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{DemoName}</Text>
        <Text style={styles.text}>Time: {recordingTime.toFixed(1)}s</Text>
        <Text style={styles.text}>Status: {isRecording ? 'Recording' : 'Stopped'}</Text>
        <TouchableOpacity style={styles.button} onPress={handleStart} disabled={isRecording}>
          <Text style={styles.buttonText}>Start</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={handleStop} disabled={!isRecording}>
          <Text style={styles.buttonText}>Stop</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  button: { padding: 12, borderRadius: 6, backgroundColor: '#007AFF', alignItems: 'center', marginBottom: 8 },
  buttonText: { color: '#fff', fontSize: 14 },
  text: { fontSize: 14, color: '#333', marginBottom: 4 },
});

export default {DemoName}Page;
```

---

## Slider 替代方案模板

```tsx
<View style={styles.buttonRow}>
  <TouchableOpacity style={styles.miniButton} onPress={() => handleValueChange(-0.1)}>
    <Text style={styles.miniButtonText}>-0.1</Text>
  </TouchableOpacity>
  <Text style={styles.valueText}>{value.toFixed(2)}</Text>
  <TouchableOpacity style={styles.miniButton} onPress={() => handleValueChange(0.01)}>
    <Text style={styles.miniButtonText}>+0.01</Text>
  </TouchableOpacity>
</View>
```

```typescript
const styles = StyleSheet.create({
  buttonRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  miniButton: { padding: 8, borderRadius: 4, backgroundColor: '#007AFF', marginHorizontal: 4 },
  miniButtonText: { color: '#fff', fontSize: 12 },
  valueText: { fontSize: 14, color: '#333', marginHorizontal: 8 },
});
```

---

## 废弃接口验证模板（Provider 子组件拆分）

> 当 Demo 需要验证 `@deprecated` 废弃别名接口（如 `useSafeArea`、`SafeAreaConsumer`、`SafeAreaContext`）时使用此模板。核心技巧：拆分 InnerComponent 放在 Provider 内部，使用 `===` 引用比较验证别名关系。

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  useSafeArea,
  SafeAreaConsumer,
  SafeAreaContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
} from 'react-native-safe-area-context';

const TAG = '{libName}_{DemoName}';

const InnerComponent = () => {
  const [isSameContext, setIsSameContext] = useState(false);
  const [verifyCount, setVerifyCount] = useState(0);

  const insets = useSafeArea();

  const handleVerify = useCallback(() => {
    setVerifyCount(c => c + 1);
    setIsSameContext(SafeAreaContext === SafeAreaInsetsContext);
  }, []);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>废弃 Context 别名验证</Text>
      <View style={styles.resultRow}>
        <Text style={styles.label}>useSafeArea 返回:</Text>
        <Text style={styles.value}>{JSON.stringify(insets)}</Text>
      </View>
      <SafeAreaConsumer>
        {(consumerInsets) => (
          <View style={styles.resultRow}>
            <Text style={styles.label}>SafeAreaConsumer 返回:</Text>
            <Text style={styles.value}>{JSON.stringify(consumerInsets)}</Text>
          </View>
        )}
      </SafeAreaConsumer>
      <View style={styles.resultRow}>
        <Text style={styles.label}>Context 相同:</Text>
        <Text style={styles.value}>{isSameContext.toString()}</Text>
      </View>
      <View style={styles.resultRow}>
        <Text style={styles.label}>验证次数:</Text>
        <Text style={styles.value}>{verifyCount}</Text>
      </View>
      <TouchableOpacity style={styles.button} onPress={handleVerify}>
        <Text style={styles.buttonText}>验证废弃别名</Text>
      </TouchableOpacity>
    </View>
  );
};

const {DemoName}Page = () => {
  useEffect(() => {
    console.log(`[${TAG}] Component mounted`);
    return () => {
      console.log(`[${TAG}] Component unmounted`);
    };
  }, []);

  return (
    <View style={styles.container}>
      <SafeAreaProvider>
        <InnerComponent />
      </SafeAreaProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  resultRow: { flexDirection: 'row', marginBottom: 8 },
  label: { fontSize: 14, color: '#666', width: 160 },
  value: { fontSize: 14, color: '#333', flex: 1 },
  button: { padding: 12, borderRadius: 6, backgroundColor: '#007AFF', alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 14 },
});

export default {DemoName}Page;
```

---

## 废弃初始值/常量验证模板

> 当 Demo 需要验证 `@deprecated` 废弃常量（如 `initialWindowSafeAreaInsets`）和废弃 Props（如 `initialSafeAreaInsets`）时使用此模板。核心技巧：在 useEffect 中读取常量值，通过 Provider 注入初始值后子组件读取验证。

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowSafeAreaInsets,
  type EdgeInsets,
} from 'react-native-safe-area-context';

const TAG = '{libName}_{DemoName}';

const customInitialInsets: EdgeInsets = { top: 50, right: 0, bottom: 50, left: 0 };

type InnerComponentProps = {
  onInsets: (text: string) => void;
};

const InnerComponent = ({ onInsets }: InnerComponentProps) => {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    onInsets(JSON.stringify(insets));
  }, [insets, onInsets]);

  return <View />;
};

const {DemoName}Page = () => {
  const [windowInsetsText, setWindowInsetsText] = useState('未获取');
  const [providerInsetsText, setProviderInsetsText] = useState('未获取');
  const [verifyCount, setVerifyCount] = useState(0);

  useEffect(() => {
    console.log(`[${TAG}] Component mounted`);
    setWindowInsetsText(initialWindowSafeAreaInsets ? JSON.stringify(initialWindowSafeAreaInsets) : 'null');
    return () => {
      console.log(`[${TAG}] Component unmounted`);
    };
  }, []);

  const handleInsets = useCallback((text: string) => {
    setProviderInsetsText(text);
  }, []);

  const handleVerify = useCallback(() => {
    setVerifyCount(c => c + 1);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>废弃初始值属性验证</Text>
        <View style={styles.resultRow}>
          <Text style={styles.label}>initialWindowSafeAreaInsets:</Text>
          <Text style={styles.value}>{windowInsetsText}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.label}>Provider 注入值:</Text>
          <Text style={styles.value}>{providerInsetsText}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.label}>自定义初始值:</Text>
          <Text style={styles.value}>{JSON.stringify(customInitialInsets)}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.label}>验证次数:</Text>
          <Text style={styles.value}>{verifyCount}</Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={handleVerify}>
          <Text style={styles.buttonText}>验证初始值</Text>
        </TouchableOpacity>
      </View>
      <SafeAreaProvider initialSafeAreaInsets={customInitialInsets}>
        <InnerComponent onInsets={handleInsets} />
      </SafeAreaProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  resultRow: { flexDirection: 'row', marginBottom: 8 },
  label: { fontSize: 14, color: '#666', width: 180 },
  value: { fontSize: 14, color: '#333', flex: 1 },
  button: { padding: 12, borderRadius: 6, backgroundColor: '#007AFF', alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 14 },
});

export default {DemoName}Page;
```
