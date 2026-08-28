# 渐进式验证指南

> example 工程创建完成后的标准验证链。按顺序执行，前一步失败先修复再继续——每一步暴露的问题层次不同，越早暴露成本越低。

## 验证链（全部通过的标准动作）

```
1. cd example && npm install --legacy-peer-deps        # postinstall 生成 build-profile.json5
2. npm run dev                                          # codegen + bundle-harmony → rawfile/bundle.harmony.js
3. cd harmony && ohpm install --all                     # HAR 从 node_modules 经 file: 解析
4. hvigorw assembleHap --no-daemon                      # CMake/Ninja + HAP 打包
5. nm -gU .../librnoh_app.so | grep <cppPackageClassName>  # 确认库 C++ 包符号已链入（纯 ETS 库跳过）
```

## 各步骤要点

| 步骤 | 验证内容 | 要点 |
|------|----------|------|
| 1. npm install | 依赖解析 | 若依赖是本地库 tgz，确认 node_modules 中为实体目录非符号链接 |
| 2. npm run dev | JS 依赖/alias/bundle | **成本最低，能暴露 alias/依赖问题，不要跳过直接做鸿蒙编译**。产物 `rawfile/bundle.harmony.js` 可 grep 校验：应含 Demo 特征字符串（如 `smoke_test.db`），不应含模板残留（如 `camera`） |
| 3. ohpm install | HAR 解析 | `--all` 会同时在库源码模块内产生 oh_modules（库根 .gitignore 需覆盖） |
| 4. hvigorw assembleHap | 原生编译 + 打包 | 未配置 signingConfigs 时产出 **unsigned HAP 属预期**，不是构建失败 |
| 5. nm 符号检查 | C++ 链接 | `nm -gU {example}/harmony/entry/build/default/intermediates/libs/default/arm64-v8a/librnoh_app.so \| grep {cppPackageClassName}` |

**hvigor 调用方式**（用 DevEco 自带 node）：

```bash
/Applications/DevEco-Studio.app/Contents/tools/node/bin/node \
  /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js assembleHap --no-daemon
```

**SDK 版本注意**：
- RNOH **0.82** 模板的 `compatibleSdkVersion: '5.0.0(12)'` 可直接使用
- RNOH **0.84** 的 HAR 要求最低 API 17，需升级 compatibleSdkVersion（详见知识库 `experiences/rnoh-example-template-compatiblesdkversion-upgrade`）

**真机部署**：模板不携带签名证书，部署前在 `build-profile.json5` 补 signingConfigs（postinstall 保留已有签名配置）。运行 Metro 前需 `hdc rport tcp:8081 tcp:8081`。

## 常见故障排查

| 现象 | 根因 | 解决 |
|------|------|------|
| `Unable to resolve module @react-native-ohos/...` | 库依赖用了 `file:../目录`，node_modules 中为符号链接 | 改用 `npm pack` tgz + `file:../xxx.tgz`，删旧链接重装 |
| `TreeFS: Could not add directory node_modules/... already exists in the file map as a file` | node_modules 布局变更后 Metro/watchman 缓存污染 | `rm -rf node_modules/.cache && watchman watch-del-all` 后重跑 |
| `add_subdirectory given source ".../oh_modules/.../src/main/cpp" which is not an existing directory` | CMake 路径误用 oh_modules（HAR 内无 cpp 源码） | 改为 `${NODE_MODULES}/{ohPackageName}/{sourceModulePath}/src/main/cpp` |
| hvigor 报 entry 模块缺 build-profile | `harmony/entry/build-profile.json5` 缺失 | postinstall 会从 template 恢复；确认 `npm install` 已执行 |
| 构建产物含模板残留字符串 | 旧 demo/依赖未清理 | 清理 src 下旧目录、移除模板库依赖后重跑 `npm run dev` |
| bundle 中找不到库代码 | metro alias 未配置 | `metro.config.js` / `tsconfig.json` 补 `{alias}` → `node_modules/{ohPackageName}` 映射 |
