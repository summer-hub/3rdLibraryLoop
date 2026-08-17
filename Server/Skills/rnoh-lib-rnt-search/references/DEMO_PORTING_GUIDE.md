# Demo 迁移详细指南

> 本文档说明 demo 迁移的完整流程、库元数据字段、依赖分析规则、路径修正检查清单。

---

## 1. 库元数据字段

`scripts/read-lib-meta.cjs` 输出 JSON，各字段用途：

| 字段 | 类型 | 来源 | 用途 |
|------|------|------|------|
| `packageName` | string | `package.json.name` | npm 包名，写入 example `dependencies` |
| `version` | string | `package.json.version` | tgz 版本号 |
| `alias` | string | `harmony.alias` 或 scoped | metro 别名，候选搜索名 |
| `scoped` | string | packageName 去 scope | 候选搜索名 |
| `dirBase` | string | 目录 basename | 候选搜索名 |
| `searchNames` | string[] | 上述去重 | demo 扫描候选名列表 |
| `autolinking` | object \| null | `harmony.autolinking` | 鸿蒙化链接配置（供下游壳层适配） |
| `autolinkingResolved` | object | 脚本推断 | 源码模块路径、CMake 路径等（供下游使用） |
| `codegenConfig` | object \| null | `package.json.codegenConfig` | codegen 配置 |

### 1.1 autolinkingResolved 字段

| 字段 | 说明 | 下游用途 |
|------|------|---------|
| `ohPackageName` | ohpm 包名 | `RNPackagesFactory.ets` import |
| `sourceModulePath` | `harmony/{module}/` 路径 | CMake `add_subdirectory`、`build-profile.template.json5` 的 `srcPath` |
| `harmonyModuleName` | 源码模块目录名 | `build-profile.template.json5` 的 `modules[].name` |
| `hasCpp` | 是否有 C++ 源码 | 决定是否写 CMake |
| `cmakeCppPath` | C++ 源码路径（node_modules 下） | CMake `add_subdirectory` |
| `cmakeShortName` | CMake 短名 | `add_subdirectory` 第二参数 |
| `etsPackageClassName` | ETS Package 类名 | `RNPackagesFactory.ets` |
| `cppPackageClassName` | C++ Package 类名 | `PackageProvider.cpp` |
| `cmakeLibraryTargetName` | CMake link target | `target_link_libraries` |

> ⚠️ `sourceModulePath` **不要**写入 `package.json` 的 `harmony.autolinking.mainHarPath`（会导致 RNOH CLI 扫不到 `.har`）。

---

## 2. 依赖分析与写入

### 2.1 依赖分类

`scripts/analyze-demo-deps.cjs` 扫描 demo 源码的 `import` / `require` 语句，按以下规则分类：

| 类别 | 判定规则 | 处理方式 |
|------|---------|---------|
| **相对路径** | `import './xxx'` / `import '../xxx'` | 忽略（demo 内部引用） |
| **Node 内置** | `fs` / `path` / `util` / `os` 等 | 忽略 |
| **React 核心** | `react` / `react-native` | 忽略（example 模板已内置） |
| **目标库本身** | `module === alias` 或 `packageName` | 标注，由 `rn-lib-add-example` 改为 `file:../<tgz>` |
| **RNOH 框架** | `@react-native-oh/*` / `@rnoh/*` / `react-native-harmony` | 列入 example `dependencies`，版本对齐 RNOH |
| **RN 通用包** | `react-native-*` / `@react-native-*` / `@react-native-community/*` | 列入 example `dependencies` |
| **其他第三方** | 不属于以上类别 | 列入「待人工确认」清单 |

### 2.2 依赖版本对齐

迁移报告产出依赖增量时，**不自动指定版本号**，由 `rn-lib-add-example` 按以下规则对齐：

| 依赖类型 | 版本来源 |
|----------|---------|
| 目标库本身 | `libPath/package.json` 的 `version`，引用方式 `file:../<name>-<version>.tgz` |
| RNOH 框架 | example 模板默认版本，或用户指定的 RNOH 版本 |
| 通用 RN 包 | example 模板已有版本优先；模板无则取 rnt 工程的版本 |
| 其他第三方 | 询问用户，或取 rnt 工程版本 |

