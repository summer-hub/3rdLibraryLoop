# PR #93: feat:  更新77分支原生侧gestureEnabled属性的默认值

- **状态**: merged
- **作者**: zhuyongxiang
- **创建时间**: 2026-08-04T16:42:06+08:00
- **分支**: br_rnoh0.77 → br_rnoh0.77
- **变更文件数**: 1

## PR 描述

feat:  更新77分支原生侧gestureEnabled属性的默认值

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `tester/harmony/screens/src/main/ets/components/RNSScreen.ets` | ? | +1 | -1 |

## Diff

### `tester/harmony/screens/src/main/ets/components/RNSScreen.ets`

```diff
@@ -122,7 +122,7 @@ export struct RNSScreen {
   public onSwipeDismissShadowChange: (width: number, onStartSide: boolean) => void = () => {
   };
   private backPressedFlag: boolean = false; // 返回按钮或系统返回触发标志
-  private gestureEnabled: boolean = false;
+  private gestureEnabled: boolean = true;
   private fullScreenSwipeEnabled: boolean = false;
   /** 与 RN fullScreenSwipeShadowEnabled：是否向栈上报侧滑阴影（由 RNSScreenStack 绘制） */
   private fullScreenSwipeShadowEnabled: boolean = false;

```
