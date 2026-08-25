# tpc_c_cplusplus 适配库规范性检查清单

本清单用于 TpcCheckSkill Phase 3 的逐项检查。

**数据获取原则**：所有文件内容通过 GitCode API 按需获取，不克隆整个仓库。
- `contents` API：获取文件内容（Base64 编码，需解码）或目录列表
- `pulls/{num}/files` API：获取 PR 变更文件列表
- `pulls/{num}/diff` API：获取 PR 完整 diff

---

## 1. 目录结构检查

### 1.1 thirdparty 适配库

| # | 检查项 | 必需性 | 严重程度（缺失时） | 检查方式 |
|---|--------|--------|-------------------|----------|
| 1 | HPKBUILD 存在 | 必需 | Critical | PR 变更 + API contents |
| 2 | SHA512SUM 存在 | 必需 | Critical | PR 变更 + API contents |
| 3 | README.OpenSource 存在 | 必需 | Critical | PR 变更 + API contents |
| 4 | README_zh.md 存在 | 必需 | Critical | PR 变更 + API contents |
| 5 | docs/ 目录存在 | 必需 | Major | API 目录列表 |
| 6 | docs/hap_integrate.md 存在 | 必需 | Major | PR 变更 + API contents |
| 7 | docs/pic/ 目录存在 | 有文档时必需 | Minor | API 目录列表 |
| 8 | HPKCHECK 存在 | 建议 | Minor | API 目录列表 |
| 9 | OAT.xml 存在 | 建议 | Minor | API 目录列表 |

### 1.2 community 适配库

| # | 检查项 | 必需性 | 严重程度（缺失时） | 检查方式 |
|---|--------|--------|-------------------|----------|
| 1 | HPKBUILD 存在 | 必需 | Critical | PR 变更 + API contents |
| 2 | SHA512SUM 存在 | 必需 | Critical | PR 变更 + API contents |
| 3 | README.OpenSource 存在 | 建议 | Minor | API 目录列表 |
| 4 | README_zh.md 存在 | 建议 | Minor | API 目录列表 |
| 5 | HPKCHECK 存在 | 建议 | Minor | API 目录列表 |
| 6 | OAT.xml 存在 | 建议 | Minor | API 目录列表 |

### 1.3 文件名拼写

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | hap_integrate.md 拼写正确（不是 hap_ingtegrate.md） | Critical（若拼错） |

---

## 2. HPKBUILD 检查

### 2.1 必需字段

| # | 字段 | 严重程度（缺失时） |
|---|------|-------------------|
| 1 | pkgname | Critical |
| 2 | pkgver | Critical |
| 3 | pkgrel | Critical |
| 4 | pkgdesc | Major |
| 5 | url | Major |
| 6 | archs | Critical |
| 7 | license | Critical |
| 8 | depends | Major |
| 9 | makedepends | Minor |
| 10 | source | Critical |
| 11 | downloadpackage | Major |
| 12 | autounpack | Major |
| 13 | builddir | Critical |
| 14 | packagename | Major |

### 2.2 字段值检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | pkgname 与目录名一致 | Major |
| 2 | pkgver 不是 `master` | Critical |
| 3 | pkgver 不使用 `commitid` 变量（应直接用 hash） | Major |
| 4 | pkgver 带 `v` 前缀时 builddir 使用 `${pkgver:1}` | Major |
| 5 | archs 包含 `armeabi-v7a`、`arm64-v8a`、`x86_64` | Critical |
| 6 | buildtools 值合法（cmake/configure/automake/make/meson/jamfile） | Major |

### 2.3 必需函数

| # | 函数 | 严重程度（缺失时） |
|---|------|-------------------|
| 1 | prepare() | Critical |
| 2 | build() | Critical |
| 3 | package() | Critical |
| 4 | check() | Critical |
| 5 | cleanbuild() | Critical |

### 2.4 build() 函数规范

