# KI-001 react-native-webview：视频无法横屏

- **元数据**: `rule: R-01` · `verified: diff` · `source: dtse` · `severity: high`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-webview/pull/121（merged，+199/-7，2 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-webview-121.md](../pr-info/rntpc_react-native-webview-121.md)

## 现象

WebView 内视频点击全屏后无法横屏播放。

## 根因

鸿蒙侧实现完全缺失全屏事件处理链路——未监听 onFullScreenEnter/Exit、未保存初始方向、无窗口 API 调用、销毁无恢复。

## 错误代码（修复前，ArkTS 层无任何全屏处理，仅布局尺寸绑定）

```typescript
// RNCWebView.ets — 声明了 allowsFullscreenVideo prop，但 ArkTS 层无对应实现
.width(this.webviewWidth)
.height(this.webviewHeight)
// 无 onFullScreenEnter / onFullScreenExit 监听
// 无窗口方向 / 沉浸式调用
```

## 正确代码（修复后关键片段）

```typescript
// ① 保存初始方向（aboutToAppear 时）
private async saveInitialOrientation() {
  const win = await window.getLastWindow(getContext(this));
  this.initialOrientation = win.getPreferredOrientation();
  this.isOrientationSaved = true;
}
// ② 监听全屏事件，串行执行且每步校验、失败回滚
.onFullScreenEnter(async () => {
  if (this.allowsFullscreenVideo) { await this.handleFullScreenEnter(); }
})
.onFullScreenExit(async () => { await this.handleFullScreenExit(); })
// ③ 组件销毁时无条件恢复窗口状态（防异步竞态残留）
aboutToDisappear() {
  if (this.cachedWindow) {
    this.cachedWindow.setPreferredOrientation(this.initialOrientation);
    this.cachedWindow.setWindowLayoutFullScreen(false);
    this.cachedWindow.setWindowSystemBarEnable(['status', 'navigation']);
  }
  this.isFullScreen = false;
}
```

## 修复方式

补全完整链路：新增 allowsFullscreenVideo prop → aboutToAppear 时 saveInitialOrientation → 监听 onFullScreenEnter/Exit → handleFullScreenEnter 串行执行（设方向→设沉浸式，任一步失败回滚全部）→ handleFullScreenExit 恢复 → aboutToDisappear 无条件恢复窗口状态（防异步竞态残留）→ isFullScreen 状态守卫防重入。
