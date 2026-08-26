# PR #117: fix:解决Text组件设置渐变色失效的问题

- **状态**: merged
- **作者**: cuijiaojiao1
- **创建时间**: 2026-06-22T20:04:46+08:00
- **分支**: 82Change → br_rnoh0.82
- **变更文件数**: 12

## PR 描述

fix:解决Text组件设置渐变色失效的问题 [#77](https://gitcode.com/CPF-RN/rntpc_react-native-svg/issues/77)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `OAT.xml` | ? | +10 | -2 |
| `buildEnv.sh` | added | +9 | -0 |
| `example/harmony/AppScope/app.json5` | ? | +1 | -1 |
| `example/harmony/build-profile.template.json5` | ? | +7 | -4 |
| `example/harmony/entry/build-profile.json5` | ? | +3 | -0 |
| `example/harmony/entry/oh-package.json5` | ? | +2 | -2 |
| `example/harmony/entry/src/main/cpp/CMakeLists.txt` | ? | +1 | -0 |
| `example/harmony/oh-package.json5` | ? | +1 | -1 |
| `example/package.json` | ? | +22 | -20 |
| `harmony/svg/src/main/cpp/SvgNode.cpp` | ? | +28 | -16 |
| `package.json` | ? | +1 | -0 |
| `tsconfig.json` | ? | +12 | -2 |

## Diff

### `OAT.xml`

```diff
@@ -51,7 +51,10 @@
 				<filteritem type="filepath" name="harmony/svg/src/main/cpp/svgImage/RNSVGImageShadowNode.h" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="harmony/svg/src/main/cpp/svgImage/RNSVGImageState.cpp" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="harmony/svg/src/main/cpp/svgImage/RNSVGImageState.h" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
-				
+				<filteritem type="filename" name=".eslintrc.js" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filename" name=".prettierrc.js" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filename" name="babel.config.js" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
+				<filteritem type="filename" name="buildEnv.sh" desc="配置文件无需更改，因此添加过滤"/>
             </filefilter>
             <filefilter name="defaultPolicyFilter" desc="Filters for compatibility，license header policies">
                 <filteritem type="filepath" name="harmony/svg/hvigorfile.ts" desc="hvigor构建脚本，DevEco Studio自动生成，不手动修改"/>
@@ -89,6 +92,10 @@
 				<filteritem type="filepath" name="harmony/svg/src/main/cpp/svgImage/RNSVGImageState.h" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="harmony/svg/BuildProfile.ets" desc="工程模板，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="example/harmony/hvigorfile.ts" desc="工程模板，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filename" name=".eslintrc.js" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filename" name=".prettierrc.js" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filename" name="babel.config.js" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
+				<filteritem type="filename" name="buildEnv.sh" desc="配置文件无需更改，因此添加过滤"/>
             </filefilter>
 
             <filefilter name="binaryFileTypePolicyFilter" desc="Filters for copyright header policies">
@@ -101,4 +108,5 @@
             </filefilter>
         </filefilterlist>
     </oatconfig>
-</configuration>
\ No newline at end of file
+</configuration>
+

```

### `buildEnv.sh`

```diff
@@ -0,0 +1,9 @@
+#!/bin/bash
+BUILD_PKG_DIR=example
+BUILD_SAMPLE_DIR=example/harmony
+BUILD_THIRD_PARTY_DIR=harmony/
+
+# BUILD_PKG_DIR: 用来打 tgz 包的工程目录
+# BUILD_SAMPLE_DIR：用来打 har 包的目录
+# BUILD_THIRD_PARTY_DIR：库模块源码目录
+

```

### `example/harmony/AppScope/app.json5`

```diff
@@ -1,6 +1,6 @@
 {
   "app": {
-    "bundleName": "com.harmony.wechat.lib.demo",
+    "bundleName": "com.example.svg",
     "vendor": "example",
     "versionCode": 1000000,
     "versionName": "1.0.0",

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
@@ -28,9 +27,13 @@
           "name": 'default',
           "applyToProducts": [
             'default'
-          ],
-        },
-      ],
+          ]
+        }
+      ]
+    },
+    {
+      "name": "svg",
+      "srcPath": '../../harmony/svg'
     }
   ],
 }
\ No newline at end of file

```

### `example/harmony/entry/build-profile.json5`

```diff
@@ -4,6 +4,9 @@
     "externalNativeOptions": {
       "path": "./src/main/cpp/CMakeLists.txt",
       "arguments": "",
+      "abiFilters": [
+        "arm64-v8a"
+      ]
     },
   },
   "targets": [

```

### `example/harmony/entry/oh-package.json5`

```diff
@@ -5,7 +5,7 @@
   "description": "example description",
   "version": "1.0.0",
   "dependencies": {
-    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/harmony/react_native_openharmony.har",
-    "@react-native-ohos/react-native-svg": "file:../../node_modules/@react-native-ohos/react-native-svg/harmony/svg.har"
+    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/react_native_openharmony.har",
+    "@react-native-ohos/react-native-svg": "file:../../node_modules/@react-native-ohos/react-native-svg/harmony/svg.har",
   }
 }
\ No newline at end of file

```

### `example/harmony/entry/src/main/cpp/CMakeLists.txt`

```diff
@@ -1,5 +1,6 @@
 project(rnapp)
 cmake_minimum_required(VERSION 3.4.1)
+set(CMAKE_NINJA_FORCE_RESPONSE_FILE 1)
 set(CMAKE_SKIP_BUILD_RPATH TRUE)
 set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
 set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules")

```

### `example/harmony/oh-package.json5`

```diff
@@ -6,7 +6,7 @@
   "repository": {},
   "version": "1.0.0",
   "overrides": {
-    "@rnoh/react-native-openharmony": "file:./../node_modules/react-native-harmony/harmony/react_native_openharmony.har"
+    "@rnoh/react-native-openharmony": "file:../node_modules/react-native-harmony/react_native_openharmony.har"
   },
   "dynamicDependencies": {}
 }
\ No newline at end of file

```

### `example/package.json`

```diff
@@ -1,6 +1,6 @@
 {
   "name": "@react-native-ohos/react-native-svg",
-  "version": "15.12.1-rc.1",
+  "version": "15.13.0",
   "private": true,
   "scripts": {
     "i": "cd ../ && npm i && npm run pack && cd ./example && npm i",
@@ -8,53 +8,55 @@
     "start": "hdc rport tcp:8081 tcp:8081 && react-native start",
     "codegen": "react-native codegen-harmony --rnoh-module-path ./harmony/entry/oh_modules/@rnoh/react-native-openharmony",
     "pack:pkg": "cd ../ && npm pack && cd ./example",
-    "install:pkg": "npm uninstall @react-native-ohos/react-native-svg && npm run pack:pkg && npm i @react-native-ohos/react-native-svg@file:../react-native-ohos-react-native-svg-15.12.1-rc.12.tgz",
+    "install:pkg": "npm uninstall @react-native-ohos/react-native-svg && npm run pack:pkg && npm i @react-native-ohos/react-native-svg@file:../react-native-ohos-react-native-svg-15.13.0.tgz",
     "dev": "npm run codegen && react-native bundle-harmony --dev --minify=false",
     "prod": "npm run codegen && react-native bundle-harmony --dev=false --minify=true",
     "postinstall": "node ./scripts/create-build-profile",
-    "fast:pkg": "cd ../ && npm i --legacy-peer-deps && npm pack --ignore-scripts && cd ./example && npm i && npm run dev"
+    "fast-install-project": "cd ../ && npm i --force && npm run pack && rm -r node_modules && cd ./example && npm i --force",
+    "fast:pkg": "npm run fast-install-project && npm run dev"    
   },
   "dependencies": {
     "@gorhom/portal": "^1.0.14",
-    "@react-native-ohos/react-native-svg": "file:../react-native-ohos-react-native-svg-15.12.1-rc.11.tgz",
-    "react": "18.3.1",
-    "react-native": "0.77.1",
-    "react-native-harmony": "file:../packages/rnoh-react-native-harmony-0.77.10.tgz",
+    "@react-native-ohos/react-native-svg": "file:../react-native-ohos-react-native-svg-15.13.0.tgz",
+    "react": "19.1.1",
+    "react-native": "0.82.1",
+    "react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.82.7",
     "react-native-reanimated": "^3.6.0"
   },
   "devDependencies": {
     "@babel/core": "^7.25.2",
     "@babel/preset-env": "^7.25.3",
     "@babel/runtime": "^7.25.0",
-    "@react-native-community/cli": "15.0.1",
+    "@react-native-community/cli": "20.0.0",
     "@react-native-community/cli-platform-android": "15.0.1",
-    "@react-native-community/cli-platform-ios": "15.0.1",
+    "@react-native-community/cli-platform-ios": "20.0.0",
     "@react-native-community/eslint-config": "^3.2.0",
-    "@react-native/babel-preset": "0.77.1",
-    "@react-native/eslint-config": "0.77.1",
-    "@react-native/metro-config": "^0.77.1",
-    "@react-native/typescript-config": "0.77.1",
-    "@rnoh/react-native-harmony-cli": "file:../packages/rnoh-react-native-harmony-cli-0.77.10.tgz",
+    "@react-native/babel-preset": "0.82.1",
+    "@react-native/eslint-config": "0.82.1",
+    "@react-native/metro-config": "^0.82.1",
+    "@react-native/typescript-config": "0.82.1",
+    "@rnoh/react-native-harmony-cli": "npm:@react-native-oh/react-native-harmony-cli@0.82.7",
     "@tsconfig/react-native": "^3.0.0",
     "@types/d3-scale-chromatic": "^3.0.0",
     "@types/jest": "^29.5.13",
-    "@types/react": "^18.2.6",
-    "@types/react-test-renderer": "^18.0.0",
+    "@types/react": "^19.1.0",
+    "@types/react-test-renderer": "^19.1.0",
     "babel-jest": "^29.6.3",
     "eslint": "^8.19.0",
     "jest": "^29.7.0",
     "metro-react-native-babel-preset": "0.76.8",
-    "prettier": "2.8.8",
-    "react-test-renderer": "18.3.1",
+    "prettier": "3.0.0",
+    "react-test-renderer": "19.1.1",
     "typescript": "5.5.4"
   },
   "overrides": {
-    "@react-native-community/cli": "15.0.1"
+    "@react-native-community/cli": "20.0.0"
   },
   "resolutions": {
-    "@react-native-community/cli": "15.0.1"
+    "@react-native-community/cli": "20.0.0"
   },
   "engines": {
     "node": ">=18"
   }
 }
+

```

### `harmony/svg/src/main/cpp/SvgNode.cpp`

```diff
@@ -211,24 +211,36 @@ void SvgNode::Draw(OH_Drawing_Canvas *canvas) {
     }
 	
     if (hrefFill_) {
-		attributes_.fillState.SetGradient(std::nullopt, false);
-		attributes_.strokeState.SetGradient(std::nullopt, false);
         auto fillHref = attributes_.fillState.GetHref();
-        if (!fillHref.empty()) {
-            auto gradient = GetGradient(fillHref);
-            if (gradient) {
-                attributes_.fillState.SetGradient(gradient.value(), true);
-            }
-            auto pattern = GetPatternAttr(fillHref);
-            if (pattern) {
-                attributes_.fillState.SetPattern(pattern);
-            }
-        }
         auto strokeHref = attributes_.strokeState.GetHref();
-        if (!strokeHref.empty()) {
-            auto gradient = GetGradient(strokeHref);
-            if (gradient) {
-                attributes_.strokeState.SetGradient(gradient.value(), true);
+        // Only reset gradient if the node has its own href reference to resolve.
+        // If there is no href, the gradient was inherited from parent via InitStyle/InheritAttr,
+        // and resetting it would destroy the inherited gradient (critical for Text/TSpan elements
+        // where gradient is inherited from parent, not referenced via href).
+        bool hasFillHref = !fillHref.empty();
+        bool hasStrokeHref = !strokeHref.empty();
+        if (hasFillHref || hasStrokeHref) {
+            if (hasFillHref) {
+                attributes_.fillState.SetGradient(std::nullopt, false);
+            }
+            if (hasStrokeHref) {
+                attributes_.strokeState.SetGradient(std::nullopt, false);
+            }
+            if (hasFillHref) {
+                auto gradient = GetGradient(fillHref);
+                if (gradient) {
+                    attributes_.fillState.SetGradient(gradient.value(), true);
+                }
+                auto pattern = GetPatternAttr(fillHref);
+                if (pattern) {
+                    attributes_.fillState.SetPattern(pattern);
+                }
+            }
+            if (hasStrokeHref) {
+                auto gradient = GetGradient(strokeHref);
+                if (gradient) {
+                    attributes_.strokeState.SetGradient(gradient.value(), true);
+                }
             }
         }
     }

```

### `package.json`

```diff
@@ -7,6 +7,7 @@
   "module": "lib/module/index",
   "types": "lib/typescript/index.d.ts",
   "scripts": {
+    "pack": "npm pack --ignore-scripts",
     "prepack": "bob build",
     "prepublishOnly": "npm run prepack && react-native verify-package-harmony --package-path . --skip-checks oh_package_name_is_derived_from_npm_package_name",
     "update_version": "node ./scripts/update-version.js",

```

### `tsconfig.json`

```diff
@@ -3,10 +3,20 @@
     "@tsconfig/react-native/tsconfig.json",
   ],
   "compilerOptions": {
-    "noEmit": false
+    "noEmit": false,
+    "skipLibCheck": true,
+    "allowJs": false,
+    "baseUrl": ".",
+    "paths": {
+      "react-native-svg/src/*": ["node_modules/react-native-svg/lib/typescript/*"]
+    }
   },
   "exclude": [
     "lib",
-    "harmony"
+    "harmony",
+    "example",
+    "node_modules",
+    "scripts",
+    "babel.config.js"
   ]
 }
\ No newline at end of file

```
