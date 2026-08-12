# RNOH 应用部署验证与 hilog 日志分析经验

## RNOH 应用 Error 级日志噪音白名单

### 问题现象
RNOH (React Native OpenHarmony) 应用在正常启动运行时，会产生大量 Error 级别的 hilog 日志。仅凭 Error 级日志数量判断应用状态会导致误判，将框架层面的预期行为误读为应用崩溃。

### 解决方案
以下 Tag 的 Error 日志均为非致命的框架噪音，可列入白名单：

| 来源 Tag | 日志内容 | 实际含义 |
|---------|---------|---------|
| `RNOH_CPP` | `Couldn't provide turbo module "RedBox"/"SoundManager"/"IntentAndroid"/"FrameRateLogger"` | 应用未集成这些可选 TurboModule，RNOH 尝试加载已注册名称但找不到。框架设计行为，不影响功能。 |
| `RNOH_ARK` (DisplayMetricsManager) | `Failed to get customDensity` / `Failed to get maxFontScale` / `Failed to get window decor height` | 设备不支持该能力查询，降级处理。 |
| `RNOH_ARK` (DevMenu) | `Shake to open Dev Menu is disabled` + `permission.ACCELEROMETER` 缺失 | 摇一摇 DevMenu 被禁用，需在 module.json5 添加加速度计权限才能用，但不影响应用运行。 |
| `JSPackagerClient` / `ArkCompiler` | `Websocket connection failed` / `Decode failed, client websocket disconnect` | debug 构建尝试连接 Metro bundler 但未运行。应用使用预打包 JS 继续。 |
| `NETSTACK` | `lws_service stop`（重复） / `CURLcode result 7` / `epoll wait event 0 err: 111` | 对于 netinfo 等网络探测应用，这些是正常工作行为（检测网络是否可用），而非 Bug。 |
| `WMSDecor` | `GetDecorVisible: device not support` | 设备不支持窗口装饰功能。 |
| `Text` / `FontConfig` | `GetFileData: Path or realPath is nullptr` / `CheckConfigFile: Null data` | 字体配置缺失，使用默认字体。 |
| `PARAM_WATCHER` | `Failed to add watcher for persist.rosen.animationtrace.enabled` | 系统参数监听失败，系统级。 |

### 结果
在自动化部署验证流程中，将上述噪音日志 Tag 列入白名单可避免误报。NETSTACK 类日志需结合应用类型判断——网络探测类应用中这些是正常行为。

---

## 判断 RNOH 应用是否真正崩溃的可靠方法

### 问题现象
仅凭 Error 级日志数量无法准确判断应用是否真正崩溃，需要多维度综合判断。

### 解决方案
不要仅凭 Error 级日志数量判断应用状态，应综合以下 4 个维度：

1. **Level F (Fatal) 日志**：有无 Fatal 级日志（最可靠指标）
2. **faultlog 崩溃日志**：使用 `get_hilog_or_faultlog_recent` 设置 `is_crash_log=true` 查询有无崩溃记录
3. **UI 树验证**：使用 `get_app_ui_tree`（full 模式）获取 UI 树，grep 搜索目标组件关键词，确认应用 UI 是否正常渲染（进程存活且功能正常的最直接证据）
4. **进程存活**：`aa start` 返回 `start ability successfully` 后 UI 树能成功 dump，说明进程未崩溃退出

### 结果
当 3 个维度（无 Fatal、无 faultlog、UI 正常渲染目标组件）全部通过时，Error 日志可全部归类为框架噪音，结论为"应用正常"。此方法在实际部署验证任务中验证有效。

---

## hdc snapshot_display 截图命令后缀限制

### 问题现象
使用 `hdc shell snapshot_display -f /data/local/tmp/xxx.png` 截图时报错：`error: fileName /data/local/tmp/xxx.png invalid, suffix must be .jpeg`。

### 解决方案
`snapshot_display` 命令只支持 `.jpeg` 后缀，不支持 `.png`。必须使用 `.jpeg` 扩展名：
```bash
hdc shell snapshot_display -f /data/local/tmp/screenshot.jpeg
hdc file recv /data/local/tmp/screenshot.jpeg ./
```

### 结果
改用 `.jpeg` 后缀后截图成功。后续截图操作统一使用 `.jpeg` 后缀，避免 `snapshot_display` 报错。

---

## MCP perform_ui_action screenshot 多设备环境 hvd 参数问题

### 问题现象
当环境中存在多个可用设备（包括未运行的模拟器）时，MCP 工具 `perform_ui_action` 的 screenshot 操作会要求通过 `hvd` 参数指定目标设备，即使只有一个真机已连接。

### 解决方案
多设备环境下可改用 `hdc` 命令行直接截图作为替代方案：
```bash
hdc shell snapshot_display -f /data/local/tmp/screenshot.jpeg
hdc file recv /data/local/tmp/screenshot.jpeg ./
```
若必须使用 MCP 工具，则需传入 `hvd` 参数明确指定目标设备 ID。

### 结果
使用 hdc 命令行绕过 MCP 工具的多设备限制，成功完成截图。在多设备环境中推荐优先使用 hdc 命令行。

---

## RNOH 示例项目 Bundle Name 复用的部署策略

### 问题现象
RNOH 示例项目（netinfo、pager-view 等）共用 bundle name `com.harmony.wechat.lib.demo`。直接部署新应用而不卸载旧应用，会导致旧应用残留，UI 树内容不匹配，无法确认是否为新部署的应用。

### 解决方案
部署新应用前必须先卸载旧应用：
```bash
hdc shell bm uninstall -n com.harmony.wechat.lib.demo
hdc install <new-hap-path>
```

### 结果
先卸载再安装后，UI 树内容与新部署应用匹配，可可靠确认应用正常启动。共用 bundle name 的项目必须遵循此策略。

---

## RNOH 应用部署验证标准流程

### 问题现象
RNOH 应用部署到设备后缺乏标准化的验证流程，容易遗漏关键检查步骤导致误判应用状态。

### 解决方案
推荐以下 8 步标准部署验证流程：

1. **清除残留**：`hdc shell bm uninstall -n <bundleName>`（清除旧应用残留）
2. **安装 HAP**：`hdc install <hap-path>`（安装新 HAP）
3. **清日志缓冲**：`hdc shell hilog -r`（清除历史日志干扰）
4. **启动应用**：`hdc shell aa start -a EntryAbility -b <bundleName>`（启动 Ability）
5. **等待渲染**：等待 8-10 秒（确保 UI 完成渲染）
6. **UI 树验证**：调用 `get_app_ui_tree`（full 模式）获取 UI 树 JSON，grep 搜索目标组件关键词（如 `netinfo/NetInfo/RNCNetInfo`），确认应用正常启动且非设备残留的其他应用
7. **日志检查**：调用 `get_hilog_or_faultlog_recent` 分别按 `level=F`、`is_crash_log=true`、`level=E` 过滤
8. **日志分析**：分类分析 Error 日志，排除噪音白名单后确认无致命错误

### 结果
此流程在 rntpc_react-native-netinfo (0.84) 部署验证任务中验证有效，8 步全部通过后可确认应用正常启动无崩溃。流程可复用于其他 RNOH 应用的部署验证。