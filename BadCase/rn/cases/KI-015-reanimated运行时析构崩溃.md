# KI-015 react-native-reanimated：动画 crash（滴滴线上 0.01%）

- **元数据**: `rule: R-12` · `verified: diff` · `source: dtse` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-reanimated/pull/82（merged，1 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-reanimated-82.md](../pr-info/rntpc_react-native-reanimated-82.md)

## 现象

鸿蒙 RN 0.77.48 动画 crash，滴滴线上 crash rate 0.01%。

## 根因

ReanimatedModuleProxy 析构时 uiWorkletRuntime_ 先于 UIManager 析构——Hermes GC 在 workletRuntime 析构时回收了相同持有 ShadowNode::Shared 的 JSI 对象，但此时 ComponentDescriptorRegistry 已失效，触发 ~ShadowNodeFamily → ~InstanceHandle 崩溃。

## 错误代码（修复前）

```cpp
// ReanimatedModuleProxy.cpp — 析构顺序错误
ReanimatedModuleProxy::~ReanimatedModuleProxy() {
    // ...
    layoutAnimationsProxy_.reset();
    // ← 无主动 GC；commitHook_/mountHook_/uiManager_ 直接 reset
    commitHook_.reset();
    mountHook_.reset();
    uiManager_.reset();
    uiWorkletRuntime_.reset();  // ← 此时 GC 回收 ShadowNode 时 ComponentDescriptorRegistry 已失效
}
```

## 正确代码（修复后）

```cpp
// ReanimatedModuleProxy.cpp — ① 在 runtime 析构前主动 GC
#if JS_RUNTIME_HERMES
  if (uiWorkletRuntime_) {
    try {
      auto &uiRuntime = uiWorkletRuntime_->getJSIRuntime();
      auto gc = uiRuntime.global().getPropertyAsFunction(uiRuntime, "gc");
      gc.call(uiRuntime);  // ② 回收持有 ShadowNode::Shared 的 JSI 对象
    } catch (const std::exception &) {
      // ③ gc() 失败不阻止后续析构
    } catch (...) {}
  }
#endif
  // ④ GC 之后再注销 hooks，确保 ComponentDescriptorRegistry 仍存活
  commitHook_.reset();
  mountHook_.reset();
  uiManager_.reset();
  uiWorkletRuntime_.reset();  // ⑤ 最后 reset runtime
```

## 修复方式

调整析构顺序：在 uiWorkletRuntime_.reset() 之前主动调用 Hermes gc() 回收持有 ShadowNode::Shared 的 JSI 对象（此时 UIManager 仍存活），GC 后再 reset hooks/UIManager，最后 reset runtime；GC 调用有 try-catch 保护。