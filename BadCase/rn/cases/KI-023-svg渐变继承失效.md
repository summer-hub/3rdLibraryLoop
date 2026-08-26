# KI-023 react-native-svg：Text 组件渐变色失效

- **元数据**: `rule: R-19` · `verified: diff` · `source: community-issue` · `severity: medium` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-svg/pull/117（merged，12 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-svg-117.md](../pr-info/rntpc_react-native-svg-117.md)

## 现象

Text 组件设置渐变色失效——渐变效果不显示。

## 根因

Draw 方法中无条件执行 `SetGradient(std::nullopt, false)` 清除所有渐变属性，包括从父节点继承的渐变——Text/TSpan 等子节点自身没有 href 引用时，渐变应由父节点继承，但渲染前被错误地重置为 null。

## 错误代码（修复前，C++ 层）

```cpp
// SvgNode.cpp — Draw 方法中无条件重置渐变
void SvgNode::Draw(OH_Drawing_Canvas *canvas) {
    if (hrefFill_) {
        attributes_.fillState.SetGradient(std::nullopt, false);  // ← 无条件清除 fill 渐变
        attributes_.strokeState.SetGradient(std::nullopt, false);  // ← 无条件清除 stroke 渐变
        auto fillHref = attributes_.fillState.GetHref();
        if (!fillHref.empty()) {
            auto gradient = GetGradient(fillHref);
            if (gradient) {
                attributes_.fillState.SetGradient(gradient.value(), true);
            }
        }
        // stroke 同理...
    }
}
```

## 正确代码（修复后）

```cpp
// SvgNode.cpp — ① 仅当自身有 href 引用时才重置渐变
void SvgNode::Draw(OH_Drawing_Canvas *canvas) {
    if (hrefFill_) {
        auto fillHref = attributes_.fillState.GetHref();
        auto strokeHref = attributes_.strokeState.GetHref();
        bool hasFillHref = !fillHref.empty();
        bool hasStrokeHref = !strokeHref.empty();
        // ② 仅当自身有 href 时才重置，否则保留继承值
        if (hasFillHref || hasStrokeHref) {
            if (hasFillHref) {
                attributes_.fillState.SetGradient(std::nullopt, false);  // ③ 仅重置有 href 的
            }
            if (hasStrokeHref) {
                attributes_.strokeState.SetGradient(std::nullopt, false);
            }
            // ④ 然后设置新的渐变...
        }
        // ⑤ 无 href 时保留继承的渐变值
    }
}
```

## 修复方式

将渐变重置逻辑从"无条件清除"改为"仅当自身有 href 引用时才清除"：通过 hasFillHref/hasStrokeHref 判断，只有当前节点自身有 href 时才重置对应渐变属性，无 href 时保留从父节点继承的渐变值。