# PR #15: fix: 修复shareWebpage接口缩略图不支持本地图片问题

- **状态**: merged
- **作者**: houahui
- **创建时间**: 2026-07-15T14:18:32+08:00
- **分支**: br_rnoh0.72 → br_rnoh0.72
- **变更文件数**: 5

## PR 描述

fix: 修复shareWebpage接口缩略图不支持本地图片问题

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `README.md` | ? | +395 | -7 |
| `README_en.md` | added | +400 | -0 |
| `harmony/react_native_wechat_lib/src/main/ets/WechatLibTurboModule.ets` | ? | +66 | -41 |
| `package.json` | ? | +2 | -1 |
| `src/index.ts` | ? | +11 | -2 |

## Diff

### `README.md`

```diff
@@ -1,13 +1,401 @@
-# @react-native-ohos/react-native-wechat-lib
+> 模板版本：v0.4.0
 
-This project is based on [react-native-wechat-lib@v3.0.0](https://github.com/little-snow-fox/react-native-wechat-lib/tree/v3.0.0)
+<p align="center">
+  <h1 align="center"> <code>react-native-wechat-lib</code> </h1>
+</p>
+<p align="center">
+    <a href="https://github.com/little-snow-fox/react-native-wechat-lib">
+        <img src="https://img.shields.io/badge/platforms-android%20|%20ios%20|%20harmony%20-lightgrey.svg" alt="Supported platforms" />
+    </a>
+    <a href="https://github.com/little-snow-fox/react-native-wechat-lib/blob/master/LICENSE">
+        <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" />
+        <!-- <img src="https://img.shields.io/badge/license-Apache-blue.svg" alt="License" /> -->
+    </a>
+</p>
 
-## Documentation
+本项目基于 [原库react-native-wechat-lib](https://github.com/little-snow-fox/react-native-wechat-lib) 开发。
 
-- [中文](https://gitee.com/react-native-oh-library/usage-docs/blob/master/zh-cn/react-native-wechat-lib.md)
+该第三方库的仓库支持直接从 npm 下载，新的包名为：@react-native-ohos/react-native-wechat-lib  版本所属关系如下：
+| 三方库名称    | 三方库版本    | 发布信息     | 支持RN版本    | Autolink     | 编译API版本     | 社区基线版本    | npm地址                |
+| ------------ | ------------ | ------------------------------ | ------------- | ------------- |------------------------ | ------------- | ------------- |
+| @react-native-ohos/react-native-wechat-lib | ~3.2.0（开发中）    | [Github Releases](https://github.com/react-native-oh-library/react-native-wechat-lib/releases) | 0.82.* | 是 | API12+ | 3.0.4 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-wechat-lib?activeTab=versions) |
+| @react-native-ohos/react-native-wechat-lib | ~3.1.0    | [Github Releases](https://github.com/react-native-oh-library/react-native-wechat-lib/releases) | 0.77.* | 否 | API12+ | 3.0.4 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-wechat-lib?activeTab=versions) |
+| @react-native-ohos/react-native-wechat-lib | ~3.0.6    | [Github Releases](https://github.com/react-native-oh-library/react-native-wechat-lib/releases) | 0.72.* | 是 | API12+ | 3.0.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-wechat-lib?activeTab=versions) |
 
-- [English](https://gitee.com/react-native-oh-library/usage-docs/blob/master/en/react-native-wechat-lib.md)
+## 1. 安装与使用
 
-## License
+进入到工程目录并输入以下命令：
 
-This library is licensed under [The MIT License (MIT)](https://github.com/react-native-oh-library/react-native-wechat-lib/blob/sig/License)
+<!-- tabs:start -->
+
+#### **npm**
+
+```bash
+npm install @react-native-ohos/react-native-wechat-lib
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/react-native-wechat-lib
+```
+
+<!-- tabs:end -->
+
+下面的代码展示了这个库的基本使用场景：
+
+> [!WARNING] 使用时 import 的库名不变。
+
+> [tips] 下面 demo 在使用的过程中，请将 AppID 改为在[微信开放平台申请鸿蒙应用](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Access_Guide/ohos.html)的 AppID
+
+```js
+import * as React from 'react';
+
+import { StyleSheet, View, Text, Button, Alert } from 'react-native';
+import { getApiVersion, registerApp, openWXApp, sendAuthRequest, shareText } from 'react-native-wechat-lib';
+
+export default function App() {
+  const [versionNumber, setVersionNumber] = React.useState<string | undefined>();
+
+  React.useEffect(() => {
+    registerApp('AppID', 'universalLink').then((res) => {
+      console.log("registerApp: " + res)
+    });
+
+  }, []);
+
+  function onLogin() {
+    sendAuthRequest('snsapi_userinfo', '')
+      .then((response: any) => {
+        Alert.alert('登录成功，code: ' + response.code)
+      })
+      .catch(error => {
+        console.log(error)
+        let errorCode = Number(error.code);
+        if (errorCode === -2) {
+          Alert.alert('已取消授权登录')
+        } else {
+          Alert.alert('微信授权登录失败')
+        }
+      });
+
+  }
+
+  function onShareText() {
+    shareText({
+      text: 'test content.',
+      scene: 0
+    }).then()
+  }
+
+  return (
+    <View style={styles.container}>
+      <Text style={styles.title}>Call wechat SDK demo</Text>
+      <Text style={styles.versionBox}>
+        Version: {versionNumber}
+      </Text>
+      <View style={styles.buttonGroup}>
+        <View style={styles.button}>
+          <Button title={'拉起微信'} onPress={() => { openWXApp().then() }} />
+        </View>
+        <View style={styles.button}>
+          <Button title={'授权登录'} onPress={() => { onLogin() }} />
+        </View>
+        <View style={styles.button}>
+          <Button title={'分享'} onPress={() => { onShareText() }} />
+        </View>
+      </View>
+    </View>
+  );
+}
+
+const styles = StyleSheet.create({
+  container: {
+    width: '100%',
+    // flex: 1,
+    alignItems: 'center',
+    // justifyContent: 'center',
+  },
+  box: {
+    width: 60,
+    height: 60,
+    marginVertical: 20,
+  },
+  title: {
+    marginTop: 48,
+    fontSize: 24,
+    color: 'rgba(0, 0, 0, 0.6)',
+  },
+  versionBox: {
+    color: 'rgba(0, 0, 0, 0.6)'
+  },
+  buttonGroup: {
+    width: '100%',
+    padding: 6,
+    marginTop: 24,
+  },
+  button: {
+    margin: 6,
+
+  }
+});
+```
+
+## 2. Link
+
+|                                      | 是否支持autolink | RN框架版本 |
+|--------------------------------------|-----------------|------------|
+| ~3.2.0                               |  Yes             |  0.82     |
+| ~3.1.0                               |  No              |  0.77     |
+| ~3.0.6                               |  Yes             |  0.72     |
+
+使用AutoLink的工程需要根据该文档配置，Autolink框架指导文档：https://gitcode.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md
+
+如您使用的版本支持 Autolink，并且工程已接入 Autolink，可跳过ManualLink配置。
+<details>
+  <summary>ManualLink: 此步骤为手动配置原生依赖项的指导</summary>
+
+首先需要使用 DevEco Studio 打开项目里的 HarmonyOS 工程 `harmony`。
+
+### 2.1 在工程根目录的 `oh-package.json5` 添加 overrides 字段
+
+```json
+{
+  ...
+  "overrides": {
+    "@rnoh/react-native-openharmony" : "./react_native_openharmony"
+  }
+}
+```
+
+### 2.2 引入原生端代码
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
+    "@react-native-ohos/react-native-wechat-lib": "file:../../node_modules/@react-native-ohos/react-native-wechat-lib/harmony/react_native_wechat_lib.har"
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
+### 2.3 配置 CMakeLists 和引入 RNWechatLibPackage
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
++ add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-wechat-lib/src/main/cpp" ./wechat-lib)
+# RNOH_END: manual_package_linking_1
+
+file(GLOB GENERATED_CPP_FILES "./generated/*.cpp")
+
+add_library(rnoh_app SHARED
+    ${GENERATED_CPP_FILES}
+    "./PackageProvider.cpp"
+    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
+)
+target_link_libraries(rnoh_app PUBLIC rnoh)
+
+# RNOH_BEGIN: manual_package_linking_2
+target_link_libraries(rnoh_app PUBLIC rnoh_sample_package)
++ target_link_libraries(rnoh_app PUBLIC wechat_lib)
+# RNOH_END: manual_package_linking_2
+```
+
+打开 `entry/src/main/cpp/PackageProvider.cpp`，添加：
+
+```diff
+#include "RNOH/PackageProvider.h"
+#include "generated/RNOHGeneratedPackage.h"
+#include "SamplePackage.h"
++ #include "RNWechatLibPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
+    return {
+        std::make_shared<RNOHGeneratedPackage>(ctx),
+        std::make_shared<SamplePackage>(ctx),
++       std::make_shared<RNWechatLibPackage>(ctx),
+    };
+}
+```
+
+### 2.4 在 ArkTs 侧引入 WechatLibPackage
+
+打开 `entry/src/main/ets/RNPackagesFactory.ts`，添加：
+
+```diff
+  ...
++ import { WechatLibPackage } from '@react-native-ohos/react-native-wechat-lib/ts';
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new SamplePackage(ctx),
++   new WechatLibPackage(ctx),
+  ];
+}
+```
+</details>
+
+### 2.5 必要的配置项
+
+> [!TIP] 该模块的内容无法通过autolink自动生成，始终需要手动配置。
+
+#### 2.5.1 配置 EntryAbility（该模块始终需要手动配置）
+
+鸿蒙工程下 EntryAbility，一般位于 `entry\src\main\ets\entryability\EntryAbility.ets`
+
+```diff
+import {RNAbility} from '@rnoh/react-native-openharmony';
++ import { AbilityConstant, Want } from '@kit.AbilityKit';
++ import { WechatLibTurboModule } from '@react-native-ohos/react-native-wechat-lib';
+
+export default class EntryAbility extends RNAbility {
+
++   onCreate(want: Want) {
++     super.onCreate(want)
++     this.handleWeChatCallIfNeed(want)
++   }
+
+  getPagePath() {
+    return 'pages/Index';
+  }
+
++  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
++    this.handleWeChatCallIfNeed(want)
++  }
+
++  private handleWeChatCallIfNeed(want: Want) {
++    WechatLibTurboModule.handleWant(want)
++  }
+}
+
+```
+
+#### 2.5.2 配置 module.json5（该模块始终需要手动配置）
+
+打开 `entry/src/main/module.json5`，添加：
+
+```diff
+{
+  "module": {
+    "name": "entry",
+    "type": "entry",
+    "description": "$string:module_desc",
+    "mainElement": "EntryAbility",
+    "deviceTypes": [
+      "default"
+    ],
++   "querySchemes": [
++     "weixin",
++   ],
+    ...
+  }
+}
+```
+
+### 2.6 运行
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
+## 3. 约束与限制
+
+### 3.1 兼容性
+
+要使用此库，需要使用正确的 React-Native 和 RNOH 版本。另外，还需要使用配套的 DevEco Studio 和 手机 ROM。
+
+在以下版本验证通过：
+
+1. RNOH: 0.72.96; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+2. RNOH: 0.72.33; SDK: HarmonyOS NEXT B1; IDE: DevEco Studio: 5.0.3.900; ROM: Next.0.0.71;
+3. RNOH: 0.77.18; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+4. RNOH: 0.82.7; SDK: HarmonyOS 6.0.1 Release SDK; IDE: DevEco Studio 6.0.1 Release; ROM: 6.0.0.328 SP26;
+
+## 4. API
+
+> [!TIP] "Platform"列表示该属性在原三方库上支持的平台。
+
+> [!TIP] "HarmonyOS Support"列为 yes 表示 HarmonyOS 平台支持该属性；no 则表示不支持；partially 表示部分支持。使用方法跨平台一致，效果对标 iOS 或 Android 的效果。
+
+> [!TIP] 移动应用跳转至小程序的规则，[请见APP拉起小程序的功能介绍](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Launching_a_Mini_Program/Launching_a_Mini_Program.html)
+
+| Name                                          | Description        | Type     | Required | Platform    | HarmonyOS Support |
+| --------------------------------------------- | ------------------ | -------- | -------- | ----------- | ----------------- |
+| registerApp(appid)                            | 注册               | Function | no       | Android/iOS | yes               |
+| isWXAppInstalled()                            | 判断微信是否已安装 | Function | no       | Android/iOS | yes                |
+| isWXAppSupportApi()                           | 检查支持情况       | Function | no       | Android/iOS | no                |
+| getApiVersion()                               | 获取 API 版本号    | Function | no       | Android/iOS | no                |
+| openWXApp()                                   | 打开微信           | Function | no       | Android/iOS | yes               |
+| sendAuthRequest([scope[, state]])             | 微信授权登录       | Function | no       | Android/iOS | yes               |
+| shareText(ShareTextMetadata)                  | 分享/收藏 文本     | Function | no       | Android/iOS | partially(Session、Timeline)          |
+| shareImage(ShareImageMetadata)                | 分享/收藏 图片     | Function | no       | Android/iOS | partially(Session、Timeline)          |
+| shareLocalImage(ShareImageMetadata)           | 分享/收藏 本地图片  | Function | no       | Android/iOS | partially(Session、Timeline)          |
+| shareFile(ShareFileMetadata)                  | 分享文件           | Function | no       | Android/iOS | partially(Session)         |
+| shareMusic(ShareMusicMetadata)                | 分享音频           | Function | no       | Android/iOS | no                         |
+| shareVideo(ShareVideoMetadata)                | 分享视频           | Function | no       | Android/iOS | partially(Session)         |
+| shareWebpage (ShareWebpageMetadata)           | 分享网页           | Function | no       | Android/iOS | partially(Session)         |
+| shareMiniProgram(ShareMiniProgramMetadata)    | 分享小程序         | Function | no       | Android/iOS | partially(Session)         |
+| launchMiniProgram (LaunchMiniProgramMetadata) | 跳到小程序         | Function | no       | Android/iOS | yes               |
+| chooseInvoice (ChooseInvoice)                 | 选择发票           | Function | no       | Android/iOS | no                |
+| pay(payload)                                  | 支付               | Function | no       | Android/iOS | yes               |
+| subscribeMessage(SubscribeMessageMetadata)    | 一次性订阅消息     | Function | no        | Android/iOS | no                 |
+
+## 5. 遗留问题
+
+## 6. 其他
+
+- ShareText、ShareImage、ShareLocalImage、ShareMiniProgram、ShareFile、ShareVideo、ShareWebpage 只支持分享，不支持收藏，原因为目前微信 Open SDK 还不支持 HarmonyOS 平台的收藏
+- isWXAppSupportApi、getApiVersion、ShareMusic、ChooseInvoice、subscribeMessage 这些接口目前在 HarmonyOS 微信 Open SDK 还不支持
+
+## 7. 开源协议
+
+本项目基于 [The MIT License (MIT)](https://github.com/little-snow-fox/react-native-wechat-lib/blob/master/LICENSE) ，请自由地享受和参与开源。

```

### `README_en.md`

```diff
@@ -0,0 +1,400 @@
+> Template version：v0.4.0
+
+<p align="center">
+  <h1 align="center"> <code>react-native-wechat-lib</code> </h1>
+</p>
+<p align="center">
+    <a href="https://github.com/little-snow-fox/react-native-wechat-lib">
+        <img src="https://img.shields.io/badge/platforms-android%20|%20ios%20|%20harmony%20-lightgrey.svg" alt="Supported platforms" />
+    </a>
+    <a href="https://github.com/little-snow-fox/react-native-wechat-lib/blob/master/LICENSE">
+        <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" />
+        <!-- <img src="https://img.shields.io/badge/license-Apache-blue.svg" alt="License" /> -->
+    </a>
+</p>
+
+This project is based on [react-native-wechat-lib](https://github.com/little-snow-fox/react-native-wechat-lib).
+
+This third-party library is available for direct download from npm. The new package name is @react-native-ohos/react-native-wechat-lib. The version correspondence details are as follows:
+
+| Name    | Version    | Release Information     | Supported RN Version    | Supported Autolink     | Compile API Version     | Community Baseline Version    | npm Address                |
+| ------------ | ------------ | ------------------------------ | ------------- | ------------- |------------------------ | ------------- | ------------- |
+| @react-native-ohos/react-native-wechat-lib | ~3.2.0(In development)    | [Github Releases](https://github.com/react-native-oh-library/react-native-wechat-lib/releases) | 0.82.* | Yes | API12+ | 3.0.4 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-wechat-lib?activeTab=versions) |
+| @react-native-ohos/react-native-wechat-lib | ~3.1.0    | [Github Releases](https://github.com/react-native-oh-library/react-native-wechat-lib/releases) | 0.77.* | No | API12+ | 3.0.4 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-wechat-lib?activeTab=versions) |
+| @react-native-ohos/react-native-wechat-lib | ~3.0.6    | [Github Releases](https://github.com/react-native-oh-library/react-native-wechat-lib/releases) | 0.72.* | Yes | API12+ | 3.0.0 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/react-native-wechat-lib?activeTab=versions) |
+
+## 1. Installation and Usage
+
+Go to the project directory and execute the following instruction:
+
+<!-- tabs:start -->
+
+#### **npm**
+
+```bash
+npm install @react-native-ohos/react-native-wechat-lib
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/react-native-wechat-lib
+```
+
+<!-- tabs:end -->
+
+The following code shows the basic use scenario of the repository：
+
+> [!WARNING] The name of the imported repository remains unchanged.
+
+> [tips] When using the demo below, please change the AppID to the AppID of the HarmonyOS application applied for on the [WeChat open platform](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Access_Guide/ohos.html).
+
+```js
+import * as React from 'react';
+
+import { StyleSheet, View, Text, Button, Alert } from 'react-native';
+import { getApiVersion, registerApp, openWXApp, sendAuthRequest, shareText } from 'react-native-wechat-lib';
+
+export default function App() {
+  const [versionNumber, setVersionNumber] = React.useState<string | undefined>();
+
+  React.useEffect(() => {
+    registerApp('AppID', 'universalLink').then((res) => {
+      console.log("registerApp: " + res)
+    });
+
+  }, []);
+
+  function onLogin() {
+    sendAuthRequest('snsapi_userinfo', '')
+      .then((response: any) => {
+        Alert.alert('Login successful, code' + response.code)
+      })
+      .catch(error => {
+        console.log(error)
+        let errorCode = Number(error.code);
+        if (errorCode === -2) {
+          Alert.alert('Authorized login has been canceled')
+        } else {
+          Alert.alert('WeChat authorized login failed')
+        }
+      });
+
+  }
+
+  function onShareText() {
+    shareText({
+      text: 'test content.',
+      scene: 0
+    }).then()
+  }
+
+  return (
+    <View style={styles.container}>
+      <Text style={styles.title}>Call wechat SDK demo</Text>
+      <Text style={styles.versionBox}>
+        Version: {versionNumber}
+      </Text>
+      <View style={styles.buttonGroup}>
+        <View style={styles.button}>
+          <Button title={'Open WeChat'} onPress={() => { openWXApp().then() }} />
+        </View>
+        <View style={styles.button}>
+          <Button title={'Authorized login'} onPress={() => { onLogin() }} />
+        </View>
+        <View style={styles.button}>
+          <Button title={'Share Text'} onPress={() => { onShareText() }} />
+        </View>
+      </View>
+    </View>
+  );
+}
+
+const styles = StyleSheet.create({
+  container: {
+    width: '100%',
+    // flex: 1,
+    alignItems: 'center',
+    // justifyContent: 'center',
+  },
+  box: {
+    width: 60,
+    height: 60,
+    marginVertical: 20,
+  },
+  title: {
+    marginTop: 48,
+    fontSize: 24,
+    color: 'rgba(0, 0, 0, 0.6)',
+  },
+  versionBox: {
+    color: 'rgba(0, 0, 0, 0.6)'
+  },
+  buttonGroup: {
+    width: '100%',
+    padding: 6,
+    marginTop: 24,
+  },
+  button: {
+    margin: 6,
+
+  }
+});
+```
+
+## 2. Link
+
+|                                      | Is supporte autolink | Supported RN Version |
+|--------------------------------------|----------------------|------------|
+| ~3.2.0                               |  Yes             |  0.82     |
+| ~3.1.0                               | No                   |  0.77     |
+| ~3.0.6                               | Yes                  |  0.72     |
+
+Using AutoLink need to be configured according to this document, Autolink Framework Guide Documentation: https://gitcode.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md
+
+If the version you use supports Autolink and the project has been connected to Autolink, skip the ManualLink configuration.
+<details>
+  <summary>ManualLink: this step is a guide to manually configure native dependencies.</summary>
+
+First, use DevEco Studio to open the HarmonyOS project `harmony` in the project directory.
+
+### 2.1 Adding the overrides Field to oh-package.json5 File in the Root Directory of the Project
+
+```json
+{
+  ...
+  "overrides": {
+    "@rnoh/react-native-openharmony" : "./react_native_openharmony"
+  }
+}
+```
+
+### 2.2 Introducing Native Code
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
+    "@react-native-ohos/react-native-wechat-lib": "file:../../node_modules/@react-native-ohos/react-native-wechat-lib/harmony/react_native_wechat_lib.har"
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
+### 2.3 Configuring CMakeLists and Introducing RNWechatLibPackage
+
+open `entry/src/main/cpp/CMakeLists.txt` and add the following code:
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
++ add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-wechat-lib/src/main/cpp" ./wechat-lib)
+# RNOH_END: manual_package_linking_1
+
+file(GLOB GENERATED_CPP_FILES "./generated/*.cpp")
+
+add_library(rnoh_app SHARED
+    ${GENERATED_CPP_FILES}
+    "./PackageProvider.cpp"
+    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
+)
+target_link_libraries(rnoh_app PUBLIC rnoh)
+
+# RNOH_BEGIN: manual_package_linking_2
+target_link_libraries(rnoh_app PUBLIC rnoh_sample_package)
++ target_link_libraries(rnoh_app PUBLIC wechat_lib)
+# RNOH_END: manual_package_linking_2
+```
+
+Open `entry/src/main/cpp/PackageProvider.cpp` and add the following code:
+
+```diff
+#include "RNOH/PackageProvider.h"
+#include "generated/RNOHGeneratedPackage.h"
+#include "SamplePackage.h"
++ #include "RNWechatLibPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
+    return {
+        std::make_shared<RNOHGeneratedPackage>(ctx),
+        std::make_shared<SamplePackage>(ctx),
++       std::make_shared<RNWechatLibPackage>(ctx),
+    };
+}
+```
+
+### 2.4 Introducing WechatLibPackage to ArkTS
+
+Open the `entry/src/main/ets/RNPackagesFactory.ts` file and add the following code:
+
+```diff
+  ...
++ import { WechatLibPackage } from '@react-native-ohos/react-native-wechat-lib/ts';
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new SamplePackage(ctx),
++   new WechatLibPackage(ctx),
+  ];
+}
+```
+</details>
+
+### 2.5 Necessary configuration items
+
+> [!TIP] The content of this module cannot be automatically generated by autolink and must always be manually configured.
+
+#### 2.5.1 Configuring EntryAbility(This module always requires manual configuration)
+
+Open `entry\src\main\ets\entryability\EntryAbility.ets` and add the following code:
+
+```diff
+import {RNAbility} from '@rnoh/react-native-openharmony';
++ import { AbilityConstant, Want } from '@kit.AbilityKit';
++ import { WechatLibTurboModule } from '@react-native-ohos/react-native-wechat-lib';
+
+export default class EntryAbility extends RNAbility {
+
++   onCreate(want: Want) {
++     super.onCreate(want)
++     this.handleWeChatCallIfNeed(want)
++   }
+
+  getPagePath() {
+    return 'pages/Index';
+  }
+
++  onNewWant(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
++    this.handleWeChatCallIfNeed(want)
++  }
+
++  private handleWeChatCallIfNeed(want: Want) {
++    WechatLibTurboModule.handleWant(want)
++  }
+}
+
+```
+
+#### 2.5.2 Configuring module.json5(This module always requires manual configuration)
+
+open `entry/src/main/module.json5` and add the following code:
+
+```diff
+{
+  "module": {
+    "name": "entry",
+    "type": "entry",
+    "description": "$string:module_desc",
+    "mainElement": "EntryAbility",
+    "deviceTypes": [
+      "default"
+    ],
++   "querySchemes": [
++     "weixin",
++   ],
+    ...
+  }
+}
+```
+
+### 2.6 Running
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
+## 3. Constraints
+
+### 3.1 Compatibility
+
+To use this repository, you need to use the correct React-Native and RNOH versions. In addition, you need to use DevEco Studio and the ROM on your phone.
+
+Verified in the following versions.
+
+1. RNOH: 0.72.96; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+2. RNOH: 0.72.33; SDK: HarmonyOS NEXT B1; IDE: DevEco Studio: 5.0.3.900; ROM: Next.0.0.71;
+3. RNOH: 0.77.18; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+4. RNOH: 0.82.7; SDK: HarmonyOS 6.0.1 Release SDK; IDE: DevEco Studio 6.0.1 Release; ROM: 6.0.0.328 SP26;
+
+## 4. API
+
+> [!TIP] The **Platform** column indicates the platform where the properties are supported in the original third-party library.
+
+> [!TIP] If the value of **HarmonyOS Support** is **yes**, it means that the HarmonyOS platform supports this property; **no** means the opposite; **partially** means some capabilities of this property are supported. The usage method is the same on different platforms and the effect is the same as that of iOS or Android.
+
+> [!TIP] The rules for mobile applications to jump to Mini Program, [please refer to the feature introduction for launching Mini Program in the app](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Launching_a_Mini_Program/Launching_a_Mini_Program.html)
+
+| Name                                          | Description        | Type     | Required | Platform    | HarmonyOS Support |
+| --------------------------------------------- | ------------------ | -------- | -------- | ----------- | ----------------- |
+| registerApp(appid)                            | register               | Function | no       | Android/iOS | yes               |
+| isWXAppInstalled()                            | Determine whether WeChat is installed | Function | no       | Android/iOS | yes               |
+| isWXAppSupportApi()                           | Check support          | Function | no       | Android/iOS | no                |
+| getApiVersion()                               | Get API version number | Function | no       | Android/iOS | no                |
+| openWXApp()                                   | Open WeChat            | Function | no       | Android/iOS | yes               |
+| sendAuthRequest([scope[, state]])             | WeChat authorized login| Function | no       | Android/iOS | yes               |
+| shareText(ShareTextMetadata)                  | Share/Collect Text     | Function | no       | Android/iOS | partially(Session、Timeline)      |
+| shareImage(ShareImageMetadata)                | Share Image            | Function | no       | Android/iOS | partially(Session、Timeline)      |
+| shareLocalImage(ShareImageMetadata)           | Share LocalImage       | Function | no       | Android/iOS | partially(Session、Timeline)      |
+| shareFile(ShareFileMetadata)                  | Share File             | Function | no       | Android/iOS | partially(Session)                |
+| shareMusic(ShareMusicMetadata)                | Share Music            | Function | no       | Android/iOS | no                                |
+| shareVideo(ShareVideoMetadata)                | Share Video            | Function | no       | Android/iOS | partially(Session)                |
+| shareWebpage (ShareWebpageMetadata)           | Share Webpage          | Function | no       | Android/iOS | partially(Session)                |
+| shareMiniProgram(ShareMiniProgramMetadata)    | Share MiniProgram      | Function | no       | Android/iOS | partially(Session)                |
+| launchMiniProgram (LaunchMiniProgramMetadata) | Launch MiniProgram     | Function | no       | Android/iOS | yes               |
+| chooseInvoice (ChooseInvoice)                 | Select invoice         | Function | no       | Android/iOS | no                |
+| pay(payload)                                  | pay                    | Function | no       | Android/iOS | yes               |
+| subscribeMessage(SubscribeMessageMetadata)    | 
+One-time subscription to messages     | Function | no       | Android/iOS | no                |
+
+## 5. Known Issues
+
+## 6. Others
+
+- ShareText、ShareImage、ShareLocalImage、ShareMiniProgram、ShareFile、ShareVideo、ShareWebpage: Only sharing is supported, collection is not supported, because the WeChat Open SDK currently does not support collection on the HarmonyOS platform.
+- isWXAppSupportApi、getApiVersion、ShareMusic、ChooseInvoice、subscribeMessage. These interfaces are currently not supported by HarmonyOS WeChat Open SDK.
+
+## 7. License
+
+This project is licensed under [The MIT License (MIT)](https://github.com/little-snow-fox/react-native-wechat-lib/blob/master/LICENSE).

```

### `harmony/react_native_wechat_lib/src/main/ets/WechatLibTurboModule.ets`

```diff
@@ -504,19 +504,7 @@ export class WechatLibTurboModule extends TurboModule implements TM.WechatLibTur
 
       let thumbImageUrl = (message.thumbImageUrl ? message.thumbImageUrl : null);
       if (thumbImageUrl != null && !(thumbImageUrl === "")) {
-        await new Promise<void>((resolve) => {
-          this.downloadImageWithUrl(thumbImageUrl!, async (imageData: ArrayBuffer) => {
-            if (!imageData) {
-              callback("shareVideo Failed to retrieve imageData", null);
-              return;
-            }
-            let thumbPixel = image.createImageSource(imageData).createPixelMapSync();
-            // 图片压缩
-            let thumbBuffer = await this.bitmapResizeGetBytes(thumbPixel, this.THUMB_SIZE);
-            mediaMessage.thumbData = new Uint8Array(thumbBuffer);
-            resolve();
-          }, callback);
-        })
+        await this.loadThumbImage(thumbImageUrl, mediaMessage);
       }
       // 构造一个Req
       const req = new wxopensdk.SendMessageToWXReq();
@@ -534,6 +522,67 @@ export class WechatLibTurboModule extends TurboModule implements TM.WechatLibTur
     }
   }
 
+  async loadThumbImage(
+    thumbImageUrl: string,
+    mediaMessage: wxopensdk.WXMediaMessage
+  ): Promise<void> {
+    const ASSET_PREFIX = 'asset://';
+    const RAWFILE_PREFIX = 'resource://RAWFILE/';
+    const DATA_PREFIX = 'data:';
+
+    const getBytes = (): Promise<ArrayBuffer> => {
+      return new Promise<ArrayBuffer>((resolve, reject) => {
+        try {
+          if (thumbImageUrl.startsWith('http://') || thumbImageUrl.startsWith('https://')) {
+            this.downloadImageWithUrl(thumbImageUrl, (imageData: ArrayBuffer) => {
+              if (!imageData) {
+                reject(new Error('Failed to retrieve imageData'));
+                return;
+              }
+              resolve(imageData);
+            }, (error: string | null, _result: null | boolean) => {
+              reject(new Error(error ?? 'Download image failed'));
+            });
+          } else if (thumbImageUrl.startsWith(DATA_PREFIX)) {
+            const commaIndex = thumbImageUrl.indexOf(',');
+            const base64Data = commaIndex >= 0
+              ? thumbImageUrl.substring(commaIndex + 1)
+              : thumbImageUrl.substring(DATA_PREFIX.length);
+            const decoded = new util.Base64Helper().decodeSync(base64Data);
+            const clean = new ArrayBuffer(decoded.byteLength);
+            new Uint8Array(clean).set(decoded);
+            resolve(clean);
+          } else {
+            let rawFilePath = thumbImageUrl;
+            if (rawFilePath.startsWith(ASSET_PREFIX)) {
+              rawFilePath = 'assets/' + rawFilePath.substring(ASSET_PREFIX.length);
+            } else if (rawFilePath.startsWith(RAWFILE_PREFIX)) {
+              rawFilePath = rawFilePath.substring(RAWFILE_PREFIX.length);
+            }
+            const content = getContext(this).resourceManager.getRawFileContentSync(rawFilePath);
+            resolve(content.buffer);
+          }
+        } catch (err) {
+          reject(err instanceof Error ? err : new Error('loadThumbImage getBytes error'));
+        }
+      });
+    };
+
+    const imageData = await getBytes();
+    let imageSource = image.createImageSource(imageData);
+    try {
+      let thumbPixel = imageSource.createPixelMapSync();
+      try {
+        let thumbBuffer = await this.bitmapResizeGetBytes(thumbPixel, this.THUMB_SIZE);
+        mediaMessage.thumbData = new Uint8Array(thumbBuffer);
+      } finally {
+        thumbPixel.release();
+      }
+    } finally {
+      imageSource.release();
+    }
+  }
+
   /**
    * 分享网页
    * @param message
@@ -559,23 +608,11 @@ export class WechatLibTurboModule extends TurboModule implements TM.WechatLibTur
 
       let thumbImageUrl = (message.thumbImageUrl ? message.thumbImageUrl : null);
       if (thumbImageUrl != null && !(thumbImageUrl === "")) {
-        await new Promise<void>((resolve) => {
-          this.downloadImageWithUrl(thumbImageUrl!, async (imageData: ArrayBuffer) => {
-            if (!imageData) {
-              callback("shareWebpage Failed to retrieve imageData", null);
-              return;
-            }
-            let thumbPixel = image.createImageSource(imageData).createPixelMapSync();
-            // 图片压缩
-            let thumbBuffer = await this.bitmapResizeGetBytes(thumbPixel, this.THUMB_SIZE);
-            mediaMessage.thumbData = new Uint8Array(thumbBuffer);
-            resolve();
-          }, callback);
-        })
+        await this.loadThumbImage(thumbImageUrl, mediaMessage);
       }
       // 构造一个Req
       const req = new wxopensdk.SendMessageToWXReq();
-      req.transaction = "webpage";
+      req.transaction = util.generateRandomUUID().toString();
       req.scene = message.scene ?? wxopensdk.SendMessageToWXReq.WXSceneSession;
       req.message = mediaMessage;
 
@@ -620,21 +657,9 @@ export class WechatLibTurboModule extends TurboModule implements TM.WechatLibTur
         message.hdImageUrl ? message.hdImageUrl : (message.thumbImageUrl ? message.thumbImageUrl : null);
 
       if (thumbImageUrl != null && !(thumbImageUrl === "")) {
-        this.downloadImageWithUrl(thumbImageUrl, async (imageData: ArrayBuffer) => {
-          if (!imageData) {
-            callback("ShareMiniProgram Failed to retrieve imageData", null);
-            return;
-          }
-          let thumbPixel = image.createImageSource(imageData).createPixelMapSync();
-          // 图片压缩
-          let thumbBuffer = await this.bitmapResizeGetBytes(thumbPixel, this.THUMB_SIZE);
-          mediaMessage.thumbData = new Uint8Array(thumbBuffer);
-
-          await this.shareMiniProgramSendReq(mediaMessage, message, callback);
-        }, callback);
-      } else {
-        await this.shareMiniProgramSendReq(mediaMessage, message, callback);
+        await this.loadThumbImage(thumbImageUrl, mediaMessage);
       }
+      await this.shareMiniProgramSendReq(mediaMessage, message, callback);
     } catch (err) {
       const message = err instanceof Error ? err.message : 'shareMiniProgram Unknown error';
       callback(message, null);

```

### `package.json`

```diff
@@ -36,7 +36,8 @@
     "package.json",
     "!**/__tests__",
     "!**/__fixtures__",
-    "!**/__mocks__"
+    "!**/__mocks__",
+    "!build"
   ],
   "keywords": [
     "react-native",

```

### `src/index.ts`

```diff
@@ -343,14 +343,23 @@ export function shareWebpage(data: ShareWebpageMetadata) {
     data.scene = 0;
   }
   return new Promise((resolve, reject) => {
-    nativeShareWebpage?.(data);
-    emitter.once("SendMessageToWX.Resp", (resp) => {
+    WechatLib.unregisterCallback("SendMessageToWX.Resp");
+    WechatLib.registerCallback("SendMessageToWX.Resp", (result) => {
+      if (!result) {
+        return;
+      }
+      const resp = result as WechatResponse & { code?: string; returnKey?: string };
+      if (resp.code !== undefined || resp.returnKey !== undefined) {
+        return;
+      }
+      WechatLib.unregisterCallback("SendMessageToWX.Resp");
       if (resp.errCode === 0) {
         resolve(resp);
       } else {
         reject(new WechatError(resp));
       }
     });
+    nativeShareWebpage?.(data);
   });
 }
 /**

```
