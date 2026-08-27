# 编译与运行验证详细指南

> Phase 7 的详细参考文档。涵盖工程迁移、静态检查、编译修复循环、ohpm 线上版本替换等完整流程。

---

## 1. 工程迁移（migrate.cjs，必做不可跳过）

> 🔴 **强制步骤，禁止跳过**：
> - **无论工程类型（OpenHarmony / HarmonyOS）、无论 `build-profile.json5` 的 `compileSdkVersion` 是否与已安装 SDK 匹配，都必须执行下述迁移脚本**。
> - 禁止以"工程已是新版本""`compileSdkVersion` 已匹配已安装 SDK""工程为 OpenHarmony 无需切换到 HarmonyOS"等理由自行判断并跳过本步骤。
> - 即使 SDK 版本匹配，源工程的 hvigor 文件、`oh-package.json5`、product 的 `runtimeOS`/`compatibleSdkVersion` 等配置仍可能不兼容当前构建环境，必须在编译前执行迁移。

ArkTS原生库源码多为历史工程，`build-profile.json5` 的 SDK 版本配置、hvigor 文件、oh-package.json5 等经常不兼容当前构建环境。使用 `migrate.cjs` 脚本一次性完成华为官方 Manual Migration 全流程迁移。

0. **预迁移设备探测**：

   ```powershell
   cmd /c "hdc list targets"
   ```
   - 若有设备输出，探测设备 API 版本：
     ```powershell
     cmd /c "hdc shell param get const.ohos.apiversion"
     ```
     记录设备 API 版本（如 `23`），作为 `--compatible-api` 参数传入迁移脚本。
   - 若无设备，跳过此步（迁移脚本将自动探测已安装 SDK API 版本）。

1. 执行迁移脚本：

   ```powershell
   # 有设备时（deviceApi 从步骤 0 获取）
   node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}} --compatible-api {deviceApi}

   # 无设备时
   node {{skillDir}}/scripts/migrate.cjs --source {{sourcePath}}
   ```

2. **执行后强制校验（未通过不得进入编译验证）**：
   - 迁移脚本必须正常执行完成，输出以 `[migrate] 迁移完成。` 结尾
   - 迁移日志包含 `[migrate] SDK版本: compatibleSdkVersion=..., targetSdkVersion=...` 行
   - 校验 `{{sourcePath}}/build-profile.json5`：每个 product 的 `runtimeOS` 已为 `HarmonyOS`
   - `compatibleSdkVersion` 的 API 版本 ≤ 设备 API 版本（有设备时）或 = 已安装 SDK API 版本（无设备时）
   - 任一项不满足 → 重新执行迁移脚本，直至校验通过后方可进入编译验证

---

## 2. Code Linter 静态代码检查（编译前必做）

> 🔴 **编译前静态检查**：在进入编译验证之前，先通过 Code Linter 静态扫描测试代码，把可静态发现的问题（样式/正确性/性能/安全规则）前置到编译循环之外，减少编译轮次消耗。
> 由脚本 `code-linter.cjs` 自动化完成（config 检测/创建 → 执行 lint → 解析 JSON → 输出报告）。

### 2.1 调用脚本检查

作用域：本 SKILL 生成的 ohosTest 测试代码。

```powershell
node {{skillDir}}/scripts/code-linter.cjs --source {{sourcePath}} --target entry/src/ohosTest/ets/test
```

脚本行为：
- 探测 `devecocli --version`；不可用 → 报「构建环境不可用」退出码 1，本步骤标注跳过，但**不阻塞进入编译验证**（编译同样依赖该环境，届时会暴露）
- 检测工程根 `code-linter.json5`；缺失则按推荐规则集自动创建（否则 `devecocli check lint` 会报 `--config-path does not exist`）
- 执行 `devecocli check lint "<target>" --format json --output-path code-linter-raw.json`（仅传 1 个路径，满足命令路径参数限制）
- 解析 `{ issues }`，按 `Error` / `Warning` 统计，输出 `{{sourcePath}}/code-linter-report.json`

### 2.2 结果判定

