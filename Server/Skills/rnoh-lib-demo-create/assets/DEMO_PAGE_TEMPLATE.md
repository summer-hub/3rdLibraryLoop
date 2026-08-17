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
