# HAR 与 TGZ 打包流程

本文档详细说明 RN 鸿蒙三方库适配完成后的打包流程：先打 HAR 包，再打 TGZ 包，最终 RN 工程以本地 tgz 包依赖进行编译验证。

## 流程总览

```
代码适配完成
    │
    ▼
Step A: 单文件语法检查（devecocli check lint）
    │
    ▼
Step B: 打 HAR 包（rnoh-build-har）
    │      → 产出 harmony/<module>.har
    ▼
Step C: 打 TGZ 包（npm pack）
    │      → 产出 <package-name>-<version>.tgz
    ▼
Step D: RN 工程依赖本地 TGZ 包
    │      → example/package.json 中 "file:../xxx.tgz"
    ▼
Step E: 最终编译验证（依赖 tgz 包构建 example）
         → devecocli build 通过即验证完成
```

> ⚠️ **核心原则**：最终编译验证必须依赖 TGZ 包，不能依赖源码 `file:` 目录引用，也不能跳过 HAR 打包直接编译。TGZ 包是最终交付物，只有 TGZ 包能验证完整的产物结构正确性。

---

## Step A: 单文件语法检查

在打包之前，先对修改过的 `.ets`/`.cpp` 文件进行快速语法检查，避免打包过程中才发现低级语法错误。

```bash
# 检查修改过的 ArkTS 文件
devecocli check lint harmony/src/main/ets/XxxModule.ets
devecocli check lint harmony/src/main/ets/XxxPackage.ets

# 检查修改过的 C++ 文件
devecocli check lint harmony/src/main/cpp/XxxComponent.cpp

# 或批量检查整个目录
devecocli check lint harmony/src/main/ets/
```

确认无 ERROR 级别问题后，进入 Step B。

> 也可使用 MCP `check` 工具传入文件路径列表进行结构化诊断。

---

## Step B: 打 HAR 包

使用 **`rnoh-build-har`** 工具自动构建鸿蒙 HAR 模块。

### 工具简介

- **仓库**：https://gitcode.com/lalhanOrz/rntpc_buildhar
- **npm 包名**：`rnoh-build-har`
- **功能**：自动创建临时壳工程 → 配置工程级文件 → 调用 `devecocli build` 构建 → 校验产物 → 拷贝 HAR → 清理临时文件
- **跨平台**：macOS / Windows / Linux，纯 Node.js 实现，无需 bash/find/rsync

### 安装

```bash
# 全局安装
npm install -g rnoh-build-har

# 或 npx 直接运行（无需安装）
npx rnoh-build-har <args>
```

### 前置要求

| 要求 | 必需 | 说明 |
|------|------|------|
| Node.js ≥ 18 | ✅ | 运行时 |
| devecocli | ✅ | DevEco Studio 自带，或 `npm install -g @deveco/deveco-cli@latest` |
| DevEco SDK | ✅ | 通过 DevEco Studio 安装 |

### 用法

```bash
# 用法格式
rnoh-build-har [api-version] [version] [path] [--module-name <name>] [--build-mode <mode>]

# 参数说明：
#   api-version     HarmonyOS API 版本号（纯整数，如 12, 16）
#                   映射到 compatibleSdkVersion: 12→'5.0.0(12)', 16→'5.0.4(16)'
#   version         RNOH ohpm 版本号（含小数点，如 0.82.18）
#                   指定后从 ohpm 拉取 RNOH，而非使用本地 HAR
#   path            RN 库根目录（harmony/ 应在其内部）
#                   省略时自动检测当前目录及子目录
#   --module-name   HAR 模块名，省略时自动检测
#   --build-mode    构建模式：release（默认）或 debug
#   --help          显示帮助
```

参数按格式自动识别：
- 纯整数（如 `12`、`16`）→ API 版本
- 含小数点（如 `0.82.18`）→ RNOH ohpm 版本
- 其他非 flag 参数 → 库路径

### API 版本对应表

| API 版本 | compatibleSdkVersion | API 版本 | compatibleSdkVersion |
|---------|---------------------|---------|---------------------|
| 12 | 5.0.0(12) | 18 | 5.1.0(18) |
| 13 | 5.0.1(13) | 19 | 5.1.1(19) |
| 14 | 5.0.2(14) | 20 | 6.0.0(20) |
| 15 | 5.0.3(15) | 21 | 6.0.1(21) |
| 16 | 5.0.4(16) | 22 | 6.0.2(22) |
| 17 | 5.0.5(17) | 23 | 6.1.0(23) |
|  |  | 24 | 6.1.1(24) |

