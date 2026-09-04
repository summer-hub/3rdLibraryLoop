---
name: rnoh-lib-demo-coverage
description: 分析 RN 鸿蒙三方库现有 Demo 对接口的覆盖情况。通过 rn-analyze-demo-coverage.cjs 脚本一步完成接口提取、Demo 覆盖率匹配和 Markdown 报告生成。当需要对 RN 鸿蒙三方库的 Demo 进行接口覆盖率分析时调用。
license: Apache-2.0
compatibility: 需要 Node.js 运行环境
metadata:
  author: rnoh-team
  version: "1.0.0"
  category: rn-testing
  language: JavaScript/TypeScript
  useWhen: 分析 RN 鸿蒙三方库 Demo 对接口的覆盖情况
  consumed-by: rnohLibTestAlignSkill
---

# RN 鸿蒙三方库 Demo 接口覆盖率分析

通过 `rn-analyze-demo-coverage.cjs` 脚本一步完成接口提取、Demo 覆盖率匹配和 Markdown 报告生成，无需中间文件。

> ⚠️ **核心约束**：基于静态 import 和接口调用分析，动态调用（`obj[methodName]()`）无法识别。

---

## 脚本依赖

本 Skill 直接调用以下本地脚本完成全部分析工作：

```
3rdLibraryLoop/MCP/scripts/rn-analyze-demo-coverage.cjs
```

**调用方式**：通过 `node` 命令行直接执行，使用 `--` 参数传参。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libroot` | string | ✅* | 库根目录路径（RN 三方库的鸿蒙化仓库目录，包含 `package.json`） |
| `spec` | string | ✅* | 已有的 interface-spec.json 路径（与 `libroot` 二选一） |
| `output` | string | ❌ | 输出 Markdown 报告路径，默认 `02-{库名}-Demo覆盖率报告.md` |
| `title` | string | ❌ | 报告标题 |
| `mode` | string | ❌ | 匹配模式: `auto`(默认) \| `ast` \| `regex` |
| `version` | string | ❌ | 上游 npm 版本号（如 `2.2.0`），未指定时自动从 dependencies/README 推断 |
| `src` | string | ❌ | Demo 源码目录覆盖，默认自动检测 |

> `libroot` 与 `spec` 至少提供一个。提供 `spec` 时跳过接口提取步骤直接使用；仅提供 `libroot` 时脚本自动从源码提取接口（必要时拉取上游 npm 源码）。

**派生变量**：
- `skillDir`：本 Skill 所在目录
- `scriptPath`：分析脚本路径 = `{{skillDir}}/../../../MCP/scripts/rn-analyze-demo-coverage.cjs`

---

## 执行命令

```bash
node "{{skillDir}}/../../../MCP/scripts/rn-analyze-demo-coverage.cjs" \
  --libroot "{{libroot}}" \
  [--output "{{output}}"] [--title "{{title}}"] [--mode auto|ast|regex] [--version "{{上游版本}}"]
```

或从已有 interface-spec.json 生成：

```bash
node "{{skillDir}}/../../../MCP/scripts/rn-analyze-demo-coverage.cjs" \
  --spec "{{spec}}" --libroot "{{libroot}}" [--output "{{output}}"]
```

其中：
- `{{skillDir}}` = SKILL.md 所在目录（脚本位于其向上三级的 `MCP/scripts/`）
- `{{libroot}}` = RN 三方库的鸿蒙化仓库根目录

---

## 脚本自动完成

1. 获取接口规格（从 `--spec` 指定的 JSON 读取，或从 `libroot` 源码自动提取，必要时拉取上游 npm 源码 `index.js`/`index.d.ts` 及本地 TurboModule Spec `Native*.ts`）
2. 自动检测 Demo 源码目录（按优先级查找）：
   - `example/src`、`demo/src`、`examples/src`
   - `example`、`demo`
3. 递归扫描 Demo 源码目录下所有 `.ts`、`.tsx`、`.js`、`.jsx` 文件（排除 `node_modules`、`harmony`、`android`、`ios`、`__tests__`、`__mocks__`、`tests`、`test`）
4. 提取 `import { ... } from 'lib'` 语句（ES Module 默认/命名/别名/混合导入、CommonJS require、side-effect import）
5. AST/正则双层匹配：静态方法、实例方法（追踪变量声明与类型）、链式调用、对象字面量属性、默认导入命名空间宽松兜底
6. 直接渲染输出 Markdown 覆盖率报告

---

## 库源码目录结构约定

```
{{libroot}}/
  ├── package.json                     ← 库 package.json（依赖中含上游 npm 包名）
  ├── src/                             ← JS 层导出源码
  ├── harmony/                         ← 鸿蒙化原生代码（ArkTS/C++，扫描时排除）
  └── example/
      ├── src/                         ← Demo 源码（自动检测目录之一）
      └── ...
```

> 脚本自动检测 Demo 目录，无需手动指定 `--src`；如自动检测失败或多目录共存，可用 `--src` 显式指定。

---

## 输入依赖

- **前置SKILL**: rnoh-lib-code-adapt（可选；Demo 源码通常来自鸿蒙化仓库的 example 目录）
- **输入文件**: 库源码目录（含 `package.json` 和 Demo 源码目录）
- **输出文件**: Markdown 覆盖率报告（脚本直接生成）

---

## 输出

生成 Markdown 报告，包含以下章节：
- **基本信息**：库名、源文件数、生成时间
- **覆盖率总览**：方法级覆盖率百分比、S/N/M 统计、进度条
- **按接口类型统计**：method/constructor/property/field/enumValue/function/variable/type 分类别覆盖率
- **类级覆盖率**：按类分组的覆盖明细（按覆盖率升序排列）
- **未覆盖接口详情**：按类分组的未覆盖接口清单（含参数、返回类型、说明）
- **已覆盖接口详情**：按类分组的已覆盖接口清单（含签名和覆盖来源文件）
- **文件覆盖详情**：每个 Demo 文件覆盖的接口数和接口列表
- **覆盖率提升建议**：按优先级排列的未覆盖接口补充清单

> 当未找到 Demo 源文件时，报告会标注「无 Demo 文档声明」并列出所有接口为未覆盖。

---

## 注意事项

1. **确定性**：所有计数和匹配由脚本完成，同一组输入必定产生相同输出
2. **子目录排除**：自动排除 `node_modules`、`harmony`、`android`、`ios`、`__tests__`、`__mocks__`、`tests`、`test` 等目录
3. **构造函数和枚举**：已在接口提取阶段排除
4. **动态调用限制**：`obj[methodName]()` 无法识别
5. **模式选择**：`auto` 优先 AST 匹配（需 TypeScript 模块），失败时降级正则；`ast` 强制 AST；`regex` 强制正则
6. **版本推断**：未传 `--version` 时，脚本从 `package.json` 的 `dependencies` 或 README 自动推断上游 npm 版本号
