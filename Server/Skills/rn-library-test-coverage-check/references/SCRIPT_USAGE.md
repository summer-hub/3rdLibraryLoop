# 脚本使用指南

本文档详细说明 RNLibraryTestCoverageCheckSkill 使用的三步脚本流水线的参数、行为和输出结构。

---

## 脚本概览

| 步骤 | 脚本 | 作用 | 输入 | 输出 |
|------|------|------|------|------|
| Phase 2 | `rn-extract-interfaces.cjs` | 从鸿蒙化仓库提取完整接口规格 | repoDir | interface-spec.json |
| Phase 3 | `rn-analyze-test-coverage.cjs` | 扫描测试目录，分析测试覆盖率 | spec + libroot | test-coverage-report.md |
| Phase 4 | `rn-analyze-demo-coverage.cjs` | 扫描 Demo 目录，分析 Demo 覆盖率 | spec + libroot + src | demo-coverage-report.md |

> 脚本位于 `MCP/scripts/` 共享目录（相对 SKILL 目录为 `{SKILL_DIR}/../../../MCP/scripts/`），通过 `node` 执行，本 SKILL 不维护脚本副本。三个脚本共享 `rn-extract-interfaces.cjs` 中的工具函数（loadSpec、walkDir、parseArgs 等）。

---

## 脚本 1：rn-extract-interfaces.cjs

### 功能

从 RN 三方库的鸿蒙化仓库提取接口规格：
1. 自动拉取上游 npm 源码（`npm pack` + 解压）
2. 从上游源码提取 JS 层导出（CommonJS/ES Module/Side-effect）
3. 从上游 `index.d.ts` 提取类型定义
4. 从本地鸿蒙工程提取 TurboModule Spec（`Native*.ts`）
5. 输出 JSON 接口规格文件

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--repoDir` | string | ✅ | 库根目录路径（鸿蒙化仓库目录，含 package.json） |
| `--output` | string | ❌ | 输出 JSON 路径（不指定则输出到 stdout） |
| `--version` | string | ❌ | 上游 npm 版本号（如 "2.2.0"），不传则自动推断 |

### 执行示例

```bash
node ../../../MCP/scripts/rn-extract-interfaces.cjs \
  --repoDir /path/to/outputDir/source/ohos \
  --output /path/to/outputDir/interface-spec.json \
  --version 2.2.0
```

### 输出结构（interface-spec.json）

```json
{
  "libraryName": "@react-native-ohos/xxx",
  "libraryAlias": "xxx",
  "entryFile": "upstream:xxx@2.2.0/./index.ts",
  "exportStyle": "es-module",
  "upstream": {
    "pkgName": "xxx",
    "version": "2.2.0",
    "isUpstream": true
  },
  "extractedAt": "2026-01-01T00:00:00.000Z",
  "summary": {
    "S": 3,
    "N": 15,
    "M": 0,
    "methods": 10,
    "properties": 0,
    "fields": 0
  },
  "sources": ["upstream:xxx@2.2.0/./index.ts", "..."],
  "interfaces": [
    {
      "className": "MyModule",
      "memberName": "doSomething",
      "fullName": "MyModule.doSomething",
      "kind": "method",
      "isStatic": false,
      "isReadonly": false,
      "isOptional": false,
      "isEvent": false,
      "type": "es-export",
      "layer": "js",
      "signature": "doSomething(param1: string, param2?: number): Promise<void>",
      "params": [
        {"name": "param1", "type": "string", "optional": false, "description": "-"},
        {"name": "param2", "type": "number", "optional": true, "description": "-"}
      ],
      "returnType": "Promise<void>",
      "description": "执行某操作",
      "source": "upstream:xxx@2.2.0/./index.ts",
      "startLine": 10
    }
  ]
}
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `libraryAlias` | 库别名（去掉 `@scope/` 前缀），用于 import 匹配 |
| `interfaces[].fullName` | 接口全名（`ClassName.methodName`），覆盖率匹配的主键 |
| `interfaces[].kind` | 接口类型：`method`/`function`/`property`/`field`/`variable`/`type` |
| `interfaces[].isEvent` | 是否为事件接口（`addXxxListener`/`removeXxxListener` 模式） |
| `interfaces[].layer` | 层级：`js`（JS 层）/ `turbo`（TurboModule 层） |
| `summary.S` | 类/模块总数 |
| `summary.N` | 接口总数 |
| `summary.methods` | 方法数 |

### 版本推断逻辑

脚本按以下优先级推断上游版本：
1. 用户指定 `--version`
2. `package.json` 的 `dependencies` 中匹配 `react-native-*` 的依赖
3. `README.md` 中的版本声明（`[pkg@version]` 格式）
4. 从鸿蒙化版本号推断（去掉 `-beta`/`-rc` 后缀）
5. 降级到 `npm latest`

