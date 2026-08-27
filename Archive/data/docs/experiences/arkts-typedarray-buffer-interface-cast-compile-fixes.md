## ArkTS 严格模式两类高频编译错误修复模板（TypedArray.buffer / 接口强转实现类）

### 问题现象

ArkTS 严格模式下生成 Demo 代码时两类高频编译错误（mp3agic Demo 生成中 5 个编译错误全部属于这两类）：

1. `arkts-no-structural-typing`：将 `new Uint8Array([1, 2]).buffer` 赋值给 `ArrayBuffer` 类型变量报错。根因：`.buffer` 属性类型为 `ArrayBufferLike`，属结构化类型，严格模式禁止此类赋值。
2. `neither type sufficiently overlaps`：接口类型向实现类 `as` 强转报错（如 `ID3v2` → `ID3v23Tag`、`ID3v2Frame` → `ID3v2ObseleteFrame`）。根因：接口声明与类成员不重叠时，TS 认为两类型不重叠，直接强转非法。

### 解决方案

**模板 1：TypedArray → ArrayBuffer 安全构造**

```typescript
// ❌ const buf: ArrayBuffer = new Uint8Array([1, 2]).buffer;  // arkts-no-structural-typing
// ✅
const buf: ArrayBuffer = new ArrayBuffer(2);
const view: Uint8Array = new Uint8Array(buf);
view[0] = 1; view[1] = 2;
```

**模板 2：接口 → 实现类安全转型（替代 as 强转）**

```typescript
// ❌ const tag: ID3v23Tag = mp3.getId3v2Tag() as ID3v23Tag;
// ✅
const raw: ID3v2 = mp3.getId3v2Tag();
if (!(raw instanceof ID3v23Tag)) { /* 错误处理 */ return; }
const tag: ID3v23Tag = raw;
```

**注意**：instanceof 收窄修复会引入新的类型引用，必须同步补全对应 import 语句，否则下一轮编译报 `Cannot find name 'X'`。

### 结果

两类写法各消耗一轮编译循环后方才修复；后续遇到同类问题直接套用模板可各避免一轮编译循环。修复引入新类型时同步检查 import 可再省一轮。