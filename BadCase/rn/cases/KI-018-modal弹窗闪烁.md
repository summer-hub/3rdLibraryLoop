# KI-018 react-native-modal：弹窗先闪一下

- **元数据**: `rule: R-14` · `verified: diff` · `source: dtse` · `severity: medium` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-modal/pull/20（merged，3 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-modal-20.md](../pr-info/rntpc_react-native-modal-20.md)

## 现象

RN 工程中拉起弹窗，弹窗会先闪一下——升级到 rnoh 新框架后出现。

## 根因

弹窗打开时 animationValue 保留了上一次动画的终值（1.0），setAnimation 基于当前 animationValue 创建 animationStyle 时 content 瞬间显示在最终位置（一帧闪烁），然后 startAnimation 才重置 animationValue 到 0。同时 backdrop 使用 ref.transitionTo 在新框架下不兼容。

## 错误代码（修复前）

```tsx
// modal.tsx — ① animationValue 未重置就 setAnimation
this.contentRef.setAnimation(this.animationIn, () => { /* ... */ });
// ② backdrop 使用 ref.transitionTo（新框架不兼容）
if (this.backdropRef) {
    this.backdropRef.transitionTo({ opacity: this.props.backdropOpacity }, timing);
}
// ③ showContent 初始为 true，内容立即显示
state = { showContent: true };
```

## 正确代码（修复后）

```tsx
// ① 先 stopAnimation + setValue(0) 再 setAnimation
this.contentRef.stopAnimation();
if (this.contentRef.state && this.contentRef.state.animationValue) {
    this.contentRef.state.animationValue.setValue(0);
}
// ② 用 requestAnimationFrame 延迟 setAnimation
const rafId = requestAnimationFrame(() => {
    this.contentRef.setAnimation(this.animationIn, () => { /* ... */ });
});

// ③ backdrop 改用 Animated.Value 驱动
this.backdropAnimated = new Animated.Value(0);
Animated.timing(this.backdropAnimated, { toValue: opacity, duration, useNativeDriver }).start();

// ④ animationReady 控制渲染时机
state = { showContent: false, animationReady: false };
// ⑤ 卸载时清理 pendingRAF/pendingTimeout/stopAnimation
this._pendingRAF.forEach(id => cancelAnimationFrame(id));
```

## 修复方式

1. setAnimation 前先 stopAnimation + setValue(0) 重置动画值；2. 用 requestAnimationFrame 延迟 setAnimation 确保重置生效；3. backdrop 从 ref.transitionTo 改为 Animated.Value 驱动；4. 引入 animationReady 标志在动画初始化完成前阻止内容渲染；5. 组件卸载时清理所有 pending 动画资源。