# PR #102: fix(harmony): distinguish rawfile asset from file path when loading local images

- **状态**: merged
- **作者**: qq_54551695
- **创建时间**: 2026-07-24T16:02:57+08:00
- **分支**: br_rnoh0.77 → br_rnoh0.77
- **变更文件数**: 1

## PR 描述

fix(harmony): distinguish rawfile asset from file path when loading local images [#60](https://gitcode.com/CPF-RN/rntpc_react-native-fast-image/issues/60)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/fast_image/src/main/cpp/FastImageViewComponentInstance.cpp` | ? | +7 | -1 |

## Diff

### `harmony/fast_image/src/main/cpp/FastImageViewComponentInstance.cpp`

```diff
@@ -139,7 +139,13 @@ void FastImageViewComponentInstance::onPropsChanged(SharedConcreteProps const &p
     std::string newUri = setSources(props->source.uri, getAbsolutePathPrefix(getBundlePath()));
     if (!m_props || m_props->source.uri != newUri) {
         if (props->source.uri.rfind(ASSET_PREFIX, 0) == 0) {
-            m_imageKnifeOption->loadSrc.SetResource({.id = -1, .param = newUri.c_str()});
+            if (newUri.find(RAWFILE_PREFIX, 0) == 0) {
+                m_imageKnifeOption->loadSrc.SetResource({.id = -1, .param = newUri.c_str()});
+            }
+            else
+            {
+                m_imageKnifeOption->loadSrc.SetString(newUri.c_str());
+            }
         }
         else {
             m_imageKnifeOption->loadSrc.SetString(props->source.uri);

```
