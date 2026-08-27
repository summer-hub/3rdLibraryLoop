# ESObject 声明 + 泛型构造的实例变量追踪语法级兜底

### 问题现象

ArkTS 测试代码常见写法：

```ts
let jList: ESObject = new JList<ESObject>();  // 声明类型是 ESObject，非类名
jList.append(2);
```

基于 `checker.getTypeAtLocation` + `checker.typeToString` 的实例变量追踪依赖类型字符串包含导入类名，但"声明类型为 ESObject + 泛型构造"的组合无法命中（模块解析失败时更是全部失效），导致 `jList.append(2)` 这类"声明变量后调用实例方法"的匹配全部漏报。

### 解决方案

在 checker 类型推断之外增加**语法级兜底**：遍历 `VariableDeclaration` 时，若 initializer 是 `NewExpression`，直接取 callee 标识符映射到导入类名：

```js
if (node.initializer && ts.isNewExpression(node.initializer)) {
  const callee = node.initializer.expression;
  if (callee && ts.isIdentifier(callee) && importedSymbols.has(callee.text)) {
    const displayName = importedSymbols.get(callee.text) || callee.text;
    if (!varMap[node.name.text]) varMap[node.name.text] = [];
    if (!varMap[node.name.text].includes(displayName)) varMap[node.name.text].push(displayName);
  }
}
```

`NewExpression` 的 `expression`（callee）与类型参数无关，因此天然覆盖泛型构造 `new JList<ESObject>()`，且在 checker 失效（模块解析失败）时依然工作。

### 结果

mp3agic 案例中 JList 等类的实例方法调用恢复匹配，覆盖率分析输出与人工 grep 盘点逐类一致。经验：基于 TS checker 的分析工具都应准备不依赖 checker 的语法级兜底路径，避免类型推断失效时静默丢失全部匹配。该修复已合入 `analyze-xts-coverage.cjs`（arkts-library-xts-coverage SKILL v1.1.0）。