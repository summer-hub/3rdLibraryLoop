## RN鸿蒙三方库渐进式编译验证经验（netinfo 0.82→0.84）

### 问题现象1：codegen脚本添加 --generate-type all 导致编译失败

运行 `npm run codegen` 报错 `error: unknown option '--generate-type'`。

### 解决方案

RNOH 提供两个不同的 codegen 命令，参数支持不同：

| 命令 | 用途 | 支持 --generate-type | 使用位置 |
|------|------|---------------------|---------|
| `react-native codegen-harmony` | 应用构建阶段 codegen | 不支持 | example/package.json 的 codegen 脚本 |
| `react-native codegen-lib-harmony` | 库开发阶段 codegen | 支持 | 库根 package.json 的 codegen-lib 脚本 |

从 example 的 codegen 脚本中移除 `--generate-type all` 参数。如需使用该参数，应在库根 package.json 中添加 `codegen-lib` 脚本并使用 `react-native codegen-lib-harmony`。

### 结果

移除参数后 `npm run codegen` 成功生成 5 个文件，`npm run dev` 成功构建 JS bundle，hvigor 构建成功。SKILL 中 0.82→0.84 不兼容变更表标注的"新增 --generate-type all（必选）"影响文件为库根 package.json 的 codegen-lib 脚本，不是 example 工程的 codegen 脚本。

---

### 问题现象2：npm pack 超时（>120s）

rnoh-build-har 执行后在 harmony/ 下产生临时工程文件（oh_modules 913MB、AppScope、build-profile.json5 等）。即使 .npmignore 已排除 harmony/oh_modules，npm pack 仍需遍历整个目录树导致超时。

### 解决方案

在 npm pack 前清理 rnoh-build-har 产生的临时文件：

```bash
rm -rf harmony/oh_modules harmony/<module>/build harmony/AppScope harmony/build-profile.json5 harmony/hvigor harmony/oh-package.json5
```

### 结果

清理后 npm pack 在数秒内完成。建议在 HAR 构建成功并拷贝到 harmony/<module>.har 后、npm pack 之前执行清理。

---

### 问题现象3：多任务并行时构建日志来源无法确认

多任务并行时，构建日志可能来自不同仓库。需验证日志路径来自当前任务仓库。

### 解决方案

```bash
# 确认当前任务路径在日志中出现（应为大量匹配）
grep -c "当前任务路径" <log_file>
# 确认其他任务路径不在日志中（应为 0 匹配）
grep -c "其他任务路径" <log_file>
```

### 结果

本次验证结果：当前任务路径 183 次匹配，其他任务路径 0 次匹配，确认日志来源正确。构建日志应保存到任务仓库目录内，便于验证来源。

---

### 问题现象4：CMake 编译中断 vs 完整完成无法区分

构建日志显示 CMake 在 CMakeTestCCompiler.cmake 阶段报错 ld.lld: error: unknown argument '-search_paths_first'，构建在 BuildNativeWithCmake 步骤中断。需判断 CMake 是否完整完成。

### 解决方案

检查构建日志中以下两个关键步骤是否都存在且无 ERROR：
- `Finished :entry:default@BuildNativeWithCmake...` — CMake 配置阶段
- `Finished :entry:default@BuildNativeWithNinja...` — C++ 编译阶段

### 结果

单一步骤完成不代表 CMake 完整完成，必须同时验证两个步骤。本次 netinfo 构建：CMake 11s 493ms + Ninja 4min 42s 464ms，两者均完整完成。

---

### 问题现象5：MCP check_ets_files 不支持 .ts 文件

MCP 工具 check_ets_files 仅支持 .ets 扩展名，无法对 .ts 文件进行语法检查。

### 解决方案

.ts 文件需通过实际编译验证语法正确性，无法使用 MCP check_ets_files 工具检查。

### 结果

对 .ts 文件跳过 MCP 语法检查，直接通过 npm run codegen 和 hvigor 构建验证。