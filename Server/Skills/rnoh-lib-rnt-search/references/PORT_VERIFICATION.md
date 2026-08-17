# 迁移验证与边界情况

> 本文档列出 demo 迁移的验证检查清单与常见边界情况的处理策略。

---

## 1. 迁移验证检查清单

迁移完成后，**逐项**确认以下检查通过。未通过项列入报告「待人工确认」。

### 1.1 文件完整性

| # | 检查项 | 命令 | 通过标准 |
|---|--------|------|---------|
| 1.1.1 | demo 文件全部迁移 | `diff <(cd <demoPath> && find . -type f -not -path './node_modules/*' -not -path './build/*' | sort) <(cd <targetExampleSrc> && find . -type f -not -path './node_modules/*' -not -path './build/*' | sort)` | 无差异（排除项除外） |
| 1.1.2 | 入口文件存在 | `find <targetExampleSrc> -name "App.tsx" -o -name "index.tsx"` | 两个文件都存在（可在嵌套子目录中） |
| 1.1.3 | testerino 注册存在 | `find <targetExampleSrc> -path "*/Test/index.tsx" -o -path "*/tests/index.tsx"` | 退出码 0（路径可为嵌套） |
| 1.1.4 | 无排除项残留 | `ls <targetExampleSrc>/node_modules 2>/dev/null` | 无输出（应被排除） |
| 1.1.5 | index.tsx 引用 demo 入口 | `grep -r "testCase/App\|demo/App\|./App" <targetExampleSrc>/index.tsx` | index.tsx 已接入 demo 入口 |

### 1.2 路径正确性

| # | 检查项 | 命令 | 通过标准 |
|---|--------|------|---------|
| 1.2.1 | 子目录下无错误相对路径 | `grep -rn "from '\./" <targetExampleSrc>/testCase/Test/ <targetExampleSrc>/tests/` | 无同级引用应为 `../` 的情况 |
| 1.2.2 | 所有 import 路径可解析 | 静态分析（Agent 读取每个 .tsx 文件） | 无 `Cannot find module` 风险 |

### 1.3 引用一致性

| # | 检查项 | 命令 | 通过标准 |
|---|--------|------|---------|
| 1.3.1 | 目标库引用方式一致 | `grep -rn "import.*from.*'<alias>\|<packageName>'" <targetExampleSrc>/` | 引用方式统一（全部用 alias 或全部用 packageName） |
| 1.3.2 | displayName 存在 | `grep -rn "displayName" <targetExampleSrc>/` | 存在且与 demo 名称一致 |
| 1.3.3 | 无硬编码其他库标题 | `grep -rn "RN.*Tester" <targetExampleSrc>/` | 无遗留的其他库名称（Phase 6.5 已修正） |

### 1.4 依赖完整性

| # | 检查项 | 方法 | 通过标准 |
|---|--------|------|---------|
| 1.4.1 | 所有外部依赖已列出 | 对比 `analyze-demo-deps.cjs` 输出与报告「依赖增量」章节 | 全部列出 |
| 1.4.2 | 无未识别的 require | `grep -rn "require(" <targetExampleSrc>/` | 所有 require 参数是字符串字面量且已分类 |

### 1.5 版本一致性

| # | 检查项 | 方法 | 通过标准 |
|---|--------|------|---------|
| 1.5.1 | 库与 rnt 版本一致 | `detect-rnoh-version.cjs` 输出对比 | 版本号相同 |
| 1.5.2 | example/package.json 版本匹配 | 检查 react-native / react-native-harmony 版本 | 与目标 RNOH 版本一致 |

---

## 2. 边界情况与处理策略

### 2.1 目标 example/ 不存在

**场景**：`libPath/example/` 目录不存在。

**处理**：
1. 终止本 SKILL
2. 输出提示：「目标 RN 工程 `example/` 目录不存在，请先执行 `rn-lib-add-example` 创建模板」
3. 在报告中记录阻塞原因

> 本 SKILL 不创建 example 模板，职责边界清晰。

### 2.2 rnt 工程无 rn-tester/examples/

**场景**：`{rnt-root}/*/rn-tester/examples/` 路径不存在。

**处理**：
1. 检查 rnt 根路径是否正确
2. 列出 `{rnt-root}` 下的子目录，提示用户确认 rnt 根路径
3. 询问是否换一个 rnt 工程根路径

### 2.3 demo 与已有 example/src 内容冲突

**场景**：迁移时发现 `targetExampleSrc` 已有同名文件。

**处理**：
- **默认（无 --clean）**：列出冲突文件清单，rsync 覆盖（demo 文件优先），在报告中标注冲突项
- **--clean 启用**：直接清空目标，但**必须**用户明确同意

