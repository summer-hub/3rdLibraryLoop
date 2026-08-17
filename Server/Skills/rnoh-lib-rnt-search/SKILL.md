---
name: rnoh-lib-rnt-search
description: >-
  从 rnt（React Native Tester）工程中定位 RN 鸿蒙三方库的 demo 并迁移到指定 RN 目标工程的 example/src 下。读取目标库 package.json 元数据生成候选名，扫描 {rnt-root}/*/rn-tester/examples/ 匹配 demo 目录，分析 demo 结构与外部依赖，复制 demo 文件并修正 import 路径与依赖。当用户需要从 rnt 工程查找并迁移 demo 到 RN 鸿蒙三方库 example 工程、单独执行 demo 查找/迁移步骤、替换 example/src 内容、分析 rnt demo 依赖时使用。适用于 rnt demo 定位、demo 迁移、demo 依赖分析、example 内容替换等场景。
license: Apache-2.0
compatibility: 需要 bash、node、npm；目标 RN 工程需已有 example/ 目录（缺失时引导使用 rn-lib-add-example 创建）
allowed-tools: Bash Read Grep Glob Edit Write
metadata:
  author: rnoh-team
  version: "1.0.0"
  category: rn-demo-porting
  language: JavaScript/TypeScript
  consumed-by: rnohLibAddExampleSkill
---

# RN 鸿蒙三方库 rnt Demo 查找与迁移

从 rnt（React Native Tester）工程中定位目标 RN 三方库的 demo 目录，迁移到指定 RN 目标工程的 `example/src/`，并完成 import 路径与依赖的修正。

> ⚠️ **核心原则**：
> 1. 通过 RNOH 框架版本（git 分支或元数据）自动对齐库与 rnt，版本一致时自动选择 demo 并直接迁移，无需人工确认。
> 2. 本 SKILL 只负责「查找 + 迁移 demo 内容」，不创建/重建 example 工程模板、不做 Harmony 壳层（RNPackagesFactory/CMakeLists/build-profile 等）适配——这些由 `rn-lib-add-example` 完成。
> 3. 迁移完成后必须输出迁移报告，列出 demo 来源、文件清单、依赖增量、待人工确认项。

---

## 路径约定

`{SKILL_DIR}` = 本技能根目录（本 SKILL.md 所在目录）。命令均在 `{SKILL_DIR}` 下执行，使用 `scripts/...`、`references/...` 相对路径。

## 何时使用

- 用户要求从 rnt 工程查找并迁移某个 RN 三方库的 demo。
- 用户要求替换已有 RN 工程的 `example/src/` 内容。
- 用户在 `rn-lib-add-example` 流程中需要单独执行 Step 2（demo 查找与迁移）。
- 用户想分析 rnt demo 的外部依赖，决定 example 需要补哪些包。
- 用户拿到一个 rnt 工程根路径，想自动定位某个库的 demo 子目录。

## 最小必要输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libPath` | string | ✅ | 目标 RN 三方库根目录（含 `package.json`） |
| `rntPath` | string | ✅* | rnt 工程根目录（含多个子工程，每个有 `rn-tester/examples/`） |
| `demoPath` | string | ✅* | demo 目录绝对路径（用户已明确时直接传入，跳过扫描） |
| `targetExampleSrc` | string | ❌ | 目标 RN 工程 `example/src/` 路径；缺省时按 `libPath/example/src` 推断 |
| `cleanTarget` | boolean | ❌ | 迁移前是否清空目标 `example/src/`；默认 `false`（增量合并） |
| `rnohVersion` | string | ❌ | 目标 RNOH 框架版本号（如 "0.82"）。未提供时自动从 rnt 分支检测。用于版本对齐与分支切换。 |

> `rntPath` 与 `demoPath` 二选一：用户已明确 demo 路径时传 `demoPath` 跳过扫描；否则必须传 `rntPath` 由脚本扫描定位。

**派生变量**：
- `skillDir`：本 SKILL 所在目录
- `libMeta`：`read-lib-meta.cjs` 输出的库元数据 JSON
- `libVersion`：库的 RNOH 版本（`detect-rnoh-version.cjs` 输出）
- `rntVersion`：rnt 的 RNOH 版本（`detect-rnoh-version.cjs` 输出）
- `demoFiles`：demo 目录下待迁移的源文件清单
- `demoDeps`：`analyze-demo-deps.cjs` 输出的外部依赖清单

## 输入依赖

- **前置SKILL**：无（可独立调用）。若目标 RN 工程 `example/` 不存在，引导用户先执行 `rn-lib-add-example` 创建模板。
- **输入文件**：目标库 `package.json`、rnt 工程目录树、demo 源码目录。
- **输出文件**：迁移后的 `example/src/` 文件 + 迁移报告 Markdown。

---

## 工作流程概览

```
Phase 1: 读取库元数据（read-lib-meta.cjs）
    ↓
Phase 2: 版本检测与对齐（detect-rnoh-version.cjs，自动切换分支）
    ↓
Phase 3: 扫描 rnt 工程定位 demo（find-rnt-demo.sh，版本一致时自动选择）
    ↓
Phase 4: 分析 demo 结构与外部依赖（analyze-demo-deps.cjs）
    ↓
Phase 5: 迁移 demo 到目标 example/src（port-demo.sh）
    ↓
Phase 6: 修正 import 路径与 displayName + 入口接入
    ↓
Phase 7: 生成迁移报告并交付
```

> rnt 工程结构与 demo 目录约定详见 [references/RNT_PROJECT_STRUCTURE.md](references/RNT_PROJECT_STRUCTURE.md)。

---

## Phase 1：读取库元数据

读取目标库 `package.json`，提取用于 demo 搜索的候选名与鸿蒙化字段。

```bash
node scripts/read-lib-meta.cjs <libPath>
```

**关注字段**：

| 字段 | 用途 |
|------|------|
| `packageName` | npm 包名，写入 example `dependencies` |
| `alias` | `harmony.alias`，候选搜索名之一 |
| `scoped` | 去掉 scope 的短名，候选搜索名之一 |
| `dirBase` | 目录名，候选搜索名之一 |
| `searchNames` | 候选搜索名数组（去重） |
| `autolinkingResolved` | 鸿蒙化模块信息（供下游 `rn-lib-add-example` 壳层适配使用，本 SKILL 不直接处理） |

> 脚本详情与字段说明参见 [references/DEMO_PORTING_GUIDE.md](references/DEMO_PORTING_GUIDE.md) 的「库元数据字段」章节。

---

## Phase 2：版本检测与对齐

检测目标库与 rnt 工程的 RNOH 框架版本，当版本不一致时自动切换分支对齐。版本一致后直接进入 Phase 3，**无需用户确认**。

### 2.1 版本检测

```bash
# 检测库版本
node scripts/detect-rnoh-version.cjs <libPath>

# 检测 rnt 版本
node scripts/detect-rnoh-version.cjs <rntPath>
```

**版本检测优先级**：

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1 | Git 分支名 | `br_rnoh0.82` → `0.82` |
| 2 | example/package.json | `react-native-harmony: npm:@react-native-oh/react-native-harmony@0.77.72` → `0.77` |
| 3 | harmony subdirs oh-package.json5 | `@react-native-oh/*` 依赖版本 |
| 4 | package.json peerDependencies | `react-native: *` |

> 非 Git 仓库时自动降级到 package.json / oh-package.json5 检测。

### 2.2 版本对齐

| 场景 | 处理 |
|------|------|
| 库与 rnt 版本一致 | ✅ 直接进入 Phase 3 |
| 库版本 ≠ rnt 版本，库有对应分支 | 自动 `git checkout` 切换库分支 |
| 库版本 ≠ rnt 版本，rnt 有对应分支 | 自动 `git checkout` 切换 rnt 分支 |
| 两者都无法切换到一致版本 | 报错终止，列出可用分支供用户参考 |

**分支切换前必须检查工作区是否干净**：

```bash
# 检查是否有未提交的修改
git -C <path> status --short
```

| 工作区状态 | 处理 |
|-----------|------|
| 干净（无输出） | 直接 `git checkout` |
| 有未提交修改 | `git stash` 暂存 → `git checkout` → 迁移完成后 `git stash pop` 恢复 |

### 2.3 example/package.json 版本一致性检测

版本对齐后，检查 `example/package.json` 中的 `react-native` / `react-native-harmony` 版本是否与目标 RNOH 版本匹配：

```bash
# 读取 example/package.json 中的 react-native 版本
node -e "const p=require('./example/package.json'); console.log(p.dependencies['react-native'], p.dependencies['react-native-harmony'])"
```

| 匹配状态 | 处理 |
|---------|------|
| ✅ 版本匹配 | 直接进入 Phase 3 |
| ❌ 版本不匹配 | 在报告中标注「example/package.json react-native 版本与目标 RNOH 版本不一致」，由 `rn-lib-add-example` 更新 |

> 版本不一致不阻塞迁移，但在报告中标记为高优先级待确认项。

**分支切换示例**：

```bash
# 列出库的可用分支及版本
node scripts/detect-rnoh-version.cjs <libPath> --list-branches

# 切换到目标版本分支
git -C <libPath> stash  # 如有未提交修改
git -C <libPath> checkout br_rnoh0.82
git -C <libPath> stash pop  # 恢复暂存（如有）
```

> ⚠️ 版本对齐自动执行，不暂停等待用户确认。Agent 检测到版本不一致时直接切换分支使其对齐。

---

## Phase 3：扫描 rnt 工程定位 demo

版本对齐完成后，扫描 rnt 工程定位目标库的 demo 目录。当版本一致且命中唯一 demo 时**自动选择**，无需用户确认。

若用户已提供 `demoPath`，跳过本步直接进入 Phase 4。

```bash
bash scripts/find-rnt-demo.sh \
  --lib-path <libPath> \
  --rnt-path <rntPath>
```

**扫描规则**（详见 [references/RNT_PROJECT_STRUCTURE.md](references/RNT_PROJECT_STRUCTURE.md)）：

1. 读取 `read-lib-meta.cjs` 的 `searchNames` 作为候选名
2. 遍历 `{rntPath}/*/rn-tester/examples/{候选名}/`
3. 命中后做大小写不敏感兜底匹配
4. 输出每个 demo 路径一行；退出码：`0` = 唯一命中、`1` = 未找到、`2` = 多个命中

**自动选择规则**：

| 命中数 | 处理 |
|--------|------|
| 0 | 报错终止，提示用户手动提供 `--demo-path` 或检查 rnt 工程路径 |
| 1 | ✅ 自动选择，直接进入 Phase 4 |
| 多个 | 自动选择第一个命中项，报告中标注全部命中路径；用户可通过 `--demo-path` 指定其他 |

> 版本一致 + 唯一命中 = 自动选择，不暂停等待用户确认。

---

## Phase 4：分析 demo 结构与外部依赖

扫描 demo 目录的源文件（`.ts`/`.tsx`/`.js`/`.jsx`），提取：

1. **文件清单**：待迁移文件树（用于报告与迁移校验）
2. **外部依赖**：从 `import ... from 'pkg'` 与 `require('pkg')` 中提取所有非相对路径的包名
3. **目标库引用方式**：demo 中如何引用目标库（alias / 包名 / 相对路径）
4. **入口文件**：`App.tsx` / `index.tsx` 位置与 `displayName` / `title` 取值

```bash
node scripts/analyze-demo-deps.cjs <demoPath> [--lib-name <packageName>] [--alias <harmony.alias>]
```

输出 JSON：

```json
{
  "files": ["App.tsx", "index.tsx", "tests/index.tsx", "camera/CameraDemo.tsx"],
  "externalDeps": ["@react-native-community/cli", "react-native-svg"],
  "libReferences": [
    { "kind": "named", "module": "react-native-camera-kit", "names": ["Camera", "CameraType"] }
  ],
  "entryFiles": { "app": "App.tsx", "index": "index.tsx", "displayName": "CameraKitDemo" }
}
```

**依赖分类**：

| 类别 | 判定 | 处理 |
|------|------|------|
| 目标库本身 | `module === alias` 或 `packageName` | 迁移后改为 `file:../<tgz>` 引用（由 `rn-lib-add-example` 完成） |
| RNOH 框架 | `@react-native-oh/*` / `@rnoh/*` | 对齐目标 RNOH 版本，写入 example `dependencies` |
| 通用 RN 依赖 | `react-native-*` / `@react-native-*` | 写入 example `dependencies`，版本与 example 模板对齐 |
| 业务无关依赖 | 与目标库 demo 无关 | 列入「待人工确认」清单，不自动写入 |

> 详细依赖处理规则参见 [references/DEMO_PORTING_GUIDE.md](references/DEMO_PORTING_GUIDE.md) 的「依赖分析与写入」章节。

---

## Phase 5：迁移 demo 到目标 example/src

```bash
bash scripts/port-demo.sh \
  --demo-path <demoPath> \
  --target <targetExampleSrc> \
  [--clean] \
  [--exclude 'node_modules,build,__tests__']
```

**脚本行为**：

1. 校验 `demoPath` 与 `targetExampleSrc` 存在
2. `--clean` 时清空目标 `example/src/`（**默认不清空**，避免误删用户已有内容；执行前必须由用户确认）
3. 默认排除 `node_modules/`、`build/`、`__tests__/`、`.cxx/`、`oh_modules/`
4. 使用 `rsync -a` 保留文件元数据，复制 demo 全部内容到 `example/src/`
5. 输出迁移文件清单（相对路径）

**迁移后目录约定**（典型 demo 结构）：

```
example/src/
├── App.tsx              # demo 入口（含 displayName）
├── index.tsx            # 导出 demo 给 testerino 注册
├── tests/
│   └── index.tsx        # testerino 测试用例注册（修正相对路径）
├── camera/              # demo 功能子目录
├── scanCode/
└── components/          # demo 复用组件
```

> 迁移细节与边界情况（已有文件冲突、保留通用组件 `Navigation.tsx` 等）参见 [references/DEMO_PORTING_GUIDE.md](references/DEMO_PORTING_GUIDE.md)。

---

## Phase 6：修正 import 路径与 displayName

迁移后**必须**检查并修正以下内容（使用 `Edit` 工具逐文件处理）：

### 6.1 相对路径修正

`tests/index.tsx` 等子目录文件中引用 demo 内容的相对路径可能失效。常见修正：

| 错误写法 | 正确写法 | 原因 |
|----------|----------|------|
| `./camera/CameraDemo` | `../camera/CameraDemo` | `tests/` 下的文件引用上级目录 |
| `./components/Nav` | `../components/Nav` | 同上 |

### 6.2 入口文件对齐

- `example/src/App.tsx`：`displayName` / `title` 与 demo 名称一致
- `example/src/index.tsx`：`export` 路径与迁入的 demo 目录结构一致

### 6.3 目标库引用对齐

确认 demo 中目标库的引用方式与 example 的 `metro.config.js` 别名一致：

- demo 用 `import { X } from '<alias>'` → example `metro.config.js` 的 `extraNodeModules['<alias>']` 指向 `node_modules/<ohPackageName>`
- demo 用 `import { X } from '<packageName>'` → 同步更新 `tsconfig.json` 的 `paths`

> 完整路径修正检查清单参见 [references/DEMO_PORTING_GUIDE.md](references/DEMO_PORTING_GUIDE.md) 的「路径修正」章节。

### 6.4 入口文件接入

迁移后检查 demo 入口文件（如 `testCase/App.tsx`）是否已被 `example/src/index.tsx` 引用。若未接入，更新 `index.tsx` 使迁移的 demo 生效。

| 场景 | 处理 |
|------|------|
| `index.tsx` 已引用 demo 入口 | ✅ 无需处理 |
| `index.tsx` 是独立内容，未引用 demo 入口 | 更新 `index.tsx`，re-export demo 入口的默认导出和元数据 |
| demo 入口即为 `index.tsx` | ✅ 无需处理 |

**示例**（demo 入口在 `testCase/App.tsx`，`index.tsx` 原有独立内容）：

```tsx
// index.tsx — 更新为 re-export demo 入口
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

**检查方法**：

```bash
# 确认 index.tsx 是否引用了 demo 入口
grep -l "testCase/App\|demo/App\|./App" example/src/index.tsx
```

> 入口接入是迁移完成的必要步骤——未接入的 demo 入口不会在运行时生效。

### 6.5 Navigation.tsx 硬编码标题修正

rnt demo 中的 `Navigation.tsx`（或类似共享组件）常包含**其他库的硬编码标题**（如 `"RN Svg Capi Tester"`），是从 rnt 共享代码中遗留的。迁移后**必须**检测并修正。

**检测**：`analyze-demo-deps.cjs` 的 `hardcodedTitles` 字段列出所有匹配 `RN <Xxx> (Capi )?Tester` 模式的硬编码文本。

**修正规则**：

| 字段 | 值 |
|------|-----|
| 匹配模式 | `RN\s+\w+(?:\s+\w+)*\s+(?:Capi\s+)?Tester` |
| 替换值 | `RN <Alias> Tester`（Alias 从 `libMeta.alias` 取，首字母大写） |
| 替换范围 | 仅替换 `hardcodedTitles` 中列出的文件 |

**示例**：

```tsx
// ❌ 迁移前（Navigation.tsx 遗留的 Svg 库标题）
<Text>RN Svg Capi Tester</Text>

// ✅ 迁移后（修正为 PDF 库标题，alias = "react-native-pdf"）
<Text>RN Pdf Tester</Text>
```

**执行**：Agent 使用 `Edit` 工具，逐个替换 `hardcodedTitles` 中列出的文件里的硬编码文本。

> 未修正的硬编码标题会导致 demo 界面显示错误的库名，属于必修正项。

---

## Phase 7：生成迁移报告

按模板生成 Markdown 报告，记录迁移全过程与待办项。

```bash
# 报告模板位于 assets/PORT_REPORT_TEMPLATE.md
# Agent 读取模板后填充实际值并写入：
#   {libPath}/rn-lib-ohos/rnt-demo-port-report.md   （若处于 rn-lib-ohos 流程中）
#   或 {libPath}/rnt-demo-port-report.md              （独立调用时）
```

**报告必含**：

1. **版本信息**：库分支、rnt 分支、RNOH 版本、example/package.json 版本一致性
2. **demo 来源**：rnt 工程路径、demo 子目录、命中候选名
3. **迁移文件清单**：相对路径列表 + 文件数
4. **依赖增量**：新增依赖、版本、来源（demo import 分析）
5. **路径修正记录**：每个修正的文件与改动（含入口接入、Navigation.tsx 标题修正）
6. **待人工确认项**：业务无关依赖、版本不一致、入口文件覆盖等
7. **后续步骤**：建议执行 `rn-lib-add-example` 完成 Harmony 壳层适配与依赖写入

> 报告模板参见 [assets/PORT_REPORT_TEMPLATE.md](assets/PORT_REPORT_TEMPLATE.md)。

---

## 与其他 SKILL 的协作

| 协作 SKILL | 关系 | 调用时机 |
|-----------|------|---------|
| `rn-lib-add-example` | **下游** | 本 SKILL 完成 demo 迁移后，由 `rn-lib-add-example` 完成 example 模板创建（若缺失）、Harmony 壳层适配、依赖写入、License/OAT、构建验证 |
| `rn-lib-ohos` | **父流程** | 在 `rn-lib-ohos` Step 5 中调用本 SKILL 执行 demo 查找与迁移，再由 `rn-lib-add-example` 完成壳层适配 |
| `rnoh-lib-demo-coverage` | **下游（可选）** | 迁移完成后可调用覆盖率分析脚本评估 demo 对库 API 的覆盖程度 |

**职责边界**：

| 任务 | 负责SKILL |
|------|----------|
| 查找 rnt demo | 本 SKILL |
| 分析 demo 依赖 | 本 SKILL |
| 迁移 demo 文件 | 本 SKILL |
| 修正 import 路径 | 本 SKILL |
| 创建 example 模板 | `rn-lib-add-example` |
| 写入 example/package.json 依赖 | `rn-lib-add-example` |
| Harmony 壳层（RNPackagesFactory/CMakeLists/build-profile） | `rn-lib-add-example` |
| License 头 / OAT.xml | `rn-lib-add-example` |
| `npm run dev` 构建验证 | `rn-lib-add-example` |

---

## 常见边界情况

- **目标 example/ 不存在**：提示用户先执行 `rn-lib-add-example` 创建模板，本 SKILL 终止。
- **rnt 工程无 `rn-tester/examples/` 子目录**：报告终止，提示用户检查 rnt 根路径。
- **demo 与已有 example/src 内容冲突**：默认增量合并，rsync 覆盖冲突文件并在报告中标注。
- **版本无法对齐**：库与 rnt 均无对应版本分支时报错终止，列出可用分支供用户参考。
- **工作区有未提交修改**：切换分支前自动 `git stash`，迁移完成后 `git stash pop` 恢复。
- **example/package.json 版本不匹配**：example 的 react-native/react-native-harmony 版本与目标 RNOH 版本不一致时，报告中标注为高优先级待确认项，不阻塞迁移。
- **Navigation.tsx 含硬编码标题**：自动检测并替换为目标库的 alias（Phase 6.5）。
- **demo 入口未被 index.tsx 引用**：自动检测并接入（Phase 6.4）。
- **demo 引用了目标库的内部路径**（如 `react-native-camera-kit/src/internal`）：列入「待人工确认」，不自动改写。
- **demo 含原生代码**（`.ets`/`.cpp`）：本 SKILL 仅迁移 JS/TS 层；原生代码由 `rn-lib-add-example` 壳层适配处理，报告标注。
- **rnt 工程路径跨盘/网络挂载**：`rsync` 可能较慢，建议本地拷贝 rnt 工程后执行。

> 完整边界情况与处理策略参见 [references/PORT_VERIFICATION.md](references/PORT_VERIFICATION.md)。

---

## 需向用户确认的信息

| # | 节点 | 说明 |
|---|------|------|
| 1 | 目标库根目录路径 | 若未通过参数传入 |
| 2 | rnt 工程路径 | 若未通过参数传入 |
| 3 | 版本无法自动对齐 | 库与 rnt 均无对应版本分支时，提示用户手动指定 |
| 4 | 是否清空目标 example/src | `--clean` 启用时必须确认 |
| 5 | 业务无关依赖是否写入 | 列出后请用户决策 |
| 6 | 入口文件覆盖冲突 | demo 与已有 App.tsx/index.tsx 冲突时 |

---

## Agent 禁止事项

- **禁止**在版本未对齐时跳过版本检测直接迁移（必须先执行 Phase 2 确认版本一致或已切换分支）。
- **禁止**在有未提交修改时直接 `git checkout`（必须先 `git stash`）。
- **禁止**自动启用 `--clean` 清空目标 `example/src/`（必须用户明确同意）。
- **禁止**修改目标库 `src/`、`harmony/` 源码（本 SKILL 只动 `example/src/`）。
- **禁止**自动写入 `example/package.json` 依赖（由 `rn-lib-add-example` 统一处理；本 SKILL 只产出依赖增量清单供下游使用）。
- **禁止**跳过迁移报告生成。
- **禁止**跳过入口文件接入检查（Phase 6.4 必须执行）。
- **禁止**跳过 Navigation.tsx 硬编码标题修正（Phase 6.5 必须执行）。
- **禁止**自动执行 `npm install` 或 `npm run dev`（验证由下游 SKILL 完成）。
- **禁止**迁移 demo 中的 `node_modules/`、`build/`、`__tests__/`（脚本默认排除，Agent 不得绕过）。

---

## 输出物清单

1. **迁移后的 `example/src/` 文件** — demo 源码已就位，路径已修正
2. **迁移报告 Markdown**（`rnt-demo-port-report.md`） — 含来源、文件清单、依赖增量、待办项
3. **依赖增量清单**（报告内章节） — 供 `rn-lib-add-example` 写入 `example/package.json` 使用
4. **待人工确认项清单**（报告内章节） — 业务无关依赖、冲突、原生代码标注
