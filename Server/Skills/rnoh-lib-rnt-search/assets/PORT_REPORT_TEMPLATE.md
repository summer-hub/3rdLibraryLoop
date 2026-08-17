# rnt Demo 迁移报告模板

> Agent 读取此模板，填充 `{{占位符}}` 实际值后写入目标路径。
> 输出路径：`{libPath}/rnt-demo-port-report.md`（或 `{libPath}/rn-lib-ohos/rnt-demo-port-report.md` 处于父流程中时）

---

# rnt Demo 迁移报告 — {{库名}}

> 生成时间：{{生成时间}}
> 生成工具：rnoh-lib-rnt-search v1.0.0

## 1. 基本信息

| 项 | 值 |
|----|-----|
| 目标库 | {{packageName}} |
| 库版本 | {{version}} |
| harmony.alias | {{alias}} |
| 目标库根目录 | {{libPath}} |
| 目标 example/src | {{targetExampleSrc}} |
| rnt 工程根 | {{rntPath}} |
| 库分支 | {{libBranch}} |
| rnt 分支 | {{rntBranch}} |
| RNOH 版本 | {{rnohVersion}} |
| example/package.json RN 版本 | {{exampleRnVersion}} |
| 版本一致性 | ✅ 一致 / ❌ 不一致 |

## 2. demo 来源

| 项 | 值 |
|----|-----|
| rnt 子工程 | {{rntSubproject}} |
| demo 目录路径 | {{demoPath}} |
| 命中候选名 | {{matchedSearchName}} |
| 扫描方式 | 自动扫描 / 用户指定 |
| demo 结构 | 根级入口 / testCase 嵌套 / 混合 |

## 3. 库元数据（read-lib-meta.cjs 摘要）

```json
{{libMetaJson}}
```

> 完整元数据由 `read-lib-meta.cjs` 输出。`autolinkingResolved` 供下游 `rn-lib-add-example` 壳层适配使用。

## 4. 迁移文件清单

迁移文件总数：{{文件总数}}

> 迁移模式：**增量添加**（`--ignore-existing`），不覆盖目标已有文件。

| # | 相对路径 | 类型 | 迁移状态 | 备注 |
|---|---------|------|---------|------|
| 1 | App.tsx | 入口 | ✅ 新增 | displayName: {{displayName}} |
| 2 | index.tsx | 导出 | ✅ 新增 / ⚠️ 冲突保留 | — |
| 3 | tests/index.tsx | testerino 注册 | ✅ 新增 | 路径已修正 |
| ... | ... | ... | ... | ... |

### 4.0 冲突文件清单（目标版本已保留）

> 以下文件在目标 `example/src/` 中已存在，**目标版本已保留，demo 版本未写入**。请人工确认是否需要合并：

| # | 相对路径 | 目标版本来源 | 建议 |
|---|---------|-------------|------|
| 1 | {{冲突文件}} | example 模板 / 上次迁移 | 手动对比差异后决定是否合并 |
| ... | ... | ... | ... |

> 若无冲突文件，本节标注「无冲突」。

### 4.1 排除项

以下目录/文件未迁移（脚本默认排除）：

- `node_modules/`
- `build/`
- `__tests__/`（demo 自带测试）
- `.cxx/` / `oh_modules/`
- `.DS_Store` / `*.log`

### 4.2 原生代码（若有）

> demo 含以下原生文件，未迁移到 `example/src/`，需由 `rn-lib-add-example` 处理壳层适配：

| 文件 | 类型 | 建议处理 |
|------|------|---------|
| {{原生文件}} | .ets / .cpp / .h | 移至 `example/harmony/` |

## 5. 依赖增量清单

### 5.1 目标库本身

| 包名 | 引用方式 | 建议写入 example/package.json |
|------|---------|------------------------------|
| {{packageName}} | `import { X } from '{{alias}}'` | `"{{packageName}}": "file:../{{tgzName}}"` |

### 5.2 RNOH 框架依赖

| 包名 | 当前版本 | 建议版本 | 来源 |
|------|---------|---------|------|
| @react-native-oh/react-native-harmony | — | {{rnohVersion}} | example 模板默认 |

### 5.3 RN 通用依赖

| 包名 | demo 引用 | 建议版本来源 |
|------|----------|-------------|
| {{pkgName}} | `import { X } from '{{pkgName}}'` | example 模板 / rnt 工程 |

### 5.4 待人工确认依赖

> 以下依赖未自动分类，请用户确认是否写入 example/package.json：

| 包名 | demo 引用 | 说明 |
|------|----------|------|
| {{pkgName}} | `import { X } from '{{pkgName}}'` | {{说明}} |

## 6. 路径修正记录

