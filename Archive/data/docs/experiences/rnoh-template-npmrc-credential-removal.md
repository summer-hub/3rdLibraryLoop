## RNOH 模板拷贝后必须立即删除含凭据的 .npmrc

### 问题现象

从模板创建 RNOH example 工程时，模板目录可能自带 `.npmrc`，其中内嵌私有 registry（如 swmansion）的 GitHub PAT **明文 `_authToken`**，且拷贝脚本默认不排除该文件，凭据会随交付物扩散。

### 解决方案

1. 拷贝模板后**第一件事**：检查并删除 `.npmrc`
2. RNOH 0.82 全部依赖（`@react-native-oh/react-native-harmony` 0.82.30+ 等）可从公共 registry（npmmirror）解析，无需私有源
3. 建议拷贝模板脚本显式排除 `.npmrc`；若需保留 registry 配置，改用不含 token 的镜像地址

### 结果

交付物中无凭据泄露。**任何含凭据的文件（.npmrc token、签名私钥等）严禁带入交付物**。