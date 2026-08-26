# KI-011 react-native-spring-scrollview：手势重复绑定崩溃

- **元数据**: `rule: R-08` · `verified: diff` · `source: dtse` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-spring-scrollview/pull/38（merged，2 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-spring-scrollview-38.md](../pr-info/rntpc_react-native-spring-scrollview-38.md)

## 现象

线上 crash，美团管家 app——SpringScrollView 崩溃，根因疑似手势重复绑定到同一节点。

## 根因

init() 方法中调用 registerPanGesture() 无防重入保护，当 init() 被多次调用时（如组件重建），手势被重复绑定到同一节点导致崩溃。

## 错误代码（修复前，C++ 层）

```cpp
// SpringScrollViewNode.cpp — init() 中无条件注册手势
void SpringScrollViewNode::init() {
    if (this->isInitialContentOffset) {
        return;
    }
    this->registerPanGesture();  // ← 无防重入，多次 init 会重复绑定手势
    // ...
}
```

## 正确代码（修复后）

```cpp
// SpringScrollViewNode.h — ① 添加防重入标志
bool isPanGestureRegistered = false;

// SpringScrollViewNode.cpp — ② 注册前检查标志
void SpringScrollViewNode::init() {
    if (this->isInitialContentOffset) {
        return;
    }
    if (!this->isPanGestureRegistered) {  // ③ 仅首次注册
        this->isPanGestureRegistered = true;
        this->registerPanGesture();
    }
    // ...
}
```

## 修复方式

引入 isPanGestureRegistered 标志位防止手势重复绑定：init() 中注册手势前检查标志，首次注册后置 true，后续 init() 调用跳过注册。