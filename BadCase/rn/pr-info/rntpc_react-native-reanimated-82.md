# PR #82: fix(harmony): Fix the online crash issue of didi

- **状态**: merged
- **作者**: chenhaoyue1
- **创建时间**: 2026-07-30T21:20:17+08:00
- **分支**: 0730 → br_rnoh0.77
- **变更文件数**: 1

## PR 描述

fix(harmony): Fix the online crash issue of didi

The online crash issue of Didi, with a crash rate of 0.01%

Closed: [#54](https://gitcode.com/CPF-RN/rntpc_react-native-reanimated/issues/54)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/reanimated/src/main/cpp/patches/NativeModules/ReanimatedModuleProxy.cpp` | ? | +31 | -0 |

## Diff

### `harmony/reanimated/src/main/cpp/patches/NativeModules/ReanimatedModuleProxy.cpp`

```diff
@@ -256,6 +256,37 @@ ReanimatedModuleProxy::~ReanimatedModuleProxy() {
   }
   layoutAnimationsProxy_.reset();
 
+  // 主动触发 Hermes GC：在 uiWorkletRuntime_ 销毁前回收 Hermes 堆中持有
+  // ShadowNode::Shared（通过 NativeState / ShadowNodeWrapper）的 JSI 对象。
+  //
+  // 此处 commitHook_ / mountHook_ 仍未 reset，它们持有 uiManager_ 的
+  // shared_ptr，确保 GC 回收 ShadowNodeWrapper 触发 ~ShadowNodeFamily 时
+  // ComponentDescriptorRegistry 仍然有效。这样可避免 uiWorkletRuntime_.reset()
+  // → HadesGC::finalizeAll() 在上下文可能已失效后触发
+  // ~ShadowNodeFamily → ~InstanceHandle 崩溃（0730 复现变体根因）。
+  //
+  // UI runtime 为 LockableRuntime（supportsLocking=true），每个 JSI 操作
+  // 自动加锁 runtimeMutex_（recursive_mutex），从主线程调用 gc() 会阻塞
+  // 等待 UI 线程完成当前 worklet 后执行，不会死锁。
+#if JS_RUNTIME_HERMES
+  if (uiWorkletRuntime_) {
+    try {
+      auto &uiRuntime = uiWorkletRuntime_->getJSIRuntime();
+      auto gc = uiRuntime.global().getPropertyAsFunction(uiRuntime, "gc");
+      gc.call(uiRuntime);
+    } catch (const std::exception &) {
+      // gc() 调用失败不应阻止后续析构流程
+    } catch (...) {
+      // 忽略未知异常，保证析构不因 GC 失败而 terminate
+    }
+  }
+#endif // JS_RUNTIME_HERMES
+
+  // GC 之后再注销 hooks：确保 GC 回收 ShadowNodeWrapper 时
+  // UIManager（及 ComponentDescriptorRegistry）仍存活
+  commitHook_.reset();
+  mountHook_.reset();
+  uiManager_.reset();
 #endif // RCT_NEW_ARCH_ENABLED
   uiWorkletRuntime_.reset();
 }

```
