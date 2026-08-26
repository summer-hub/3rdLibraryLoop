# KI-013 react-native-webview：深色模式先闪白再变黑

- **元数据**: `rule: R-10` · `verified: diff` · `source: dtse` · `severity: medium` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-webview/pull/112（merged，1 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-webview-112.md](../pr-info/rntpc_react-native-webview-112.md)

## 现象

RNCWebView 源码中深色模式时加了一个白背景，导致先闪一下白背景再变黑。

## 根因

深色模式（forceDarkOn）下 WebView 背景色取值错误——深色模式应使用 Color.Black 但错误使用了 Color.White，导致 WebView 先渲染白色背景再切换为深色。

## 错误代码（修复前）

```typescript
// RNCWebView.ets — 深色模式用白色背景
.backgroundColor(BaseOperate.getColorMode(this.ctx.uiAbilityContext,
    this.descriptorWrapper.rawProps.forceDarkOn) === WebDarkMode.On
    ? Color.White   // ← 深色模式用白色，错误
    : Color.Transparent)
```

## 正确代码（修复后）

```typescript
// RNCWebView.ets — ① 深色模式用黑色背景
.backgroundColor(BaseOperate.getColorMode(this.ctx.uiAbilityContext,
    this.descriptorWrapper.rawProps.forceDarkOn) === WebDarkMode.On
    ? Color.Black   // ② 深色模式用黑色，正确
    : Color.Transparent)
```

## 修复方式

深色模式分支中 backgroundColor 从 Color.White 改为 Color.Black，使 WebView 初始背景色与深色主题一致，消除白色闪烁。