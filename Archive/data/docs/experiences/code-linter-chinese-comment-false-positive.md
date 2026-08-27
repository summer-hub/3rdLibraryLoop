## Code Linter 对中文注释的误报模式与已知非阻断项

### 问题现象

Code Linter 的 `@security/no-commented-code` 规则会将含"代码样式"内容的中文注释（如 `setGenreDescription('Blues') 后 ...` 这类描述性注释）误判为注释掉的代码，产生 P2 级噪音告警。

### 解决方案

识别为误报，按 P2 噪音处理，不阻断流程。已知非阻断 Warning 清单：
- `@security/no-commented-code`：中文注释误报（P2 噪音）
- `@cross-device-app-dev/color-value`：十六进制颜色值写法
- `file-naming-convention`（`@hw-stylistic/file-naming-convention`）：`001_` 序号前缀文件名与要求的大驼峰命名冲突，属工程既有约定

### 结果

以上 Warning 均不阻塞编译，按 P2 优化项按需处理即可，无需为消除告警改变代码结构或文件命名约定。真正需要修复的是 Error 级问题（0 Error 方可进入编译）。