# PR #45: fix:加速度传感器需要在使用的时候再打开，而不是初始化的时候打开

- **状态**: merged
- **作者**: qq_434633291111
- **创建时间**: 2026-08-06T11:29:27+08:00
- **分支**: br_rnoh0.77 → br_rnoh0.77
- **变更文件数**: 58
- **⚠️ 注意**: diff 过大已截断，变更文件列表完整保留

## PR 描述

fix:加速度传感器需要在使用的时候再打开，而不是初始化的时候打开

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `.npmignore` | ? | +3 | -0 |
| `example/.eslintrc` | added | +19 | -0 |
| `example/.gitignore` | added | +71 | -0 |
| `example/.node-version` | added | +6 | -0 |
| `example/.prettierrc.js` | added | +7 | -0 |
| `example/.watchmanconfig` | added | +6 | -0 |
| `example/app.json` | added | +4 | -0 |
| `example/babel.config.js` | added | +6 | -0 |
| `example/contexts.ts` | added | +9 | -0 |
| `example/harmony/.gitignore` | added | +22 | -0 |
| `example/harmony/AppScope/app.json5` | added | +10 | -0 |
| `example/harmony/AppScope/resources/base/element/string.json` | added | +8 | -0 |
| `example/harmony/AppScope/resources/base/media/app_icon.png` | added | +0 | -0 |
| `example/harmony/build-profile.template.json5` | added | +40 | -0 |
| `example/harmony/codelinter.json` | added | +32 | -0 |
| `example/harmony/entry/.gitignore` | added | +7 | -0 |
| `example/harmony/entry/build-profile.json5` | added | +21 | -0 |
| `example/harmony/entry/hvigorfile.ts` | added | +8 | -0 |
| `example/harmony/entry/oh-package.json5` | added | +11 | -0 |
| `example/harmony/entry/src/main/cpp/.gitignore` | added | +2 | -0 |
| `example/harmony/entry/src/main/cpp/CMakeLists.txt` | added | +38 | -0 |
| `example/harmony/entry/src/main/cpp/PackageProvider.cpp` | added | +15 | -0 |
| `example/harmony/entry/src/main/ets/RNPackagesFactory.ets` | added | +15 | -0 |
| `example/harmony/entry/src/main/ets/assets/fonts/Pacifico-Regular.ttf` | added | +0 | -0 |
| `example/harmony/entry/src/main/ets/assets/fonts/StintUltraCondensed-Regular.ttf` | added | +0 | -0 |
| `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets` | added | +27 | -0 |
| `example/harmony/entry/src/main/ets/pages/Index.ets` | added | +113 | -0 |
| `example/harmony/entry/src/main/ets/pages/SurfaceDeadlockTest.ets` | added | +135 | -0 |
| `example/harmony/entry/src/main/ets/pages/TouchDisplayer.ets` | added | +44 | -0 |
| `example/harmony/entry/src/main/module.json5` | added | +52 | -0 |
| `example/harmony/entry/src/main/resources/.gitignore` | added | +1 | -0 |
| `example/harmony/entry/src/main/resources/base/element/color.json` | added | +8 | -0 |
| `example/harmony/entry/src/main/resources/base/element/string.json` | added | +16 | -0 |
| `example/harmony/entry/src/main/resources/base/media/icon.png` | added | +0 | -0 |
| `example/harmony/entry/src/main/resources/base/profile/main_pages.json` | added | +5 | -0 |
| `example/harmony/entry/src/main/resources/rawfile/1.txt` | added | +1 | -0 |
| `example/harmony/format.ps1` | added | +18 | -0 |
| `example/harmony/hvigor/.gitignore` | added | +1 | -0 |
| `example/harmony/hvigor/hvigor-config.json5` | added | +21 | -0 |
| `example/harmony/hvigorfile.ts` | added | +6 | -0 |
| `example/harmony/oh-package.json5` | added | +13 | -0 |
| `example/index.js` | added | +11 | -0 |
| `example/jest.config.js` | added | +11 | -0 |
| `example/metro.config.js` | added | +30 | -0 |
| `example/package.json` | added | +61 | -0 |
| `example/react-native.config.js` | added | +11 | -0 |
| `example/rnoh-testerino-0.0.12.tgz` | added | +0 | -0 |
| `example/scripts/create-build-profile.js` | added | +46 | -0 |
| `example/src/OrientationLockerExample.tsx` | added | +510 | -0 |
| `example/tsconfig.json` | added | +14 | -0 |
| `harmony/orientation_locker/src/main/cpp/generated/RNOH/generated/turbo_modules/OreitationLockerNativeModule.cpp` | ? | +2 | -0 |
| `harmony/orientation_locker/src/main/ets/Logger.ts` | added | +64 | -0 |
| `harmony/orientation_locker/src/main/ets/RNOrientationLockerTurboModule.ts` | ? | +75 | -48 |
| `harmony/orientation_locker/src/main/ets/generated/turboModules/OreitationLockerNativeModule.ts` | ? | +4 | -0 |
| `package.json` | ? | +3 | -3 |
| `src/OreitationLockerNativeModule.ts` | ? | +5 | -0 |
| `src/orientation.harmony.js` | ? | +2 | -0 |
| `src/orientation.js` | ? | +4 | -0 |

## Diff

### `.npmignore`

```diff
@@ -49,3 +49,6 @@ yarn-error.log
 .git
 .watchmanconfig
 .history
+*.tgz
+example
+build

```

### `example/.eslintrc`

```diff
@@ -0,0 +1,19 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+{
+  "extends": "@react-native",
+  "rules": {
+    "react-native/no-inline-styles": "off",
+    "react/no-unstable-nested-components": "off",
+    "react/react-in-jsx-scope": "off",
+    "@typescript-eslint/no-unused-vars": "warn",
+    "react-hooks/exhaustive-deps": "off",
+    "radix": "off",
+    "prettier/prettier": "warn",
+    "max-lines": "off"
+  }
+}
\ No newline at end of file

```

### `example/.gitignore`

```diff
@@ -0,0 +1,71 @@
+.husky
+bundle.harmony.js
+package-lock.json
+*.hbc
+lintCppResult.txt
+
+# ---
+
+# OSX
+#
+.DS_Store
+
+# Xcode
+#
+build/
+*.pbxuser
+!default.pbxuser
+*.mode1v3
+!default.mode1v3
+*.mode2v3
+!default.mode2v3
+*.perspectivev3
+!default.perspectivev3
+xcuserdata
+*.xccheckout
+*.moved-aside
+DerivedData
+*.hmap
+*.ipa
+*.xcuserstate
+
+# Android/IntelliJ
+#
+build/
+.idea
+.gradle
+local.properties
+*.iml
+*.hprof
+.cxx/
+*.keystore
+!debug.keystore
+BuildProfile.ets
+
+# node.js
+#
+node_modules/
+npm-debug.log
+yarn-error.log
+
+# fastlane
+#
+# It is recommended to not store the screenshots in the git repo. Instead, use fastlane to re-generate the
+# screenshots whenever they are needed.
+# For more information about the recommended setup visit:
+# https://docs.fastlane.tools/best-practices/source-control/
+
+**/fastlane/report.xml
+**/fastlane/Preview.html
+**/fastlane/screenshots
+**/fastlane/test_output
+
+# Bundle artifact
+*.jsbundle
+
+# Ruby / CocoaPods
+/vendor/bundle/
+
+# Temporary files created by Metro to check the health of the file watcher
+.metro-health-check*
+*.htrace
\ No newline at end of file

```

### `example/.node-version`

```diff
@@ -0,0 +1,6 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+18

```

### `example/.prettierrc.js`

```diff
@@ -0,0 +1,7 @@
+module.exports = {
+  arrowParens: 'avoid',
+  bracketSameLine: true,
+  bracketSpacing: true,
+  singleQuote: true,
+  trailingComma: 'all',
+};

```

### `example/.watchmanconfig`

```diff
@@ -0,0 +1,6 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+{}
\ No newline at end of file

```

### `example/app.json`

```diff
@@ -0,0 +1,4 @@
+{
+  "name": "app_name",
+  "displayName": "tester"
+}
\ No newline at end of file

```

### `example/babel.config.js`

```diff
@@ -0,0 +1,6 @@
+module.exports = {
+  presets: ['module:@react-native/babel-preset'],
+  plugins: [
+    'react-native-reanimated/plugin',
+  ],
+};

```

### `example/contexts.ts`

