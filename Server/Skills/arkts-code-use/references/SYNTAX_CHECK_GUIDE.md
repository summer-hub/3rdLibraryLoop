# 语法验证指南（deveco-cli）

> 生成的 ArkTS 代码必须通过编译验证（`BUILD SUCCESSFUL`）才可交付。本文档说明验证机制、工具用法与错误修复。

---

## 一、核心机制：构建图可达性

hvigor 编译器只编译**构建图可达**的 .ets 文件：

```
entry/src/main/ets/pages/Index.ets（页面，注册于 main_pages.json）
    └── import → 组件/工具类
            └── import → 更深层模块
```

- 被页面/入口 import 链引用的文件 → 参与编译，语法/约束错误全部暴露
- **未被引用的孤立 .ets 文件 → 完全不编译，错误不会暴露**

因此验证前必须确保新代码已接入构建图。两种方式：

| 方式 | 操作 | 适用 |
|------|------|------|
| 工程内接线 | 新页面注册 `main_pages.json`；新类被页面/`index.ets` import | 有目标工程 |
| 自动接线 | `verify-arkts.cjs` 脚本在临时工程入口页生成 side-effect import（`import '../verify/Xxx';`） | 独立代码验证 |

> side-effect import（无绑定导入）足以让目标文件参与编译并暴露全部错误，无需知道文件内导出符号名。

---

## 二、工程模式验证

```bash
# 在目标工程根目录执行
devecocli build

# 指定模块/产物
devecocli build --modules entry
devecocli build --product default --build-mode debug

# 清理后构建（怀疑缓存问题时）
devecocli build clean && devecocli build
```

**前置检查**：新代码已按 Phase 3.5 接线（页面注册 / import 可达），否则构建通过不代表语法正确。

**结果判定**：只认 `BUILD SUCCESSFUL`；`ERROR` 必须清零，`WARNING` 记录但不阻断。

---

## 三、独立模式验证（verify-arkts.cjs）

无目标工程时，使用本SKILL自带脚本自动完成"脚手架 → 接线 → 编译 → 回显错误"：

```bash
node {本SKILL目录}/scripts/verify-arkts.cjs --files <文件1.ets> [文件2.ets ...] [选项]
```

| 选项 | 说明 |
|------|------|
| `--files <f.ets>...` | 待验证的 .ets 文件（至少 1 个；多文件间相对导入按原目录结构保留） |
| `--work-dir <目录>` | 临时工程所在目录（默认系统临时目录，验证后删除；指定后工程保留可复用加速下次验证） |
| `--keep` | 保留临时工程（默认自动删除） |
| `--api-level <n>` | 指定脚手架 API Level（默认用 devecocli 默认值） |
| `--timeout <ms>` | 构建超时（默认 600000） |

**MCP Gateway 调用**（JSON 参数）：

```json
{ "files": ["/abs/path/Foo.ets", "/abs/path/Bar.ets"], "workDir": "/tmp/arkts-verify", "keep": false }
```

**退出码**：`0` 验证通过；`1` 存在编译错误（输出结构化错误列表）；`2` 环境/参数错误。

**输出示例（失败）**：

```
=== ArkTS 编译验证失败（3 个错误） ===
  [arkts-no-any-unknown]        /abs/path/Foo.ets:2:17
    Use explicit types instead of "any", "unknown"
  ...
```

**注意**：
- 引用了工程专属资源（`$r('app.string.xxx')`、rawfile、自定义 so 库）的代码无法在临时工程验证，须用工程模式
- 首次运行需脚手架（约 10-60s）；指定 `--work-dir` 复用可加速
- 需要本机已安装 DevEco Studio + SDK + devecocli 可用

---

## 四、错误输出解析

`devecocli build` 的 ArkTS 编译错误格式（用于定位）：

```
N ERROR: 10605008 ArkTS Compiler Error
Error Message: <人读信息> (arkts-规则名) At File: <绝对路径>:<行>:<列>
```

