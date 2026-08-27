## ArkTS XTS 测试编译错误按根因聚类批量修复（含接口/实现类型不匹配等典型模式）

### 问题现象
mp3agic XTS 测试首轮编译出现 86 个错误。其中存在一类隐蔽的编译阻断：库接口声明的方法返回类型为 `Array<>` 而实现类实际返回 `JList<>`，导致**实现类实例无法赋值给接口类型参数**（如 `setId3v2Tag(v2Tag)`、`getId3v2Tag() === v2Tag`），测试代码中所有"实现类实例 → 接口参数/比较"路径全部编译失败。该类缺陷在 Demo 中不暴露（Demo 从不把具体实现类传给接受接口的方法），只有测试代码首次触达该赋值路径时才显现——**接口签名与实现返回类型不匹配是三方库测试代码的典型编译阻断源**。

### 解决方案
**按错误根因聚类批量修复**，而非逐条修。mp3agic 86 错误的根因只有 4 类，1 轮清零：
- 75 × 裸断言 → 括号配平转换器脚本批量转换（1 次）
- 4 × 重复 import → 去重（1 次）
- 1 × null 实参 → 等价 falsy 值替换（1 次）
- 6 × 接口/实现类型不匹配 → 修库接口声明（1 处修复消全部）

**典型错误模式识别表**：

1. **接口/实现返回类型不匹配**：`Argument of type 'ID3v23Tag' is not assignable to parameter of type 'ID3v2'. The types returned by 'getChapters()' are incompatible` + `is missing the following properties from type` → 库接口方法返回类型声明与实现类不一致。修复方式：**修接口声明对齐实现**（如 `Array<>` 改 `JList<>`），而非在测试里强转绕过。属源库机械性修正。

2. **裸断言调用**：subagent 生成 `assertTrue(x)` / `assertEqual(a, b)` 裸函数调用而非 `expect(x).assertTrue()` 链式调用 → 批量 "Cannot find name 'assertTrue'" 错误。修复：编写括号配平转换器（解析顶层逗号切分双参断言、单参断言直接包裹）一次性转换。预防：生成 prompt 中给出断言正反例，明确 `assertTrue(x)` 裸调用是错误写法。

3. **ArkTS 严格空值检查拒收 null 实参**：`new ID3v1Tag(null)` 报 `Argument of type 'null' is not assignable to parameter of type 'string'`。库源码虽有 `@ts-nocheck`，但**测试文件调用库 API 时仍受严格检查约束**。修复：库构造函数用 `if (data)` 判空（空串与 null 语义等价）时，改用 `new ID3v1Tag('')` 覆盖同一路径，需在注释中说明等价性依据。

4. **未从根入口导出的类型需深层路径导入**：实现类（如 ID3v1Tag）与自定义异常类（NoSuchTagException 等）未在 `library/index.ets` 导出，测试需深层路径导入：`import { ID3v1Tag } from '@ohos/mp3agic/src/main/ets/components/mp3agic/ID3v1Tag'`。**异常类必须真实 import 后才能用 `e instanceof XxxException` 做类型断言**。

### 结果
86 个编译错误 1 轮修复后 clean 全量重建 BUILD SUCCESSFUL（Code Linter 0 Error）。根因聚类修复（4 类各修 1 次）远快于逐条修 86 次。同类错误重复出现在多个文件时，优先写一次性批量转换脚本而非逐文件手改。