```diff
@@ -0,0 +1,9 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+import React from 'react';
+
+export const AppParamsContext = React.createContext(undefined);

```

### `example/harmony/.gitignore`

```diff
@@ -0,0 +1,22 @@
+# it may cause some issues when building the project when switching branches
+package-lock.json
+# we add this because we want to keep the signing configs out of git
+rnoh_modules
+
+**/oh-package-lock.json5
+# ---
+
+/node_modules
+/local.properties
+/.idea
+**/build
+/.hvigor
+.cxx
+/.clangd
+/.clang-format
+/.clang-tidy
+/oh_modules
+hvigorw
+hvigorw.bat
+hvigor/hvigor-wrapper.js
+

```

### `example/harmony/AppScope/app.json5`

```diff
@@ -0,0 +1,10 @@
+{
+  "app": {
+    "bundleName": "com.harmony.wechat.lib.demo",
+    "vendor": "example",
+    "versionCode": 1000000,
+    "versionName": "1.0.0",
+    "icon": "$media:app_icon",
+    "label": "$string:app_name"
+  }
+}

```

### `example/harmony/AppScope/resources/base/element/string.json`

```diff
@@ -0,0 +1,8 @@
+{
+  "string": [
+    {
+      "name": "app_name",
+      "value": "RN Tester"
+    }
+  ]
+}

```

### `example/harmony/AppScope/resources/base/media/app_icon.png`

```diff
Binary files no preview for this file type
```

### `example/harmony/build-profile.template.json5`

```diff
@@ -0,0 +1,40 @@
+{
+  "app": {
+    "signingConfigs": [
+    ],
+    "products": [
+      {
+        "name": "default",
+        "signingConfig": "default",
+        "compatibleSdkVersion": "5.0.0(12)",
+        "runtimeOS": "HarmonyOS"
+      }
+    ],
+    "buildModeSet": [
+      {
+        "name": "debug",
+      },
+      {
+        "name": "release"
+      }
+    ]
+  },
+  "modules": [
+    {
+      "name": "entry",
+      "srcPath": "./entry",
+      "targets": [
+        {
+          "name": "default",
+          "applyToProducts": [
+            "default"
+          ]
+        }
+      ]
+    },
+    {
+      name: 'orientation_locker',
+      srcPath: '../../harmony/orientation_locker',
+    }
+  ]
+}
\ No newline at end of file

```

### `example/harmony/codelinter.json`

```diff
@@ -0,0 +1,32 @@
+{
+  "files": ["**/*.ts", "**/*.ets"],
+  "ignore": [
+    "**/ohosTest/**/*",
+    "**/node_modules/**/*",
+    "**/hvigorfile.ts",
+    "**/node_modules/**/*",
+    "**/oh_modules/**/*",
+    "**/build/**/*",
+    "**/.preview/**/*"
+  ],
+  "plugins": ["@typescript-eslint"],
+  "ruleSet": [],
+  "rules": {
+    "@typescript-eslint/await-thenable": "warn",
+    "@typescript-eslint/consistent-type-imports": "warn",
+    "@typescript-eslint/explicit-function-return-type": "warn",
+    "@typescript-eslint/explicit-module-boundary-types": "warn",
+    "@typescript-eslint/no-dynamic-delete": "warn",
+    "@typescript-eslint/no-explicit-any": "warn",
+    "@typescript-eslint/no-for-in-array": "warn",
+    "@typescript-eslint/no-this-alias": "warn",
+    "@typescript-eslint/no-unnecessary-type-constraint": "warn",
+    "@typescript-eslint/no-unsafe-argument": "warn",
+    "@typescript-eslint/no-unsafe-assignment": "warn",
+    "@typescript-eslint/no-unsafe-call": "warn",
+    "@typescript-eslint/no-unsafe-member-access": "warn",
+    "@typescript-eslint/no-unsafe-return": "warn",
+    "@typescript-eslint/prefer-literal-enum-member": "warn"
+  },
+  "overrides": []
+}

```

### `example/harmony/entry/.gitignore`

```diff
@@ -0,0 +1,7 @@
+/node_modules
+/.preview
+/build
+/.cxx
+package-lock.json
+/oh_modules
+/assets

```

### `example/harmony/entry/build-profile.json5`

```diff
@@ -0,0 +1,21 @@
+{
+  "apiType": 'stageMode',
+  "buildOption": {
+    "externalNativeOptions": {
+      "path": "./src/main/cpp/CMakeLists.txt",
+      "arguments": "",
+      "cppFlags": "-s",
+      "abiFilters": [
+        "arm64-v8a"
+      ]
+    }
+  },
+  "targets": [
+    {
+      "name": "default",
+    },
+    {
+      "name": "ohosTest",
+    }
+  ]
+}
\ No newline at end of file

```

### `example/harmony/entry/hvigorfile.ts`

```diff
@@ -0,0 +1,8 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+// Script for compiling build behavior. It is built in the build plug-in and cannot be modified currently.
+export { hapTasks } from '@ohos/hvigor-ohos-plugin';

```

### `example/harmony/entry/oh-package.json5`

```diff
@@ -0,0 +1,11 @@
+{
+  "license": "ISC",
+  "devDependencies": {},
+  "name": "entry",
+  "description": "example description",
+  "version": "1.0.0",
+  "dependencies": {
+    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/harmony/react_native_openharmony.har",
+     "@react-native-ohos/react-native-orientation-locker": "file:../../node_modules/@react-native-ohos/react-native-orientation-locker/harmony/orientation_locker.har"
+  }
+}
\ No newline at end of file

```

### `example/harmony/entry/src/main/cpp/.gitignore`

```diff
@@ -0,0 +1,2 @@
+jsbundle.h
+generated/

```

### `example/harmony/entry/src/main/cpp/CMakeLists.txt`

```diff
@@ -0,0 +1,38 @@
+project(rnapp)
+cmake_minimum_required(VERSION 3.4.1)
+set(CMAKE_SKIP_BUILD_RPATH TRUE)
+set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
+set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules")
+set(OH_MODULE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
+set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules/@rnoh/react-native-openharmony/src/main/cpp")
+set(RNOH_GENERATED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/generated")
+set(LOG_VERBOSITY_LEVEL 1)
+set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
+set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
+set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
+
+set(WITH_HITRACE_SYSTRACE 1) # for other CMakeLists.txt files to use
+add_compile_definitions(WITH_HITRACE_SYSTRACE)
+
+# (VM) Define a variable and assign it to the current module's cpp directory
+set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})
+
+# Add the Header File directory, including cpp, cpp/include, and tell cmake to find the Header Files introduced by the code here
+include_directories(${NATIVERENDER_ROOT_PATH}
+                    ${NATIVERENDER_ROOT_PATH}/include)
+
+add_subdirectory("${RNOH_CPP_DIR}" ./rn)
+
+# RNOH_BEGIN: manual_package_linking_1
+add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-orientation-locker/src/main/cpp" ./orientation-locker)
+# RNOH_END: manual_package_linking_1
+
+add_library(rnoh_app SHARED
+    "./PackageProvider.cpp"
+    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
+)
+target_link_libraries(rnoh_app PUBLIC rnoh)
+
+# RNOH_BEGIN: manual_package_linking_2
+target_link_libraries(rnoh_app PUBLIC rnoh_orientation_locker)
+# RNOH_END: manual_package_linking_2

```

### `example/harmony/entry/src/main/cpp/PackageProvider.cpp`

```diff
@@ -0,0 +1,15 @@
+// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+// Use of this source code is governed by a MIT license that can be
+// found in the LICENSE file.
+
+#include "RNOH/PackageProvider.h"
+#include "OrientationLockerPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx)
+{
+    return {
+        std::make_shared<OrientationLockerPackage>(ctx),
+    };
+}
\ No newline at end of file

```

### `example/harmony/entry/src/main/ets/RNPackagesFactory.ets`

```diff
@@ -0,0 +1,15 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+
+import type {RNPackageContext, RNPackage} from '@rnoh/react-native-openharmony/ts';
+import { RNOrientationLockerPackage } from "@react-native-ohos/react-native-orientation-locker/ts";
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new RNOrientationLockerPackage(ctx)
+  ];
+}

```

### `example/harmony/entry/src/main/ets/assets/fonts/Pacifico-Regular.ttf`

```diff
Binary files no preview for this file type
```

### `example/harmony/entry/src/main/ets/assets/fonts/StintUltraCondensed-Regular.ttf`

```diff
Binary files no preview for this file type
```

### `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets`

