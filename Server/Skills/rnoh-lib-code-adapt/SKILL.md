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
compatibility: 需要 git、node、npm；DevEco Studio >= 6.0.0 或 Command Line Tools >= 26.0.0；推荐安装 devecocli (npm install -g @deveco/deveco-cli@latest) 和 rnoh-build-har (npm install -g rnoh-build-har)
allowed-tools: Bash Read Grep Glob Edit Write
metadata:
  author: rnoh-team
  version: "2.1.0"
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

**本 skill 在脚本和编译验证中优先使用 `devecocli`（DevEco CLI）替代手动操作。** `devecocli` 封装了 ohpm、hvigor、hdc、hilog 等工具链，提供统一的命令行入口。HAR 打包使用 `rnoh-build-har` 工具。

**安装**（如未安装）：
```bash
npm install -g @deveco/deveco-cli@latest
npm install -g rnoh-build-har
```

| 手动操作 | 工具替代 | 说明 |
|----------|---------|------|
| 全量编译验证语法 | `devecocli check lint` | 单文件快速语法检查 |
| grep 查找代码引用 | MCP `references`/`workspaceSymbol` | 语义级符号查找 |
| 手动 hdc 安装运行 | `devecocli run` | 一键构建 + 安装 + 启动 |
| 手动 SDK 兼容检查 | `devecocli check compat` | 扫描两个 SDK 版本间的 API 变更 |
| 全量 hvigorw 编译 | `devecocli build` | 自动解析模块依赖 |
| 手动创建壳工程打 HAR | `rnoh-build-har` | 自动创建临时工程 → 构建 → 拷贝 HAR → 清理 |

> ⚠️ 工具不可用时的回退方案详见 [references/deveco-cli-tools.md](references/deveco-cli-tools.md) 和 [references/har-tgz-build.md](references/har-tgz-build.md)。

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
- [ ] Step 4: 编译验证（语法检查 → 打 HAR → 打 TGZ → 依赖 tgz → 编译）
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

完成适配修改后，执行**打包 + 编译验证**流程。

### 流程总览

```text
4a. 单文件语法检查（devecocli check lint）
4b. 打 HAR 包（rnoh-build-har）→ harmony/<module>.har
4c. 打 TGZ 包（npm pack）→ <name>-<version>.tgz
4d. RN 工程依赖本地 TGZ 包（file:../xxx.tgz）
4e. 最终编译验证（依赖 tgz 包构建 example）
```

> ⚠️ **核心原则**：必须先打 HAR 再打 TGZ；最终验证一定依赖 TGZ 包（不能依赖源码 `file:` 目录引用，也不能跳过打包直接编译）；TGZ 包是最终交付物。

### 4a. 单文件语法检查

```bash
devecocli check lint harmony/src/main/ets/XxxModule.ets
devecocli check lint harmony/src/main/cpp/XxxComponent.cpp
devecocli check lint harmony/src/main/ets/  # 批量检查
```

确认无 ERROR 后进入 4b。

### 4b. 打 HAR 包

使用 `rnoh-build-har` 工具自动构建鸿蒙 HAR 模块（自动创建临时壳工程 → 构建 → 拷贝 HAR → 清理）。

```bash
rnoh-build-har [api-version] [rnoh-version] [path] [--build-mode <mode>]
# 示例: rnoh-build-har 17 0.84.2 .
# 产出: harmony/<module>.har
```

### 4c. 打 TGZ 包

> ⚠️ **npm pack 前必须清理 rnoh-build-har 临时文件**：`rnoh-build-har` 会在 `harmony/` 下产生 `oh_modules`（可达 913MB）、`AppScope`、`build-profile.json5` 等临时工程文件。即使 `.npmignore` 已排除，`npm pack` 仍需遍历整个目录树导致超时（>120s）。

```bash
cd /path/to/react-native-xxx

# 清理 rnoh-build-har 产生的临时文件（避免 oh_modules 913MB 导致 npm pack 超时）
rm -rf harmony/oh_modules harmony/AppScope harmony/build-profile.json5 harmony/hvigor harmony/oh-package.json5 harmony/<module>/build

npm pack                        # 产出: <name>-<version>.tgz
npm pack --dry-run | grep '\.har'  # 验证 tgz 包含 HAR
```

> ⚠️ 务必验证 tgz 包含 HAR 文件。如果 `package.json` 的 `files` 字段不含 `harmony/`，`npm pack` 不会包含 HAR。

### 4d. RN 工程依赖本地 TGZ 包

> ⚠️ **无 example 目录时**：如果库根目录下没有 `example/` 目录，从 RN3rdTemplate 模板仓库浅拷贝获取：
> ```bash
> git clone --depth 1 https://gitcode.com/lalhanOrz/RN3rdTemplate.git tmp-template
> cp -r tmp-template/0.84 example
> rm -rf tmp-template
> ```
> 详见 [references/har-tgz-build.md](references/har-tgz-build.md) Step D 的「获取 example 模板工程」章节。

```json
// example/package.json
"@react-native-ohos/react-native-xxx": "file:../react-native-ohos-react-native-xxx-<version>.tgz"
```

```bash
cd example && npm install --legacy-peer-deps
ls node_modules/@react-native-ohos/react-native-xxx/harmony/*.har  # 验证
```

### 4e. 最终编译验证