---

## 脚本 2：rn-analyze-test-coverage.cjs

### 功能

基于接口规格，扫描测试源码目录，执行 AST/正则双层覆盖率匹配：
1. 自动检测测试目录（`__tests__`/`test`/`tests`/`example/src/test` 等）
2. AST 模式：使用 TypeScript Compiler API 语义分析（精确匹配 import、变量类型、属性访问）
3. 正则模式：降级方案，通过正则表达式匹配 import 和方法调用
4. 输出 Markdown 覆盖率报告

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--spec` | string | ✅* | interface-spec.json 路径（与 `--libroot` 二选一，优先使用 spec） |
| `--libroot` | string | ✅* | 库根目录路径（用于自动提取 spec + 收集库源码 + 检测测试目录） |
| `--src` | string | ❌ | 测试源码目录（覆盖自动检测） |
| `--output` | string | ❌ | 输出报告路径（默认 `03-{basename}-Test覆盖率报告.md`） |
| `--mode` | string | ❌ | 匹配模式：`auto`（默认，AST 优先）\| `ast` \| `regex` |
| `--version` | string | ❌ | 上游 npm 版本号（仅 `--libroot` 模式需要） |

> *`--spec` 和 `--libroot` 至少传一个。同时传时优先使用 `--spec`，`--libroot` 用于收集库源码（AST 模式需要）。

### 执行示例

```bash
node ../../../MCP/scripts/rn-analyze-test-coverage.cjs \
  --spec /path/to/outputDir/interface-spec.json \
  --libroot /path/to/outputDir/source/ohos \
  --output /path/to/outputDir/test-coverage-report.md \
  --mode auto
```

### 测试目录自动检测顺序

```
1. {libroot}/example/src/test
2. {libroot}/example/src/tests
3. {libroot}/example/__tests__
4. {libroot}/demo/__tests__
5. {libroot}/demo/src/test
6. {libroot}/demo/src/tests
7. {libroot}/__tests__
8. {libroot}/test
9. {libroot}/tests
```

### 扫描文件类型

`.ts`、`.tsx`、`.js`、`.jsx`、`.ets`

排除目录：`node_modules`、`harmony`、`android`、`ios`、`__mocks__`

### AST 匹配引擎说明

AST 模式使用 TypeScript Compiler API 进行语义级匹配：

1. **Import 解析**：识别 `import { X } from 'lib'` 和 `const { X } = require('lib')`
2. **变量类型追踪**：通过 TypeChecker 推断变量类型，匹配类实例方法调用
3. **属性访问匹配**：`instance.method()` → 检查 instance 的类型是否为库导出的类
4. **默认导出匹配**：`import Lib from 'lib'; Lib.Class.method()` 模式
5. **对象字面量匹配**：检查属性名是否匹配接口的 property/field

### 正则匹配引擎说明

正则模式作为 AST 不可用时的降级方案：

1. **Import 正则**：匹配 `import`/`require` 语句中的库名和导入符号
2. **变量追踪正则**：匹配 `const x = new Class()` 和 `const x: Class` 声明
3. **方法调用正则**：匹配 `variable.method()` 和 `Class.method()` 模式
4. **属性访问正则**：匹配 `variable.property` 和对象字面量属性

---

## 脚本 3：rn-analyze-demo-coverage.cjs

### 功能

基于接口规格，扫描 Demo 源码目录，执行 AST/正则双层覆盖率匹配。逻辑与测试覆盖率脚本相同，区别在于扫描目录和排除规则。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--spec` | string | ✅* | interface-spec.json 路径 |
| `--libroot` | string | ✅* | 库根目录路径 |
| `--src` | string | ❌ | Demo 源码目录（覆盖自动检测，**情况 A 必传**） |
| `--output` | string | ❌ | 输出报告路径（默认 `02-{basename}-Demo覆盖率报告.md`） |
| `--mode` | string | ❌ | 匹配模式：`auto`（默认）\| `ast` \| `regex` |
| `--version` | string | ❌ | 上游 npm 版本号 |

### 执行示例

**情况 A（demo 在 RNTDEMO 目录）**：

```bash
node ../../../MCP/scripts/rn-analyze-demo-coverage.cjs \
  --spec /path/to/outputDir/interface-spec.json \
  --libroot /path/to/outputDir/source/ohos \
  --src /path/to/outputDir/source/RNTDEMO/{projectPath}/{demoPath} \
  --output /path/to/outputDir/demo-coverage-report.md \
  --mode auto
```

