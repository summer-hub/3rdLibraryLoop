# Demo 代码定位指南

本文档详细说明 RNLibraryTestCoverageCheckSkill Phase 1 中 demo 代码的定位逻辑，包括 rnRntUrl 解析、Sparse Checkout 克隆和自动查找策略。

---

## 概述

Demo 代码是覆盖率分析的核心来源之一。根据是否传入 `rnRntUrl` 参数，分两种情况获取 demo 代码：

| 情况 | 条件 | demo 来源 | 获取方式 |
|------|------|----------|----------|
| A | `rnRntUrl` 已传入 | RNTDEMO 工程 | Sparse Checkout 克隆 |
| B | `rnRntUrl` 未传入 | 仓库内 example/tester/demo | 自动查找 |

---

## 情况 A：rnRntUrl 已传入

### URL 格式

```
{rnRntGitUrl}/tree/{branch}/{projectPath}/{demoPath}
```

### 解析规则

从 `rnRntUrl` 中拆分为四个参数：

| 参数 | 提取方式 | 说明 |
|------|----------|------|
| `rnRntGitUrl` | 去除 `/tree/...` 后缀，确保以 `.git` 结尾 | Git 仓库地址 |
| `branch` | `/tree/` 后的第一段 | 分支名 |
| `projectPath` | 分支名后的第一段 | 测试工程路径（用于 Sparse Checkout） |
| `demoPath` | projectPath 后的剩余路径段 | 三方库 demo 相对路径 |

### 解析示例

```
输入：https://gitcode.com/CPF-RN/rnt/tree/br_rnoh0.82/25P1_1/rn-tester/examples/react-native-idle-timer

解析结果：
- rnRntGitUrl  = https://gitcode.com/CPF-RN/rnt.git
- branch       = br_rnoh0.82
- projectPath  = 25P1_1
- demoPath     = rn-tester/examples/react-native-idle-timer
```

### 解析步骤

1. 找到 `/tree/` 在 URL 中的位置
2. `/tree/` 之前的部分是 `rnRntGitUrl`（去除尾部 `/`，添加 `.git` 后缀）
3. `/tree/` 之后按 `/` 分割：
   - 第一段 → `branch`
   - 第二段 → `projectPath`
   - 第三段及之后（用 `/` 连接） → `demoPath`

### 参数校验

> ⚠️ 以下校验失败时必须**停止后续检查**，评分直接为 **0 分**。

#### projectPath 为空

如果 URL 格式为 `{rnRntGitUrl}/tree/{branch}`（无路径部分），`projectPath` 解析为空。

报告标注：
```
❌ rnRntUrl 格式不正确：无法从 `{rnRntUrl}` 解析出 projectPath。
正确格式为 `{rnRntGitUrl}/tree/{branch}/{projectPath}/{demoPath}`，
其中 projectPath 指定测试用例工程路径，demoPath 指定三方库 demo 路径。
```

#### demoPath 为空

如果 URL 格式为 `{rnRntGitUrl}/tree/{branch}/{projectPath}`（无 demo 路径部分），`demoPath` 解析为空。

报告标注：
```
❌ rnRntUrl 格式不正确：无法从 `{rnRntUrl}` 解析出 demoPath。
正确格式为 `{rnRntGitUrl}/tree/{branch}/{projectPath}/{demoPath}`，
其中 demoPath 指定三方库 demo 在测试工程中的相对路径。
```

### Sparse Checkout 克隆

```bash
mkdir -p {outputDir}/source/RNTDEMO
cd {outputDir}/source/RNTDEMO
git init
git config core.sparseCheckout true
git remote add origin {rnRntGitUrl}
git sparse-checkout set {projectPath}/{demoPath}
git fetch origin {branch} --depth=1
git checkout {branch}
```

> `workdir: "{outputDir}"`

### 验证获取结果

检查 `{outputDir}/source/RNTDEMO/{projectPath}/{demoPath}` 目录：

```bash
ls -la {outputDir}/source/RNTDEMO/{projectPath}/{demoPath}
```

若目录不存在或为空，记录错误并标注。

### 记录获取信息

将 demo 来源信息写入 `{outputDir}/clone-info.json`（如文件已存在则合并）：

```json
{
  "rntDemo": {
    "source": "rnRntUrl",
    "baseUrl": "{rnRntGitUrl}",
    "branch": "{branch}",
    "projectPath": "{projectPath}",
    "demoPath": "{demoPath}",
    "sparseCheckout": true,
    "commitHash": "abc123def456",
    "originalUrl": "{rnRntUrl}"
  }
}
```

