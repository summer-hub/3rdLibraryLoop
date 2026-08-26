# KI-008 react-native-orientation-locker：传感器频繁 open/close 性能优化

- **元数据**: `rule: R-06` · `verified: diff` · `source: community-issue` · `severity: medium` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-orientation-locker/pull/51（merged，1 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-orientation-locker-51.md](../pr-info/rntpc_react-native-orientation-locker-51.md)

## 现象

优化加速度传感器的打开和关闭——PR 45 修复后，每次 addListener/removeListener 都调用 openSensor/closeSensor，频繁操作导致性能问题。

## 根因

虽有引用计数，但去重逻辑不完善——同一 cb 重复添加时未判断是否已存在，导致计数重复增加；removeAllListeners 时未复位计数和补 closeSensor。

## 错误代码（修复前，PR 45 版本）

```javascript
// removeAllListeners 未处理传感器关闭
static removeAllListeners = () => {
    // 清空 listeners 但未复位计数、未 closeSensor  ← 传感器泄漏
};
```

## 正确代码（修复后）

```javascript
// ① addDeviceOrientationListener 中增加去重判断
if (!listeners[key]) {
    if (deviceOrientationListenerCount === 0) {
        OrientationNative.openSensor();  // ② 整个生命周期只调用一次
    }
    deviceOrientationListenerCount++;
}

// ③ removeAllListeners 中复位计数并补 closeSensor
static removeAllListeners = () => {
    // ...
    if (deviceOrientationListenerCount > 0) {
        deviceOrientationListenerCount = 0;
        OrientationNative.closeSensor();
    }
};
```

## 修复方式

完善引用计数管理的边界：addListener 时去重判断（同一 cb 不重复计数）；removeAllListeners 时复位计数并补一次 closeSensor，防止传感器泄漏。