**情况 B（demo 在仓库内，自动检测）**：

```bash
node ../../../MCP/scripts/rn-analyze-demo-coverage.cjs \
  --spec /path/to/outputDir/interface-spec.json \
  --libroot /path/to/outputDir/source/ohos \
  --output /path/to/outputDir/demo-coverage-report.md \
  --mode auto
```

### Demo 目录自动检测顺序

```
1. {libroot}/example/src
2. {libroot}/demo/src
3. {libroot}/examples/src
4. {libroot}/example
5. {libroot}/demo
```

### 扫描文件类型

`.ts`、`.tsx`、`.js`、`.jsx`

排除目录：`node_modules`、`harmony`、`android`、`ios`、`__tests__`、`__mocks__`、`tests`、`test`

> Demo 脚本排除了 test 相关目录，确保 demo 代码和测试代码不混叠。

---

## 覆盖率报告输出结构（通用）

三个脚本中，覆盖率分析脚本（test/demo）输出的 Markdown 报告结构一致：

### 报告章节

| 章节 | 内容 |
|------|------|
| 基本信息 | 库名、源文件数、生成时间 |
| 覆盖率总览 | 方法级覆盖率（百分比 + 进度条）、S/N/M 统计 |
| 按接口类型统计 | method/function/property/field/variable/type 分类覆盖率 |
| 类级覆盖率 | 按类的覆盖率统计表 |
| 未覆盖接口详情 | 分组列出未覆盖接口（className/memberName/kind/params/returnType） |
| 已覆盖接口详情 | 分组列出已覆盖接口（含覆盖文件列表） |
| 文件覆盖详情 | 按文件列出覆盖的接口数和接口名 |
| 覆盖率提升建议 | 按优先级列出建议补充测试的接口 |

### 关键数据提取

AI 从报告中提取以下数据用于评分：

| 数据 | 提取方式 | 用途 |
|------|----------|------|
| 方法级覆盖率 | 报告"覆盖率总览"章节的百分比 | 归零规则判定、覆盖率维度评分 |
| 已覆盖接口列表 | 报告"已覆盖接口详情"章节的 `fullName` | 覆盖度明细表 |
| 未覆盖接口列表 | 报告"未覆盖接口详情"章节的 `fullName` + `kind` + `isEvent` | RTC-01~06 扣分 |
| 源文件数 | 报告"基本信息"章节 | 归零规则 3 判定 |
| 类级覆盖率 | 报告"类级覆盖率"章节 | 维度子评分计算 |

### 综合覆盖率计算

```
综合接口覆盖率 = max(test覆盖率, demo覆盖率)
```

- 两个来源**任一达到 100%** 即视为接口覆盖率满足要求（不触发归零规则 6）
- 两个来源**均未达到 100%** 时触发归零规则 6

### 已覆盖/未覆盖接口合并逻辑

```
已覆盖接口 = test已覆盖 ∪ demo已覆盖
未覆盖接口 = test未覆盖 ∩ demo未覆盖
```

即：一个接口只要在 test 或 demo 任一来源中被覆盖，就算已覆盖。只有两个来源都未覆盖时，才算未覆盖。

---

## 脚本依赖关系

```
rn-extract-interfaces.cjs (核心模块)
  ├── 导出: generateRNSpec, loadSpec, walkDir, parseArgs, ...
  ├── 被 rn-analyze-test-coverage.cjs require()
  └── 被 rn-analyze-demo-coverage.cjs require()
```

> `rn-analyze-test-coverage.cjs` 和 `rn-analyze-demo-coverage.cjs` 通过 `require('./rn-extract-interfaces.cjs')` 加载共享工具函数。三个脚本必须放在同一目录下。

---

## 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `TypeScript 模块不可用` | node_modules 中无 typescript | 在 SKILL 目录（`RNLibraryTestCoverageCheckSkill/`）执行 `npm install` 安装依赖后重新运行；若仍失败则脚本自动降级正则模式（正则模式存在假阳性，覆盖率可能虚高） |
| `npm pack 失败` | 网络问题或包名错误 | 脚本自动降级到 latest；若仍失败需检查网络 |
| `覆盖率 0%` | 测试/demo 目录不存在或无匹配文件 | 检查 `--src` 参数路径是否正确 |
| `接口数为 0` | 入口文件未正确检测 | 检查 `package.json` 的 `main`/`source` 字段 |
| AST 模式报错 | 源码语法错误或 TS 版本不兼容 | 脚本自动降级正则模式 |
| AST 与正则覆盖率差异大 | 正则模式假阳性（同名方法误匹配） | 确保 `npm install` 已执行，使用 AST 模式获取精确结果 |
