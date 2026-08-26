# PR #32: fix:修复嵌套滑动时父子组件无法联动响应的问题

- **状态**: merged
- **作者**: qq_434633291111
- **创建时间**: 2026-08-01T19:34:53+08:00
- **分支**: br_rnoh0.77 → br_rnoh0.77
- **变更文件数**: 8

## PR 描述

fix:修复嵌套滑动时父子组件无法联动响应的问题
Close: [#19](https://gitcode.com/CPF-RN/rntpc_react-native-pager-view/issues/19)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `.npmignore` | added | +2 | -0 |
| `example/harmony/build-profile.template.json5` | ? | +4 | -1 |
| `example/harmony/entry/oh-package.json5` | ? | +1 | -1 |
| `example/harmony/oh-package.json5` | ? | +1 | -1 |
| `example/metro.config.js` | ? | +2 | -2 |
| `example/package.json` | ? | +2 | -2 |
| `harmony/pager_view/src/main/cpp/SwiperNode.cpp` | ? | +4 | -0 |
| `harmony/pager_view/src/main/cpp/SwiperNode.h` | ? | +1 | -0 |

## Diff

### `.npmignore`

```diff
@@ -0,0 +1,2 @@
+example
+build
\ No newline at end of file

```

### `example/harmony/build-profile.template.json5`

```diff
@@ -4,7 +4,6 @@
       {
         "name": 'default',
         "signingConfig": 'default',
-        "compileSdkVersion": '5.0.1(13)',
         "compatibleSdkVersion": '5.0.0(12)',
         "runtimeOS": 'HarmonyOS'
       },
@@ -31,6 +30,10 @@
           ],
         },
       ],
+    },
+    {
+      name: 'pager_view',
+      srcPath: '../../harmony/pager_view',
     }
   ],
 }
\ No newline at end of file

```

### `example/harmony/entry/oh-package.json5`

```diff
@@ -5,7 +5,7 @@
   "description": "example description",
   "version": "1.0.0",
   "dependencies": {
-    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/harmony/react_native_openharmony.har",
+    "@rnoh/react-native-openharmony": "file:../../node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har",
     "@react-native-ohos/react-native-pager-view": "file:../../node_modules/@react-native-ohos/react-native-pager-view/harmony/pager_view.har"
   }
 }
\ No newline at end of file

```

### `example/harmony/oh-package.json5`

```diff
@@ -6,7 +6,7 @@
   "repository": {},
   "version": "1.0.0",
   "overrides": {
-    "@rnoh/react-native-openharmony": "file:./../node_modules/react-native-harmony/harmony/react_native_openharmony.har"
+    '@rnoh/react-native-openharmony': 'file:../node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har'
   },
   "dynamicDependencies": {}
 }
\ No newline at end of file

```

### `example/metro.config.js`

```diff
@@ -5,7 +5,7 @@
  */
 
 const {mergeConfig, getDefaultConfig} = require('@react-native/metro-config');
-const {createHarmonyMetroConfig} = require('react-native-harmony/metro.config');
+const {createHarmonyMetroConfig} = require('@react-native-oh/react-native-harmony/metro.config');
 
 /**
  * @type {import("metro-config").ConfigT}
@@ -24,7 +24,7 @@ const config = {
 module.exports = mergeConfig(
   getDefaultConfig(__dirname),
   createHarmonyMetroConfig({
-    reactNativeHarmonyPackageName: 'react-native-harmony',
+    reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
   }),
   config,
 );

```

### `example/package.json`

```diff
@@ -19,7 +19,7 @@
     "@react-native-ohos/react-native-pager-view": "file:../react-native-ohos-react-native-pager-view-6.7.3.tgz",
     "react": "18.3.1",
     "react-native": "0.77.1",
-    "react-native-harmony": "file:../packages/rnoh-react-native-harmony-0.77.10.tgz",
+    "@react-native-oh/react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.77.18-1",
     "react-native-reanimated": "^3.6.0"
   },
   "devDependencies": {
@@ -34,7 +34,7 @@
     "@react-native/eslint-config": "0.77.1",
     "@react-native/metro-config": "^0.77.1",
     "@react-native/typescript-config": "0.77.1",
-    "@rnoh/react-native-harmony-cli": "file:../packages/rnoh-react-native-harmony-cli-0.77.10.tgz",
+    "@rnoh/react-native-harmony-cli": "npm:@react-native-oh/react-native-harmony-cli@0.77.18",
     "@tsconfig/react-native": "^3.0.0",
     "@types/d3-scale-chromatic": "^3.0.0",
     "@types/jest": "^29.5.13",

```

### `harmony/pager_view/src/main/cpp/SwiperNode.cpp`

```diff
@@ -42,6 +42,10 @@ namespace rnoh {
             m_nodeHandle, NODE_SWIPER_EVENT_ON_CONTENT_DID_SCROLL, NODE_SWIPER_EVENT_ON_CONTENT_DID_SCROLL, this));
         maybeThrow(NativeNodeApi::getInstance()->registerNodeEvent(
             m_nodeHandle, NODE_EVENT_ON_APPEAR, NODE_EVENT_ON_APPEAR, this));
+        // 开启嵌套滑动时的父子联动响应
+        ArkUI_NumberValue indexValue[] = {{.i32 = m_swiperNestedScrollMode}};
+        ArkUI_AttributeItem indexItem = {indexValue, sizeof(indexValue) / sizeof(ArkUI_NumberValue)};
+        maybeThrow(NativeNodeApi::getInstance()->setAttribute(m_nodeHandle, NODE_SWIPER_NESTED_SCROLL, &indexItem));
     }
 
 

```

### `harmony/pager_view/src/main/cpp/SwiperNode.h`

```diff
@@ -81,6 +81,7 @@ namespace rnoh {
         std::chrono::high_resolution_clock::time_point animationEnd;
         bool m_interceptSendOffset = false;
         std::map<void*,ArkUI_NodeHandle> m_nodeHandleMap;
+        ArkUI_SwiperNestedScrollMode m_swiperNestedScrollMode = ARKUI_SWIPER_NESTED_SRCOLL_SELF_FIRST;
     public:
         SwiperNode();
     

```
