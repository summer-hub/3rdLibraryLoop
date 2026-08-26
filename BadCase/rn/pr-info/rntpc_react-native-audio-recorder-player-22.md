# PR #22: fix:把遗漏的封装格式AAC补齐

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-06-25T10:36:47+08:00
- **分支**: 77_bugfix → br_rnoh0.77
- **变更文件数**: 15
- **⚠️ 注意**: diff 过大已截断，变更文件列表完整保留

## PR 描述

问题原因：在index.ts的AudioFormatHarmonyType格式中没有aac的枚举，导致用户无法录制aac格式的音频
解决方案：ts的AudioFormatHarmonyType格式中补充aac格式的枚举类型

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `.gitignore` | ? | +0 | -1 |
| `OAT.xml` | ? | +2 | -0 |
| `README.md` | ? | +746 | -7 |
| `README_en.md` | added | +754 | -0 |
| `buildEnv.sh` | added | +8 | -0 |
| `example/harmony/build-profile.template.json5` | ? | +10 | -2 |
| `example/harmony/entry/oh-package.json5` | ? | +1 | -1 |
| `example/harmony/oh-package.json5` | ? | +1 | -1 |
| `example/index.js` | added | +11 | -0 |
| `example/package.json` | ? | +6 | -5 |
| `harmony/audio_recorder_player.har` | ? | +0 | -0 |
| `harmony/audio_recorder_player/src/main/ets/RNAudioRecorderPlayerTurboModule.ts` | ? | +1 | -1 |
| `harmony/audio_recorder_player/src/main/ets/index.ts` | renamed | +0 | -0 |
| `index.ts` | ? | +2 | -1 |
| `package.json` | ? | +2 | -1 |

## Diff

### `.gitignore`

```diff
@@ -54,7 +54,6 @@ package-lock.json
 # Built files
 tsconfig.tsbuildinfo
 index.js.flow
-index.js
 harmony/audio_recorder_player/oh_modules/
 
 harmony/audio_recorder_player/build/

```

### `OAT.xml`

```diff
@@ -48,6 +48,7 @@
                 <filteritem type="filepath" name="index.*" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险" />
                 <filteritem type="filepath" name="hvigor/hvigor-wrapper.js" desc="工程模板，不修改版权头，以防有修改版权风险" />
                 <filteritem type="filepath" name="hvigor/hvigor-config.json5" desc="工程模板，不修改版权头，以防有修改版权风险" />
+                <filteritem type="filepath" name="buildEnv.sh" desc="工程模板，不修改版权头，以防有修改版权风险" />
             </filefilter>
             <filefilter name="defaultPolicyFilter" desc="Filters for compatibility，license header policies">
                 <filteritem type="filepath" name="harmony/audio_recorder_player/hvigorfile.ts" desc="hvigor构建脚本，DevEco Studio自动生成，不手动修改" />
@@ -79,6 +80,7 @@
                 <filteritem type="filepath" name="index.*" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
                 <filteritem type="filepath" name="hvigor/hvigor-wrapper.js" desc="工程模板，不修改版权头，以防有修改版权风险"/>
                 <filteritem type="filepath" name="hvigor/hvigor-config.json5" desc="工程模板，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filepath" name="buildEnv.sh" desc="工程模板，不修改版权头，以防有修改版权风险" />
             </filefilter>
 
             <filefilter name="binaryFileTypePolicyFilter" desc="Filters for copyright header policies">

```

### `README.md`

