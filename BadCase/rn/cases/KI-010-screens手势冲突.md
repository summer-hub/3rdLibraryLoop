# KI-010 react-native-screens：手势冲突与默认值错误

- **元数据**: `rule: R-08` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-screens/pull/87, https://gitcode.com/CPF-RN/rntpc_react-native-screens/pull/93（merged）
- **diff 材料**: [../pr-info/rntpc_react-native-screens-87.md](../pr-info/rntpc_react-native-screens-87.md), [../pr-info/rntpc_react-native-screens-93.md](../pr-info/rntpc_react-native-screens-93.md)

## 现象

houldBuiltInRecognizerParallelWith 无法触发回调；原生组件手势和库冲突。

## 根因

1. gestureEnabled 默认值为 false，导致手势整体失效；2. 手势冲突时缺少 onGestureRecognizerJudgeBegin 仲裁逻辑，系统手势（如返回）与库手势冲突。

## 错误代码（修复前）

```typescript
// RNSScreen.ets
private gestureEnabled: boolean = false;  // ← 默认 false，手势整体失效
// 无 onGestureRecognizerJudgeBegin 仲裁  ← 手势冲突
.gesture(
    PanGesture({ direction: this.from ? PanDirection.None : PanDirection.All })
    // ...
)
```

## 正确代码（修复后）

```typescript
// ① gestureEnabled 默认值改为 true
private gestureEnabled: boolean = true;

// ② 添加手势仲裁逻辑
.onGestureRecognizerJudgeBegin((event: BaseGestureEvent, current: GestureRecognizer, others: Array<GestureRecognizer>): GestureJudgeResult => {
    if (this.gestureEnabled && this.fullScreenSwipeEnabled && !this.isRootStackGesturePopDisallowed()) {
        return GestureJudgeResult.CONTINUE;  // ③ 允许手势继续
    }
    return GestureJudgeResult.REJECT;  // ④ 拒绝手势
})
.gesture(
    PanGesture({ direction: this.from ? PanDirection.None : PanDirection.All })
    // ...
)
```

## 修复方式

1. gestureEnabled 默认值从 false 改为 true（与功能声明一致）；2. 添加 onGestureRecognizerJudgeBegin 仲裁回调，在手势开关开启且允许侧滑时返回 CONTINUE，否则返回 REJECT 避免冲突。