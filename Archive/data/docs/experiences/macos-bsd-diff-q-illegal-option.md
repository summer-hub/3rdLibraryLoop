# macOS 下 diff -q 报 "illegal option" 的解决方法

### 问题现象

在 macOS（zsh/BSD 工具链）下执行 `diff -q` 组合用法时报 "illegal option" 错误，导致命令链中断。原因是误用了 GNU diff 的语法组合，macOS 自带的 BSD diff 不支持该用法。

### 解决方案

改用以下任一方式：
- 直接用 `diff` 全量比对（观察输出差异）
- 用 `cmp -s file1 file2` 做静默比对（通过退出码判断是否相同，适合脚本）

### 结果

命令链不再中断。macOS 环境下涉及 GNU/BSD 工具差异时，优先考虑 `cmp -s` 替代 `diff -q` 的脚本化场景用法。