# README 模板格式差异与改写要点

## 如何判定格式（detect-readme-format.js）

按下列信号综合判定，**不符目标模板则进入整改流程**：

| 信号 | 外链/旧文档 | v0.4.0（usage-docs 常见） | v0.4.1（库内常见） | v0.4.2（目标） |
|------|-------------|---------------------------|--------------------|----------------|
| 首行 | 无 / `# 包名` | `> 模板版本：v0.4.0` 或 `> Template version: v0.4.0` | `> 文档模板：v0.4.1` | `> 文档模板：v0.4.2` |
| 版本表 | 无完整表 | 有表，列名偏旧 | 含 `三方库版本` + **`npm地址`** | 含 **`三方库版本（npm地址）`** + **`源码地址`** |
| 结构 | 常仅有 Documentation URL 外链 | 分节编号如 `## 1. 安装与使用` | `## 简介` / `## 下载安装` / `## 使用示例` 等 | 同 0.4.1 骨架，并强调 **`## 使用说明`** 等 0.4.2 章节 |
| 外链特征 | 含 `Documentation URL` 且正文几乎只有外链 | — | — | — |

`kind` 输出建议：`external_link` | `v0.4.0` | `v0.4.1` | `v0.4.2` | `unknown`。

## 0.4.1 → 0.4.2 主要变更

1. 首行版本改为 `v0.4.2`
2. 版本关系表：
   - `三方库版本` → `三方库版本（npm地址）`（单元格内放 npm 版本链接）
   - `npm地址` 列改为 **`源码地址`**（指向 Gitcode 分支/源码树）
3. 保留并理顺：`简介`、`下载安装`、`Link`、`约束与限制`、`使用示例`、`使用说明`、`接口说明`、`遗留问题`、`其他`、`目录结构`、`贡献代码`、`开源协议`
4. 内容按**当前库**重写：Autolink、API 级别、兼容性矩阵、示例代码（从 example / 源码提取）
5. **ManualLink 取舍**：若当前分支版本表与 Link 表中 Autolink **全部为是/Yes**，删除 README 中 ManualLink `<details>` 整段；详见下文「ManualLink 章节」

## ManualLink 章节（Autolink 全支持时删除）

模板 `model-0.4.2.md` 含 ManualLink 作为**多版本混合**时的兜底；**单分支且该分支所有版本均支持 Autolink** 时：

- **删除** `<details>…ManualLink…</details>` 全部内容
- **删除**「可跳过 ManualLink 配置」一句（全版本已 Autolink 时无意义）
- **保留** Link 版本表、Autolinking 框架文档链接、`### 运行`

判定数据源：版本关系表 `Autolink` 列 + `## Link` 小节表格；任一行 `否`/`No`/`partially` 则保留 ManualLink。

- overview 回写（usage-docs）

`model-0.4.2-overview.md` 为精简版：标题、基于上游说明、版本表、简介、下载安装。

- 中英文都 **覆盖** `zh-cn/<alias>.md` 与 `en/<alias>.md`
- 英文由中文 overview 翻译
- 版本表等事实与库内 README 保持一致

## 链接与组织（必读）

### 根因说明（避免 openharmony-sig 残留）

| 来源 | 问题 |
|------|------|
| **usage-docs 正文** | 大量文档仍含 `gitcode.com/openharmony-sig/...`，从 usage-docs 迁入库 README 时会**原样复制** |
| **库内 package.json** | `repository.url` 可能仍指向旧组织 |
| **模板 model-0.4.2.md** | 框架/本库链接已用 `CPF-RN`；但勿把 usage-docs 专用相对路径（如 `/zh-cn/link-source-code.md`）留到库 README |

