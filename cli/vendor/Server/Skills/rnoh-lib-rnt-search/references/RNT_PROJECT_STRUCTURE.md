# rnt 工程结构参考

> 本文档说明 rnt（React Native Tester）工程的目录布局、demo 子目录约定与扫描规则。

---

## 1. rnt 工程总览

rnt 是 RN 鸿蒙化团队的 demo 集合工程，**根目录下并列多个子工程**，每个子工程内含 `rn-tester/examples/` 目录，存放各三方库的 demo。

```
{rnt-root}/                          ← rnt 工程根（用户传入 --rnt-path）
├── react_native_openharmony/        ← RNOH 框架本体子工程
│   └── rn-tester/
│       └── examples/
│           ├── react-native-camera-kit/
│           ├── react-native-svg/
│           └── ...
├── rnoh_testerino/                  ← testerino 测试框架子工程
│   └── rn-tester/
│       └── examples/
│           └── ...
├── <其他子工程>/
│   └── rn-tester/
│       └── examples/
│           └── <library-demo>/
└── ...
```

**关键约定**：
- demo 目录**总在** `{rnt-root}/*/rn-tester/examples/{库候选名}/` 路径下
- 不同子工程的 `examples/` 可能收录不同库的 demo
- 同一库的 demo **通常只在一个子工程下**，但**也可能存在多个**（版本一致时自动选择第一个）

---

## 2. demo 目录典型结构

rnt demo 的目录结构有多种变体，`analyze-demo-deps.cjs` 会自动检测入口文件位置。以下是三种常见结构：

### 2.1 结构 A：根级入口（经典结构）

```
{library-demo}/
├── App.tsx                # demo 入口组件，含 displayName / title
├── index.tsx              # 导出 demo，供 testerino 注册
├── tests/
│   └── index.tsx          # testerino 测试用例注册表
├── camera/                # demo 功能子目录
│   ├── CameraDemo.tsx
│   └── CameraControls.tsx
├── components/            # demo 复用组件
│   ├── Navigation.tsx     # 通用导航（迁移时保留）
│   └── Button.tsx
└── assets/                # 静态资源
```

### 2.2 结构 B：testCase 嵌套结构（常见于较新 demo）

```
{library-demo}/
├── testCase/
│   ├── App.tsx            # testerino 入口，导出 displayName / title / examples
│   ├── Navigation.tsx     # 通用导航（含硬编码标题，需修正）
│   ├── Palette.tsx        # 颜色常量
│   └── Test/
│       ├── index.tsx      # testerino 测试用例注册表
│       ├── PdfApitest.tsx
│       └── ...
├── demo/
│   └── PdfExample.tsx     # 独立 demo 示例
└── assets/                # 静态资源
```

> 结构 B 的入口在 `testCase/App.tsx`，不是根级 `App.tsx`。`index.tsx`（根级）可能是独立的简单示例，需要接入到 `testCase/App.tsx`（Phase 6.4）。

### 2.3 结构 C：混合结构

部分 demo 同时包含根级 `App.tsx` 和 `tests/` 目录，也可能有 `demo/` 子目录存放额外示例。

### 2.4 入口检测规则

`analyze-demo-deps.cjs` 按以下规则自动检测入口：

| 检测项 | 规则 |
|--------|------|
| App 入口 | 递归扫描，取第一个 basename 为 `App.tsx`/`App.ts`/`App.jsx`/`App.js` 的文件 |
| index 入口 | 递归扫描，取第一个 basename 为 `index.tsx`/`index.ts` 的文件 |
| displayName | 匹配 `displayName = 'xxx'` 或 `export const displayName = 'xxx'` |
| title | 匹配 `title = 'xxx'` 或 `title: 'xxx'` 或 `export const title = 'xxx'` |
| Navigation.tsx | 递归扫描，列出所有 basename 为 `Navigation.tsx` 的文件 |
| 硬编码标题 | 匹配 `RN <Xxx> (Capi )?Tester` 模式的文本 |

