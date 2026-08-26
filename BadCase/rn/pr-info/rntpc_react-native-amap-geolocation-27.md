# PR #27: feat(77):实现onLocationError功能

- **状态**: merged
- **作者**: a1461848339
- **创建时间**: 2026-07-04T09:26:06+08:00
- **分支**: 77code → br_rnoh0.77
- **变更文件数**: 48

## PR 描述

feat(77):实现onLocationError功能

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `CHANGELOG.md` | ? | +4 | -1 |
| `OAT.xml` | ? | +6 | -1 |
| `example/.eslintrc` | added | +13 | -0 |
| `example/.gitignore` | added | +43 | -0 |
| `example/.node-version` | added | +1 | -0 |
| `example/.prettierrc.js` | added | +7 | -0 |
| `example/.watchmanconfig` | added | +1 | -0 |
| `example/app.json` | added | +4 | -0 |
| `example/babel.config.js` | added | +5 | -0 |
| `example/contexts.ts` | added | +3 | -0 |
| `example/harmony/.gitignore` | added | +17 | -0 |
| `example/harmony/AppScope/app.json5` | added | +10 | -0 |
| `example/harmony/AppScope/resources/base/element/string.json` | added | +8 | -0 |
| `example/harmony/build-profile.template.json5` | added | +45 | -0 |
| `example/harmony/codelinter.json` | added | +1 | -0 |
| `example/harmony/entry/.gitignore` | added | +7 | -0 |
| `example/harmony/entry/build-profile.json5` | added | +22 | -0 |
| `example/harmony/entry/hvigorfile.ts` | added | +1 | -0 |
| `example/harmony/entry/oh-package.json5` | added | +11 | -0 |
| `example/harmony/entry/src/main/cpp/.gitignore` | added | +2 | -0 |
| `example/harmony/entry/src/main/cpp/CMakeLists.txt` | added | +35 | -0 |
| `example/harmony/entry/src/main/cpp/PackageProvider.cpp` | added | +11 | -0 |
| `example/harmony/entry/src/main/ets/RNPackagesFactory.ets` | added | +8 | -0 |
| `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets` | added | +8 | -0 |
| `example/harmony/entry/src/main/ets/pages/Index.ets` | added | +67 | -0 |
| `example/harmony/entry/src/main/ets/pages/TouchDisplayer.ets` | added | +37 | -0 |
| `example/harmony/entry/src/main/module.json5` | added | +67 | -0 |
| `example/harmony/entry/src/main/resources/base/element/color.json` | added | +8 | -0 |
| `example/harmony/entry/src/main/resources/base/element/string.json` | added | +20 | -0 |
| `example/harmony/entry/src/main/resources/base/profile/main_pages.json` | added | +5 | -0 |
| `example/harmony/entry/src/main/resources/rawfile/1.txt` | added | +0 | -0 |
| `example/harmony/hvigor/.gitignore` | added | +1 | -0 |
| `example/harmony/hvigor/hvigor-config.json5` | added | +14 | -0 |
| `example/harmony/hvigorfile.ts` | added | +1 | -0 |
| `example/harmony/oh-package.json5` | added | +12 | -0 |
| `example/index.js` | added | +5 | -0 |
| `example/jest.config.js` | added | +5 | -0 |
| `example/metro.config.js` | added | +21 | -0 |
| `example/package.json` | added | +59 | -0 |
| `example/react-native.config.js` | added | +3 | -0 |
| `example/scripts/create-build-profile.js` | added | +38 | -0 |
| `example/src/index.tsx` | added | +59 | -0 |
| `example/tsconfig.json` | added | +14 | -0 |
| `harmony/amap_geolocation.har` | ? | +0 | -0 |
| `harmony/amap_geolocation/oh-package.json5` | ? | +1 | -1 |
| `harmony/amap_geolocation/src/main/ets/AMapGeolocationModule.ts` | ? | +4 | -0 |
| `package.json` | ? | +1 | -1 |
| `readme.md` | ? | +2 | -2 |

## Diff

### `CHANGELOG.md`

```diff
@@ -1,5 +1,8 @@
-# v1.2.4-rc.1
+
+
 ## ReleaseLog
+### v1.3.1-rc.1
+- feat: 实现onLocationError功能
 ### v1.3.0
 - release version 1.3.0
 

```

