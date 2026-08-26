---
name: arkts-library-xts-coverage
description: 分析鸿蒙ArkTs原生库现有 XTS 测试用例对接口的覆盖情况。通过 analyze-xts-coverage.cjs 脚本一步完成接口提取、覆盖率匹配和 Markdown 报告生成。当需要对鸿蒙ArkTs原生库的 XTS 测试用例进行接口覆盖率分析时调用。
license: Apache-2.0
compatibility: 需要Node.js运行环境
metadata:
  version: "1.0.0"
  category: ohos-testing
  language: ArkTS/ETS
---

# 鸿蒙ArkTs原生库 XTS 接口覆盖率分析

通过 `analyze-xts-coverage.cjs` 脚本一步完成接口提取、XTS 覆盖率匹配和 Markdown 报告生成，无需中间文件。

> ⚠️ **核心约束**：基于静态 import 和接口调用分析，动态调用（`obj[methodName]()`）无法识别。

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libroot` | string | ✅* | 库源码根目录路径（含 `library/` 和 `entry/src/ohosTest/`） |
| `spec` | string | ✅* | 已有的 interface-spec.json 路径（与 `libroot` 二选一） |
| `output` | string | ❌ | 输出 Markdown 报告路径，默认 `03-{库名}-XTS覆盖率报告.md` |
| `title` | string | ❌ | 报告标题 |
| `mode` | string | ❌ | 匹配模式: `auto`(默认) \| `ast` \| `regex` |
| `lib` | string | ❌ | 库名覆盖，默认从 spec 或源码中读取 |

> `libroot` 与 `spec` 至少提供一个。提供 `spec` 时跳过接口提取步骤直接使用；仅提供 `libroot` 时脚本自动从源码提取接口。

---

## 执行命令

```bash
node "{{workspaceRoot}}/MCP/scripts/analyze-xts-coverage.cjs" --libroot "{{libroot}}" [--output "{{output}}"] [--title "{{title}}"] [--mode auto|ast|regex] [--lib "{{库名}}"]
```

或从已有 interface-spec.json 生成：

```bash
node "{{workspaceRoot}}/MCP/scripts/analyze-xts-coverage.cjs" --spec "{{spec}}" --libroot "{{libroot}}" [--output "{{output}}"]
```

其中 `{{workspaceRoot}}` = `3rdLibraryLoop` 工作区根目录。

---

## 脚本自动完成

1. 从 `library/` 源码提取接口规格（或读取 `--spec` 指定的 JSON）
2. 递归扫描 `entry/src/ohosTest/` 下所有 `.ets` 和 `.ts` 测试文件
3. 提取 `import { ... } from 'lib'` 语句（单行/多行/别名/混合导入）
4. AST/正则双层匹配：静态方法、实例方法（追踪变量声明）、链式调用、对象字面量属性
5. 直接渲染输出 Markdown 覆盖率报告

---

## 库源码目录结构约定

```
{{libroot}}/
  ├── library/                           ← 库源码（Index.ets 入口）
  │   ├── Index.ets
  │   ├── src/main/ets/
  │   └── src/main/cpp/types/.../Index.d.ts   ← Native .so 声明
  └── entry/src/ohosTest/                ← XTS 测试源码（被分析的目录）
```

---

## 输出

生成 Markdown 报告，包含以下章节：
- **基本信息**：库名、源文件数、生成时间
- **覆盖率总览**：方法级覆盖率百分比、S/N/M 统计、进度条
- **按接口类型统计**：method/property/field/function/variable 分类别覆盖率
- **类级覆盖率**：按类分组的覆盖明细
- **未覆盖接口详情**：按类分组的未覆盖接口清单
- **已覆盖接口详情**：按类分组的已覆盖接口清单（含覆盖来源文件）
- **文件覆盖详情**：每个 XTS 测试文件覆盖的接口数和接口列表

---

## 注意事项

1. **确定性**：所有计数和匹配由脚本完成，同一组输入必定产生相同输出
2. **子目录排除**：自动排除扫描目录第一层的 `entryability/`、`model/`、`util/` 等子目录
3. **构造函数和枚举**：已在接口提取阶段排除
4. **动态调用限制**：`obj[methodName]()` 无法识别
5. **模式选择**：`auto` 优先 AST 匹配（需 TypeScript 模块），失败时降级正则；`ast` 强制 AST；`regex` 强制正则