> 数据来源：[HarmonyOS 版本说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-releases/overview-allversion)
> 如果 `harmony/build-profile.json5` 已存在，将保留原有配置，不覆盖 `compatibleSdkVersion`。

### RNOH 版本与 API 版本选择

| RNOH 版本 | 推荐 API 版本 | 说明 |
|-----------|-------------|------|
| 0.72 | 12+ | API 12 |
| 0.77 | 12+ | API 12 |
| 0.82 | 12+ | API 12 |
| 0.84 | 12+ | API 12 |

### 常用示例

```bash
# 自动检测当前目录或子目录中的 harmony/
rnoh-build-har

# 指定库路径
rnoh-build-har rntpc_react-native-netinfo

# 指定 API 版本 + 库路径（使用本地 HAR）
rnoh-build-har 12 rntpc_react-native-netinfo

# 使用 ohpm 版本号替代本地 HAR（无需先 npm install）
rnoh-build-har 0.82.18 rntpc_react-native-permissions

# 指定 API 版本 + ohpm 版本 + 路径
rnoh-build-har 12 0.84.2 rntpc_react-native-permissions

# 指定模块名 + debug 模式
rnoh-build-har --module-name mylib --build-mode debug
```

### 工作流程（工具内部）

1. 定位 `harmony/` 目录和 HAR 模块
2. 检测是否依赖 `@rnoh/react-native-openharmony`
3. 搜索 `react_native_openharmony.har`（本地或 ohpm 版本）
4. 写入临时工程级配置文件（`build-profile.json5` 等）
5. 执行 `devecocli build --modules <name> --build-mode <mode>`
6. 校验产物格式（gzip tar，无 AppleDouble 文件）
7. 补全 cpp 源码（如果 devecocli 未打包 CMakeLists.txt）
8. 拷贝产物到 `harmony/<module>.har`
9. 清理所有临时文件和构建缓存

### 产物

```
harmony/<module-name>.har   # gzip tar 格式，含 cpp 源码
```

### 编程式 API

```javascript
import { buildHar } from 'rnoh-build-har';

await buildHar({
  libPath: '/path/to/react-native-xxx',
  buildMode: 'release',
  // rnohVersion: '0.82.18',  // 可选：使用 ohpm 版本
  // apiVersion: 12,          // 可选：HarmonyOS API 版本（12-24）
  // moduleName: 'mylib',     // 可选：自动检测
});
```

### 常见问题

#### HAR 构建失败：SDK 版本不匹配

如果 `harmony/build-profile.json5` 中 `compileSdkVersion` 指定的 SDK 本地未安装：

- `rnoh-build-har` 会自动处理临时工程配置，但库自身的 `build-profile.json5` 可能保留旧 `compileSdkVersion`
- 解决：移除库 `build-profile.json5` 中的 `compileSdkVersion` 字段，让 hvigor 自动选择
- 或通过 `api-version` 参数指定正确的 API 版本

#### HAR 构建失败：ohpm 依赖未安装

`rnoh-build-har` 需要本地有 `react_native_openharmony.har`：
- 如果 RNOH 框架通过 npm 安装（`@react-native-oh/react-native-harmony`），HAR 文件在 `node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har`
- 如果使用 `rnohVersion` 参数，工具会从 ohpm 自动拉取

#### 产物路径

HAR 文件产出在库根目录的 `harmony/<module-name>.har`，例如：
```
rntpc_react-native-netinfo/
├── harmony/
│   └── netinfo.har    ← 构建产物
├── src/
└── package.json
```

---

## Step C: 打 TGZ 包

HAR 包构建成功后，打 npm TGZ 包。TGZ 包是最终交付物，包含 JS 代码 + HAR 包 + package.json 配置。

### 前提条件

1. **HAR 包已就绪**：`harmony/<module>.har` 文件存在（Step B 产出）
2. **package.json 中 files 字段包含 HAR**：确保 `npm pack` 能将 HAR 打入 tgz

### 检查 package.json files 配置

```bash
# 查看当前 package.json 的 files 字段
cat package.json | grep -A 10 '"files"'
```

确保 `files` 字段包含 `harmony/` 或具体的 `.har` 文件路径：

