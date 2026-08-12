---
name: arkts-library-xts-execution
description: 执行鸿蒙ArkTs原生库的 XTS 测试用例（含源码已有的和新生成的），编译项目、安装 HAP、通过 hdc 执行 hypium 测试、收集结果并生成执行报告。100% 覆盖所有可测试接口。当需要对鸿蒙ArkTs原生库进行 XTS 测试用例自动化测试，并输出XTS测试报告时调用。
license: Apache-2.0
metadata:
  author: AIWeb
  version: "1.1.0"
  category: ohos-testing
  language: ArkTS/ETS
---

# ArkTS 原生库 XTS 测试执行与报告生成

本 Skill 编译并执行鸿蒙ArkTs原生库的 XTS 测试用例（含源码已有的和新生成的），收集测试结果，生成测试执行报告。

> ⚠️ 核心约束：
> 1. 自动诊断源库构建问题，不因源库问题判定任务失败
> 2. 编译成功 → hdc安装 → aa test → 结果收集
> 3. 编译失败 → 尝试自动修复 → 仍失败则标注源库构建问题
> 4. 报告状态区分"测试通过" vs "源库构建问题" vs "设备不可用"

> 🔴 **Windows PowerShell 兼容性原则（必读！所有 bash 命令必须遵循）：**
> 1. **devecocli / hdc 命令**：必须用 `cmd /c` 包裹，否则 PowerShell 执行策略会阻止 `.ps1` 脚本运行：
>    ```powershell
>    # ✅ 正确
>    cmd /c "devecocli signature generate --product default"
>    cmd /c "hdc list targets"
>    # ❌ 错误 — 会报 PSSecurityException
>    devecocli signature generate --product default
>    ```
> 2. **含空格路径的可执行文件**：必须用 PowerShell `&` 调用运算符，不能用 `cmd /c`（cmd 无法正确处理含空格的 exe 路径）：
>    ```powershell
>    # ✅ 正确 — & 运算符可正确处理路径中的空格
>    & "D:\software\ide\DevEco Studio\tools\node\node.exe" "D:\software\ide\DevEco Studio\tools\hvigor\bin\hvigorw.js" --stop-daemon
>    # ❌ 错误 — cmd /c 会把空格处截断，报"不是内部或外部命令"
>    cmd /c ""D:\software\ide\DevEco Studio\tools\node\node.exe" "D:\software\ide\DevEco Studio\tools\hvigor\bin\hvigorw.js" --stop-daemon"
>    ```
> 3. **管道命令**（hilog + findstr）：必须用 `cmd /c` 包裹整个管道，否则 PowerShell 管道与 cmd 管道不兼容：
>    ```powershell
>    # ✅ 正确
>    cmd /c "hdc shell hilog -x" 2>&1 | Select-String "Hypium"
>    # 或
>    cmd /c "hdc shell hilog -x | findstr Hypium"
>    ```
> 4. **DevEco 目录获取**：`where.exe hdc` → 去掉 `\sdk\...` 后缀即为 DevEco 目录

---

## 任务参数

| 参数 | 必需 | 说明 |
|------|------|------|
| `sourcePath` | ✅ | 源码根目录 |
| `outputDir` | ✅ | 输出目录（XTS 用例文档和覆盖率报告所在目录） |
| `xtsDocPath` | 可选 | 单个 XTS 用例文档路径；若未提供，从 `outputDir` 搜索 `*XTS用例描述*.md` 或 `arktscoverage-xts-doc.md` |

---

## 工作流程

### 步骤 1：准备工作

#### 1.1 确认测试文件清单

1. `glob` `{{sourcePath}}/entry/src/ohosTest/ets/test/*.test.ets` — 列出所有 `.test.ets` 文件
2. 排除 `List.test.ets`（入口），其余为测试套件
3. 若提供了 `{{xtsDocPath}}`，读取提取可测试接口数；否则从 `{{outputDir}}` 自动搜索 XTS 用例文档
4. 统计测试套件总数

#### 1.2 注册新测试套件

1. `read_file` `{{sourcePath}}/entry/src/ohosTest/ets/test/List.test.ets`
2. 搜索新测试文件名是否已有 import
3. 若未注册，在 `export default function testsuite()` 之前追加 import，在 testsuite() 内追加调用：

```typescript
import {新套件名} from './{新文件名}';
// 在 testsuite() 内加: {新套件名}();
```

#### 1.3 提取 bundleName

`read_file` `{{sourcePath}}/AppScope/app.json5` → 提取 `bundleName`

#### 1.4 工程迁移（migrate.cjs，必做不可跳过）

