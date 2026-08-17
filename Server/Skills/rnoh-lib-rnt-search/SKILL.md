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
> 1. demo 路径必须由用户确认，禁止自动选择后直接使用（避免选错库的 demo 污染 example）。
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
| `rnohVersion` | string | ❌ | 目标 RNOH 框架版本号（用于依赖版本对齐提示，非必填） |

> `rntPath` 与 `demoPath` 二选一：用户已明确 demo 路径时传 `demoPath` 跳过扫描；否则必须传 `rntPath` 由脚本扫描定位。

**派生变量**：
- `skillDir`：本 SKILL 所在目录
- `libMeta`：`read-lib-meta.cjs` 输出的库元数据 JSON
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
Phase 2: 扫描 rnt 工程定位 demo（find-rnt-demo.sh）
    ↓
Phase 3: 用户确认 demo 路径
    ↓
Phase 4: 分析 demo 结构与外部依赖（analyze-demo-deps.cjs）
    ↓
Phase 5: 迁移 demo 到目标 example/src（port-demo.sh）
    ↓
Phase 6: 修正 import 路径与 displayName
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

## Phase 2：扫描 rnt 工程定位 demo

若用户已提供 `demoPath`，跳过本步直接进入 Phase 3。

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

**未命中** → 询问用户手动提供 `--demo-path`，或换一个 rnt 工程根。

---

## Phase 3：用户确认 demo 路径

> ⚠️ **硬性要求**：无论扫描到 1 个还是多个 demo，**必须**向用户展示路径并请其确认。禁止 Agent 自行决定直接使用扫描结果。

| 命中数 | 处理 |
|--------|------|
| 0 | 询问用户手动提供 `demoPath` |
| 1 | 展示路径，请用户确认（Y/N） |
| 多个 | 列出所有路径，请用户选择其一 |

确认后记录 `demoPath`，进入 Phase 4。

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

1. **demo 来源**：rnt 工程路径、demo 子目录、命中候选名
2. **迁移文件清单**：相对路径列表 + 文件数
3. **依赖增量**：新增依赖、版本、来源（demo import 分析）
4. **路径修正记录**：每个修正的文件与改动
5. **待人工确认项**：业务无关依赖、displayName 冲突、入口文件覆盖等
6. **后续步骤**：建议执行 `rn-lib-add-example` 完成 Harmony 壳层适配与依赖写入

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
- **rnt 工程无 `rn-tester/examples/` 子目录**：报告并询问用户是否换一个 rnt 根路径。
- **demo 与已有 example/src 内容冲突**：默认增量合并；冲突文件列出请用户决策，不自动覆盖。
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
| 3 | 扫描到 1 个 demo | 必须用户确认（Y/N） |
| 4 | 扫描到多个 demo | 用户选择其一 |
| 5 | 是否清空目标 example/src | `--clean` 启用时必须确认 |
| 6 | 业务无关依赖是否写入 | 列出后请用户决策 |
| 7 | 入口文件覆盖冲突 | demo 与已有 App.tsx/index.tsx 冲突时 |

---

## Agent 禁止事项

- **禁止**在用户未确认 demo 路径前直接执行迁移。
- **禁止**自动启用 `--clean` 清空目标 `example/src/`（必须用户明确同意）。
- **禁止**修改目标库 `src/`、`harmony/` 源码（本 SKILL 只动 `example/src/`）。
- **禁止**自动写入 `example/package.json` 依赖（由 `rn-lib-add-example` 统一处理；本 SKILL 只产出依赖增量清单供下游使用）。
- **禁止**跳过迁移报告生成。
- **禁止**自动执行 `npm install` 或 `npm run dev`（验证由下游 SKILL 完成）。
- **禁止**迁移 demo 中的 `node_modules/`、`build/`、`__tests__/`（脚本默认排除，Agent 不得绕过）。

---

## 输出物清单

1. **迁移后的 `example/src/` 文件** — demo 源码已就位，路径已修正
2. **迁移报告 Markdown**（`rnt-demo-port-report.md`） — 含来源、文件清单、依赖增量、待办项
3. **依赖增量清单**（报告内章节） — 供 `rn-lib-add-example` 写入 `example/package.json` 使用
4. **待人工确认项清单**（报告内章节） — 业务无关依赖、冲突、原生代码标注
