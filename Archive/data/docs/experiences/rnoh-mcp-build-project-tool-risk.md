## MCP deveco-mcp_build_project 工具可能构建错误项目

### 问题现象
使用 MCP `deveco-mcp_build_project` 工具对鸿蒙工程执行构建时，返回 `BUILD SUCCESSFUL` 但实际并未构建工作目录中的目标工程。该工具似乎使用 DevEco Studio 当前打开的项目，而非命令行指定的工作目录中的项目。如果仅依赖 MCP 工具的构建结果，会误认为编译通过而实际未通过。

### 解决方案
不要使用 MCP `deveco-mcp_build_project` 工具进行编译验证，改用 `devecocli build` 命令在项目目录中执行构建：

```bash
# 在 example/harmony 目录下执行
cd example/harmony
devecocli build --product default --build-mode debug
```

`devecocli build` 会自动解析模块依赖并在当前目录的工程上下文中执行构建，确保构建的是正确的项目。

### 结果
使用 `devecocli build` 后，构建结果准确反映当前工作目录工程的编译状态。避免了因 MCP 工具构建了错误项目而误判编译通过的陷阱。此问题在多任务并行开发时尤为危险——可能构建了另一个任务的工程而误认为当前任务编译通过。