| # | 检查项 | 构建类型 | 严重程度 |
|---|--------|----------|----------|
| 1 | cmake 使用 `${OHOS_SDK}/native/build-tools/cmake/bin/cmake` | cmake | Critical |
| 2 | cmake 包含 `-DOHOS_ARCH=$ARCH` | cmake | Critical |
| 3 | cmake 包含 `-B$ARCH-build -S./` | cmake | Major |
| 4 | 输出重定向到 `$buildlog` | cmake/make | Minor |
| 5 | 有 `source envset.sh` 行 | configure/automake/make | Critical |
| 6 | prepare() 中根据 `$ARCH` 设置 `host` 变量 | configure/automake | Major |
| 7 | prepare() 中调用 `setXXXENV` | configure/automake/make | Major |
| 8 | package() 中调用 `unsetXXXENV` | configure/automake/make | Major |
| 9 | meson 包含 `--cross-file` 参数 | meson | Critical |
| 10 | meson 使用 `ninja -C $ARCH-build` | meson | Major |
| 11 | `cd $OLDPWD` 并 `return $ret` | 所有类型 | Major |

### 2.5 头部检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | Apache 2.0 许可证头部 | Minor |
| 2 | Contributor 信息 | Minor |
| 3 | Maintainer 信息 | Minor |

### 2.6 check() 函数

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 至少包含 `echo "The test must be on an OpenHarmony device!"` | Major |

---

## 3. SHA512SUM 检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 文件非空 | Critical |
| 2 | 每行格式为 `<128字符哈希>  <文件名>` | Major |
| 3 | 哈希值为 128 个十六进制字符 | Major |
| 4 | 包含源码压缩包的校验值 | Critical |
| 5 | Patch 文件有对应校验值 | Major |

---

## 4. README.OpenSource 检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 是合法 JSON | Critical |
| 2 | 是 JSON 数组 | Critical |
| 3 | 数组非空 | Major |
| 4 | 每个对象包含 Name 字段 | Major |
| 5 | 每个对象包含 License 字段 | Major |
| 6 | 每个对象包含 License File 字段 | Major |
| 7 | 每个对象包含 Version Number 字段 | Major |
| 8 | 每个对象包含 Owner 字段 | Major |
| 9 | 每个对象包含 Upstream URL 字段 | Major |
| 10 | 每个对象包含 Description 字段 | Major |
| 11 | Name 与 pkgname 一致 | Minor |
| 12 | Version Number 与 pkgver 对应 | Minor |
| 13 | License 与 HPKBUILD 中 license 字段对应 | Minor |

---

## 5. README_zh.md 检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 标题格式 `# <libname>三方库说明` | Major |
| 2 | 包含"功能简介"章节 | Major |
| 3 | 包含"三方库版本"章节 | Major |
| 4 | 包含"已适配功能"章节 | Major |
| 5 | 包含"使用约束"章节 | Major |
| 6 | 包含"集成方式"章节 | Major |
| 7 | "使用约束"链接到 `../../docs/constraint.md` | Major |
| 8 | "集成方式"链接到 `docs/hap_integrate.md` | Major |

---

## 6. docs/hap_integrate.md 检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 标题格式 `# <libname>如何集成到应用hap` | Major |
| 2 | 包含"准备应用工程"章节 | Major |
| 3 | 包含"准备应用开发环境"章节 | Major |
| 4 | 包含"增加构建脚本及配置文件"章节 | Major |
| 5 | 包含"准备三方库源码"章节 | Major |
| 6 | 包含"应用中使用三方库"章节 | Major |
| 7 | 包含"编译工程"章节 | Major |
| 8 | 包含"运行效果"章节 | Major |
| 9 | 包含"参考资料"章节 | Minor |
| 10 | 开发环境链接指向 `../../../docs/hap_integrate_environment.md` | Major |
| 11 | 包含 CMakeLists.txt 引用（`target_link_libraries`） | Minor |
| 12 | 包含截图引用（`![...](pic/...`） | Minor |

---

## 7. HPKCHECK 检查（当存在时）

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 包含 `source HPKBUILD` 行 | Major |
| 2 | 函数名为 `openharmonycheck()` | Major |
| 3 | 包含 `cd $OLDPWD` | Major |
| 4 | 包含 `return $res` | Major |

---

## 8. Patch 文件检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 命名格式 `<libname>_oh_pkg.patch` 或 `<libname>_oh_test.patch` | Minor |
| 2 | SHA512SUM 中有 patch 的校验值 | Major |
| 3 | 在 prepare() 中应用 patch | Major |

---

## 9. 通用规范检查

| # | 检查项 | 严重程度 |
|---|--------|----------|
| 1 | 不应包含源码压缩包本身 | Critical（若包含） |
| 2 | 不应引入与上游无关的二进制文件 | Critical（若包含） |
| 3 | depends 依赖库的 archs 是当前库 archs 的超集 | Major |