```json
{
  "files": [
    "src",
    "harmony",
    "README.md"
  ]
}
```

> 如果 `files` 字段缺失或不含 `harmony/`，`npm pack` 不会包含 HAR 文件，导致 tgz 包不完整。

### 打包命令

```bash
# 在库根目录执行
cd /path/to/react-native-xxx

# 打包（生成 <name>-<version>.tgz）
npm pack

# 输出示例：
# npm notice
# npm notice 📦  @react-native-ohos/react-native-xxx@7.2.7-rc.6
# npm notice === Tarball Contents ===
# npm notice 12.0kB  src/index.js
# npm notice 5.2MB    harmony/xxx.har
# npm notice 1.0kB    package.json
# npm notice 5.0kB    README.md
# npm notice === Tarball Details ===
# npm notice name:     @react-native-ohos/react-native-xxx
# npm notice version:  7.2.7-rc.6
# npm notice filename: react-native-ohos-react-native-xxx-7.2.7-rc.6.tgz
# npm notice package size:  5.2 MB
```

### 验证 tgz 内容

```bash
# 查看 tgz 包含的文件列表
npm pack --dry-run

# 或手动解压检查
tar -tzf react-native-ohos-react-native-xxx-*.tgz | grep '\.har$'
# 应看到 harmony/xxx.har
```

### 产物

```
react-native-ohos-react-native-xxx-<version>.tgz
```

文件名格式：`<scope>-<name>-<version>.tgz`（scope 中的 `@` 和 `/` 转为 `-`）

---

## Step D: RN 工程依赖本地 TGZ 包

将 example 工程的依赖方式改为本地 tgz 包引用。

### 获取 example 模板工程

如果库根目录下没有 `example/` 目录（部分三方库仓库不包含 example 工程），需要先创建。从 RN3rdTemplate 模板仓库浅拷贝获取 0.84 版本的 example 模板：

```bash
# 在库根目录执行
# 浅拷贝模板仓库（仅最新一次提交，下载快）
git clone --depth 1 https://gitcode.com/lalhanOrz/RN3rdTemplate.git tmp-template

# 拷贝 0.84 目录作为 example
# 模板仓库结构: RN3rdTemplate/0.84/ (含 package.json, harmony/, 等)
cp -r tmp-template/0.84 example

# 清理临时目录
rm -rf tmp-template
```

模板仓库说明：

- **仓库地址**：https://gitcode.com/lalhanOrz/RN3rdTemplate/tree/main/0.84
- **内容**：RNOH 0.84 版本的标准 example 工程模板，包含 `package.json`、`harmony/` 目录、基础配置文件等
- **`--depth 1`**：仅克隆最新一次提交，避免下载完整历史，加快速度
- **拷贝后**：`example/` 目录可直接用于 4d 步骤的 tgz 依赖配置和 4e 的编译验证

> ⚠️ 模板工程是通用的 0.84 example 骨架，拷贝后需要根据实际库修改 `package.json` 中的依赖名称和版本，以及 `harmony/` 下的注册文件（`RNPackagesFactory.ets`、`PackageProvider.cpp` 等）。可使用 `./scripts/auto-integrate.sh` 自动完成注册。

### 修改 example/package.json

```json
{
  "dependencies": {
    "@react-native-ohos/react-native-xxx": "file:../react-native-ohos-react-native-xxx-7.2.7-rc.6.tgz"
  }
}
```

> **关键**：使用 `file:` 引用 tgz 文件路径（相对路径），不是 `file:` 引用源码目录。

### 从源码依赖迁移到 tgz 依赖

如果原来使用源码目录引用：

```json
// 旧方式（源码目录引用）
"@react-native-ohos/react-native-xxx": "file:../rntpc_react-native-xxx"

// 新方式（tgz 包引用）
"@react-native-ohos/react-native-xxx": "file:../react-native-ohos-react-native-xxx-7.2.7-rc.6.tgz"
```

### 安装依赖

```bash
cd example

# 删除旧依赖（如果从源码引用迁移）
rm -rf node_modules/@react-native-ohos/react-native-xxx

# 安装 tgz 包
npm install --legacy-peer-deps

# 验证安装
ls node_modules/@react-native-ohos/react-native-xxx/harmony/
# 应看到 xxx.har 文件
```

### 验证 tgz 依赖正确安装