> 🔴 **强制步骤，禁止跳过**：
> - **无论工程类型（OpenHarmony / HarmonyOS）、无论 `build-profile.json5` 的 `compileSdkVersion` 是否与已安装 SDK 匹配，都必须执行下述迁移脚本**。
> - 禁止以"工程已是新版本""`compileSdkVersion` 已匹配已安装 SDK""工程为 OpenHarmony 无需切换到 HarmonyOS"等理由自行判断并跳过本步骤。
> - 即使 SDK 版本匹配，源工程的 hvigor 文件、`oh-package.json5`、product 的 `runtimeOS`/`compatibleSdkVersion` 等配置仍可能不兼容当前构建环境，必须在编译前执行迁移。

ArkTS原生库源码多为历史工程，`build-profile.json5` 的 SDK 版本配置、hvigor 文件、oh-package.json5 等经常不兼容当前构建环境。使用 `migrate.cjs` 脚本一次性完成华为官方 Manual Migration 全流程迁移。

1. 执行迁移脚本：

```powershell
node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
```

2. **执行后强制校验（未通过不得进入后续编译）**：
   - 迁移脚本必须正常执行完成，输出以 `[migrate] 迁移完成。` 结尾，且包含 `强制 N 个 product compatibleSdkVersion/targetSdkVersion=6.1.1(24) + runtimeOS=HarmonyOS` 日志（N≥1）
   - 校验 `{{sourcePath}}/build-profile.json5`：每个 product 的 `runtimeOS` 已为 `HarmonyOS`、`compatibleSdkVersion` 已为 `6.1.1(24)`
   - 任一项不满足 → 重新执行迁移脚本，直至校验通过后方可进入后续编译

> 迁移在编译前执行，确保构建环境兼容。

#### 1.5 真机签名与设备检查

真机测试需先通过 `devecocli signature generate` 生成调试签名材料并写入 `build-profile.json5`：

1. 检查真机连接：
    ```powershell
    cmd /c "hdc list targets"
    ```
    无设备输出 → 报告标注"设备不可用"，跳转步骤 4

2. 生成签名材料（在项目根目录执行）：
    ```powershell
    cmd /c "devecocli signature generate --product default"
    ```
    > 自动生成 p12/csr/cer/p7b 签名材料并写入 `build-profile.json5` 的 `signingConfigs`。
    > 首次使用前需执行 `devecocli auth login` 登录开发者账号。
    > 若提示 `Provision number exceeds limit` 或签名不一致，加 `--force` 强制重新生成。

3. 轮询确认设备已连接（每 5s 检查一次，最多 60s）：
    ```powershell
    # 最多尝试 12 次，每次间隔 5s
    for ($i = 1; $i -le 12; $i++) {
      $result = cmd /c "hdc list targets"
      if ($result -match "device") { break }
      Start-Sleep -Seconds 5
    }
    ```
    12 次后仍无设备 → 报告标注"设备不可用"，跳转步骤 4



### 步骤 2：弹性编译（三层策略）

> 🔴 **hvigor daemon 阻塞**：`devecocli build` 跑完后 daemon 不退出，会阻塞 Agent。
> 所有构建通过 `build.ps1` 执行（.NET Process + 文件重定向，daemon 继承文件 handle，不阻塞 console pipe）。

#### 第一层：检查构建环境

```powershell
cmd /c "devecocli --version"
node --version
where.exe hdc
```

> DevEco 目录由 `where.exe hdc` 反推（去掉 `\sdk\...` 后缀）。

任一不可用 → "构建环境不可用"，跳转步骤 4。

#### 第二层：首次编译

