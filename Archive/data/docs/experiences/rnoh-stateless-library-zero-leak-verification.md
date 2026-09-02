# RNOH 无状态库"零泄露面"穷尽验证模式集

### 问题现象

RN 三方库鸿蒙化为纯 TurboModule 形态（无 NativeComponent），业务能力全部映射到鸿蒙系统静态一次性 API（如 `WebCookieManager` 的 fetchCookie/configCookieSync 等）时，整个实现呈现"零状态"特征：无事件监听（无 on/off、无 NativeEventEmitter/DeviceEventEmitter）、无 Map/Set/缓存容器、无实例字段、C++ 层为纯无捕获静态 host function 转发（零 NAPI 调用、零 new/malloc）。对这类库，内存检视重点应从"释放是否完整"转向"是否真的不存在隐藏的持有"，需要穷尽验证后才能下"零泄露面"结论。

### 解决方案

用以下 rg 模式集做穷尽验证（全库 0 命中即可确认零泄露面）：

```bash
# 1. 生命周期/监听/订阅
rg -n "__onDestroy__|onDestroy|aboutToDisappear|onDropViewInstance|addListener|removeListener|EventEmitter|addEventListener" <ets/cpp/js 目录>
# 2. 鸿蒙 on/off 订阅对
rg -n "\.on\(|\.off\(" <ets 目录>
# 3. 容器与静态状态
rg -n "Map<|Set<|static |private " <ets 目录> --glob '*.ts' --glob '*.ets'
# 4. C++ 内存与 NAPI（仅手写文件）
rg -n "new |malloc|napi_|delete |free\(" <cpp 目录> -g '<手写文件 pattern>'
# 5. 定时器
rg -n "setInterval|setTimeout" <ets 目录>
```

要点：
- C++ 检查必须区分手写文件与 `generated/` 目录（用 `-g` 限定只查手写文件），避免 codegen 产物干扰统计。
- codegen 生成的空壳文件（EventEmitters/Props/ShadowNodes 等）单独确认"空实现无资源"即可，不逐文件深查。
- codegen 组件空壳快速判定：无 NativeComponent 的库 codegen 仍会生成组件文件，看 Package 头文件（如 `BaseReactNativeXXXPackage.h`）中 `createComponentDescriptorProviders()`/`createComponentJSIBinderByName()` 返回值是否为空集合、`supportedComponentNames/supportedEventNames` 是否为空 vector——是则整组组件文件按空壳处理，NativeComponent 维度记"不适用"而非"通过"。

### 结果

rntpc_cookies（@react-native-ohos/cookies）实测六组模式全部 0 命中，确认零泄露面，内存检视评分 95/100（仅 1 处死代码单例轻微扣 5 分）。该验证模式集可作为所有 RNOH 鸿蒙化库无状态判定的标准流程，避免遗漏隐藏持有。