### 确定分析路径

- **demoRoot**（demo 目录路径）：`{outputDir}/source/RNTDEMO/{projectPath}/{demoPath}`
- **libRoot**（库根目录）：`{outputDir}/source/ohos`

> 💡 demoPath 示例：`rnRntUrl = https://gitcode.com/CPF-RN/rnt/tree/br_rnoh0.82/25P1_1/rn-tester/examples/react-native-webview`，解析后 `projectPath = 25P1_1`、`demoPath = rn-tester/examples/react-native-webview`，完整 demo 路径为 `{outputDir}/source/RNTDEMO/25P1_1/rn-tester/examples/react-native-webview`。

### 获取失败处理

| 错误类型 | 可能原因 | 解决方案 |
|----------|----------|----------|
| projectPath 为空 | rnRntUrl 格式不正确 | 停止检查，评分 0 分 |
| demoPath 为空 | rnRntUrl 格式不正确 | 停止检查，评分 0 分 |
| 认证失败 | 私有仓库或权限不足 | 提示配置 SSH 密钥或 HTTPS Token |
| 分支不存在 | 分支名称错误 | `git branch -r` 列出远程分支 |
| projectPath/demoPath 不存在 | 路径错误或分支中无此目录 | 列出仓库根目录内容 |
| 网络超时 | 网络问题 | 提示检查网络或使用镜像站点 |
| Sparse Checkout 失败 | Git 版本过低 | 提示升级 Git 到 2.25+ |

### Git 环境检查

```bash
git --version
```

确认 Git 已安装且版本 ≥ 2.25.0（支持 Sparse Checkout）。

---

## 情况 B：rnRntUrl 未传入

### 自动查找策略

从鸿蒙化仓库 `{outputDir}/source/ohos/` 和上游原库 `{outputDir}/source/RN/` 中自动查找 demo 代码。

```bash
# 优先级 1：上游原库中的 example/tester/demo 目录
find {outputDir}/source/RN -type d \( -name "example" -o -name "examples" -o -name "Example" -o -name "tester" -o -name "demo" -o -name "Demo" \) -maxdepth 3

# 优先级 2：鸿蒙化仓库中的 example/tester/demo 目录
find {outputDir}/source/ohos -type d \( -name "example" -o -name "examples" -o -name "Example" -o -name "tester" -o -name "demo" -o -name "Demo" \) -maxdepth 3
```

> `workdir: "{outputDir}"`

### 搜索策略

1. 优先查找上游原库 `RN/` 下的 `example/`/`examples/`/`tester/`/`demo/` 目录
2. 若原库未找到，再查找鸿蒙化仓库 `ohos/` 下的同名目录
3. 取**第一个找到的**目录作为 demo 代码来源
4. 若两个仓库都未找到此类目录，标注"未找到 demo 代码目录"，跳过 demo 覆盖度分析，仅靠 test 目录覆盖评估

### 验证获取结果

检查找到的 demo 目录是否包含 TS/JS 文件：

```bash
find {demoDir} -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \)
```

### 记录获取信息

```json
{
  "rntDemo": {
    "source": "repo_autodetect",
    "demoDir": "RN/example",
    "repoUsed": "upstream"
  }
}
```

### 确定分析路径

- **demoRoot**：`{outputDir}/source/RN/{autoDetectedDemoDir}` 或 `{outputDir}/source/ohos/{autoDetectedDemoDir}`
- **libRoot**：`{outputDir}/source/ohos`

### 未找到 demo 的处理

若两个仓库都未找到 demo 目录：
- 标注"未找到 demo 代码"
- 跳过 Phase 4（Demo 覆盖率分析）
- 仅依靠 Phase 3（测试覆盖率）的结果进行评估
- 综合接口覆盖率 = test 覆盖率（无 demo 来源）

---

## demoRoot 与脚本 --src 参数映射

| 情况 | demoRoot | 脚本 `--src` 参数 |
|------|----------|------------------|
| A | `{outputDir}/source/RNTDEMO/{projectPath}/{demoPath}` | `--src {demoRoot}`（必传，因为 demo 不在 libroot 下） |
| B | `{outputDir}/source/RN/{demoDir}` | 不传 `--src`，脚本自动从 libroot 检测（如果 demo 在 ohos 仓库内）<br>或传 `--src {demoRoot}`（如果 demo 在 RN 仓库） |
| B（未找到） | 无 | 跳过 Phase 4 |
