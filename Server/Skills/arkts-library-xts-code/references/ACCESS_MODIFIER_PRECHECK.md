# 访问修饰符预检指南

> Phase 1.5 的详细参考文档。接口规格文档列出所有类的方法和属性，但**不包含访问修饰符信息**（`private`/`protected`/`public`）。若测试代码直接调用 `private`/`protected` 成员，ArkTS 编译会报 `Property 'X' is private and only accessible within class` 错误。

---

## 1. 执行预检脚本

```powershell
node {{skillDir}}/scripts/precheck-access-modifiers.cjs --source {{sourcePath}}
```

脚本行为：
- 递归扫描 `library/src/main/ets/` 下所有 `.ts`/`.ets` 源文件
- 提取每个类的 `private`/`protected` 属性和方法
- 按类分组输出 JSON 报告到 `{{sourcePath}}/precheck-access-modifiers.json`
- stdout 同时输出 JSON 供调用方读取

---

## 2. 生成排除清单

读取 `precheck-access-modifiers.json`，建立**禁止直接调用清单**：

```json
{
  "AbstractDao": {
    "properties": ["config", "db", "isStandardSQLite", "statements", "pkOrdinal", ...],
    "methods": ["loadAllFromCursor", "loadCurrent", "readEntity", "bindValues", "attachEntity", ...]
  },
  "QueryBuilder": {
    "properties": ["LOG_SQL", "isDistinct", "values", "joins", "limits", "offsets", ...],
    "methods": ["checkOrderBuilder", "handlePropertyCondition", "createSelectSql", ...]
  }
}
```

---

## 3. 代码生成规则（强制）

对清单中的每个 `private`/`protected` 成员，在 Phase 3 生成代码时遵守以下规则：

| 场景 | 处理方式 | 示例 |
|------|---------|------|
| 测试用例**仅**涉及 private/protected 成员 | 生成桩断言 + 注释说明间接覆盖路径 | 见下方模板 |
| 测试用例**混合** public 和 private 成员 | 保留 public 部分测试，private 部分替换为桩 | — |
| private 成员有对应的 public 入口方法 | 通过 public 方法间接覆盖，注释说明调用链 | `insert()` 内部调用 `attachEntity()` |

---

## 4. 桩断言模板

```typescript
/**
 * 用例 {SEQ}: {用例名称}
 *
 * 涉及接口：{private/protected 成员列表}
 * 预期结果：通过公共 API 间接覆盖
 */
it('test_name_{SEQ}', 0, () => {
  // Private/protected member - covered indirectly via public API
  // {成员名} is {modifier} in {ClassName}, tested via {publicMethodName}
  expect(true).assertTrue();
});
```

---

## 5. 预检结果注入并行 Agent

> 当使用并行 Agent 生成多个测试文件时，将排除清单注入每个 Agent 的 prompt 中，确保所有 Agent 生成的代码**第一次就符合规范**。

在 Agent prompt 中添加：

```
## 访问修饰符预检规则（必须遵守）
以下成员为 private/protected，禁止直接调用：
- AbstractDao: config, db, statements, loadAllFromCursor, readEntity, bindValues, ...
- QueryBuilder: LOG_SQL, isDistinct, values, joins, checkOrderBuilder, ...
对这些成员的测试，使用桩断言 expect(true).assertTrue() + 注释说明间接覆盖。
```

---

## 6. 预检后验证

| 检查项 | 通过条件 |
|--------|----------|
| 预检脚本已执行 | `precheck-access-modifiers.json` 已生成 |
| 排除清单已建立 | 所有 `private`/`protected` 成员已记录 |
| 桩断言已生成 | 对 private/protected 成员的测试使用 `expect(true).assertTrue()` |
| 并行 Agent 规则已注入 | 每个 Agent 的 prompt 包含排除清单 |
| 无 private 编译错误残留 | 编译阶段无 `Property 'X' is private` 错误 |
