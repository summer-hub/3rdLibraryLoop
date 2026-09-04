# port-test-demo.sh 使用指南

## 脚本概述

从 RN 三方库 git 仓库中提取测试 demo / 用例代码，移植到 RNOH 模板工程的 `src/index.tsx` 中。

脚本位于本 skill 的 `scripts/` 目录下，可直接运行。

## 参数说明

### 必选参数

| 参数 | 说明 |
|------|------|
| `--git-url <url>` | git 仓库 URL |
| `--branch <branch>` | git 分支名或版本标签 |

### 可选参数

| 参数 | 说明 |
|------|------|
| `--template-dir <path>` | 模板工程目录，不指定则自动检测 |
| `--demo-dirs <dir1,dir2,...>` | 手动指定 demo 目录名（逗号分隔，跳过自动检测） |
| `--legacy-peer-deps` | npm install 时使用 `--legacy-peer-deps` |
| `--force` | npm install 时使用 `--force` |
| `--skip-npm-install` | 跳过依赖安装步骤 |
| `--skip-index-merge` | 跳过 index.tsx 合并步骤（只拷贝文件不修改入口） |
| `--verbose` | 显示详细调试信息 |
| `--dry-run` | 只检测不实际拷贝 |

## 工作流程

### 1. git clone 仓库

浅克隆（`--depth=1`）到当前目录下的 `TestGet/` 目录中。

### 2. 自动检测 demo 目录

按以下顺序检测：

- 已知目录名：`example`、`demo`、`Example`、`Demo`、`test`、`tests`、`Test`、`Tests`、`spec`、`specs`、`__tests__`、`e2e`、`cypress`
- monorepo 结构：`packages/*/example`、`packages/*/demo`

### 3. 依赖安装

解析 demo 的 package.json：
- 将三方库依赖安装到模板工程
- `workspace:` 协议依赖自动转换为 `file:` 本地依赖
- 支持通过 `--legacy-peer-deps` 或 `--force` 处理 peer 冲突

### 4. 支撑文件拷贝

将 demo 的 assets、animations 等资源文件拷贝到模板工程 `src/` 顶层，保持原有相对路径。

使用 `rsync` 进行文件拷贝，自动跳过 `node_modules`、`.git` 等目录。

### 5. 入口代码合并

将 demo 的入口文件（`App.tsx` / `index.tsx` 等）内容直接写入 `src/index.tsx`，过滤 `AppRegistry` 注册代码。

## 自动检测模板工程目录

脚本按以下顺序查找模板工程：

1. `--template-dir` 指定的路径
2. 当前工作目录（如果包含 `package.json` 和 `src/index.tsx`）
3. `RN3rdTemplate/0.77/` 或 `RN3rdTemplate/0.82/`（相对于脚本位置）
4. 向上查找（最多 5 层）

## 使用示例

### 基本用法

```bash
./scripts/port-test-demo.sh \
  --git-url https://github.com/lottie-react-native/lottie-react-native \
  --branch v7.4.0
```

### 指定模板目录

```bash
./scripts/port-test-demo.sh \
  --git-url https://github.com/lottie-react-native/lottie-react-native \
  --branch v7.4.0 \
  --template-dir <本地RN3rdTemplate模板目录，如 ~/RNOH/RN3rdTemplate/0.84>
```

### 手动指定 demo 目录

```bash
./scripts/port-test-demo.sh \
  --git-url https://github.com/xxx/mono-repo \
  --branch main \
  --demo-dirs packages/core/example
```

### dry-run 模式

```bash
./scripts/port-test-demo.sh \
  --git-url https://github.com/lottie-react-native/lottie-react-native \
  --branch v7.4.0 \
  --dry-run
```

### 跳过 npm install

```bash
./scripts/port-test-demo.sh \
  --git-url https://github.com/lottie-react-native/lottie-react-native \
  --branch v7.4.0 \
  --skip-npm-install
```

## 文件拷贝策略

### 拷贝的文件

- demo 目录下的所有 `.ts`、`.tsx`、`.js`、`.jsx` 文件
- assets 资源文件（图片、动画 JSON、字体等）
- 配置文件（如需要）

### 排除的文件

- `node_modules/`
- `.git/`
- `.DS_Store`
- `*.log`

### 目录结构映射

```
上游仓库:
example/
├── App.tsx              ← 入口文件
├── src/
│   ├── components/
│   │   └── Example.tsx
│   └── assets/
│       └── animation.json
└── package.json

模板工程 (移植后):
src/
├── index.tsx            ← App.tsx 内容写入此处
├── components/
│   └── Example.tsx      ← 保持原目录结构
└── assets/
    └── animation.json   ← 资源文件保持相对路径
```

## 入口文件合并策略

### 合并规则

1. 读取 demo 入口文件内容
2. 过滤掉 `AppRegistry.registerComponent` 调用
3. 过滤掉 `import` 中的 `react-native` 的 `AppRegistry`
4. 将剩余内容直接写入 `src/index.tsx`
5. 保留模板工程原有的 `AppRegistry.registerComponent` 调用

### 多入口文件处理

如果 demo 有多个入口文件（如 `App.tsx` + `examples/` 目录）：
- 主入口文件内容写入 `src/index.tsx`
- 其他文件保持原目录结构拷贝到 `src/` 下

## 依赖安装策略

### workspace 协议转换

```json
// 上游 demo package.json
"dependencies": {
  "lottie-react-native": "workspace:*"
}

// 转换后 (安装到模板工程)
"dependencies": {
  "lottie-react-native": "file:../update_harmony_lib/target-repo"
}
```

### file 协议依赖

如果 demo 依赖了本地路径的其他包：
- 自动检测 `file:` 协议依赖
- 尝试在克隆的仓库中找到对应路径
- 转换为相对于模板工程的路径

## 常见问题

### Q: 脚本提示"未找到 demo 目录"

**A**: 使用 `--demo-dirs` 手动指定目录名。先用 `--dry-run` 查看仓库结构。

### Q: 依赖安装失败

**A**: 尝试 `--legacy-peer-deps` 或 `--force`。如果仍失败，使用 `--skip-npm-install` 跳过，手动安装。

### Q: 资源文件路径不对

**A**: 检查 `rsync` 拷贝的目录结构是否与测试代码中的引用路径一致。可能需要手动调整路径或创建符号链接。

### Q: index.tsx 合并后编译错误

**A**: 使用 `--skip-index-merge` 跳过自动合并，手动将 demo 入口文件内容复制到 `src/index.tsx` 中。

### Q: 子目录中的 index.tsx 聚合入口被跳过

**A**: `port-test-demo.sh` 在拷贝支撑文件时，会将所有名为 `index.tsx` 的文件加入 `SKIP_FILES` 列表（因为主入口文件也叫 `index.tsx`）。这导致上游 `testCases/index.tsx` 等子目录中的聚合入口文件被跳过未拷贝。移植完成后需手动检查是否存在被跳过的聚合入口，并手动创建或拷贝。