```diff
@@ -0,0 +1,27 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+import {RNAbility} from '@rnoh/react-native-openharmony';
+import { AbilityConstant, Want } from '@kit.AbilityKit';
+
+export default class EntryAbility extends RNAbility {
+
+  onCreate(want: Want) {
+    super.onCreate(want)
+    this.handleWeChatCallIfNeed(want)
+  }
+
+  getPagePath() {
+    return 'pages/Index';
+  }
+
+  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
+    this.handleWeChatCallIfNeed(want)
+  }
+
+  private handleWeChatCallIfNeed(want: Want) {
+  }
+}

```

### `example/harmony/entry/src/main/ets/pages/Index.ets`

```diff
@@ -0,0 +1,113 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+import {
+  AnyJSBundleProvider,
+  ComponentBuilderContext,
+  FileJSBundleProvider,
+  MetroJSBundleProvider,
+  ResourceJSBundleProvider,
+  RNApp,
+  RNOHErrorDialog,
+  RNOHLogger,
+  TraceJSBundleProviderDecorator,
+  RNOHCoreContext
+} from '@rnoh/react-native-openharmony';
+import font from '@ohos.font';
+import { createRNPackages } from '../RNPackagesFactory';
+import common from '@ohos.app.ability.common';
+import BuildProfile from 'BuildProfile';
+
+
+let context = getContext(this) as common.UIAbilityContext;
+@Builder
+export function buildCustomRNComponent(ctx: ComponentBuilderContext) {
+  // There seems to be a problem with the placement of ArkTS components in mixed mode. Nested Stack temporarily avoided.
+  Stack() {
+  }
+  .position({ x: 0, y: 0 })
+
+}
+
+const wrappedCustomRNComponentBuilder = wrapBuilder(buildCustomRNComponent)
+
+/**
+ * If you want to use custom fonts, you need to register them here.
+ * We should support react-native-asset to handle registering fonts automatically.
+ */
+const fonts: font.FontOptions[] = [
+  {
+    familyName: 'Pacifico-Regular',
+    familySrc: '/assets/fonts/Pacifico-Regular.ttf'
+  },
+  {
+    familyName: 'StintUltraCondensed-Regular',
+    familySrc: '/assets/fonts/StintUltraCondensed-Regular.ttf'
+  }
+]
+
+@Entry
+@Component
+struct Index {
+  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined
+  @State shouldShow: boolean = false
+  private logger!: RNOHLogger
+  bundlePath: string = 'bundle.harmony.js'
+  @State hasBundle: boolean = false
+
+  aboutToAppear() {
+    this.logger = this.rnohCoreContext!.logger.clone("Index")
+    const stopTracing = this.logger.clone("aboutToAppear").startTracing()
+    for (const customFont of fonts) {
+      font.registerFont(customFont)
+    }
+    this.shouldShow = true
+    stopTracing()
+  }
+
+  onBackPress(): boolean | undefined {
+    // NOTE: this is required since `Ability`'s `onBackPressed` function always
+    // terminates or puts the app in the background, but we want Ark to ignore it completely
+    // when handled by RN
+    this.rnohCoreContext!.dispatchBackPress()
+    return true
+  }
+
+  build() {
+    Column() {
+      if (this.rnohCoreContext && this.shouldShow) {
+        if (this.rnohCoreContext?.isDebugModeEnabled) {
+          RNOHErrorDialog({ ctx: this.rnohCoreContext })
+        }
+        RNApp({
+          rnInstanceConfig: {
+            createRNPackages,
+            enableNDKTextMeasuring: true,
+            enableBackgroundExecutor: false,
+            enableCAPIArchitecture: true,
+            arkTsComponentNames: [],
+          },
+          initialProps: { "foo": "bar" } as Record<string, string>,
+          appKey: "app_name",
+          wrappedCustomRNComponentBuilder: wrappedCustomRNComponentBuilder,
+          onSetUp: (rnInstance) => {
+            rnInstance.enableFeatureFlag("ENABLE_RN_INSTANCE_CLEAN_UP")
+          },
+          jsBundleProvider: new TraceJSBundleProviderDecorator(
+            new AnyJSBundleProvider([
+              new MetroJSBundleProvider(),
+              new FileJSBundleProvider(context.filesDir + '/Bundles/' + this.bundlePath),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'bundle.harmony.js')
+            ]),
+            this.rnohCoreContext.logger),
+        })
+      }
+    }
+    .height('100%')
+    .width('100%')
+  }
+}

```

### `example/harmony/entry/src/main/ets/pages/SurfaceDeadlockTest.ets`

```diff
@@ -0,0 +1,135 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+import { RNInstance, JSBundleProvider, RNAbility, RNSurface } from '@rnoh/react-native-openharmony'
+import { CustomComponentBuilder } from "@rnoh/react-native-openharmony/src/main/ets/RNOHCorePackage"
+import { SurfaceConfig2 } from '@rnoh/react-native-openharmony/src/main/ets/RNSurface'
+
+
+@Component
+export struct SurfaceDeadlockTest {
+  public jsBundleProvider: JSBundleProvider | undefined = undefined
+  public appKeys: string[] = []
+  public numberOfIterations: number = 1
+  @BuilderParam public buildCustomComponent!: CustomComponentBuilder
+  // -------------------------------------------------------------------------------------------------------------------
+  @StorageLink('RNAbility') private rnAbility: RNAbility = {} as RNAbility
+  private rnInstance!: RNInstance
+  @State private shouldShow: boolean = false
+  private shouldDestroyRNInstance: boolean = false
+  private cleanUpCallbacks: (() => void)[] = []
+
+  aboutToAppear() {
+    this.getOrCreateRNInstance().then(rnInstance => {
+      this.rnInstance = rnInstance
+      const jsBundleExecutionStatus = this.rnInstance.getBundleExecutionStatus(this.jsBundleProvider?.getURL())
+      if (this.jsBundleProvider && jsBundleExecutionStatus === undefined) {
+        this.rnInstance.runJSBundle(this.jsBundleProvider).then(() => {
+          this.shouldShow = true
+        })
+        return;
+      }
+    }).catch((reason: string | Error) => {
+      if (typeof reason === "string")
+        this.rnAbility.getLogger().error(reason)
+      else if (reason instanceof Error) {
+        this.rnAbility.getLogger().error(reason.message)
+      } else {
+        this.rnAbility.getLogger().error("Fatal exception")
+      }
+    })
+  }
+
+  aboutToDisappear() {
+    if (this.shouldDestroyRNInstance)
+      this.rnAbility.destroyAndUnregisterRNInstance(this.rnInstance)
+    this.cleanUpCallbacks.forEach(cleanUp => cleanUp())
+  }
+
+  private getOrCreateRNInstance(): Promise<RNInstance> {
+    return this.rnAbility.createAndRegisterRNInstance({ createRNPackages: () => [] })
+  }
+
+  build() {
+    Stack() {
+      if (this.shouldShow) {
+        ForEach(this.appKeys, (appKey: string, idx) => {
+          Stack() {
+            Blinker({
+              minDelayInMs: 1000,
+              maxDelayInMs: 2000,
+              blinksCount: this.numberOfIterations,
+              randomnessPrecisionInMs: 500
+            }) {
+              RNSurface({
+                ctx: this.rnAbility.createRNOHContext({ rnInstance: this.rnInstance }),
+                surfaceConfig: {
+                  initialProps: {},
+                  appKey: appKey,
+                } as SurfaceConfig2,
+                buildCustomComponent: this.buildCustomComponent,
+              })
+            }
+          }.height(`${100 / this.appKeys.length}%`)
+          .position({ x: 0, y: `${(idx / this.appKeys.length) * 100}%` })
+        })
+      }
+    }.width("100%")
+    .height("100%")
+  }
+}
+
+
+@Component
+struct Blinker {
+  public minDelayInMs: number = 0
+  public maxDelayInMs: number = 1000
+  public blinksCount: number = 0
+  public randomnessPrecisionInMs: number = 250
+  @BuilderParam public renderChildren: () => void
+  private currentBlinksCount = 0
+  @State private isVisible: boolean = false
+  private timeout: number = 0
+
+  aboutToAppear() {
+    this.blink(this.minDelayInMs)
+  }
+
+  aboutToDisappear() {
+    clearTimeout(this.timeout)
+  }
+
+  private blink(ms: number) {
+    this.isVisible = !this.isVisible
+    this.currentBlinksCount += 1
+    if (this.currentBlinksCount >= this.blinksCount) {
+      if (this.timeout) {
+        clearTimeout(this.timeout)
+      }
+      this.isVisible = true
+      return;
+    }
+    this.timeout = setTimeout(() => {
+      this.blink(this.getNextDelay())
+    }, ms)
+  }
+
+  private getNextDelay(): number {
+    return ((Math.floor(Math.random() * (Number.MAX_VALUE / this.randomnessPrecisionInMs)) * this.randomnessPrecisionInMs) % this.maxDelayInMs) + this.minDelayInMs
+  }
+
+  build() {
+    Stack() {
+      if (this.isVisible) {
+        this.renderChildren()
+      }
+    }
+  }
+}
+
+
+
+
+

```

