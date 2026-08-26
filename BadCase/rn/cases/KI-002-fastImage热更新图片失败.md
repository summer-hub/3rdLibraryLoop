# KI-002 react-native-fast-image：加载热更新图片失败

- **元数据**: `rule: R-02` · `verified: diff` · `source: community-issue` · `severity: high`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-fast-image/pull/102（merged，+7/-1，1 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-fast-image-102.md](../pr-info/rntpc_react-native-fast-image-102.md)

## 现象

fastImage 加载热更新 bundle 中的图片失败。

## 根因

C++ 层 asset:// 前缀分支未区分 rawfile 资源与沙箱文件路径，一律按 rawfile 资源方式（SetResource）加载，热更新图片实际位于沙箱文件路径，加载必然失败。

## 错误代码（修复前）

```cpp
if (props->source.uri.rfind(ASSET_PREFIX, 0) == 0) {
    m_imageKnifeOption->loadSrc.SetResource({.id = -1, .param = newUri.c_str()});
}
```

## 正确代码（修复后）

```cpp
if (props->source.uri.rfind(ASSET_PREFIX, 0) == 0) {
    if (newUri.find(RAWFILE_PREFIX, 0) == 0) {
        m_imageKnifeOption->loadSrc.SetResource({.id = -1, .param = newUri.c_str()});
    } else {
        m_imageKnifeOption->loadSrc.SetString(newUri.c_str());
    }
}
```

## 修复方式

在 asset:// 分支内二次判断：若路径以 RAWFILE_PREFIX 开头走 SetResource，否则走 SetString（文件路径加载）。