> 仅记录**本次新增文件**的修正。目标已有文件（冲突保留项）不修改，其待修正项列入第 10 章待人工确认。

| # | 文件 | 修正类型 | 修正前 | 修正后 | 原因 |
|---|------|---------|--------|--------|------|
| 1 | index.tsx | 入口接入 | 独立内容 | re-export testCase/App | demo 入口未接入（仅新增文件） |
| 2 | testCase/Navigation.tsx | 硬编码标题 | "RN Svg Capi Tester" | "RN Pdf Tester" | 遗留其他库标题 |
| ... | ... | ... | ... | ... | ... |

## 7. 入口文件信息

| 文件 | 字段 | 值 |
|------|------|-----|
| {{appPath}} | displayName | {{displayName}} |
| {{appPath}} | title | {{title}} |
| index.tsx | 接入方式 | re-export {{appPath}} / 独立入口 |
| {{testIndexPath}} | 注册组件名 | {{registeredNames}} |

## 8. 目标库引用方式

| demo 引用方式 | example 配置建议 | 状态 |
|--------------|-----------------|------|
| `import { X } from '{{alias}}'` | metro.config.js extraNodeModules | 待 rn-lib-add-example 配置 |
| `import { X } from '{{packageName}}'` | tsconfig.json paths | 待 rn-lib-add-example 配置 |

## 9. 验证检查结果

| # | 检查项 | 结果 | 备注 |
|---|--------|------|------|
| 1.1.1 | 文件完整性 | ✅ / ❌ | {{备注}} |
| 1.1.2 | 入口文件存在 | ✅ / ❌ | {{备注}} |
| 1.1.3 | testerino 注册存在 | ✅ / ❌ | {{备注}} |
| 1.1.4 | 无排除项残留 | ✅ / ❌ | {{备注}} |
| 1.1.5 | index.tsx 引用 demo 入口 | ✅ / ❌ | {{备注}} |
| 1.2.1 | 子目录下无错误相对路径 | ✅ / ❌ | {{备注}} |
| 1.2.2 | import 路径可解析 | ✅ / ❌ | {{备注}} |
| 1.3.1 | 目标库引用方式一致 | ✅ / ❌ | {{备注}} |
| 1.3.2 | displayName 存在 | ✅ / ❌ | {{备注}} |
| 1.3.3 | 无硬编码其他库标题 | ✅ / ❌ | {{备注}} |
| 1.4.1 | 外部依赖已列出 | ✅ / ❌ | {{备注}} |
| 1.4.2 | 无未识别 require | ✅ / ❌ | {{备注}} |
| 1.5.1 | 库与 rnt 版本一致 | ✅ / ❌ | {{备注}} |
| 1.5.2 | example/package.json 版本匹配 | ✅ / ❌ | {{备注}} |

## 10. 待人工确认项

| # | 项 | 说明 | 建议 |
|---|----|------|------|
| 1 | 冲突文件合并 | demo 与目标同名文件已保留目标版本（见 4.0 章） | 手动对比差异后决定是否合并 |
| 2 | 入口文件接入 | 若 index.tsx 为已有文件且未引用 demo 入口 | 手动在已有 index.tsx 中添加 re-export |
| 3 | 已有文件硬编码标题 | 目标已有文件中的 Navigation.tsx 等含其他库标题 | 手动修正或确认无需处理 |
| 4 | 业务无关依赖 | demo 引用了与目标库无关的包 | 确认是否写入 example/package.json |
| 5 | 版本不一致 | example/package.json RN 版本与目标 RNOH 版本不一致 | 由 rn-lib-add-example 更新 |
| ... | ... | ... | ... |

## 11. 后续步骤建议

本 SKILL 已完成 demo 文件**增量迁移**（不覆盖已有文件）与新增文件路径修正。建议执行以下后续步骤：

1. **执行 `rn-lib-add-example`** 完成：
   - example 模板创建（若缺失）
   - `example/package.json` 依赖写入（消费本报告第 5 章）
   - `metro.config.js` / `tsconfig.json` 别名配置（消费本报告第 8 章）
   - Harmony 壳层适配（RNPackagesFactory.ets / CMakeLists.txt / build-profile.template.json5 等）
   - License 头补全 / OAT.xml 过滤项
   - `npm install --legacy-peer-deps && npm run dev` 验证

2. **（可选）执行 `rnoh-lib-demo-coverage`** 评估 demo 对库 API 的覆盖程度。

3. **人工确认**本报告第 10 章的待确认项，特别是：
   - 冲突文件是否需要手动合并（第 4.0 章）
   - 已有 index.tsx 是否需要手动接入 demo 入口
   - 已有文件中的硬编码标题是否需要修正

---

> 报告生成完毕。如有疑问，请检查 `references/` 下的详细指南。
