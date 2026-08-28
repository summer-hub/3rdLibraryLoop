## RNOH example 本地库依赖必须用 npm pack tgz，禁止 file: 目录形式

### 问题现象

为 RN 鸿蒙三方库创建 example 工程时，在 `example/package.json` 中用目录形式的本地依赖（如 `"@react-native-ohos/xxx": "file:.."` 指向库根目录），`npm install` 后 node_modules 中该包为**符号链接**（`lrwxr-xr-x ... -> ../../..`，链接目标在 example 工程目录之外）。执行 `npm run dev` 报错：

```
Unable to resolve module @react-native-ohos/... could not be found within the project
```

原因：npm（实测 11.6.2）对目录型 `file:` 依赖默认以 symlink 方式安装，Metro/watchman 文件解析不跟随工程目录外的符号链接。

### 解决方案

1. 库根先在 `.npmignore` 中排除 `example`（否则整个 example 工程会被打进库包）
2. 库根执行 `npm pack` 生成 `react-native-ohos-{包名去scope横线}-{版本}.tgz`
3. example 依赖改为 `file:../{tgz文件名}`（如 `"file:../react-native-ohos-netinfo-12.0.1.tgz"`）
4. 删除 node_modules 中旧符号链接后重新 `npm install` → node_modules 中变为实体目录

同步的库根工程卫生：
- `.gitignore` 追加 `harmony/{module}/oh_modules`、`harmony/{module}/oh-package-lock.json5`（ohpm --all 会在库源码模块内产生构建产物）
- tgz 产物留在库根是 CPF-RN 系列仓库（netinfo、async-storage 等）的既定惯例

### 结果

node_modules 中库包为实体目录，Metro 解析正常，`npm run dev` 与鸿蒙编译全链路通过。CPF-RN 系列仓库的 example 均采用 tgz 方式，这是既定惯例，不要用 `file:..` 目录形式。

---

### 补充：node_modules 布局变更后必须清 Metro/watchman 缓存

### 问题现象

将 symlink 依赖替换为实体 tgz 目录后重跑构建，报错：

```
TreeFS: Could not add directory node_modules/@react-native-ohos/xxx ... already exists in the file map as a file
```

原因：Metro 文件映射缓存仍记录旧路径（该路径曾被记录为文件）。

### 解决方案

```bash
rm -rf node_modules/.cache
watchman watch-del-all
```

（或至少 `watchman watch-del` 当前工程）后重跑构建。

### 结果

构建成功。经验法则：**任何 node_modules 结构调整（symlink↔实体、删除重装）后都要清缓存再构建**。