### `OAT.xml`

```diff
@@ -4,6 +4,8 @@
         <licensefile>LICENSE</licensefile>
         <filefilterlist>
             <filefilter name="copyrightPolicyFilter" desc="Filters for compatibility，license header policies">
+                <filteritem type="filepath" name="example/.*" desc="generated example project, no copyright header required"/>
+                <filteritem type="filepath" name="buildEnv.sh" desc="generated example build environment script, no copyright header required"/>
                 <filteritem type="filename" name="hvigorfile.ts" desc="hvigor构建脚本，DevEco Studio自动生成，不需要添加版权头"/>
                 <filteritem type="filename" name="*.json5" desc="hvigor工程配置文件，DevEco Studio自动生成，不需要添加版权头"/>
                 <filteritem type="filename" name="*.proto" desc="资源文件，不需要添加版权头"/>
@@ -14,6 +16,8 @@
                 <filteritem type="filename" name="LICENSE" desc="工程文件，不修改版权头"/>
             </filefilter>
             <filefilter name="defaultPolicyFilter" desc="Filters for compatibility，license header policies">
+                <filteritem type="filepath" name="example/.*" desc="generated example project, no license header required"/>
+                <filteritem type="filepath" name="buildEnv.sh" desc="generated example build environment script, no license header required"/>
                 <filteritem type="filename" name="hvigorfile.ts" desc="hvigor构建脚本，DevEco Studio自动生成，不需要添加许可证头"/>
                 <filteritem type="filename" name="*.json5" desc="hvigor工程配置文件，DevEco Studio自动生成，不需要添加许可证头"/>
                 <filteritem type="filename" name="LICENSE" desc="原三方库证书文件无需更改，因此添加过滤"/>
@@ -24,6 +28,7 @@
                 <filteritem type="filepath" name="hvigor/hvigor-wrapper.js" desc="工程模板，不修改版权头，以防有修改版权风险"/>
             </filefilter>
             <filefilter name="binaryFileTypePolicyFilter" desc="Filters for resources files policies">
+                <filteritem type="filepath" name="example/.*" desc="generated example project resources"/>
                 <filteritem type="filename" name="icon.png" desc="应用图标"/>
                 <filteritem type="filename" name="app_icon.png" desc="应用图标"/>
             </filefilter>
@@ -34,4 +39,4 @@
             </policy>
         </policylist>
     </oatconfig>
-</configuration>
\ No newline at end of file
+</configuration>

```

### `example/.eslintrc`

```diff
@@ -0,0 +1,13 @@
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

```

### `example/.gitignore`

```diff
@@ -0,0 +1,43 @@
+.husky
+bundle.harmony.js
+package-lock.json
+*.hbc
+lintCppResult.txt
+
+# OSX
+.DS_Store
+
+# Xcode
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
+node_modules/
+npm-debug.log
+yarn-error.log

```

### `example/.node-version`

```diff
@@ -0,0 +1 @@
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
@@ -0,0 +1 @@
+{}

```

### `example/app.json`

```diff
@@ -0,0 +1,4 @@
+{
+  "name": "app_name",
+  "displayName": "tester"
+}

```

### `example/babel.config.js`

```diff
@@ -0,0 +1,5 @@
+module.exports = {
+  presets: ['module:@react-native/babel-preset'],
+  plugins: [
+  ],
+};

```

### `example/contexts.ts`

```diff
@@ -0,0 +1,3 @@
+import React from 'react';
+
+export const AppParamsContext = React.createContext(undefined);

```

### `example/harmony/.gitignore`

```diff
@@ -0,0 +1,17 @@
+package-lock.json
+/build-profile.json5
+
+rnoh_modules
+
+**/oh-package-lock.json5
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

```

### `example/harmony/AppScope/app.json5`