**通用组件保留**：
- `components/Navigation.tsx` 等 example 模板通用组件，若 demo 仍引用，**保留**
- 脚本默认 `--clean` 时不清除 `components/Navigation.tsx`，可通过 `--clean-all` 强制全清

### 2.4 demo 引用目标库内部路径

**场景**：demo 中出现 `import { X } from 'react-native-camera-kit/src/internal'`。

**处理**：
1. 列入报告「待人工确认」清单
2. 不自动改写（内部路径可能依赖库源码结构）
3. 提示用户：可能需要调整 demo 改用公开导出，或调整 example 配置

### 2.5 demo 含原生代码

**场景**：demo 目录含 `.ets` / `.cpp` / `.h` 文件。

**处理**：
1. JS/TS 文件正常迁移到 `example/src/`
2. 原生文件**不迁移**到 `example/src/`（应放到 `example/harmony/` 下，由 `rn-lib-add-example` 壳层适配处理）
3. 在报告中标注：「demo 含原生代码 <文件列表>，需由 `rn-lib-add-example` 处理壳层适配」

### 2.6 rnt 工程路径跨盘/网络挂载

**场景**：rnt 工程在 NFS / SMB / iCloud 等网络挂载盘上，`rsync` / `find` 较慢。

**处理**：
1. 检测路径是否为网络挂载（`mount | grep <rntPath>`）
2. 若是，提示用户：「rnt 工程在网络挂载盘上，扫描/迁移可能较慢，建议本地拷贝后执行」
3. 不强制终止，由用户决定

### 2.7 候选名匹配到多个不同库

**场景**：`searchNames` 中的短名匹配到多个不同库的 demo（如 `react-native-svg` 匹配 `react-native-svg-uri`、`react-native-svg-transformer`）。

**处理**：
1. `find-rnt-demo.sh` 退出码 2（多个命中）
2. 列出所有命中路径与对应的库候选名
3. 自动选择第一个命中项，在报告中标注全部命中路径
4. 用户可通过 `--demo-path` 参数指定其他 demo

### 2.8 demo 入口文件缺失

**场景**：demo 目录无 `App.tsx` 或 `index.tsx`。

**处理**：
1. 检查是否有其他入口文件（`Main.tsx`、`Demo.tsx`、`index.js`）
2. 若有，在报告中标注实际入口文件
3. 若无任何入口文件，列入「待人工确认」，提示用户检查 demo 完整性

### 2.9 demo 引用 rnt 工程特有的全局变量/组件

**场景**：demo 中引用了 rnt 工程全局注入的组件（如 `__rntTesterGlobals`、特殊的 `Navigation`）。

**处理**：
1. 通过 `analyze-demo-deps.cjs` 的 `libReferences` 分析识别非标准引用
2. 列入报告「待人工确认」
3. 提示用户：可能需要移除或替换为 example 工程的等价物

### 2.10 大量 demo 文件导致迁移耗时

**场景**：demo 文件数 > 100，`rsync` 耗时较长。

**处理**：
1. 报告文件数与预估耗时
2. 正常执行（`rsync` 通常足够快，秒级完成）
3. 若超过 30 秒，检查是否有意外的大文件或排除项失效

---

## 3. 验证失败处理

| 失败项 | 处理 |
|--------|------|
| 文件完整性失败 | 重新执行 `port-demo.sh`，检查排除项配置 |
| 路径错误 | Agent 用 `Edit` 工具逐个修正 |
| 引用不一致 | 在报告中标注，由 `rn-lib-add-example` 配置 alias 时统一 |
| 依赖未列出 | 重新运行 `analyze-demo-deps.cjs`，检查 demo 新增的 import |
| displayName 冲突 | 询问用户保留哪个 |

---

## 4. 报告必含字段

迁移报告**必须**包含以下字段，缺失则视为迁移未完成：

| 字段 | 说明 |
|------|------|
| demo 来源路径 | rnt 工程路径 + demo 子目录 |
| 命中候选名 | `searchNames` 中实际匹配到的名称 |
| 迁移文件清单 | 相对路径列表 + 文件总数 |
| 依赖增量清单 | 分类列表（目标库 / RNOH / RN 通用 / 待确认） |
| 路径修正记录 | 修正的文件 + 改动内容 |
| 入口文件信息 | App.tsx / index.tsx 路径 + displayName |
| 待人工确认项 | 业务无关依赖、冲突、原生代码、特殊引用 |
| 验证检查结果 | 1.1-1.4 各项通过/失败状态 |
| 后续步骤建议 | 引导执行 `rn-lib-add-example` 完成壳层适配 |