| 情况 | 处理 |
|------|------|
| 退出码 0（0 Error） | 静态检查通过，进入编译验证 |
| 退出码 2（存在 Error） | 逐条修复（判断属测试生成代码则按编译修复循环 / 3.3 规范同源修复），重跑脚本直至 0 Error；计入编译修复轮次 |
| 退出码 1（环境不可用） | 标注"Code Linter 环境不可用，跳过"，进入编译验证 |

### 2.3 Warning 处理原则

- `@hw-stylistic/file-naming-convention` Warning：多因数字前缀文件名（要求大驼峰）。**不阻塞编译**，无需强制改命名
- 其他 Warning：`addTryCatch`/`addAsyncCatch`/未使用变量等属 P2 优化项，编译通过后按需处理
- **`any`/`unknown` 说明**：Linter 的 `@typescript-eslint/no-explicit-any` 仅对 `.js/.ts` 生效；`.ets` 的 any/unknown 由 ArkTS 编译器强制（`arkts-no-any-unknown`），需在编译验证中确认

---

## 3. 编译验证（5 轮修复策略）

> 🔴 **必须通过 build.ps1 执行**（直接调用 devecocli build 会阻塞 session）。`-Cmd` 必须含 `cd /d {{sourcePath}} &&` 前缀。

```powershell
# 首次编译
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -Cmd "cd /d {{sourcePath}} && devecocli build clean"
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "cd /d {{sourcePath}} && devecocli build --modules entry@ohosTest"
```

### 3.1 修复循环（最多 5 轮）

> 💡 **提效策略**：按错误类型优先级批量修复，可将 5 轮压缩至 1-2 轮。详见下方"错误优先级排序"。

每轮逐条读取错误，**按优先级批量修复**：

#### 错误优先级排序（提效关键）

| 优先级 | 错误类型 | 识别特征 | 批量修复方式 | 预计解决数 |
|--------|---------|---------|-------------|-----------|
| P0 | private/protected 访问 | `Property 'X' is private/protected` | Phase 1.5 预检已排除（已执行时）；若残留，删除直接访问或跳过该用例 | ~35% |
| P1 | `any`/`unknown` 残留 | `arkts-no-any-unknown` | `sed -i '' 's/as any/as Object/g'`；逐个替换 `: any` → `: Object` | ~15% |
| P2 | catch 类型注解 | `arkts-no-types-in-catch` | `sed -i '' 's/catch (e: Object)/catch (e)/g'` | ~5% |
| P3 | `null as Object` 转型 | `Type 'null' is not assignable to type 'Object'` | `sed -i '' 's/null as Object/null/g'` | ~8% |
| P4 | Object 属性访问 | `Property 'X' does not exist on type 'Object'` | 逐个改为原始类型（`as Object` → 实际类型） | ~15% |
| P5 | 枚举比较 | `types have no overlap` | 逐个加 `as number` 转型 | ~3% |
| P6 | 其他类型不匹配 | 各种 | 逐个分析修复 | ~19% |

**P0-P3 用 sed 批量处理（1 轮），P4-P6 逐个处理（1 轮）——总计 2 轮而非 5 轮。**

#### 增量编译（提效）

```powershell
# 首轮全量编译
devecocli build --modules entry@ohosTest

# 后续修复后增量编译（不 clean，hvigor 自动增量）
devecocli build --modules entry@ohosTest
```

> ⚠️ 修复后**不要** `devecocli build clean`，hvigor 有增量编译能力，可节省 ~70% 编译时间。

#### 错误来源分级

| 错误来源 | 错误类型 | 修复方式 |
|---------|---------|---------|
| 生成代码 | 3.3 规范已知模式 | 按表修复 |
| 生成代码 | 接口签名/类型不匹配 | 对照接口规格文档 + 源码 |
| 生成代码 | 表外新错误 | 分析 → 修复 → 记录到 3.3 规范 |
| 源库 | SDK 版本/依赖缺失/CMake 冲突 | 修正 build-profile/oh-package/externalNativeOptions ✅ |
| 源库 | ArkTS 类型错误 | 仅机械性修正 ⚠️ |
| 源库 | 业务逻辑错误 | 不修复，标注 ❌ |

重新编译后若通过 → 进入编译失败常见问题表；**连续 2 轮均为源库不可修复错误（❌）→ 立即终止**。

---

## 4. ohpm 线上版本替换（源库原生编译失败兜底）