```diff
@@ -0,0 +1,10 @@
+{
+  "app": {
+    "bundleName": "com.rntpc.amapgeolocation.demo",
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

### `example/harmony/build-profile.template.json5`

```diff
@@ -0,0 +1,45 @@
+{
+  "app": {
+    "products": [
+      {
+        "name": 'default',
+        "signingConfig": 'default',
+        "compatibleSdkVersion": '5.0.0(12)',
+        "runtimeOS": 'HarmonyOS',
+          "buildOption": {
+          "strictMode": {
+            "caseSensitiveCheck": true,
+            "useNormalizedOHMUrl": false
+          }
+        }
+      },
+    ],
+    "buildModeSet": [
+      {
+        "name": 'debug',
+      },
+      {
+        "name": 'release',
+      },
+    ],
+    "signingConfigs": []
+  },
+  "modules": [
+    {
+      "name": 'entry',
+      "srcPath": './entry',
+      "targets": [
+        {
+          "name": 'default',
+          "applyToProducts": [
+            'default'
+          ],
+        },
+      ],
+    },
+    {
+      "name": 'amap_geolocation',
+      "srcPath": '../../harmony/amap_geolocation'
+    }
+  ],
+}

```

### `example/harmony/codelinter.json`

```diff
@@ -0,0 +1 @@
+{}

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
@@ -0,0 +1,22 @@
+{
+  "apiType": 'stageMode',
+  "buildOption": {
+    "externalNativeOptions": {
+      "path": "./src/main/cpp/CMakeLists.txt",
+      "arguments": "",
+      "cppFlags": "-s",
+      "abiFilters": [
+        "arm64-v8a",
+        "x86_64"
+      ]
+    },
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

```

### `example/harmony/entry/hvigorfile.ts`

```diff
@@ -0,0 +1 @@
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
+    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/react_native_openharmony.har",
+    "@react-native-ohos/react-native-amap-geolocation": "file:../../node_modules/@react-native-ohos/react-native-amap-geolocation/harmony/amap_geolocation.har"
+  }
+}

```

### `example/harmony/entry/src/main/cpp/.gitignore`

```diff
@@ -0,0 +1,2 @@
+jsbundle.h
+generated/

```

### `example/harmony/entry/src/main/cpp/CMakeLists.txt`

```diff
@@ -0,0 +1,35 @@
+project(rnapp)
+cmake_minimum_required(VERSION 3.4.1)
+set(CMAKE_SKIP_BUILD_RPATH TRUE)
+set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
+set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules")
+set(OH_MODULE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
+set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules/@rnoh/react-native-openharmony/src/main/cpp")
+set(LOG_VERBOSITY_LEVEL 1)
+set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
+set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
+set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
+
+set(WITH_HITRACE_SYSTRACE 1)
+add_compile_definitions(WITH_HITRACE_SYSTRACE)
+
+set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})
+
+include_directories(${NATIVERENDER_ROOT_PATH}
+                    ${NATIVERENDER_ROOT_PATH}/include)
+
+add_subdirectory("${RNOH_CPP_DIR}" ./rn)
+
+# RNOH_BEGIN: manual_package_linking_1
+add_subdirectory("${OH_MODULE_DIR}/@react-native-ohos/react-native-amap-geolocation/src/main/cpp" ./amap_geolocation)
+# RNOH_END: manual_package_linking_1
+
+add_library(rnoh_app SHARED
+    "./PackageProvider.cpp"
+    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
+)
+target_link_libraries(rnoh_app PUBLIC rnoh)
+
+# RNOH_BEGIN: manual_package_linking_2
+target_link_libraries(rnoh_app PUBLIC rnoh_amap_geolocation)
+# RNOH_END: manual_package_linking_2

```

### `example/harmony/entry/src/main/cpp/PackageProvider.cpp`

```diff
@@ -0,0 +1,11 @@
+#include "RNOH/PackageProvider.h"
+#include "AMapGeolocationPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx)
+{
+    return {
+        std::make_shared<AMapGeolocationPackage>(ctx),
+    };
+}

```

### `example/harmony/entry/src/main/ets/RNPackagesFactory.ets`

```diff
@@ -0,0 +1,8 @@
+import type {RNPackageContext, RNPackage} from '@rnoh/react-native-openharmony/ts';
+import { AMapGeolocationPackage } from '@react-native-ohos/react-native-amap-geolocation/ts';
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new AMapGeolocationPackage(ctx),
+  ];
+}

