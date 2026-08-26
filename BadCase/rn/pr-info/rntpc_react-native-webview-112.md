# PR #112: fix(harmony): 解决通过forceDarkOn为true设置深色模式，背景色错误的问题

- **状态**: merged
- **作者**: chenhaoyue1
- **创建时间**: 2026-07-28T10:46:55+08:00
- **分支**: 77-0728 → br_rnoh0.77
- **变更文件数**: 1

## PR 描述

fix(harmony): 解决通过forceDarkOn为true设置深色模式，背景色错误的问题

源代码中forceDarkOn为true时，取值Color.White，取值错误

Close: [#102](https://gitcode.com/CPF-RN/rntpc_react-native-webview/issues/102)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/rn_webview/src/main/ets/RNCWebView.ets` | ? | +2 | -2 |

## Diff

### `harmony/rn_webview/src/main/ets/RNCWebView.ets`

```diff
@@ -732,7 +732,7 @@ export struct RNCWebView {
           .overviewModeAccess(this.descriptorWrapper.rawProps.scalesPageToFit)
           .textZoomRatio(this.descriptorWrapper.rawProps.textZoom)
           .backgroundColor(BaseOperate.getColorMode(this.ctx.uiAbilityContext,
-            this.descriptorWrapper.rawProps.forceDarkOn) === WebDarkMode.On ? Color.White : Color.Transparent)
+            this.descriptorWrapper.rawProps.forceDarkOn) === WebDarkMode.On ? Color.Black : Color.Transparent)
           .darkMode(BaseOperate.getColorMode(this.ctx.uiAbilityContext, this.descriptorWrapper.rawProps.forceDarkOn))
           .forceDarkAccess(this.forceDark)
           .cacheMode(this.cacheMode)
@@ -843,7 +843,7 @@ export struct RNCWebView {
           .overviewModeAccess(this.descriptorWrapper.rawProps.scalesPageToFit)
           .textZoomRatio(this.descriptorWrapper.rawProps.textZoom)
           .backgroundColor(BaseOperate.getColorMode(this.ctx.uiAbilityContext,
-            this.descriptorWrapper.rawProps.forceDarkOn) === WebDarkMode.On ? Color.White : Color.Transparent)
+            this.descriptorWrapper.rawProps.forceDarkOn) === WebDarkMode.On ? Color.Black : Color.Transparent)
           .darkMode(BaseOperate.getColorMode(this.ctx.uiAbilityContext, this.descriptorWrapper.rawProps.forceDarkOn))
           .forceDarkAccess(this.forceDark)
           .cacheMode(this.cacheMode)

```
