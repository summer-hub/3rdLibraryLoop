# PR #24: fix:去除index.ets,ts.ets中导包带入的.ets

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-07-07T11:02:00+08:00
- **分支**: br_rnoh0.72 → br_rnoh0.72
- **变更文件数**: 55

## PR 描述

问题原因：index.ets,ts.ets的导包带了.ets的后缀，导致ide显示爆红，但是不影响使用，影响开发者使用体验，以为是三方库有问题
解决方案：去除index.ets,ts.ets中导包带入的.ets后缀

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `OAT.xml` | ? | +46 | -1 |
| `README.md` | ? | +296 | -7 |
| `README_en.md` | added | +301 | -0 |
| `example/.eslintrc` | added | +37 | -0 |
| `example/.gitignore` | added | +71 | -0 |
| `example/.node-version` | added | +24 | -0 |
| `example/.prettierrc.js` | added | +7 | -0 |
| `example/.watchmanconfig` | added | +1 | -0 |
| `example/app.json` | added | +4 | -0 |
| `example/babel.config.js` | added | +6 | -0 |
| `example/contexts.ts` | added | +27 | -0 |
| `example/harmony/.gitignore` | added | +24 | -0 |
| `example/harmony/AppScope/app.json5` | added | +10 | -0 |
| `example/harmony/AppScope/resources/base/element/string.json` | added | +8 | -0 |
| `example/harmony/AppScope/resources/base/media/app_icon.png` | added | +0 | -0 |
| `example/harmony/build-profile.template.json5` | added | +44 | -0 |
| `example/harmony/codelinter.json` | added | +32 | -0 |
| `example/harmony/entry/.gitignore` | added | +7 | -0 |
| `example/harmony/entry/build-profile.json5` | added | +22 | -0 |
| `example/harmony/entry/hvigorfile.ts` | added | +26 | -0 |
| `example/harmony/entry/oh-package.json5` | added | +11 | -0 |
| `example/harmony/entry/src/main/cpp/.gitignore` | added | +2 | -0 |
| `example/harmony/entry/src/main/cpp/CMakeLists.txt` | added | +41 | -0 |
| `example/harmony/entry/src/main/cpp/PackageProvider.cpp` | added | +37 | -0 |
| `example/harmony/entry/src/main/ets/RNPackagesFactory.ets` | added | +32 | -0 |
| `example/harmony/entry/src/main/ets/assets/fonts/Pacifico-Regular.ttf` | added | +0 | -0 |
| `example/harmony/entry/src/main/ets/assets/fonts/StintUltraCondensed-Regular.ttf` | added | +0 | -0 |
| `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets` | added | +40 | -0 |
| `example/harmony/entry/src/main/ets/pages/Index.ets` | added | +136 | -0 |
| `example/harmony/entry/src/main/ets/pages/SurfaceDeadlockTest.ets` | added | +153 | -0 |
| `example/harmony/entry/src/main/ets/pages/TouchDisplayer.ets` | added | +62 | -0 |
| `example/harmony/entry/src/main/module.json5` | added | +62 | -0 |
| `example/harmony/entry/src/main/resources/.gitignore` | added | +1 | -0 |
| `example/harmony/entry/src/main/resources/base/element/color.json` | added | +8 | -0 |
| `example/harmony/entry/src/main/resources/base/element/string.json` | added | +20 | -0 |
| `example/harmony/entry/src/main/resources/base/media/icon.png` | added | +0 | -0 |
| `example/harmony/entry/src/main/resources/base/profile/main_pages.json` | added | +5 | -0 |
| `example/harmony/entry/src/main/resources/rawfile/1.txt` | added | +1 | -0 |
| `example/harmony/format.ps1` | added | +36 | -0 |
| `example/harmony/hvigor/.gitignore` | added | +1 | -0 |
| `example/harmony/hvigor/hvigor-config.json5` | added | +21 | -0 |
| `example/harmony/hvigorfile.ts` | added | +27 | -0 |
| `example/harmony/oh-package.json5` | added | +12 | -0 |
| `example/index.js` | added | +29 | -0 |
| `example/jest.config.js` | added | +29 | -0 |
| `example/metro.config.js` | added | +48 | -0 |
| `example/package.json` | added | +61 | -0 |
| `example/react-native.config.js` | added | +29 | -0 |
| `example/scripts/create-build-profile.js` | added | +64 | -0 |
| `example/src/index.tsx` | added | +40 | -0 |
| `example/tsconfig.json` | added | +14 | -0 |
| `harmony/geolocation/index.ets` | ? | +2 | -2 |
| `harmony/geolocation/ts.ets` | ? | +2 | -2 |
| `package.json` | ? | +1 | -0 |
| `react-native-geolocation.podspec` | deleted | +0 | -35 |

## Diff

### `OAT.xml`