```

### `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets`

```diff
@@ -0,0 +1,8 @@
+import {RNAbility} from '@rnoh/react-native-openharmony';
+import { AbilityConstant, Want } from '@kit.AbilityKit';
+
+export default class EntryAbility extends RNAbility {
+  getPagePath() {
+    return 'pages/Index';
+  }
+}

```

### `example/harmony/entry/src/main/ets/pages/Index.ets`

```diff
@@ -0,0 +1,67 @@
+import {
+  AnyJSBundleProvider,
+  FileJSBundleProvider,
+  MetroJSBundleProvider,
+  ResourceJSBundleProvider,
+  RNApp,
+  RNOHErrorDialog,
+  RNOHLogger,
+  TraceJSBundleProviderDecorator,
+  RNOHCoreContext
+} from '@rnoh/react-native-openharmony';
+import { createRNPackages } from '../RNPackagesFactory';
+
+@Entry
+@Component
+struct Index {
+  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined
+  @State shouldShow: boolean = false
+  private logger!: RNOHLogger
+  bundlePath: string = 'bunlde.harmony.js'
+  @State hasBundle: boolean = false
+
+  aboutToAppear() {
+    this.logger = this.rnohCoreContext!.logger.clone("Index")
+    const stopTracing = this.logger.clone("aboutToAppear").startTracing()
+    this.shouldShow = true
+    stopTracing()
+  }
+
+  onBackPress(): boolean | undefined {
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
+          },
+          initialProps: { "foo": "bar" } as Record<string, string>,
+          appKey: "app_name",
+          onSetUp: (rnInstance) => {
+            rnInstance.enableFeatureFlag("ENABLE_RN_INSTANCE_CLEAN_UP")
+          },
+          jsBundleProvider: new TraceJSBundleProviderDecorator(
+            new AnyJSBundleProvider([
+              new MetroJSBundleProvider(),
+              new FileJSBundleProvider('/data/storage/el2/base/files/bundle.harmony.js'),
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

### `example/harmony/entry/src/main/ets/pages/TouchDisplayer.ets`

```diff
@@ -0,0 +1,37 @@
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

```

### `example/harmony/entry/src/main/module.json5`

```diff
@@ -0,0 +1,67 @@
+{
+  "module": {
+    "name": "entry",
+    "type": "entry",
+    "description": "$string:module_desc",
+    "mainElement": "EntryAbility",
+    "deviceTypes": [
+      "default"
+    ],
+    "deliveryWithInstall": true,
+    "installationFree": false,
+    "pages": "$profile:main_pages",
+    "requestPermissions": [
+      {
+        "name": "ohos.permission.INTERNET"
+      },
+      {
+        "name": "ohos.permission.LOCATION",
+        "reason": "$string:location_permission_reason",
+        "usedScene": {
+          "abilities": [
+            "EntryAbility"
+          ],
+          "when": "inuse"
+        }
+      },
+      {
+        "name": "ohos.permission.APPROXIMATELY_LOCATION",
+        "reason": "$string:location_permission_reason",
+        "usedScene": {
+          "abilities": [
+            "EntryAbility"
+          ],
+          "when": "inuse"
+        }
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

```

### `example/harmony/entry/src/main/resources/base/element/string.json`

```diff
@@ -0,0 +1,20 @@
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
+    },
+    {
+      "name": "location_permission_reason",
+      "value": "Required to demonstrate location features."
+    }
+  ]
+}

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
The file is empty
```

### `example/harmony/hvigor/.gitignore`

```diff
@@ -0,0 +1 @@
+*.tgz

```

### `example/harmony/hvigor/hvigor-config.json5`

```diff
@@ -0,0 +1,14 @@
+{
+  "modelVersion": "5.0.0",
+  "dependencies": {
+  },
+  "execution": {
+  },
+  "logging": {
+  },
+  "debugging": {
+     "stacktrace": false
+  },
+  "nodeOptions": {
+  }
+}

```

### `example/harmony/hvigorfile.ts`

```diff
@@ -0,0 +1 @@
+export { appTasks } from '@ohos/hvigor-ohos-plugin';

```

### `example/harmony/oh-package.json5`

```diff
@@ -0,0 +1,12 @@
+{
+  "modelVersion": "5.0.0",
+  "license": "ISC",
+  "name": "rnoh",
+  "description": "example description",
+  "repository": {},
+  "version": "1.0.0",
+  "overrides": {
+    "@rnoh/react-native-openharmony": "file:../node_modules/react-native-harmony/react_native_openharmony.har"
+  },
+  "dynamicDependencies": {}
+}

```

### `example/index.js`

```diff
@@ -0,0 +1,5 @@
+import {AppRegistry} from 'react-native';
+import {name as appName} from './app.json';
+import AMapGeolocationDemo from './src/index';
+
+AppRegistry.registerComponent(appName, () => AMapGeolocationDemo);

```

### `example/jest.config.js`

```diff
@@ -0,0 +1,5 @@
+/** @type {import('ts-jest').JestConfigWithTsJest} */
+module.exports = {
+  preset: 'ts-jest',
+  testEnvironment: 'node',
+};

```

### `example/metro.config.js`

```diff
@@ -0,0 +1,21 @@
+const {mergeConfig, getDefaultConfig} = require('@react-native/metro-config');
+const {createHarmonyMetroConfig} = require('react-native-harmony/metro.config');
+
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
+    reactNativeHarmonyPackageName: 'react-native-harmony',
+  }),
+  config,
+);

```

### `example/package.json`

```diff
@@ -0,0 +1,59 @@
+{
+  "name": "react-native-harmony-tester",
+  "version": "1.0.0",
+  "private": true,
+  "scripts": {
+    "i": "cd ../ && npm i --legacy-peer-deps && npm pack && cd ./example && npm i",
+    "reStart": "npm run install:pkg && npm run codegen && hdc rport tcp:8081 tcp:8081 && react-native start",
+    "start": "hdc rport tcp:8081 tcp:8081 && react-native start",
+    "codegen": "react-native codegen-harmony --rnoh-module-path ./harmony/entry/oh_modules/@rnoh/react-native-openharmony",
+    "pack:pkg": "cd ../ && npm pack && cd ./example",
+    "install:pkg": "npm uninstall @react-native-ohos/react-native-amap-geolocation && npm run pack:pkg && npm i @react-native-ohos/react-native-amap-geolocation@file:../react-native-ohos-react-native-amap-geolocation-1.3.1-rc.1.tgz",
+    "dev": "npm run codegen && react-native bundle-harmony --dev --minify=false",
+    "prod": "npm run codegen && react-native bundle-harmony --dev=false --minify=true",
+    "postinstall": "node ./scripts/create-build-profile",
+    "fast:pkg": "cd ../ && npm i --legacy-peer-deps && npm pack && cd ./example && npm i --force && npm run dev"
+  },
+  "dependencies": {
+    "@react-native-ohos/react-native-amap-geolocation": "file:../react-native-ohos-react-native-amap-geolocation-1.3.1-rc.1.tgz",
+    "react": "18.2.0",
+    "react-native": "0.77.1",
+    "react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.77.72"
+  },
+  "devDependencies": {
+    "@babel/core": "^7.25.2",
+    "@babel/preset-env": "^7.25.3",
+    "@babel/runtime": "^7.25.0",
+    "@react-native-oh/react-native-harmony-cli": "0.77.72",
+    "@react-native/babel-preset": "0.77.1",
+    "@react-native-community/cli": "15.0.1",
+    "@react-native-community/cli-platform-android": "15.0.1",
+    "@react-native-community/cli-platform-ios": "15.0.1",
+    "@react-native-community/eslint-config": "^3.2.0",
+    "@react-native/eslint-config": "0.77.1",
+    "@react-native/metro-config": "0.77.1",
+    "@react-native/typescript-config": "0.77.1",
+    "@tsconfig/react-native": "^3.0.0",
+    "@types/d3-scale-chromatic": "^3.0.0",
+    "@types/jest": "^29.5.13",
+    "@types/react": "^18.2.6",
+    "@types/react-test-renderer": "^18.0.0",
+    "babel-jest": "^29.6.3",
+    "eslint": "^8.19.0",
+    "jest": "^29.7.0",
+    "json5": "^2.2.3",
+    "metro-react-native-babel-preset": "0.76.8",
+    "prettier": "2.8.8",
+    "react-test-renderer": "18.2.0",
+    "typescript": "5.5.4"
+  },
+  "overrides": {
+    "@react-native-community/cli": "15.0.1"
+  },
+  "resolutions": {
+    "@react-native-community/cli": "15.0.1"
+  },
+  "engines": {
+    "node": ">=18"
+  }
+}

```

### `example/react-native.config.js`

```diff
@@ -0,0 +1,3 @@
+module.exports = {
+  project: {},
+};

```

### `example/scripts/create-build-profile.js`

```diff
@@ -0,0 +1,38 @@
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
+  fs.copyFileSync(templatePath, existingProfilePath);
+}

```

### `example/src/index.tsx`

```diff
@@ -0,0 +1,59 @@
+import React, {useState} from 'react';
+import {Button, SafeAreaView, StyleSheet, Text, View} from 'react-native';
+import {
+  Geolocation,
+  setNeedAddress,
+  setOnceLocation,
+} from '@react-native-ohos/react-native-amap-geolocation';
+
+export default function AMapGeolocationDemo(): React.JSX.Element {
+  const [message, setMessage] = useState('Ready');
+
+  const requestLocation = () => {
+    setNeedAddress(true);
+    setOnceLocation(true);
+    setMessage('Locating...');
+
+    Geolocation.getCurrentPosition(
+      position => {
+        const {latitude, longitude} = position.coords;
+        setMessage(`lat: ${latitude}, lng: ${longitude}`);
+      },
+      error => {
+        setMessage(error.message || `Location error: ${error.code}`);
+      },
+    );
+  };
+
+  return (
+    <SafeAreaView style={styles.container}>
+      <View style={styles.panel}>
+        <Text style={styles.title}>AMap Geolocation</Text>
+        <Text style={styles.message}>{message}</Text>
+        <Button title="Get Current Location" onPress={requestLocation} />
+      </View>
+    </SafeAreaView>
+  );
+}
+
+const styles = StyleSheet.create({
+  container: {
+    flex: 1,
+    backgroundColor: '#f5f5f5',
+  },
+  panel: {
+    flex: 1,
+    justifyContent: 'center',
+    padding: 24,
+    gap: 16,
+  },
+  title: {
+    color: '#111111',
+    fontSize: 22,
+    fontWeight: '600',
+  },
+  message: {
+    color: '#333333',
+    fontSize: 16,
+  },
+});

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

```

### `harmony/amap_geolocation.har`

```diff
Binary files no preview for this file type
```

### `harmony/amap_geolocation/oh-package.json5`

```diff
@@ -1,6 +1,6 @@
 {
   "name": "@react-native-ohos/react-native-amap-geolocation",
-  "version": "1.3.0",
+  "version": "1.3.1-rc.1",
   "description": "ReactNative geolocation module for Harmony",
   "main": "Index.ets",
   "author": "",

```

### `harmony/amap_geolocation/src/main/ets/AMapGeolocationModule.ts`

```diff
@@ -95,6 +95,10 @@ export class AMapGeolocationModule extends TurboModule implements IAMapLocationL
   };
 
   onLocationError(locationErrorInfo: e45): void {
+    this.ctx.rnInstance.emitDeviceEvent("AMapGeolocation", {
+      errorCode: locationErrorInfo.errorCode,
+      errorInfo: locationErrorInfo.errorMsg
+    })
   };
 
   requestPermissions(): void {

```

### `package.json`

```diff
@@ -7,7 +7,7 @@
     "location",
     "geolocation"
   ],
-  "version": "1.3.0",
+  "version": "1.3.1-rc.1",
   "author": "7c00 <i@7c00.cc>",
   "repository": {
     "type": "git",

```

### `readme.md`

```diff
@@ -4,9 +4,9 @@ This project is based on   [react-native-amap-geolocation@1.2.3](http://github.c
 
 ## Documentation
 
-[中文](https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/zh-cn/react-native-amap-geolocation.md)
+[中文](https://gitcode.com/CPF-RN/usage-docs/blob/master/zh-cn/react-native-amap-geolocation.md)
 
-[English](https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/en/react-native-amap-geolocation.md)
+[English](https://gitcode.com/CPF-RN/usage-docs/blob/master/en/react-native-amap-geolocation.md)
 
 ## License
 

```
