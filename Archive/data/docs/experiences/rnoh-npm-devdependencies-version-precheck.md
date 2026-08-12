## RN 框架升级时 npm devDependencies 版本可用性预检

### 问题现象
升级 RN 框架版本时（如 0.82→0.84），更新 package.json 中的 devDependencies 版本后执行 `npm install`，部分包因目标版本在 npm registry 中不存在而导致安装失败：
- `@types/react-test-renderer@^19.2.0` — npm registry 中最高仅 19.1.0（无 19.2.x）
- `react-native-macos@^0.84.1` — npm registry 中最高仅 0.81.9（尚未发布 0.84 对应版本）

### 解决方案
在更新 devDependencies 版本前，先使用 `npm view` 命令检查目标版本是否存在：

```bash
# 检查包的所有可用版本
npm view <package> versions --json

# 检查最新版本
npm view <package> version
```

对于可能没有对应版本发布的包，使用兼容范围版本而非精确版本：
- `@types/react-test-renderer` → 使用 `^19.0.0`（实际最高 19.1.0）
- `react-native-macos` → 使用 `^0.81.9`（实际最高 0.81.9）

**需特别关注的包**（可能滞后于 RN 主版本发布）：
- `react-native-macos` — macOS 平台适配，通常滞后
- `@types/react-test-renderer` — 类型定义包，可能滞后于 React 版本
- 其他平台特定包（@types/*, react-native-windows 等）

### 结果
使用兼容范围版本后，`npm install --legacy-peer-deps` 成功完成，无版本解析失败错误。通过预检可以避免因版本不存在导致的安装失败，减少反复修改 package.json 的工作量。