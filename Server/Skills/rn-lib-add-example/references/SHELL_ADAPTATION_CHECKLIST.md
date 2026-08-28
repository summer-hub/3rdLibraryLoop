# 壳层适配必查清单（库依赖接入）

> 模板拷贝与改名完成后，将目标库接入 example 工程的必查清单。所有类名/路径/链接目标均由库 `package.json` 的元数据派生，禁止手抄猜测。

## 一、库元数据读取

从库根 `package.json` 读取以下字段，作为后续所有适配的输入：

| 字段 | 用途 |
|------|------|
| `name` / `version` | npm 依赖名与 tgz 版本号 |
| `harmony.alias` | metro/tsconfig 别名 |
| `harmony.autolinking.ohPackageName` | ohpm 包名 |
| `harmony.autolinking.etsPackageClassName` | `RNPackagesFactory.ets` import 的类名 |
| `harmony.autolinking.cppPackageClassName` | `PackageProvider.cpp` 的类名 |
| `harmony.autolinking.cmakeLibraryTargetName` | `CMakeLists.txt` link 目标 |
| 源码模块路径（`harmony/{module}/`） | `build-profile.template.json5` 的 `modules[]` 与 CMake 路径 |

## 二、库依赖接入（⚠️ 必须用 tgz）

1. 库根 `.npmignore` 追加 `example`（否则 npm pack 会把整个 example 工程打进库包）
2. 库根执行 `npm pack` 生成 `{包名去scope横线}-{版本}.tgz`
3. `example/package.json` 依赖写 `"file:../{tgz文件名}"`
4. 重装后确认 `node_modules/{ohPackageName}` 为**实体目录**而非符号链接

> ⚠️ **禁止 `file:../目录` 形式**：npm 对目录型 `file:` 依赖默认以 symlink 安装，Metro/watchman 不跟随工程目录外的链接，`npm run dev` 报 `Unable to resolve module`。CPF-RN 系列仓库（netinfo、async-storage 等）均采用 tgz 方式，这是既定惯例。

## 三、壳层适配必查文件

| 文件 | 适配内容 |
|------|----------|
| `harmony/entry/oh-package.json5` | 追加库 HAR：`"{ohPackageName}": "file:../../node_modules/{ohPackageName}/harmony/{module}.har"` |
| `harmony/entry/src/main/cpp/CMakeLists.txt` | `add_subdirectory` 指向 **node_modules**：`${NODE_MODULES}/{ohPackageName}/{sourceModulePath}/src/main/cpp`。⚠️ 严禁 oh_modules（HAR 内无 cpp 源码）。纯 ETS 库（无 cpp）跳过 |
| `harmony/entry/src/main/cpp/PackageProvider.cpp` | `#include "{cppPackageClassName}.h"` + `std::make_shared<{cppPackageClassName}>(ctx)` |
| `harmony/entry/src/main/ets/RNPackagesFactory.ets` | `import { {etsPackageClassName} } from '{ohPackageName}/ts'`，并在返回数组中 `new {etsPackageClassName}(ctx)` |
| `harmony/entry/src/main/ets/pages/Index.ets` | 纯 TurboModule 库：`buildCustomRNComponent` 保持空、`arkTsComponentNames` 为空数组；有 Fabric 组件的库在此注册 |
| `harmony/build-profile.template.json5` | `modules` 追加库源码模块 `{name: '{harmonyModuleName}', srcPath: '../../harmony/{module}'}`；删除 `useNormalizedOHMUrl`。⚠️ 改 template 而非 build-profile.json5（postinstall 会用 template 覆盖生成） |
| `harmony/entry/src/main/module.json5` | 权限最小化：仅保留库所需权限（如 sqlite 仅 INTERNET），模板默认已只有 INTERNET，勿盲目添加 |
| `metro.config.js` / `tsconfig.json` | `{alias}` → `node_modules/{ohPackageName}` 映射 |

## 四、模板残留清理

- `module.json5` 的 `querySchemes`（脚本已自动移除；库需要时再按需添加）
- `src/` 下模板旧 demo 目录（当前模板仅 `src/index.tsx`，无旧 demo；若模板升级后带旧 demo 须删除）
- 全局 `grep -rn "wechat\|weixin\|camera" example/` 确认无残留
- 确认 `example/.npmrc` 已删除（含凭据文件严禁带入交付物）

## 五、RNTesterList 注册入口预置

下游技能（rnoh-lib-demo-create / rnoh-cptf-api-test）探查 Demo 注册入口的**第一优先级是 `{projectRoot}/**/RNTesterList.ts`**。模板原生只有 `App.tsx + src/index.tsx` 模式，必须**预置模式 A 注册入口**，否则后续 Demo 生成步骤找不到注册入口。

### 5.1 创建 `example/src/RNTesterList.ts`

```typescript
export interface RNTesterModule {
  key: string;
  category: string;
  module: any;
}

export const RNTesterList: RNTesterModule[] = [
  {
    key: '{libName}',
    category: '{category}',
    module: require('./{libName}'),
  },
];
```

首项指向 `{exampleDir}/{libName}/index.tsx`（后续由 Demo 生成技能创建）。同时预置 1 个**冒烟 Demo**（`{exampleDir}/{libName}/index.tsx` + 一个最小可用页面，如 sqlite 库的 openDatabase→executeSql→close 全链路）验证注册链路与原生桥通，保证不是空壳。

### 5.2 `App.tsx` 消费 RNTesterList 渲染页面

将 `src/index.tsx`（或 App 组件）改为消费 `RNTesterList` 渲染 Navigation 列表页，点击进入各 Demo 页面。

### 5.3 衔接约定

后续 Demo 生成步骤只需向 `RNTesterList` 数组追加 `{key, category, module}` 条目即完成注册，无需再改 App.tsx。
