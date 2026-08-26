# PR #17: fix:修复restartApp无法触发的问题

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-06-27T14:21:52+08:00
- **分支**: br_rnoh0.72 → br_rnoh0.72
- **变更文件数**: 76
- **⚠️ 注意**: diff 过大已截断，变更文件列表完整保留

## PR 描述

问题原因：在CodePush.sync的installMode设置ON_NEXT_RESTART时，调用CodePush.restartApp方法失效
解决方案：跟上流社区保持一致，无论installMode设置什么模式，CodePush.restartApp都可以正常触发

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `OAT.xml` | ? | +43 | -6 |
| `README.md` | ? | +619 | -7 |
| `README_en.md` | added | +627 | -0 |
| `buildEnv.sh` | added | +8 | -0 |
| `example/.eslintrc` | added | +13 | -0 |
| `example/.gitignore` | added | +71 | -0 |
| `example/.node-version` | added | +1 | -0 |
| `example/.prettierrc.js` | added | +7 | -0 |
| `example/.watchmanconfig` | added | +1 | -0 |
| `example/app.json` | added | +4 | -0 |
| `example/babel.config.js` | added | +5 | -0 |
| `example/contexts.ts` | added | +26 | -0 |
| `example/harmony/.gitignore` | added | +24 | -0 |
| `example/harmony/AppScope/app.json5` | added | +10 | -0 |
| `example/harmony/AppScope/resources/base/element/string.json` | added | +8 | -0 |
| `example/harmony/AppScope/resources/base/media/app_icon.png` | added | +0 | -0 |
| `example/harmony/build-profile.template.json5` | added | +39 | -0 |
| `example/harmony/codelinter.json` | added | +32 | -0 |
| `example/harmony/entry/.gitignore` | added | +7 | -0 |
| `example/harmony/entry/build-profile.json5` | added | +19 | -0 |
| `example/harmony/entry/hvigorfile.ts` | added | +17 | -0 |
| `example/harmony/entry/oh-package.json5` | added | +11 | -0 |
| `example/harmony/entry/src/main/cpp/.gitignore` | added | +2 | -0 |
| `example/harmony/entry/src/main/cpp/CMakeLists.txt` | added | +35 | -0 |
| `example/harmony/entry/src/main/cpp/PackageProvider.cpp` | added | +35 | -0 |
| `example/harmony/entry/src/main/ets/RNPackagesFactory.ets` | added | +32 | -0 |
| `example/harmony/entry/src/main/ets/assets/fonts/Pacifico-Regular.ttf` | added | +0 | -0 |
| `example/harmony/entry/src/main/ets/assets/fonts/StintUltraCondensed-Regular.ttf` | added | +0 | -0 |
| `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets` | added | +37 | -0 |
| `example/harmony/entry/src/main/ets/pages/Index.ets` | added | +136 | -0 |
| `example/harmony/entry/src/main/ets/pages/SurfaceDeadlockTest.ets` | added | +153 | -0 |
| `example/harmony/entry/src/main/ets/pages/TouchDisplayer.ets` | added | +60 | -0 |
| `example/harmony/entry/src/main/module.json5` | added | +52 | -0 |
| `example/harmony/entry/src/main/resources/.gitignore` | added | +1 | -0 |
| `example/harmony/entry/src/main/resources/base/element/color.json` | added | +8 | -0 |
| `example/harmony/entry/src/main/resources/base/element/string.json` | added | +16 | -0 |
| `example/harmony/entry/src/main/resources/base/media/icon.png` | added | +0 | -0 |
| `example/harmony/entry/src/main/resources/base/profile/main_pages.json` | added | +5 | -0 |
| `example/harmony/entry/src/main/resources/rawfile/1.txt` | added | +1 | -0 |
| `example/harmony/format.ps1` | added | +12 | -0 |
| `example/harmony/hvigor/.gitignore` | added | +1 | -0 |
| `example/harmony/hvigor/hvigor-config.json5` | added | +21 | -0 |
| `example/harmony/hvigorfile.ts` | added | +2 | -0 |
| `example/harmony/oh-package.json5` | added | +12 | -0 |
| `example/index.js` | added | +28 | -0 |
| `example/jest.config.js` | added | +5 | -0 |
| `example/metro.config.js` | added | +24 | -0 |
| `example/package.json` | added | +68 | -0 |
| `example/react-native.config.js` | added | +5 | -0 |
| `example/scripts/create-build-profile.js` | added | +39 | -0 |
| `example/src/codepush.tsx` | added | +126 | -0 |
| `example/tsconfig.json` | added | +14 | -0 |
| `harmony/codePush/index.ets` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePush.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushBuilder.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushConstants.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushInstallMode.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushInvalidPublicKeyException.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushInvalidUpdateException.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushMalformedDataException.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushNativeModule.ts` | ? | +63 | -24 |
| `harmony/codePush/src/main/ets/CodePushNotInitializedException.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushPackage.ets` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushTelemetryManager.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushUnknownException.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushUpdateManager.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushUpdateState.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushUpdateUtils.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/CodePushUtils.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/FileUtils.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/Logger.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/SettingsManager.ts` | ? | +22 | -4 |
| `harmony/codePush/src/main/ets/generated/turboModules/RTNCodePush.ts` | ? | +0 | -2 |
| `harmony/codePush/ts.ets` | ? | +22 | -4 |
| `package.json` | ? | +1 | -0 |
| `src/NativeCodePush.ts` | ? | +22 | -4 |

## Diff

### `OAT.xml`

```diff
@@ -48,12 +48,25 @@
          	    <filteritem type="filepath" name="harmony/codePush/oh-package-lock.json5" desc="工程配置文件，不添加许可证头"/>
          	    <filteritem type="filepath" name="harmony/codePush/oh-package.json5" desc="工程配置文件，不添加许可证头"/>
          	    <filteritem type="filepath" name="harmony/codePush/src/main/module.json5" desc="工程配置文件，不添加许可证头"/>
-
+                <filteritem type="filepath" name="buildEnv.sh" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/entry/src/main/resources/rawfile/bundle.harmony.js" desc="编译生成文件"/>
+                <filteritem type="filepath" name="example/.prettierrc.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.watchmanconfig" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/babel.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clang-tidy" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clangd" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="harmony/codePush/src/main/cpp/generated/.*" desc="Codegen生成文件，不手动修改"/>
+                <filteritem type="filepath" name="harmony/codePush/src/main/ets/generated/.*" desc="Codegen生成文件，不手动修改"/>
+                <filteritem type="filename" name="*.json5" desc="hvigor配置文件，DevEco Studio自动生成，不手动修改"/>
+                <filteritem type="filename" name="*/*.json5" desc="hvigor配置文件，DevEco Studio自动生成，不手动修改"/>         
+                <filteritem type="filepath" name="example/scripts/.*" desc="脚本文件，不添加许可证头"/>       
+                <filteritem type="filepath" name="example/harmony/format.ps1" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/hvigorfile.ts" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.eslintrc" desc="工程模板，不添加许可证头"/>   
+                <filteritem type="filepath" name="example/jest.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/metro.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.node-version" desc="工程模板，不添加许可证头"/>                                  
             </filefilter>
-            <filefilter name="binaryFileTypePolicyFilter" desc="Filters for copyright header policies">
-                <filteritem type="filepath" name="harmony/codePush.har" desc="项目打包文件"/>
-            </filefilter>
-
             <filefilter name="copyrightPolicyFilter" desc="Filters for copyright header policies">
                 <filteritem type="filename" name=".npmignore" desc="工程配置文件，不添加版权头"/>
                 <filteritem type="filename" name="LICENSE.md" desc="许可证说明文件，不添加版权头"/>
@@ -71,7 +84,31 @@
          	    <filteritem type="filepath" name="harmony/codePush/oh-package-lock.json5" desc="工程配置文件，不添加许可证头"/>
          	    <filteritem type="filepath" name="harmony/codePush/oh-package.json5" desc="工程配置文件，不添加许可证头"/>
          	    <filteritem type="filepath" name="harmony/codePush/src/main/module.json5" desc="工程配置文件，不添加许可证头"/>
-
+                <filteritem type="filepath" name="buildEnv.sh" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/entry/src/main/resources/rawfile/bundle.harmony.js" desc="编译生成文件"/>
+                <filteritem type="filepath" name="example/.prettierrc.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.watchmanconfig" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/babel.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clang-tidy" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/.clangd" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="harmony/codePush/src/main/cpp/generated/.*" desc="Codegen生成文件，不手动修改"/>
+                <filteritem type="filepath" name="harmony/codePush/src/main/ets/generated/.*" desc="Codegen生成文件，不手动修改"/>
+                <filteritem type="filename" name="*.json5" desc="hvigor配置文件，DevEco Studio自动生成，不手动修改"/>
+                <filteritem type="filename" name="*/*.json5" desc="hvigor配置文件，DevEco Studio自动生成，不手动修改"/>
+                <filteritem type="filepath" name="example/scripts/.*" desc="脚本文件，不添加许可证头"/>   
+                <filteritem type="filepath" name="example/harmony/format.ps1" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/harmony/hvigorfile.ts" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.eslintrc" desc="工程模板，不添加许可证头"/>   
+                <filteritem type="filepath" name="example/jest.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/metro.config.js" desc="工程模板，不添加许可证头"/>
+                <filteritem type="filepath" name="example/.node-version" desc="工程模板，不添加许可证头"/>                                                 
+            </filefilter>
+               <filefilter name="binaryFileTypePolicyFilter" desc="Filters for copyright header policies">
+                <filteritem type="filepath" name="harmony/codePush.har" desc="项目打包文件"/>
+				<filteritem type="filepath" name="example/harmony/entry/src/main/resources/base/media/.*" desc="资源文件"/>
+                <filteritem type="filepath" name="example/harmony/entry/src/main/ets/assets/fonts/.*" desc="字体资源文件"/>
+                <filteritem type="filepath" name="example/harmony/AppScope/resources/base/media/.*" desc="资源文件"/>
+                <filteritem type="filepath" name=" example/harmony/entry/src/main/resources/rawfile/assets/.*" desc="资源文件"/>
             </filefilter>
         </filefilterlist>
     </oatconfig>

```

