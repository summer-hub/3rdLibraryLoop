---
name: rn-lib-add-example
description: 为 RN 鸿蒙三方库创建 example 示例工程：从 RN3rdTemplate 模板仓库（gitcode.com/lalhanOrz/RN3rdTemplate）浅拷贝对应 RNOH 框架版本（0.77/0.82/0.84）的模板到库根 example/，自动修改 app 名称与 bundleName 等工程标识，清理 .npmrc 凭据与模板残留，以 npm pack tgz 方式接入本地库依赖并适配鸿蒙壳层，预置 RNTesterList 注册入口，最终按渐进式验证链（npm install → npm run dev → ohpm install → hvigorw assembleHap）确认工程可构建。当三方库仓库缺失 example/ 目录、或需要基于标准模板重建结构完整的 example 壳层工程（含 package.json、入口 index、RNTesterList 页面注册、harmony 构建配置）时使用。
license: Apache-2.0
compatibility: 需要 Node.js ≥ 16 与 git（可访问 gitcode.com），库依赖接入需 npm；鸿蒙侧编译验证需 DevEco Studio（ohpm/hvigorw）；需目标库根目录写权限
metadata:
  author: LoopEngine
  version: "1.0.0"
  category: rn-engineering
  invoked-by: 三方库 example 工程准备流程
  consumed-by: rnoh-lib-demo-create、rnoh-cptf-api-test
---

# RN 三方库添加 Example 工程

从 RN3rdTemplate 模板仓库浅拷贝对应 RNOH 框架版本的模板工程，修改 app 名称后接入目标库依赖，产出结构完整、可构建、可注册 Demo 的 example 壳层工程。

> ⚠️ **核心原则**：
> 1. 库依赖一律 `npm pack` + `file:../xxx.tgz`，**禁止 `file:../目录`**（npm 会以 symlink 安装，Metro 无法解析）
> 2. 拷贝模板后第一件事：**删除 `.npmrc`**（模板可能内嵌私有 registry 明文 token，含凭据文件严禁带入交付物）
> 3. 必须**预置 `src/RNTesterList.ts`（模式 A）注册入口**，与下游 Demo 生成/测试技能（rnoh-lib-demo-create、rnoh-cptf-api-test）的探查逻辑无缝衔接
> 4. 壳层适配的类名/路径/链接目标全部由库 `package.json` 的 harmony 元数据派生，禁止手抄猜测
> 5. 验证遵循渐进式链：`npm run dev` 成本最低、最先执行，不要跳过直接做鸿蒙编译

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `libRoot` | string | ✅ | 目标库根目录（含 package.json） |
| `version` | string | ❌ | RNOH 框架版本（0.77/0.82/0.84），缺省从库 package.json 自动推断 |
| `appName` | string | ❌ | 应用显示名，缺省从库名派生（如 `SqliteStorageExample`） |
| `bundleName` | string | ❌ | 鸿蒙包名，缺省派生为 `com.rnoh.{lib_name}` |
| `templateUrl` | string | ❌ | 模板仓库地址，默认 https://gitcode.com/lalhanOrz/RN3rdTemplate.git |
| `force` | boolean | ❌ | example/ 已存在时是否删除重建（默认询问用户） |

---

## 输入依赖

- **前置SKILL**：无，可独立调用
- **输入文件**：目标库根 `package.json`（读 name/version/harmony.autolinking 元数据）
- **外部依赖**：git、Node.js ≥ 16、npm；验证阶段需 DevEco Studio（ohpm/hvigorw）
- **MCP工具**：可选 `kb_search`（查询鸿蒙平台特定约束）

---

## 工作流程概览

```
Phase 1: 前置检查与框架版本确定
    ↓
Phase 2: 浅拷贝模板并修改 app 名称（create-example.cjs）
    ↓
Phase 3: 库依赖接入（tgz）与壳层适配
    ↓
Phase 4: 预置 RNTesterList 注册入口与冒烟 Demo
    ↓
Phase 5: 渐进式验证链
    ↓
Phase 6: 库根工程卫生与输出报告
```

---

## Phase 1：前置检查与框架版本确定

### 1.1 检查 example/ 现状

- **已存在** → **询问用户**：覆盖重建（`--force`）、增量更新、或取消
- **缺失** → 继续 Phase 2

### 1.2 读取库元数据

读取 `libRoot/package.json`，提取 `name`、`version`、`harmony.alias`、`harmony.autolinking.*`（ohPackageName / etsPackageClassName / cppPackageClassName / cmakeLibraryTargetName）与源码模块路径（`harmony/{module}/`）。后续壳层适配全部由这些字段派生。

### 1.3 确定 RNOH 框架版本

从库 `dependencies` 中 `@react-native-oh/react-native-harmony` / `react-native-harmony` / `react-native` 的版本取 `major.minor`（如 `0.82.30` → `0.82`）。无法推断时**询问用户**，禁止猜测。

> 版本对照表与模板目录结构参见 [模板仓库指南](references/TEMPLATE_REPO_GUIDE.md)

---

## Phase 2：浅拷贝模板并修改 app 名称

执行主脚本（自动完成：浅克隆 → 复制 `{version}/` → `example/` → 排除 `.npmrc`/`.DS_Store` → 修改 app 名称 → 清理 querySchemes 模板残留）：

