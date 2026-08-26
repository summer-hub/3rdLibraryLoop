# PR #121: feat:增加video横竖屏切换功能

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-08-02T16:51:36+08:00
- **分支**: master → master
- **变更文件数**: 2

## PR 描述

## 一、变更类型（单选，仅勾选一项）
- [x] feat（新增功能，对应 Changelog Added）
- [ ] fix（修复 Bug，对应 Changelog Fixed）
- [ ] docs（文档变更，对应 Changelog Documentation）
- [ ] refactor（代码重构，对应 Changelog Changed）
- [ ] perf（性能优化，对应 Changelog Performance）
- [ ] test（测试相关，不进入 Changelog）
- [ ] chore（构建/工具链/依赖，不进入 Changelog）
- [ ] deprecated（标记弃用，对应 Changelog Deprecated）
- [ ] removed（移除功能，对应 Changelog Removed）
- [ ] security（安全修复，对应 Changelog Security）

## 二、变更内容
### 简要描述
增加video横竖屏切换功能

### 破坏性变更说明
无破坏性变更


## 三、测试步骤
1.连接网络，使用demo测试
2.demo加载成功以后，点击全屏
3.然后旋转手机，video会自动横竖屏切换

demo:
```
/**
 * @format
 */

/**
 * @format
 */

import { AppRegistry } from 'react-native';
import React, { useEffect } from 'react';
import { name as appName } from './app.json';
import Orientation from 'react-native-orientation';

import { WebView } from "react-native-webview";

export default function WebViewDemo() {
    const handleWebMessage = (e) => {
        try {
            const data = JSON.parse(e.nativeEvent.data);
            if (data.type === 'WEB_FULLSCREEN') {
                if (data.isFullScreen) {
                    // 进入视频全屏：解锁，允许自动横竖屏
                    // Orientation.unlockAllOrientations();
                } else {
                    // 退出全屏：重新锁定竖屏
                    // Orientation.lockToPortrait();
                }
            }
        } catch (err) { }
    };


    return (
        <WebView
            source={{ uri: "https://reyee.ruijie.com.cn/s2b2c/#/casePush/newVideoCommonPlay?userFlag=5d55e70ee071a533b06770291f388eb0_33187&accessKey=mini_profile__native_app_c0db3bad-5c06-4788-8e9e-8df39fc404ea&appVersion=9.4.0&hideShareAndSwiper=false&canShare=false&isTabWebView=false&accountId=18959589245&mId=350845&publisherId=266440&visitorId=18959589245&type=video&route=videoCommonPlay&isHideDescription=true&objClass=video&continent=&tz=-480&imControl=true&lang=zh&barHeight=37.84615384615385&platform=harmony" }}
            domStorageEnabled={true}
            javaScriptEnabled={true}
            allowFileAccess={false}
            allowsFullscreenVideo={true}
            // injectedJavaScript={injectFullScreenScript}
            onMessage={handleWebMessage}
        />
    );
}


export const Root = () => {
    // 空依赖数组 = 组件初始化挂载后执行一次，完全等价 componentDidMount
    useEffect(() => {
        Orientation.lockToPortrait();
        // SplashScreen.hide();
    }, []);
    return <WebViewDemo />;
};

AppRegistry.registerComponent(appName, () => Root);

```

## 四、测试情况
横屏状态UI显示正常
不涉及

