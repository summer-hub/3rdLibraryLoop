# 3rdLibraryLoop v0.3.0 发布产物

- 生成时间（UTC）：2026-10-18T05:29:53Z
- 版本：`0.3.0`（核心包与 CLI 包**同版本**）
- 产物目录：`dist-npm/`

## 产物清单

| 包 | tarball | 文件数 | 体积（tarball / 解包） | sha256 |
|----|---------|--------|------------------------|--------|
| `@ohos-cpf/3rdloop_core` | `ohos-cpf-3rdloop_core-0.3.0.tgz` | 822 | 2.41 MB / 9.30 MB | `f2dfd27c0a4e76504a447ec12860dbfae79ede3d518c7995c3e7fefc89e934cb` |
| `@ohos-cpf/3rdloop` | `ohos-cpf-3rdloop-0.3.0.tgz` | 28 | 139.4 KB / 477.0 KB | `aa660a081d26ab6273a4cdca1fb5192c321ed5286c04773725b6d9ed702ac315` |

校验文件：`SHA256SUMS`（sha256sum 格式，两行）。

## 新用户安装（一行命令）

本项目是双包发布，且核心包不在公共 npm registry 上 —— **只装 CLI 那个 tarball 会 E404**，
必须两个 tarball 一起装。下面这两条脚本就是干这件事的（下载 → 校验 SHA256 → 一次装两个 → 自检）：

```powershell
# Windows
irm https://raw.githubusercontent.com/summor/3rdLibraryLoop/master/scripts/install.ps1 | iex
```

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/summor/3rdLibraryLoop/master/scripts/install.sh | bash
```

指定版本：`-Tag v0.0.14`（PowerShell）/ `--tag v0.0.14`（bash）。
离线或验证本次产物：`-FromDir <本目录>` / `--from-dir <本目录>`。

## 本地安装（验证用）

在产物目录下执行，注意**两个 tarball 一起装**（CLI 通过 `@ohos-cpf/3rdloop_core` 依赖核心包，
只装 CLI 会从 registry 拉旧版核心包）：

```bash
npm i ./ohos-cpf-3rdloop_core-0.3.0.tgz ./ohos-cpf-3rdloop-0.3.0.tgz
```

装完自检（应当报出安装态核心包版本与来源）：

```bash
npx 3rdloop version
npx 3rdloop serve          # 前端扩展随核心包自动发现，无需 install-ext
```

## 发布步骤（人工执行，本脚本不做任何上传/发布）

1. 校验产物完整性：

   ```bash
   sha256sum -c SHA256SUMS
   ```

2. 打 tag 并推送：

   ```bash
   git tag v0.3.0 && git push origin v0.3.0
   ```

3. 创建 GitHub Release（用本文件作为说明）：

   ```bash
   gh release create v0.3.0 --title "v0.3.0" --notes-file RELEASE.md
   ```

4. 上传两个 tarball：

   ```bash
   gh release upload v0.3.0 ohos-cpf-3rdloop_core-0.3.0.tgz ohos-cpf-3rdloop-0.3.0.tgz
   ```

5. （可选）发布到 npm registry——需要凭据，且顺序为**先核心包、再 CLI 包**：

   ```bash
   npm publish ohos-cpf-3rdloop_core-0.3.0.tgz
   npm publish ohos-cpf-3rdloop-0.3.0.tgz
   ```
