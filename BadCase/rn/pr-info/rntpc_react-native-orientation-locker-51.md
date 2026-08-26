# PR #51: perf:优化加速度传感器的打开和关闭

- **状态**: merged
- **作者**: qq_434633291111
- **创建时间**: 2026-08-10T16:38:38+08:00
- **分支**: br_rnoh0.77 → br_rnoh0.77
- **变更文件数**: 1

## PR 描述

perf:优化加速度传感器的打开和关闭

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `src/orientation.harmony.js` | ? | +21 | -2 |

## Diff

### `src/orientation.harmony.js`

```diff
@@ -21,6 +21,9 @@ var META = "__listener_id";
 
 var locked = false;
 
+// 引用计数：count === 0 时 openSensor()（只一次），count 归 0 时 closeSensor()
+var deviceOrientationListenerCount = 0;
+
 function getKey(listener) {
   if (!listener.hasOwnProperty(META)) {
     if (!Object.isExtensible(listener)) {
@@ -115,8 +118,15 @@ export default class Orientation {
   };
 
   static addDeviceOrientationListener = cb => {
-    OrientationNative.openSensor();
     var key = getKey(cb);
+    // 同一个 cb 重复添加：不重复 openSensor()、不重复计数
+    if (!listeners[key]) {
+      // 引用计数为 0 时才打开 sensor（整个生命周期只调用一次）
+      if (deviceOrientationListenerCount === 0) {
+        OrientationNative.openSensor();
+      }
+      deviceOrientationListenerCount++;
+    }
     listeners[key] = deviceEventEmitter.addListener(
       "deviceOrientationDidChange",
       body => {
@@ -136,7 +146,11 @@ export default class Orientation {
     }
     listeners[key].remove();
     listeners[key] = null;
-    OrientationNative.closeSensor();
+    deviceOrientationListenerCount--;
+    // 引用计数归 0 时才关闭 sensor
+    if (deviceOrientationListenerCount === 0) {
+      OrientationNative.closeSensor();
+    }
   };
 
   static addLockListener = cb => {
@@ -163,6 +177,11 @@ export default class Orientation {
       listeners[key].remove();
       listeners[key] = null;
     }
+    // 所有订阅被清空，若有 device 监听则复位计数并补一次 closeSensor
+    if (deviceOrientationListenerCount > 0) {
+      deviceOrientationListenerCount = 0;
+      OrientationNative.closeSensor();
+    }
   };
 
   static getInitialOrientation = () => {

```
