# KI-007 react-native-orientation-locker：加速度传感器初始化即打开

- **元数据**: `rule: R-06` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-orientation-locker/pull/45（merged，58 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-orientation-locker-45.md](../pr-info/rntpc_react-native-orientation-locker-45.md)

## 现象

使用 react-native-orientation-locker 库后，上架审核被拒——应用获取了用户的个人信息（加速度传感器），不符合相关法律法规要求。

## 根因

加速度传感器在模块初始化时即打开，而非在业务实际调用 addDeviceOrientationListener 时才按需开启——隐私合规要求"使用时才获取"，初始化即获取违反法规。

## 错误代码（修复前）

```typescript
// 模块顶层或初始化时直接调用 openSensor
// 每次 addListener 都 openSensor，removeListener 都 closeSensor
static addDeviceOrientationListener = cb => {
    OrientationNative.openSensor();  // ← 初始化即打开，每次添加都重复打开
    // ...
};
static removeDeviceOrientationListener = cb => {
    // ...
    OrientationNative.closeSensor();  // ← 每次移除都关闭，可能影响其他 listener
};
```

## 正确代码（修复后）

```typescript
// ① 引用计数变量
var deviceOrientationListenerCount = 0;

static addDeviceOrientationListener = cb => {
    var key = getKey(cb);
    if (!listeners[key]) {  // ② 去重：同一 cb 不重复 openSensor
        if (deviceOrientationListenerCount === 0) {
            OrientationNative.openSensor();  // ③ 计数为 0 时才打开
        }
        deviceOrientationListenerCount++;
    }
    // ...
};

static removeDeviceOrientationListener = cb => {
    // ...
    deviceOrientationListenerCount--;
    if (deviceOrientationListenerCount === 0) {
        OrientationNative.closeSensor();  // ④ 计数归 0 时才关闭
    }
};
```

## 修复方式

将传感器从"初始化即打开"改为"按需获取"：引入引用计数，首次 addListener 且 count===0 时才 openSensor；removeListener 时 count--，count===0 时才 closeSensor；同一 cb 重复添加不重复计数和 openSensor。