```diff
@@ -1,14 +1,753 @@
-# @react-native-ohos/react-native-audio-recorder-player
+> 模板版本：v0.2.2
 
-This project is based on [react-native-audio-recorder-player@3.6.13](https://github.com/hyochan/react-native-audio-recorder-player/tree/3.6.13)
+<p align="center">
+  <h1 align="center"> <code>react-native-audio-recorder-player</code> </h1>
+</p>
+<p align="center">
+    <a href="https://github.com/hyochan/react-native-audio-recorder-player">
+        <img src="https://img.shields.io/badge/platforms-android%20|%20ios%20|%20harmony%20-lightgrey.svg" alt="Supported platforms" />
+    </a>
+    <a href="https://github.com/hyochan/react-native-audio-recorder-player/blob/main/LICENSE">
+        <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" />
+    </a>
+</p>
 
-## Documentation
+> [!TIP] [Github 地址](https://github.com/react-native-oh-library/react-native-audio-recorder-player)
 
-- [中文](https://gitee.com/react-native-oh-library/usage-docs/blob/master/zh-cn/react-native-audio-recorder-player.md)
+## 安装与使用
 
-- [English](https://gitee.com/react-native-oh-library/usage-docs/blob/master/en/react-native-audio-recorder-player.md)
+请到三方库的 Releases 发布地址查看配套的版本信息：
 
-## License
+| 三方库版本 | 发布信息                                                     | 支持RN版本 |
+| ---------- | ------------------------------------------------------------ | ---------- |
+| <= 3.6.10-0.0.2@deprecated     | [@react-native-oh-tpl/react-native-audio-recorder-player Releases(deprecated)](https://github.com/react-native-oh-library/react-native-audio-recorder-player/releases) | 0.72       |
+| 3.6.11      | [@react-native-ohos/react-native-audio-recorder-player Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-audio-recorder-player/releases)     | 0.72       |
+| 3.7.0       | [@react-native-ohos/react-native-audio-recorder-player Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-audio-recorder-player/releases)     | 0.77       |
 
-This library is licensed under [The MIT License (MIT)](https://github.com/hyochan/react-native-audio-recorder-player/blob/main/LICENSE)
+对于未发布到npm的旧版本，请参考[安装指南](/tgz-usage.md)安装tgz包。
 
+进入到工程目录并输入以下命令：
+
+#### **npm**
+
+```bash
+npm install @react-native-ohos/react-native-audio-recorder-player
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/react-native-audio-recorder-player
+```
+
+下面的代码展示了这个库的基本使用场景：
+
+> [!WARNING] 使用时 import 的库名不变。
+
+```js
+import AudioRecorderPlayer, {
+    AVEncoderAudioQualityIOSType,
+    AVEncodingOption,
+    AudioEncoderAndroidType,
+    AudioSourceAndroidType,
+    OutputFormatAndroidType,
+    AudioMimeHarmonyType,
+    AudioFormatHarmonyType,
+    AudioSourceHarmonyType,
+    AudioSet
+} from 'react-native-audio-recorder-player'; import type {
+    PlayBackType,
+    RecordBackType,
+} from 'react-native-audio-recorder-player';
+
+import {
+    Dimensions,
+    Platform,
+    ActivityIndicator,
+    Image,
+    SafeAreaView,
+    StyleSheet,
+    Text,
+    TouchableOpacity,
+    View,
+} from 'react-native';
+import React, { Component } from 'react';
+
+import type { ReactElement, ReactNode } from 'react';
+
+const stylesButton: any = StyleSheet.create({
+    btn: {
+        backgroundColor: 'transparent',
+        alignSelf: 'center',
+        borderRadius: 4,
+        borderWidth: 2,
+        width: 320,
+        height: 52,
+        borderColor: 'white',
+
+        alignItems: 'center',
+        justifyContent: 'center',
+    },
+    btnDisabled: {
+        backgroundColor: 'rgb(243,243,243)',
+        alignSelf: 'center',
+        borderRadius: 4,
+        borderWidth: 2,
+        width: 320,
+        height: 52,
+        borderColor: '#333',
+
+        alignItems: 'center',
+        justifyContent: 'center',
+    },
+    txt: {
+        fontSize: 14,
+        color: 'white',
+    },
+    imgLeft: {
+        width: 24,
+        height: 24,
+        position: 'absolute',
+        left: 16,
+    },
+});
+
+interface ItemProps {
+    children?: ReactNode;
+    isLoading?: boolean;
+    isDisabled?: boolean;
+    onPress?: () => void;
+    style?: any;
+    disabledStyle?: any;
+    textStyle?: any;
+    imgLeftSrc?: any;
+    imgLeftStyle?: any;
+    indicatorColor?: string;
+    activeOpacity?: number;
+}
+
+class Button extends Component<ItemProps, any> {
+    private static defaultProps: Partial<ItemProps> = {
+        isLoading: false,
+        isDisabled: false,
+        style: stylesButton.btn,
+        textStyle: stylesButton.txt,
+        imgLeftStyle: stylesButton.imgLeft,
+        indicatorColor: 'white',
+        activeOpacity: 0.5,
+    };
+
+    constructor(props: ItemProps) {
+        super(props);
+        this.state = {};
+    }
+
+    public render(): ReactElement {
+        if (this.props.isDisabled) {
+            return (
+                <View style={this.props.disabledStyle}>
+                    <Text style={this.props.textStyle}>{this.props.children}</Text>
+                </View>
+            );
+        }
+
+        if (this.props.isLoading) {
+            return (
+                <View style={this.props.style}>
+                    <ActivityIndicator size="small" color={this.props.indicatorColor} />
+                </View>
+            );
+        }
+
+        return (
+            <TouchableOpacity
+                activeOpacity={this.props.activeOpacity}
+                onPress={this.props.onPress}>
+                <View style={this.props.style}>
+                    {this.props.imgLeftSrc ? (
+                        <Image
+                            style={this.props.imgLeftStyle}
+                            source={this.props.imgLeftSrc}
+                        />
+                    ) : null}
+                    <Text style={this.props.textStyle}>{this.props.children}</Text>
+                </View>
+            </TouchableOpacity>
+        );
+    }
+}
+
+const styles: any = StyleSheet.create({
+    container: {
+        flex: 1,
+        backgroundColor: '#455A64',
+        flexDirection: 'column',
+        alignItems: 'center',
+        height: Dimensions.get('screen').height
+    },
+    titleTxt: {
+        marginTop: 100,
+        color: 'white',
+        fontSize: 28,
+    },
+    viewRecorder: {
+        marginTop: 40,
+        width: '100%',
+        alignItems: 'center',
+    },
+    recordBtnWrapper: {
+        flexDirection: 'row',
+    },
+    viewPlayer: {
+        marginTop: 60,
+        alignSelf: 'stretch',
+        alignItems: 'center',
+    },
+    viewBarWrapper: {
+        marginTop: 28,
+        marginHorizontal: 28,
+        alignSelf: 'stretch',
+    },
+    viewBar: {
+        backgroundColor: '#ccc',
+        height: 4,
+        alignSelf: 'stretch',
+    },
+    viewBarPlay: {
+        backgroundColor: 'white',
+        height: 4,
+        width: 0,
+    },
+    playStatusTxt: {
+        marginTop: 8,
+        color: '#ccc',
+    },
+    playBtnWrapper: {
+        flexDirection: 'row',
+        marginTop: 40,
+    },
+    btn: {
+        borderColor: 'white',
+        borderWidth: 1,
+    },
+    txt: {
+        color: 'white',
+        fontSize: 14,
+        marginHorizontal: 8,
+        marginVertical: 4,
+    },
+    txtRecordCounter: {
+        marginTop: 32,
+        color: 'white',
+        fontSize: 20,
+        textAlignVertical: 'center',
+        fontWeight: '200',
+        fontFamily: 'Helvetica Neue',
+        letterSpacing: 3,
+        width: 300
+    },
+    txtCounter: {
+        marginTop: 12,
+        color: 'white',
+        fontSize: 20,
+        textAlignVertical: 'center',
+        fontWeight: '200',
+        fontFamily: 'Helvetica Neue',
+        letterSpacing: 3,
+        width: 300
+    },
+});
+
+interface State {
+    isLoggingIn: boolean;
+    recordSecs: number;
+    recordTime: string;
+    currentPositionSec: number;
+    currentDurationSec: number;
+    playTime: string;
+    duration: string;
+}
+
+const screenWidth = Dimensions.get('screen').width;
+
+class Page extends Component<any, State> {
+    private audioRecorderPlayer
+
+    constructor(props: any) {
+        super(props);
+        this.state = {
+            isLoggingIn: false,
+            recordSecs: 0,
+            recordTime: '00:00:00',
+            currentPositionSec: 0,
+            currentDurationSec: 0,
+            playTime: '00:00:00',
+            duration: '00:00:00',
+        };
+
+        this.audioRecorderPlayer = new AudioRecorderPlayer()
+        this.audioRecorderPlayer.setSubscriptionDuration(0.5); // optional. Default is 0.5
+    }
+
+    public render(): ReactElement {
+        let playWidth =
+            (this.state.currentPositionSec / this.state.currentDurationSec) *
+            (screenWidth - 56);
+
+        if (!playWidth) {
+            playWidth = 0;
+        }
+
+        return (
+            <SafeAreaView style={styles.container}>
+                <Text style={styles.titleTxt}>Audio Recorder Player</Text>
+                <Text style={styles.txtRecordCounter}>{this.state.recordTime}</Text>
+                <View style={styles.viewRecorder}>
+                    <View style={styles.recordBtnWrapper}>
+                        <Button
+                            style={styles.btn}
+                            onPress={this.onStartRecord}
+                            textStyle={styles.txt}>
+                            startRecord
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onPauseRecord}
+                            textStyle={styles.txt}>
+                            Pause
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onResumeRecord}
+                            textStyle={styles.txt}>
+                            Resume
+                        </Button>
+                        <Button
+                            style={[styles.btn, { marginLeft: 12 }]}
+                            onPress={this.onStopRecord}
+                            textStyle={styles.txt}>
+                            Stop
+                        </Button>
+                    </View>
+                </View>
+                <View style={styles.viewPlayer}>
+                    <TouchableOpacity
+                        style={styles.viewBarWrapper}
+                        onPress={this.onStatusPress}>
+                        <View style={styles.viewBar}>
+                            <View style={[styles.viewBarPlay, { width: playWidth }]} />
+                        </View>
+                    </TouchableOpacity>
+                    <Text style={styles.txtCounter}>
+                        {this.state.playTime} / {this.state.duration}
+                    </Text>
+                    <View style={styles.playBtnWrapper}>
+                        <Button
+                            style={styles.btn}
+                            onPress={this.onStartPlay}
+                            textStyle={styles.txt}>
+                            Play
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onPausePlay}
+                            textStyle={styles.txt}>
+                            Pause
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onResumePlay}
+                            textStyle={styles.txt}>
+                            Resume
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onStopPlay}
+                            textStyle={styles.txt}>
+                            Stop
+                        </Button>
+                    </View>
+                </View>
+            </SafeAreaView>
+        );
+    }
+
+    private onStatusPress = (e: any): void => {
+        const touchX = e.nativeEvent.locationX;
+        console.log(`touchX: ${touchX}`);
+
+        const playWidth =
+            (this.state.currentPositionSec / this.state.currentDurationSec) *
+            (screenWidth - 56);
+        console.log(`currentPlayWidth: ${playWidth}`);
+
+        const currentPosition = Math.round(this.state.currentPositionSec);
+
+        if (playWidth && playWidth < touchX) {
+            const addSecs = Math.round(currentPosition + 1000);
+            this.audioRecorderPlayer.seekToPlayer(addSecs);
+            console.log(`addSecs: ${addSecs}`);
+        } else {
+            const subSecs = Math.round(currentPosition - 1000);
+            this.audioRecorderPlayer.seekToPlayer(subSecs);
+            console.log(`subSecs: ${subSecs}`);
+        }
+    };
+
+    private onStartRecord = async (): Promise<void> => {
+
+        const audioSet: AudioSet = {
+            AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
+            AudioSourceAndroid: AudioSourceAndroidType.MIC,
+            AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
+            AVNumberOfChannelsKeyIOS: 2,
+            AVFormatIDKeyIOS: AVEncodingOption.aac,
+            OutputFormatAndroid: OutputFormatAndroidType.AAC_ADTS,
+            AudioSourceHarmony: AudioSourceHarmonyType.MIC,
+            AudioMimeHarmony: AudioMimeHarmonyType.AUDIO_AAC,
+            AudioFileFormatHarmony: AudioFormatHarmonyType.MPEG_4A,
+            AudioEncodingBitRateHarmony: 3200,
+            AudioSamplingRateHarmony: 44100,
+            AudioChannelsHarmony: 2,
+        };
+
+        console.log('audioSet', audioSet);
+
+        const uri = await this.audioRecorderPlayer.startRecorder(
+            'audio.m4a',
+            audioSet,
+        );
+
+        this.audioRecorderPlayer.addRecordBackListener((e: RecordBackType) => {
+            console.log('record-back', e);
+            this.setState({
+                recordSecs: e.currentPosition,
+                recordTime: this.audioRecorderPlayer.mmssss(
+                    Math.floor(e.currentPosition),
+                ),
+            });
+        });
+
+        console.log(`uri: ${uri}`);
+    };
+
+    private onPauseRecord = async (): Promise<void> => {
+        try {
+            const r = await this.audioRecorderPlayer.pauseRecorder();
+            console.log(r);
+        } catch (err) {
+            console.log('pauseRecord', err);
+        }
+    };
+
+    private onResumeRecord = async (): Promise<void> => {
+        await this.audioRecorderPlayer.resumeRecorder();
+    };
+
+    private onStopRecord = async (): Promise<void> => {
+        const result = await this.audioRecorderPlayer.stopRecorder();
+        this.audioRecorderPlayer.removeRecordBackListener();
+        this.setState({
+            recordSecs: 0,
+        });
+        console.log(result, '>>>>>>>stopRecorder');
+    };
+
+    private onStartPlay = async (): Promise<void> => {
+        console.log('onStartPlay');
+
+        try {
+            const msg = await this.audioRecorderPlayer.startPlayer('https://sis-sample-audio.obs.cn-north-1.myhuaweicloud.com/16k16bit.mp3', { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:12.0) Gecko/20100101 Firefox/21.0' });
+            const volume = await this.audioRecorderPlayer.setVolume(1);
+            this.audioRecorderPlayer.addPlayBackListener((e: PlayBackType) => {
+                console.log('playBackListener', e);
+                this.setState({
+                    currentPositionSec: e.currentPosition,
+                    currentDurationSec: e.duration,
+                    playTime: this.audioRecorderPlayer.mmssss(e.currentPosition),
+                    duration: this.audioRecorderPlayer.mmssss(Math.floor(e.duration)),
+                });
+            });
+
+        } catch (err) {
+            console.log('startPlayer error', err);
+        }
+    };
+
+    private onPausePlay = async (): Promise<void> => {
+        await this.audioRecorderPlayer.pausePlayer();
+    };
+
+    private onResumePlay = async (): Promise<void> => {
+        await this.audioRecorderPlayer.resumePlayer();
+    };
+
+    private onStopPlay = async (): Promise<void> => {
+        console.log('onStopPlay');
+        this.audioRecorderPlayer.stopPlayer();
+        this.audioRecorderPlayer.removePlayBackListener();
+    };
+}
+
+export default Page;
+
+```
+
+## Link
+
+|                                      | 是否支持autolink | RN框架版本 |
+|--------------------------------------|-----------------|------------|
+| ~3.7.0                               |  No              |  0.77     |
+| ~3.6.11                              |  Yes             |  0.72     |
+| <= 3.6.10-0.0.2@deprecated            |  No              |  0.72     |
+
+使用AutoLink的工程需要根据该文档配置，Autolink框架指导文档：https://gitcode.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md
+
+如您使用的版本支持 Autolink，并且工程已接入 Autolink，可跳过ManualLink配置。
+<details>
+  <summary>ManualLink: 此步骤为手动配置原生依赖项的指导</summary>
+
+首先需要使用 DevEco Studio 打开项目里的 HarmonyOS 工程 `harmony`。
+
+### 在工程根目录的 `oh-package.json5` 添加 overrides 字段
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
+### 引入原生端代码
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
+
+    "@react-native-ohos/react-native-audio-recorder-player": "file:../../node_modules/@react-native-ohos/react-native-audio-recorder-player/harmony/audio_recorder_player.har"
+  }
+```
+点击右上角的 `sync` 按钮
+
+或者在终端执行：
+
+```bash
+cd entry
+ohpm install
+```
+方法二：直接链接源码
+
+> [!TIP] 如需使用直接链接源码，请参考[直接链接源码说明](/link-source-code.md)
+
+### 配置 CMakeLists 和引入 RNAudioRecorderPlayerPackage
+
+> 若使用的是 <= 3.6.10-0.0.2 版本，请跳过本章。
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
++ add_subdirectory("${OH_MODULES}/@react-native
... [diff 已截断]
```

### `README_en.md`

```diff
@@ -0,0 +1,754 @@
+> Template version: v0.2.2
+
+<p align="center">
+  <h1 align="center"> <code>react-native-audio-recorder-player</code> </h1>
+</p>
+<p align="center">
+    <a href="https://github.com/hyochan/react-native-audio-recorder-player">
+        <img src="https://img.shields.io/badge/platforms-android%20|%20ios%20|%20harmony%20-lightgrey.svg" alt="Supported platforms" />
+    </a>
+    <a href="https://github.com/hyochan/react-native-audio-recorder-player/blob/main/LICENSE">
+        <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" />
+    </a>
+</p>
+
+> [!TIP] [ GitHub address](https://github.com/react-native-oh-library/react-native-audio-recorder-player)
+
+## Installation and Usage
+
+Please refer to the Releases page of the third-party library for the corresponding version information
+
+| Third-party Library Version | Release Information                                                     | Supported RN Version |
+| ---------- | ------------------------------------------------------------ | ---------- |
+| <= 3.6.10-0.0.2@deprecated     | [@react-native-oh-tpl/react-native-audio-recorder-player Releases(deprecated)](https://github.com/react-native-oh-library/react-native-audio-recorder-player/releases) | 0.72       |
+| 3.6.11      | [@react-native-ohos/react-native-audio-recorder-player Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-audio-recorder-player/releases)     | 0.72       |
+| 3.7.0       | [@react-native-ohos/react-native-audio-recorder-player Releases](https://gitcode.com/openharmony-sig/rntpc_react-native-audio-recorder-player/releases)     | 0.77       |
+
+For older versions that are not published to npm, please refer to the [installation guide](/tgz-usage-en.md) to install the tgz package.
+
+Go to the project directory and execute the following instruction:
+
+
+
+#### **npm**
+
+```bash
+npm install @react-native-ohos/react-native-audio-recorder-player
+```
+
+#### **yarn**
+
+```bash
+yarn add @react-native-ohos/react-native-audio-recorder-player
+```
+
+The following code shows the basic use scenario of the repository:
+
+> [!WARNING] The name of the imported repository remains unchanged.
+
+```js
+import AudioRecorderPlayer, {
+    AVEncoderAudioQualityIOSType,
+    AVEncodingOption,
+    AudioEncoderAndroidType,
+    AudioSourceAndroidType,
+    OutputFormatAndroidType,
+} from 'react-native-audio-recorder-player'; import type {
+    PlayBackType,
+    RecordBackType,
+} from 'react-native-audio-recorder-player';
+import { AudioMimeHarmonyType, AudioFormatHarmonyType, AudioSourceHarmonyType, AudioSet } from "react-native-audio-recorder-player";
+
+import {
+    Dimensions,
+    Platform,
+    ActivityIndicator,
+    Image,
+    SafeAreaView,
+    StyleSheet,
+    Text,
+    TouchableOpacity,
+    View,
+} from 'react-native';
+import React, { Component } from 'react';
+
+import type { ReactElement, ReactNode } from 'react';
+
+const stylesButton: any = StyleSheet.create({
+    btn: {
+        backgroundColor: 'transparent',
+        alignSelf: 'center',
+        borderRadius: 4,
+        borderWidth: 2,
+        width: 320,
+        height: 52,
+        borderColor: 'white',
+
+        alignItems: 'center',
+        justifyContent: 'center',
+    },
+    btnDisabled: {
+        backgroundColor: 'rgb(243,243,243)',
+        alignSelf: 'center',
+        borderRadius: 4,
+        borderWidth: 2,
+        width: 320,
+        height: 52,
+        borderColor: '#333',
+
+        alignItems: 'center',
+        justifyContent: 'center',
+    },
+    txt: {
+        fontSize: 14,
+        color: 'white',
+    },
+    imgLeft: {
+        width: 24,
+        height: 24,
+        position: 'absolute',
+        left: 16,
+    },
+});
+
+interface ItemProps {
+    children?: ReactNode;
+    isLoading?: boolean;
+    isDisabled?: boolean;
+    onPress?: () => void;
+    style?: any;
+    disabledStyle?: any;
+    textStyle?: any;
+    imgLeftSrc?: any;
+    imgLeftStyle?: any;
+    indicatorColor?: string;
+    activeOpacity?: number;
+}
+
+class Button extends Component<ItemProps, any> {
+    private static defaultProps: Partial<ItemProps> = {
+        isLoading: false,
+        isDisabled: false,
+        style: stylesButton.btn,
+        textStyle: stylesButton.txt,
+        imgLeftStyle: stylesButton.imgLeft,
+        indicatorColor: 'white',
+        activeOpacity: 0.5,
+    };
+
+    constructor(props: ItemProps) {
+        super(props);
+        this.state = {};
+    }
+
+    public render(): ReactElement {
+        if (this.props.isDisabled) {
+            return (
+                <View style={this.props.disabledStyle}>
+                    <Text style={this.props.textStyle}>{this.props.children}</Text>
+                </View>
+            );
+        }
+
+        if (this.props.isLoading) {
+            return (
+                <View style={this.props.style}>
+                    <ActivityIndicator size="small" color={this.props.indicatorColor} />
+                </View>
+            );
+        }
+
+        return (
+            <TouchableOpacity
+                activeOpacity={this.props.activeOpacity}
+                onPress={this.props.onPress}>
+                <View style={this.props.style}>
+                    {this.props.imgLeftSrc ? (
+                        <Image
+                            style={this.props.imgLeftStyle}
+                            source={this.props.imgLeftSrc}
+                        />
+                    ) : null}
+                    <Text style={this.props.textStyle}>{this.props.children}</Text>
+                </View>
+            </TouchableOpacity>
+        );
+    }
+}
+
+const styles: any = StyleSheet.create({
+    container: {
+        flex: 1,
+        backgroundColor: '#455A64',
+        flexDirection: 'column',
+        alignItems: 'center',
+        height: Dimensions.get('screen').height
+    },
+    titleTxt: {
+        marginTop: 100,
+        color: 'white',
+        fontSize: 28,
+    },
+    viewRecorder: {
+        marginTop: 40,
+        width: '100%',
+        alignItems: 'center',
+    },
+    recordBtnWrapper: {
+        flexDirection: 'row',
+    },
+    viewPlayer: {
+        marginTop: 60,
+        alignSelf: 'stretch',
+        alignItems: 'center',
+    },
+    viewBarWrapper: {
+        marginTop: 28,
+        marginHorizontal: 28,
+        alignSelf: 'stretch',
+    },
+    viewBar: {
+        backgroundColor: '#ccc',
+        height: 4,
+        alignSelf: 'stretch',
+    },
+    viewBarPlay: {
+        backgroundColor: 'white',
+        height: 4,
+        width: 0,
+    },
+    playStatusTxt: {
+        marginTop: 8,
+        color: '#ccc',
+    },
+    playBtnWrapper: {
+        flexDirection: 'row',
+        marginTop: 40,
+    },
+    btn: {
+        borderColor: 'white',
+        borderWidth: 1,
+    },
+    txt: {
+        color: 'white',
+        fontSize: 14,
+        marginHorizontal: 8,
+        marginVertical: 4,
+    },
+    txtRecordCounter: {
+        marginTop: 32,
+        color: 'white',
+        fontSize: 20,
+        textAlignVertical: 'center',
+        fontWeight: '200',
+        fontFamily: 'Helvetica Neue',
+        letterSpacing: 3,
+        width: 300
+    },
+    txtCounter: {
+        marginTop: 12,
+        color: 'white',
+        fontSize: 20,
+        textAlignVertical: 'center',
+        fontWeight: '200',
+        fontFamily: 'Helvetica Neue',
+        letterSpacing: 3,
+        width: 300
+    },
+});
+
+interface State {
+    isLoggingIn: boolean;
+    recordSecs: number;
+    recordTime: string;
+    currentPositionSec: number;
+    currentDurationSec: number;
+    playTime: string;
+    duration: string;
+}
+
+const screenWidth = Dimensions.get('screen').width;
+
+class Page extends Component<any, State> {
+    private audioRecorderPlayer
+
+    constructor(props: any) {
+        super(props);
+        this.state = {
+            isLoggingIn: false,
+            recordSecs: 0,
+            recordTime: '00:00:00',
+            currentPositionSec: 0,
+            currentDurationSec: 0,
+            playTime: '00:00:00',
+            duration: '00:00:00',
+        };
+
+        this.audioRecorderPlayer = new AudioRecorderPlayer()
+        this.audioRecorderPlayer.setSubscriptionDuration(0.5); // optional. Default is 0.5
+    }
+
+    public render(): ReactElement {
+        let playWidth =
+            (this.state.currentPositionSec / this.state.currentDurationSec) *
+            (screenWidth - 56);
+
+        if (!playWidth) {
+            playWidth = 0;
+        }
+
+        return (
+            <SafeAreaView style={styles.container}>
+                <Text style={styles.titleTxt}>Audio Recorder Player</Text>
+                <Text style={styles.txtRecordCounter}>{this.state.recordTime}</Text>
+                <View style={styles.viewRecorder}>
+                    <View style={styles.recordBtnWrapper}>
+                        <Button
+                            style={styles.btn}
+                            onPress={this.onStartRecord}
+                            textStyle={styles.txt}>
+                            startRecord
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onPauseRecord}
+                            textStyle={styles.txt}>
+                            Pause
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onResumeRecord}
+                            textStyle={styles.txt}>
+                            Resume
+                        </Button>
+                        <Button
+                            style={[styles.btn, { marginLeft: 12 }]}
+                            onPress={this.onStopRecord}
+                            textStyle={styles.txt}>
+                            Stop
+                        </Button>
+                    </View>
+                </View>
+                <View style={styles.viewPlayer}>
+                    <TouchableOpacity
+                        style={styles.viewBarWrapper}
+                        onPress={this.onStatusPress}>
+                        <View style={styles.viewBar}>
+                            <View style={[styles.viewBarPlay, { width: playWidth }]} />
+                        </View>
+                    </TouchableOpacity>
+                    <Text style={styles.txtCounter}>
+                        {this.state.playTime} / {this.state.duration}
+                    </Text>
+                    <View style={styles.playBtnWrapper}>
+                        <Button
+                            style={styles.btn}
+                            onPress={this.onStartPlay}
+                            textStyle={styles.txt}>
+                            Play
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onPausePlay}
+                            textStyle={styles.txt}>
+                            Pause
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onResumePlay}
+                            textStyle={styles.txt}>
+                            Resume
+                        </Button>
+                        <Button
+                            style={[
+                                styles.btn,
+                                {
+                                    marginLeft: 12,
+                                },
+                            ]}
+                            onPress={this.onStopPlay}
+                            textStyle={styles.txt}>
+                            Stop
+                        </Button>
+                    </View>
+                </View>
+            </SafeAreaView>
+        );
+    }
+
+    private onStatusPress = (e: any): void => {
+        const touchX = e.nativeEvent.locationX;
+        console.log(`touchX: ${touchX}`);
+
+        const playWidth =
+            (this.state.currentPositionSec / this.state.currentDurationSec) *
+            (screenWidth - 56);
+        console.log(`currentPlayWidth: ${playWidth}`);
+
+        const currentPosition = Math.round(this.state.currentPositionSec);
+
+        if (playWidth && playWidth < touchX) {
+            const addSecs = Math.round(currentPosition + 1000);
+            this.audioRecorderPlayer.seekToPlayer(addSecs);
+            console.log(`addSecs: ${addSecs}`);
+        } else {
+            const subSecs = Math.round(currentPosition - 1000);
+            this.audioRecorderPlayer.seekToPlayer(subSecs);
+            console.log(`subSecs: ${subSecs}`);
+        }
+    };
+
+    private onStartRecord = async (): Promise<void> => {
+
+        const audioSet: AudioSet = {
+            AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
+            AudioSourceAndroid: AudioSourceAndroidType.MIC,
+            AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
+            AVNumberOfChannelsKeyIOS: 2,
+            AVFormatIDKeyIOS: AVEncodingOption.aac,
+            OutputFormatAndroid: OutputFormatAndroidType.AAC_ADTS,
+            AudioSourceHarmony: AudioSourceHarmonyType.MIC,
+            AudioMimeHarmony: AudioMimeHarmonyType.AUDIO_AAC,
+            AudioFileFormatHarmony: AudioFormatHarmonyType.MPEG_4A,
+            AudioEncodingBitRateHarmony: 3200,
+            AudioSamplingRateHarmony: 44100,
+            AudioChannelsHarmony: 2,
+        };
+
+        console.log('audioSet', audioSet);
+
+        const uri = await this.audioRecorderPlayer.startRecorder(
+            'audio.m4a',
+            audioSet,
+        );
+
+        this.audioRecorderPlayer.addRecordBackListener((e: RecordBackType) => {
+            console.log('record-back', e);
+            this.setState({
+                recordSecs: e.currentPosition,
+                recordTime: this.audioRecorderPlayer.mmssss(
+                    Math.floor(e.currentPosition),
+                ),
+            });
+        });
+
+        console.log(`uri: ${uri}`);
+    };
+
+    private onPauseRecord = async (): Promise<void> => {
+        try {
+            const r = await this.audioRecorderPlayer.pauseRecorder();
+            console.log(r);
+        } catch (err) {
+            console.log('pauseRecord', err);
+        }
+    };
+
+    private onResumeRecord = async (): Promise<void> => {
+        await this.audioRecorderPlayer.resumeRecorder();
+    };
+
+    private onStopRecord = async (): Promise<void> => {
+        const result = await this.audioRecorderPlayer.stopRecorder();
+        this.audioRecorderPlayer.removeRecordBackListener();
+        this.setState({
+            recordSecs: 0,
+        });
+        console.log(result, '>>>>>>>stopRecorder');
+    };
+
+    private onStartPlay = async (): Promise<void> => {
+        console.log('onStartPlay');
+
+        try {
+
+
+            const msg = await this.audioRecorderPlayer.startPlayer('https://sis-sample-audio.obs.cn-north-1.myhuaweicloud.com/16k16bit.mp3', { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:12.0) Gecko/20100101 Firefox/21.0' });
+            const volume = await this.audioRecorderPlayer.setVolume(1);
+            this.audioRecorderPlayer.addPlayBackListener((e: PlayBackType) => {
+                console.log('playBackListener', e);
+                this.setState({
+                    currentPositionSec: e.currentPosition,
+                    currentDurationSec: e.duration,
+                    playTime: this.audioRecorderPlayer.mmssss(e.currentPosition),
+                    duration: this.audioRecorderPlayer.mmssss(Math.floor(e.duration)),
+                });
+            });
+
+        } catch (err) {
+            console.log('startPlayer error', err);
+        }
+    };
+
+    private onPausePlay = async (): Promise<void> => {
+        await this.audioRecorderPlayer.pausePlayer();
+    };
+
+    private onResumePlay = async (): Promise<void> => {
+        await this.audioRecorderPlayer.resumePlayer();
+    };
+
+    private onStopPlay = async (): Promise<void> => {
+        console.log('onStopPlay');
+        this.audioRecorderPlayer.stopPlayer();
+        this.audioRecorderPlayer.removePlayBackListener();
+    };
+}
+
+export default Page;
+
+```
+
+## Link
+
+|                                      | Is supported autolink  | Supported RN Version |
+|--------------------------------------|-----------------------|----------------------|
+| ~3.7.0                               |  No                   |  0.77                |
+| ~3.6.11                              |  Yes                  |  0.72                |
+| <= 3.6.10-0.0.2@deprecated           |  No                   |  0.72                |
+
+Using AutoLink need to be configured according to this document, Autolink Framework Guide Documentation: https://gitcode.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md
+
+If the version you use supports Autolink and the project has been connected to Autolink, skip the ManualLink configuration.
+<details>
+  <summary>ManualLink: this step is a guide to manually configure native dependencies.</summary>
+
+First, use DevEco Studio to open the HarmonyOS project `harmony` in the project directory.
+
+### Adding the overrides Field to `oh-package.json5 File` in the Root Directory of the Project
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
+### Introducing Native Code
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
+
+    "@react-native-ohos/react-native-audio-recorder-player": "file:../../node_modules/@react-native-ohos/react-native-audio-recorder-player/harmony/audio_recorder_player.har"
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
+> [!TIP] or details, see [Directly Linking Source Code](/link-source-code.md).
+
+### Configuring CMakeLists and Introducing RNAudioRecorderPlayerPackage
+
+> If you are using version <= 3.6.10-0.0.2, please skip this chapter.
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
+set(LOG_VERBOS
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

### `example/harmony/build-profile.template.json5`

```diff
@@ -4,9 +4,13 @@
       {
         "name": 'default',
         "signingConfig": 'default',
-        "compileSdkVersion": '5.0.1(13)',
         "compatibleSdkVersion": '5.0.0(12)',
-        "runtimeOS": 'HarmonyOS'
+        "runtimeOS": 'HarmonyOS',
+        "buildOption": {
+          "strictMode": {
+            "useNormalizedOHMUrl": true
+          }
+        }
       },
     ],
     "buildModeSet": [
@@ -31,6 +35,10 @@
           ],
         },
       ],
+    },
+    {
+      "name": 'audio_recorder_player',
+      "srcPath": '../../harmony/audio_recorder_player'
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
+    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/react_native_openharmony.har",
     "@react-native-ohos/react-native-audio-recorder-player": "file:../../node_modules/@react-native-ohos/react-native-audio-recorder-player/harmony/audio_recorder_player.har"
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
+    "@rnoh/react-native-openharmony": "file:./../node_modules/react-native-harmony/react_native_openharmony.har"
   },
   "dynamicDependencies": {}
 }
\ No newline at end of file

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
+import App from './src/index';
+
+AppRegistry.registerComponent(appName, () => App);
\ No newline at end of file

```

### `example/package.json`

```diff
@@ -8,18 +8,19 @@
     "start": "hdc rport tcp:8081 tcp:8081 && react-native start",
     "codegen": "react-native codegen-harmony --rnoh-module-path ./harmony/entry/oh_modules/@rnoh/react-native-openharmony",
     "pack:pkg": "cd ../ && npm pack && cd ./example",
-    "install:pkg": "npm uninstall @react-native-ohos/react-native-audio-recorder-player && npm run pack:pkg && npm i @react-native-ohos/react-native-audio-recorder-player@file:../react-native-ohos-react-native-audio-recorder-player-3.6.14-rc.1.tgz",
+    "install:pkg": "npm uninstall @react-native-ohos/react-native-audio-recorder-player && npm run pack:pkg && npm i @react-native-ohos/react-native-audio-recorder-player@file:../react-native-ohos-react-native-audio-recorder-player-3.7.0.tgz",
     "dev": "npm run codegen && react-native bundle-harmony --dev --minify=false",
     "prod": "npm run codegen && react-native bundle-harmony --dev=false --minify=true",
     "postinstall": "node ./scripts/create-build-profile",
-    "fast:pkg": "cd ../ && npm i --legacy-peer-deps && npm pack && cd ./example && npm i && npm run dev"
+    "fast-install-project": "cd ../ && npm i --force && npm run pack && rm -r node_modules && cd ./example && npm i --force",
+    "fast:pkg": "npm run fast-install-project && npm run dev"
   },
   "dependencies": {
     "@gorhom/portal": "^1.0.14",
-    "@react-native-ohos/react-native-audio-recorder-player": "file:../react-native-ohos-react-native-audio-recorder-player-3.6.14-rc.1.tgz",
+    "@react-native-ohos/react-native-audio-recorder-player": "file:../react-native-ohos-react-native-audio-recorder-player-3.7.0.tgz",
     "react": "18.3.1",
     "react-native": "0.77.1",
-    "react-native-harmony": "file:../packages/rnoh-react-native-harmony-0.77.10.tgz",
+    "react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.77.18-1",
     "react-native-reanimated": "^3.6.0"
   },
   "devDependencies": {
@@ -34,7 +35,7 @@
     "@react-native/eslint-config": "0.77.1",
     "@react-native/metro-config": "^0.77.1",
     "@react-native/typescript-config": "0.77.1",
-    "@rnoh/react-native-harmony-cli": "file:../packages/rnoh-react-native-harmony-cli-0.77.10.tgz",
+    "@rnoh/react-native-harmony-cli": "npm:@react-native-oh/react-native-harmony-cli@0.77.18-1",
     "@tsconfig/react-native": "^3.0.0",
     "@types/d3-scale-chromatic": "^3.0.0",
     "@types/jest": "^29.5.13",

```

### `harmony/audio_recorder_player.har`

```diff
Binary files no preview for this file type
```

### `harmony/audio_recorder_player/src/main/ets/RNAudioRecorderPlayerTurboModule.ts`

```diff
@@ -23,7 +23,7 @@
  */
 import { TurboModule, TurboModuleContext, } from '@rnoh/react-native-openharmony/ts';
 import { media } from '@kit.MediaKit';
-import { AudioSet } from '.';
+import type { AudioSet } from '.';
 import Recorder from './recorder/Recorder';
 import { AVRecorderState, defaultBitrate, defaultChannels, defaultSampleRate, RecordBackName, } from './recorder/types';
 import AudioPlayer from './audioPlayer/AudioPlayer';

```

### `harmony/audio_recorder_player/src/main/ets/index.ts`

```diff
The file is empty
```

### `index.ts`

```diff
@@ -29,7 +29,8 @@ export enum AudioFormatHarmonyType {
   MPEG_4 = 'mp4',
   MPEG_4A = 'm4a',
   MP3 = 'mp3',
-  WAV = 'wav'
+  WAV = 'wav',
+  AAC = 'aac'
 }
 
 export enum AudioMimeHarmonyType {

```

### `package.json`

```diff
@@ -9,7 +9,8 @@
   "scripts": {
     "test": "echo \"Error: no test specified\" && exit 1",
     "build": "tsc && flowgen index.d.ts -o index.js.flow",
-    "lint": "eslint -c .eslintrc.js 'index.ts'"
+    "lint": "eslint -c .eslintrc.js 'index.ts'",
+    "pack": "npm pack --ignore-scripts"
   },
   "harmony": {
     "alias": "react-native-audio-recorder-player"

```