```diff
@@ -2,6 +2,18 @@
 <configuration>
 	<oatconfig>
 	<licensefile>LICENSE</licensefile>
+    <policylist>
+        <policy name="projectPolicy" desc="">
+            <policyitem type="license" name="MIT" path=".*" desc="license under the MIT"/>
+        </policy>
+        <policy name="projectPolicy" desc="">
+            <policyitem type="compatibility" name="GPL-2.0+" path=".*" desc="Process that runs independently, invoked by the X process."/>
+            <policyitem type="compatibility" name="Apache-2.0" path=".*" desc="不影响兼容性"/>
+            <policyitem type="compatibility" name="BSDStyleLicense" path=".*" desc="不影响兼容性" />
+            <policyitem type="compatibility" name="MIT" path=".*" desc="不影响兼容性" />
+            <policyitem type="compatibility" name="GPLStyleLicense" path=".*" desc="不影响兼容性" />
+        </policy>
+    </policylist>	
 		<filefilterlist>
 			<filefilter name="copyrightPolicyFilter" desc="Filters for compatibility，license header policies">
 				<filteritem type="filename" name="hvigorfile.ts" desc="hvigor构建脚本，DevEco Studio自动生成，不需要添加版权头"/>
@@ -14,7 +26,23 @@
 				<filteritem type="filepath" name="hvigorw" desc="工程模板，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="hvigorw.bat" desc="工程模板，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="hvigor/hvigor-wrapper.js" desc="工程模板，不修改版权头，以防有修改版权风险"/>
-                <filteritem type="filename" name="LICENSE" desc="原三方库证书文件无需更改，因此添加过滤"/>
+                <filteritem type="filename" name="LICENSE" desc="disan原三方库证书文件无需更改，因此添加过滤"/>
+				<filteritem type="filepath" name="example/harmony/entry/src/main/cpp/generated/.*" desc="Codegen生成文件，不手动修改"/>
+                <filteritem type="filepath" name="example/.prettierrc.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.watchmanconfig" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/babel.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clang-tidy" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clangd" desc="工程模板，不添加许可证头"/>  
+				<filteritem type="filepath" name=".releaserc" desc="工程模板，不添加许可证头"/> 
+				<filteritem type="filepath" name="babel.config.js" desc="工程模板，不添加许可证头"/>
+				<filteritem type="filepath" name="yarn.lock" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/entry/src/main/resources/rawfile/bundle.harmony.js" desc="编译生成文件"/>			
+                <filteritem type="filepath" name="js/index.ts" desc="原三方库源码，不修改版权头，以防有修改版权风险"/>
+				<filteritem type="filepath" name="example/harmony/format.ps1" desc="工程模板，不添加许可证头"/> 
+				<filteritem type="filepath" name="example/.eslintrc" desc="工程模板，不添加许可证头"/> 	
+				<filteritem type="filepath" name="example/.node-version" desc="工程模板，不添加许可证头"/> 
+				<filteritem type="filepath" name="example/.eslintrc" desc="工程模板，不添加许可证头"/> 
+				<filteritem type="filepath" name="example/scripts/create-build-profile.js" desc="工程模板，不添加许可证头"/> 														
 			</filefilter>
 			<filefilter name="defaultPolicyFilter" desc="Filters for compatibility，license header policies">
 				<filteritem type="filename" name="hvigorfile.ts" desc="hvigor构建脚本，DevEco Studio自动生成，不需要添加许可证头"/>
@@ -28,6 +56,22 @@
 				<filteritem type="filepath" name="hvigorw" desc="工程模板，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="hvigorw.bat" desc="工程模板，不修改版权头，以防有修改版权风险"/>
 				<filteritem type="filepath" name="hvigor/hvigor-wrapper.js" desc="工程模板，不修改版权头，以防有修改版权风险"/>
+				<filteritem type="filepath" name="example/harmony/entry/src/main/cpp/generated/.*" desc="Codegen生成文件，不手动修改"/>
+                <filteritem type="filepath" name="example/.prettierrc.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.watchmanconfig" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/babel.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clang-tidy" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clangd" desc="工程模板，不添加许可证头"/>
+				<filteritem type="filepath" name=".releaserc" desc="工程模板，不添加许可证头"/>  
+				<filteritem type="filepath" name="babel.config.js" desc="工程模板，不添加许可证头"/>
+				<filteritem type="filepath" name="yarn.lock" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/entry/src/main/resources/rawfile/bundle.harmony.js" desc="编译生成文件"/>
+                <filteritem type="filepath" name="js/index.ts" desc="原三方库源码，不修改版权头，以防有修改版权风险"/>
+				<filteritem type="filepath" name="example/harmony/format.ps1" desc="工程模板，不添加许可证头"/> 
+				<filteritem type="filepath" name="example/.eslintrc" desc="工程模板，不添加许可证头"/> 	
+				<filteritem type="filepath" name="example/.node-version" desc="工程模板，不添加许可证头"/> 
+				<filteritem type="filepath" name="example/.eslintrc" desc="工程模板，不添加许可证头"/> 
+				<filteritem type="filepath" name="example/scripts/create-build-profile.js" desc="工程模板，不添加许可证头"/> 			
 			</filefilter>
 			<filefilter name="binaryFileTypePolicyFilter" desc="Filters for resources files policies">
 			    <filteritem type="filepath" name="harmony/geolocation.har" desc="项目打包文件" />
@@ -35,6 +79,7 @@
 				<filteritem type="filename" name="app_icon.png" desc="应用图标"/>
 				<filteritem type="filename" name="warn.png" desc="页面展示图标"/>
 				<filteritem type="filename" name="*.png" desc="展示图标"/>
+				<filteritem type="filepath" name="example/harmony/entry/src/main/ets/assets/fonts/.*" desc="字体资源文件"/>
 			</filefilter>
 		</filefilterlist>
 	</oatconfig>

```

### `README.md`