### `README.md`

```diff
@@ -1,13 +1,625 @@
-# @react-native-ohos/react-native-code-push
 
-This project is based on [react-native-code-push](https://github.com/microsoft/react-native-code-push)@9.0.1
+> 模板版本：v0.2.2
 
-## Documentation
+<p align="center">
+  <h1 align="center"> <code>react-native-code-push</code> </h1>
+</p>
+<p align="center">
+    <a href="https://github.com/microsoft/react-native-code-push">
+        <img src="https://img.shields.io/badge/platforms-android%20|%20ios%20|%20windows%20|%20harmony%20-lightgrey.svg" alt="Supported platforms" />
+    </a>
+    <a href="https://github.com/microsoft/react-native-code-push/blob/master/LICENSE.md">
+        <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" />
+        <!-- <img src="https://img.shields.io/badge/license-Apache-blue.svg" alt="License" /> -->
+    </a>
+</p>
 
-[中文](https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/zh-cn/react-native-code-push.md)
+> [!TIP] [Github 地址](https://github.com/react-native-oh-library/react-native-code-push)
 
-[English](https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/en/react-native-code-push.md)
+该第三方库的仓库已迁移至 Gitcode，且支持直接从 npm 下载，新的包名为：`@react-native-ohos/react-native-code-push`，具体版本所属关系如下：
 
-## License
+| Version                        | Package Name       | Repository          |  Release            |Supported RN Version  |
+| ------------------------------ | ----------------   | ------------------- | ------------------- | -------------------- |
+| <= 8.2.2-0.0.10@deprecated  |@react-native-oh-tpl/react-native-code-push|[Github](https://github.com/react-native-oh-library/react-native-code-push/releases) | [Github Releases](https://github.com/react-native-oh-library/react-native-code-push/releases) | 0.72       |
+| 8.2.3             | @react-native-ohos/react-native-code-push|[GitCode](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push) | [GitCode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push/releases)   | 0.72       |
+| 9.0.2             | @react-native-ohos/react-native-code-push|[GitCode](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push) | [GitCode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push/releases)   | 0.77       |
 
-This project is based on [MIT License (MIT)](https://github.com/microsoft/react-native-code-push/blob/master/LICENSE.md)
\ No newline at end of file
+## 前期准备
+
+### code-push-cli
+
+1. 克隆 [code-push-cli](https://github.com/react-native-oh-library/code-push-cli) 到本地
+2. 在 code-push-cli 目录下执行 `npm install`
+3. 在 code-push-cli 目录下执行 `npm run start`，用于生成 `bin` 目录
+4. npm install -g <code-push-cli文件夹目录>
+5. 重开一个终端，执行 `code-push -v`，如正常输出版本号即安装成功
+
+code-push-cli常用命令：
+
+```
+code-push -v
+code-push login <服务器地址>
+code-push app list //列出账号下面的所有app
+code-push app add <apppname> harmony react-native //创建应用
+code-push release <AppName> <bundle.harmony.js> "<版本号>" --description "<v1.0.0 测试更新>" -m //发包命令，加-m是强制更新, * 代表所有版本，例如：code-push release CodePush_Local ./bundle.harmony.js "*" --description "v1.0.0 测试更新"
+```
+```
+在工程目录下执行如下
+
+code-push login <服务器地址> //前提为先启动服务器（公网）
+会拉起网页 输入账户和密码 账户默认为admin 密码123456
+点击获取token
+复制token到命令行窗口
+提示登录成功
+
+# 确保 bundle 文件有微小修改
+echo "// Force update for 1.0.0 pending fix - $(date)" >> ./bundles/bundle.harmony.js
+
+"// Force update for 1.0.0 pending fix - $(date)"修改这里的字符即可
+
+# 发布针对 1.0.0 的强制更新
+code-push release MyApp-Harmony ./bundles/bundle.harmony.js 1.0.0 -d Staging --description "强制解决问题" --mandatory
+
+# 发布针对 1.0.0 的非强制更新
+code-push release MyApp-Harmony ./bundles/bundle.harmony.js 1.0.0 -d Staging --description "非强制解决问题"
+
+```
+
+### code-push-server
+
+#### 推荐在服务器搭建
+
+1. 克隆 [code-push-server](https://github.com/react-native-oh-library/code-push-server) 到本地
+2. 在 code-push-server 目录下执行 `npm install`
+4. 安装 mysql、redis
+5. 修改 `code-push-server/src/core/config.ts` 配置文件
+3. 在 code-push-server 目录下执行 `npm run dev`，用于生成 `bin` 目录
+6. 在 code-push-server 目录下执行 `npm run start` 启动服务
+
+```
+安装mysql
+# Ubuntu/Debian
+sudo apt update
+sudo apt install mysql-server
+# 启动服务
+sudo systemctl start mysql
+sudo mysql_secure_installation
+# 按照提示设置：
+# 1. 设置 root 密码
+# 2. 移除匿名用户
+# 3. 禁止远程 root 登录
+# 4. 移除测试数据库
+# 5. 重新加载权限表
+先全部输入y/yes
+
+# 先登录MySQL（不需要密码）
+sudo mysql
+# 在MySQL命令行中执行：
+ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的强密码';
+FLUSH PRIVILEGES;
+EXIT;
+
+# 现在需要用密码登录
+mysql -u root -p
+输入密码
+EXIT;
+
+# 编辑配置文件
+sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
+# 找到 bind-address 并修改
+# bind-address = 0.0.0.0  
+# 允许所有IP访问
+# Ctrl+S 保存并自动退出
+# 重启 MySQL
+
+sudo systemctl restart mysql
+
+安装redis
+sudo apt update
+sudo apt install redis-server -y
+
+# 启动并启用服务
+sudo systemctl start redis-server
+# 测试
+redis-cli ping 
+回复PONG
+# 编辑Redis配置文件
+sudo nano /etc/redis/redis.conf
+
+# 找到并修改以下行：
+# bind 0.0.0.0  # 如果需要远程访问
+# protected-mode no  # 如果设置bind 0.0.0.0，需要关闭保护模式
+# Ctrl+S 保存并自动退出
+# 重启Redis
+sudo systemctl restart redis-server
+```
+
+```
+修改文档部分
+code-push-server目录 code-push-server/src/core/config.ts  <127.0.0.1>  改为服务器地址
+
+code-push-server/src/db.ts 例如 .example(
+        '$0 init --dbname codepush --dbhost localhost（替换为服务器地址） --dbuser root --dbpassword <password>（替换为数据库密码） --dbport 3306 --force',
+        '初始化code-push-server数据库',
+    )
+在该文件中出现 localhost 字符 统一修改为服务器地址
+
+创建bin目录（可能会提示数据库codepush未创建）
+npm run dev （提示没有数据库codepush）Ctrl+C 强制退出
+执行
+npm run init  成功返回 success 创建数据库codepush
+执行
+npm run dev
+```
+
+## 安装与使用
+
+对于未发布到npm的旧版本，请参考[安装指南](./tgz-usage.md)安装tgz包。
+
+进入到工程目录并输入以下命令：
+
+<!-- tabs:start -->
+
+#### **npm**
+
+```bash
+npm install @react-native-ohos/react-native-code-push
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/react-native-code-push
+```
+
+<!-- tabs:end -->
+
+下面的代码展示了这个库的基本使用场景：
+
+> [!WARNING] 使用时 import 的库名不变。
+
+```js
+
+import React, {Component} from 'react'
+import {View, Text, StyleSheet, TouchableOpacity} from 'react-native'
+import CodePush from 'react-native-code-push';
+class App extends Component<any,any>{
+    constructor(props:any) {
+        super(props);
+        this.state={
+            syncMessage:'',
+            progress:{}
+        }
+    }
+    componentDidMount() {
+        console.log('开始检查更新')
+        this.syncImmediate(); //开始检查更新
+    }
+    syncImmediate() {
+        CodePush.sync(
+            {
+                updateDialog: {
+                    appendReleaseDescription: true, //是否显示更新description，默认为false
+                    descriptionPrefix: '更新内容：', //更新说明的前缀。 默认是” Description:
+                    mandatoryContinueButtonLabel: '立即更新', //强制更新的按钮文字，默认为continue
+                    mandatoryUpdateMessage: '', //- 强制更新时，更新通知. Defaults to “An update is available that must be installed.”.
+                    optionalIgnoreButtonLabel: '稍后', //非强制更新时，取消按钮文字,默认是ignore
+                    optionalInstallButtonLabel: '后台更新', //非强制更新时，确认文字. Defaults to “Install”
+                    optionalUpdateMessage: '有新版本了，是否更新？', //非强制更新时，更新通知. Defaults to “An update is available. Would you like to install it?”.
+                    title: '更新提示', //要显示的更新通知的标题. Defaults to “Update available”.
+                },
+            },
+            this.codePushStatusDidChange.bind(this),
+            this.codePushDownloadDidProgress.bind(this),
+        );
+    }
+
+    codePushStatusDidChange(syncStatus:string|number) {
+        switch (syncStatus) {
+            case CodePush.SyncStatus.CHECKING_FOR_UPDATE:
+                this.setState({syncMessage: 'Checking for update.'});
+                break;
+            case CodePush.SyncStatus.DOWNLOADING_PACKAGE:
+                this.setState({syncMessage: 'Downloading package.',progressModalVisible:true});
+                break;
+            case CodePush.SyncStatus.AWAITING_USER_ACTION:
+                this.setState({syncMessage: 'Awaiting user action.'});
+                break;
+            case CodePush.SyncStatus.INSTALLING_UPDATE:
+                this.setState({syncMessage: 'Installing update.',progressModalVisible:true});
+                break;
+            case CodePush.SyncStatus.UP_TO_DATE:
+                this.setState({syncMessage: 'App up to date.', progress: false});
+                break;
+            case CodePush.SyncStatus.UPDATE_IGNORED:
+                this.setState({syncMessage: 'Update cancelled by user.', progress: false,});
+                break;
+            case CodePush.SyncStatus.UPDATE_INSTALLED:
+                this.setState({syncMessage: 'Update installed and will be applied on restart.', progress: false,});
+                break;
+            case CodePush.SyncStatus.UNKNOWN_ERROR:
+                this.setState({syncMessage: 'An unknown error occurred.', progress: false,});
+                break;
+        }
+    }
+
+    codePushDownloadDidProgress(progress:any) {
+        this.setState({progress});
+    }
+
+    render(){
+        return(
+            <View style={styles.container}>
+                <Text style={styles.welcome}>欢迎使用热更新--test!</Text>
+                <Text>SyncStatus: { this.state.syncMessage}</Text>
+                <Text>{this.state.progressModalVisible.toString()}</Text>
+                <TouchableOpacity onPress={this.syncImmediate.bind(this)}>
+                    <Text style={styles.syncButton}>Press for dialog-driven sync</Text>
+                </TouchableOpacity>
+            </View>
+        )
+    }
+}
+
+const styles = StyleSheet.create({
+    container:{
+        flex: 1,
+        alignItems: 'center',
+        backgroundColor: '#F5FCFF',
+        paddingTop: 10,
+    },
+    welcome:{
+        fontSize: 20,
+        textAlign: 'center',
+        margin: 10,
+    },
+    syncButton: {
+        color: 'green',
+        fontSize: 17,
+    },
+})
+
+let codePushOptions = {checkFrequency: CodePush.CheckFrequency.MANUAL};
+
+
+export default CodePush(codePushOptions)(App);
+
+```
+
+## 使用 Codegen
+
+本库已经适配了 `Codegen` ，在使用前需要主动执行生成三方库桥接代码，详细请参考[ Codegen 使用文档](./codegen.md)。
+
+## Link
+
+|                                      | 是否支持autolink | RN框架版本 |
+|--------------------------------------|-----------------|------------|
+| ~9.0.2                              |  No              |  0.77     |
+| ~8.2.3                              |  Yes             |  0.72     |
+| <= 8.2.2-0.0.10@deprecated            |  No              |  0.72     |
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
+  ...
+  "overrides": {
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
+    "@react-native-ohos/react-native-code-push": "file:../../node_modules/@react-native-ohos/react-native-code-push/harmony/codePush.har"
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
+### 3.在 ArkTs 侧引入 CodePushPackage
+
+打开 `entry/src/main/ets/RNPackagesFactory.ts`，添加：
+
+```diff
+  ...
++ import { CodePushPackage } from "@react-native-ohos/react-native-code-push/ts";
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new SamplePackage(ctx),
++   new CodePushPackage(ctx)
+  ];
+}
+```
+### 4.配置 CMakeLists 和引入 CodePushPackage
+
+> 若使用的是 <= 8.2.2-0.0.10 版本，请跳过本章。
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
++ add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-code-push/src/main/cpp" ./codePush)
+
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
++ target_link_libraries(rnoh_app PUBLIC rnoh_code_push)
+# RNOH_END: manual_package_linking_2
+```
+打开 `entry/src/main/cpp/PackageProvider.cpp`，添加：
+
+```diff
+#include "RNOH/PackageProvider.h"
+#include "generated/RNOHGeneratedPackage.h"
+#include "SamplePackage.h"
++ #include "CodePushPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
+    return {
+      std::make_shared<RNOHGeneratedPackage>(ctx),
+      std::make_shared<SamplePackage>(ctx),
++     std::make_shared<CodePushPackage>(ctx)
+    };
+}
+```
+### 5.在 ArkTs 侧引入 comparingVersion 方法
+
+打开 `entry/src/main/ets/pages/index.ets`，调用 comparingVersion 方法比对code-push版本号，用于覆盖安装时清除沙箱历史资源
+
+```diff
++ import { comparingVersion } from "@react-native-ohos/react-native-code-push";
+
+@Entry
+@Component
+struct Index {
+  
+  aboutToAppear() {
++     comparingVersion(context);
+  }
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
+修改`entry\src\main\ets\pages\Index.ets`文件
+
+```diff
+...
++ import common from '@ohos.app.ability.common';
++ import BuildProfile from 'BuildProfile';
++ let context = getContext(this) as common.UIAbilityContext;
++ interface CodePushConfig{
++  Staging:String;
++  Production:String;
++  ServerUrl:String;
++  PublicKey:String;
++ }
+struct Index {
+  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined
+  @State shouldShow: boolean = false
+  private logger!: RNOHLogger
++ bundlePath:string = 'bundle.harmony.js'
+aboutToAppear() {
+     ...
++   this.setCodeConfig()
+    this.shouldShow = true
+    stopTracing()
+  }
++ setCodeConfig(){
++    const CodePushConfig: CodePushConfig = {
++      Staging:BuildProfile.Staging,
++      Production:BuildProfile.Production,
++      ServerUrl:BuildProfile.ServerUrl,
++      PublicKey:BuildProfile.PublicKey
++    }
++    AppStorage.SetOrCreate('CodePushConfig',CodePushConfig)
++  }
+build() {
+   Column() {
+    ...
+    RNApp({
+    jsBundleProvider:new TraceJSBundleProviderDecorator(
+            new AnyJSBundleProvider([
+              new MetroJSBundleProvider(),
+              // NOTE: to load the bundle from file, place it in
+              // `/data/app/el2/100/base/com.rnoh.tester/files/bundle.harmony.js`
+              // on your device. The path mismatch is due to app sandboxing on HarmonyOS
++              new FileJSBundleProvider(context.filesDir + '/Bundles/' + this.bundlePath),
+              new FileJSBundleProvider('/data/storage/el2/base/files/bundle.harmony.js'),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'bundle.harmony.js')
+            ]),
+            this.rnohCoreContext.logger),
+    })
+
+   }
+
+}
+```
+
+打开`entry/build-profile.json5`，添加配置
+
+```diff
+{
+  "apiType": 'stageMode',
+  "buildOption": {
+    "externalNativeOptions": {
+      "path": "./src/main/cpp/CMakeLists.txt",
+      "arguments": "",
+      "cppFlags": "-s",
+    },
++    "arkOptions": {
++      "buildProfileFields": {
++        "Staging": "", //测试环境Key
++        "Production": "",//生产环境Key
++        "ServerUrl": "",//服务端地址
++        "PublicKey": "PublicKey"
+      }
+    }
+  },
+  "targets": [
+    {
+      "name": "default",
+      "runtimeOS": "HarmonyOS"
+    },
+    {
+      "name": "ohosTest",
+    }
+  ]
+}
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
+
+## API
+
+| Name              | Description                                                                                                                  | Type     | Required | Platform                                | HarmonyOS Support |
+| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | --------------------------------------- | ----------------- |
+| sync              | sync方法，自动模式更新                                                                                                                | function | yes      | Android IOS | yes               |
+| getUpdateMetadata | 获取当前已安装更新的元数据(RemotePackage),当使用sync方法时，不需要调用本方法，因为sync会自动调用                                                                 | function | no       | Android iOS                             | yes               |
+| restartApp        | 重启App，当使用sync方法时，不需要调用本方法，因为sync会自动调用                                                                                        | function | no       | Android iOS                             | yes               |
+| getCurrentPackage | 获取应用版本信息，当使用sync方法时，不需要调用本方法，因为sync会自动调用                                                                                     | function | no       | Android iOS                             | yes               |
+| getConfiguration  | 获取应用配置信息，appVersion（版本号），deploymentKey（deploymentKey），serverUrl（服务器地址），clientUniqueId（唯一标识码）,当使用sync方法时，不需要调用本方法，因为sync会自动调用 | function | no       | Android iOS                             | yes               |
+
+**updateDialog**
+
+当使用**CodePush.updateDialog**方法时，updateDialog以下参数都是可选的，代表更新的对话框，默认是null, 
+
+| Name                         | Description                                                                      | Type    | Required | Platform    | HarmonyOS Support |
+| ---------------------------- | -------------------------------------------------------------------------------- | ------- | -------- | ----------- | ----------------- |
+| appendReleaseDescription     | 是否显示更新description，默认为false                                                       | boolean | no       | Android iOS | yes               |
+| descriptionPrefix            | 更新说明的前缀。 默认是” Description:                                                       | string  | no       | Android iOS | yes               |
+| mandatoryContinueButtonLabel | 强制更新的按钮文字，默认为continue                                                            | string  | no       | Android iOS | yes               |
+| mandatoryUpdateMessage       | 强制更新时，更新通知. Defaults to “An update is available that must be installed.”         | string  | no       | Android iOS | yes             
... [diff 已截断]
```

### `README_en.md`

```diff
@@ -0,0 +1,627 @@
+> Template version: v0.2.2
+
+<p align="center">
+  <h1 align="center"> <code>react-native-code-push</code> </h1>
+</p>
+<p align="center">
+    <a href="https://github.com/microsoft/react-native-code-push">
+        <img src="https://img.shields.io/badge/platforms-android%20|%20ios%20|%20windows%20|%20harmony%20-lightgrey.svg" alt="Supported platforms" />
+    </a>
+    <a href="https://github.com/microsoft/react-native-code-push/blob/master/LICENSE.md">
+        <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" />
+        <!-- <img src="https://img.shields.io/badge/license-Apache-blue.svg" alt="License" /> -->
+    </a>
+</p>
+
+> [!TIP] [Github address](https://github.com/react-native-oh-library/react-native-code-push)
+
+The repository for this third-party library has been migrated to Gitcode, and it now supports direct download from npm. The new package name is: `@react-native-ohos/react-native-code-push`. The specific version relationships are as follows:
+
+| Version                        | Package Name       | Repository          |  Release            |Supported RN Version  |
+| ------------------------------ | ----------------   | ------------------- | ------------------- | -------------------- |
+| <= 8.2.2-0.0.10@deprecated  |@react-native-oh-tpl/react-native-code-push|[Github](https://github.com/react-native-oh-library/react-native-code-push/releases) | [Github Releases](https://github.com/react-native-oh-library/react-native-code-push/releases) | 0.72       |
+| 8.2.3             | @react-native-ohos/react-native-code-push|[GitCode](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push) | [GitCode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push/releases)   | 0.72       |
+| 9.0.2             | @react-native-ohos/react-native-code-push|[GitCode](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push) | [GitCode Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-code-push/releases)   | 0.77       |
+
+## Pre-preparation
+
+### code-push-cli
+
+1. Clone the [code-push-cli](https://github.com/react-native-oh-library/code-push-cli) to the local host.
+2. Run the `npm install` command in the code-push-cli directory.
+3. Run the `npm run start` command in the code-push-cli directory to generate the `bin` directory.
+4. npm install -g <code-push-cli directory>
+5. Restart a terminal and run the `code-push -v` command. If the version number is displayed, the installation is successful.
+
+Common commands for code-push-cli are as follows:
+
+```
+code-push -v
+code-push login
+code-push app list //List all apps under the account.
+code-push app add <apppname> harmony react-native // Creating an Application
+code-push release <AppName> <bundle.harmony.js> "< version number > "--description "<v1.0.0 test update >" -m //Packet sending command. Add -m to forcibly update the version. The asterisk (*) indicates all versions, for example, code-push release CodePush_Local ./bundle.harmony.js "*" --description "v1.0.0 Test Update"
+```
+```
+Execute the following commands in the project directory:
+
+code-push login <server_address> // Prerequisite: Server must be started (public network accessible)
+This will open a webpage. Enter account and password (default account: admin, password: 123456)
+Click "Get token"
+Copy the token to the command line window
+Prompt shows login successful
+
+# Ensure the bundle file has minor modifications
+echo "// Force update for 1.0.0 pending fix - $(date)" >> ./bundles/bundle.harmony.js
+
+Modify the characters in "// Force update for 1.0.0 pending fix - $(date)" as needed
+
+# Publish a mandatory update for version 1.0.0
+code-push release MyApp-Harmony ./bundles/bundle.harmony.js 1.0.0 -d Staging --description "Force fix for issues" --mandatory
+
+# Publish a non-mandatory update for version 1.0.0
+code-push release MyApp-Harmony ./bundles/bundle.harmony.js 1.0.0 -d Staging --description "Non-mandatory fix for issues"
+
+```
+### code-push-server
+
+1. Clone the [code-push-server](https://github.com/react-native-oh-library/code-push-server) to the local host.
+2. Run the `npm install` command in the code-push-server directory.
+3. Install the MySQL and Redis.
+4. Modifying the `code-push-server/src/core/config.ts` Configuration File
+5. Run the `npm run dev` command in the code-push-server directory to generate the `bin` directory.
+6. Run the `npm run start` command in the code-push-server directory to start the service.
+```
+Install MySQL
+# Ubuntu/Debian
+sudo apt update
+sudo apt install mysql-server
+# Start service
+sudo systemctl start mysql
+sudo mysql_secure_installation
+# Follow the prompts to set up:
+# 1. Set root password
+# 2. Remove anonymous users
+# 3. Disallow remote root login
+# 4. Remove test database
+# 5. Reload privilege tables
+First enter y/yes for all
+
+# First log in to MySQL (no password required)
+sudo mysql
+# Execute in MySQL command line:
+ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_strong_password';
+FLUSH PRIVILEGES;
+EXIT;
+
+# Now log in with password
+mysql -u root -p
+Enter password
+EXIT;
+
+# Edit configuration file
+sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
+# Find bind-address and modify
+# bind-address = 0.0.0.0  
+# Allow all IP access
+# Ctrl+S to save and exit automatically
+# Restart MySQL
+
+sudo systemctl restart mysql
+
+Install Redis
+sudo apt update
+sudo apt install redis-server -y
+
+# Start and enable service
+sudo systemctl start redis-server
+# Test
+redis-cli ping 
+Should reply PONG
+# Edit Redis configuration file
+sudo nano /etc/redis/redis.conf
+
+# Find and modify the following lines:
+# bind 0.0.0.0  # If remote access is needed
+# protected-mode no  # If bind is set to 0.0.0.0, need to turn off protected mode
+# Ctrl+S to save and exit automatically
+# Restart Redis
+sudo systemctl restart redis-server
+```
+
+```
+Modify document sections
+In the code-push-server directory, modify code-push-server/src/core/config.ts  <127.0.0.1>  Change to server address
+
+In code-push-server/src/db.ts, for example:
+    .example(
+        '$0 init --dbname codepush --dbhost localhost (replace with server address) --dbuser root --dbpassword <password> (replace with database password) --dbport 3306 --force',
+        'Initialize code-push-server database',
+    )
+In this file, replace all occurrences of 'localhost' with server address
+
+Create bin directory (might prompt that database codepush is not created)
+npm run dev (prompts that database codepush doesn't exist) Ctrl+C to force exit
+Execute
+npm run init  Success returns "success" and creates database codepush
+Execute
+npm run dev
+```
+
+## Installation and Usage
+
+For older versions not published on npm, please refer to the [Installation Guide](./tgz-usage-en.md) to install the tgz package.
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
+npm install @react-native-ohos/react-native-code-push
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/react-native-code-push
+```
+
+<!-- tabs:end -->
+
+The following code shows the basic use scenario of the repository:
+
+> [!WARNING] The name of the imported repository remains unchanged.
+
+```js
+import React, { Component } from "react";
+import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
+import CodePush from "react-native-code-push";
+class App extends Component<any, any> {
+  constructor(props: any) {
+    super(props);
+    this.state = {
+      syncMessage: "",
+      progress: {},
+    };
+  }
+  componentDidMount() {
+    console.log("Begin checking for updates.");
+    this.syncImmediate(); 
+  }
+  syncImmediate() {
+    CodePush.sync(
+      {
+        updateDialog: {
+          appendReleaseDescription: true, 
+          descriptionPrefix: "Update content:", 
+          mandatoryContinueButtonLabel: "Update immediately.", 
+          mandatoryUpdateMessage: "", 
+          optionalIgnoreButtonLabel: "later", 
+          optionalInstallButtonLabel: "Background update.",
+          optionalUpdateMessage: "There's a new version available. Would you like to update?", 
+          title: "Update notification.",
+        },
+      },
+      this.codePushStatusDidChange.bind(this),
+      this.codePushDownloadDidProgress.bind(this)
+    );
+  }
+
+  codePushStatusDidChange(syncStatus: string | number) {
+    switch (syncStatus) {
+      case CodePush.SyncStatus.CHECKING_FOR_UPDATE:
+        this.setState({ syncMessage: "Checking for update." });
+        break;
+      case CodePush.SyncStatus.DOWNLOADING_PACKAGE:
+        this.setState({
+          syncMessage: "Downloading package.",
+          progressModalVisible: true,
+        });
+        break;
+      case CodePush.SyncStatus.AWAITING_USER_ACTION:
+        this.setState({ syncMessage: "Awaiting user action." });
+        break;
+      case CodePush.SyncStatus.INSTALLING_UPDATE:
+        this.setState({
+          syncMessage: "Installing update.",
+          progressModalVisible: true,
+        });
+        break;
+      case CodePush.SyncStatus.UP_TO_DATE:
+        this.setState({ syncMessage: "App up to date.", progress: false });
+        break;
+      case CodePush.SyncStatus.UPDATE_IGNORED:
+        this.setState({
+          syncMessage: "Update cancelled by user.",
+          progress: false,
+        });
+        break;
+      case CodePush.SyncStatus.UPDATE_INSTALLED:
+        this.setState({
+          syncMessage: "Update installed and will be applied on restart.",
+          progress: false,
+        });
+        break;
+      case CodePush.SyncStatus.UNKNOWN_ERROR:
+        this.setState({
+          syncMessage: "An unknown error occurred.",
+          progress: false,
+        });
+        break;
+    }
+  }
+
+  codePushDownloadDidProgress(progress: any) {
+    this.setState({ progress });
+  }
+
+  render() {
+    return (
+      <View style={styles.container}>
+        <Text style={styles.welcome}>Welcome to the hot update--test!</Text>
+        <Text>SyncStatus: {this.state.syncMessage}</Text>
+        <Text>{this.state.progressModalVisible.toString()}</Text>
+        <TouchableOpacity onPress={this.syncImmediate.bind(this)}>
+          <Text style={styles.syncButton}>Press for dialog-driven sync</Text>
+        </TouchableOpacity>
+      </View>
+    );
+  }
+}
+
+const styles = StyleSheet.create({
+  container: {
+    flex: 1,
+    alignItems: "center",
+    backgroundColor: "#F5FCFF",
+    paddingTop: 10,
+  },
+  welcome: {
+    fontSize: 20,
+    textAlign: "center",
+    margin: 10,
+  },
+  syncButton: {
+    color: "green",
+    fontSize: 17,
+  },
+});
+
+let codePushOptions = { checkFrequency: CodePush.CheckFrequency.MANUAL };
+
+export default CodePush(codePushOptions)(App);
+```
+
+## Use Codegen
+
+This library has been adapted for `Codegen`. Before using it, you need to proactively generate the bridge code for the third-party library. For details, please refer to the [Codegen Usage Documentation](./codegen.md).
+
+## Link
+
+|                                      | Is supported autolink  | Supported RN Version |
+|--------------------------------------|-----------------------|----------------------|
+| ~9.0.2                              |  No              |  0.77     |
+| ~8.2.3                              |  Yes             |  0.72     |
+| <= 8.2.2-0.0.10@deprecated            |  No              |  0.72     |
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
+  ...
+  "overrides": {
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
+    "@react-native-ohos/react-native-code-push": "file:../../node_modules/@react-native-ohos/react-native-code-push/harmony/codePush.har"
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
+### 3. Introducing CodePushPackage to ArkTS
+
+Open the `entry/src/main/ets/RNPackagesFactory.ts` file and add the following code:
+
+```diff
+  ...
++ import { CodePushPackage } from "@react-native-ohos/react-native-code-push/ts";
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new SamplePackage(ctx),
++   new CodePushPackage(ctx)
+  ];
+}
+```
+
+### 4. Configuring CMakeLists and Introducing CodePushPackage
+
+> If you are using version <= 8.2.2-0.0.10, please skip this chapter.
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
++ add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-code-push/src/main/cpp" ./codePush)
+
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
++ target_link_libraries(rnoh_app PUBLIC rnoh_code_push)
+# RNOH_END: manual_package_linking_2
+```
+
+Open `entry/src/main/cpp/PackageProvider.cpp` and add the following code:
+
+```diff
+#include "RNOH/PackageProvider.h"
+#include "generated/RNOHGeneratedPackage.h"
+#include "SamplePackage.h"
++ #include "CodePushPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
+    return {
+      std::make_shared<RNOHGeneratedPackage>(ctx),
+      std::make_shared<SamplePackage>(ctx),
++     std::make_shared<CodePushPackage>(ctx)
+    };
+}
+```
+
+### 5. Introduce the comparingVersion method on the ArkTs side
+
+Open `entry/src/main/ets/pages/index.ets` and invoke the comparingVersion method to compare the code-push version number to clear historical sandbox resources during installation.
+
+```diff
++ import { comparingVersion } from "@react-native-ohos/react-native-code-push";
+
+@Entry
+@Component
+struct Index {
+
+  aboutToAppear() {
++     comparingVersion(context);
+  }
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
+Modifying the `entry\src\main\ets\pages\Index.ets` file.
+
+```diff
+...
++ import common from '@ohos.app.ability.common';
++ import BuildProfile from 'BuildProfile';
++ let context = getContext(this) as common.UIAbilityContext;
++ interface CodePushConfig{
++  Staging:String;
++  Production:String;
++  ServerUrl:String;
++  PublicKey:String;
++ }
+struct Index {
+  @StorageLink('RNOHCoreContext') private rnohCoreContext: RNOHCoreContext | undefined = undefined
+  @State shouldShow: boolean = false
+  private logger!: RNOHLogger
++ bundlePath:string = 'bundle.harmony.js'
+aboutToAppear() {
+     ...
++   this.setCodeConfig()
+    this.shouldShow = true
+    stopTracing()
+  }
++ setCodeConfig(){
++    const CodePushConfig: CodePushConfig = {
++      Staging:BuildProfile.Staging,
++      Production:BuildProfile.Production,
++      ServerUrl:BuildProfile.ServerUrl,
++      PublicKey:BuildProfile.PublicKey
++    }
++    AppStorage.SetOrCreate('CodePushConfig',CodePushConfig)
++  }
+build() {
+   Column() {
+    ...
+    RNApp({
+    jsBundleProvider:new TraceJSBundleProviderDecorator(
+            new AnyJSBundleProvider([
+              new MetroJSBundleProvider(),
+              // NOTE: to load the bundle from file, place it in
+              // `/data/app/el2/100/base/com.rnoh.tester/files/bundle.harmony.js`
+              // on your device. The path mismatch is due to app sandboxing on HarmonyOS
++              new FileJSBundleProvider(context.filesDir + '/Bundles/' + this.bundlePath),
+              new FileJSBundleProvider('/data/storage/el2/base/files/bundle.harmony.js'),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'hermes_bundle.hbc'),
+              new ResourceJSBundleProvider(this.rnohCoreContext.uiAbilityContext.resourceManager, 'bundle.harmony.js')
+            ]),
+            this.rnohCoreContext.logger),
+    })
+
+   }
+
+}
+```
+
+Open `entry/build-profile.json5` and add configuration
+
+```diff
+{
+  "apiType": 'stageMode',
+  "buildOption": {
+    "externalNativeOptions": {
+      "path": "./src/main/cpp/CMakeLists.txt",
+      "arguments": "",
+      "cppFlags": "-s",
+    },
++    "arkOptions": {
++      "buildProfileFields": {
++        "Staging": "", //Test Environment Key
++        "Production": "",//Production Environment Key
++        "ServerUrl": "",//Server address
++        "PublicKey": "PublicKey"
+      }
+    }
+  },
+  "targets": [
+    {
+      "name": "default",
+      "runtimeOS": "HarmonyOS"
+    },
+    {
+      "name": "ohosTest",
+    }
+  ]
+}
+```
+
+Then build and run the code.
+
+## Constraints
+
+### Compatibility
+
+
+To use this repository, you need to use the correct React-Native and RNOH versions. In addition, you need to use DevEco Studio and the ROM on your phone.
+
+Verified in the following versions.
+
+1. RNOH: 0.72.96; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+2. RNOH: 0.72.33; SDK: HarmonyOS NEXT B1; IDE: DevEco Studio: 5.0.3.900; ROM: Next.0.0.71;
+3. RNOH: 0.77.18; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
+
+
+## API
+
+| Name              | Description                                                                                                                                                                                                                                                                               | Type     | Required | Platform    | HarmonyOS Support |
+| ----------------- | ----------------------------------------------------------------------------
... [diff 已截断]
```

### `buildEnv.sh`

```diff
@@ -0,0 +1,8 @@
+#!/bin/bash
+BUILD_PKG_DIR=example
+BUILD_SAMPLE_DIR=example/harmony
+BUILD_THIRD_PARTY_DIR=harmony/
+
+# BUILD_PKG_DIR: 用来打 tgz 包的工程目录
+# BUILD_SAMPLE_DIR：用来打 har 包的目录
+# BUILD_THIRD_PARTY_DIR：库模块源码目录

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
@@ -0,0 +1,5 @@
+module.exports = {
+  presets: ['module:metro-react-native-babel-preset'],
+  plugins: [
+  ],
+};

```

### `example/contexts.ts`

```diff
@@ -0,0 +1,26 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
+mport React from 'react';
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
@@ -0,0 +1,39 @@
+{
+  "app": {
+    "products": [
+      {
+        "name": 'default',
+        "signingConfig": 'default',
+        compatibleSdkVersion: '5.0.0(12)',
+        "runtimeOS": 'HarmonyOS'
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
+      "name": "codePush",
+      "srcPath": '../../harmony/codePush'
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
@@ -0,0 +1,19 @@
+{
+  "apiType": 'stageMode',
+  "buildOption": {
+    "externalNativeOptions": {
+      "path": "./src/main/cpp/CMakeLists.txt",
+      "arguments": "",
+      "cppFlags": "-s",
+    },
+  },
+  "targets": [
+    {
+      "name": "default",
+      "runtimeOS": "HarmonyOS"
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
@@ -0,0 +1,17 @@
+/*
+ * Copyright (c) 2024 Huawei Device Co., Ltd.
+ * Licensed under the Apache License, Version 2.0 (the "License");
+ * you may not use this file except in compliance with the License.
+ * You may obtain a copy of the License at
+ *
+ *     http://www.apache.org/licenses/LICENSE-2.0
+ *
+ * Unless required by applicable law or agreed to in writing, software
+ * distributed under the License is distributed on an "AS IS" BASIS,
+ * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
+ * See the License for the specific language governing permissions and
+ * limitations under the License.
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
+    "@react-native-ohos/react-native-code-push": "file:../../node_modules/@react-native-ohos/react-native-code-push/harmony/codePush.har",
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
@@ -0,0 +1,35 @@
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
+add_subdirectory("${RNOH_CPP_DIR}" ./rn)
+
+# RNOH_BEGIN: manual_package_linking_1
+add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-code-push/src/main/cpp" ./rnoh_code_push)
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
+target_link_libraries(rnoh_app PUBLIC rnoh_code_push)
+
+# RNOH_END: manual_package_linking_2

```

### `example/harmony/entry/src/main/cpp/PackageProvider.cpp`

```diff
@@ -0,0 +1,35 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
+#include "RNOH/PackageProvider.h"
+#include "generated/RNOHGeneratedPackage.h"
+#include "CodePushPackage.h"
+
+using namespace rnoh;
+
+std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
+    return {
+        std::make_shared<RNOHGeneratedPackage>(ctx), // generated by codegen v1
+        std::make_shared<CodePushPackage>(ctx)
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
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
+import CodePushPackage from '@react-native-ohos/react-native-code-push';
+
+export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
+  return [
+    new CodePushPackage(ctx)
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
@@ -0,0 +1,37 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
+import {RNAbility} from '@rnoh/react-native-openharmony';
+import { AbilityConstant, Want } from '@kit.AbilityKit';
+
+export default class EntryAbility extends RNAbility {
+
+  onCreate(want: Want) {
+    super.onCreate(want)
+  }
+
+  getPagePath() {
+    return 'pages/Index';
+  }
+}

```

### `example/harmony/entry/src/main/ets/pages/Index.ets`

```diff
@@ -0,0 +1,136 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
@@ -0,0 +1,60 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
@@ -0,0 +1,12 @@
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
@@ -0,0 +1,2 @@
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
+     "@rnoh/react-native-openharmony": "file:./../node_modules/react-native-harmony/react_native_openharmony.har"
+  },
+  "dynamicDependencies": {}
+}
\ No newline at end of file

```

### `example/index.js`

```diff
@@ -0,0 +1,28 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
+import {AppRegistry, View, Text} from 'react-native';
+import {name as appName} from './app.json';
+import App from './src/codepush';
+
+AppRegistry.registerComponent(appName, () => App);
\ No newline at end of file

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
@@ -0,0 +1,24 @@
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
@@ -0,0 +1,68 @@
+{
+  "name": "react-native-harmony-tester",
+  "version": "1.0.0",
+  "private": true,
+  "scripts": {
+    "i": "cd ../ && npm i && npm run pack && cd ./example && npm i",
+    "reStart": "npm run install:pkg && npm run codegen && hdc rport tcp:8081 tcp:8081 && react-native start",
+    "start": "hdc rport tcp:8081 tcp:8081 && react-native start",
+    "codegen": "react-native codegen-harmony --rnoh-module-path ./harmony/entry/oh_modules/@rnoh/react-native-openharmony",
+    "pack:pkg": "cd ../ && npm run pack && cd ./example",
+    "install:pkg": "npm uninstall @react-native-ohos/react-native-code-push && npm run pack:pkg && npm i @react-native-ohos/react-native-code-push@file:../react-native-ohos-react-native-code-push-8.2.3.tgz",
+    "dev": "npm run codegen && react-native bundle-harmony --dev --minify=false",
+    "prod": "npm run codegen && react-native bundle-harmony --dev=false --minify=true",
+    "postinstall": "node ./scripts/create-build-profile",
+  "fast-install-project": "cd ../ && npm i --force && npm run pack && rm -r node_modules && cd ./example && npm i --force",
+    "fast:pkg": "npm run fast-install-project && npm run dev"
+  },
+  "dependencies": {
+    "@gorhom/portal": "^1.0.14",
+    "@react-native-ohos/react-native-code-push": "file:../react-native-ohos-react-native-code-push-8.2.3.tgz",
+    "@rnoh/testerino": "npm:@react-native-oh-tpl/testerino@0.0.9",
+    "react": "18.2.0",
+    "react-native": "0.72.5",
+    "react-native-harmony": "npm:@react-native-oh/react-native-harmony@^0.72.32"
+  },
+  "devDependencies": {
+    "@babel/core": "^7.20.0",
+    "@babel/preset-env": "^7.20.0",
+    "@babel/runtime": "^7.20.0",
+    "@react-native-community/eslint-config": "^3.2.0",
+    "@react-native/eslint-config": "^0.74.0",
+    "@react-native/metro-config": "^0.72.6",
+    "@tsconfig/react-native": "^2.0.2",
+    "@types/chai": "^4.3.4",
+    "@types/d3-scale-chromatic": "^3.0.0",
+    "@types/fs-extra": "^11.0.1",
+    "@types/jest": "^29.5.5",
+    "@types/metro-config": "^0.76.2",
+    "@types/react": "17.0.14",
+    "@types/react-dom": "17.0.14",
+    "@types/react-test-renderer": "^18.0.0",
+    "babel-jest": "^29.2.1",
+    "csv-parser": "^3.0.0",
+    "eslint": "^8.19.0",
+    "eslint-plugin-prettier": "^5.0.1",
+    "fs-extra": "^11.1.1",
+    "husky": "^8.0.3",
+    "jest": "^29.7.0",
+    "json5": "^2.2.3",
+    "metro": "^0.76.3",
+    "metro-config": "^0.76.3",
+    "metro-react-native-babel-preset": "0.73.9",
+    "prettier": "3.2.4",
+    "react-test-renderer": "18.2.0",
+    "simple-statistics": "^7.8.3",
+    "ts-jest": "^29.1.1",
+    "typescript": "^5.3.2",
+    "yargs": "^17.7.2"
+  },
+  "overrides": {
+    "@rnoh/react-native-harmony-cli": "npm:@react-native-oh/react-native-harmony-cli@^0.0.27",
+    "@react-native-community/cli": "11.3.6",
+    "@react-native/codegen": "0.74.0"
+  },
+  "resolutions": {
+    "@react-native-community/cli": "11.3.6"
+  }
+}

```

### `example/react-native.config.js`

```diff
@@ -0,0 +1,5 @@
+module.exports = {
+  project: {
+  },
+  assets: ['./assets/fonts/'],
+};

```

### `example/scripts/create-build-profile.js`

```diff
@@ -0,0 +1,39 @@
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

### `example/src/codepush.tsx`

```diff
@@ -0,0 +1,126 @@
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
+import React, {Component} from 'react'
+import {View, Text, StyleSheet, TouchableOpacity} from 'react-native'
+import CodePush from 'react-native-code-push';
+class App extends Component<any,any>{
+    constructor(props:any) {
+        super(props);
+        this.state={
+            syncMessage:'',
+            progress:{}
+        }
+    }
+    componentDidMount() {
+        console.log('开始检查更新')
+        this.syncImmediate(); //开始检查更新
+    }
+    syncImmediate() {
+        CodePush.sync(
+            {
+                updateDialog: {
+                    appendReleaseDescription: true, //是否显示更新description，默认为false
+                    descriptionPrefix: '更新内容：', //更新说明的前缀。 默认是” Description:
+                    mandatoryContinueButtonLabel: '立即更新', //强制更新的按钮文字，默认为continue
+                    mandatoryUpdateMessage: '', //- 强制更新时，更新通知. Defaults to “An update is available that must be installed.”.
+                    optionalIgnoreButtonLabel: '稍后', //非强制更新时，取消按钮文字,默认是ignore
+                    optionalInstallButtonLabel: '后台更新', //非强制更新时，确认文字. Defaults to “Install”
+                    optionalUpdateMessage: '有新版本了，是否更新？', //非强制更新时，更新通知. Defaults to “An update is available. Would you like to install it?”.
+                    title: '更新提示', //要显示的更新通知的标题. Defaults to “Update available”.
+                },
+            },
+            this.codePushStatusDidChange.bind(this),
+            this.codePushDownloadDidProgress.bind(this),
+        );
+    }
+
+    codePushStatusDidChange(syncStatus:string|number) {
+        switch (syncStatus) {
+            case CodePush.SyncStatus.CHECKING_FOR_UPDATE:
+                this.setState({syncMessage: 'Checking for update.'});
+                break;
+            case CodePush.SyncStatus.DOWNLOADING_PACKAGE:
+                this.setState({syncMessage: 'Downloading package.',progressModalVisible:true});
+                break;
+            case CodePush.SyncStatus.AWAITING_USER_ACTION:
+                this.setState({syncMessage: 'Awaiting user action.'});
+                break;
+            case CodePush.SyncStatus.INSTALLING_UPDATE:
+                this.setState({syncMessage: 'Installing update.',progressModalVisible:true});
+                break;
+            case CodePush.SyncStatus.UP_TO_DATE:
+                this.setState({syncMessage: 'App up to date.', progress: false});
+                break;
+            case CodePush.SyncStatus.UPDATE_IGNORED:
+                this.setState({syncMessage: 'Update cancelled by user.', progress: false,});
+                break;
+            case CodePush.SyncStatus.UPDATE_INSTALLED:
+                this.setState({syncMessage: 'Update installed and will be applied on restart.', progress: false,});
+                break;
+            case CodePush.SyncStatus.UNKNOWN_ERROR:
+                this.setState({syncMessage: 'An unknown error occurred.', progress: false,});
+                break;
+        }
+    }
+
+    codePushDownloadDidProgress(progress:any) {
+        this.setState({progress});
+    }
+
+    render(){
+        return(
+            <View style={styles.container}>
+                <Text style={styles.welcome}>欢迎使用热更新--test!</Text>
+                <Text>SyncStatus: { this.state.syncMessage}</Text>
+                <Text>{this.state.progressModalVisible.toString()}</Text>
+                <TouchableOpacity onPress={this.syncImmediate.bind(this)}>
+                    <Text style={styles.syncButton}>Press for dialog-driven sync</Text>
+                </TouchableOpacity>
+            </View>
+        )
+    }
+}
+
+const styles = StyleSheet.create({
+    container:{
+        flex: 1,
+        alignItems: 'center',
+        backgroundColor: '#F5FCFF',
+        paddingTop: 10,
+    },
+    welcome:{
+        fontSize: 20,
+        textAlign: 'center',
+        margin: 10,
+    },
+    syncButton: {
+        color: 'green',
+        fontSize: 17,
+    },
+})
+
+let codePushOptions = {checkFrequency: CodePush.CheckFrequency.MANUAL};
+
+
+export default CodePush(codePushOptions)(App);
\ No newline at end of file

```

### `example/tsconfig.json`

```diff
@@ -0,0 +1,14 @@
+{
+  "extends": "@tsconfig/react-native/tsconfig.json",
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

### `harmony/codePush/index.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import { CodePushPackage } from './src/main/ets/CodePushPackage';

```

### `harmony/codePush/src/main/ets/CodePush.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import common from '@ohos.app.ability.common';

```

### `harmony/codePush/src/main/ets/CodePushBuilder.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import common from '@ohos.app.ability.common';

```

### `harmony/codePush/src/main/ets/CodePushConstants.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export class CodePushConstants {

```

### `harmony/codePush/src/main/ets/CodePushInstallMode.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export const CodePushInstallMode = {

```

### `harmony/codePush/src/main/ets/CodePushInvalidPublicKeyException.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export class CodePushInvalidPublicKeyException extends Error {

```

### `harmony/codePush/src/main/ets/CodePushInvalidUpdateException.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export class CodePushInvalidUpdateException extends Error {

```

### `harmony/codePush/src/main/ets/CodePushMalformedDataException.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export class CodePushMalformedDataException extends Error {

```

### `harmony/codePush/src/main/ets/CodePushNativeModule.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import { CodePushConstants } from './CodePushConstants';
@@ -53,14 +71,12 @@ export class CodePushNativeModule extends UITurboModule implements TM.RTNCodePus
   private preferences: dataPreferences.Preferences | null = null;
   private mTelemetryManager: CodePushTelemetryManager | null = null;
   private mSettingsManager: SettingsManager | null = null;
+  private _restartInProgress: boolean = false;
+  private _allowed: boolean = true;
   private mUpdateManager: CodePushUpdateManager | null = null;
   private installMode: number = -1;
   private ready: boolean = false;
 
-  sync(): Promise<unknown> {
-    throw new Error('Method not implemented.');
-  }
-
   constructor(rnContext: UITurboModuleContext, codePush: CodePush) {
     super(rnContext);
     Logger.info(TAG, `constructor start`)
@@ -167,20 +183,15 @@ export class CodePushNativeModule extends UITurboModule implements TM.RTNCodePus
         // The caller wants the running update, but the current
         // one is pending, so we need to grab the previous.
 
-        // let previousPackage = new CodePushUpdateManager('').getPreviousPackage();
+        let previousPackage = new CodePushUpdateManager('').getPreviousPackage();
 
-        // if (previousPackage == null) {
-        //   Logger.info(TAG, `currentPackage previousPackage is null`);
-        //   return null;
-        // }
-
-        // return previousPackage;
-        let previousPackage = new CodePushUpdateManager('').getCurrentPackageInfo();
-        const packageHash = {
-          packageHash:previousPackage['previousPackage']
+        if (previousPackage == null) {
+          Logger.info(TAG, `currentPackage previousPackage is null`);
+          return null;
         }
-        Logger.info(TAG, `doInBackgroundForUpdateMetadata previousPackage=${packageHash}`);
-        return packageHash
+
+        Logger.info(TAG, `doInBackgroundForUpdateMetadata previousPackage=${JSON.stringify(previousPackage)}`);
+        return previousPackage;
       } else {
         if (this.mCodePush.isRunningBinaryVersion()) {
           currentPackage["_isDebugOnly"] = true;
@@ -298,6 +309,7 @@ export class CodePushNativeModule extends UITurboModule implements TM.RTNCodePus
   async disallow() {
     return new Promise((resolve) => {
       Logger.info(TAG, "Disallowing restarts");
+      this._allowed = false;
       resolve(null);
     })
   }
@@ -319,6 +331,33 @@ export class CodePushNativeModule extends UITurboModule implements TM.RTNCodePus
     }
   }
 
+  restartAppInternal(onlyIfUpdateIsPending: boolean) {
+    // 1. 防重入检查
+    if (this._restartInProgress) {
+      this._restartQueue.push(onlyIfUpdateIsPending);
+      return;
+    }
+    // 2. 允许重启检查
+    else if (!this._allowed) {
+      this._restartQueue.push(onlyIfUpdateIsPending);
+      return;
+    }
+    this._restartInProgress = true;
+    // 3. onlyIfUpdateIsPending 检查
+    if (!onlyIfUpdateIsPending || this.mSettingsManager.isPendingUpdate(null)) {
+      this.loadBundle();
+      this._restartInProgress = false;
+      return;
+    }
+    this._restartInProgress = false;
+    // 4. 处理排队请求
+    if (this._restartQueue.length > 0) {
+      let buf: boolean = this._restartQueue[0];
+      this._restartQueue.splice(0, 1);
+      this.restartAppInternal(buf);
+    }
+  }
+
   async setLatestRollbackInfo(packageHash: string): Promise<null | string> {
     try {
       this.mSettingsManager.setLatestRollbackInfo(packageHash);
@@ -362,13 +401,10 @@ export class CodePushNativeModule extends UITurboModule implements TM.RTNCodePus
 
   }
 
-  restartAppInternal(onlyIfUpdateIsPending: boolean) {
-    this.loadBundle();
-  }
-
   async allow() {
     return new Promise((resolve) => {
       Logger.info(TAG, "Re-allowing restarts");
+      this._allowed = true;
       if (this._restartQueue.length > 0) {
         Logger.info(TAG, "Executing pending restart");
         let buf: boolean = this._restartQueue[0];
@@ -426,6 +462,9 @@ export class CodePushNativeModule extends UITurboModule implements TM.RTNCodePus
     if(this.installMode === 0 || this.installMode === -1){
       this.ctx.devToolsController.eventEmitter.emit("RELOAD", { reason: 'HotReload2' })
     }
+    if (this.installMode === 1) {
+      this.installMode = -1;
+    }
     Logger.info(TAG, "restartAppInternal RELOAD end");
   }
 

```

### `harmony/codePush/src/main/ets/CodePushNotInitializedException.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export class CodePushNotInitializedException extends Error {

```

### `harmony/codePush/src/main/ets/CodePushPackage.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import { RNOHPackage, UITurboModule,UITurboModuleContext,UITurboModuleFactory } from "@rnoh/react-native-openharmony";

```

### `harmony/codePush/src/main/ets/CodePushTelemetryManager.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import dataPreferences from '@ohos.data.preferences';

```

### `harmony/codePush/src/main/ets/CodePushUnknownException.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export class CodePushUnknownException extends Error {

```

### `harmony/codePush/src/main/ets/CodePushUpdateManager.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import { CodePush } from './CodePush';

```

### `harmony/codePush/src/main/ets/CodePushUpdateState.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export enum CodePushUpdateState {

```

### `harmony/codePush/src/main/ets/CodePushUpdateUtils.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import fs, { ListFileOptions } from "@ohos.file.fs";

```

### `harmony/codePush/src/main/ets/CodePushUtils.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import fileio from "@ohos.fileio";

```

### `harmony/codePush/src/main/ets/FileUtils.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import fs, { Options, Filter, ListFileOptions } from '@ohos.file.fs';

```

### `harmony/codePush/src/main/ets/Logger.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import hilog from '@ohos.hilog';

```

### `harmony/codePush/src/main/ets/SettingsManager.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import { CodePushConstants } from "./CodePushConstants";

```

### `harmony/codePush/src/main/ets/generated/turboModules/RTNCodePush.ts`

```diff
@@ -8,8 +8,6 @@ export namespace RTNCodePush {
   export const NAME = 'RTNCodePush' as const
 
   export interface Spec {
-    sync(): Promise<unknown>;
-  
     isFailedUpdate(packageHash: string): Promise<boolean>;
   
     allow(): void;

```

### `harmony/codePush/ts.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 export * from "./src/main/ets/CodePushNativeModule";

```

### `package.json`

```diff
@@ -23,6 +23,7 @@
   "author": "Microsoft Corporation",
   "license": "MIT",
   "scripts": {
+     "pack": "npm pack",
      "codegen-lib": "react-native codegen-lib-harmony --no-safety-check --npm-package-name react-native-code-push --cpp-output-path ./harmony/codePush/src/main/cpp/generated --ets-output-path ./harmony/codePush/src/main/ets/generated --turbo-modules-spec-paths ./src --arkts-components-spec-paths ./src"
   },
   "repository": {

```

### `src/NativeCodePush.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
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
  */
 
 import type { TurboModule } from "react-native/Libraries/TurboModule/RCTExport";

```