---

## 3. 候选搜索名生成

`read-lib-meta.cjs` 从目标库 `package.json` 生成候选名数组 `searchNames`，按以下顺序去重：

| 顺序 | 来源 | 示例（react-native-camera-kit） |
|------|------|-------------------------------|
| 1 | `harmony.alias` | `react-native-camera-kit` |
| 2 | `packageName` 去 scope | `react-native-camera-kit`（`@scope/react-native-camera-kit` → `react-native-camera-kit`） |
| 3 | `dirBase`（目录名） | `react-native-camera-kit` |
| 4 | `packageName`（完整） | `@scope/react-native-camera-kit` |

> scope 去除规则：`packageName.includes('/')` 时取 `split('/').pop()`，否则取原值。

---

## 4. 扫描规则详解

`find-rnt-demo.sh` 执行流程：

```
1. 调用 read-lib-meta.cjs 获取 searchNames
2. 遍历 {rnt-root}/*/rn-tester/examples/
   ├─ 对每个候选名，检查 {examples-root}/{候选名}/ 是否存在
   │   └─ 命中 → 加入 matches
   └─ 大小写不敏感兜底：
      遍历 {examples-root} 下所有子目录
      对每个子目录名与候选名做 tr '[:upper:]' '[:lower:]' 比较
      命中 → 加入 matches
3. 去重 matches
4. 输出每个 demo 绝对路径一行
5. 退出码：
   - 0: 唯一命中
   - 1: 未命中
   - 2: 多个命中（自动选择第一个，用户可通过 --demo-path 指定其他）
```

### 4.1 多命中的典型情况

- 同一库在不同 rnt 子工程下都有 demo（新旧版本共存）
- 候选名匹配到多个不同库（如 `react-native-svg` 匹配到 `react-native-svg-uri`）
- 大小写兜底匹配到名称相近的目录

> 多命中时自动选择第一个，在报告中标注全部命中路径。用户可通过 `--demo-path` 参数指定其他。

### 4.2 未命中的排查

| 原因 | 排查方法 |
|------|---------|
| rnt 工程路径错误 | 检查 `{rnt-root}` 是否存在、是否有 `*/rn-tester/examples/` 子目录 |
| 库 demo 不在 rnt 中 | 询问用户该库是否有 demo、demo 是否在别处 |
| 候选名不匹配 | 手动浏览 `{rnt-root}/*/rn-tester/examples/` 目录列表，找名称相近的 |
| demo 目录名特殊 | 用户提供 `--demo-path` 直接跳过扫描 |

---

## 5. rnt 工程路径示例

| 环境 | 典型路径 |
|------|---------|
| 本机默认 | `/path/to/rnt`（用户自定义） |
| 团队共享 | `/workspace/rnt` |
| 克隆临时 | `/tmp/rnt-clone` |

> **路径不写死在脚本中**，由用户通过 `--rnt-path` 传入。脚本仅做存在性校验。

---

## 6. 与 example 工程的差异

| 维度 | rnt demo | example/src（迁移后） |
|------|---------|---------------------|
| 用途 | 团队共享的 demo 集合 | 单个库的独立测试工程 |
| 依赖管理 | rnt 工程统一 `package.json` | example 自己的 `package.json` |
| 目标库引用 | `import { X } from 'react-native-camera-kit'`（npm 包） | 同样用 alias 引用，但通过 `metro.config.js` 映射到 `node_modules/<ohPackageName>` |
| 入口注册 | testerino 全局注册 | `App.tsx` + `index.tsx` 独立入口 |
| 原生壳层 | rnt 工程统一提供 | example 自己的 `harmony/` 壳层（由 `rn-lib-add-example` 配置） |

> 迁移的本质：从 rnt 的「集合 demo」中取出一个，放到 example 的「独立工程」中，并补齐 example 缺失的壳层与依赖。