> 当源库原生库（.so）需复杂构建（GN/Ninja/FFmpeg/libyuv/NDK 等）导致编译失败时，可用 ohpm 线上版本替换本地依赖。由共享脚本 `ohpm-switch.cjs` 自动化完成。

### 4.1 触发条件

全部满足才执行：
1. `ohpm` 可用
2. README 含 `.so`/`FFmpeg`/`NDK`/`GN`/`Ninja`/`prebuild` 等特征词
3. 存在 ohpm 线上版本
4. 修复循环内编译仍失败

### 4.2 执行

```powershell
node {{skillDir}}/scripts/ohpm-switch.cjs --source {{sourcePath}}
# 多个本地依赖时：node {{skillDir}}/scripts/ohpm-switch.cjs --source {{sourcePath}} --pkg <库包名> [--version <版本号>]
cd /d {{sourcePath}} && ohpm install
powershell -ExecutionPolicy Bypass -File "{{skillDir}}/scripts/build.ps1" -JavaHome -Cmd "cd /d {{sourcePath}} && devecocli build --modules entry@ohosTest"
```

脚本自动完成：扫描 `oh-package.json5` 定位 `file:` 依赖 → `ohpm info` 查询版本 → 改为线上版本号 → 移除 `build-profile.json5` `modules[]` 中本地模块条目 → 输出 `ohpm-switch-report.json`。

### 4.3 版本降级 API 兼容性核验（必做）

替换后必须对照 `library/index.ets` 导出链确认 import 的类型/常量/枚举仍存在。缺失时优先用更接近版本重跑；所有版本均不满足则降级为对象字面量并在报告备注。

### 4.4 结果处理

| 结果 | 处理 |
|------|------|
| 替换后编译通过 | 编译验证通过，报告标注线上版本切换，附 `ohpm-switch-report.json` |
| 替换后仍失败 | 走降级路径 |
| 无 ohpm 线上版本 | 维持原流程 |

> ⚠️ 修改保留不回滚，报告如实记录改动（引用 `ohpm-switch-report.json`）。

---

## 5. 降级：5 轮仍失败 / 提前终止

- ⚠️ 编译验证未通过
- 在最终报告中列出：
  - 生成代码未修复的错误 → 标注"需加入 3.3 错误处理规范"
  - 源库不可修复的错误 → 标注"需源库作者修复"
- **任务状态仍为"完成"**（代码生成本身已完成，编译验证因源库问题跳过）

---

## 6. 编译失败常见问题速查

| 错误类型 | 错误标识 | 解决方法 |
|---------|---------|---------|
| private/protected 访问 | `Property 'X' is private` | Phase 1.5 预检排除（已执行时）；残留的删除直接访问或跳过该用例 |
| any 类型 | `arkts-no-any` | 定义具体类型或 interface |
| unknown 关键字 | `arkts-no-any-unknown` | `unknown` 被完全禁止。改用空但合法的对象、构造最小字段对象字面量 `as Type`、或 `{} as Type` |
| catch 类型注解 | `arkts-no-types-in-catch` | `catch (e)` 不带类型注解，e 默认为 Object 类型 |
| Object 属性访问 | `Property 'X' does not exist on type 'Object'` | 保留原始类型不做 `as Object` 转型；仅在不需要属性访问时用 `as Object` |
| 枚举比较重叠 | `types 'A' and 'B' have no overlap` | `(Enum.A as number) !== (Enum.B as number)` 转型后比较 |
| null 转 Object | `Type 'null' is not assignable to type 'Object'` | 直接用 `null`，不做 `null as Object` 转型 |
| 对象字面量无类型 | `arkts-no-untyped-obj-literals` | 定义命名 interface/class，不能用 `{}` 赋值给 Object |
| ESObject 类型 | `arkts-no-esobj` | 定义命名 interface |
| 不安全转型 | `arkts-no-unsafe-cast` | 正确定义类型，避免双重 `as unknown as` |
| 导入路径错误 | — | 检查库导出入口的实际路径 |
| 缺少权限 | — | 在 ohosTest 的 module.json5 中声明 |

> 完整的编译错误列表及修复方法参见 [CODE_STANDARDS.md 二和八](CODE_STANDARDS.md)。
