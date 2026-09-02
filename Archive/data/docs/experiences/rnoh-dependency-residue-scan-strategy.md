## RNOH 依赖残留分层判定与大仓库扫描安全策略

### 问题现象
1. 三方库升级后扫描"旧版本依赖残留"时，`grep -rn '"pkg": "0.82...' example packages` 在含 node_modules（example npm install 后数百 MB）的仓库上 120s 超时被强制终止。
2. 扫描发现 devDependencies 中存在旧版本工具链（如 `@react-native/eslint-config: 0.82.0`）时，直接判"核验失败"或隐藏不报都是错误处置。

### 解决方案
**扫描执行安全**（解决超时与误报）：
- 用 `rg` 替代 `grep` 全量扫描，并叠加排除参数：`-g '!node_modules' -g '!oh_modules' -g '!package-lock.json' -g '!*.har' -g '!*.hap' -g '!\.git'`
- 只扫依赖清单白名单文件：根/example 的 package.json、oh-package.json5、nitro.json、overrides/resolutions
- 只匹配 RNOH 框架相关包名的版本号模式（react-native / react-native-harmony / @rnoh/react-native-openharmony / nitro-modules / harmony-cli）

**残留分层判定**（二分法）：
- **框架/运行时/编译链依赖（阻断项）**：属于 RNOH 框架依赖、参与编译链（HAR→tgz→codegen→JS Bundle→ohpm→devecocli build）或参与运行时的旧版本引用 → 判核验失败；
- **开发工具依赖滞后（记录项）**：如 ESLint 配置等代码风格工具，不参与编译链与运行时 → 非阻断。定性时做三对照：上游基线版本（diff-output 中上游 package.json）+ example 侧同款版本 + 编译链涉及范围。

### 结果
实测 30s 内完成扫描、零误报；`@react-native/eslint-config: 0.82.0` 判定为低风险 devDep 遗留（上游 4.3.2 基线用 0.85.3，example 侧同款已升 0.84.1）。处置原则：如实写入核验记录"遗留记录"节 + 给出风险定性（低风险）+ 不阻断验收。隐藏不报或直接判失败都是错误的。