解析要点：
- 规则名在**圆括号**内，如 `(arkts-no-any-unknown)`
- 位置为 `文件:行:列`，列指向违规 token 起点
- 同一文件多个错误一次全部修复再重跑，避免逐个循环

---

## 五、错误修复速查表

| 错误关键词 / 规则 | 修复方案 |
|-----------------|---------|
| `arkts-no-any-unknown` | `any`/`unknown` → 具体类型或泛型 `T`；`as any` → `as 具体类型` |
| `arkts-no-esobj` | `ESObject`/`Object` → `interface` 或具体类型 |
| `arkts-no-untyped-obj-literals` | `let o = {...}` → 先声明 `interface`/`class`，再 `const o: T = {...}` |
| `arkts-no-obj-literals-as-types` | 匿名对象类型参数 → 命名 `interface` |
| `arkts-limited-throw` | `throw e` → `throw e instanceof Error ? e : new Error(String(e))` |
| `arkts-no-dynamic-property` | `obj['key']` → `obj.key` |
| `arkts-no-structural-typing` | 鸭子类型赋值 → 显式 `implements` / `extends` |
| `arkts-no-unsafe-cast` | `as unknown as T` → 修正类型定义，单次断言 |
| `arkts-no-delete` | `delete obj.x` → `obj.x = undefined` 或重构结构 |
| `arkts-no-for-in` | `for...in` → `Object.keys()` + `for...of` |
| `arkts-no-prototype-assignment` | 原型扩展 → 类继承/组合 |
| `arkts-no-arguments` | `arguments` → `...args: T[]` |
| `Cannot find module 'xxx'` | import 路径拼写/大小写；相对层级；`@ohos.*` 模块名以文档为准 |
| `xxx has been deprecated` | 查官方文档替代 API，禁止保留 |
| `Page 'xxx' does not exist` | `main_pages.json` 与实际页面文件对齐 |
| `Permission denied` / 权限类 | `module.json5` `requestPermissions` 声明（对照 Phase 2 查证表） |
| `undefined property` / 资源类 | `$r` 资源需存在于 `resources/base/element`；rawfile 走 resourceManager |
| 装饰器报错 | `@Component` struct 不能继承；`@Concurrent` 函数不能捕获外部变量 |
| ArkUI 状态更新不生效 | build() 内禁止修改状态变量；修改放事件回调 |

---

## 六、辅助检查（可选补充）

### 6.1 Code Linter（代码风格/安全规则）

```bash
devecocli check lint <文件或目录> [--fix] [--format json]
```

- 检查 TS/ArkTS 风格问题（`@performance/recommended`、`@typescript-eslint/recommended`、`@security/*`）
- 依赖工程上下文（`build-profile.json5`），且部分环境需工程完成同步后才识别文件（`Files checked: 0` 说明未识别到目标）
- **lint 通过 ≠ 语法正确**，仅作为风格/安全补充；最终以 `devecocli build` 为准

### 6.2 版本兼容检查

```bash
devecocli check compat versions                        # 列出可用 SDK 版本
devecocli check compat --source-version "<V1>" --target-version "<V2>"
devecocli check compat --source-version "<V1>" --target-version "<V2>" <文件...>
```

检查代码使用的 API 在目标 SDK 版本是否存在/已变更，适合交付前核对 API Level 兼容性。

> zsh 下版本号含括号，务必加引号；先用 `compat versions` 复制真实版本串。

---

## 七、验证纪律

1. **一次性修复**：收集全部 ERROR 后统一修复，再重新构建
2. **修复循环上限 5 轮**：超过后停止，向用户报告错误清单与已尝试方案
3. **禁止降低验证标准**：不允许通过注释掉代码、放宽 lint 配置等方式"绕过"错误
4. **速查表未覆盖的错误**：用 `script_deveco_docs` 查证涉事 API 的正确用法，或查阅 [ArkTS 规范与约束](ARKTS_RULES.md) 对应条目