```bash
# 检查 node_modules 中的库是否包含 HAR
ls node_modules/@react-native-ohos/react-native-xxx/harmony/*.har

# 检查 package.json 解析后的依赖路径
cat node_modules/@react-native-ohos/react-native-xxx/package.json | grep version
```

---

## Step E: 最终编译验证

以 tgz 包依赖方式构建 example 工程，验证完整的产物结构正确性。

### 编译验证流程

```bash
# 1. 安装 JS 依赖（含 tgz 包）
cd example && npm install --legacy-peer-deps

# 2. 重新生成 codegen 代码
npm run codegen

# 3. 构建 JS Bundle
npm run dev

# 4. 安装鸿蒙原生依赖（关键步骤！不可跳过）
cd harmony && ohpm install

# 5. 构建鸿蒙原生工程
devecocli build --product default --build-mode debug
```

### ⚠️ ohpm install 不可跳过

`ohpm install` 将 `oh-package.json5` 中声明的 har 包安装到 `oh_modules/`。RNOH 框架的 har 包中包含 C++ 源码，CMake 编译时需要从 `oh_modules/@rnoh/react-native-openharmony/src/main/cpp/` 读取。跳过会导致 `CMake Error: not an existing directory`。

### oh-package.json5 中的 HAR 引用

确保 `example/harmony/oh-package.json5` 正确引用 tgz 包中的 HAR 文件：

```json5
// example/harmony/oh-package.json5 (根)
{
  "overrides": {
    "@rnoh/react-native-openharmony": "file:./../node_modules/@react-native-ohos/react-native-harmony/react_native_openharmony.har"
  }
}

// example/harmony/entry/oh-package.json5
{
  "dependencies": {
    "@rnoh/react-native-openharmony": "file:../../node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har"
  }
}
```

> tgz 包安装后，HAR 文件路径为 `node_modules/@react-native-ohos/react-native-xxx/harmony/xxx.har`。如果库自身有 oh-package.json5 引用，路径也需要对应更新。

### devecocli 不可用时回退

```bash
# macOS DevEco Studio 内置工具路径
HVIGORW="/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw"
OHPM="/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm"

cd example/harmony
"$OHPM" install
"$HVIGORW" assembleHap --no-daemon --mode module -p product=default
```

### 验证通过标准

| 验证项 | 通过标准 |
|--------|---------|
| `npm pack --dry-run` | tgz 包含 `.har` 文件 |
| `npm install` | tgz 包正确安装到 node_modules |
| `ohpm install` | oh_modules 中有 RNOH har 包 |
| `devecocli build` | `BUILD SUCCESSFUL`，仅框架内部 WARNING |
| 产物 hap | `entry/build/default/outputs/default/entry-default-signed.hap` 存在 |

---

## 渐进式验证策略

如果一次性验证失败难以定位，可分步验证：

1. **npm install 通过** — 确认 tgz 包能正确安装
2. **npm run codegen 通过** — 确认 spec 文件正确
3. **npm run dev 通过** — 确认 JS Bundle 构建成功
4. **ohpm install 通过** — 确认 har 包正确安装到 oh_modules
5. **devecocli build 通过** — 确认原生编译成功

每步通过后再进入下一步，便于定位问题。

---

## 完整示例：从适配完成到验证通过

```bash
# ── 前提：代码适配已完成 ──

# Step A: 语法检查
devecocli check lint harmony/src/main/ets/
devecocli check lint harmony/src/main/cpp/

# Step B: 打 HAR 包
cd /path/to/rntpc_react-native-xxx
rnoh-build-har 12 0.84.2 .   # API 12 + RNOH 0.84.2 + 当前目录
# 产出: harmony/xxx.har

# Step C: 打 TGZ 包
npm pack
# 产出: react-native-ohos-react-native-xxx-7.2.7-rc.6.tgz

# Step D: RN 工程依赖 tgz 包
cd example
# 编辑 package.json: "@react-native-ohos/react-native-xxx": "file:../react-native-ohos-react-native-xxx-7.2.7-rc.6.tgz"
rm -rf node_modules/@react-native-ohos/react-native-xxx
npm install --legacy-peer-deps

# Step E: 最终编译验证
npm run codegen
npm run dev
cd harmony && ohpm install
devecocli build --product default --build-mode debug
# ✅ BUILD SUCCESSFUL
```