### 2.3 依赖写入职责

> ⚠️ 本 SKILL **不**自动写入 `example/package.json`。只产出依赖增量清单，由下游 `rn-lib-add-example` 统一写入。

理由：
1. 版本对齐需要 example 模板上下文，本 SKILL 不感知模板版本
2. 避免多次写入冲突（`rn-lib-add-example` 也会写依赖）
3. 保持职责单一：本 SKILL 只做「分析」，不做「写入」

---

## 3. 迁移流程细节

### 3.1 迁移前检查

| 检查项 | 通过条件 | 失败处理 |
|--------|---------|---------|
| `demoPath` 存在 | 目录可访问 | 报错终止，提示用户重新提供 |
| `targetExampleSrc` 存在 | 目录可访问 | 引导用户先执行 `rn-lib-add-example` 创建模板 |
| `targetExampleSrc` 可写 | 有写权限 | 报错并终止 |
| 目标已有同名文件 | 列出冲突文件 | rsync 覆盖（demo 优先），报告中标注 |

### 3.2 --clean 选项

`--clean` 启用时，迁移前清空 `targetExampleSrc`：

```bash
# 脚本行为
rm -rf <targetExampleSrc>/*
# 然后复制 demo 内容
```

> ⚠️ `--clean` **必须**由用户明确同意。Agent 不得自动启用。建议保留通用组件 `Navigation.tsx`（若 demo 仍使用）——脚本默认不清除 `components/Navigation.tsx`，可通过 `--clean-all` 强制全清。

### 3.3 默认排除项

`port-demo.sh` 默认排除以下目录/文件：

| 排除项 | 原因 |
|--------|------|
| `node_modules/` | demo 自身的依赖，example 会重新 install |
| `build/` | 构建产物 |
| `__tests__/` | demo 自带的测试，example 有自己的 testerino 注册 |
| `.cxx/` / `oh_modules/` | 鸿蒙构建产物 |
| `.DS_Store` | macOS 垃圾文件 |
| `*.log` | 日志文件 |

可通过 `--exclude` 参数追加自定义排除项。

### 3.4 rsync 复制

使用 `rsync -a` 保留文件元数据（mtime、权限）：

```bash
rsync -a \
  --exclude 'node_modules/' \
  --exclude 'build/' \
  --exclude '__tests__/' \
  --exclude '.cxx/' \
  --exclude 'oh_modules/' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  "<demoPath>/" "<targetExampleSrc>/"
```

> 注意末尾 `/`：`<demoPath>/` 表示复制目录内容，`<demoPath>`（无 `/`）会复制目录本身。

---

## 4. 路径修正检查清单

迁移完成后，**逐文件**检查以下内容（使用 `Edit` 工具）：

### 4.1 相对路径修正

| 文件 | 检查内容 | 修正规则 |
|------|---------|---------|
| `tests/index.tsx` | 引用 demo 子目录的路径 | `./xxx` → `../xxx`（tests/ 在 src/tests/ 下，引用上级） |
| `tests/*.tsx` | 同上 | 同上 |
| 任何子目录文件 | 引用其他子目录 | 确保相对路径从 `example/src/` 起算 |

**示例**：

```tsx
// ❌ 迁移前（rnt demo 内 tests/index.tsx）
import { CameraDemo } from './camera/CameraDemo';
import { Navigation } from './components/Navigation';

// ✅ 迁移后（example/src/tests/index.tsx）
import { CameraDemo } from '../camera/CameraDemo';
import { Navigation } from '../components/Navigation';
```

### 4.2 入口文件对齐与接入

| 文件 | 检查内容 |
|------|---------|
| `App.tsx`（可在嵌套子目录如 `testCase/App.tsx`） | `displayName` / `title` 与 demo 名称一致 |
| `index.tsx`（根级） | 是否已引用 demo 入口；若未引用，re-export demo 入口 |
| `Test/index.tsx` 或 `tests/index.tsx` | testerino 注册的组件名与 `App.displayName` 一致 |

