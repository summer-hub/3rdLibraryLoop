# PR #87: fix: 修复77分支原生组件手势和库冲突问题

- **状态**: merged
- **作者**: zhuyongxiang
- **创建时间**: 2026-08-01T10:39:48+08:00
- **分支**: br_rnoh0.77 → br_rnoh0.77
- **变更文件数**: 1

## PR 描述

fix: 修复77分支原生组件手势和库冲突问题

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `tester/harmony/screens/src/main/ets/components/RNSScreen.ets` | ? | +6 | -0 |

## Diff

### `tester/harmony/screens/src/main/ets/components/RNSScreen.ets`

```diff
@@ -1215,6 +1215,12 @@ export struct RNSScreen {
       .backgroundColor(this.backgroundColorValue)
       .translate({ x: this.translateXValue, y: this.translateYValue })
       .opacity(this.opacityValue)
+      .onGestureRecognizerJudgeBegin((event: BaseGestureEvent, current: GestureRecognizer, others: Array<GestureRecognizer>): GestureJudgeResult =>{
+        if (this.gestureEnabled && this.fullScreenSwipeEnabled && !this.isRootStackGesturePopDisallowed()) {
+          return GestureJudgeResult.CONTINUE;
+        }
+        return GestureJudgeResult.REJECT;
+      })
       .gesture(
         PanGesture({ direction: this.from?PanDirection.None:PanDirection.All })
           .onActionStart((event: GestureEvent) => {

```