```diff
@@ -1,13 +1,302 @@
-# @react-native-ohos/react-native-geolocation
+> 模板版本：v0.4.0
 
-This project is based on [@react-native-community/geolocation](https://github.com/michalchudziak/react-native-geolocation)@3.4.0
+<p align="center">
+  <h1 align="center"> @react-native-community/geolocation</code> </h1>
+</p>
 
-## Documentation
+本项目基于 [@react-native-community/geolocation](https://github.com/michalchudziak/react-native-geolocation) 开发。
 
-- [中文](https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/zh-cn/react-native-community-geolocation.md)
+该第三方库的仓库已迁移至 Gitcode，且支持直接从 npm 下载，新的包名为：`@react-native-ohos/geolocation` 版本所属关系如下：
+| 三方库名称    | 三方库版本    | 发布信息     | 支持RN版本    | Autolink     | 编译API版本     | 社区基线版本    | npm地址                |
+| ------------ | ------------ | ------------------------------ | ------------- | ------------- |------------------------ | ------------- | ------------- |
+| @react-native-ohos/geolocation | ~ 3.5.0    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-geolocation/releases) | 0.82.* | 是 | API12+ | 3.4.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/geolocation) | 
+| @react-native-ohos/geolocation | ~ 3.4.1    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-geolocation/releases) | 0.77.* | 否 | API12+ | 3.4.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/geolocation) |
+| @react-native-ohos/geolocation | ~ 3.1.1    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-geolocation/releases) | 0.72.* | 是 | API12+ | 3.1.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/geolocation) |
+| @react-native-oh-tpl/react-native-geolocation | <= 3.1.0-0.0.7@deprecated    | [Github Releases](https://github.com/react-native-oh-library/react-native-geolocation/releases) | 0.72.* | 否 | API12+ | 3.1.0 | [Npm Address](https://www.npmjs.com/package/@react-native-oh-tpl/react-native-geolocation) |
 
-- [English](https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/en/react-native-community-geolocation.md)
+## 安装与使用
 
-## License
+进入到工程目录并输入以下命令：
+
+<!-- tabs:start -->
+
+#### **npm**
+
+```bash
+npm install @react-native-ohos/geolocation
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/geolocation
+```
+
+<!-- tabs:end -->
+
+下面的代码展示了这个库的基本使用场景：
+
+> [!WARNING] 使用时 import 的库名不变。
+
+```js
+import Geolocation from "@react-native-community/geolocation";
+import { Button } from "react-native";
+import React from 'react';
+
+export function GeolocationDemo(): JSX.Element {
+  const tap = () => {
+    Geolocation.setRNConfiguration({
+      skipPermissionRequests: true,
+      authorizationLevel: "auto",
+      enableBackgroundLocationUpdates: true,
+      locationProvider: "auto",
+    });
+    console.log("tap");
+  };
+
+  return <Button title='test' onPress={tap} />;
+}
+```
+
+## Link
+
+|                                      | 是否支持autolink | RN框架版本 |
+|--------------------------------------|-----------------|------------|
+| ~3.5.0                              |  Yes              |  0.82     |
+| ~3.4.1                              |  No              |  0.77     |
+| ~3.1.1                              |  Yes             |  0.72     |
+| <= 3.1.0-0.0.7@deprecated            |  No              |  0.72     |
+
+使用AutoLink的工程需要根据该文档配置，Autolink框架指导文档：https://gitcode.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md
+
+如您使用的版本支持 Autolink，并且工程已接入 Autolink，可跳过ManualLink配置。
+<details>
+  <summary>ManualLink: 此步骤为手动配置原生依赖项的指导</summary>
+
+首先需要使用 DevEco Studio 打开项目里的 HarmonyOS 工程 `harmony`
+
+### 1.在工程根目录的 `oh-package.json5` 添加 overrides 字段
+
+```json
+{
+   ...
+   "overrides": {
+    "@rnoh/react-native-openharmony" : "./react_native_openharmony"
+  }
+}
+```
+
+### 2.引入原生端代码
+
+目前有两种方法：
+
+1. 通过 har 包引入（在 IDE 完善相关功能后该方法会被遗弃，目前首选此方法）；
+2. 直接链接源码。
+
+方法一：通过 har 包引入（推荐）
+
+> [!TIP] har 包位于三方库安装路径的 `harmony` 文件夹下。
+
+打开 `entry/oh-package.json5`，添加以下依赖
+
+```json
+"dependencies": {
+    "@rnoh/react-native-openharmony": "file:../react_native_openharmony",
+    "@react-native-ohos/geolocation": "file:../../node_modules/@react-native-ohos/geolocation/harmony/geolocation.har"
+  }
+```
+
+点击右上角的 `sync` 按钮
+
+或者在终端执行：
+
+```bash
+cd entry
+ohpm install
+```
+
+方法二：直接链接源码
+
+> [!TIP] 如需使用直接链接源码，请参考[直接链接源码说明](./link-source-code.md)
+
+### 3.配置 CMakeLists 和引入 geolocation
+
+> 若使用的是 <= 3.1.0-0.0.7 版本，请跳过本章。
+
+打开 `entry/src/main/cpp/CMakeLists.txt`，添加：
+
+```diff
+project(rnapp)
+cmake_minimum_required(VERSION 3.4.1)
+set(CMAKE_SKIP_BUILD_RPATH TRUE)
+set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
+set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules")
++ set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
+set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../react-native-harmony/harmony/cpp")
+set(LOG_VERBOSITY_LEVEL 1)
+set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
+set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
+set(WITH_HITRACE_SYSTRACE 1) # for other CMakeLists.txt files to use
+add_compile_definitions(WITH_HITRACE_SYSTRACE)
+
+add_subdirectory("${RNOH_CPP_DIR}" ./rn)
+
+# RNOH_BEGIN: manual_package_linking_1
+add_subdirectory("../../../../sample_package/src/main/cpp" ./sample-package)
++ add_subdirectory("${OH_MODULES}/@react-native-ohos/geolocation/src/main/cpp" ./geolocation)
+# RNOH_END: manual_package_linking_1
+
+file(GLOB GENERATED_CPP_FILES "./generated/*.cpp")
+
+add_library(rnoh_app SHARED
+    ${GENERATED_CPP_FILES}
+    "./PackageProvider.cpp"
+    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
+)
+
+target_link_libraries(rnoh_app PUBLIC rnoh)
+
+# RNOH_BEGIN: manual_package_linking_2
+target_link_libraries(rnoh_app PUBLIC rnoh_sample_package)
++ target_link_libraries(rnoh_app PUBLIC rnoh_geolocation)
+# RNOH_END: manual_package_linking_2
+```
+
+打开 `entry/src/main/cpp/PackageProvider.cpp`，添加：
+
+```diff
+#include "RNOH/PackageProvider.h"
+#include "SamplePackage.h"
++ #include "GeoLocationPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
+    return {
+      std::make_shared<SamplePackage>(ctx),
++     std::make_shared<GeoLocationPackage>(ctx)
+    };
+}
+```
+
+### 4.在 ArkTs 侧引入 GeolocationPackage
+
+打开 `entry/src/main/ets/RNPackagesFactory.ts`，添加：
+
+```diff
+  ...
++ import {GeoLocationPackage} from '@react-native-ohos/geolocation/ts';
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new SamplePackage(ctx),
++   new GeoLocationPackage(ctx)
+  ];
+}
+```
+</details>
+
+## 运行
+
+点击右上角的 `sync` 按钮
+
+或者在终端执行：
+
+```bash
+cd entry
+ohpm install
+```
+
+然后编译、运行即可。
+
+## 约束与限制
+
+### 兼容性
+
+要使用此库，需要使用正确的 React-Native 和 RNOH 版本。另外，还需要使用配套的 DevEco Studio 和 手机 ROM。
+
+在以下版本验证通过：
+
+1. RNOH: 0.72.96; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+2. RNOH: 0.72.33; SDK: HarmonyOS NEXT B1; IDE: DevEco Studio: 5.0.3.900; ROM: Next.0.0.71;
+3. RNOH: 0.77.18; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+4. RNOH: 0.82.1; SDK: HarmonyOS 6.0.1 Release SDK; IDE: DevEco Studio 6.0.1 Release; ROM:6.0.0.120 SP7;
+
+
+### 权限要求
+
+1.打开 `entry/src/main/module.json5`,添加相关配置
+
+```diff
+...
+{
+  "module": {
+      "requestPermissions": [
++      {
++        "name": "ohos.permission.APPROXIMATELY_LOCATION",
++        "reason": "$string:Access_location",
++        "usedScene": {
++          "abilities": [
++            "EntryAbility"
++          ],
++          "when": "always"
++        }
++      },
++      {
++        "name": "ohos.permission.LOCATION",
++        "reason": "$string:Access_location",
++        "usedScene": {
++          "abilities": [
++            "EntryAbility"
++          ],
++          "when": "always"
++       }
++      },
++     {
++        "name": "ohos.permission.INTERNET"
++      }
+    ]
+  }
+}
+```
+
+2.在 entry 目录下添加申请权限的原因
+
+打开 `entry/src/main/resources/base/element/string.json`，添加：
+
+```diff
+...
+{
+  "string": [
++    {
++      "name": "Access_location",
++      "value": "access location"
++    }
+  ]
+}
+```
+
+## 属性
+
+> [!TIP] "Platform"列表示该属性在原三方库上支持的平台。
+
+> [!TIP] "HarmonyOS Support"列为 yes 表示 HarmonyOS 平台支持该属性；no 则表示不支持；partially 表示部分支持。使用方法跨平台一致，效果对标 iOS 或 Android 的效果。
+
+| Name                 | Description                                                        | Type                                            | Required | Platform    | HarmonyOS Support | Notes                                                                                                                                                          |
+| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | -------- | ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| setRNConfiguration   | 设置将在所有位置请求中使用的配置选项                              | function(config)                                | NO       | iOS Android | partially         | config only supports skipPermissionRequests                                                                                                                    |
+| requestAuthorization | 请求合适的位置权限                                                | function(success,error)                         | YES      | iOS Android | partially         | error: Only code and message are supported.                                                                                                                    |
+| getCurrentPosition   | 使用最新位置信息调用成功回调一次                                  | function(success(position),error(error),option) | NO       | iOS Android | partially         | In position, only altitudeAccuracy is not supported. In option, only timeout and maximumAge are supported. In error, only code and message are supported.      |
+| watchPosition        | 每当位置发生变化时调用成功回调。返回一个 watchId (数字)            | function(success(postion),error(error),option)  | NO       | iOS Android | partially         | In position, only altitudeAccuracy is not supported. In error, only code and message are supported. In option, only interval and distanceFilter are supported. |
+| clearWatch           | 通过 watchPosition() 返回的 ID 清除观察者                         | function(watchID)                               | NO       | iOS Android | yes               | watchID supports only the default value 0.                                                                                                                     |
+
+## 遗留问题
+
+- [ ] @react-native-oh-tpl/geolocation 部分属性未完全实现 HarmonyOS 化，maximumAge 延时问题: [issue#6](https://github.com/react-native-oh-library/react-native-geolocation/issues/6)
+
+## 其他
+
+## 开源协议
+
+本项目基于 [The MIT License(MIT)](https://github.com/michalchudziak/react-native-geolocation/blob/master/LICENSE) ，请自由地享受和参与开源。
 
-This library is licensed under [The MIT License (MIT)](https://github.com/michalchudziak/react-native-geolocation/blob/master/LICENSE)

```

