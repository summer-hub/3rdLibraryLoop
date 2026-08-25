# HPKBUILD 详细检查指南

本指南为 TpcCheckSkill 提供 HPKBUILD 文件的详细检查规范和模板。

---

## 1. pkgver 版本号规范

### 1.1 与上游 tag 一致

pkgver 必须与上游社区 tag 名称保持一致，包括 `v` 前缀。

| 上游 tag | 正确 pkgver | 错误 pkgver |
|----------|-------------|-------------|
| `v2.0.0` | `pkgver=v2.0.0` | `pkgver=2.0.0` |
| `9.0.0` | `pkgver=9.0.0` | `pkgver=v9.0.0` |

### 1.2 不能使用 `master`

pkgver 不能使用 `master` 分支名。

| 场景 | 正确示例 | 错误示例 |
|------|----------|----------|
| 无合适 release tag | `pkgver=e9fe7fbecae47a2287e761080f8b1133cc22e8fa` | `pkgver=master` |
| 短 hash | `pkgver=c0031cf` | `pkgver=master` |

### 1.3 commit hash 作为 pkgver 时

不应使用额外的 `commitid` 变量，应直接在 prepare() 中使用 `git clone` + `git reset --hard $pkgver`。

**正确示例**：
```bash
pkgver=1fd04917cff50fac72ae23e45f82ca6fd9130bd8
builddir=$pkgname-${pkgver}

# prepare() 中:
git clone -b master $source $builddir
cd $builddir
git reset --hard $pkgver
```

**错误示例（旧的 master+commitid 模式）**：
```bash
pkgver=master
commitid=bc09d8f8b4681aaeaa82b9d9a078e7eae4838424
builddir=$pkgname-${commitid}
```

### 1.4 pkgver 与 builddir 的关系

| pkgver 格式 | builddir |
|-------------|----------|
| 不带 `v` 前缀（如 `9.0.0`） | `builddir=$pkgname-${pkgver}` |
| 带 `v` 前缀（如 `v0.41.0`） | `builddir=$pkgname-${pkgver:1}` |
| commit hash | `builddir=$pkgname-${pkgver}` |

---

## 2. 构建类型规范

### 2.1 cmake 类型

**buildtools 值**：`cmake`（或不写，默认 cmake）

**无需 `source envset.sh`**

**build() 函数模板**：
```bash
build() {
    cd $builddir
    PKG_CONFIG_LIBDIR="${pkgconfigpath}" \
    ${OHOS_SDK}/native/build-tools/cmake/bin/cmake "$@" \
    -DCMAKE_BUILD_TYPE=Release -DOHOS_ARCH=$ARCH -B$ARCH-build -S./ -L > $buildlog 2>&1
    $MAKE -C $ARCH-build >> $buildlog 2>&1
    ret=$?
    cd $OLDPWD
    return $ret
}
```

**关键检查项**：
- 必须使用 `${OHOS_SDK}/native/build-tools/cmake/bin/cmake`（不能用系统 cmake）
- 必须包含 `-DOHOS_ARCH=$ARCH`
- 必须包含 `-B$ARCH-build -S./`
- 输出重定向到 `$buildlog`
- 必须 `cd $OLDPWD` 并 `return $ret`

### 2.2 configure 类型

**buildtools 值**：`configure`

**必须有 `source envset.sh`**

**build() 函数模板**：
```bash
build() {
    cd $builddir
    ./configure --host=${host} "$@" > $buildlog 2>&1
    $MAKE -j4 >> $buildlog 2>&1
    ret=$?
    cd $OLDPWD
    return $ret
}
```

**关键检查项**：
- 必须在 prepare() 中根据 `$ARCH` 设置 `host` 变量和调用 `setXXXENV`
- 必须在 package() 中调用对应的 `unsetXXXENV`
- 必须有 `source envset.sh` 行

### 2.3 automake 类型

**buildtools 值**：`automake`

**必须有 `source envset.sh`**

**build() 函数模板**：
```bash
build() {
    cd $builddir
    ./configure --host=${host} "$@" > $buildlog 2>&1
    $MAKE -j4 >> $buildlog 2>&1
    ret=$?
    cd $OLDPWD
    return $ret
}
```

**关键检查项**：
- 与 configure 类型相同
- 必须在 prepare() 中根据 `$ARCH` 设置 `host` 变量和调用 `setXXXENV`
- 必须在 package() 中调用对应的 `unsetXXXENV`

### 2.4 make 类型

**buildtools 值**：`make`

**必须有 `source envset.sh`**

**build() 函数模板**：
```bash
build() {
    cd $builddir-$ARCH-build
    $MAKE CC=$CC CFLAGS="..." LDFLAGS="..." > $buildlog 2>&1
    ret=$?
    cd $OLDPWD
    return $ret
}
```

**关键检查项**：
- 必须使用 `$CC` 和正确的交叉编译标志

### 2.5 meson 类型

**buildtools 值**：`meson`

**必须有 `source envset.sh`**

**build() 函数模板**：
```bash
build() {
    cd $builddir
    meson setup $ARCH-build --cross-file $ARCH-cross-file.txt "$@" > $buildlog 2>&1
    ninja -C $ARCH-build >> $buildlog 2>&1
    ret=$?
    cd $OLDPWD
    return $ret
}
```

**关键检查项**：
- 必须提供交叉编译配置文件（如 `$ARCH-cross-file.txt`）
- meson setup 必须指定 `--cross-file` 和构建目录 `$ARCH-build`
- 使用 `ninja -C $ARCH-build` 编译
- 输出重定向到 `$buildlog`
- 必须 `cd $OLDPWD` 并 `return $ret`

---

## 3. 必需函数规范

### 3.1 prepare()

- 创建构建目录 `$builddir/$ARCH-build`
- 如有 patch 需在此应用

### 3.2 build()

- 必须正确 `cd $builddir` 和 `cd $OLDPWD`
- 必须捕获退出码 `ret=$?` 并 `return $ret`

### 3.3 package()

- 安装到 `$LYCIUM_ROOT/usr/$pkgname/$ARCH` 目录结构下

### 3.4 check()

- 至少包含 `echo "The test must be on an OpenHarmony device!"`

### 3.5 cleanbuild()

- 清理 `$builddir` 相关目录

---

## 4. 头部规范

必须包含 Apache 2.0 许可证头部和 Contributor/Maintainer 信息：

```bash
# Copyright (c) 2025 Huawei Device Co., Ltd.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Contributor: 姓名 <邮箱>
# Maintainer: 姓名 <邮箱>
```

---

## 5. Patch 规范

- 命名格式：`<libname>_oh_pkg.patch`（构建适配）、`<libname>_oh_test.patch`（测试适配）
- 必须在 prepare() 中应用 patch，使用 `patchflag=true` 控制只应用一次
- SHA512SUM 中必须包含 patch 文件的校验值
