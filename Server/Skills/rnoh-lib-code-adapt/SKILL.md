---
name: rnoh-lib-code-adapt
description: >-
  RN 鸿蒙三方库升级适配：代码适配与编译验证。当用户已通过 rnoh-lib-version-up
  获取差异文档和版本分析报告，需要分析 diff、判断鸿蒙侧影响范围、修改 RN 框架
  版本依赖、进行代码适配修改、迭代修复编译错误直到编译通过时使用。典型场景：
  用户拿到 diff patch 文件和变更摘要，需要决定哪些文件要改、怎么改；或用户直接
  说"帮我把这个三方库从 0.77 升级到 0.84"；或编译报错需要修复。也适用于：
  单独分析 diff patch 判断鸿蒙侧影响范围、TurboModule/Fabric codegen 产物适配、
  ArkTS/C++ 原生层接口适配、利用 devecocli 进行语法检查与编译验证。
compatibility: 需要 git、node、npm；DevEco Studio >= 6.0.0 或 Command Line Tools >= 26.0.0；推荐安装 devecocli (npm install -g @deveco/deveco-cli@latest)
allowed-tools: Bash Read Grep Glob Edit Write
metadata:
  author: rnoh-team
  version: "2.0"
  phase: "2-of-4"
---

# RN 鸿蒙三方库代码适配与编译验证

本 skill 是三方库升级适配流程的第二阶段（共四阶段），也是最核心的阶段。从差异文档出发，分析变更对鸿蒙化代码的影响，完成版本依赖升级和代码适配修改，迭代修复编译错误，最终确保基本编译通过。

## 路径约定

