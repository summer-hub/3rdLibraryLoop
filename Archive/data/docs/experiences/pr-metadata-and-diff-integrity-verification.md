## PR 元数据判读与 diff 完整性核验经验

### 问题现象
（1）仓库给 PR 打了「静态检查失败」标签，但 PR 元数据 API 显示 `ci_state_passed=true`，两处信息矛盾，容易误判 CI 状态；（2）单 commit PR 中 pr.patch（单次 commit patch）与累积 diff 的关系不确定，需要快速确认 diff 完整性；（3）从 diff 文本提取变更文件列表的 `sed 's/diff --git a\/.* b\/\//'` 命令在 macOS（BSD sed）上报 "unterminated substitute in regular expression"，导致 changed-files.txt 生成为 **0 字节空文件**，且直至收尾才被发现，险些遗漏。

### 解决方案
1. CI/标签矛盾时，**以 PR 元数据 API 的 mergeable_state 为准**，标签仅作线索；静态检查结论以本地独立检查 + 基线对照为准。
2. 单 commit PR 快速判定：`git log --oneline` 确认 PR 分支 HEAD 的父提交即 base master tip 时，pr.patch == 累积 diff，可用于**交叉校验 diff 完整性**；但"必须生成累积 diff"的流程仍应执行，两者一致时相互印证（如 mp3agic PR #53：11 文件 +2605 行两者一致）。
3. macOS BSD sed 对 `a\/.* b\/` 转义组合不兼容。改用管道方案：`grep "^diff --git" pr-diff.txt | awk '{print $4}' | sed 's/^b\///'`，并在生成后 `wc -l` 校验非空。**通用教训**：所有"生成文件"类步骤都应附带非空校验，0 字节空文件在收尾前不易被察觉。

### 结果
在 mp3agic PR #53 检视中：以 PR 元数据为准避免了被仓库标签误导；pr.patch 与累积 diff 一致相互印证了 diff 完整性；替换命令后 changed-files.txt 正常生成，后续检视范围判断未失据。