### `example/harmony/entry/src/main/ets/pages/TouchDisplayer.ets`

```diff
@@ -0,0 +1,44 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+
+@Component
+export struct TouchDisplayer {
+  @State currentTouches: TouchObject[] = []
+  @State touchIndicatorOpacity: number = 0
+  @BuilderParam buildChildren: () => void
+  build() {
+    Stack() {
+      this.buildChildren()
+      ForEach(this.currentTouches, (activeTouch: TouchObject) => {
+        Stack() {
+        }
+        .width(64)
+        .height(64)
+        .backgroundColor("blue")
+        .borderWidth(2)
+        .borderColor("white")
+        .opacity(this.touchIndicatorOpacity)
+        .position({ x: activeTouch.x - 32, y: activeTouch.y - 32 })
+        .borderRadius(1000)
+        .hitTestBehavior(HitTestMode.Transparent)
+      })
+    }
+    .width("100%")
+    .height("100%")
+    .hitTestBehavior(HitTestMode.Transparent)
+    .onTouch(e => {
+      this.currentTouches = e.touches
+      this.touchIndicatorOpacity = 0.5
+      animateTo({
+        duration: 500,
+        curve: Curve.Linear,
+      }, () => {
+        this.touchIndicatorOpacity = 0
+      })
+    })
+  }
+}
\ No newline at end of file

```

### `example/harmony/entry/src/main/module.json5`

```diff
@@ -0,0 +1,52 @@
+{
+  "module": {
+    "name": "entry",
+    "type": "entry",
+    "description": "$string:module_desc",
+    "mainElement": "EntryAbility",
+    "deviceTypes": [
+      "default"
+    ],
+    "querySchemes": [
+      "weixin",
+    ],
+    "deliveryWithInstall": true,
+    "installationFree": false,
+    "pages": "$profile:main_pages",
+    // below property is supported from 5.0.0 - it is needed by bundleManager.canOpenLink to check if the app can open some url
+    // "querySchemes": ["maps", "http", "https", "customDomain"],
+    "requestPermissions": [
+      {
+        "name": "ohos.permission.INTERNET"
+      },
+    ],
+    "metadata": [
+      {
+        "name": "OPTLazyForEach",
+        "value": "true",
+      }
+    ],
+    "abilities": [
+      {
+        "name": "EntryAbility",
+        "srcEntry": "./ets/entryability/EntryAbility.ets",
+        "description": "$string:EntryAbility_desc",
+        "icon": "$media:icon",
+        "label": "$string:EntryAbility_label",
+        "startWindowIcon": "$media:icon",
+        "startWindowBackground": "$color:start_window_background",
+        "visible": true,
+        "skills": [
+          {
+            "entities": [
+              "entity.system.home"
+            ],
+            "actions": [
+              "action.system.home"
+            ]
+          }
+        ]
+      }
+    ]
+  }
+}
\ No newline at end of file

```

### `example/harmony/entry/src/main/resources/.gitignore`

```diff
@@ -0,0 +1 @@
+rawfile/assets

```

### `example/harmony/entry/src/main/resources/base/element/color.json`

```diff
@@ -0,0 +1,8 @@
+{
+  "color": [
+    {
+      "name": "start_window_background",
+      "value": "#FFFFFF"
+    }
+  ]
+}
\ No newline at end of file

```

### `example/harmony/entry/src/main/resources/base/element/string.json`

```diff
@@ -0,0 +1,16 @@
+{
+  "string": [
+    {
+      "name": "module_desc",
+      "value": "module description"
+    },
+    {
+      "name": "EntryAbility_desc",
+      "value": "description"
+    },
+    {
+      "name": "EntryAbility_label",
+      "value": "RN Tester"
+    }
+  ]
+}
\ No newline at end of file

```

### `example/harmony/entry/src/main/resources/base/media/icon.png`

```diff
Binary files no preview for this file type
```

### `example/harmony/entry/src/main/resources/base/profile/main_pages.json`

```diff
@@ -0,0 +1,5 @@
+{
+  "src": [
+    "pages/Index"
+  ]
+}

```

### `example/harmony/entry/src/main/resources/rawfile/1.txt`

```diff
@@ -0,0 +1 @@
+text test
\ No newline at end of file

```

### `example/harmony/format.ps1`

```diff
@@ -0,0 +1,18 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+$directoryPath = Split-Path -Parent $MyInvocation.MyCommand.Path
+$filePaths = Get-ChildItem $directoryPath -Recurse -Include *.h, *.cpp |
+Where-Object {
+  $_.DirectoryName -notmatch 'third-party' -and
+  $_.DirectoryName -notmatch 'patches' -and
+  $_.DirectoryName -notmatch 'node_modules' -and
+  $_.DirectoryName -notmatch '.cxx' -and
+  $_.DirectoryName -notmatch 'build'
+}
+foreach ($filePath in $filePaths) {
+  & "clang-format.exe" -style=file -i $filePath.FullName
+}
\ No newline at end of file

```

### `example/harmony/hvigor/.gitignore`

```diff
@@ -0,0 +1 @@
+*.tgz

```

### `example/harmony/hvigor/hvigor-config.json5`

```diff
@@ -0,0 +1,21 @@
+{
+  "modelVersion": "5.0.0",
+  "dependencies": {
+  },
+  "execution": {
+    // "analyze": "default",                    /* Define the build analyze mode. Value: [ "default" | "verbose" | false ]. Default: "default" */
+    // "daemon": true,                          /* Enable daemon compilation. Value: [ true | false ]. Default: true */
+    // "incremental": true,                     /* Enable incremental compilation. Value: [ true | false ]. Default: true */
+    // "parallel": true,                        /* Enable parallel compilation. Value: [ true | false ]. Default: true */
+    // "typeCheck": false,                      /* Enable typeCheck. Value: [ true | false ]. Default: false */
+  },
+  "logging": {
+    // "level": "info"                          /* Define the log level. Value: [ "debug" | "info" | "warn" | "error" ]. Default: "info" */
+  },
+  "debugging": {
+     "stacktrace": false                      /* Disable stacktrace compilation. Value: [ true | false ]. Default: false */
+  },
+  "nodeOptions": {
+    // "maxOldSpaceSize": 4096                  /* Enable nodeOptions maxOldSpaceSize compilation. Unit M. Used for the daemon process */
+  }
+}
\ No newline at end of file

```

### `example/harmony/hvigorfile.ts`

```diff
@@ -0,0 +1,6 @@
+import { appTasks } from '@ohos/hvigor-ohos-plugin';
+
+export default {
+  system: appTasks, /* Built-in plugin of Hvigor. It cannot be modified. */
+  plugins: []       /* Custom plugin to extend the functionality of Hvigor. */
+}
\ No newline at end of file

```

### `example/harmony/oh-package.json5`

```diff
@@ -0,0 +1,13 @@
+{
+  "modelVersion": "5.0.0",
+  "description": "Please describe the basic information.",
+  "dependencies": {
+  },
+  "devDependencies": {
+    "@ohos/hypium": "1.0.21",
+    "@ohos/hamock": "1.0.0"
+  },
+  "overrides": {
+    '@rnoh/react-native-openharmony': 'file:../node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har'
+  }
+}

```

### `example/index.js`

```diff
@@ -0,0 +1,11 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+import {AppRegistry, View, Text} from 'react-native';
+import {name as appName} from './app.json';
+import OrientationLockerExample from './src/OrientationLockerExample';
+
+AppRegistry.registerComponent(appName, () => OrientationLockerExample);
\ No newline at end of file

```

### `example/jest.config.js`

```diff
@@ -0,0 +1,11 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+/** @type {import('ts-jest').JestConfigWithTsJest} */
+module.exports = {
+  preset: 'ts-jest',
+  testEnvironment: 'node',
+};

```

### `example/metro.config.js`