```bash
node {skillDir}/scripts/create-example.cjs \
  --lib-path <libRoot> \
  [--version 0.82] [--app-name XxxExample] [--bundle-name com.rnoh.xxx] [--force]
```

脚本完成后抽查确认：

| 检查项 | 期望 |
|--------|------|
| `example/app.json` | name/displayName 已改为目标应用名 |
| `example/package.json` | name 已替换（非 `react-native-harmony-tester`） |
| `harmony/AppScope/app.json5` | bundleName 已替换（非模板残留 `com.harmony.wechat.lib.demo`） |
| `example/.npmrc` | 不存在（含凭据文件必须删除） |
| `grep -rn "wechat\|weixin" example/` | 无匹配 |

> 脚本不可用（无 git 等）时的手动步骤与改名点位明细参见 [App 名称修改指南](references/APP_RENAME_GUIDE.md)

---

## Phase 3：库依赖接入（tgz）与壳层适配

### 3.1 库依赖接入

1. 库根 `.npmignore` 追加 `example`
2. 库根 `npm pack` 生成 tgz
3. `example/package.json` 依赖写 `"file:../{tgz文件名}"`

> ⚠️ 禁止 `file:../目录` 形式（symlink 问题，详见核心原则 1）

### 3.2 壳层适配

按必查清单逐项适配（oh-package HAR 路径、CMakeLists 指向 node_modules、PackageProvider.cpp、RNPackagesFactory.ets、Index.ets、build-profile.template.json5 modules、metro/tsconfig alias、权限最小化）：

> 完整清单参见 [壳层适配必查清单](references/SHELL_ADAPTATION_CHECKLIST.md)

---

## Phase 4：预置 RNTesterList 注册入口与冒烟 Demo

下游技能探查 Demo 注册入口的第一优先级是 `{projectRoot}/**/RNTesterList.ts`（模式 A：`{key, category, module}` 数组），模板原生不含该文件，必须预置：

1. 创建 `example/src/RNTesterList.ts`，首项 `{key: '{libName}', category: '{category}', module: require('./{libName}')}`
2. `App.tsx`（或 `src/index.tsx`）消费该列表渲染 Navigation 页面
3. 预置 1 个冒烟 Demo（`{exampleDir}/{libName}/index.tsx` + 最小可用页面，覆盖库核心链路如 open→exec→close）验证注册链路与原生桥通

> 模式 A 代码模板参见 [壳层适配必查清单](references/SHELL_ADAPTATION_CHECKLIST.md) 第五节

---

## Phase 5：渐进式验证链

按顺序执行，前一步失败先修复再继续：

```
1. cd example && npm install --legacy-peer-deps
2. npm run dev                    # 成本最低，暴露 alias/依赖问题
3. cd harmony && ohpm install --all
4. hvigorw assembleHap --no-daemon
5. nm -gU .../librnoh_app.so | grep <cppPackageClassName>   # 纯 ETS 库跳过
```

> 各步骤要点、unsigned HAP 预期、hvigor 调用方式与故障排查表参见 [渐进式验证指南](references/VERIFICATION_GUIDE.md)

---

## Phase 6：库根工程卫生与输出报告

### 6.1 库根工程卫生

- `.npmignore` 确认已含 `example`
- `.gitignore` 追加 `harmony/{module}/oh_modules`、`harmony/{module}/oh-package-lock.json5`
- npm pack 的 tgz 留在库根（CPF-RN 仓惯例）

### 6.2 输出报告

输出确认信息，包含：

- example 目录路径与框架版本（RN/React/react-native-harmony）
- 应用标识（appName / bundleName / npm 包名 / RN 注册名）
- 库依赖接入方式（tgz 文件名）
- 壳层适配完成项（对照必查清单）
- RNTesterList 预置情况与冒烟 Demo 说明
- 验证链各步执行结果（npm run dev / ohpm / hvigorw / 符号检查）
- 需用户后续确认的事项（签名配置、真机部署）

---

## 异常处理

| 异常场景 | 处理方式 |
|----------|----------|
| example/ 已存在且用户未确认 | 停止，等待用户选择（覆盖/增量/取消） |
| 无法推断框架版本 | 询问用户显式指定 --version |
| git clone 失败（网络） | 重试或提示用户配置代理/镜像后重试 |
| 模板仓库无对应版本目录 | 列出可用版本，询问用户降级/升级选择 |
| npm run dev 报 Unable to resolve module | 检查库依赖是否误用 file: 目录（改 tgz），详见验证指南故障表 |
| TreeFS file map 报错 | 清 `node_modules/.cache` + `watchman watch-del-all` 后重跑 |
| 未配置签名产出 unsigned HAP | 属预期，提醒用户真机部署前补 signingConfigs |

---

## 参考资料

- [模板仓库指南](references/TEMPLATE_REPO_GUIDE.md) — RN3rdTemplate 结构、版本对照、手动拷贝步骤
- [App 名称修改指南](references/APP_RENAME_GUIDE.md) — 名称派生规则、必改点位、改名校验
- [壳层适配必查清单](references/SHELL_ADAPTATION_CHECKLIST.md) — 库元数据、tgz 接入、壳层适配、RNTesterList 预置
- [渐进式验证指南](references/VERIFICATION_GUIDE.md) — 验证链、各步要点、故障排查表
- RN3rdTemplate 仓库：https://gitcode.com/lalhanOrz/RN3rdTemplate
