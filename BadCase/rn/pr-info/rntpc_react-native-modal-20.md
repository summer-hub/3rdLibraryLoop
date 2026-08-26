# PR #20: fix:解决升级到rnoh新框架导致的打开modal闪屏问题及更新readme文档

- **状态**: merged
- **作者**: cuijiaojiao1
- **创建时间**: 2026-07-09T16:50:08+08:00
- **分支**: 77Visible → br_rnoh0.72
- **变更文件数**: 3

## PR 描述

fix:解决升级到rnoh新框架导致的打开modal闪屏问题 [#14](https://gitcode.com/CPF-RN/rntpc_react-native-modal/issues/14)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `README.md` | ? | +16 | -13 |
| `README_en.md` | ? | +15 | -12 |
| `src/modal.tsx` | ? | +192 | -85 |

## Diff

### `README.md`

```diff
@@ -8,10 +8,11 @@
 
 该第三方库的仓库已迁移至 Gitcode，且支持直接从 npm 下载，新的包名为：`@react-native-ohos/react-native-modal` 版本所属关系如下：
 
-| 三方库名称                              | 三方库版本 | 发布信息                                                                                   | 支持 RN 版本    | Autolink | 编译 API 版本 | 社区基线版本 | npm 地址                                                                             |
-| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ | --------------- | -------- | ------------- | ------------ | ------------------------------------------------------------------------------------ |
-| @react-native-ohos/react-native-modal   | ~ 14.0.1   | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)  | 0.77.\*/0.82.\* | 否       | API12+        | 14.0.0-rc.1  | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-modal)   |
-| @react-native-oh-tpl/react-native-modal | ~ 13.0.1   | [Gitcode Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72.\*         | 否       | API12+        | 13.0.1       | [Npm Address](https://www.npmjs.com/package/@react-native-oh-tpl/react-native-modal) |
+| 三方库名称                              | 三方库版本          | 发布信息                                                                                  | 支持 RN 版本    | Autolink | 编译 API 版本 | 社区基线版本 | npm 地址                                                                             |
+| --------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- | --------------- | -------- | ------------- | ------------ | ------------------------------------------------------------------------------------ |
+| @react-native-ohos/react-native-modal   | ~ 14.0.1            | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases) | 0.77.\*/0.82.\* | 否       | API12+        | 14.0.0-rc.1  | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-modal)   |
+| @react-native-ohos/react-native-modal   | ~ 13.0.2            | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases) | 0.72.\*         | 否       | API12+        | 13.0.1       | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-modal)   |
+| @react-native-oh-tpl/react-native-modal | ~ 13.0.1@deprecated | [Github Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72.\*         | 否       | API12+        | 13.0.1       | [Npm Address](https://www.npmjs.com/package/@react-native-oh-tpl/react-native-modal) |
 
 ## 1. 安装与使用
 
@@ -132,21 +133,23 @@ export default DefaultModal;
 
 ## 2. Link
 
-|         | 是否支持 autolink | RN 框架版本 |
-| ------- | ----------------- | ----------- |
-| ~14.0.1 | No                | 0.77/0.82   |
-| ~13.0.1 | No                | 0.72        |
+|                    | 是否支持 autolink | RN 框架版本 |
+| ------------------ | ----------------- | ----------- |
+| ~14.0.1            | 否                | 0.77/0.82   |
+| ~13.0.2            | 否                | 0.72        |
+| ~13.0.1@deprecated | 否                | 0.72        |
 
 ## 3. 约束与限制
 
-### 3.1. 兼容性
+### 3.1 兼容性
 
 请到三方库相应的 Releases 发布地址查看 Release 配套的版本信息：
 
-| 三方库版本 | 发布信息                                                                                                                   | 支持 RN 版本 |
-| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ------------ |
-| 14.0.1     | [@react-native-ohos/react-native-modal Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)    | 0.77/0.82    |
-| 13.0.1     | [@react-native-oh-tpl/react-native-modal Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72         |
+| 三方库版本        | 发布信息                                                                                                                   | 支持 RN 版本 |
+| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------ |
+| 14.0.1            | [@react-native-ohos/react-native-modal Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)    | 0.77/0.82    |
+| 13.0.2            | [@react-native-ohos/react-native-modal Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)    | 0.72         |
+| 13.0.1@deprecated | [@react-native-oh-tpl/react-native-modal Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72         |
 
 ## 4. 属性
 

```

### `README_en.md`

```diff
@@ -8,10 +8,11 @@ This project is based on [react-native-modal](https://github.com/react-native-mo
 
 This third-party library has been migrated to Gitcode and is now available for direct download from npm, the new package name is: `@react-native-ohos/react-native-modal`, The version correspondence details are as follows:
 
-| Name                                    | Version  | Release Information                                                                        | Supported RN Version | Supported Autolink | Compile API Version | Community Baseline Version | npm Address                                                                          |
-| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------ | -------------------- | ------------------ | ------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
-| @react-native-ohos/react-native-modal   | ~ 14.0.1 | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)  | 0.77.\*/0.82.\*      | No                 | API12+              | 14.0.0-rc.1                | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-modal)   |
-| @react-native-oh-tpl/react-native-modal | ~ 13.0.1 | [Gitcode Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72.\*              | No                 | API12+              | 13.0.1                     | [Npm Address](https://www.npmjs.com/package/@react-native-oh-tpl/react-native-modal) |
+| Name                                    | Version             | Release Information                                                                       | Supported RN Version | Supported Autolink | Compile API Version | Community Baseline Version | npm Address                                                                          |
+| --------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- | -------------------- | ------------------ | ------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
+| @react-native-ohos/react-native-modal   | ~ 14.0.1            | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases) | 0.77.\*/0.82.\*      | No                 | API12+              | 14.0.0-rc.1                | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-modal)   |
+| @react-native-ohos/react-native-modal   | ~ 13.0.2            | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases) | 0.72.\*              | No                 | API12+              | 13.0.1                     | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-modal)   |
+| @react-native-oh-tpl/react-native-modal | ~ 13.0.1@deprecated | [Github Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72.\*              | No                 | API12+              | 13.0.1                     | [Npm Address](https://www.npmjs.com/package/@react-native-oh-tpl/react-native-modal) |
 
 ## 1. Installation and Usage
 
@@ -132,10 +133,11 @@ export default DefaultModal;
 
 ## 2. Link
 
-|         | Supported Autolink | Supported RN Version |
-| ------- | ------------------ | -------------------- |
-| ~14.0.1 | No                 | 0.77/0.82            |
-| ~13.0.1 | No                 | 0.72                 |
+|                    | Supported Autolink | Supported RN Version |
+| ------------------ | ------------------ | -------------------- |
+| ~14.0.1            | No                 | 0.77/0.82            |
+| ~13.0.2            | No                 | 0.72                 |
+| ~13.0.1@deprecated | No                 | 0.72                 |
 
 ## 3. Constraints
 
@@ -143,10 +145,11 @@ export default DefaultModal;
 
 Check the release version information in the release address of the third-party library:
 
-| Version | Release Information                                                                                                        | Supported RN Version |
-| ------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
-| 14.0.1  | [@react-native-ohos/react-native-modal Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)    | 0.77/0.82            |
-| 13.0.1  | [@react-native-oh-tpl/react-native-modal Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72                 |
+| Version           | Release Information                                                                                                        | Supported RN Version |
+| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- |
+| 14.0.1            | [@react-native-ohos/react-native-modal Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)    | 0.77/0.82            |
+| 13.0.2            | [@react-native-ohos/react-native-modal Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-modal/releases)    | 0.72                 |
+| 13.0.1@deprecated | [@react-native-oh-tpl/react-native-modal Releases](https://github.com/react-native-oh-library/react-native-modal/releases) | 0.72                 |
 
 ## 4. Properties
 

```

### `src/modal.tsx`

```diff
@@ -52,6 +52,7 @@ type State = {
   deviceHeight: number;
   isSwipeable: boolean;
   pan: OrNull<Animated.ValueXY>;
+  animationReady: boolean;
 };
 
 const defaultProps = {
@@ -192,6 +193,7 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
     deviceHeight: Dimensions.get('window').height,
     isSwipeable: !!this.props.swipeDirection,
     pan: null,
+    animationReady: false,
   };
 
   isTransitioning = false;
@@ -200,12 +202,15 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
 
   animationIn: string;
   animationOut: string;
+  backdropAnimated: Animated.Value;
   backdropRef: any;
   contentRef: any;
   panResponder: OrNull<PanResponderInstance> = null;
   didUpdateDimensionsEmitter: OrNull<EmitterSubscription> = null;
 
   interactionHandle: OrNull<number> = null;
+  _pendingRAF: number[] = [];
+  _pendingTimeout: number[] = [];
 
   constructor(props: ModalProps) {
     super(props);
@@ -215,7 +220,7 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
 
     this.animationIn = animationIn;
     this.animationOut = animationOut;
-
+    this.backdropAnimated = new Animated.Value(0);
     if (this.state.isSwipeable) {
       this.state = {
         ...this.state,
@@ -227,14 +232,18 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
       this.state = {
         ...this.state,
         isVisible: true,
-        showContent: true,
+        showContent: false,
+        animationReady: false,
       };
     }
   }
 
-  static getDerivedStateFromProps(nextProps: Readonly<ModalProps>, state: State) {
+  static getDerivedStateFromProps(
+    nextProps: Readonly<ModalProps>,
+    state: State,
+  ) {
     if (!state.isVisible && nextProps.isVisible) {
-      return { isVisible: true, showContent: true };
+      return { isVisible: true, showContent: false, animationReady: false};
     }
     return null;
   }
@@ -267,8 +276,17 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
       InteractionManager.clearInteractionHandle(this.interactionHandle);
       this.interactionHandle = null;
     }
+    // Cancel any pending requestAnimationFrame callbacks
+    this._pendingRAF.forEach(id => cancelAnimationFrame(id));
+    this._pendingRAF = [];
+    // Cancel any pending setTimeout callbacks
+    this._pendingTimeout.forEach(id => clearTimeout(id));
+    this._pendingTimeout = [];
+    // Stop any running backdrop animation
+    if (this.backdropAnimated && this.backdropAnimated.stopAnimation) {
+      this.backdropAnimated.stopAnimation();
+    }
   }
-
   componentDidUpdate(prevProps: ModalProps) {
     // If the animations have been changed then rebuild them to make sure we're
     // using the most up-to-date ones
@@ -282,15 +300,13 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
       this.animationIn = animationIn;
       this.animationOut = animationOut;
     }
-    // If backdrop opacity has been changed then make sure to update it
-    if (
-      this.props.backdropOpacity !== prevProps.backdropOpacity &&
-      this.backdropRef
-    ) {
-      this.backdropRef.transitionTo(
-        { opacity: this.props.backdropOpacity },
-        this.props.backdropTransitionInTiming,
-      );
+    // If backdrop opacity has been changed then animate the Animated.Value
+    if (this.props.backdropOpacity !== prevProps.backdropOpacity) {
+      Animated.timing(this.backdropAnimated, {
+        toValue: this.props.backdropOpacity,
+        duration: this.props.backdropTransitionInTiming,
+        useNativeDriver: this.props.useNativeDriverForBackdrop === true,
+      }).start();
     }
     // On modal open request, we slide the view up and fade in the backdrop
     if (this.props.isVisible && !prevProps.isVisible) {
@@ -387,11 +403,13 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
           // Dim the background while swiping the modal
           const newOpacityFactor =
             1 - this.calcDistancePercentage(gestureState);
-
-          this.backdropRef &&
-            this.backdropRef.transitionTo({
-              opacity: this.props.backdropOpacity * newOpacityFactor,
-            });
+          // Update backdrop opacity immediately during swipe.
+          // setValue() is synchronous and works regardless of useNativeDriver
+          // setting — it directly sets the Animated.Value without scheduling
+          // an animation, so there is no conflict with native-driven animations.
+          this.backdropAnimated.setValue(
+            this.props.backdropOpacity * newOpacityFactor,
+          );
 
           animEvt!(evt, gestureState);
 
@@ -447,12 +465,12 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
         if (this.props.onSwipeCancel) {
           this.props.onSwipeCancel(gestureState);
         }
-
-        if (this.backdropRef) {
-          this.backdropRef.transitionTo({
-            opacity: this.props.backdropOpacity,
-          });
-        }
+        // Reset backdrop opacity with a smooth animation
+        Animated.timing(this.backdropAnimated, {
+          toValue: this.props.backdropOpacity,
+          duration: this.props.backdropTransitionInTiming,
+          useNativeDriver: this.props.useNativeDriverForBackdrop === true,
+        }).start();
 
         Animated.spring(this.state.pan!, {
           toValue: { x: 0, y: 0 },
@@ -593,13 +611,19 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
       return;
     }
     this.isTransitioning = true;
-    if (this.backdropRef) {
-      this.backdropRef.transitionTo(
-        { opacity: this.props.backdropOpacity },
-        this.props.backdropTransitionInTiming,
-      );
+    // Mark content as not ready for display until the animation is
+    // properly set up. This prevents the one-frame flash where
+    // setAnimation creates an animationStyle interpolated from a stale
+    // animationValue (e.g. 1.0 from a previous animation), causing the
+    // content to appear at its final position for one frame before
+    // startAnimation resets animationValue to 0.
+    this.setState({animationReady: false});
+    if (this.backdropAnimated && this.backdropAnimated.stopAnimation) {
+      this.backdropAnimated.stopAnimation();
+    }
+    if (this.backdropAnimated && this.backdropAnimated.setValue) {
+      this.backdropAnimated.setValue(0);
     }
-
     // This is for resetting the pan position,otherwise the modal gets stuck
     // at the last released position when you try to open it.
     // TODO: Could certainly be improved - no idea for the moment.
@@ -612,20 +636,64 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
       if (this.interactionHandle == null) {
         this.interactionHandle = InteractionManager.createInteractionHandle();
       }
-      this.contentRef
-        .animate(this.animationIn, this.props.animationInTiming)
-        .then(() => {
-          this.isTransitioning = false;
-          if (this.interactionHandle) {
-            InteractionManager.clearInteractionHandle(this.interactionHandle);
-            this.interactionHandle = null;
-          }
-          if (!this.props.isVisible) {
-            this.close();
-          } else {
-            this.props.onModalShow();
-          }
+      // Stop any running animation first, then reset animationValue to 0
+      // before setAnimation. This prevents a visual glitch where setAnimation
+      // uses the current animationValue (e.g. 1.0 from a previous animation)
+      // to compute animationStyle, causing a one-frame flash at the wrong position.
+      // After stopAnimation, animationStyle is cleared so content is at its
+      // default position. Setting animationValue to 0 won't cause a visual jump
+      // since there's no active animationStyle to interpolate.
+      this.contentRef.stopAnimation();
+      if (this.contentRef.state && this.contentRef.state.animationValue) {
+        this.contentRef.state.animationValue.setValue(0);
+      }
+      const rafId1 = requestAnimationFrame(() => {
+        // Guard: if the component was unmounted or closed before the
+        // deferred frame fired, skip animation startup entirely.
+        if (!this.contentRef || !this.isTransitioning) {
+          return;
+        }
+        this.contentRef.setAnimation(this.animationIn, () => {
+          // setAnimation has now set animationStyle via setState.→native
+          //   first open when the Modal window is being created.
+          this.contentRef.startAnimation(
+            this.props.animationInTiming,
+            0,
+            0,
+            () => {
+              this.isTransitioning = false;
+              if (this.interactionHandle) {
+                InteractionManager.clearInteractionHandle(
+                  this.interactionHandle,
+                );
+                this.interactionHandle = null;
+              }
+              if (!this.props.isVisible) {
+                this.close();
+              } else {
+                this.props.onModalShow();
+              }
+            },
+          );
+          // Start backdrop fade-in in the same JS tick as content animation.
+          // Animated.timing().start() is synchronous in scheduling — it
+          // enqueues the animation immediately, ensuring backdrop and content
+          // begin on the same frame.
+          Animated.timing(this.backdropAnimated, {
+            toValue: this.props.backdropOpacity,
+            duration: this.props.backdropTransitionInTiming,
+            useNativeDriver: this.props.useNativeDriverForBackdrop === true,
+          }).start();
+          const rafId2 = requestAnimationFrame(() => {
+            if (!this.isTransitioning && !this.state.isVisible) {
+              return;
+            }
+            this.setState({showContent: true, animationReady: true});
+          });
+          this._pendingRAF.push(rafId2);
         });
+      });
+      this._pendingRAF.push(rafId1);
     }
   };
 
@@ -634,12 +702,6 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
       return;
     }
     this.isTransitioning = true;
-    if (this.backdropRef) {
-      this.backdropRef.transitionTo(
-        { opacity: 0 },
-        this.props.backdropTransitionOutTiming,
-      );
-    }
 
     let animationOut = this.animationOut;
 
@@ -661,34 +723,80 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
       if (this.interactionHandle == null) {
         this.interactionHandle = InteractionManager.createInteractionHandle();
       }
-      this.contentRef
-        .animate(animationOut, this.props.animationOutTiming)
-        .then(() => {
-          this.isTransitioning = false;
-          if (this.interactionHandle) {
-            InteractionManager.clearInteractionHandle(this.interactionHandle);
-            this.interactionHandle = null;
+      // Stop any running animation first, then reset animationValue to 0
+      // before setAnimation. This prevents a visual glitch where setAnimation
+      // uses the current animationValue (e.g. 1.0 from the entrance animation)
+      // to compute the exit animationStyle, causing a one-frame flash.
+      // After stopAnimation, animationStyle is cleared so content is at its
+      // default position. Setting animationValue to 0 won't cause a visual jump
+      // since there's no active animationStyle to interpolate.
+      this.contentRef.stopAnimation();
+      if (this.contentRef.state && this.contentRef.state.animationValue) {
+        this.contentRef.state.animationValue.setValue(0);
+      }
+      this.contentRef.setAnimation(animationOut, () => {
+        // setAnimation has set the exit animationStyle with
+        // animationValue=0, which corresponds to the "from" position
+        // of the exit animation (e.g. translateY:0 for slideOutDown,
+        // meaning the content is at its normal visible position).
+        // This is correct — the content should start at its current
+        // position and animate out. No need to hide content during
+        // close since the animationStyle is already correct.
+        if (this.backdropRef) {
+          if (this.backdropAnimated && this.backdropAnimated.stopAnimation) {
+            this.backdropAnimated.stopAnimation();
           }
-          if (this.props.isVisible) {
-            this.open();
-          } else {
-            this.setState(
-              {
-                showContent: false,
-              },
-              () => {
+          // Start backdrop fade-out in the same JS tick as content animation.
+          // Animated.timing().start() schedules immediately, keeping backdrop
+          // and content exit animations in sync without relying on animatable's
+          // internal state (transitionTo goes through setState which is async).
+          Animated.timing(this.backdropAnimated, {
+            toValue: 0,
+            duration: this.props.backdropTransitionOutTiming,
+            useNativeDriver: this.props.useNativeDriverForBackdrop === true,
+          }).start();
+        }
+        this.contentRef.startAnimation(
+          this.props.animationOutTiming,
+          0,
+          0,
+          () => {
+            const finalizeClose = () => {
+              this.isTransitioning = false;
+              if (this.interactionHandle) {
+                InteractionManager.clearInteractionHandle(
+                  this.interactionHandle,
+                );
+                this.interactionHandle = null;
+              }
+              if (this.props.isVisible) {
+                this.open();
+              } else {
                 this.setState(
                   {
+                    showContent: false,
                     isVisible: false,
+                    animationReady: false,
                   },
                   () => {
                     this.props.onModalHide();
                   },
                 );
-              },
-            );
-          }
-        });
+              }
+            };
+            // The startAnimation callback fires when the JS-side
+            // Animated.timing completes. On Harmony/OpenHarmony,
+            // the native rendering pipeline may still be processing
+            // the final frame. Use a small delay to ensure the last
+            // frame of the exit animation has been painted before
+            // removing the modal from the view hierarchy, preventing
+            // a flash where the modal content briefly reappears at
+            // its default (un-animated) position.
+            const timeoutId = setTimeout(finalizeClose, 32);
+            this._pendingTimeout.push(timeoutId);
+          },
+        );
+      });
     }
   };
   makeBackdrop = () => {
@@ -717,23 +825,22 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
         width: this.getDeviceWidth(),
         height: this.getDeviceHeight(),
         backgroundColor:
-          this.state.showContent && !hasCustomBackdrop
+          (this.props.isVisible || this.state.isVisible) && !hasCustomBackdrop
             ? backdropColor
             : 'transparent',
       },
     ];
 
     const backdropWrapper = (
-      <animatable.View
-        ref={ref => (this.backdropRef = ref)}
-        useNativeDriver={
-          useNativeDriverForBackdrop !== undefined
-            ? useNativeDriverForBackdrop
-            : useNativeDriver
-        }
-        style={[styles.backdrop, backdropComputedStyle]}>
+      <Animated.View
+        ref={(ref: any) => (this.backdropRef = ref)}
+        style={[
+          styles.backdrop,
+          backdropComputedStyle,
+          {opacity: this.backdropAnimated},
+        ]}>
         {hasCustomBackdrop && customBackdrop}
-      </animatable.View>
+      </Animated.View>
     );
 
     if (hasCustomBackdrop) {
@@ -796,18 +903,18 @@ export class ReactNativeModal extends React.Component<ModalProps, State> {
 
     // The user might decide not to show the modal while it is animating
     // to enhance performance.
-    const _children =
-      this.props.hideModalContentWhileAnimating &&
-        this.props.useNativeDriver &&
-        !this.state.showContent ? (
-        <animatable.View />
+    const shouldHideContent =
+      !this.state.showContent ||
+      (this.isTransitioning && !this.state.animationReady);
+    const _children = shouldHideContent ? (
+      <animatable.View style={{opacity: 0}} />
       ) : (
         children
       );
     const containerView = (
       <animatable.View
         {...panHandlers}
-        ref={ref => (this.contentRef = ref)}
+        ref={(ref: any) => (this.contentRef = ref)}
         style={[panPosition, computedStyle]}
         pointerEvents="box-none"
         useNativeDriver={useNativeDriver}

```
