## GitCode 仓库 git clone 输出重定向警告属正常行为，不代表克隆失败

### 问题现象

执行 `git clone https://gitcode.com/CPF-ApplicationTPC/mp3agic` 时输出"警告：重定向到 .../mp3agic.git/"，容易被误判为克隆失败，进而触发不必要的降级重试（如去掉 `--depth=1` 重新完整克隆）。

### 解决方案

该重定向警告是 GitCode 平台的正常行为（GitCode 会自动将无 `.git` 后缀的仓库地址重定向到带 `.git` 后缀的地址），不代表克隆失败。判断克隆是否成功应以命令退出码和目标目录实际内容为准，而非 stderr 警告文本。

### 结果

克隆实际成功、源码完整。只要 `git clone` 退出码为 0 且目标目录含仓库内容（`.git` 目录、`oh-package.json5` 等），即视为克隆成功，不应因重定向警告触发降级重试，避免浪费时间的无意义完整克隆。
