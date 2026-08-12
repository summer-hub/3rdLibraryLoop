# DevEco MCP 构建签名 HAP — 签名配置位置与构建监控经验

> 来源知识条目: kn_msovnm6rd46de72c
> 适用场景: 使用 DevEco MCP 工具（project_sync / build_project）对 HarmonyOS 工程执行同步、构建并生成签名 HAP

---

## 一、签名配置必须添加到工作区根目录的 build-profile.json5

### 问题现象
在 HarmonyOS 工程的子目录 `build-profile.json5`（如 `rntpc_react-native-pager-view/example/harmony/build-profile.json5`）中添加了 `signingConfigs` 配置后，执行 `deveco-mcp_build_project` 构建时，构建日志仍显示签名被跳过：

```
> hvigor WARN: Will skip sign 'hos_hap'. No signingConfigs profile is configured in current project.
             If needed, configure the signingConfigs in /Users/lalhan/Desktop/3rdLibraryLoop/build-profile.json5.
```

导致产物只有 `entry-default-unsigned.hap`，没有签名 HAP。

### 解决方案
将 `signingConfigs` 配置添加到**工作区根目录**的 `build-profile.json5`（即 DevEco Studio 打开的项目根目录下的文件），而非嵌套子项目中的同名文件。

DevEco MCP 的 `build_project` 和 `project_sync` 工具以工作区根目录为项目根，读取的是根级 `build-profile.json5`。

根级 `build-profile.json5` 通常包含以下关键字段：
- `app.products[].signingConfig` — 引用签名配置名
- `app.signingConfigs[]` — 签名配置数组（需在此处添加签名配置）
- `modules[].srcPath` — 指向实际 entry 模块路径

### 结果
签名配置被正确读取，构建任务执行 `SignHap`，产物目录下生成 `entry-default-signed.hap`（签名 HAP）。

> ⚠️ 注意：根级 `build-profile.json5` 可能使用带引号 key 的标准 JSON 格式，而项目级可能使用 JSON5 无引号 key 格式。两种格式均有效，添加配置时需按各自风格书写。

---

## 二、利用构建日志 WARN 消息定位签名配置文件

### 问题现象
不确定应该修改哪个 `build-profile.json5` 来添加签名配置时，容易修改错误的文件（子项目级而非根级），导致签名仍然被跳过。

### 解决方案
构建日志中的 WARN 消息会直接给出需要修改的文件路径：

```
If needed, configure the signingConfigs in /Users/lalhan/Desktop/3rdLibraryLoop/build-profile.json5.
```

遇到签名跳过问题时，首先检查构建日志中此 WARN 消息指向的 `build-profile.json5` 路径，在该文件中添加 `signingConfigs`。

### 结果
通过 WARN 消息可直接定位到正确的配置文件路径，避免修改错误文件，快速解决签名跳过问题。

---

## 三、MCP build_project clean=true 构建超时的监控策略

### 问题现象
调用 `deveco-mcp_build_project` 并设置 `clean=true`（全量清理重建）时，MCP 请求超时：

```
MCP error -32001: Request timed out
```

实际构建在后台继续运行，约 3.5 分钟后完成，但无法直接从 MCP 响应获取构建结果。

### 解决方案
MCP 超时后，通过以下策略监控构建进度并确认结果：

1. **监控产物目录**：用 `ls -la` 或 glob 工具检查 `entry/build/default/outputs/default/` 目录，等待 `entry-default-signed.hap` 文件出现。
2. **检查构建日志**：读取构建日志文件，确认出现 `BUILD SUCCESSFUL` 标记和 `SignHap` 任务完成。
3. **增量构建策略**：增量构建（不设置 clean）可在 MCP 超时内完成（约 2 秒），但**注意：增量构建无法触发重新签名**，如需重新签名必须 clean 构建。

### 结果
即使 MCP 请求超时，仍可通过监控产物目录和构建日志确认构建成功完成。

> ⚠️ 建议：如果修改了签名配置后需要验证签名生效，必须使用 clean=true 进行全量构建，并用监控策略等待完成。

---

## 四、验证签名成功的快速方法

### 问题现象
构建完成后，如何快速判断签名是否成功应用到 HAP 产物。

### 解决方案
通过以下两种方式快速验证：

1. **检查产物文件存在性**：检查 `entry/build/default/outputs/default/` 目录下是否同时存在 `entry-default-signed.hap` 和 `entry-default-unsigned.hap`。如果仅有 unsigned 版本，说明签名被跳过。
2. **比较文件大小**：签名 HAP 比未签名 HAP 大约 672KB（签名数据）：

| 文件 | 典型大小 | 差异 |
|------|----------|------|
| entry-default-unsigned.hap | ~72,585,629 bytes | 基准 |
| entry-default-signed.hap | ~73,257,238 bytes | +671,609 bytes（约 672KB 签名数据） |

### 结果
通过文件存在性和大小差异可快速判断签名是否成功应用，无需深入解析 HAP 内部结构。