```diff
@@ -0,0 +1,30 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+const {mergeConfig, getDefaultConfig} = require('@react-native/metro-config');
+const {createHarmonyMetroConfig} = require('@react-native-oh/react-native-harmony/metro.config');
+
+/**
+ * @type {import("metro-config").ConfigT}
+ */
+const config = {
+  transformer: {
+    getTransformOptions: async () => ({
+      transform: {
+        experimentalImportSupport: false,
+        inlineRequires: true,
+      },
+    }),
+  },
+};
+
+module.exports = mergeConfig(
+  getDefaultConfig(__dirname),
+  createHarmonyMetroConfig({
+    reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
+  }),
+  config,
+);

```

### `example/package.json`

```diff
@@ -0,0 +1,61 @@
+{
+  "name": "react-native-harmony-tester",
+  "version": "1.0.0",
+  "private": true,
+  "scripts": {
+    "i": "cd ../ && npm i && npm run pack && cd ./example && npm i",
+    "reStart": "npm run install:pkg && npm run codegen && hdc rport tcp:8081 tcp:8081 && react-native start",
+    "start": "hdc rport tcp:8081 tcp:8081 && react-native start",
+    "codegen": "react-native codegen-harmony --rnoh-module-path ./harmony/entry/oh_modules/@rnoh/react-native-openharmony",
+    "pack:pkg": "cd ../ && npm pack && cd ./example",
+    "install:pkg": "npm uninstall @react-native-ohos/react-native-orientation-locker && npm run pack:pkg && npm i @react-native-ohos/react-native-orientation-locker@file:../react-native-ohos-react-native-orientation-locker-1.8.1-beta.2.tgz",
+    "dev": "npm run codegen && react-native bundle-harmony --dev --minify=false",
+    "prod": "npm run codegen && react-native bundle-harmony --dev=false --minify=true",
+    "postinstall": "node ./scripts/create-build-profile",
+    "fast:pkg": "cd ../ && npm i --legacy-peer-deps && npm pack && cd ./example && npm i && npm run dev"
+  },
+  "dependencies": {
+    "@gorhom/portal": "^1.0.14",
+    "@react-native-ohos/react-native-orientation-locker": "file:../react-native-ohos-react-native-orientation-locker-1.8.1-beta.2.tgz",
+    "react": "18.3.1",
+    "react-native": "0.77.1",
+    "@react-native-oh/react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.77.18-1",
+    "react-native-reanimated": "^3.6.0",
+    "@rnoh/testerino": "file:./rnoh-testerino-0.0.12.tgz"
+  },
+  "devDependencies": {
+    "@babel/core": "^7.25.2",
+    "@babel/preset-env": "^7.25.3",
+    "@babel/runtime": "^7.25.0",
+    "@react-native-community/cli": "15.0.1",
+    "@react-native-community/cli-platform-android": "15.0.1",
+    "@react-native-community/cli-platform-ios": "15.0.1",
+    "@react-native-community/eslint-config": "^3.2.0",
+    "@react-native/babel-preset": "0.77.1",
+    "@react-native/eslint-config": "0.77.1",
+    "@react-native/metro-config": "^0.77.1",
+    "@react-native/typescript-config": "0.77.1",
+    "@rnoh/react-native-harmony-cli": "npm:@react-native-oh/react-native-harmony-cli@0.77.18",
+    "@tsconfig/react-native": "^3.0.0",
+    "@types/d3-scale-chromatic": "^3.0.0",
+    "@types/jest": "^29.5.13",
+    "@types/react": "^18.2.6",
+    "@types/react-test-renderer": "^18.0.0",
+    "babel-jest": "^29.6.3",
+    "eslint": "^8.19.0",
+    "jest": "^29.7.0",
+    "metro-react-native-babel-preset": "0.76.8",
+    "prettier": "2.8.8",
+    "react-test-renderer": "18.3.1",
+    "typescript": "5.5.4"
+  },
+  "overrides": {
+    "@react-native-community/cli": "15.0.1"
+  },
+ "resolutions": {
+    "@react-native-community/cli": "15.0.1"
+ },
+ "engines": {
+    "node": ">=18"
+ }
+}

```

### `example/react-native.config.js`

```diff
@@ -0,0 +1,11 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+module.exports = {
+  project: {
+  },
+  assets: ['./assets/fonts/'],
+};

```

### `example/rnoh-testerino-0.0.12.tgz`

```diff
Binary files no preview for this file type
```

### `example/scripts/create-build-profile.js`

```diff
@@ -0,0 +1,46 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
+ * Use of this source code is governed by a MIT license that can be
+ * found in the LICENSE file.
+ */
+
+
+const fs = require('fs');
+const JSON5 = require('json5');
+const path = require('path');
+
+const templatePath = path.join(
+  __dirname,
+  '..',
+  'harmony',
+  'build-profile.template.json5',
+);
+const existingProfilePath = path.join(
+  __dirname,
+  '..',
+  'harmony',
+  'build-profile.json5',
+);
+
+if (fs.existsSync(existingProfilePath)) {
+  let existingProfile = JSON5.parse(
+    fs.readFileSync(existingProfilePath, 'utf-8'),
+  );
+  let template = JSON5.parse(fs.readFileSync(templatePath, 'utf-8'));
+  let signingConfigs =
+    existingProfile.app && existingProfile.app.signingConfigs;
+
+  existingProfile = {...template};
+
+  if (signingConfigs) {
+    existingProfile.app.signingConfigs = signingConfigs;
+  }
+
+  fs.writeFileSync(
+    existingProfilePath,
+    JSON5.stringify(existingProfile, null, 2),
+  );
+} else {
+  // File doesn't exist, create a copy from the template
+  fs.copyFileSync(templatePath, existingProfilePath);
+}
\ No newline at end of file

```

### `example/src/OrientationLockerExample.tsx`

