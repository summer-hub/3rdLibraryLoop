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

| # | 相对路径 | 类型 | 备注 |
|---|---------|------|------|
| 1 | App.tsx | 入口 | displayName: {{displayName}} |
| 2 | index.tsx | 导出 | — |
| 3 | tests/index.tsx | testerino 注册 | 路径已修正 |
| ... | ... | ... | ... |

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

| # | 文件 | 修正类型 | 修正前 | 修正后 | 原因 |
|---|------|---------|--------|--------|------|
| 1 | index.tsx | 入口接入 | 独立内容 | re-export testCase/App | demo 入口未接入 |
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
| 1 | {{待确认项}} | {{说明}} | {{建议}} |
| ... | ... | ... | ... |

## 11. 后续步骤建议

本 SKILL 已完成 demo 文件迁移与路径修正。建议执行以下后续步骤：

1. **执行 `rn-lib-add-example`** 完成：
   - example 模板创建（若缺失）
   - `example/package.json` 依赖写入（消费本报告第 5 章）
   - `metro.config.js` / `tsconfig.json` 别名配置（消费本报告第 8 章）
   - Harmony 壳层适配（RNPackagesFactory.ets / CMakeLists.txt / build-profile.template.json5 等）
   - License 头补全 / OAT.xml 过滤项
   - `npm install --legacy-peer-deps && npm run dev` 验证

2. **（可选）执行 `rnoh-lib-demo-coverage`** 评估 demo 对库 API 的覆盖程度。

3. **人工确认**本报告第 10 章的待确认项。

---

> 报告生成完毕。如有疑问，请检查 `references/` 下的详细指南。