### `README_en.md`

```diff
@@ -0,0 +1,301 @@
+> Template version: v0.4.0
+
+<p align="center">
+  <h1 align="center"> @react-native-community/geolocation</code> </h1>
+</p>
+
+This project is based on [@react-native-community/geolocation](https://github.com/michalchudziak/react-native-geolocation).
+
+This third-party library has been migrated to Gitcode and is now available for direct download from npm, the new package name is: `@react-native-ohos/geolocation`, The version correspondence details are as follows:
+
+| Name | Version | Release Information | Supported RN Version | Supported Autolink | Compile API Version | Community Baseline Version | npm Address     |
+| --------------| -------------- | ------------------------------ | ------------- | ------------- |------------------------ | ------------- | ------------- |
+| @react-native-ohos/geolocation | ~ 3.5.0    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-geolocation/releases) | 0.82.* | Yes | API12+ | 3.4.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/geolocation) | 
+| @react-native-ohos/geolocation | ~ 3.4.1    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-geolocation/releases) | 0.77.* | NO | API12+ | 3.4.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/geolocation) |
+| @react-native-ohos/geolocation | ~ 3.1.1    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-geolocation/releases) | 0.72.* | Yes | API12+ | 3.1.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/geolocation) |
+| @react-native-oh-tpl/react-native-geolocation | <= 3.1.0-0.0.7@deprecated    | [Github Releases](https://github.com/react-native-oh-library/react-native-geolocation/releases) | 0.72.* | NO | API12+ | 3.1.0 | [Npm Address](https://www.npmjs.com/package/@react-native-oh-tpl/react-native-geolocation) |
+
+## Installation and Usage
+
+Go to the project directory and execute the following instruction:
+
+
+
+<!-- tabs:start -->
+
+#### **npm**
+
+```bash
+npm install @react-native-ohos/geolocation
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/geolocation
+```
+
+<!-- tabs:end -->
+
+The following code shows the basic use scenario of the repository:
+
+> [!WARNING] The name of the imported repository remains unchanged.
+
+```js
+import Geolocation from "@react-native-community/geolocation";
+import { Button } from "react-native";
+import React from 'react';
+
+export function GeolocationDemo(): JSX.Element {
+  const tap = () => {
+    Geolocation.setRNConfiguration({
+      skipPermissionRequests: true,
+      authorizationLevel: "auto",
+      enableBackgroundLocationUpdates: true,
+      locationProvider: "auto",
+    });
+    console.log("tap");
+  };
+
+  return <Button title='test' onPress={tap} />;
+}
+```
+
+## Link
+
+|                                      | Is supported autolink  | Supported RN Version |
+|--------------------------------------|-----------------------|----------------------|
+| ~3.5.0                              |  Yes              |  0.82     |
+| ~3.4.1                              |  No              |  0.77     |
+| ~3.1.1                              |  Yes             |  0.72     |
+| <= 3.1.0-0.0.7@deprecated            |  No              |  0.72     |
+
+Using AutoLink need to be configured according to this document, Autolink Framework Guide Documentation: https://gitcode.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md
+
+If the version you use supports Autolink and the project has been connected to Autolink, skip the ManualLink configuration.
+<details>
+  <summary>ManualLink: this step is a guide to manually configure native dependencies.</summary>
+
+Open the `harmony` directory of the HarmonyOS project in DevEco Studio.
+
+### 1. Adding the overrides Field to oh-package.json5 File in the Root Directory of the Project
+
+```json
+{
+   ...
+   "overrides": {
+    "@rnoh/react-native-openharmony" : "./react_native_openharmony"
+  }
+}
+```
+
+### 2. Introducing Native Code
+
+Currently, two methods are available:
+
+Method 1 (recommended): Use the HAR file.
+
+> [!TIP] The HAR file is stored in the `harmony` directory in the installation path of the third-party library.
+
+Open `entry/oh-package.json5` file and add the following dependencies:
+
+```json
+"dependencies": {
+    "@rnoh/react-native-openharmony": "file:../react_native_openharmony",
+    "@react-native-ohos/geolocation": "file:../../node_modules/@react-native-ohos/geolocation/harmony/geolocation.har"
+  }
+```
+
+Click the `sync` button in the upper right corner.
+
+Alternatively, run the following instruction on the terminal:
+
+```bash
+cd entry
+ohpm install
+```
+
+Method 2: Directly link to the source code.
+
+> [!TIP] For details, see [Directly Linking Source Code](./link-source-code.md).
+
+### 3. Configuring CMakeLists and Introducing geolocation
+
+> If you are using version <= 3.1.0-0.0.7, please skip this chapter.
+
+Open `entry/src/main/cpp/CMakeLists.txt` and add the following code:
+
+```diff
+project(rnapp)
+cmake_minimum_required(VERSION 3.4.1)
+set(CMAKE_SKIP_BUILD_RPATH TRUE)
+set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
+set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules")
++ set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
+set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../react-native-harmony/harmony/cpp")
+set(LOG_VERBOSITY_LEVEL 1)
+set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
+set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
+set(WITH_HITRACE_SYSTRACE 1) # for other CMakeLists.txt files to use
+add_compile_definitions(WITH_HITRACE_SYSTRACE)
+
+add_subdirectory("${RNOH_CPP_DIR}" ./rn)
+
+# RNOH_BEGIN: manual_package_linking_1
+add_subdirectory("../../../../sample_package/src/main/cpp" ./sample-package)
++ add_subdirectory("${OH_MODULES}/@react-native-ohos/geolocation/src/main/cpp" ./geolocation)
+# RNOH_END: manual_package_linking_1
+
+file(GLOB GENERATED_CPP_FILES "./generated/*.cpp")
+
+add_library(rnoh_app SHARED
+    ${GENERATED_CPP_FILES}
+    "./PackageProvider.cpp"
+    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
+)
+
+target_link_libraries(rnoh_app PUBLIC rnoh)
+
+# RNOH_BEGIN: manual_package_linking_2
+target_link_libraries(rnoh_app PUBLIC rnoh_sample_package)
++ target_link_libraries(rnoh_app PUBLIC rnoh_geolocation)
+# RNOH_END: manual_package_linking_2
+```
+
+Open `entry/src/main/cpp/PackageProvider.cpp` and add the following code:
+
+```diff
+#include "RNOH/PackageProvider.h"
+#include "SamplePackage.h"
++ #include "GeoLocationPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
+    return {
+      std::make_shared<SamplePackage>(ctx),
++     std::make_shared<GeoLocationPackage>(ctx)
+    };
+}
+```
+
+### 4. Introducing GeolocationPackage to ArkTS
+
+Open the `entry/src/main/ets/RNPackagesFactory.ts` file and add the following code:
+
+```diff
+  ...
++ import {GeoLocationPackage} from '@react-native-ohos/geolocation/ts';
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new SamplePackage(ctx),
++   new GeoLocationPackage(ctx)
+  ];
+}
+```
+</details>
+
+## Running
+
+Click the `sync` button in the upper right corner.
+
+Alternatively, run the following instruction on the terminal:
+
+```bash
+cd entry
+ohpm install
+```
+
+Then build and run the code.
+
+## Constraints
+
+### Compatibility
+
+To use this repository, you need to use the correct React-Native and RNOH versions. In addition, you need to use DevEco Studio and the ROM on your phone.
+
+Verified in the following versions.
+
+1. RNOH: 0.72.96; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+2. RNOH: 0.72.33; SDK: HarmonyOS NEXT B1; IDE: DevEco Studio: 5.0.3.900; ROM: Next.0.0.71;
+3. RNOH: 0.77.18; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+4. RNOH: 0.82.1; SDK: HarmonyOS 6.0.1 Release SDK; IDE: DevEco Studio 6.0.1 Release; ROM:6.0.0.120 SP7;
+
+
+### Permission Requirements
+
+1. Include applicable permissions in the module.json5 file within the entry directory.
+
+```diff
+...
+{
+  "module": {
+      "requestPermissions": [
++      {
++        "name": "ohos.permission.APPROXIMATELY_LOCATION",
++        "reason": "$string:Access_location",
++        "usedScene": {
++          "abilities": [
++            "EntryAbility"
++          ],
++          "when": "always"
++        }
++      },
++      {
++        "name": "ohos.permission.LOCATION",
++        "reason": "$string:Access_location",
++        "usedScene": {
++          "abilities": [
++            "EntryAbility"
++          ],
++          "when": "always"
++       }
++      },
++     {
++        "name": "ohos.permission.INTERNET"
++      }
+    ]
+  }
+}
+```
+
+2. Apply the reasons for applicable permission in the entry directory.
+
+Open the `entry/src/main/resources/base/element/string.json` file and add the following code:
+
+```diff
+...
+{
+  "string": [
++    {
++      "name": "Access_location",
++      "value": "access location"
++    }
+  ]
+}
+```
+
+## Properties
+
+> [!TIP] The **Platform** column indicates the platform where the properties are supported in the original third-party library.
+
+> [!TIP] If the value of **HarmonyOS Support** is **yes**, it means that the HarmonyOS platform supports this property; **no** means the opposite; **partially** means some capabilities of this property are supported. The usage method is the same on different platforms and the effect is the same as that of iOS or Android.
+
+| Name                 | Description                                                                            | Type                                            | Required | Platform    | HarmonyOS Support | Notes                                                                                                                                                          |
+| -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- | -------- | ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| setRNConfiguration   | Sets configuration options that will be used in all location requests                  | function(config)                                | NO       | iOS Android | partially         | config only supports skipPermissionRequests                                                                                                                    |
+| requestAuthorization | Request suitable Location permission                                                   | function(success,error)                         | YES      | iOS Android | partially         | error: Only code and message are supported.                                                                                                                    |
+| getCurrentPosition   | Invokes the success callback once with the latest location info                        | function(success(position),error(error),option) | NO       | iOS Android | partially         | In position, only altitudeAccuracy is not supported. In option, only timeout and maximumAge are supported. In error, only code and message are supported.      |
+| watchPosition        | Invokes the success callback whenever the location changes. Returns a watchId (number) | function(success(postion),error(error),option)  | NO       | iOS Android | partially         | In position, only altitudeAccuracy is not supported. In error, only code and message are supported. In option, only interval and distanceFilter are supported. |
+| clearWatch           | Clears watch observer by id returned by watchPosition()                                | function(watchID)                               | NO       | iOS Android | yes               | watchID supports only the default value 0.                                                                                                                     |
+
+## Known Issues
+
+ [ ] Some attributes of @react-native-oh-tpl/geolocation have not been fully implemented for HarmonyOS, and there is a delay issue with maximumAge: [issue#6](https://github.com/react-native-oh-library/react-native-geolocation/issues/6).
+
+## Others
+
+## License
+
+This project is licensed under [The MIT License(MIT)](https://github.com/michalchudziak/react-native-geolocation/blob/master/LICENSE).

```

