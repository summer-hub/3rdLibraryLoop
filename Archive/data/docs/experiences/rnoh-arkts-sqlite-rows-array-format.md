## RNOH sqlite 库 ArkTS 层 SELECT 返回 rows 为数组，与上游 iOS/Android 形态不一致

### 问题现象

react-native-sqlite-storage 的鸿蒙实现中，SELECT 查询返回 `{rowsAffected, rows: [...]}`（**rows 为数组**，见 SQLitePluginTurboModule.ts 的 `queryResultcall = { 'rowsAffected': 0, 'rows': results }`），而上游 iOS/Android 返回 RS 对象（`{length, item(i)}`）。照搬上游示例的取值代码（如 `rows.item(0)` 或 `rows.length`）在鸿蒙侧行为异常。

### 解决方案

Demo/测试代码必须兼容两种形态：

```typescript
const row = Array.isArray(rows) ? rows[0] : rows.item(0);
const count = Array.isArray(rows) ? rows.length : rows.length;
```

### 结果

同一份 Demo 代码在鸿蒙与 iOS/Android 形态下均可正常取值。**鸿蒙化库写 Demo 时不能照搬上游示例的返回值取用代码**，必须先查证鸿蒙侧 TurboModule 的实际返回结构（读 `harmony/` 模块源码中 methodMap 对应实现）。