```diff
@@ -0,0 +1,510 @@
+import Orientation, {
+    useOrientationChange,
+    useDeviceOrientationChange,
+    useLockListener,
+    OrientationLocker,
+    UNLOCK,
+    PORTRAIT,
+    LANDSCAPE,
+    LANDSCAPE_LEFT,
+    LANDSCAPE_RIGHT,
+    PORTRAIT_UPSIDE_DOWN,
+    ALL_ORIENTATIONS_BUT_UPSIDE_DOWN,
+} from 'react-native-orientation-locker';
+import {
+    StyleSheet,
+    Text,
+    TouchableOpacity,
+    ScrollView,
+    View,
+    Alert,
+} from 'react-native';
+import { useEffect, useState, useCallback } from 'react';
+import { Tester, TestSuite, TestCase } from '@rnoh/testerino';
+
+export default function OrientationLockerExample() {
+    const [orientation, setOrientation] = useState<string>('PORTRAIT');
+    const updateOrientation = useCallback((orientation: string) => {
+        setOrientation(orientation);
+    }, []);
+    const [LockListener, setLockListener] = useState<string>();
+    const [isLockedState, setIsLockedState] = useState<string>();
+    const [initialOrientation, setInitialOrientation] = useState<string>();
+    const [autoRotateState, setAutoRotateState] = useState<string>();
+    const [hookOrientation, setHookOrientation] = useState<string>('PORTRAIT');
+    const [hookDeviceOrientation, setHookDeviceOrientation] = useState<string>('PORTRAIT');
+    const [hookLockState, setHookLockState] = useState<string>('未触发');
+    const [lockerOrientation, setLockerOrientation] = useState<string>();
+    const [lockerDeviceOrientation, setLockerDeviceOrientation] = useState<string>();
+    const [lockerSelectValue, setLockerSelectValue] = useState<string>(PORTRAIT);
+    const [configureState, setConfigureState] = useState<string>('disableFaceUpDown: false（已启用）');
+    const [deviceOrientation, setDeviceOrientation] = useState<string>();
+
+    const updateDeviceOrientation = useCallback((orientation: string) => {
+        setDeviceOrientation(orientation);
+    }, []);
+
+    useEffect(() => {
+        return () => {
+            // 退出应用销毁监听
+            unbindAllListeners();
+        };
+    }, []);
+
+    const setLockToPortrait = () => {
+        Orientation.lockToPortrait();
+    };
+    const setLockToLandscape = () => {
+        Orientation.lockToLandscape();
+    };
+    const setLockToLandscapeLeft = () => {
+        Orientation.lockToLandscapeLeft();
+    };
+    const setLockToLandscapeRight = () => {
+        Orientation.lockToLandscapeRight();
+    };
+    const unlockAllOrientations = () => {
+        Orientation.unlockAllOrientations();
+    };
+    const lockToPortraitUpsideDown = () => {
+        Orientation.lockToPortraitUpsideDown();
+    };
+    const lockToAllOrientationsButUpsideDown = () => {
+        Orientation.lockToAllOrientationsButUpsideDown();
+    };
+    const bindDeviceOrientationListener = () => {
+        Orientation.removeDeviceOrientationListener(updateDeviceOrientation);
+        Orientation.addDeviceOrientationListener(updateDeviceOrientation);
+    };
+    const unbindDeviceOrientationListener = () => {
+        Orientation.removeDeviceOrientationListener(updateDeviceOrientation);
+    };
+    const bindOrientationListener = () => {
+        Orientation.removeOrientationListener(updateOrientation);
+        Orientation.addOrientationListener(updateOrientation);
+    };
+    const unbindOrientationListener = () => {
+        Orientation.removeOrientationListener(updateOrientation);
+    };
+
+    const lockDidChange = useCallback((o: string) => {
+        setLockListener(`屏幕锁定状态变化: ${o}`);
+    }, []);
+    const bindLockListener = () => {
+        Orientation.removeLockListener(lockDidChange);
+        Orientation.addLockListener(lockDidChange);
+    };
+
+    const unbindLockListener = () => {
+        Orientation.removeLockListener(lockDidChange);
+    };
+    const unbindAllListeners = () => {
+        Orientation.removeAllListeners();
+    };
+
+    const checkIsLocked = () => {
+        const locked = Orientation.isLocked();
+        setIsLockedState(locked ? '已锁定' : '未锁定');
+    };
+
+    const checkInitialOrientation = () => {
+        const initial = Orientation.getInitialOrientation();
+        setInitialOrientation(initial);
+    };
+
+    const checkAutoRotateState = () => {
+        Orientation.getAutoRotateState((state: boolean) => {
+            setAutoRotateState(state ? '已开启' : '已关闭');
+        });
+    };
+
+    const configureSetting = (value: boolean) => {
+        Orientation.configure({ disableFaceUpDown: value });
+        setConfigureState(value ? 'disableFaceUpDown: true（已禁用）' : 'disableFaceUpDown: false（已启用）');
+    };
+
+    // Hooks
+    useOrientationChange((o: string) => {
+        setHookOrientation(o);
+    });
+
+    useDeviceOrientationChange((o: string) => {
+        setHookDeviceOrientation(o);
+    });
+
+    useLockListener((o: string) => {
+        setHookLockState(o);
+        Alert.alert('锁定方向变化', `当前锁定方向: ${o}`);
+    });
+
+
+
+    return (
+        <Tester>
+            <ScrollView style={{ marginBottom: 50 }}>
+                <TestSuite name="orientation">
+                    <TestCase tags={['C_API']} itShould='当前设备方向为:'>
+                        <Text style={styles.textContent}>{deviceOrientation}</Text>
+                    </TestCase>
+                    <TestCase tags={['C_API']} itShould='当前屏幕方向为:'>
+                        <Text style={styles.textContent}>{orientation}</Text>
+                    </TestCase>
+                    <TestCase tags={['C_API']} itShould='当前屏幕锁定状态为:'>
+                        <Text style={styles.textContent}>{LockListener}</Text>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='监听测试：添加设备方向监听 (DeviceOrientation)'>
+                        <TouchableOpacity onPress={bindDeviceOrientationListener}>
+                            <Text>点击绑定 DeviceOrientation 监听</Text>
+                        </TouchableOpacity>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='监听测试：移除设备方向监听 (DeviceOrientation)'>
+                        <TouchableOpacity onPress={unbindDeviceOrientationListener}>
+                            <Text>点击解绑 DeviceOrientation 监听</Text>
+                        </TouchableOpacity>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='监听测试：添加屏幕/UI方向监听 (Orientation)'>
+                        <TouchableOpacity onPress={bindOrientationListener}>
+                            <Text>点击绑定 Orientation 监听</Text>
+                        </TouchableOpacity>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='监听测试：移除屏幕/UI方向监听 (Orientation)'>
+                        <TouchableOpacity onPress={unbindOrientationListener}>
+                            <Text>点击解绑 Orientation 监听</Text>
+                        </TouchableOpacity>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='监听测试：添加锁定状态监听 (LockListener)'>
+                        <TouchableOpacity onPress={bindLockListener}>
+                            <Text>点击绑定 LockListener 监听</Text>
+                        </TouchableOpacity>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='监听测试：移除锁定状态监听 (LockListener)'>
+                        <TouchableOpacity onPress={unbindLockListener}>
+                            <Text>点击解绑 LockListener 监听</Text>
+                        </TouchableOpacity>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='销毁当前组件挂载的全部监听 (removeAllListeners)'>
+                        <TouchableOpacity onPress={unbindAllListeners}>
+                            <Text>点击全部解绑</Text>
+                        </TouchableOpacity>
+                        <Text style={styles.noteText}>注：退出应用时会自动调用，手动调用会解绑所有手动 bind 和 Hooks 挂载的底层监听</Text>
+                    </TestCase>
+
+                    <TestCase
+                        itShould="锁定当前屏幕上下翻转"
+                        tags={['C_API']}
+                        initialState={{}}
+                        arrange={({ setState }) => {
+                            return (
+                                <TouchableOpacity
+                                    onPress={() => {
+                                        lockToPortraitUpsideDown();
+                                        const time = setTimeout(() => {
+                                            Orientation.getOrientation(
+                                                (orientation: string, err: string) => {
+                                                    if (orientation) {
+                                                        setState(orientation);
+                                                    } else {
+                                                        console.log("当前屏幕上下翻转");
+                                                    }
+                                                },
+                                            );
+                                        }, 50);
+                                    }}
+                                    style={styles.button}>
+                                    <Text>锁定当前屏幕为上下翻转</Text>
+                                </TouchableOpacity>
+                            );
+                        }}
+                        assert={({ expect, state }) => {
+                            expect(state).equal('PORTRAIT-UPSIDEDOWN');
+                        }}></TestCase>
+
+                    <TestCase
+                        itShould="锁定当前屏幕为竖屏"
+                        tags={['C_API']}
+                        initialState={{}}
+                        arrange={({ setState }) => {
+                            return (
+                                <TouchableOpacity
+                                    onPress={() => {
+                                        setLockToPortrait();
+                                        const time = setTimeout(() => {
+                                            Orientation.getOrientation(
+                                                (orientation: string, err: string) => {
+                                                    if (orientation) {
+                                                        setState(orientation);
+                                                    } else {
+                                                        console.log("当前屏幕为竖屏");
+                                                    }
+                                                },
+                                            );
+                                        }, 50);
+                                    }}
+                                    style={styles.button}>
+                                    <Text>锁定当前屏幕为竖屏</Text>
+                                </TouchableOpacity>
+                            );
+                        }}
+                        assert={({ expect, state }) => {
+                            expect(state).equal('PORTRAIT');
+                        }}></TestCase>
+
+                    <TestCase
+                        itShould="锁定当前屏幕为横屏"
+                        tags={['C_API']}
+                        initialState={{}}
+                        arrange={({ setState }) => {
+                            return (
+                                <TouchableOpacity
+                                    onPress={() => {
+                                        setLockToLandscape();
+                                        const time = setTimeout(() => {
+                                            Orientation.getOrientation(
+                                                (orientation: string, err: string) => {
+                                                    if (orientation) {
+                                                        setState(orientation);
+                                                    } else {
+                                                        console.log("当前屏幕为横屏");
+                                                    }
+                                                },
+                                            );
+                                        }, 50);
+                                    }}
+                                    style={styles.button}>
+                                    <Text>锁定当前屏幕为横屏</Text>
+                                </TouchableOpacity>
+                            );
+                        }}
+                        assert={({ expect, state }) => {
+                            expect(state).equal('LANDSCAPE-LEFT'); // lockToLandscape() 默认锁定到左横屏
+                        }}></TestCase>
+                    <TestCase
+                        itShould="锁定当前屏幕为横屏，右旋转"
+                        tags={['C_API']}
+                        initialState={{}}
+                        arrange={({ setState }) => {
+                            return (
+                                <TouchableOpacity
+                                    onPress={() => {
+                                        setLockToLandscapeLeft();
+                                        const time = setTimeout(() => {
+                                            Orientation.getOrientation(
+                                                (orientation: string, err: string) => {
+                                                    if (orientation) {
+                                                        setState(orientation);
+                                                    } else {
+                                                        console.log("当前屏幕横屏，右旋转");
+                                                    }
+                                                },
+                                            );
+                                        }, 50);
+                                    }}
+                                    style={styles.button}>
+                                    <Text>锁定当前屏幕为横屏，右旋转</Text>
+                                </TouchableOpacity>
+                            );
+                        }}
+                        assert={({ expect, state }) => {
+                            expect(state).equal('LANDSCAPE-LEFT');
+                        }}></TestCase>
+                    <TestCase
+                        itShould="锁定当前屏幕为横屏，左旋转"
+                        tags={['C_API']}
+                        initialState={{}}
+                        arrange={({ setState }) => {
+                            return (
+                                <TouchableOpacity
+                                    onPress={() => {
+                                        setLockToLandscapeRight();
+                                        const time = setTimeout(() => {
+                                            Orientation.getOrientation(
+                                                (orientation: string, err: string) => {
+                                                    if (orientation) {
+                                                        setState(orientation);
+                                                    } else {
+                                                        console.log("当前屏幕横屏，左旋转");
+                                                    }
+                                                },
+                                            );
+                                        }, 50);
+                                    }}
+                                    style={styles.button}>
+                                    <Text>锁定当前屏幕为横屏，左旋转</Text>
+                                </TouchableOpacity>
+                            );
+                        }}
+                        assert={({ expect, state }) => {
+                            expect(state).equal('LANDSCAPE-RIGHT');
+                        }}></TestCase>
+                    <TestCase
+                        itShould="锁定除了上下翻转的所有方向"
+                        tags={['C_API']}
+                        initialState={{}}
+                        arrange={({ setState }) => {
+                            return (
+                                <TouchableOpacity
+                                    onPress={() => {
+                                        lockToAllOrientationsButUpsideDown();
+                                        const time = setTimeout(() => {
+                                            Orientation.getOrientation(
+                                                (orientation: string, err: string) => {
+                                                    if (orientation) {
+                                                        setState(orientation);
+                                                    } else {
+                                                        console.log("锁定除了上下翻转的所有方向");
+                                                    }
+                                                },
+                                            );
+                                        }, 50);
+                                    }}
+                                    style={styles.button}>
+                                    <Text>锁定除了上下翻转的所有方向</Text>
+                                </TouchableOpacity>
+                            );
+                        }}
+                        assert={({ expect, state }) => {
+                            expect(state).to.be.a('string');
+                        }}></TestCase>
+
+                    <TestCase tags={['C_API']} itShould='解锁当前屏幕旋转锁定'>
+                        <TouchableOpacity onPress={() => {
+                            unlockAllOrientations();
+                        }}>
+                            <Text>解锁当前屏幕旋转锁定</Text>
+                        </TouchableOpacity>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='isLocked:查看当前是否处于锁定状态'>
+                        <TouchableOpacity onPress={() => {
+                            checkIsLocked();
+                        }}>
+                            <Text>点击此处查看锁定状态</Text>
+                        </TouchableOpacity>
+                        <Text style={styles.textContent}>{isLockedState}</Text>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='getInitialOrientation:获取应用初始方向'>
+                        <TouchableOpacity onPress={() => {
+                            checkInitialOrientation();
+                        }}>
+                            <Text>点击此处获取初始方向</Text>
+                        </TouchableOpacity>
+                        <Text style={styles.textContent}>{initialOrientation}</Text>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='getAutoRotateState:获取系统自动旋转状态'>
+                        <TouchableOpacity onPress={() => {
+                            checkAutoRotateState();
+                        }}>
+                            <Text>点击此处获取自动旋转状态</Text>
+                        </TouchableOpacity>
+                        <Text style={styles.textContent}>{autoRotateState}</Text>
+                        <Text style={styles.noteText}>注: 读取系统自动旋转开关，开启返回"已开启"，关闭返回"已关闭"</Text>
+                    </TestCase>
+
+                    <TestCase tags={['C_API']} itShould='configure:配置disableFaceUpDown选项'>
+                        <Text style={styles.textContent}>当前状态: {configureState}</Text>
+                        <TouchableOpacity onPress={() => {
+                            configureSetting(true);
+                        }}>
+                            <Text>configure(disableFaceUpDown: true) - 禁用FACE-UP/DOWN</Text>
+                        </TouchableOpacity>
+                        <TouchableOpacity onPress={() => {
+                            configureSetting(false);
+                        }} style={{ marginTop: 8 }}>
+                       
... [diff 已截断]
```