### `example/.eslintrc`

```diff
@@ -0,0 +1,37 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
@@ -0,0 +1,24 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
@@ -0,0 +1,27 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+import React from 'react';
+
+export const AppParamsContext = React.createContext(undefined);

```

### `example/harmony/.gitignore`

```diff
@@ -0,0 +1,24 @@
+# it may cause some issues when building the project when switching branches
+package-lock.json
+# we add this because we want to keep the signing configs out of git
+/build-profile.json5
+
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
@@ -0,0 +1,44 @@
+{
+  "app": {
+    "products": [
+      {
+        "name": 'default',
+        "signingConfig": 'default',
+        "compatibleSdkVersion": '5.0.0(12)',
+        "runtimeOS": 'HarmonyOS',
+        "buildOption": {
+          "strictMode": {
+            "useNormalizedOHMUrl": true
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
+      "name": 'geolocation',
+      "srcPath": '../../harmony/geolocation'
+    }
+  ],
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
\ No newline at end of file

```

### `example/harmony/entry/hvigorfile.ts`

```diff
@@ -0,0 +1,26 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/react_native_openharmony.har",
+    "@react-native-ohos/geolocation": "file:../../node_modules/@react-native-ohos/geolocation/harmony/geolocation.har"
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
@@ -0,0 +1,41 @@
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
+add_subdirectory("${OH_MODULES}/@react-native-ohos/geolocation/src/main/cpp" ./geolocation)
+# RNOH_END: manual_package_linking_1
+
+file(GLOB GENERATED_CPP_FILES "${CMAKE_CURRENT_SOURCE_DIR}/generated/*.cpp") # this line is needed by codegen v1
+
+add_library(rnoh_app SHARED
+    ${GENERATED_CPP_FILES}
+    "./PackageProvider.cpp"
+    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
+)
+target_link_libraries(rnoh_app PUBLIC rnoh)
+
+# RNOH_BEGIN: manual_package_linking_2
+target_link_libraries(rnoh_app PUBLIC rnoh_geolocation)
+# RNOH_END: manual_package_linking_2

```

