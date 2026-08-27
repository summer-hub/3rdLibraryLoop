# 接口签名预检与修复对照表

> 本文档为 SKILL.md 1.3（生成前逐接口预检）与 4.3/4.4（编译期签名错误修复）的详细参考。
> 核心原则：**签名以库源码为准，禁止凭记忆或场景文档字面值编写**。

---

## 一、生成前逐接口预检表

对当前 Demo 涉及的每一个接口，逐项检查并记录结论：

| # | 检查项 | 查询来源 | 错误示例 → 正确做法 |
|---|-------|---------|------------------|
| 1 | **类型种类** | 接口规格文档第 4 章 | `(interface)` 不可 `new`，用对象字面量 `{ ... }`；`(class)` 可 `new`；`@ObservedV2` 类不可用于 `@State`/`@Prop`/`@Link`（V1 装饰器），须改用 V2 装饰器 `@Local`/`@Param`/`@Provider`/`@Consumer`（如 `@State option: ImageKnifeOptionV2` ❌ → `@Local option: ImageKnifeOptionV2` ✅） |
| 2 | **签名 vs 场景报告一致性** | 场景文档「对应函数接口」列 + 库源码 `library/Index.ets` | 场景报告是规划层面描述，参数/返回类型可能与源码不一致（实测案例：`setLoopCount` 报告写传常量、源码实际收 `boolean`；`setCacheShare` 报告写 `boolean`、源码收 `string`；`seekTo` 报告写数字、源码收 `string`）。**每个接口必须 read_file 库源码确认参数类型与返回值，以源码签名为准** |
| 3 | **返回值守卫** | 接口规格文档签名 | 返回类型含 `\| undefined` 或 `?:` → 调用后必须 `if (result)` 判空再访问属性（`result.imageWidth` ❌ → `if (result) { result.imageWidth }` ✅） |
| 4 | **参数类型匹配** | 接口规格文档签名 | 参数声明为 `common.UIAbilityContext` → 传 `appContext as common.UIAbilityContext`，不可直接传 `common.Context` |
| 5 | **回调参数签名** | 接口规格文档第 4 章回调接口定义 | 回调的每个字段名和参数类型逐字匹配（`(errorInfo: ErrorInfo) => void` ❌ → `(err: string, imageInfo: ImageInfo) => void` ✅） |
| 6 | **属性名准确性** | 接口规格文档第 3 章属性列表 | 只能使用文档列出的属性名（`obj.transformationType` ❌ → `obj.type` ✅） |
| 7 | **组件名/类名准确性** | `library/Index.ets` 导出名 | 与导出名**逐字符一致**，禁止自行追加 "V2"/"New" 等后缀（`ImageKnifeComponentV2` ❌ → `ImageKnifeComponent` ✅） |
| 8 | **import 类型存在性** | `library/Index.ets` 导出链 | 代码中 `import { X }` 的每个 X 必须在导出链中；未导出类型用**对象字面量**匹配结构，禁止 import；回调签名中的衍生类型须 read_file 库源码定位定义，库源码中也找不到则降级 `Record<string, Object>` 并标注"不可用" |
| 9 | **组件装饰器兼容** | 库组件源码 / 接口规格文档第 5 章 | 库组件使用 `@ObjectLink`/`@Prop`/`@Link` 时，关联类必须带 `@Observed` 装饰器（SKILL.md 0.2 预检应已识别） |
| 10 | **结构化类型禁令** | ArkTS 严格模式 | `new Uint8Array([..]).buffer` 类型为 `ArrayBufferLike`（结构化类型），直接赋值给 `ArrayBuffer` 触发 `arkts-no-structural-typing` → 改用 `new ArrayBuffer(n)` + `new Uint8Array(buf)` 视图逐元素写入 |
| 11 | **系统 API 签名/枚举/权限** | MCP 工具 `script_deveco_docs`（见 [SYSTEM_API_LOOKUP.md](SYSTEM_API_LOOKUP.md)） | 系统接口的方法签名、参数/返回值、import 路径、权限、系统能力必须查证，禁止凭记忆；枚举成员不做大小写假设（`ImageFit.CONTAIN` ❌ → `ImageFit.Contain` ✅） |

> **检索边界**：库自身 API 不在系统语料中，`script_deveco_docs` 会返回"未找到"，此时不检索、直接按接口规格文档/库源码编写。

---

## 二、场景文档差异四类专项核对

场景文档签名与库源码存在四类系统性差异，逐接口 read_file 源码专项核对（比全量核对更聚焦）：

1. **容器类型**：文档 `Array<T>` vs 源码 `JList<T>` 等 → 以源码为准
2. **rest 参数 vs 数组参数**：文档 `arrays: any[]` vs 源码 `...arrays` → 调用须展开为多参数 `func(...arr)`
3. **声明返回类型 vs 实际返回**：库 `.ts` 文件带 `@ts-nocheck` 时高发（编译器不校验）→ 按声明类型接值后用 `String(result)` 容错展示
4. **无条件抛异常方法**：文档预期成功、源码直接 `throw` → 按真实行为 try/catch 展示

命中任一类时以源码为准，并在 Demo 代码注释中说明差异。

---

## 三、编译错误签名修正协议（修复循环每轮执行）

生成代码的接口签名错误是系统性错误（未对照预检生成）。编译报错后按以下协议批量修正：

1. `read_file` 读取每个报错文件
2. 对照接口规格文档 + `library/Index.ets`，按错误关键词匹配修复：

| # | 编译错误关键词 | 修复方式 |
|---|--------------|---------|
| 1 | `Property 'xxx' does not exist` | 方法名拼写错误 → 查规格/源码替换（如 `rawQuery` → `queryRaw`） |
| 2 | `Expected N arguments, but got M` | 参数数量不匹配 → 查签名参数表补全/删除 |
| 3 | `Argument of type 'X[]' is not assignable` | rest 参数当数组传 → `func(...arr)` 展开 |
| 4 | `Property 'xxx' does not exist on type 'Y'` | 方法归属类错误 → 补中间链（`qb.list()` → `qb.build().list()`） |
| 5 | `arkts-no-any-unknown` / `arkts-no-inferred-generic-params` | any/unknown 类型 → 定义具体 interface，禁 `as` |
| 6 | `Module has no exported member` | import 不存在 → 对照 Index.ets，改用对象字面量 |
| 7 | `arkts-no-structural-typing` | `TypedArray.buffer`（`ArrayBufferLike`）赋值 `ArrayBuffer` → 见预检表 #10 |
| 8 | `neither type sufficiently overlaps` | 接口类型 `as` 强转实现类（如 `ID3v2` → `ID3v23Tag`）→ 先 `if (!(x instanceof ImplClass)) return;` 类型收窄，再赋值给目标类型 |

3. 同文件同类错误一次性批量替换
4. **修复引入新类型时同步补 import**：instanceof 收窄等修复会引入新类型引用，下轮编译将报 `Cannot find name 'X'`；每轮修复后检查改动文件的 import 区是否覆盖全部新引用类型

---

## 四、表外新错误

编译失败出现本表之外的错误：对照接口规格文档 + 库源码分析修复 → 记录错误模式 → 合并到本表，供下次任务复用。