### `example/tsconfig.json`

```diff
@@ -0,0 +1,14 @@
+{
+  "extends": "@react-native/typescript-config/tsconfig.json",
+  "compilerOptions": {
+    "jsx": "react-native",
+    "paths": {
+      "react-native": [
+        "./node_modules/react-native-harmony"
+      ],
+    },
+  },
+  "exclude": [
+    "harmony"
+  ]
+}
\ No newline at end of file

```

### `harmony/orientation_locker/src/main/cpp/generated/RNOH/generated/turbo_modules/OreitationLockerNativeModule.cpp`

```diff
@@ -21,6 +21,8 @@ OreitationLockerNativeModule::OreitationLockerNativeModule(const ArkTSTurboModul
         ARK_METHOD_METADATA(getDeviceOrientation, 1),
         ARK_METHOD_METADATA(getAutoRotateState, 1),
         ARK_METHOD_METADATA(configure, 1),
+        ARK_METHOD_METADATA(openSensor, 0),
+        ARK_METHOD_METADATA(closeSensor, 0),
     };
 }
 

```

### `harmony/orientation_locker/src/main/ets/Logger.ts`

```diff
@@ -0,0 +1,64 @@
+/*
+ * MIT License
+ *
+ * Copyright (C) 2026 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
+ */
+
+import hilog from '@ohos.hilog';
+
+class Logger {
+  private domain: number;
+  private prefix: string;
+  private format: string = '%{public}s, %{public}s';
+  private isDebug: boolean;
+
+  /**
+   * constructor.
+   *
+   * @param Prefix Identifies the log tag.
+   * @param domain Domain Indicates the service domain, which is a hexadecimal integer ranging from 0x0 to 0xFFFFF.
+   */
+  constructor(prefix: string = 'MyApp', domain: number = 0xFF00, isDebug = false) {
+    this.prefix = prefix;
+    this.domain = domain;
+    this.isDebug = isDebug;
+  }
+
+  debug(...args: string[]): void {
+    if (this.isDebug) {
+      hilog.debug(this.domain, this.prefix, this.format, args);
+    }
+  }
+
+  info(...args: string[]): void {
+    hilog.info(this.domain, this.prefix, this.format, args);
+  }
+
+  warn(...args: string[]): void {
+    hilog.warn(this.domain, this.prefix, this.format, args);
+  }
+
+  error(...args: string[]): void {
+    hilog.error(this.domain, this.prefix, this.format, args);
+  }
+}
+
+export default new Logger('orientationLocker', 0xFF00, false)
\ No newline at end of file

```

### `harmony/orientation_locker/src/main/ets/RNOrientationLockerTurboModule.ts`