### `example/harmony/entry/src/main/cpp/PackageProvider.cpp`

```diff
@@ -0,0 +1,37 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+#include "RNOH/PackageProvider.h"
+#include "generated/RNOHGeneratedPackage.h"
+#include "GeoLocationPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx)
+{
+    return {
+        std::make_shared<RNOHGeneratedPackage>(ctx), // generated by codegen v1
+        std::make_shared<GeoLocationPackage>(ctx),
+    };
+}
\ No newline at end of file

```

### `example/harmony/entry/src/main/ets/RNPackagesFactory.ets`

```diff
@@ -0,0 +1,32 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+import type {RNPackageContext, RNPackage} from '@rnoh/react-native-openharmony/ts';
+import {GeoLocationPackage} from '@react-native-ohos/geolocation/ts';
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new GeoLocationPackage(ctx),
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
@@ -0,0 +1,40 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+import { RNAbility } from '@rnoh/react-native-openharmony';
+import { AbilityConstant, Want } from '@kit.AbilityKit';
+
+export default class EntryAbility extends RNAbility {
+  onCreate(want: Want) {
+    super.onCreate(want)
+  }
+
+  getPagePath() {
+    return 'pages/Index';
+  }
+
+  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
+
+  }
+}

```

### `example/harmony/entry/src/main/ets/pages/Index.ets`

