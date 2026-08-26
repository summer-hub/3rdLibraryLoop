# KI-009 react-native-pager-view：嵌套滑动父子组件无法联动

- **元数据**: `rule: R-08` · `verified: diff` · `source: dtse` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-pager-view/pull/32（merged，8 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-pager-view-32.md](../pr-info/rntpc_react-native-pager-view-32.md)

## 现象

RN pager-view 嵌套滑动问题——父子组件无法联动响应。

## 根因

SwiperNode 嵌套在 ScrollView 中时，未配置 NestedScroll 模式，导致手势事件被外层 ScrollView 独占，内层 pager-view 无法响应滑动。

## 错误代码（修复前，C++ 层）

```cpp
// SwiperNode.cpp — init() 中无 NestedScroll 配置
void SwiperNode::init() {
    // 未设置 NestedScrollMode  ← 嵌套滚动时手势被外层拦截
}
```

## 正确代码（修复后）

```cpp
// SwiperNode.cpp — ① 设置 NestedScroll 模式
void SwiperNode::init() {
    // 配置 NestedScrollMode 为 PARENT_FIRST，支持嵌套滚动联动
    ArkUI_NumberValue value[] = {{.i32 = ARKUI_NESTED_SCROLL_PARENT_FIRST}};
    ArkUI_AttributeItem item = {value, 1};
    nativeModule->setAttribute(m_nodeHandle, NODE_NESTED_SCROLL, &item);
}
```

## 修复方式

在 SwiperNode 初始化时配置 NestedScroll 模式，使嵌套在 ScrollView 中的 pager-view 能正确参与嵌套滚动手势分发。