```diff
@@ -11,7 +11,7 @@ import display from '@ohos.display'
 import { BusinessError } from '@kit.BasicServicesKit'
 import sensor from '@ohos.sensor';
 import settings from '@ohos.settings';
-
+import Logger from './Logger'
 const ORIENTATION_UNKNOWN = -1;
 
 export class RNOrientationLockerTurboModule extends TurboModule implements TM.OreitationLockerNativeModule.Spec {
@@ -30,51 +30,72 @@ export class RNOrientationLockerTurboModule extends TurboModule implements TM.Or
         ctx.rnInstance.emitDeviceEvent('orientationDidChange', { orientation: displayValueString })
       }
     })
+  }
 
-    sensor.on(sensor.SensorId.ACCELEROMETER, (data: sensor.AccelerometerResponse) => {
-      const X = -data.x;
-      const Y = -data.y;
-      const Z = -data.z;
-      const xyMagnitude = X * X + Y * Y;
-      const zSquared = Z * Z;
-      let orientation = ORIENTATION_UNKNOWN;
-      if (xyMagnitude * 4 >= zSquared) {
-        const angleRad = Math.atan2(-Y, X);
-        let angleDeg = 90 - (angleRad * 180 / Math.PI);
-        while (angleDeg >= 360) angleDeg -= 360;
-        while (angleDeg < 0) angleDeg += 360;
-        orientation = Math.round(angleDeg);
-      }
+  openSensor() {
+    try {
+      sensor.on(sensor.SensorId.ACCELEROMETER, (data: sensor.AccelerometerResponse) => {
+        const X = -data.x;
+        const Y = -data.y;
+        const Z = -data.z;
+        const xyMagnitude = X * X + Y * Y;
+        const zSquared = Z * Z;
+        let orientation = ORIENTATION_UNKNOWN;
+        if (xyMagnitude * 4 >= zSquared) {
+          const angleRad = Math.atan2(-Y, X);
+          let angleDeg = 90 - (angleRad * 180 / Math.PI);
+          while (angleDeg >= 360) {
+            angleDeg -= 360;
+          }
+          while (angleDeg < 0) {
+            angleDeg += 360;
+          }
+          orientation = Math.round(angleDeg);
+        }
 
-      let deviceOrientationValue:string = this.lastDeviceSensorOrientationValue;
-      if (xyMagnitude * 4 < zSquared) {
- 	      // Z 轴主导，设备平放
- 	      // 注意：Z = -data.z，取反后正负颠倒
- 	      // data.z > 0（屏幕朝上）→ Z < 0 → FACE-UP
- 	      // data.z < 0（屏幕朝下）→ Z > 0 → FACE-DOWN
- 	      if (!this.disableFaceUpDown) {
- 	        if (Z < 0) {
- 	          deviceOrientationValue = "FACE-UP";
- 	        } else {
- 	          deviceOrientationValue = "FACE-DOWN";
- 	        }
- 	      }
- 	    } else if (orientation === ORIENTATION_UNKNOWN) {
-        deviceOrientationValue = "UNKNOWN";
-      } else if (orientation > 355 || orientation < 5) {
-        deviceOrientationValue = "PORTRAIT";
-      } else if (orientation > 85 && orientation < 95) {
-        deviceOrientationValue = "LANDSCAPE-RIGHT";
-      } else if (orientation > 175 && orientation < 185) {
-        deviceOrientationValue = "PORTRAIT-UPSIDEDOWN";
-      } else if (orientation > 265 && orientation < 275) {
-        deviceOrientationValue = "LANDSCAPE-LEFT";
-      }
-      if (this.lastDeviceSensorOrientationValue !== deviceOrientationValue) {
-        ctx.rnInstance.emitDeviceEvent('deviceOrientationDidChange', { deviceOrientation: deviceOrientationValue })
-        this.lastDeviceSensorOrientationValue = deviceOrientationValue;
-      }
-    }, { interval: 100000000 });
+        let deviceOrientationValue: string = this.lastDeviceSensorOrientationValue;
+        if (xyMagnitude * 4 < zSquared) {
+          // Z 轴主导，设备平放
+          // 注意：Z = -data.z，取反后正负颠倒
+          // data.z > 0（屏幕朝上）→ Z < 0 → FACE-UP
+          // data.z < 0（屏幕朝下）→ Z > 0 → FACE-DOWN
+          if (!this.disableFaceUpDown) {
+            if (Z < 0) {
+              deviceOrientationValue = "FACE-UP";
+            } else {
+              deviceOrientationValue = "FACE-DOWN";
+            }
+          }
+        } else if (orientation === ORIENTATION_UNKNOWN) {
+          deviceOrientationValue = "UNKNOWN";
+        } else if (orientation > 355 || orientation < 5) {
+          deviceOrientationValue = "PORTRAIT";
+        } else if (orientation > 85 && orientation < 95) {
+          deviceOrientationValue = "LANDSCAPE-RIGHT";
+        } else if (orientation > 175 && orientation < 185) {
+          deviceOrientationValue = "PORTRAIT-UPSIDEDOWN";
+        } else if (orientation > 265 && orientation < 275) {
+          deviceOrientationValue = "LANDSCAPE-LEFT";
+        }
+        if (this.lastDeviceSensorOrientationValue !== deviceOrientationValue) {
+          this.ctx.rnInstance.emitDeviceEvent('deviceOrientationDidChange',
+            { deviceOrientation: deviceOrientationValue })
+          this.lastDeviceSensorOrientationValue = deviceOrientationValue;
+        }
+      }, { interval: 100000000 });
+    } catch (err) {
+      let e: BusinessError = err as BusinessError;
+      Logger.error(`Failed sensor.on error. Code: ${e.code}, message: ${e.message}`);
+    }
+  }
+
+  closeSensor() {
+    try {
+      sensor.off(sensor.SensorId.ACCELEROMETER);
+    } catch (err) {
+      let e: BusinessError = err as BusinessError;
+      Logger.error(`Failed sensor.off error. Code: ${e.code}, message: ${e.message}`);
+    }
   }
 
   private windowClass: window.Window | undefined = undefined
@@ -230,9 +251,15 @@ export class RNOrientationLockerTurboModule extends TurboModule implements TM.Or
     }
   }
 
-   __onDestroy__(): void {
-      super.__onDestroy__()
-      display.off('change')
-      sensor.off(sensor.SensorId.ACCELEROMETER)
+  __onDestroy__(): void {
+    super.__onDestroy__()
+    display.off('change')
+    try {
+      this.closeSensor();
+    } catch (error) {
+      let e: BusinessError = error as BusinessError;
+      Logger.error(`Failed to closeSensor. Code: ${e.code}, message: ${e.message}`);
+    }
+
   }
 }
\ No newline at end of file

```

### `harmony/orientation_locker/src/main/ets/generated/turboModules/OreitationLockerNativeModule.ts`

```diff
@@ -31,5 +31,9 @@ export namespace OreitationLockerNativeModule {
     getAutoRotateState(callback: (state: boolean) => void): void;
 
     configure(options: Object): void;
+
+    openSensor(): void;
+
+    closeSensor(): void;
   }
 }

```

### `package.json`

```diff
@@ -3,12 +3,12 @@
     "version": "1.8.1-beta.2",
     "summary": "A react-native module that can listen on orientation changing of device",
     "description": "A react-native module that can listen on orientation changing of device, get current orientation, lock to preferred orientation.",
-    "homepage": "https://gitcode.com/openharmony-sig/rntpc_react-native-orientation-locker",
+    "homepage": "https://gitcode.com/CPF-RN/rntpc_react-native-orientation-locker",
     "main": "index.js",
     "types": "index.d.ts",
     "repository": {
         "type": "git",
-        "url": "https://gitcode.com/openharmony-sig/rntpc_react-native-orientation-locker"
+        "url": "https://gitcode.com/CPF-RN/rntpc_react-native-orientation-locker"
     },
     "scripts": {
         "codegen-lib": "react-native codegen-lib-harmony --no-safety-check --npm-package-name react-native-orientation-locker --cpp-output-path ./harmony/orientation_locker/src/main/cpp/generated --ets-output-path ./harmony/orientation_locker/src/main/ets/generated --turbo-modules-spec-paths ./src/OreitationLockerNativeModule.ts"
@@ -28,7 +28,7 @@
     },
     "license": "MIT",
     "bugs": {
-        "url": "https://gitcode.com/openharmony-sig/rntpc_react-native-orientation-locker/issues"
+        "url": "https://gitcode.com/CPF-RN/rntpc_react-native-orientation-locker/issues"
     },
     "dependencies": {},
     "peerDependencies": {

```

### `src/OreitationLockerNativeModule.ts`

```diff
@@ -39,6 +39,11 @@ export interface Spec extends TurboModule {
    // 配置选项
    configure(options: Object): void;
 
+   // 订阅加速度传感器
+   openSensor(): void;
+
+   // 取消订阅加速度传感器
+   closeSensor(): void;
 }
 export default TurboModuleRegistry.get<Spec>('OreitationLockerNativeModule') as Spec | null;
 

```

### `src/orientation.harmony.js`

```diff
@@ -115,6 +115,7 @@ export default class Orientation {
   };
 
   static addDeviceOrientationListener = cb => {
+    OrientationNative.openSensor();
     var key = getKey(cb);
     listeners[key] = deviceEventEmitter.addListener(
       "deviceOrientationDidChange",
@@ -135,6 +136,7 @@ export default class Orientation {
     }
     listeners[key].remove();
     listeners[key] = null;
+    OrientationNative.closeSensor();
   };
 
   static addLockListener = cb => {

```

### `src/orientation.js`

```diff
@@ -46,6 +46,10 @@ export default class Orientation {
 
   static removeDeviceOrientationListener = cb => {};
 
+  static openSensor = () => {};
+
+  static closeSensor = () => {};
+
   static addLockListener = cb => {};
 
   static removeLockListener = cb => {};

```