`{SKILL_DIR}` = 本技能根目录（本 SKILL.md 所在目录）。命令均在 `{SKILL_DIR}` 下执行，使用 `scripts/...`、`references/...` 相对路径。详见 [Agent Skills 规范](https://agentskills.io/specification) 中的 file references 约定。

## 何时使用

- 用户已通过 rnoh-lib-version-up 获取了 diff patch 和版本分析报告，需要分析并执行适配。
- 用户直接要求把某个三方库从旧版本升级到新版本（如"从 0.77 升到 0.84"）。
- 用户在升级过程中遇到编译错误，需要帮助分析和修复。
- 用户需要分析一个 diff patch 对鸿蒙化代码的影响范围。
- 用户需要修改 RN/RNOH 框架版本依赖。

## 最小必要输入

- **必要**：差异 patch 文件路径，或上游两个版本的源码目录路径
- **必要**：本地鸿蒙化工程目录路径
- **必要**：目标 RNOH 版本号（如 `0.84`）
- **有帮助**：版本分析报告（来自 rnoh-lib-version-up）
- **有帮助**：已知的不兼容变更列表

如果用户没有 diff patch，但提供了鸿蒙化仓库 URL 和版本号，先引导使用 rnoh-lib-version-up 生成差异文档。

## devecocli 工具优先级

**本 skill 在脚本和编译验证中优先使用 `devecocli`（DevEco CLI）替代手动操作。** `devecocli` 封装了 ohpm、hvigor、hdc、hilog 等工具链，提供统一的命令行入口。

**安装**（如未安装）：
```bash
npm install -g @deveco/deveco-cli@latest
```

**环境变量**（非默认安装路径时需设置）：
```bash
export DEVECO_CLI_STUDIO_PATH="/Applications/DevEco-Studio.app"  # macOS
# 或
export DEVECO_CLI_CLT_PATH=/opt/command-line-tools               # Linux/自定义路径
```

**devecocli 可替代的手动操作一览**（详见 [references/deveco-cli-tools.md](references/deveco-cli-tools.md)）：

| 手动操作 | devecocli 替代 | 说明 |
|----------|---------------|------|
| 全量编译验证语法 | `devecocli check`（MCP）或 `devecocli check lint` | 单文件快速语法检查，无需全量编译 |
| 手动记忆 ArkTS 规则 | `devecocli check lint [path]` | 自动检查代码规范并输出报告 |
| grep 查找代码引用 | MCP `references`/`workspaceSymbol` | 语义级符号查找，比 grep 精确 |
| 手动签名配置 | `devecocli signature generate` | 自动生成调试签名材料并写入 build-profile.json5 |
| 手动 hdc 安装运行 | `devecocli run` | 一键构建 + 安装 + 启动 |
| 手动 hilog | `devecocli log --level E --bundle-name <name>` | 按级别/包名过滤日志 |
| 手动 SDK 兼容检查 | `devecocli check compat` | 扫描两个 SDK 版本间的 API 变更 |
| 全量 hvigorw 编译 | `devecocli build` | 自动解析模块依赖，替代 hvigorw |

> ⚠️ **devecocli 不可用时的回退**：如果 `devecocli` 未安装或不可用，回退到直接使用 `hvigorw`、`ohpm`、`hdc` 等工具。路径见 [references/common-compile-errors.md](references/common-compile-errors.md) 中的工具路径部分。

## 库类型判定

适配流程根据库类型分支，**开始前必须判定**：

| 类型 | 判定条件 | 流程差异 |
|------|---------|---------|
| `native-harmony` | 有 `harmony/` HAR + TurboModule/Fabric/cpp | 完整流程（JS → codegen → harmony → autolinking → 编译验证） |
| `js-only-harmony` | 有 `harmony/` 但无 cpp/autolinking | 跳过 C++/HAR 门禁 |
| `pure-js` | 无 native 或纯 JS 鸿蒙实现 | 跳过 codegen、autolinking、HAR、鸿蒙设备运行 |

## 进度清单

```
- [ ] Step 1: 分析 diff，分类变更
- [ ] Step 2: 修改 RN 框架版本依赖
- [ ] Step 3: 代码适配修改（JS → Spec → codegen → harmony）
- [ ] Step 4: 编译验证（渐进式，迭代修复）
- [ ] Step 5: 生成适配变更清单
```

---

## Step 1：分析 diff，分类变更

读取 diff patch 文件和变更摘要，将所有变更按以下维度分类。

### 变更类型分类

| 类型 | 说明 | 鸿蒙侧影响 | 适配优先级 |
|------|------|-----------|-----------|
| **JS 层变更** | `.js`/`.ts`/`.tsx` 文件修改 | 鸿蒙化工程不含 JS 代码，通过 package.json 依赖源库，仅需更新依赖版本 | 无 |
| **原生层变更** | `.cpp`/`.h`/`.java`/`.kt` 文件 | 需检查 harmony/ 下 C++/ArkTS 代码是否需对应修改 | 高 |
| **API 签名变更** | TurboModule spec 文件（`*Native*.ts`）接口变更 | 需重新 codegen，更新 C++ 和 ArkTS 适配层 | 最高 |
| **新增导出** | 新增组件、模块或 API | 需在鸿蒙侧新增对应 Package/Component 注册 | 高 |
| **配置变更** | `package.json`/`tsconfig.json` 等配置文件 | 需同步配置，更新依赖版本 | 中 |
| **文档变更** | README/CHANGELOG 等 | 无影响，可忽略 | 无 |

### 分析方法

1. 读取 `summary_<b1>_<b2>.md`，获取变更文件列表和增删行数统计
2. 逐文件读取 diff patch 中的变更内容
3. 对每个变更文件，判断属于上述哪种类型
4. 重点关注文件模式：
   - `src/Native*.ts` — TurboModule spec，接口定义变更
   - `android/src/main/java/` — Android 原生实现（可作为鸿蒙适配参考）
   - `ios/` — iOS 原生实现（可作为鸿蒙适配参考）
   - `package.json` — 依赖和配置变更

5. 生成变更分类清单：

```markdown
## 变更分类清单

### 🔴 需要鸿蒙侧适配的变更
1. [API签名变更] NativeXxxModule.ts — 新增 `getXxx()` 方法
   - 影响: 需在 harmony/ 下新增对应 TurboModule 实现
2. [原生层变更] xxx组件新增 `propY` 属性
   - 影响: 需在 ArkTS ComponentInstance 中新增属性处理

### 🟡 仅需更新依赖版本的变更
1. [JS层变更] src/xxx.ts — 逻辑修改，更新 package.json 中源库版本即可

### ⚪ 可忽略的变更
1. [文档变更] README.md
```

### 鸿蒙侧影响判断规则

参考 [references/adapt-checklist.md](references/adapt-checklist.md) 中的判断矩阵。核心原则：

- **禁止**仅凭 Android/iOS 实现或训练记忆推断鸿蒙 API 可行性。涉及原生能力（相机、扫码、蓝牙等）时，必须使用 `harmonyos-sdk-api-lookup` 和 `harmonyos-docs-lookup` 子技能核查后再下结论。
- **禁止**在无 API 核查的情况下对需适配项给出「可实现/无法实现」结论。

---

## Step 2：修改 RN 框架版本依赖

将鸿蒙化工程的 package.json 中的 RN/RNOH 相关依赖升级到目标版本。

### 版本对照表

参考 [references/version-compat-matrix.md](references/version-compat-matrix.md) 获取完整的版本对照关系（0.72 → 0.77 → 0.82 → 0.84）。

核心依赖升级规则（0.77 / 0.82 / 0.84）：

| 依赖项 | 0.77 | 0.82 | 0.84 |
|--------|------|------|------|
| `react` | `18.3.1` | `19.1.1` | `19.2.3` |
| `react-native` | `0.77.1` | `0.82.1` | `0.84.1` |
| `@react-native-oh/react-native-harmony` | `0.77.18-1` | `0.82.30` | `0.84.2` |
| `@react-native-community/cli` | `15.0.1` | `20.0.0` | `20.1.0` |
| `@react-native/babel-preset` | `0.77.1` | `0.82.1` | `0.84.1` |

### 0.82 → 0.84 不兼容变更

除版本号升级外，还需同步处理：

| 变更项 | 0.82 | 0.84 | 影响文件 |
|--------|------|------|--------|
| **Babel preset** | `metro-react-native-babel-preset` | `@react-native/babel-preset` | `babel.config.js` |
| **@types/react-native** | 存在 | **已移除**（RN 0.84 内置） | `package.json` devDependencies |
| **CLI codegen 参数** | 无 `--generate-type` | 新增 `--generate-type all`（必选） | `package.json` codegen-lib 脚本 |

**注意**：`@react-native-oh/react-native-harmony` 使用 `npm:` 协议映射：
```json
"@react-native-oh/react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.84.2"
```

⚠️ **库特定情况**：部分旧版库通过本地 tgz 安装 RNOH 框架（`file:` 引用），升级时需改为 npm 直装并同步修改所有引用路径。判断方法：检查 `example/package.json` 中 RNOH 依赖是否使用 `file:` 引用 tgz。详见 [references/version-compat-matrix.md](references/version-compat-matrix.md)。

### 修改步骤

1. 读取鸿蒙化工程的 `package.json`
2. 按版本对照表更新所有 RN/RNOH 相关依赖
3. 运行 `npm install` 安装新依赖
4. 遇到 peer dependency 冲突时使用 `--legacy-peer-deps` 或 `--force`
5. 运行 `npm run codegen` 重新生成 TurboModule/Fabric 代码

---

## Step 3：代码适配修改

根据 Step 1 的变更分类清单，逐项执行适配修改。按层级顺序：**JS → Spec → codegen → harmony**。

### 3.1 JS 层变更适配

鸿蒙化三方库**不含 JS 代码**，JS 层由 `package.json` 依赖的源库提供。JS 层变更**无需手动适配**：

1. 在 `package.json` 中将源库依赖版本更新到目标版本
2. 运行 `npm install` 安装新版本，JS 代码自动更新
3. 运行 `npm run codegen` 重新生成 C++ 和 ArkTS 代码

### 3.2 API 签名变更适配

对于 TurboModule spec 文件变更（`*Native*.ts`），这是最高优先级工作：

1. 更新 `package.json` 中源库版本，运行 `npm install`
2. 运行 `npm run codegen` 重新生成 C++ 和 ArkTS 代码
3. 检查 codegen 产物，确认新增接口方法在 C++ 和 ArkTS 侧都有对应实现
4. 新增方法 → 在鸿蒙侧 TurboModule 实现中添加对应逻辑
5. 删除/重命名方法 → 清理鸿蒙侧旧实现

详细步骤参考 [references/adapt-checklist.md](references/adapt-checklist.md)。

### 3.3 原生层变更适配

对比上游 Android/iOS 实现和鸿蒙化工程的 harmony/ 实现：

1. 查看上游 Android 实现变更（作为鸿蒙适配参考）
2. 查看鸿蒙化工程的 `harmony/` 目录下对应的 C++/ArkTS 代码
3. 判断鸿蒙侧是否需要对应修改
4. 修改 C++ 代码时注意 NAPI 引用管理、线程安全、生命周期
5. 修改 ArkTS 代码时注意 ArkTS 编译规则约束

**ArkTS 编译规则**：详见 [references/adapt-checklist.md](references/adapt-checklist.md) 中的 ArkTS 编译规则部分。关键要点：

- `@Builder` 参数不随 @State 变化更新 → 用 `@Component` + `@Prop` 替代
- 对象字面量不能赋值给 Map → 用 `new Map()` 或类型断言
- `JSON.parse()` 返回 any → 需类型断言
- 索引签名被禁止 → 用 `Map` 或命名 interface
- 循环类型别名被禁止 → 用 `object` 替代递归引用

**修改后快速验证**：使用 `devecocli check lint <file>` 或 MCP `check` 工具对修改的 `.ets`/`.cpp` 文件进行单文件语法检查，无需等待全量编译：

```bash
# 检查单个 ArkTS 文件
devecocli check lint harmony/src/main/ets/XxxModule.ets

# 或通过 MCP 工具（需配置 deveco-mcp，见 references/deveco-cli-tools.md）
# check 工具传入文件路径列表，返回结构化诊断信息
```

### 3.4 新增导出适配

如果上游新增了组件或模块：
1. 在鸿蒙侧新增对应的 Package 类（ETS 和 C++ 各一个）
2. 在 `RNPackagesFactory.ets` 中注册新 Package
3. 在 `Index.ets` 中导出组件类型
4. 在 `PackageProvider.cpp` 中注册 C++ Package
5. 在 `CMakeLists.txt` 中添加编译目标

可使用 `auto-integrate.sh` 脚本辅助完成集成配置：
```bash
./scripts/auto-integrate.sh --npm-name <包名> [--npm-version <版本>]
```

### 3.5 鸿蒙 API 核查（硬性要求，native 库）

凡涉及原生能力（相机、扫码、蓝牙、定位、文件、权限等）的适配项，**禁止**仅凭 Android/iOS 实现或训练记忆推断 OHOS API，**必须**结合子技能完成核查后再修改代码：

| 子技能 | 用途 |
|--------|------|
| **harmonyos-sdk-api-lookup** | API 签名、Interface/Enum、权限、系统能力 |
| **harmonyos-docs-lookup** | 开发步骤、实时性/性能约束、错误码 |

> `pure-js` 库跳过本节。

---

## Step 4：编译验证

完成适配修改后，执行渐进式编译验证。

### 渐进式编译流程

```bash
# 1. 安装 JS 依赖
npm install

# 2. 重新生成 codegen 代码
npm run codegen          # 应用级 codegen（example 工程）
npm run codegen-lib      # 库级 codegen（鸿蒙化库工程，如有）

# 3. 构建 JS Bundle
cd example && npm run dev

# 4. 安装鸿蒙原生依赖（关键步骤！不可跳过）
cd example/harmony && ohpm install

# 5. 构建鸿蒙原生工程
cd example/harmony && devecocli build --product default --build-mode debug
```

**⚠️ `ohpm install` 不可跳过**：将 `oh-package.json5` 中声明的 har 包安装到 `oh_modules/`。RNOH 0.84 的 har 包中包含 C++ 源码，CMake 编译时需要从 `oh_modules/@rnoh/react-native-openharmony/src/main/cpp/` 读取。跳过会导致 `CMake Error: not an existing directory`。

**devecocli build vs hvigorw**：推荐使用 `devecocli build` 替代 `hvigorw assembleHap`。devecocli 自动解析模块依赖，对多模块工程更稳定。产物为 `entry/build/default/outputs/default/entry-default-signed.hap`。

**devecocli 不可用时回退**：
```bash
# macOS DevEco Studio 内置工具路径
HVIGORW="/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw"
OHPM="/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm"
cd example/harmony && "$HVIGORW" assembleHap --no-daemon --mode module -p product=default
```

### 编译错误修复策略

编译错误修复是迭代过程，参考 [references/common-compile-errors.md](references/common-compile-errors.md) 获取常见错误模式和修复方法。

通用修复策略：

1. **收集错误**：运行编译命令，收集所有错误信息
2. **分类错误**：按错误类型分类（类型错误、导入错误、语法错误、链接错误等）
3. **优先级排序**：先修复根因错误（如 import 路径错误会导致大量级联错误）
4. **单文件快速验证**：修改后用 `devecocli check lint <file>` 快速验证语法，无需全量编译
5. **逐个修复**：修复一个错误后重新编译，确认该错误已解决
6. **迭代**：重复直到编译通过

常见错误类型速查：

| 错误类型 | 典型表现 | 修复方向 |
|----------|---------|---------|
| 导入路径错误 | `Cannot find module 'X'` | 修正路径（根因错误，先修复） |
| ArkTS 模块解析 | `Failed to resolve OhmUrl` | 注册模块到 build-profile.json5 |
| ArkTS 编译规则 | `arkts-no-*` 系列错误 | 参考 ArkTS 编译规则修复 |
| 类型不匹配 | `Type 'X' is not assignable to type 'Y'` | 检查接口定义是否同步 |
| 缺少导出 | `Module has no exported member 'X'` | 更新源库版本并重新 codegen |
| C++ 链接错误 | `undefined reference to 'X'` | 检查 CMakeLists.txt 是否包含新源文件 |
| Codegen 产物缺失 | 找不到生成的 C++ 头文件 | 重新运行 `npm run codegen` |
| ohpm install 缺失 | `not an existing directory` (CMake) | 运行 `ohpm install` |
| SDK 版本不匹配 | `SDK component missing` | 移除 compileSdkVersion 字段 |
| RNOH 框架内部警告 | `deprecated`、`not supported` | 无需修复（WARNING，不影响编译） |

### 利用 devecocli 加速编译验证

**单文件语法检查**（修改后快速验证，无需全量编译）：
```bash
# 检查单个或多个文件
devecocli check lint harmony/src/main/ets/XxxModule.ets
devecocli check lint harmony/src/main/cpp/XxxComponent.cpp

# 自动修复可修复的问题
devecocli check lint harmony/src/main/ets/ --fix

# 仅检查 Git 未提交文件（增量检查）
devecocli check lint --incremental
```

**SDK 兼容性扫描**（升级 SDK 版本时检查 API 变更）：
```bash
# 查看可用 SDK 版本
devecocli check compat versions

# 工程级扫描
devecocli check compat --source-version "5.0.1(17)" --target-version "6.0.0(21)"

# 文件级扫描（仅 .ets/.c/.cpp）
devecocli check compat ./harmony/src/main/ets/XxxModule.ets \
  --source-version "5.0.1(17)" --target-version "6.0.0(21)"
```

**MCP 代码分析工具**（如已配置 deveco-mcp，详见 [references/deveco-cli-tools.md](references/deveco-cli-tools.md)）：

| MCP 工具 | 用途 | 适用场景 |
|---------|------|---------|
| `check` | 静态语法分析，返回诊断信息 | 修改后快速验证 |
| `references` | 查找符号全工程引用 | 重命名前评估影响范围 |
| `workspaceSymbol` | 按名称搜索全工程符号 | 定位函数/类定义 |
| `documentSymbol` | 获取单文件符号树 | 文件结构概览 |
| `callHierarchy` | 查询函数调用关系 | 修改函数签名前评估影响 |

---

## Step 5：生成适配变更清单

编译通过后，生成适配变更清单文档，记录所有修改：

```markdown
# 适配变更清单

## 版本信息
- 升级前: RNOH 0.77 / 上游 v7.2.2
- 升级后: RNOH 0.84 / 上游 v7.4.0

## 修改文件列表

| 文件 | 修改类型 | 修改内容 | 原因 |
|------|---------|---------|------|
| package.json | 依赖升级 | RN 0.77.1→0.84.1, RNOH 0.77.18-1→0.84.2 | 框架版本升级 |
| harmony/src/main/ets/XxxModule.ets | 新增实现 | 实现 getXxx() | 上游新增 API |
| harmony/src/main/cpp/XxxComponent.cpp | 修改 | 新增 propY 处理 | 上游新增组件属性 |

## 编译验证结果
- npm run codegen: ✅ 通过
- npm run dev: ✅ 通过
- devecocli build: ✅ 通过
- devecocli check lint: ✅ 无错误

## 待后续关注
- 新增 API 的功能测试（见 rnoh-lib-test-align）
- 性能回归测试
```

---

## 常见边界情况

### 1. 跨大版本升级（如 0.72 → 0.84）

跨大版本升级涉及多个版本不兼容变更累积，风险较高：
- 先查阅 [上游社区不兼容变更](https://gitcode.com/CPF-RN/ohos_react_native/blob/main/docs/zh-cn/05-运维/上游社区不兼容变更.md)
- 分阶段升级（0.72→0.77→0.82→0.84），每阶段单独验证
- **禁止**直接跳过中间版本

### 2. Codegen 产物与手写代码冲突

某些鸿蒙化工程可能手写了部分 codegen 产物。重新 codegen 后会覆盖手写代码：
- codegen 前备份 `harmony/` 目录
- codegen 后对比差异，将手写的自定义逻辑合并回去

### 3. 鸿蒙化工程尚未适配目标 RNOH 版本

如果鸿蒙化仓库没有 `br_rnoh0.84` 分支：
- 使用已有最高版本分支作为起点
- 先完成 RN/RNOH 版本依赖升级（Step 2）
- 编译错误会暴露需要适配的接口变更
- 根据编译错误逆向推导适配方案

### 4. peer dependency 冲突

RN 0.84 要求 React 19.2.3，如果三方库依赖 React 18.x，会有 peer 冲突：
- 优先尝试 `--legacy-peer-deps`
- 如果三方库实际兼容 React 19，在 package.json 中覆盖 peerDependencies
- 如果确实不兼容，需要先升级三方库的 React 依赖

### 5. compileSdkVersion 与本地 SDK 不匹配

`build-profile.json5` 中指定的 `compileSdkVersion`（如 `5.0.1(17)`）如果本地未安装对应 SDK，hvigor 会报 `SDK component missing` 错误。

**解决方案**（按优先级）：
1. **移除 `compileSdkVersion` 字段**：让 hvigor 自动使用 DevEco Studio 内置 SDK（推荐）
2. **改为本地已安装的 SDK 版本**：通过 DevEco Studio > SDK Manager 查看
3. **下载对应 SDK**：通过 DevEco Studio > SDK Manager 安装

**注意**：`build-profile.json5` 和 `build-profile.template.json5` 都需要同步修改。

### 6. RNOH 框架内部编译警告

编译时 RNOH 框架自身代码会产生大量警告（如 `vp2px has been deprecated`、`API 'on' is supported since SDK version 15`），这些是**框架内部兼容性警告，不影响编译结果**，无需修复。只需关注自己库的代码是否有错误。

### 7. Codegen 与 Autolinking 的关系

| 维度 | Codegen | Autolinking |
|------|---------|-------------|
| **作用** | 从 JS spec 生成 C++/ArkTS 类型代码 | 将已生成的 Package 注册到工程 |
| **输出** | Props.h、ShadowNodes.h、JSIBinder.h 等 | 修改 RNPackagesFactory.ets、PackageProvider.cpp |
| **可替代** | ❌ 不可省略 | ✅ 可用 `auto-integrate.sh` 脚本替代手动注册 |

RNOH **没有** iOS/Android 那样的运行时自动发现机制。所谓 "autolinking" 仅指 `auto-integrate.sh` 脚本可以自动修改注册文件，但 codegen 仍需单独运行。

### 8. 源码 `file:` 依赖的 ArkTS 模块注册

鸿蒙化三方库通过 `file:` 源码依赖引入 example 工程时，ohpm 创建**符号链接**指向源码目录，hvigor 无法识别，导致 `Path not found` 或 `Failed to resolve OhmUrl`。

**三步配合解决**：
1. **`build-profile.json5` 注册库为独立模块**：`srcPath` 用相对路径直接指向源码目录（如 `../../harmony/xxx`），不用符号链接
2. **`RNPackagesFactory.ets` 用包根路径导入**：`import { XxxPackage } from '@react-native-ohos/xxx'`（❌ 深层路径 `.../src/main/ets/XxxPackage` 运行时找不到 record）
3. **保持库的 `index.ets` + `ts.ets` 原始结构**：`ts.ets` 不能改为 `.ts`（TS 文件不能导入 ArkTS），不能删除

> 详见 [references/adapt-checklist.md](references/adapt-checklist.md) 中的完整代码示例。


## 输出物清单

完成本 skill 后，应产出以下文件供后续 skill 使用：

1. **适配变更清单**（Markdown 格式）— 记录所有修改的文件、内容、原因
2. **编译通过的本地工程** — 供 rnoh-lib-test-align 移植测试用例
3. **变更分类清单** — 供 rnoh-lib-func-test 生成测试清单