**入口接入检查**：

```bash
# 确认 index.tsx 是否引用了 demo 入口（testCase/App, demo/App, ./App 等）
grep -l "testCase/App\|demo/App\|./App" example/src/index.tsx
```

若未引用，更新 `index.tsx` 为 re-export：

```tsx
export {
  default,
  displayName,
  framework,
  category,
  title,
  documentationURL,
  description,
  examples,
} from './testCase/App';
```

### 4.3 Navigation.tsx 硬编码标题修正

`Navigation.tsx`（或类似共享组件）从 rnt 复制后可能包含**其他库的硬编码标题**。

**检测**：`analyze-demo-deps.cjs` 的 `hardcodedTitles` 字段列出所有匹配 `RN <Xxx> (Capi )?Tester` 的文本。

**修正**：

```tsx
// ❌ 迁移前（遗留的 Svg 库标题）
<Text>RN Svg Capi Tester</Text>

// ✅ 迁移后（替换为目标库 alias，如 react-native-pdf → Pdf）
<Text>RN Pdf Tester</Text>
```

### 4.4 目标库引用对齐

确认 demo 中目标库的引用方式与 example 配置一致：

| demo 引用方式 | example 需配置 |
|--------------|---------------|
| `import { X } from '<alias>'` | `metro.config.js` 的 `extraNodeModules['<alias>']` 指向 `node_modules/<ohPackageName>` |
| `import { X } from '<packageName>'` | `tsconfig.json` 的 `paths['<packageName>']` 指向 `./node_modules/<ohPackageName>` |
| `import { X } from '<packageName>/src/internal'` | 列入「待人工确认」，不自动改写 |

> 引用方式对齐的最终写入由 `rn-lib-add-example` 完成。本 SKILL 只检查并在报告中标注不一致项。

---

## 5. 迁移后自检

迁移完成后，执行以下自检（不需运行 `npm install`，仅静态检查）：

| 检查项 | 方法 | 通过标准 |
|--------|------|---------|
| 文件完整性 | 对比 `demoPath` 与 `targetExampleSrc` 文件清单 | 排除项外文件全部迁移 |
| 入口文件存在 | `find example/src -name "App.tsx" -o -name "index.tsx"` | 两个文件都存在（可嵌套） |
| index.tsx 接入 | `grep "testCase/App\|demo/App\|./App" example/src/index.tsx` | index.tsx 引用 demo 入口 |
| 相对路径有效 | grep `from '\./` 在子目录下 | 无错误的同级引用 |
| 目标库引用一致 | grep `import.*from.*'<alias>\|<packageName>'` | 引用方式与 example 配置一致 |
| 无硬编码标题 | grep `RN.*Tester` 在 Navigation.tsx 等 | 无其他库的遗留标题 |
| 无残留排除项 | `ls example/src/node_modules` 等 | 不存在（应被排除） |

> 自检脚本由 Agent 串联执行，结果写入迁移报告。

---

## 6. 与 rn-lib-add-example 的衔接

本 SKILL 完成后，迁移报告中的以下内容会被 `rn-lib-add-example` 消费：

| 报告章节 | 下游用途 |
|----------|---------|
| 依赖增量清单 | 写入 `example/package.json` 的 `dependencies` |
| 目标库引用方式 | 配置 `metro.config.js` 的 `extraNodeModules` |
| 入口文件 displayName | 配置 `App.tsx` 与 `Test/index.tsx` 注册 |
| 版本一致性检测结果 | 决定是否需要更新 example/package.json 的 react-native / react-native-harmony 版本 |
| 待人工确认项 | 由用户或 Agent 在壳层适配阶段决策 |
| 原生代码标注 | 决定是否需要 CMake / RNPackagesFactory 适配 |

> 迁移报告是本 SKILL 的**唯一交付物**，下游 SKILL 通过读取报告获取所需信息。
