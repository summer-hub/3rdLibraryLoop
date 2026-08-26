# PR #37: fix:Fix the issue where the horizontal camera view shifts downward.

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-07-31T16:28:57+08:00
- **分支**: br_rnoh0.82 → br_rnoh0.82
- **变更文件数**: 2

## PR 描述

## 一、变更类型（单选，仅勾选一项）
- [ ] feat（新增功能，对应 Changelog Added）
- [x] fix（修复 Bug，对应 Changelog Fixed）
- [ ] docs（文档变更，对应 Changelog Documentation）
- [ ] refactor（代码重构，对应 Changelog Changed）
- [ ] perf（性能优化，对应 Changelog Performance）
- [ ] test（测试相关，不进入 Changelog）
- [ ] chore（构建/工具链/依赖，不进入 Changelog）
- [ ] deprecated（标记弃用，对应 Changelog Deprecated）
- [ ] removed（移除功能，对应 Changelog Removed）
- [ ] security（安全修复，对应 Changelog Security）

## 二、变更内容
### 简要描述
解决横屏状态下相机显示问题

### 破坏性变更说明
无破坏性变更


## 三、测试步骤
运行demo,手机切换横屏，观察相机UI状态
测试demo
```
/**
 * @format
 */

import { AppRegistry } from 'react-native';
import RNTester from './rn-tester';
import { name as appName } from './app.json';

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { QRscanner } from 'react-native-qr-decode-image-camera';


export const QrExample = () => {

    const [flashMode, setflashMode] = useState(false);
    const onRead = res => {
        console.log("result:" + res);
    };
    return (
        <View style={styles.container}>
            <QRscanner
                onRead={onRead}
                isRepeatScan={true}
                renderBottomView={() => {
                    return (
                        <View
                            style={{
                                flex: 1,
                                flexDirection: 'row',
                                backgroundColor: '#0000004D',
                            }}>
                            <TouchableOpacity
                                style={{
                                    flex: 1,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                                onPress={() => {
                                    if (flashMode) {
                                        setflashMode(false);
                                    } else {
                                        setflashMode(true);
                                    }
                                }}>
                                <Text style={{ color: '#fff' }}>flashMode</Text>
                            </TouchableOpacity>
                        </View>
                    );
                }}
                flashMode={flashMode}
                finderY={50}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
});

AppRegistry.registerComponent(appName, () => QrExample);

```

## 四、测试情况
横屏状态UI显示正常
不涉及

## 五、合入前自检
- [x] 不涉及非兼容性变更；若涉及，已通过相应评审。
- [x] 不涉及性能或已进行性能测试且无性能劣化。
- [x] 符合对应的编码规范。
- [x] 无敏感信息泄露，如密码、密钥等。
- [x] 不涉及文档更新，或已更新了文档。
- [x] 针对可测试性要求，已增加必要的自测用例、合理的日志记录或Trace信息。
- [x] 不存在非法的文件引入，包括图片和代码等

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `src/Camera.tsx` | ? | +1 | -2 |
| `src/QRScannerView.js` | ? | +11 | -5 |

## Diff

### `src/Camera.tsx`

```diff
@@ -82,7 +82,6 @@ export const ComponentCamera = (props) => {
 
 const styles = StyleSheet.create({
   camera: {
-    width: '100%',
-    aspectRatio: 3 / 4,
+   flex: 1,
   },
 });
\ No newline at end of file

```

### `src/QRScannerView.js`

```diff
@@ -10,7 +10,8 @@ import {
   Vibration,
   Platform,
   PixelRatio,
-  StatusBar
+  StatusBar,
+  Dimensions
 } from 'react-native';
 /**
  * Scanning Interface Mask
@@ -46,11 +47,13 @@ export default class QRScannerView extends Component {
 
   constructor(props) {
     super(props);
+    const { width, height } = Dimensions.get('window');
     this.state = {
       topWidth: 0,
       topHeight: 0,
       leftWidth: 0,
-      animatedValue: new Animated.Value(0)
+      animatedValue: new Animated.Value(0),
+      isLandscape: width > height,
     }
     this.isClosed = false;
   }
@@ -101,7 +104,8 @@ export default class QRScannerView extends Component {
   //Measure the size of the entire scanning component
   measureTotalSize = (e) => {
     let totalSize = e.layout;
-    this.setState({ topWidth: totalSize.width })
+    const isLandscape = totalSize.width > totalSize.height;
+    this.setState({ topWidth: totalSize.width, isLandscape })
   }
 
   //Measure the position of the scan frame
@@ -298,9 +302,11 @@ export default class QRScannerView extends Component {
         <View
           style={{
             position: 'absolute',
-            bottom: this.props.hintTextPosition
+            ...(this.state.isLandscape
+              ? { top: this.getBottomMaskHeight() - this.props.finderY + 10, left: 0, right: 0, alignItems: 'center' }
+              : { bottom: this.props.hintTextPosition })
           }}>
-          <Text style={[this.props.hintTextStyle, { top: this.props.finderY, left: this.props.finderX }]}>{this.props.hintText}</Text>
+          <Text style={[this.props.hintTextStyle, !this.state.isLandscape ? { top: this.props.finderY, left: this.props.finderX } : {}]}>{this.props.hintText}</Text>
         </View>
 
       </View>

```
