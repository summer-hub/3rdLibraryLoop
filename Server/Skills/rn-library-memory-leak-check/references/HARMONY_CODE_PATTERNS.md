# 鸿蒙化代码特征识别模式

> 本文档详细列出 Phase 0 中用于识别 RN 三方库鸿蒙化实现代码的特征模式，包括 RN JS 三方库判定、ArkTS/ETS 层特征、C++ Native 层特征及常见目录结构。

---

## 1. RN JS 三方库判定

扫描源码 ts、js 和 tsx 文件，识别是否**不包含**以下 RN 鸿蒙化特征。若不包含，则判定为 **RNJS 三方库**，不进行后续内存泄露检视，直接输出报告评分 0 分，标注"RNJS 三方库"。

**ts、js 和 tsx 文件代码特征**：

```typescript
// 特征 1：TurboModule 模块导入
import { TurboModuleRegistry } from 'react-native';
TurboModuleRegistry.getEnforcing<Spec>('Xxx');

// 特征 2：NativeModules 模块导入
import { NativeModules } from 'react-native';
NativeModules.xxxTurboModule;

// 特征 3：Native Component 组件导入
import codegenNativeComponent from 'xxxx'
codegenNativeComponent<NativeProps>(
  'Xxxx'
) as HostComponent<NativeProps>;
```

---

## 2. ArkTS/ETS 代码特征

```typescript
// 特征 1：@ohos 模块导入
import ble from '@ohos.bluetooth';
import geoLocationManager from '@ohos.geoLocationManager';

// 特征 2：RN TurboModule 鸿蒙实现
class XxxTurboModule extends TurboModule {
  // ...
}

// 特征 3：RN NativeComponent 鸿蒙实现
@Component
export struct RNCWebView {
    // ...
}

// 特征 4：RN Bridge 事件机制
this.eventEmitter = new NativeEventEmitter(xxxNativeModule);
this.deviceEventEmitter.addListener('xxx', callback);

// 特征 5：.ets 文件扩展名
*.ets  // ArkTS 文件
```

---

## 3. C++ Native 代码特征

```cpp
// 特征 1：包括但不仅限于以下头文件
#include  "RNOH/CppComponentInstance.h" // 关键 RN 组件头文件
#include <napi/native_api.h>
#include <ReactCommon/TurboModule.h>

// 特征 2：含有 CppComponentInstance
class XxxxxxComponentInstance
    : public CppComponentInstance<> {
}

// 特征 3：TurboModule/JSI 特征
class XxxTurboModule : public TurboModule {
  // JSI HostFunction / HostObject
};

// 特征 4：NAPI 函数调用
napi_create_reference(env, value, 1, &ref);
napi_wrap(env, jsThis, nativePtr, finalizeCb, nullptr, &ref);
```

---

## 4. 常见鸿蒙化目录结构

> ⚠️ 目录名称仅供参考，**不作为唯一判定依据**。必须通过代码特征交叉验证。

```
常见目录名称：
├── harmony/                    # 最常见
├── ohos/                       # 部分库使用
├── harmonyos/                  # 部分库使用
├── example/                    # 示例代码 ❌ 不检视
├── android/                    # Android 实现 ❌ 不检视
├── ios/                        # iOS 实现 ❌ 不检视
├── js/                         # RN JS 层 ❌ 不检视
```

---

## 5. 判定规则

| 条件 | 判定结果 |
|------|----------|
| 扫描到 `@ohos` 模块导入、TurboModule/JSI 实现或 NAPI 函数调用 | 确认鸿蒙化实现，进入 Phase 1 |
| 存在 `.ets` 文件且包含鸿蒙 API 调用或 RN 组件实现 | 确认鸿蒙化实现，进入 Phase 1 |
| 扫描整个源码均未发现鸿蒙代码特征 | 报告评分 0 分，标注"未实现鸿蒙化" |
| 源码不包含 TurboModuleRegistry/NativeModules/codegenNativeComponent 特征 | 判定为 RNJS 三方库，评分 0 分 |

---

## 6. RN 鸿蒙化架构关键差异

> 与 Flutter 对比，理解 RN 鸿蒙化的核心架构概念。

| 概念 | Flutter | React Native |
|------|---------|-------------|
| 插件注册 | FlutterPlugin | TurboModule / NativeModule |
| 通信机制 | MethodChannel | Bridge / JSI / TurboModule |
| UI 组件 | Flutter Widget | NativeComponent（ViewManager） |
| 事件系统 | EventChannel | NativeEventEmitter / RCTEventEmitter |
| 生命周期 | onAttached/DetachedFromEngine | constructor/__onDestroy__（TurboModule）/ aboutToAppear/aboutToDisappear（NativeComponent） |