```diff
@@ -0,0 +1,136 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+
+const arkTsComponentNames: Array<string> = [
+];
+
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
+  bundlePath: string = 'bunlde.harmony.js'
+  @State hasBundle: boolean = false
+
+  aboutToAppear() {
+    this.logger = this.rnohCoreContext!.logger.clone("Index")
+    const stopTracing = this.logger.clone("aboutToAppear").startTracing()
+    for (const customFont of fonts) {
+      font.registerFont(customFont)
+    }
+
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
+            arkTsComponentNames: arkTsComponentNames,
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
+              // NOTE: to load the bundle from file, place it in
+              // `/data/app/el2/100/base/com.rnoh.tester/files/bundle.harmony.js`
+              // on your device. The path mismatch is due to app sandboxing on HarmonyOS
+              new FileJSBundleProvider('/data/storage/el2/base/files/bundle.harmony.js'),
+              // new FileJSBundleProvider(context.filesDir + '/' + this.bundlePath),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'bundle.harmony.js')
+            ]),
+            this.rnohCoreContext.logger),
+        })
+      }
+      Text("1233333333122 1212323")
+    }
+    .height('100%')
+    .width('100%')
+  }
+}

```

### `example/harmony/entry/src/main/ets/pages/SurfaceDeadlockTest.ets`

```diff
@@ -0,0 +1,153 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
@@ -0,0 +1,62 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
@@ -0,0 +1,62 @@
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
+      {
+        "name": "ohos.permission.MICROPHONE",
+        "reason": "$string:Access_Create_Audio",
+        "usedScene": {
+          "abilities": [
+            "EntryAbility"
+          ],
+          "when": "always"
+        }
+      }
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
+      "name": "Access_Create_Audio",
+      "value": "access create Audio"
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
@@ -0,0 +1,36 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
@@ -0,0 +1,27 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+
+// Script for compiling build behavior. It is built in the build plug-in and cannot be modified currently.
+export { appTasks } from '@ohos/hvigor-ohos-plugin';
\ No newline at end of file

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
+    "@rnoh/react-native-openharmony": "file:./../node_modules/react-native-harmony/react_native_openharmony.har"
+  },
+  "dynamicDependencies": {}
+}
\ No newline at end of file

```

