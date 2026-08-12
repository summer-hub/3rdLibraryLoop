## HarmonyOS 签名配置与已签名 HAP 构建经验

> 来源：rntpc_react-native-netinfo (0.84) signingConfigs 配置与已签名 HAP 构建任务

---

### 问题现象一：devecocli signature generate 无法自动生成签名

执行 `devecocli signature generate --force` 时报错：
```
Failed to automatically generate signatures. Run devecocli auth login to sign in.
```

影响场景：CI/CD 环境、无华为账号的开发环境、自动化脚本。

### 解决方案

`devecocli signature generate` 需要先登录华为账号（`devecocli auth login`）。未登录时不可用。

替代方案：手动配置 `build-profile.json5` 中的 `signingConfigs`，复用本机已有的 DevEco Studio 签名材料。查找流程：
1. 检查 `~/.ohos/config/` 目录中是否有匹配当前 bundleName 的签名材料
2. 在其他成功构建的项目中查找相同 bundleName 的 build-profile.json5 配置
3. 直接复用该配置中的 signingConfigs

### 结果

成功通过手动复用签名材料完成签名配置，无需华为账号登录。

---

### 问题现象二：签名材料的复用约束不明确

不同项目间复用 HarmonyOS 签名材料（.p12/.cer/.p7b）时，不清楚哪些可以复用、哪些不能。

### 解决方案

签名材料复用关键约束：

| 约束维度 | 说明 |
|---------|------|
| **bundleName** | .p7b Profile 文件与 bundleName 绑定，不同 bundleName 不能复用同一 .p7b |
| **机器绑定** | DevEco Studio 生成的加密密码（storePassword/keyPassword）与机器绑定，同一机器不同项目可复用 |
| **runtimeOS** | type 必须匹配（HarmonyOS vs OpenHarmony） |

实践验证：bundleName 相同的项目可成功复用签名材料（包括加密密码），在 `SignHap` 步骤一次性通过。

### 结果

明确了签名材料复用规则，bundleName 相同的项目间可安全复用全部签名材料。

---

### 问题现象三：signingConfigs 配置结构参考

需要手动填充 build-profile.json5 中空的 signingConfigs 数组。

### 解决方案

signingConfigs 配置结构：

```json5
signingConfigs: [
  {
    name: 'default',           // 必须与 products[].signingConfig 一致
    type: 'HarmonyOS',         // 或 'OpenHarmony'
    material: {
      storeFile: '...p12',     // 密钥库文件
      storePassword: '...',    // 密钥库密码（明文或DevEco加密格式）
      keyAlias: 'debugKey',    // 密钥别名
      keyPassword: '...',      // 密钥密码（明文或DevEco加密格式）
      certpath: '...cer',      // 证书文件
      profile: '...p7b',       // Profile 文件（bundleName 绑定）
      signAlg: 'SHA256withECDSA',  // 签名算法
    },
  },
]
```

加密密码格式识别：DevEco Studio 生成的加密密码以 `0000001B` 开头，十六进制格式。明文密码也可直接使用。两种格式在 build-profile.json5 中都有效。

### 结果

成功填充 signingConfigs 数组，name 与 products[].signingConfig 一致，构建时签名步骤通过。

---

### 问题现象四：如何验证已签名 HAP 构建成功

构建完成后不确定签名是否成功。

### 解决方案

已签名 HAP 位于：
```
entry/build/default/outputs/default/entry-default-signed.hap
```

与未签名的对比：
- `entry-default-unsigned.hap` — 打包后未签名
- `entry-default-signed.hap` — 签名后（比未签名大约 650KB，为签名块）

构建日志中 `SignHap` 步骤成功即表示签名完成。确认文件大小 > 0。

### 结果

通过检查 entry-default-signed.hap 文件存在且大小 > 0，确认签名构建成功。

---

### 问题现象五：MCP build_project 工具构建超时

调用 `deveco-mcp_build_project` 时超时（Request timed out），首次构建（含 clean）耗时较长超过 MCP 工具默认超时时间。

### 解决方案

改为直接使用 hvigorw 命令行构建，设置 300s 超时：

```bash
/Applications/DevEco-Studio.app/contents/tools/node/bin/node \
  /Applications/DevEco-Studio.app/contents/tools/hvigor/bin/hvigorw.js \
  --mode module -p module=entry@default assembleHap -p buildMode=debug --no-daemon
```

注意：`hvigorw.js` 是 JS 文件，必须用 node 执行，不能直接作为 shell 脚本运行。

### 结果

通过 hvigorw 命令行直接构建成功绕过 MCP 工具超时限制，完成首次 clean build。对于首次 clean build 或大型项目，优先使用 hvigorw 命令行直接构建。