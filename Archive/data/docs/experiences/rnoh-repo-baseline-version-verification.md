## 鸿蒙化仓库基线版本核验：任务指定的分支-基线组合可能不符

### 问题现象
任务指定「br_rnoh0.77 分支鸿蒙化基线版本 16.1.3」，实际核验发现 br_rnoh0.77 分支的 package.json 版本为 15.1.2（README.OpenSource 上游基线 15.1.0），而 16.1.3 基线（commit ca7aa46，含 82 项框架适配）实际在 **master 分支**。直接按任务描述假设分支-基线组合会导致 diff 基线选错。

### 解决方案
对任务指定的「分支-基线」组合一律先核验（可靠性从高到低）：
1. `README.OpenSource` 的 `Version Number` 字段 — **最可靠**，是鸿蒙化仓库的权威声明
2. `git log --all --grep="<版本号>"` + `git branch -a --contains <commit>` 定位版本提交所在分支
3. `git show origin/<branch>:package.json` 交叉验证各分支的 package.json 版本

### 结果
核验后输出各分支版本矩阵（分支 × package.json 版本 × README.OpenSource 上游基线），在报告开篇显式澄清实际基线所在分支，避免下游基于错误基线做 diff 或升级。