### `example/index.js`

```diff
@@ -0,0 +1,29 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+import {AppRegistry, View, Text} from 'react-native';
+import {name as appName} from './app.json';
+import App from './src/index';
+
+AppRegistry.registerComponent(appName, () => App);
\ No newline at end of file

```

### `example/jest.config.js`

```diff
@@ -0,0 +1,29 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+/** @type {import('ts-jest').JestConfigWithTsJest} */
+module.exports = {
+  preset: 'ts-jest',
+  testEnvironment: 'node',
+};

```

### `example/metro.config.js`

```diff
@@ -0,0 +1,48 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+const {mergeConfig, getDefaultConfig} = require('@react-native/metro-config');
+const {createHarmonyMetroConfig} = require('react-native-harmony/metro.config');
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
+    reactNativeHarmonyPackageName: 'react-native-harmony',
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
+    "install:pkg": "npm uninstall @react-native-ohos/geolocation && npm run pack:pkg && npm i @react-native-ohos/geolocation@file:../react-native-ohos-geolocation-3.1.1.tgz",
+    "dev": "npm run codegen && react-native bundle-harmony --dev --minify=false",
+    "prod": "npm run codegen && react-native bundle-harmony --dev=false --minify=true",
+    "postinstall": "node ./scripts/create-build-profile",
+    "fast-install-project": "cd ../ && npm i --force && npm run pack && rm -r node_modules && cd ./example && npm i --force",
+    "fast:pkg": "npm run fast-install-project && npm run dev"
+  },
+  "dependencies": {
+    "@gorhom/portal": "^1.0.14",
+    "@react-native-ohos/geolocation": "file:../react-native-ohos-geolocation-3.1.1.tgz",
+    "react": "18.3.1",
+    "react-native": "0.77.1",
+    "react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.77.18-1",
+    "react-native-reanimated": "^3.6.0"
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
+    "@rnoh/react-native-harmony-cli": "npm:@react-native-oh/react-native-harmony-cli@0.77.18-1",
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
@@ -0,0 +1,29 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+module.exports = {
+  project: {
+  },
+  assets: ['./assets/fonts/'],
+};

```

### `example/scripts/create-build-profile.js`

```diff
@@ -0,0 +1,64 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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

### `example/src/index.tsx`

```diff
@@ -0,0 +1,40 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2023 Huawei Device Co., Ltd.
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
+import Geolocation from "@react-native-community/geolocation";
+import { Button } from "react-native";
+import React from 'react';
+
+export function GeolocationDemo(): JSX.Element {
+  const tap = () => {
+    Geolocation.setRNConfiguration({
+      skipPermissionRequests: true,
+      authorizationLevel: "auto",
+      enableBackgroundLocationUpdates: true,
+      locationProvider: "auto",
+    });
+    console.log("tap");
+  };
+
+  return <Button title='test' onPress={tap} />;
+}
\ No newline at end of file

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

### `harmony/geolocation/index.ets`

```diff
@@ -21,6 +21,6 @@
  * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  * SOFTWARE.
  */
-import { GeoLocationPackage } from './src/main/ets/GeoLocationPackage.ets';
-export * from './ts.ets';
+import { GeoLocationPackage } from './src/main/ets/GeoLocationPackage';
+export * from './ts';
 export default GeoLocationPackage;

```

### `harmony/geolocation/ts.ets`

```diff
@@ -13,7 +13,7 @@
  * The above copyright notice and this permission notice shall be included in all
  * copies or substantial portions of the Software.
  *
- * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANT KIND, EXPRESS OR
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
@@ -22,5 +22,5 @@
  * SOFTWARE.
  */
 
-export * from './src/main/ets/GeoLocationPackage.ets'
+export * from './src/main/ets/GeoLocationPackage'
 export * from './src/main/ets/RNCGeolocationTurboModule'
\ No newline at end of file

```

### `package.json`

```diff
@@ -33,6 +33,7 @@
   "homepage": "https://gitcode.com/michalchudziak/react-native-geolocation#README.md",
   "license": "MIT",
   "scripts": {
+    "pack": "npm pack --ignore-scripts",
     "start": "react-native start",
     "test": "yarn validate:eslint && yarn validate:typescript && yarn test:jest",
     "validate:eslint": "eslint \"**/*.{js,ts,tsx}\"",

```

### `react-native-geolocation.podspec`

```diff
@@ -1,35 +0,0 @@
-require 'json'
-
-package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
-folly_compiler_flags = '-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32'
-
-Pod::Spec.new do |s|
-  s.name         = "react-native-geolocation"
-  s.version      = package['version']
-  s.summary      = package['description']
-  s.license      = package['license']
-
-  s.authors      = package['author']
-  s.homepage     = package['homepage']
-  s.platform     = :ios, "9.0"
-
-  s.source       = { :git => "https://github.com/react-native-community/react-native-geolocation.git", :tag => "v#{s.version}" }
-  s.source_files  = "ios/**/*.{h,m,mm}"
-
-  s.dependency 'React-Core'
-  s.frameworks = 'CoreLocation'
-
-  if ENV['RCT_NEW_ARCH_ENABLED'] == '1' then
-    s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
-    s.pod_target_xcconfig    = {
-        "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\"",
-        "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
-    }
-
-    s.dependency "React-Codegen"
-    s.dependency "RCT-Folly"
-    s.dependency "RCTRequired"
-    s.dependency "RCTTypeSafety"
-    s.dependency "ReactCommon/turbomodule/core"
-  end
-end

```
