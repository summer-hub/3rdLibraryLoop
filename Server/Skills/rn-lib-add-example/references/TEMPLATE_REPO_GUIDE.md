# RN3rdTemplate 模板仓库指南

> 模板仓库地址：https://gitcode.com/lalhanOrz/RN3rdTemplate（git clone 默认分支 main）

## 仓库结构

```
RN3rdTemplate/
├── 0.77/                    # RNOH 0.77 完整模板工程
├── 0.82/                    # RNOH 0.82 完整模板工程
├── 0.84/                    # RNOH 0.84 完整模板工程
├── scripts/                 # 仓库自带集成脚本（auto-integrate.sh / add-library.sh / parse-library.py 等）
├── skills/                  # 相关技能目录
├── README.md
└── update-harmony-lib.md
```

## 版本对照表

| 属性 | 0.77 模板 | 0.82 模板 | 0.84 模板 |
|------|-----------|-----------|-----------|
| React Native | 0.77.1 | 0.82.1 | 0.84.1 |
| React | 18.3.1 | 19.1.1 | 19.2.3 |
| RNOH 核心（react-native-harmony） | 0.77.18-1 | 0.82.30 | 0.84.2 |
| compatibleSdkVersion | 5.0.0(12) | 5.0.0(12) | 5.0.0(12) |

**版本选择规则**：读取目标库 `package.json` 的 `dependencies`（或 devDependencies/peerDependencies）中 `@react-native-oh/react-native-harmony` / `react-native-harmony` / `react-native` 的版本号，取 `major.minor`（如 `0.82.30` → `0.82`）对应模板目录。无法推断时必须询问用户，禁止猜测。

**版本注意**：
- 不同版本的 HAR 不通用，必须使用对应版本的模板
- RNOH 0.82 的 `compatibleSdkVersion: '5.0.0(12)'` 可直接使用；**0.84 的 HAR 元数据要求最低 API 17**，使用 0.84 模板时需按知识库经验（`experiences/rnoh-example-template-compatiblesdkversion-upgrade`）升级 compatibleSdkVersion

## 模板目录内容（以 0.82 为例）

```
0.82/
├── app.json                          # RN 应用名（name/displayName）
├── package.json                      # name: react-native-harmony-tester
├── index.js                          # AppRegistry 入口（读 app.json 的 name）
├── metro.config.js / tsconfig.json   # RN 构建配置
├── src/index.tsx                     # App 根组件（Hello RNOH 占位）
├── scripts/create-build-profile.js   # postinstall：由 template 生成 build-profile.json5
└── harmony/
    ├── AppScope/app.json5            # bundleName / label（$string:app_name）
    ├── build-profile.template.json5  # 应用级构建配置模板（signingConfigs 为空）
    ├── entry/
    │   ├── oh-package.json5          # @rnoh/react-native-openharmony HAR（file:../../node_modules/...）
    │   ├── build-profile.json5       # entry 模块 native 编译配置
    │   └── src/main/
    │       ├── cpp/                  # CMakeLists.txt + PackageProvider.cpp
    │       ├── ets/
    │       │   ├── RNPackagesFactory.ets   # 三方库 ArkTS Package 注册（默认空）
    │       │   └── pages/Index.ets         # RN 页面加载（buildCustomRNComponent 默认空）
    │       ├── resources/base/element/string.json  # EntryAbility_label
    │       └── module.json5          # 权限（默认仅 INTERNET）、querySchemes（模板残留 weixin）
    └── oh-package.json5
```

## 手动拷贝步骤（脚本不可用时的替代流程）

1. `git clone --depth 1 https://gitcode.com/lalhanOrz/RN3rdTemplate.git <tmpDir>`
2. 复制 `<tmpDir>/<版本>/` 全部内容到 `<libRoot>/example/`（排除 `.git`、`.DS_Store`、`.npmrc`）
3. 删除 `<tmpDir>`，然后按 [APP_RENAME_GUIDE.md](APP_RENAME_GUIDE.md) 逐项修改 app 名称

## 模板 README 自带注意事项

1. `build-profile.template.json5` 中 `signingConfigs` 为空，未配置签名时产出 unsigned HAP 属预期，真机部署前需在 DevEco Studio 配置签名
2. 每次新增/修改三方库后需运行 `npm run codegen` 重新生成代码
3. 运行 Metro 前需执行 `hdc rport tcp:8081 tcp:8081` 端口转发
4. 仓库根 `scripts/` 提供库集成辅助脚本（auto-integrate.sh 等，Bash 脚本，仅类 Unix 环境可用），本 SKILL 优先使用自带跨平台脚本 `scripts/create-example.cjs`
