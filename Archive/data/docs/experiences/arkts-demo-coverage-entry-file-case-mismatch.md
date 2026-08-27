## ArkTS 库入口文件大小写不一致导致覆盖率分析静默低估

### 问题现象

修复 import 尾斜杠问题后，mp3agic Demo 覆盖率仍仅 58.67%（159/271），抽查发现 `Mp3File.getId3v1Tag`（6 处调用）、`Mp3v2CommentFrameData.setLanguage` 等明显漏判。用最小化调试脚本重现 AST Program 后发现 `let mp3file = new Mp3File(...)` 的推断类型是 `any`，且存在 `Cannot find module '@ohos/mp3agic'` 诊断。此缺陷只造成部分漏判而非全 0（共 29 个接口漏判），脚本对"有库 import 但匹配数为 0 的文件"不产生任何警告、退出码仍为 0，极难在常规测试中暴露。

### 解决方案

**根因链**：`extract-interfaces.cjs` 的 `locateEntryFile` 候选路径硬编码 `library/Index.ets`（大写 I）；mp3agic 仓库实际文件是 `library/index.ets`（小写 i）；macOS 文件系统大小写不敏感，`fs.existsSync('Index.ets')` 通过，脚本拿到"看似有效"的错误大小写路径；`matchCoverageAST` 用该路径构造虚拟路径 key（`Index.ts`），而 `fileContents` Map 的 key 来自 `readdirSync` 的真实大小写（`index.ts`），精确匹配失败 → `resolveModuleNames` 解析不到模块 → 库类型全部坍缩为 `any` → 基于类型的调用匹配失效。

**修复方案**（2026-08-27 已落入脚本）：
1. `locateEntryFile` 返回前用 `fs.readdirSync(path.dirname(entryFile))` 核对文件名真实大小写并回写（toRealCase 辅助函数）
2. `resolveModuleNames` 解析入口虚拟路径失败时对 `fileContents` keys 做大小写不敏感回退查找
3. 新增静默失败告警防线：编译诊断出现 `Cannot find module '<库名>'`（TS 错误码 2307）时放弃 AST 结果、降级正则模式；文件有库 import 但匹配数为 0 时输出 ⚠️ 提示；覆盖率 0%/异常低（<10%）时在控制台与报告中输出「分析可信度警告」章节

**可复用诊断方法**：
- 用调试脚本打印 `checker.typeToString(getTypeAtLocation(varDecl))`，实例变量为 `any` 即模块解析失败
- 打印 `program.getSemanticDiagnostics()` 检查是否存在 `Cannot find module '<库名>'`
- 对报告"未覆盖"接口抽样 grep 真实调用数与报告交叉验证

**旧版本脚本应急 workaround**：复制 libroot 到临时目录（排除 .git），把 `library/index.ets` 重命名为 `Index.ets`，用 `--libroot` 指向副本。

### 结果

修复后在 macOS 上直接分析原始仓库（小写入口 + 尾斜杠 import）得到真实覆盖率 69.37%，与"临时副本改名"workaround 结果完全一致。平台差异提醒：入口大小写坑在 macOS（大小写不敏感文件系统）上表现为静默低估，在 Linux（大小写敏感）上表现为 `existsSync` 直接失败走降级逻辑，两者症状不同但同源。快速诊断口诀："部分漏、变量 any → 查入口大小写"。