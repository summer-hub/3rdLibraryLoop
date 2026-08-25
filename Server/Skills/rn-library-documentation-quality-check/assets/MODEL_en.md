> Document Template：v0.4.1, [Document Template](../文档规范.md)(delete)

# <center>lottie-react-native</center>

This project is based on [lottie-react-native](https://github.com/lottie-react-native/lottie-react-native).

This third-party library has been migrated to Gitcode and is now available for direct download from npm, the new package name is: `@react-native-ohos/lottie-react-native`, The version correspondence details are as follows:

| Name | Version | Release Information | Supported RN Version | Supported Autolink | Compile API Version | Community Baseline Version | npm Address     |
| --------------| -------------- | ------------------------------ | ------------- | ------------- |------------------------ | ------------- | ------------- |
| @react-native-ohos/lottie-react-native |  [~ 7.3.0](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.82)    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_lottie-react-native/releases) | 0.82.* | No | API12+ | 7.3.4 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/lottie-react-native) | 
| @react-native-ohos/lottie-react-native  | [~ 7.2.3](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.77)     | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_lottie-react-native/releases) | 0.77.* | No | API12+ | 7.2.2 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/lottie-react-native) | 
| @react-native-ohos/lottie-react-native  | [~ 6.4.2](https://gitcode.com/CPF-RN/rntpc_lottie-react-native/tree/br_rnoh0.72)    | [Gitcode Releases](https://gitcode.com/openharmony-sig/rntpc_lottie-react-native/releases) | 0.72.* | Yes | API12+ | 6.4.1 | [Npm Address](https://www.npmjs.com/package/@react-native-ohos/lottie-react-native) | 
| @react-native-oh-tpl/lottie-react-native  | [<= 6.4.1-0.1.17@deprecated](https://github.com/react-native-oh-library/lottie-react-native/tree/sig) | [Github Releases(deprecated)](https://github.com/react-native-oh-library/lottie-react-native/releases) | 0.72.* | No | API12+ | 6.4.1 | [Npm Address](https://www.npmjs.com/package/@react-native-oh-tpl/lottie-react-native) | 

## Introduction

Lottie component for React Native.
Lottie is an ecosystem of libraries for parsing Adobe After Effects animations exported as JSON with bodymovin and rendering them natively!
For the first time, designers can create and ship beautiful animations without an engineer painstakingly recreating it by hand.

## Installation

Go to the project directory and execute the following instruction:

**npm**

```bash
npm install @react-native-ohos/lottie-react-native
```

**yarn**

```bash
yarn add @react-native-ohos/lottie-react-native
```

## Link

|                                      | Supported Autolink  | Supported RN Version |
|--------------------------------------|-----------------|------------|
| ~ 7.3.0                               |  No              |  0.82     |
| ~ 7.2.3                               |  No              |  0.77     |
| ~ 6.4.2                              |  Yes             |  0.72     |
| <= 6.4.1-0.1.17@deprecated             |  No              |  0.72     |

Projects using AutoLink need to be configured according to this document, AutoLink framework guide: https://gitcode.com/openharmony-sig/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md

If the version you are using supports Autolink and the project has integrated Autolink, you can skip the ManualLink configuration.

<details>
  <summary>ManualLink: This step provides guidance for manually configuring native dependencies.</summary>

Open the `harmony` directory of the OpenHarmony project in DevEco Studio.

### 1. Overrides RN SDK

To ensure the project relies on the same version of the RN SDK, you need to add an `overrides` field in the project's root `oh-package.json5` file, specifying the RN SDK version to be used. The replacement version can be a specific version number, a semver range, or a locally available HAR package or source directory.

For more information about the purpose of this field, please refer to the [official documentation](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V5/ide-oh-package-json5-V5#en-us_topic_0000001792256137_overrides).

```json
{
  "overrides": {
    "@rnoh/react-native-openharmony": "^0.72.38" // ohpm version
    // "@rnoh/react-native-openharmony" : "./react_native_openharmony.har" // a locally available HAR package
    // "@rnoh/react-native-openharmony" : "./react_native_openharmony" // source code directory
  }
}
```

### 2. Introducing Native Code

Currently, two methods are available:

- Use the HAR file.
- Directly link to the source code.

Method 1 (recommended): Use the HAR file.

> [!TIP] The HAR file is stored in the `harmony` directory in the installation path of the third-party library.

Open `entry/oh-package.json5` file and add the following dependencies:

```json
"dependencies": {
    "@react-native-ohos/lottie-react-native": "file:../../node_modules/@react-native-ohos/lottie-react-native/harmony/lottie.har"
  }
```

Click the `sync` button in the upper right corner.

Alternatively, run the following instruction on the terminal:

```bash
cd entry
ohpm install
```

Method 2: Directly link to the source code.

> [!TIP] For details, see [Directly Linking Source Code](/en/link-source-code.md).

### 3. Configuring CMakeLists and Introducing LottieAnimationViewPackage

Open `entry/src/main/cpp/CMakeLists.txt` and add the following code:

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

Open `entry/src/main/cpp/PackageProvider.cpp` and add the following code:

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

### 4. Introducing Lottie Component to ArkTS

Find **function buildCustomComponent()**, which is usually located in `entry/src/main/ets/pages/index.ets` or `entry/src/main/ets/rn/LoadBundle.ets`, and add the following code:

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

> [!TIP] This library uses a mixed solution, the component name needs to be added.

Find the constant `arkTsComponentNames` in `entry/src/main/ets/pages/index.ets` or `entry/src/main/ets/rn/LoadBundle.ets` and add the component name to the array.

```diff
const arkTsComponentNames: Array<string> = [
  SampleView.NAME,
  GeneratedSampleView.NAME,
  PropsDisplayer.NAME,
+ LOTTIE_TYPE
  ];
```

### 5. Introducing LottieAnimationViewPackage to ArkTS

Open `entry/src/main/ets/RNPackagesFactory.ts` and add:

> [!TIP] Required for version 6.4.1-0.1.13 and above

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

## Running

Click the `sync` button in the upper right corner.

Alternatively, run the following instruction on the terminal:

```bash
cd entry
ohpm install
```

Then build and run the code.


## Constraints

### Compatibility

This document is verified based on the following versions:

1. RNOH: 0.72.96; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
2. RNOH: 0.72.33; SDK: HarmonyOS NEXT B1; IDE: DevEco Studio: 5.0.3.900; ROM: Next.0.0.71;
3. RNOH: 0.77.18; SDK: HarmonyOS 6.0.0 Release SDK; IDE: DevEco Studio 6.0.0.858; ROM: 6.0.0.112;
4. RNOH: 0.82.1; SDK: HarmonyOS 6.0.1 Release SDK; IDE: DevEco Studio 6.0.1 Release; ROM:6.0.0.120 SP7;

### Permission Requirements

- If the source uses a network URL, the application needs to apply for network permissions.

  Include applicable permissions in the `entry/src/main/module.json5` file within the entry directory.

```json
requestPermissions: [
  {
    name: "ohos.permission.INTERNET",
  },
],
```

- If the JSON file used has dependent image resources or uses the imageAssetsFolder property, the resource files need to be placed in the corresponding path under the OpenHarmony project rawfile directory.

rawfile path: `entry/src/main/resources/rawfile`
  

## Example

The following code shows the basic use scenario of the repository:

> [!WARNING] The name of the imported repository remains unchanged.

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

## How to Use
**Animation settings**
```javascript
 <LottieView
      source={require('./assets/animations/loading.json')} // JSON文件路径
      style={{ width: 200, height: 200 }}
      duration={6000}
      resizeMode={'center'}
      autoPlay        // Auto play
      loop            // loop
    />
```

**Event Listener**
```javascript
<LottieView
    style={{ width: 300, height: 300 }}
    source={require("../assets/data_base64s.json")}
    loop
    onAnimationFinish={() => {
        // Called when animation finishes playing
    }}
     onAnimationLoaded={() => {
        // Called when loading is complete
    }}
     onAnimationFailure={(event)=>{
       // Call when animation fails to load or play 
    }}
/>
```

**Playback Control**
```javascript
 const animationRef = useRef<LottieView>(null);

 <LottieView
    ref={animationRef}
    style={{ width: 300, height: 300 }}
    source={require("../assets/data_base64s.json")}
    loop={true} 
/>

// Reset animation
animationRef.current.reset();
// Play animation
animationRef.current.play();
// Pause animation
animationRef.current.pause();
// Resume the paused animation.
animationRef.current.resume();
```


## Available APIs

> [!TIP] The **Platform** column indicates the platform where the properties are supported in the original third-party library.

> [!TIP] If the value of **HarmonyOS Support** is **yes**, it means that the OpenHarmony platform supports this property; **no** means the opposite; **partially** means some capabilities of this property are supported. The usage method is the same on different platforms and the effect is the same as that of iOS or Android.

### Components
| Name         | Parameter Type                 | Required  | Platform  | OpenHarmony Platform Support | Description          |
|--------------|------------------------|------|------|--------------|----------------------|
| LottieView   | [LottieViewProps](#LottieViewProps) | yes  | all | yes         | LottieView Component |

### Properties
LottieViewProps

| Name                            | Parameter Type                      | Default Value   | Required        | Platform               | OpenHarmony Platform Support | Description |
|---------------------------------|-------------------------------------|-----------------|-----------------|------------------------|----------------------------|-----------|
| source                          | string                              | AnimationObject | { uri: string } | None                   | Yes                        | Mandatory - The source of animation. Can be referenced as a local asset by a string, or remotely with an object with a uri property, or it can be an actual JS object of an animation, obtained (for example) with something like require('../path/to/animation.json') |
| progress                        | number                              | 0               | No              | iOS, Android, Windows  | Yes                        | A number between 0 and 1. This number represents the normalized progress of the animation. If you update this prop, the animation will correspondingly update to the frame at that progress value. This prop is not required if you are using the imperative API. |
| speed                           | number                              | 1               | No              | All                    | Yes                        | The animation playback speed. Setting it to a negative value will cause the animation to play in reverse. |
| duration                        | number                              | undefined       | No              | iOS, Android, Windows  | Yes                        | The duration of the animation (in milliseconds). This property takes precedence over the speed property. This property is only valid if the source is the actual JS object of the animation. |
| loop                            | boolean                             | true            | No              | All                    | Yes                        | A Boolean value indicating whether the animation should loop. |
| autoPlay                        | boolean                             | false           | No              | All                    | Yes                        | A boolean value indicating whether the animation should start automatically when the component is mounted. This only affects the imperative API. |
| resizeMode                      | 'cover'/ 'contain' /'center'        | contain         | No              | iOS, Android, Windows  | Yes                        | Determines how to resize the animated view when the frame doesn't match the raw image dimensions. Supports cover, contain and center. |
| style                           | StyleProp<ViewStyle>                | None            | No              | iOS, Android, Windows  | Yes                        | Style attributes for the view, as expected in a standard View, aside from border styling. |
| containerStyle<sup>7.3.0+</sup> | StyleProp<ViewStyle>                | None            | No              | iOS, Android, VisionOS | Yes                        | Style attributes for the outermost container view, as expected in a standard View. Useful for layout and positioning. |
| webStyle                        | CSSProperties                       | None            | No              | Web                    | No                         | Style attributes for the view, it uses CSSProperties. |
| imageAssetsFolder               | string                              | None            | No              | Android                | Yes                        | Needed for Android and HarmonyOS to work properly with assets, iOS will ignore it. |
| useNativeLooping                | boolean                             | false           | No              | Windows                | No                         | Only Windows. When enabled, uses platform-level looping to improve smoothness, but onAnimationLoop will not fire and changing the loop prop will reset playback rather than finishing gracefully. |
| onAnimationLoop                 | callback                            | None            | No              | Windows, Web           | No                         | Only Windows and Web. A callback function invoked when the animation loops. |
| onAnimationFinish               | callback                            | None            | No              | All                    | Yes                        | A callback function which will be called when animation is finished. This callback is called with a boolean isCancelled argument, indicating if the animation actually completed playing, or if it was cancelled, for instance by calling play() or reset() while is was still playing. Note that this callback will be called only when loop is set to false. |
| onAnimationFailure              | callback                            | None            | No              | All                    | Yes                        | A callback function which will be called if an error occurs while working with the animation (loading, running, etc). This callback is called with a string error argument, which contains the error message that occured. |
| onAnimationLoaded               | callback                            | None            | No              | All                    | Yes                        | A callback function which will be called when animation is done loading. This callback is called with no parameters. |
| renderMode                      | 'AUTOMATIC' /'HARDWARE' /'SOFTWARE' | AUTOMATIC       | No              | iOS, Android           | No                         | a String flag to set whether or not to render with HARDWARE or SOFTWARE acceleration |
| cacheComposition                | boolean                             | true            | No              | Android                | Yes                        | Only Android and HarmonyOS, a boolean flag indicating whether or not the animation should do caching. |
| colorFilters                    | Array<ColorFilter>                  | []              | No              | iOS, Android, Windows  | Yes                        | An array of objects denoting layers by KeyPath and a new color filter value (as hex string). |
| textFiltersAndroid              | Array<TextFilterAndroid>            | []              | No              | Android                | No                         | Only Android, an array of objects denoting text values to find and replace. |
| textFiltersIOS                  | Array<TextFilterIOS>                | []              | No              | iOS                    | No                         | Only iOS, an array of objects denoting text layers by KeyPath and a new string value. |
| hover                           | boolean                             | false           | No              | Web                    | No                         | Only Web, a boolean denoting whether to play on mouse hover. |
| direction                       | 1 /-1                               | 1               | No               | Web                   | No                         |  Only Web a number from 1 or -1 denoting playing direction.|

### API
| Name   | Type | Parameter Type | Return Value | Required | Platform | OpenHarmony Platform Support | Description |
|--------|-------|----------|---------|-------|--------|-----|-----------------|
| play   | function | / | / | No | All | Yes | Plays the animation completely at the specified speed. A portion of the animation can also be played when play(startFrame, endFrame) is called (not available on web pages).|
| reset  | function | / | / | No | All | Yes  | Resets the animation to 0 progress.|
| pause  | function | / | / | No | All | Yes  | Pauses the animation. |
| resume | function | / | / | No | All | Yes  | Resumes the paused animation.    |

## Known Issues

- Some interfaces of the original library do not have corresponding properties and interface handling logic in OpenHarmony: [issue#18](https://github.com/react-native-oh-library/lottie-react-native/issues/18)

## Other
  
## Directory Structure
````
/rntpc_lottie-react-native  # Project root directory
├── harmony              # HarmonyOS adaptation code
│    └─ lottie.har          # har package
│    └─ lottie                  # HarmonyOS adaptation core code
│          └─ index.ets    # HarmonyOS adaptation code entry point 
│          └─ src/main/ets  
│              └─ LottieAnimationView  # lottieView component. A LotteView component based on the ohos/lottie library 
├── src                  # React Native code
│    └─ index.tsx  # Entry file 
│    └─ LottieAnimationViewNativeComponent.ts //Type file
│    └─ codegenUtils.ts # Type file          
├── README.md           # English document    
├── README_zh.md   # Chinese document                 
````
  
## How to Contribute

If you find any problem when using lottie-react-native, submit an [issue](https://gitcode.com/openharmony-sig/rntpc_lottie-react-native/issues)or a[PR](https://gitcode.com/openharmony-sig/rntpc_lottie-react-native/pulls).
  
## License

The repository is based on [Apache License 2.0](https://github.com/lottie-react-native/lottie-react-native/blob/master/LICENSE).
