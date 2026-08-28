> 文档模板：v0.4.2

<p align="center">
  <h1 align="center"> <code>lottie-react-native</code> </h1>
</p>

本项目基于 [lottie-react-native](https://github.com/lottie-react-native/lottie-react-native) 开发。

该第三方库的仓库已迁移至 Gitcode，且支持直接从 npm 下载，新的包名为：`@react-native-ohos/lottie-react-native` 版本所属关系如下：

| 三方库名称    | 三方库版本（npm地址）    | 发布信息     | 支持RN版本    | Autolink     | 编译API版本     | 社区基线版本    |  源码地址   |
| ------------ | ------------ | ------------------------------ | ------------- | ------------- |------------------------ | ------------- | ------------- | 
| @react-native-ohos/lottie-react-native | [~ 7.3.0](https://www.npmjs.com/package/@react-native-ohos/lottie-react-native)    | [Gitcode Releases](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/releases) | 0.82.* | 否 | API12+ | 7.3.4 | [br_rnoh0.82](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82) |
| @react-native-ohos/lottie-react-native | [~ 7.2.3](https://www.npmjs.com/package/@react-native-ohos/lottie-react-native)    | [Gitcode Releases](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/releases) | 0.77.* | 否 | API12+ | 7.3.4 | [br_rnoh0.77](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.77) |
| @react-native-ohos/lottie-react-native | [~ 6.4.2](https://www.npmjs.com/package/@react-native-ohos/lottie-react-native)    | [Gitcode Releases](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/releases) | 0.72.* | 否 | API12+ | 7.3.4 | [br_rnoh0.72](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.72) |
| @react-native-oh-tpl/lottie-react-native  | [<= 6.4.1-0.1.17@deprecated](https://www.npmjs.com/package/@react-native-ohos/lottie-react-native) | [Github Releases(deprecated)](https://github.com/react-native-oh-library/lottie-react-native/releases) | 0.72.* | 否 | API12+ | 7.3.4 | [sig](https://github.com/react-native-oh-library/lottie-react-native) |

## 简介

Lottie 组件用于 React Native。<br/>
Lottie 是一个库生态系统，用于解析 Adobe After Effects 动画导出为 JSON 并带 bodymovin 原生渲染的动画！<br/>
设计师首次可以在无需工程师手工繁琐重现的情况下，创造并交付精美的动画。

## 下载安装

进入到工程目录并输入以下命令：

**npm**

```bash
npm install @react-native-ohos/lottie-react-native
```

**yarn**

```bash
yarn add @react-native-ohos/lottie-react-native
```


## Link

|                                      | 是否支持autolink | RN框架版本 |
|--------------------------------------|----------------|-----------|
| ~ 7.3.0                              | No             |  0.82     |
| ~ 7.2.3                              | No             |  0.77     |
| ~ 6.4.2                              | Yes            |  0.72     |
| <= 6.4.1-0.1.17@deprecated           | No             |  0.72     |

使用 AutoLink 的工程需要根据 [Autolink 框架指导文档](https://gitcode.com/CPF-RN/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md) 配置。

<!-- 以下 ManualLink 块：仅当 Link 表或版本关系表中存在「否/No/partially」时保留；当前分支若全部为「是/Yes」则整段删除（含本注释）。 -->
<details>
  <summary>ManualLink: 此步骤为手动配置原生依赖项的指导</summary>

首先需要使用 DevEco Studio 打开项目里的 HarmonyOS 工程 `harmony`。

### 1. Overrides RN SDK

为了让工程依赖同一个版本的 RN SDK，需要在工程根目录的 `oh-package.json5` 添加 overrides 字段，指向工程需要使用的 RN SDK 版本。替换的版本既可以是一个具体的版本号，也可以是一个模糊版本，还可以是本地存在的 HAR 包或源码目录。

关于该字段的作用请阅读[官方说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/ide-oh-package-json5-V5#zh-cn_topic_0000001792256137_overrides)

```json
{
  "overrides": {
    "@rnoh/react-native-openharmony": "^0.72.38" // ohpm 在线版本
    // "@rnoh/react-native-openharmony" : "./react_native_openharmony.har" // 指向本地 har 包的路径
    // "@rnoh/react-native-openharmony" : "./react_native_openharmony" // 指向源码路径
  }
}
```

### 2. 引入原生端代码

目前有两种方法：

- 通过 har 包引入；
- 直接链接源码。

方法一：通过 har 包引入（推荐）

> [!TIP] har 包位于三方库安装路径的 `harmony` 文件夹下。

打开 `entry/oh-package.json5`，添加以下依赖

```json
"dependencies": {
    "@react-native-ohos/lottie-react-native": "file:../../node_modules/@react-native-ohos/lottie-react-native/harmony/lottie.har"
  }
```

点击右上角的 `sync` 按钮

或者在命令行终端执行：

```bash
cd entry
ohpm install
```

方法二：直接链接源码

> [!TIP] 如需使用直接链接源码，请参考[直接链接源码说明](https://gitcode.com/CPF-RN/usage-docs/blob/master/zh-cn/link-source-code.md)

### 3. 配置 CMakeLists 和引入 LottieAnimationViewPackage

打开 `entry/src/main/cpp/CMakeLists.txt`，添加：

```diff
project(rnapp)
cmake_minimum_required(VERSION 3.4.1)
set(CMAKE_SKIP_BUILD_RPATH TRUE)
set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
set(NODE_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules")
+ set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../react-native-harmony/harmony/cpp")
set(LOG_VERBOSITY_LEVEL 1)
set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
set(WITH_HITRACE_SYSTRACE 1) # for other CMakeLists.txt files to use
add_compile_definitions(WITH_HITRACE_SYSTRACE)

add_subdirectory("${RNOH_CPP_DIR}" ./rn)

# RNOH_BEGIN: manual_package_linking_1
add_subdirectory("../../../../sample_package/src/main/cpp" ./sample-package)
+ add_subdirectory("${OH_MODULES}/@react-native-ohos/lottie-react-native/src/main/cpp" ./lottie)
# RNOH_END: manual_package_linking_1

file(GLOB GENERATED_CPP_FILES "./generated/*.cpp")

add_library(rnoh_app SHARED
    ${GENERATED_CPP_FILES}
    "./PackageProvider.cpp"
    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
)
target_link_libraries(rnoh_app PUBLIC rnoh)

# RNOH_BEGIN: manual_package_linking_2
target_link_libraries(rnoh_app PUBLIC rnoh_sample_package)
+ target_link_libraries(rnoh_app PUBLIC rnoh_lottie)
# RNOH_END: manual_package_linking_2
```

打开 `entry/src/main/cpp/PackageProvider.cpp`，添加：

```diff
#include "RNOH/PackageProvider.h"
#include "SamplePackage.h"
+ #include "LottieAnimationViewPackage.h"

using namespace rnoh;

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
    return {
      std::make_shared<SamplePackage>(ctx),
+     std::make_shared<LottieAnimationViewPackage>(ctx)
    };
}
```

### 4. 在 ArkTs 侧引入 Lottie 组件

找到 **function buildCustomComponent()**，一般位于 `entry/src/main/ets/pages/index.ets` 或 `entry/src/main/ets/rn/LoadBundle.ets`，添加：

```diff
  ...
+ import { LottieAnimationView, LOTTIE_TYPE } from "@react-native-ohos/lottie-react-native"

@Builder
export function buildCustomRNComponent(ctx: ComponentBuilderContext) {
  ...
+ if (ctx.componentName === LOTTIE_TYPE) {
+   LottieAnimationView({
+     ctx: ctx.rnComponentContext,
+     tag: ctx.tag
+   })
+ }
 ...
}
```

> [!TIP] 本库使用了混合方案，需要添加组件名。

在`entry/src/main/ets/pages/index.ets` 或 `entry/src/main/ets/rn/LoadBundle.ets` 找到常量 `arkTsComponentNames` 在其数组里添加组件名

```diff
const arkTsComponentNames: Array<string> = [
  SampleView.NAME,
  GeneratedSampleView.NAME,
  PropsDisplayer.NAME,
+ LOTTIE_TYPE
  ];
```

### 5. 在 ArkTs 侧引入 LottieAnimationViewPackage

打开 `entry/src/main/ets/RNPackagesFactory.ts`，添加：

> [!TIP] 版本 6.4.1-0.1.13 及以上需要

```diff
  ...
+ import {LottieAnimationViewPackage} from '@react-native-ohos/lottie-react-native/ts';

export function createRNPackages(ctx: RNPackageContext): RNPackage[] {
  return [
+    new LottieAnimationViewPackage(ctx)
  ];
}
```
</details>

### 运行

点击右上角的 `sync` 按钮

或者在命令行终端执行：

```bash
cd entry
ohpm install
```

然后编译、运行即可。



## 约束与限制

### 兼容性

本文档内容基于以下版本验证通过：

1. RNOH: 0.72.96; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
2. RNOH: 0.72.33; SDK: HarmonyOS NEXT B1; IDE: DevEco Studio: 5.0.3.900; ROM: Next.0.0.71;
3. RNOH: 0.77.18; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
4. RNOH: 0.82.1; SDK: HarmonyOS 6.0.1 Release SDK; IDE: DevEco Studio 6.0.1 Release; ROM:6.0.0.120 SP7;

### 权限要求

- 如果 source 使用网络 url 应用需要申请网络权限

  在`entry/src/main/module.json5`中添加

```json
requestPermissions: [
  {
    name: "ohos.permission.INTERNET",
  },
],
```

- 如果使用的 json 文件里有依赖图片资源或使用 imageAssetsFolder 属性，需要将资源文件放置到 HarmonyOS 工程 rawfile 下对应的路径中

rawfile 路径：`entry/src/main/resources/rawfile`

### 编译运行API要求（如有）

> [!TIP] 当前三方库所有版本均已实现版本隔离，支持在 `API12+` 工程编译，及 `API12+` ROM运行。

> [!TIP] 以下功能依赖特定版本的API，使用 `低于指定API版本的工程编译` 或 `低于指定API版本的ROM运行` 均可能导致部分功能受限。
1. 3.2.0版本引入[OH_ArkUI_NodeUtils_GetParentInPag](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/capi-native-node-h#oh_arkui_nodeutils_getparentinpagetree)，实现了xxx功能（解决/xxx问题），此API需要在支持`API14+`的工程编译，并在支持`API14+`的ROM上运行，方可生效。

  
 ## 使用示例
下面的代码展示了这个库的基本使用场景：

> [!WARNING] 使用时 import 的库名不变。

```javascript
import React from "react";
import { View } from "react-native";
import LottieView from "lottie-react-native";

const App = () => {
  return (
    <View style={{ flex: 1 }}>
      <LottieView 
        style={{ width: 300, height: 300 }} 
        source={require("./assets/xxx.json")}   
        autoPlay 
        loop />
    </View>
  );
};

export default App;
```

## 使用说明
**动画设置**
```javascript
 <LottieView
      source={require('./assets/animations/loading.json')} // JSON文件路径
      style={{ width: 200, height: 200 }}
      duration={6000}
      resizeMode={'center'}
      autoPlay        // 自动播放
      loop            // 循环播放

    />
```

**事件监听**
```javascript
<LottieView
    style={{ width: 300, height: 300 }}
    source={require("../assets/data_base64s.json")}
    loop
    onAnimationFinish={() => {
        // 动画播放完成时调用
    }}
     onAnimationLoaded={() => {
        // 加载完成时调用
    }}
     onAnimationFailure={(event)=>{
       // 动画加载或播放失败时调用 
    }}
/>
```

**播放控制**
```javascript
 const animationRef = useRef<LottieView>(null);

 <LottieView
    ref={animationRef}
    style={{ width: 300, height: 300 }}
    source={require("../assets/data_base64s.json")}
    loop={true} 
/>

// 重置动画
animationRef.current.reset();
// 播放动画
animationRef.current.play();
// 暂停动画
animationRef.current.pause();
// 恢复暂停的动画。
animationRef.current.resume();
```


## 接口说明

> [!TIP] "Platform"列表示该属性在原三方库上支持的平台。

> [!TIP] "OpenHarmony Support"列为 yes 表示 OpenHarmony平台支持 该属性；no 则表示不支持；partially 表示部分支持。使用方法跨平台一致，效果对标 iOS 或 Android 的效果。

### 组件
| 名称       | 参数类型     | 必填  | 平台  | OpenHarmony平台支持| 描述 |
|------------|------------|----------------------|------|-----|----------------|
| LottieView | [LottieViewProps](#LottieViewProps) | yes  | all | yes | LottieView组件 |

### 属性
LottieViewProps

| 名称                           | 参数类型          | 默认值       | 必填            | 平台   | HarmonyOS平台支持    | 描述 |
|------------------------------|--------------------|------------|---------------|------|------------------|---------------|
| source                       | string             | AnimationObject | { uri: string } | None | Yes              | 必填 - 动画来源。可以通过字符串引用本地资源，或通过带有 uri 属性的对象引用远程资源，也可以是动画的实际 JS 对象（例如通过 require('../path/to/animation.json') 获取）|
| progress                     | number             | 0          | No            | iOS, Android, Windows | Yes              | 0 到 1 之间的数字。该数字表示动画的标准进度。如果更新此属性，动画将相应更新到该进度值对应的帧。如果使用命令式 API，则不需要此属性。|
| speed                        | number             | 1          | No            | All  | Yes              | 动画播放的速度。设置为负值将使动画倒放                        |
| duration                     | number             | undefined  | No            | iOS, Android, Windows | Yes              | 动画的持续时间（毫秒）。设置后将优先于速度属性。此属性仅在 source 为动画的实际 JS 对象时有效。|
| loop                         | boolean            | true       | No            | All  | Yes              | 布尔值，指示动画是否应循环播放。                                |
| autoPlay                     | boolean            | false      | No            | All  | Yes              | 布尔值，指示组件挂载时是否自动开始播放动画。这仅影响命令式 API。     |
| resizeMode                   | 'cover'/ 'contain' /'center' | contain | No            | iOS, Android, Windows | Yes              | 确定当动画帧与原始图像尺寸不匹配时如何调整动画视图的大小。支持 cover、contain 和 center。|
| style                        | StyleProp<ViewStyle> | None       | No            | iOS, Android, Windows | Yes              | 视图的样式属性，与标准 View 组件期望的样式相同，不包括边框样式     |
| containerStyle<sup>7.3.0+</sup> | StyleProp<ViewStyle> | None       | No            | iOS, Android, VisionOS | Yes              | 最外层容器视图的样式属性，与标准 View 组件期望的样式相同。用于布局和定位。 |
| webStyle                     | CSSProperties      | None       | No            | Web  | No               | 视图的样式属性，使用 CSSProperties。 |
| imageAssetsFolder            | string             | None       | No            | Android | Yes              | Android 和 HarmonyOS 正确处理资源所需，iOS 将忽略此属性。   |
| useNativeLooping             | boolean            | false      | No            | Windows | No               | 仅适用于 Windows。启用后，使用平台级循环以提高流畅度，但 onAnimationLoop 不会触发，且更改 loop 属性将重置播放而不是正常结束。|
| onAnimationLoop              | callback           | None       | No            | Windows, Web | No               | 仅适用于 Windows 和 Web。动画循环播放时调用的回调函数。|
| onAnimationFinish            | callback           | None       | No            | All  | Yes              | 动画完成时调用的回调函数。此回调带有一个布尔值 isCancelled 参数，指示动画是实际完成播放，还是被取消（例如在播放时调用了 play() 或 reset()）。注意：仅在 loop 设置为 false 时才会调用此回调。|
| onAnimationFailure           | callback           | None       | No            | All  | Yes              | 处理动画（加载、运行等）过程中发生错误时调用的回调函数。此回调带有一个字符串 error 参数，其中包含发生的错误信息。|
| onAnimationLoaded            | callback           | None       | No            | All  | Yes              | 动画加载完成时调用的回调函数。此回调不带参数。 |
| renderMode                   | 'AUTOMATIC'        | 'HARDWARE' | 'SOFTWARE'    | AUTOMATIC | No               | iOS, Android | No   | 字符串标志，用于设置使用 HARDWARE（硬件）还是 SOFTWARE（软件）加速渲染 |
| cacheComposition             | boolean            | true       | No            | Android | Yes              | 仅适用于 Android 和 HarmonyOS，布尔值指示是否应对动画进行缓存。 |
| colorFilters                 | Array<ColorFilter> | []         | No            | iOS, Android, Windows | Yes              | 对象数组，表示通过 KeyPath 指定的图层以及新的颜色滤镜值（十六进制字符串）。  |
| textFiltersAndroid           | Array<TextFilterAndroid> | []         | No            | Android | No               | 仅适用于 Android，表示要查找和替换的文本值的对象数组。 |
| textFiltersIOS               | Array<TextFilterIOS> | []         | No            | iOS  | No               | 仅适用于 iOS，表示通过 KeyPath 指定的文本图层以及新的字符串值的对象数组。 |
| hover                        | boolean            | false      | No            | Web  | No               | 仅适用于 Web，布尔值表示鼠标悬停时是否播放。 |
| direction                    | 1                  | -1         | 1             | No   | Web              | No | 仅适用于 Web，数值 1 或 -1 表示播放方向。 |

### API
| 名称     | 类型     | 参数类型 | 返回值 | 必填    | 平台 | OpenHarmony平台支持 | 描述  |
|--------|---------|-----|-------|-------|--------|-----|-----------------|
| play   | function | /  | /   | No     | All | Yes   | 按指定的属性速度完整播放动画。也可以在调用 play(startFrame, endFrame) 时播放动画的一个部分（网页上不可用）。 |
| reset  | function | /  | /   | No     | All | Yes   | 将动画重置回 0 进度。 |
| pause  | function | /  | /   | No     | All | Yes   | 暂停动画。      |
| resume | function | /  | /   | No     | All | Yes   | 恢复暂停的动画。   |

## 遗留问题

- 原库部分接口在 HarmonyOS 中没有对应属性及接口处理相关逻辑，问题: [issue#18](https://github.com/react-native-oh-library/lottie-react-native/issues/18)

## 其他
无
  
## 目录结构
````
/rntpc_lottie-react-native  # 项目根目录
├── harmony              # 鸿蒙适配代码
│    └─ lottie.har          # har包
│    └─ lottie                  # 鸿蒙适配核心代码
│          └─ index.ets    # 鸿蒙适配代码入口    
│          └─ src/main/ets  
│              └─ LottieAnimationView  # lottieView组件   。基于ohos/lottie库封装的lottieView组件   
├── src                  # RN代码
│    └─ index.tsx  # 入口文件 
│    └─ LottieAnimationViewNativeComponent.ts 类型文件
│    └─ codegenUtils.ts # 类型文件          
├── README.md           # 英文安装使用方法    
├── README_zh.md   # 中文安装使用方法                    
````
  
## 贡献代码

欢迎通过 Issue 和 Pull Request 参与贡献。

- 提交 Issue：[GitCode Issues](https://gitcode.com/CPF-RN/rntpc_{alias}/issues)
- 提交 Pull Request：[GitCode Pull Requests](https://gitcode.com/CPF-RN/rntpc_{alias}/pulls)

请确保变更通过 lint 检查，并在 CHANGELOG 中记录变更内容。

## 开源协议

本项目基于 [The MIT License (MIT)](https://gitcode.com/CPF-RN/rntpc_{alias}/blob/master/LICENSE) ，请自由地享受和参与开源。
