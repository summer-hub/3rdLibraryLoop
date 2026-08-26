# KI-014 react-native-amap-geolocation：onLocationError 未实现

- **元数据**: `rule: R-11` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-amap-geolocation/pull/27（merged，48 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-amap-geolocation-27.md](../pr-info/rntpc_react-native-amap-geolocation-27.md)

## 现象

react-native-amap-geolocation 的 onLocationError 没实现——用户传入 onLocationError 回调但错误发生时无任何反馈。

## 根因

JS 层声明了 onLocationError 回调 prop，但鸿蒙侧 ArkTS 实现中定位失败时未触发该回调，调用方无法感知错误——接口声明与实现之间存在断层。

## 错误代码（修复前，ArkTS 层）

```typescript
// AMapGeolocationModule.ts — 定位失败时无 onLocationError 触发
try {
    // 定位逻辑...
} catch (e) {
    // ← 无 onLocationError 回调触发，调用方无法感知错误
}
```

## 正确代码（修复后）

```typescript
// AMapGeolocationModule.ts — ① 定位失败时触发 onLocationError
try {
    // 定位逻辑...
} catch (e) {
    this.ctx.emit('onLocationError', {  // ② 触发声明的错误回调
        code: e.code,
        message: e.message
    });
}
```

## 修复方式

在定位失败的错误分支中补充 onLocationError 回调触发代码，使鸿蒙侧实现与 JS 层接口声明对齐。