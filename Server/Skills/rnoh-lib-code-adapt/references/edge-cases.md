# 常见边界情况

## 1. 跨大版本升级（如 0.72 → 0.84）

跨大版本升级涉及多个版本不兼容变更累积，风险较高：
- 先查阅 [上游社区不兼容变更](https://gitcode.com/CPF-RN/ohos_react_native/blob/main/docs/zh-cn/05-运维/上游社区不兼容变更.md)
- 分阶段升级（0.72→0.77→0.82→0.84），每阶段单独验证
- **禁止**直接跳过中间版本

## 2. Codegen 产物与手写代码冲突

某些鸿蒙化工程可能手写了部分 codegen 产物。重新 codegen 后会覆盖手写代码：
- codegen 前备份 `harmony/` 目录
- codegen 后对比差异，将手写的自定义逻辑合并回去

## 3. 鸿蒙化工程尚未适配目标 RNOH 版本

如果鸿蒙化仓库没有 `br_rnoh0.84` 分支：
- 使用已有最高版本分支作为起点
- 先完成 RN/RNOH 版本依赖升级（Step 2）
- 编译错误会暴露需要适配的接口变更
- 根据编译错误逆向推导适配方案

## 4. peer dependency 冲突

RN 0.84 要求 React 19.2.3，如果三方库依赖 React 18.x，会有 peer 冲突：
- 优先尝试 `--legacy-peer-deps`
- 如果三方库实际兼容 React 19，在 package.json 中覆盖 peerDependencies
- 如果确实不兼容，需要先升级三方库的 React 依赖

## 5. compileSdkVersion 与本地 SDK 不匹配

`build-profile.json5` 中指定的 `compileSdkVersion`（如 `5.0.1(13)`）如果本地未安装对应 SDK，hvigor 会报 `SDK component missing` 错误。

**解决方案**（按优先级）：
1. **移除 `compileSdkVersion` 字段**：让 hvigor 自动使用 DevEco Studio 内置 SDK（推荐）
2. **改为本地已安装的 SDK 版本**：通过 DevEco Studio > SDK Manager 查看
3. **下载对应 SDK**：通过 DevEco Studio > SDK Manager 安装

**注意**：`build-profile.json5` 和 `build-profile.template.json5` 都需要同步修改。

## 6. RNOH 框架内部编译警告

编译时 RNOH 框架自身代码会产生大量警告（如 `vp2px has been deprecated`、`API 'on' is supported since SDK version 15`），这些是**框架内部兼容性警告，不影响编译结果**，无需修复。只需关注自己库的代码是否有错误。

## 7. Codegen 与 Autolinking 的关系

| 维度 | Codegen | Autolinking |
|------|---------|-------------|
| **作用** | 从 JS spec 生成 C++/ArkTS 类型代码 | 将已生成的 Package 注册到工程 |
| **输出** | Props.h、ShadowNodes.h、JSIBinder.h 等 | 修改 RNPackagesFactory.ets、PackageProvider.cpp |
| **可替代** | ❌ 不可省略 | ✅ 可用 `auto-integrate.sh` 脚本替代手动注册 |

RNOH **没有** iOS/Android 那样的运行时自动发现机制。所谓 "autolinking" 仅指 `auto-integrate.sh` 脚本可以自动修改注册文件，但 codegen 仍需单独运行。

## 8. 源码 `file:` 依赖的 ArkTS 模块注册

鸿蒙化三方库通过 `file:` **源码目录**依赖引入 example 工程时，ohpm 创建**符号链接**指向源码目录，hvigor 无法识别，导致 `Path not found` 或 `Failed to resolve OhmUrl`。

> ✅ **推荐方案**：使用 **TGZ 包依赖**（`file:../xxx.tgz`）替代源码目录依赖（`file:../rntpc_xxx`）。tgz 安装后是实体文件而非符号链接，自动避免以下所有问题。打包流程见 SKILL.md Step 4b-4d。

**如果必须使用源码依赖**（如开发调试阶段），三步配合解决：
1. **`build-profile.json5` 注册库为独立模块**：`srcPath` 用相对路径直接指向源码目录（如 `../../harmony/xxx`），不用符号链接
2. **`RNPackagesFactory.ets` 用包根路径导入**：`import { XxxPackage } from '@react-native-ohos/xxx'`（❌ 深层路径 `.../src/main/ets/XxxPackage` 运行时找不到 record）
3. **保持库的 `index.ets` + `ts.ets` 原始结构**：`ts.ets` 不能改为 `.ts`（TS 文件不能导入 ArkTS），不能删除
