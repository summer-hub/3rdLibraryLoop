# PR #38: fix(harmony): A new "isPanGestureRegistered" flag has been added to prevent the same node from being bound to gestures multiple times.

- **状态**: merged
- **作者**: chenhaoyue1
- **创建时间**: 2026-07-22T16:29:09+08:00
- **分支**: 72-0722 → br_rnoh0.72
- **变更文件数**: 2

## PR 描述

fix(harmony): A new "isPanGestureRegistered" flag has been added to prevent the same node from being bound to gestures multiple times.

Regarding the online crash issue in Meituan Guanjiā, the root cause is suspected to be the repeated binding of gestures to a node.

Closed [#34](https://gitcode.com/CPF-RN/rntpc_react-native-spring-scrollview/issues/34)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/spring_scrollview/src/main/cpp/SpringScrollViewNode.cpp` | ? | +4 | -1 |
| `harmony/spring_scrollview/src/main/cpp/SpringScrollViewNode.h` | ? | +1 | -0 |

## Diff

### `harmony/spring_scrollview/src/main/cpp/SpringScrollViewNode.cpp`

```diff
@@ -119,7 +119,10 @@ void SpringScrollViewNode::init()
     if (this->isInitialContentOffset) {
         return;
     }
-    this->registerPanGesture();
+    if (!this->isPanGestureRegistered) {
+        this->isPanGestureRegistered = true;
+        this->registerPanGesture();
+    }
     if (this->initialContentOffset.y != 0) {
         this->isInitialContentOffset = true;
         this->setContentOffset(this->initialContentOffset.x, this->initialContentOffset.y);

```

### `harmony/spring_scrollview/src/main/cpp/SpringScrollViewNode.h`

```diff
@@ -143,6 +143,7 @@ private:
     float moveX = 0;
     float contentHeight;
     bool isInitialContentOffset = false;
+    bool isPanGestureRegistered = false;
     bool isMove = false;
     bool isDestory = false;
     float recordKeyBoardPositioY = 0;

```
