## RNOH TurboModule 库 example 壳层适配清单与渐进式验证链

### 问题现象

基于 RNOH 模板为 TurboModule 三方库创建 example 壳层工程时，模板不能直接编译目标库，需适配多个 JS/Harmony 侧文件；且一次性做鸿蒙编译排查问题成本高。

### 解决方案

**壳层适配必查清单**（已在 sqlite-storage 库全量验证）：

| 文件 | 适配内容 |
|------|----------|
| `harmony/entry/oh-package.json5` | 库 HAR 走 `file:../../node_modules/{ohPkg}/harmony/{module}.har` |
| `harmony/entry/src/main/cpp/CMakeLists.txt` | `add_subdirectory` 指向 **node_modules**（严禁 oh_modules，HAR 无 cpp 源码）：`${NODE_MODULES}/{ohPkg}/{sourceModulePath}/src/main/cpp` |
| `harmony/entry/src/main/cpp/PackageProvider.cpp` | include + make_shared `<cppPackageClassName>` |
| `harmony/entry/src/main/ets/RNPackagesFactory.ets` | import 自 `<ohPkg>/ts`，new `<etsPackageClassName>`(ctx) |
| `harmony/entry/src/main/ets/pages/Index.ets` | 纯 TurboModule 库：buildCustomRNComponent 保持空、arkTsComponentNames 为空数组 |
| `harmony/build-profile.template.json5` | modules 追加库源码模块 `{name: '{harmonyModuleName}', srcPath: '../../harmony/{module}'}`；删除 `useNormalizedOHMUrl`；改 template 而非 build-profile.json5（postinstall 会覆盖） |
| `module.json5` | 权限最小化（如 sqlite 仅 INTERNET；模板残留的 CAMERA/MICROPHONE 应删除） |
| `metro.config.js` / `tsconfig.json` | `<alias>` → `node_modules/<ohPkg>` 映射 |

**渐进式验证链**（全部通过的标准动作）：

```
1. cd example && npm install --legacy-peer-deps        # postinstall 生成 build-profile.json5
2. npm run dev                                          # codegen + bundle-harmony → rawfile/bundle.harmony.js
3. cd harmony && ohpm install --all                     # HAR 从 node_modules 经 file: 解析
4. hvigorw assembleHap --no-daemon                      # CMake/Ninja + HAP 打包
5. nm -gU .../librnoh_app.so | grep <cppPackageClassName>  # 确认库 C++ 包符号已链入
```

### 结果

全链路 BUILD SUCCESSFUL。要点：

- 第 2 步（npm run dev）就能暴露 alias/依赖问题，**成本最低，不要跳过直接做鸿蒙编译**
- bundle 产物可 grep 校验：应含 Demo 特征字符串（如 `smoke_test.db`）、不应含模板残留（如 `camera`）
- 未配置 signingConfigs 时产出 **unsigned HAP 属预期**（模板不携带签名证书），不是构建失败；真机部署前在 build-profile.json5 补签名即可
- hvigor 调用方式：`/Applications/DevEco-Studio.app/Contents/tools/node/bin/node /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js assembleHap --no-daemon`（用 DevEco 自带 node）
- RNOH **0.82** 的 `compatibleSdkVersion: '5.0.0(12)'` 可直接使用；知识库中"必须升级 API 17"的经验仅适用于 0.84
- 创建 example 前先读库元数据（package.json 的 harmony.autolinking 字段），所有壳层文件的类名/路径/链接目标均由它派生，不要手抄