技能内置模板（`references/model-0.4.2.md`）的 **Releases / Issue / PR / Autolinking** 已使用 [CPF-RN](https://gitcode.com/CPF-RN) 组织；**不能**假设 usage-docs 与 package.json 已同步。

### 组织与仓库解析顺序

1. **本库 Gitcode 地址**：优先 `git remote get-url origin` 或 `package.json.repository.url`
2. 若仍为 `openharmony-sig`，在 [CPF-RN 组织](https://gitcode.com/CPF-RN) 搜索 `rntpc_<alias>` 确认（如 [rntpc_react-native-audio](https://gitcode.com/CPF-RN/rntpc_react-native-audio)）
3. **框架 Autolinking 文档**：`https://gitcode.com/CPF-RN/ohos_react_native/blob/master/docs/zh-cn/Autolinking.md`（框架仓）
4. **三方库接入指导**（如直接链接源码）：在 [usage-docs](https://gitcode.com/CPF-RN/usage-docs) 仓，例如 `zh-cn/link-source-code.md` → `https://gitcode.com/CPF-RN/usage-docs/blob/master/zh-cn/link-source-code.md`（**不在** `ohos_react_native`）
5. **usage-docs 站内相对链接**（`/zh-cn/...`、`./link-source-code.md`）：迁入库 README 时必须改为 usage-docs **绝对 URL**（见 [`link-registry.json`](link-registry.json)）

### Step 3.5 — 链接规范化（从 usage-docs 迁移后**必做**）

```bash
node scripts/normalize-readme-links.js --lib-path "$LIB"
node scripts/normalize-readme-links.js --lib-path "$LIB" --write
```

脚本会：

- 将 `openharmony-sig` URL **仅在 CPF-RN 目标可达时**替换（见 `link-verify.js`；不可达则保留并报告）
- 将 `/zh-cn/link-source-code.md` 等 usage-docs 相对路径改为绝对链接，并对结果 URL **做 HTTP 可达性校验**
- 校验库内相对路径（仅允许 `./README.md` / `./README_EN.md` 等）
- 校验并同步修正 `package.json` 的 `repository.url` / `homepage` / `bugs.url`（验证通过才写回）

**退出码 2** 表示链接不可达、仓库根 URL 未验证、或仍有失效相对路径/旧组织残留。

### 链接可达性（必做，禁止仅改组织名）

| 步骤 | 说明 |
|------|------|
| 解析仓库 | `resolveVerifiedLibRepoBase` 对多个候选 URL 执行 `curl -L`，选用首个 2xx/3xx |
| 组织迁移 | 每个 `openharmony-sig` 链接触发「替换后 URL 是否可达」探测，失败则不替换 |
| 改写后复检 | README / package 中所有 GitCode / usage-docs / npm 外链汇总校验 |
| 失败处理 | 报告 `linkVerification.failures`；Agent 需修正仓库名、分支或链接后重跑 |

```bash
node scripts/normalize-readme-links.js --lib-path "$LIB"      # 含可达性检查
node scripts/normalize-readme-links.js --lib-path "$LIB" --write  # 仅当 ok=true
node scripts/normalize-package-meta.js --lib-path "$LIB" --write  # 同样校验 homepage/issues/LICENSE
```

离线调试可加 `--skip-verify`；**提交交付前必须去掉**。

### README 贡献 / 协议链接（CPF-RN 本库）

| 章节 | 中文 README | 英文 README |
|------|-------------|-------------|
| 贡献代码 / Contributing | Issue → `{libRepo}/issues`；PR → `{libRepo}/pulls` | 同左 |
| 开源协议 / License | `{libRepo}/blob/master/LICENSE` | 同左 |

`{libRepo}` = `https://gitcode.com/CPF-RN/rntpc_<alias>`（由 `normalize-readme-links.js` 解析）。

**禁止：**

- Issue/PR 仍指向 `openharmony-sig`
- LICENSE 仅指向上游 GitHub（如 `github.com/.../LICENSE`），而本库根目录已有 MIT LICENSE

### Step 5 — package.json 与 oh-package.json5

见 [rn-lib-update-doc SKILL Step 5](../SKILL.md#step-5--规范-packagejson-与-harmony-oh-packagejson5必做)。

```bash
node scripts/normalize-package-meta.js --lib-path "$LIB" --write
```

### Step 6 — CHANGELOG

见 [changelog-template.md](changelog-template.md) 与 `normalize-changelog.js`。

## 英文标题对照（常用）

| 中文 | English |
|------|---------|
| 简介 | Introduction |
| 下载安装 | Installation |
| 约束与限制 | Constraints and Limitations |
| 使用示例 | Usage Example |
| 使用说明 | Usage Guide |
| 接口说明 | API Reference |
| 遗留问题 | Known Issues |
| 其他 | Others |
| 目录结构 | Directory Structure |
| 贡献代码 | Contributing |
| 开源协议 | License |