构建测试 HAP（含签名）：

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "devecocli build --modules entry@ohosTest"
```

**结果判定：**
- 编译成功 → "编译成功"，跳转步骤 3
- 编译失败 → 进入第三层修复

产物用 glob 查找（signed）：
```
glob: {{sourcePath}}/entry/build/default/outputs/ohosTest/*.hap    → 测试 HAP
```

#### 第三层：自动诊断与修复（决策树，最多 5 轮）

分析错误输出，按**优先级分级表**修复。详细修复示例参见 [error-fixing-examples.md](references/error-fixing-examples.md)。

**P0（必须修复，阻止编译）**：

| 错误模式 | 修复 |
|---------|------|
| `Could not resolve dependency` | `oh-package.json5` 补充 devDependencies |
| `Cannot find module '@ohos/hypium'` | `ohosTest/oh-package.json5` 加 `"@ohos/hypium"` |
| `SDK component not found` | 修正 `build-profile.json5` 的 `compileSdkVersion` |
| `hvigorfile.ts` not found | `git submodule update --init --recursive` |
| `Cannot read property 'xxx' of undefined` | 补充缺失的 `.json5` 字段 |
| 类型错误 / 导入错误 / 括号不匹配 | 修正测试代码中的类型、导入名、括号 |

> **判定规则**：构建日志出现以下任一模式时，判定为"源库不可修复"，**立即终止修复循环**：
> - 连续 2 轮出现的错误均为源库不可修复错误（❌ 行）

**P1（建议修复，废弃 API 迁移）**— 仅迁移测试代码，源库不迁移：

| 错误模式 | 修复 |
|---------|------|
| `@ohos.fileio` 废弃 | 迁移到 `@ohos.file.fs`，参数需调整（`fs.open` 返回 `FILE`，非 fd） |
| `AbilityContext` 废弃 | 迁移到 `UIAbilityContext` |
| `Signature verification failed` | `devecocli build -p buildMode=debug -p debuggable=true` |

**P2（可选优化，源库问题不修复）**：

| 错误模式 | 处理 |
|---------|------|
| `arkts-no-any` | 源库 ArkTS 规范问题，标注不修复 |
| `arkts-no-dynamic-property` | 源库 ArkTS 规范问题，标注不修复 |
| 未使用变量 / 缺异常处理 | 可选优化，不阻塞编译 |

**诊断码映射表**（devecocli build 输出中提取诊断码，精确分类）：

| 诊断码 | 类型 | 说明 | 优先级 |
|--------|------|------|--------|
| 28007 | Warning | 权限警告 | P2 |
| 6133 | Warning | 未使用变量 | P2 |
| 6387 | Information | 废弃 API | P1 |
| addTryCatch | Warning | 需异常处理 | P2 |
| addAsyncCatch | Warning | 异步异常处理 | P2 |
| 其他 (Error) | Error | 语法/类型错误 | P0 |

**决策树流程：**

```
开始诊断
  │
  ├─→ 有 P0 错误？ → 修复 P0 → 重新编译 → 判定（计入重试轮次）
  │     ├─→ 编译成功 → 步骤 3
  │     └─→ 编译失败 → 回到诊断（轮次+1）
  │
  ├─→ 有 P1 错误（无 P0）？ → 迁移废弃 API → 重新编译 → 判定
  │     ├─→ 编译成功 → 步骤 3
  │     └─→ 编译失败 → 回到诊断（轮次+1）
  │
  ├─→ 仅 P2 错误（源库问题）？ → 跳过修复 → 尝试编译 → 判定
  │     ├─→ 编译成功 → 步骤 3
  │     └─→ 编译失败 → 降级报告
  │
  └─→ 5 轮仍失败 → 降级报告
```

**终止判定（立即退出循环）**：

若构建日志中出现以下模式，**立即终止修复循环**，不再尝试后续轮次，直接跳转降级：
- 连续 2 轮出现的错误均为源库不可修复错误（❌ 行）

终止后在报告中标注编译跳过原因和修复建议。

**每轮修复后重新编译：**

```powershell
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "devecocli build --modules entry@ohosTest"
```

编译成功 → 步骤 3；5 轮仍失败 → 降级。

#### 降级：5 轮仍失败 / 提前终止

> 编译失败且修复后仍无法成功 → 标注"源库构建问题"，不判定任务失败。
> 报告中记录完整的构建错误日志和已尝试的修复措施。
>
> **降级后报告追加**：
> - 源库不可修复的错误 → 标注"需源库作者修复"
> - **任务状态仍为"完成"**（测试代码生成本身已完成，编译执行因源库问题跳过）

---

### 步骤 3：安装与执行

> **安装 → 执行 → 收集结果在同一响应中连续执行。**
> 真机测试只需安装测试 HAP，无需安装主 HAP。

**步骤 3.1 卸载旧应用并安装测试 HAP：**

先用 glob 查找测试 HAP 产物（signed）：

```
glob: {{sourcePath}}/entry/build/default/outputs/ohosTest/*.hap    → 测试 HAP
```

卸载旧应用并安装测试 HAP：

```powershell
cmd /c "hdc uninstall {bundleName}"
cmd /c "hdc install {测试HAP绝对路径}"
```

> 签名变化会导致安装失败，务必先卸载再安装。
> 真机必须使用 signed HAP，unsigned HAP 无法安装到真机。

**步骤 3.2 执行 XTS 测试：**

动态收集所有测试套件类名（排除 List.test.ets），拼接为 `-s class` 参数：

```powershell
cmd /c "hdc shell aa test -b {bundleName} -m entry_test -s unittest /ets/testrunner/OpenHarmonyTestRunner -s class {套件类名逗号分隔列表} -s timeout 15000"
```

> 套件类名从步骤 1.1 的 `.test.ets` 文件名推导（去掉 `.test.ets` 后缀即为类名，如 `FastBleTest.test.ets` → `FastBleTest`）。
> `aa test` 输出测试结果到 stdout，无需额外 hilog 收集。

**步骤 3.3 收集测试结果：**

从 `aa test` stdout 解析以下关键行：
- `OHOS_REPORT_RESULT: stream=Tests run: {N}, Failure: {F}, Error: {E}, Pass: {P}, Ignore: 0` → 总结果行
- `OHOS_REPORT_STATUS: ...` → 每个用例的状态

统计：总数 / 通过 / 失败(fail) / 错误(error) / 耗时

> ⚠️ **fail vs error 区分**：fail = 断言不匹配（测试逻辑问题），error = 运行时异常（环境/源库问题）

---

### 步骤 4：生成执行报告

`write_file` `{{outputDir}}/arktscoverage-xts-exec-report.md`：

```markdown
# {库名} XTS 测试执行报告

## 1. 概述
- 库名称 / 测试时间 / 框架 / bundleName
- 已有套件数 / 新增套件数 / 总套件数

## 2. 构建环境
- devecocli / Node.js / ohpm 版本
- hdc 设备：{有/无}（设备名称和 OS 版本）
- 编译结果：{成功 / 失败（修复N轮后）/ 环境不可用}
- aa test 执行方式：aa test

## 3. 源库问题诊断（若编译失败）
| 错误类型 | 诊断 | 是否已修复 |
|---------|------|----------|
| 依赖缺失 | oh-package.json5 缺少 @ohos/hypium | ✅ |
| SDK 版本 | compileSdkVersion 不匹配 | ❌（需源库作者修复） |
| ... | ... | ... |

## 4. 测试套件清单
| 测试文件 | 类型 | 注册状态 |
|---------|------|---------|
| FileCache.test.ets | 已有 | ✅ |
| ImageKnifeProXtsTest.test.ets | 新增 | ✅ |

## 5. 测试结果（若已执行）
| 指标 | 数值 |
|------|------|
| 总数 | N |
| 通过 | P |
| 失败（fail） | F |
| 错误（error） | E |
| 通过率 | P/N % |
| 耗时 | Nms |

## 6. 可测试接口覆盖（若已执行）
| 接口 | 用例编号 | 结果 | 备注 |

## 7. 失败分析（若有）
- fail 用例：断言不匹配原因分析
- error 用例：运行时异常原因分析（区分环境限制 vs 源库问题）

---
状态: {成功 / 部分通过 / 源库构建问题 / 环境不可用 / 设备不可用}
```

---

## 注意事项

1. **不为源库问题担责**：源库的依赖/配置/SDK 问题不是测试代码的问题，报告中单独标注
2. **最多修复 5 轮**：自动修复常见问题后仍编译失败，标注"源库构建问题"
3. **不为测试代码担责**：测试代码已通过 XTS 代码生成阶段验证，源库构建问题不影响测试代码质量判定
4. **报告状态细化**：`成功` / `部分通过` / `源库构建问题` / `环境不可用` / `设备不可用`
5. 新套件必须在 List.test.ets 注册后才能执行
6. **真机测试只需安装测试 HAP，无需主 HAP**
7. **测试 HAP 是唯一需构建的产物**：通过 `devecocli build --modules entry@ohosTest` 构建，无需构建主 HAP
8. **步骤连续执行**：同一响应中连续完成，不输出中间成功信息
9. **🔴 hvigor daemon 阻塞**：所有构建通过 `build.ps1` 执行，不要直接调用 `devecocli build`。
    每次构建后自动杀 daemon（并行场景下互相误杀代价低，重试即可恢复）。
10. **🔴 PowerShell 执行策略兼容性**：所有 `devecocli` 和 `hdc` 命令必须用 `cmd /c` 包裹，否则 PowerShell 会阻止 `.ps1` 脚本运行（报 `PSSecurityException`）
11. **🔴 真机必须使用 signed HAP**：真机无法安装 unsigned HAP，编译前需通过 `devecocli signature generate` 生成签名。必须用 glob 查找实际产物文件名，不可硬编码
12. **🔴 JAVA_HOME 设置**：测试 HAP 构建使用 `build.ps1 -JavaHome`（脚本自动检测 DevEco 路径并设置 JAVA_HOME）：
    ```powershell
    powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "devecocli build --modules entry@ohosTest"
    ```
13. **🔴 签名一致性**：签名变化会导致安装失败，安装前务必先 `hdc uninstall` 卸载旧应用