## 五、合入前自检
- [x] 不涉及非兼容性变更；若涉及，已通过相应评审。
- [x] 不涉及性能或已进行性能测试且无性能劣化。
- [x] 符合对应的编码规范。
- [x] 无敏感信息泄露，如密码、密钥等。
- [x] 不涉及文档更新，或已更新了文档。
- [x] 针对可测试性要求，已增加必要的自测用例、合理的日志记录或Trace信息。
- [x] 不存在非法的文件引入，包括图片和代码等

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/rn_webview/src/main/ets/Magic.ets` | ? | +1 | -0 |
| `harmony/rn_webview/src/main/ets/RNCWebView.ets` | ? | +198 | -7 |

## Diff

### `harmony/rn_webview/src/main/ets/Magic.ets`

```diff
@@ -89,6 +89,7 @@ export interface WebViewProps extends ViewRawProps {
   renderMode: "SYNC_RENDER" | "ASYNC_RENDER",
   mediaCapturePermissionGrantType?: 'prompt' | 'grant' | 'deny' | 'grantIfSameHostElsePrompt' | 'grantIfSameHostElseDeny'
   menuItems?: Array<MenuItem> | undefined;
+  allowsFullscreenVideo?: boolean;
 }
 
 export interface MenuItem {

```

### `harmony/rn_webview/src/main/ets/RNCWebView.ets`

```diff
@@ -53,6 +53,7 @@ import { abilityAccessCtrl, bundleManager, Permissions } from '@kit.AbilityKit';
 import { WebViewTurboModule, ShouldStartParams, ShouldOverrideCallbackState } from './WebViewTurboModule';
 import { AnyThreadRNInstance, WorkerTaskRunnable } from '@rnoh/react-native-openharmony/src/main/ets/RNOH';
 import buffer from '@ohos.buffer';
+import { window } from '@kit.ArkUI';
 
 export const TAG = "WebView"
 
@@ -106,6 +107,7 @@ export struct RNCWebView {
   @State webviewWidth: number = ZERO
   @State webviewHeight: number = ZERO
   @State isRefreshing: boolean = false
+  @State isFullScreen: boolean = false
   @State mode: MixedMode = MixedMode.All;
   private unregisterDescriptorChangesListener?: () => void = undefined
   private cleanupCommandCallback?: () => void = undefined
@@ -119,10 +121,15 @@ export struct RNCWebView {
   private debounceTimer: number = -1
   static readonly DEBOUNCE_TIME: number = 100
   private isFirstDebounce: boolean = true
+  private initialOrientation: window.Orientation = window.Orientation.PORTRAIT
+  private isOrientationSaved: boolean = false
+  private cachedWindow: window.Window | null = null
+  private allowsFullscreenVideo: boolean = false
 
   aboutToAppear() {
     try {
       this.initVariable()
+      this.saveInitialOrientation()
       this.getBundleName()
       this.url = this.source.uri as string;
       this.onDescriptorWrapperChange(this.descriptorWrapper)
@@ -159,6 +166,20 @@ export struct RNCWebView {
   }
 
   aboutToDisappear() {
+    // 恢复初始屏幕方向和沉浸式状态，防止全屏状态下组件销毁后状态残留
+    // 无论是否在全屏状态，都尝试恢复窗口状态（handleFullScreenEnter 异步操作可能在组件销毁后才完成）
+    if (this.cachedWindow) {
+      try {
+        this.cachedWindow.setPreferredOrientation(this.initialOrientation);
+        this.cachedWindow.setWindowLayoutFullScreen(false);
+        this.cachedWindow.setWindowSystemBarEnable(['status', 'navigation']);
+        Logger.debug(TAG, '[WebViewFullScreen] Restored window state in aboutToDisappear');
+      } catch (error) {
+        Logger.error(TAG, `[WebViewFullScreen] Failed to restore in aboutToDisappear: ${error.code}`);
+      }
+    }
+    this.isFullScreen = false;
+    this.cachedWindow = null;
     this.getUIContext().getFocusController().clearFocus()
     this.cleanupCommandCallback?.()
     this.unregisterDescriptorChangesListener?.()
@@ -532,6 +553,151 @@ export struct RNCWebView {
     await atManager.requestPermissionsFromUser(this.ctx.uiAbilityContext, permissionList);
   }
 
+  private async getWindow(): Promise<window.Window | null> {
+    try {
+      const win = await window.getLastWindow(getContext(this));
+      if (win) {
+        this.cachedWindow = win;
+      }
+      return win;
+    } catch (error) {
+      console.error(TAG, `[WebViewFullScreenTest] getWindow Errorcode: ${error.code}`);
+      return null;
+    }
+  }
+
+  private async saveInitialOrientation() {
+    const win = await this.getWindow();
+    if (win) {
+      try {
+        const orientation = win.getPreferredOrientation();
+        this.initialOrientation = orientation;
+        this.isOrientationSaved = true;
+        console.debug(TAG, `[WebViewFullScreenTest] Saved initial orientation: ${orientation}`);
+      } catch (error) {
+        console.error(TAG, `[WebViewFullScreenTest] saveInitialOrientation Errorcode: ${error.code}`);
+      }
+    }
+  }
+
+  private async setOrientation(orientation: window.Orientation): Promise<boolean> {
+    const win = await this.getWindow();
+    if (win) {
+      try {
+        await win.setPreferredOrientation(orientation);
+        console.debug(TAG, `[WebViewFullScreenTest] Set orientation to: ${orientation}`);
+        return true;
+      } catch (error) {
+        console.error(TAG, `[WebViewFullScreenTest] setOrientation Errorcode: ${error.code}`);
+        return false;
+      }
+    }
+    return false;
+  }
+
+  // 处理全屏进入（带状态保护和异步串行）
+  private async handleFullScreenEnter() {
+    if (this.isFullScreen) {
+      Logger.debug(TAG, '[WebViewFullScreen] Already in full screen, skipping');
+      return;
+    }
+    if (!this.isOrientationSaved) {
+      Logger.warn(TAG, '[WebViewFullScreen] Initial orientation not saved yet, skipping full screen enter');
+      return;
+    }
+    try {
+      // 阶段1：设置方向
+      const orientationResult = await this.setOrientation(window.Orientation.AUTO_ROTATION);
+      if (!orientationResult) {
+        Logger.error(TAG, '[WebViewFullScreen] Failed to set orientation, aborting full screen enter');
+        return;
+      }
+      // 阶段2：设置沉浸式模式
+      const immersiveResult = await this.enterImmersiveMode();
+      if (!immersiveResult) {
+        Logger.error(TAG, '[WebViewFullScreen] Failed to enter immersive mode, rolling back');
+        // 回滚沉浸式模式（即使部分失败也要尝试恢复）
+        await this.exitImmersiveMode();
+        // 回滚方向设置
+        await this.setOrientation(this.initialOrientation);
+        return;
+      }
+      // 阶段3：所有操作成功，设置状态
+      this.isFullScreen = true;
+    } catch (error) {
+      Logger.error(TAG, `[WebViewFullScreen] Enter full screen failed: ${error}`);
+      // 异常时回滚所有操作
+      await this.exitImmersiveMode();
+      await this.setOrientation(this.initialOrientation);
+    }
+  }
+
+  // 处理全屏退出（带状态保护和异步串行）
+  private async handleFullScreenExit() {
+    if (!this.isFullScreen) {
+      Logger.debug(TAG, '[WebViewFullScreen] Not in full screen, skipping');
+      return;
+    }
+    try {
+      // 阶段1：恢复方向
+      const orientationResult = await this.setOrientation(this.initialOrientation);
+      if (!orientationResult) {
+        Logger.error(TAG, '[WebViewFullScreen] Failed to restore orientation, keeping full screen state');
+        return;
+      }
+      // 方向已恢复，清除 isFullScreen 让 UI 恢复原始布局
+      this.isFullScreen = false;
+      // 阶段2：退出沉浸式模式
+      const immersiveResult = await this.exitImmersiveMode();
+      if (!immersiveResult) {
+        Logger.error(TAG, '[WebViewFullScreen] Failed to exit immersive mode after restoring orientation');
+        // 沉浸式模式退出失败，但方向已恢复，isFullScreen 已清除，避免重复触发循环
+      }
+    } catch (error) {
+      Logger.error(TAG, `[WebViewFullScreen] Exit full screen failed: ${error}`);
+      // 异常时也应清除状态，避免卡死
+      this.isFullScreen = false;
+    }
+  }
+
+  // 进入沉浸式全屏模式（隐藏系统栏）
+  private async enterImmersiveMode(): Promise<boolean> {
+    const win = await this.getWindow();
+    if (win) {
+      try {
+        // 设置窗口为全屏布局模式，内容延伸到系统栏下方
+        await win.setWindowLayoutFullScreen(true);
+        // 隐藏系统导航栏和状态栏
+        await win.setWindowSystemBarEnable([]);
+        Logger.debug(TAG, '[WebViewFullScreen] Entered immersive mode');
+        return true;
+      } catch (error) {
+        console.error(TAG, `[WebViewFullScreen] enterImmersiveMode Errorcode: ${error.code}`);
+        return false;
+      }
+    }
+    return false;
+  }
+
+  // 退出沉浸式全屏模式（恢复系统栏）
+  private async exitImmersiveMode(): Promise<boolean> {
+    const win = await this.getWindow();
+    if (win) {
+      try {
+        // 关闭全屏布局模式
+        await win.setWindowLayoutFullScreen(false);
+        // 恢复显示系统导航栏和状态栏（默认显示所有系统栏）
+        await win.setWindowSystemBarEnable(['status', 'navigation']);
+        Logger.debug(TAG, '[WebViewFullScreen] Exited immersive mode');
+        return true;
+      } catch (error) {
+        console.error(TAG, `[WebViewFullScreen] exitImmersiveMode Errorcode: ${error.code}`);
+        return false;
+      }
+    }
+    return false;
+  }
+
   build() {
     Stack() {
         if ( deviceInfo.sdkApiVersion >= 20) {
@@ -584,8 +750,8 @@ export struct RNCWebView {
                 }
               }
             })
-            .width(this.webviewWidth)
-            .height(this.webviewHeight)
+            .width(this.isFullScreen ? "100%" : this.webviewWidth)
+            .height(this.isFullScreen ? "100%" : this.webviewHeight)
             .fileAccess(this.allowFileAccess)
             .constraintSize({ minHeight: MINHEIGHT })
             .overScrollMode(this.overScrollMode)
@@ -629,6 +795,18 @@ export struct RNCWebView {
             .onRenderExited((event: OnRenderExitedEvent) => this.webViewBaseOperate?.onRenderExited(event))
             .onLoadIntercept((event: OnLoadInterceptEvent) => this.onLoadIntercept(event))
             .onTitleReceive((event: OnTitleReceiveEvent) => this.webViewBaseOperate?.onTitleReceive(event))
+            .onFullScreenEnter(async () => {
+              Logger.debug(TAG, '[WebViewFullScreen] onFullScreenEnter called');
+              if (this.allowsFullscreenVideo) {
+                await this.handleFullScreenEnter();
+              } else {
+                Logger.debug(TAG, '[WebViewFullScreen] Fullscreen video disabled by allowsFullscreenVideo');
+              }
+            })
+            .onFullScreenExit(async () => {
+              Logger.debug(TAG, '[WebViewFullScreen] onFullScreenExit called');
+              await this.handleFullScreenExit();
+            })
             .editMenuOptions({
               onCreateMenu: this.onCreateMenu.bind(this),
               onMenuItemClick: this.onMenuItemClick.bind(this),
@@ -684,8 +862,8 @@ export struct RNCWebView {
               }
             })
 
-            .width(this.webviewWidth)
-            .height(this.webviewHeight)
+            .width(this.isFullScreen ? "100%" : this.webviewWidth)
+            .height(this.isFullScreen ? "100%" : this.webviewHeight)
             .fileAccess(this.allowFileAccess)
             .constraintSize({ minHeight: MINHEIGHT })
             .overScrollMode(this.overScrollMode)
@@ -728,15 +906,27 @@ export struct RNCWebView {
             .onRenderExited((event: OnRenderExitedEvent) => this.webViewBaseOperate?.onRenderExited(event))
             .onLoadIntercept((event: OnLoadInterceptEvent) => this.onLoadIntercept(event))
             .onTitleReceive((event: OnTitleReceiveEvent) => this.webViewBaseOperate?.onTitleReceive(event))
+            .onFullScreenEnter(async () => {
+              Logger.debug(TAG, '[WebViewFullScreen] onFullScreenEnter called');
+              if (this.allowsFullscreenVideo) {
+                await this.handleFullScreenEnter();
+              } else {
+                Logger.debug(TAG, '[WebViewFullScreen] Fullscreen video disabled by allowsFullscreenVideo');
+              }
+            })
+            .onFullScreenExit(async () => {
+              Logger.debug(TAG, '[WebViewFullScreen] onFullScreenExit called');
+              await this.handleFullScreenExit();
+            })
             .editMenuOptions({
               onCreateMenu: this.onCreateMenu.bind(this),
               onMenuItemClick: this.onMenuItemClick.bind(this),
             })
           }
       }
-    .width(this.webviewWidth)
-    .height(this.webviewHeight)
-    .position({
+    .width(this.isFullScreen ? "100%" : this.webviewWidth)
+    .height(this.isFullScreen ? "100%" : this.webviewHeight)
+    .position(this.isFullScreen ? undefined : {
       x: this.descriptorWrapper.layoutMetrics.frame.origin.x,
       y: this.descriptorWrapper.layoutMetrics.frame.origin.y
     })
@@ -843,6 +1033,7 @@ export struct RNCWebView {
     
     const renderModeStr = this.descriptorWrapper.rawProps.renderMode || "SYNC_RENDER"
     this.renderMode = (renderModeStr === "ASYNC_RENDER") ? RenderMode.ASYNC_RENDER : RenderMode.SYNC_RENDER
+    this.allowsFullscreenVideo = this.descriptorWrapper.rawProps.allowsFullscreenVideo ?? false;
 
   }
 

```
