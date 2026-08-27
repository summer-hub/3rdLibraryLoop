## ArkTS 三方库源码文件可能是 .ts 扩展名——工程结构验证不要以 .ets 数量为唯一判据

### 问题现象

克隆 ArkTS 三方库 mp3agic（gitcode.com/CPF-ApplicationTPC/mp3agic）后，统计 `library/` 目录下 `.ets` 文件数仅得 1 个，一度怀疑源码缺失。且该库入口文件为小写 `index.ets`，与常见的大写 `Index.ets` 约定不一致。

### 解决方案

深入查看后确认：ArkTS 三方库的实现源码不一定是 `.ets` 文件。mp3agic 的 `library/src/main/ets/components/mp3agic/` 下全部 48 个源文件均为 `.ts` 扩展名（如 `Mp3File.ts`、`ID3v2.ts`），`library/` 下仅入口文件 `index.ets` 一个 `.ets` 文件。验证 ArkTS 库工程结构时应确认以下要素（而非统计 `.ets` 文件数）：

- 入口文件（`index.ets` / `Index.ets`，匹配需大小写不敏感）
- `oh-package.json5`
- `src/main/module.json5`
- 源码目录存在（不限扩展名，`.ets` 与 `.ts` 均算）

### 结果

以 `oh-package.json5` / `module.json5` / 入口文件的存在作为工程结构有效性判据是可靠的，源码并未缺失。扫描 ArkTS 库源码时应同时包含 `*.ets` 与 `*.ts`（路径限定在 `src/main/ets/` 下），否则会完全遗漏 `.ts` 实现文件；入口统一从 `index.ets` 解析导出。另注意：macOS 文件系统大小写不敏感，`Index.ets` 字面匹配可偶然命中 `index.ets`，但在 Linux（大小写敏感文件系统）上按字面匹配会漏判，入口文件匹配必须显式做大小写不敏感处理。
