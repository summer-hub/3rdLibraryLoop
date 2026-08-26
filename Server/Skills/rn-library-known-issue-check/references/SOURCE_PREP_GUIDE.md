# 源码准备指南

> 本文档说明检视前如何准备源码目录，确保 Phase 1-3 的输入完整且正确。

---

## 1. 源码目录结构

检视前，`{outputDir}` 下应包含以下结构：

```
{outputDir}/
├── 接口规格说明.md                    # 前置 SKILL 产出（必需）
├── source/
│   ├── ohos/                          # 鸿蒙化实现代码（必需）
│   │   ├── harmony/                   # 常见目录
│   │   ├── src/main/cpp/              # C++ TurboModule 实现
│   │   ├── oh-package.json5           # 鸿蒙依赖声明
│   │   ├── package.json               # 补充依赖声明
│   │   └── ...
│   └── RN/                            # 上游原库代码（可选，用于对比）
│       └── ...
```

---

## 2. 获取源码

### 2.1 克隆鸿蒙化仓库

```bash
git clone --depth=1 {ohosRepoUrl} {outputDir}/source/ohos/
```

### 2.2 克隆上游原库（可选）

```bash
git clone --depth=1 {upstreamRepoUrl} {outputDir}/source/RN/
```

> 上游原库用于对比：判断某问题是鸿蒙化引入的，还是上游遗留问题。

---

## 3. 源码目录检查

### 3.1 必需文件检查

| 文件 | 用途 | 缺失处理 |
|------|------|----------|
| `oh-package.json5` | 依赖特征预筛 | 跳过依赖维度预筛，使用 `package.json` 替代 |
| `package.json` | 依赖特征预筛 | 跳过依赖维度预筛 |
| 至少一个 `.ets`/`.ts` 文件 | 鸿蒙化实现 | 判定为「未实现鸿蒙化」，检视跳过 |
| 至少一个 `.cpp`/`.h` 文件 | 可能含 C++ 层实现 | 跳过 C++ 相关规则（R-07/R-12） |

### 3.2 文件命名约定

检视 Agent 应识别以下常见鸿蒙化目录布局：

| 目录 | 说明 |
|------|------|
| `harmony/` | 标准鸿蒙化目录（首选） |
| `ohos/` | 早期鸿蒙化目录 |
| `src/main/cpp/` | C++ TurboModule 实现 |
| `src/main/ets/` | ArkTS 实现 |
| `harmony/entry/src/main/ets/` | 鸿蒙工程入口 |

### 3.3 排除规则

以下目录/文件不纳入检视范围：
- `example/` — 示例工程代码
- `node_modules/` — 依赖包
- `build/`、`builds/` — 构建产物
- `.git/` — Git 元数据
- `oh_modules/` — 鸿蒙依赖