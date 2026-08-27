## ArkTS Demo 覆盖率分析：import 路径尾斜杠导致 0% 误报

### 问题现象

运行 `analyze-demo-coverage.cjs`（AST 模式）分析 mp3agic 库 Demo 覆盖率，首轮输出 `Demo 匹配完成: 0/271 (0.00%)`，但 grep 确认 Demo 明确 import 了库的 18 个类。若不人工核验直接采信首轮结果，会得出"Demo 完全未覆盖库接口"的严重错误结论。任何 Demo 源码使用 `from '@ohos/xxx/'`（尾部带 `/`）写法的鸿蒙库都会触发此类 0% 误报。

### 解决方案

**根因**：脚本 import 匹配判断 `fromLib === libName || fromLib.endsWith('/' + libName.split('/').pop())` 中，`'@ohos/mp3agic/'` 既不等于 `'@ohos/mp3agic'` 也不以 `'/mp3agic'` 结尾（结尾多了 `/`），所有 import 被静默跳过。正则模式 `extractImportsRegex` 与 AST 模式 `extractImportedSymbolsAST` 存在完全相同的判断缺陷；AST 模式 `resolveModuleNames` 中 `moduleName === libName` 同样失配，导致模块解析失败、库类型坍缩为 `any`。

**修复方案**（2026-08-27 已落入 `MCP/scripts/analyze-demo-coverage.cjs` 与 `analyze-xts-coverage.cjs`）：
1. 对模块说明符先做 `fromLib.replace(/\/+$/, '')` 归一化再比较（正则提取、AST 提取、resolveModuleNames 三处均需修改）
2. 同时兼容子路径 import：`fromNorm.startsWith(libName + '/')`（如 `@ohos/xxx/src/...`）
3. 默认导入检测正则追加 `(?:/[^'"]*)?` 容错尾斜杠/子路径

**旧版本脚本应急 workaround**：将 `entry/src/main/ets` 复制到临时目录，sed 去除 import 尾斜杠（mp3agic 案例 59 处），通过脚本已有的 `--src` 参数指向副本。

### 结果

修复后直接分析原始仓库即得真实覆盖率 69.37%（188/271），与人工核验值完全一致，无需任何副本 workaround。核心经验：覆盖率报告出现 0%/异常低值时，先 grep 确认 Demo 是否 import 了库——快速诊断口诀："import 有、覆盖无 → 查尾斜杠"。