> ⚠️ **codegen 脚本参数验证**：运行 `npm run codegen` 前，检查 `example/package.json` 的 `codegen` 脚本是否包含 `--generate-type all`。`react-native codegen-harmony`（example 工程）**不支持**此参数，添加后会导致 `error: unknown option '--generate-type'`。该参数仅适用于库根 `package.json` 的 `codegen-lib` 脚本（使用 `react-native codegen-lib-harmony`）。如发现误加，移除后再执行。

```bash
cd example && npm install --legacy-peer-deps
npm run codegen
npm run dev
cd harmony && ohpm install
devecocli build --product default --build-mode debug
```

> ⚠️ `ohpm install` 不可跳过 — CMake 编译时需从 `oh_modules/@rnoh/react-native-openharmony/src/main/cpp/` 读取 RNOH C++ 源码。

> ⚠️ **构建日志来源验证**（多任务并行时必须）：构建完成后验证日志路径来自当前任务仓库，排除其他任务日志干扰：
> ```bash
> # 确认当前任务路径在日志中出现（应为大量匹配）
> grep -c "当前任务路径" <log_file>
> # 确认其他任务路径不在日志中（应为 0 匹配）
> grep -c "其他任务路径" <log_file>
> ```

详细操作步骤、参数说明、API 版本对应表、devecocli 回退方案见 [references/har-tgz-build.md](references/har-tgz-build.md)。

### 编译错误修复策略

编译错误修复是迭代过程，参考 [references/common-compile-errors.md](references/common-compile-errors.md) 获取常见错误模式和修复方法。通用策略：

1. **收集错误** → **分类** → **优先级排序**（先修复根因错误如 import 路径）
2. **单文件快速验证**：`devecocli check lint <file>`
3. **逐个修复后重新编译**
4. **迭代**：修复后重新走 4b→4c→4d→4e 流程

常见错误速查：

| 错误类型 | 典型表现 | 修复方向 |
|----------|---------|---------|
| 导入路径错误 | `Cannot find module 'X'` | 修正路径（根因错误，先修复） |
| ArkTS 模块解析 | `Failed to resolve OhmUrl` | 注册模块到 build-profile.json5 |
| ArkTS 编译规则 | `arkts-no-*` 系列错误 | 参考 ArkTS 编译规则修复 |
| 类型不匹配 | `Type 'X' is not assignable` | 检查接口定义是否同步 |
| C++ 链接错误 | `undefined reference to 'X'` | 检查 CMakeLists.txt 是否包含新源文件 |
| ohpm install 缺失 | `not an existing directory` | 运行 `ohpm install` |
| HAR 不在 tgz 中 | `npm pack --dry-run` 无 `.har` | package.json `files` 加 `harmony/` |
| SDK 版本不匹配 | `SDK component missing` | 移除 compileSdkVersion 或用 `rnoh-build-har <api-version>` |

### 验证通过标准

| 验证项 | 通过标准 |
|--------|---------|
| `devecocli check lint` | 无 ERROR |
| `rnoh-build-har` | `harmony/<module>.har` 生成 |
| `npm pack --dry-run` | tgz 包含 `.har` 文件 |
| `npm install` | tgz 包正确安装到 node_modules |
| `ohpm install` | oh_modules 中有 RNOH har 包 |
| `devecocli build` | `BUILD SUCCESSFUL`，仅框架 WARNING |
| CMake 编译完整性 | `BuildNativeWithCmake` 和 `BuildNativeWithNinja` 两个步骤均完成且无 ERROR |
| 构建日志来源 | 日志路径来自当前任务仓库（当前任务路径有匹配，其他任务路径 0 匹配） |

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

## 打包与编译验证结果
- devecocli check lint: ✅ 无错误
- rnoh-build-har: ✅ HAR 包生成 (harmony/xxx.har)
- npm pack: ✅ TGZ 包生成 (含 HAR 文件)
- npm install (tgz 依赖): ✅ tgz 包正确安装
- npm run codegen: ✅ 通过
- npm run dev: ✅ 通过
- ohpm install: ✅ har 包安装到 oh_modules
- devecocli build: ✅ BUILD SUCCESSFUL（依赖 tgz 包构建）

## 交付物
- harmony/xxx.har — 鸿蒙原生 HAR 包
- react-native-ohos-react-native-xxx-<version>.tgz — 最终 npm 包（含 HAR）

## 待后续关注
- 新增 API 的功能测试（见 rnoh-lib-test-align）
- 性能回归测试
```

---

## 常见边界情况

跨版本升级、codegen 冲突、缺少 RNOH 分支、peer dependency 冲突、compileSdkVersion 不匹配、RNOH 框架警告、codegen 与 autolinking 关系、源码 `file:` 依赖问题等边界情况，详见 [references/edge-cases.md](references/edge-cases.md)。


## 输出物清单

完成本 skill 后，应产出以下文件供后续 skill 使用：

1. **适配变更清单**（Markdown 格式）— 记录所有修改的文件、内容、原因
2. **HAR 包**（`harmony/<module>.har`）— 鸿蒙原生编译产物，由 `rnoh-build-har` 生成
3. **TGZ 包**（`<name>-<version>.tgz`）— 最终 npm 包产物，含 JS 代码 + HAR 包，由 `npm pack` 生成
4. **编译通过的本地工程** — 以 tgz 包依赖方式构建通过的 example 工程，供 rnoh-lib-test-align 移植测试用例
5. **变更分类清单** — 供 rnoh-lib-func-test 生成测试清单