# ArkTS 编译错误修复示例

> 本文档按 P0/P1/P2 优先级分类，提供各类编译错误的修复代码示例。
> 供 SKILL.md 第三层"自动诊断与修复"参考。

---

## P0：必须修复（阻止编译）

### P0-1：类型错误

**错误**：`Type 'number' is not assignable to type 'string'.`

```typescript
// ❌ 错误
let value: string = 123;

// ✅ 修复
let value: string = "123";
```

### P0-2：导入错误（不存在的导出名）

**错误**：`Module '"./xxx"' has no exported member 'NonExistentClass'.`

```typescript
// ❌ 错误
import { NonExistentClass } from './xxx';

// ✅ 修复 — 查看实际导出名
import { CorrectClassName } from './xxx';
```

### P0-3：括号不匹配

**错误**：`')' expected.` 或 `Unexpected token.`

```typescript
// ❌ 错误 — 缺少右括号
function test() {
  return doSomething(;
}

// ✅ 修复
function test() {
  return doSomething();
}
```

### P0-4：interface 不能 new

**错误**：`arkts-no-interface-inst  (6133)`

```typescript
// ❌ 错误 — interface 不能实例化
interface Config { name: string; }
const config = new Config();  // Error

// ✅ 修复 — 用对象字面量
const config: Config = { name: "test" };

// ✅ 或用 class + implements
class ConfigImpl implements Config { name: string = "test"; }
const config = new ConfigImpl();
```

### P0-5：static 方法通过实例调用

**错误**：`Property 'staticMethod' is a static member of type 'ClassName'.`

```typescript
class MathUtil {
  static add(a: number, b: number) { return a + b; }
}

// ❌ 错误 — 通过实例调用 static
const math = new MathUtil();
math.add(1, 2);

// ✅ 修复 — 用类名调用
MathUtil.add(1, 2);
```

### P0-6：catch(e) { throw e } 违反 arkts-limited-throw

**错误**：`arkts-limited-throw`

```typescript
// ❌ 错误 — 不能在 catch 中直接 throw
try {
  doSomething();
} catch (e) {
  throw e;  // Error: arkts-limited-throw
}

// ✅ 修复 — 用布尔标记模式
let success = false;
try {
  doSomething();
  success = true;
} catch (e) {
  // 记录错误，不直接 throw
}
if (!success) {
  // 通过返回值或标志位处理
}
```

---

## P0：源库 ArkTS 规范问题（不修复）

> ⚠️ 以下错误来自源库代码，**不修复**，报告中标注"源库 ArkTS 规范问题"。

### P0-S1：arkts-no-any

**错误**：`arkts-no-any  (6133)`

```typescript
// 源库代码（不修改）
function process(data: any) { ... }  // ArkTS 不允许 any
```

**处理**：标注"源库 ArkTS 规范问题，不修复"，继续构建。

### P0-S2：arkts-no-dynamic-property

**错误**：`arkts-no-dynamic-property`

```typescript
// 源库代码（不修改）
const obj: Record<string, Object> = {};
obj.dynamicProp = 123;  // ArkTS 不允许动态属性
```

**处理**：标注"源库 ArkTS 规范问题，不修复"，继续构建。

---

## P1：建议修复（废弃 API 迁移）

> ⚠️ 仅迁移**测试代码**中的废弃 API，源库代码不迁移。

### P1-1：@ohos.fileio → @ohos.file.fs

**错误**：`'@ohos.fileio' is deprecated. Use '@ohos.file.fs' instead.  (6387)`

```typescript
// ❌ 废弃
import fileio from '@ohos.fileio';
const fd = fileio.openSync(path, 0, 0o666);
const data = fileio.readSync(fd.buffer);

// ✅ 迁移 — 参数需调整（fs.open 返回 FILE，非 fd）
import fs from '@ohos.file.fs';
const file = fs.openSync(path, fs.OpenMode.READ_WRITE);
const data = new ArrayBuffer(1024);
fs.readSync(file.fd, data);
fs.closeSync(file);
```

### P1-2：AbilityContext → UIAbilityContext

**错误**：`'AbilityContext' is deprecated. Use 'UIAbilityContext' instead.  (6387)`

```typescript
// ❌ 废弃
import { AbilityContext } from '@ohos.abilityBase';

// ✅ 迁移
import { UIAbilityContext } from '@ohos.app.ability.UIAbility';
```

---

## P2：可选优化（不阻塞编译）

### P2-1：未使用变量（删除或加 `_` 前缀）

**错误**：`'unusedVar' is declared but never used.  (6133)`

```typescript
// ❌ 未使用
const unusedVar = 123;

// ✅ 修复 — 删除，或加下划线前缀
const _unusedVar = 123;  // 前缀 _ 表示有意未使用
```

### P2-2：异步函数缺异常处理

**错误**：`Add try-catch to the async function.  (addAsyncCatch)`

```typescript
// ❌ 缺异常处理
async function fetchData() {
  const res = await fetch(url);
  return res.json();
}

// ✅ 修复 — 添加 try-catch + 布尔标记
async function fetchData(): Promise<boolean> {
  try {
    const res = await fetch(url);
    const data = await res.json();
    return true;
  } catch (e) {
    return false;
  }
}
```

### P2-3：权限警告

**错误**：`Permission warning.  (28007)`

**处理**：权限警告不阻塞编译，报告中标注即可。
