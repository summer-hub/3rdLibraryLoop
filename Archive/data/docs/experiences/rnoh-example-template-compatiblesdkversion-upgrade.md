## RNOH example 模板 compatibleSdkVersion 必须手动升级

### 问题现象
从 RN3rdTemplate 模板仓库获取的 example 工程默认 `compatibleSdkVersion: '5.0.0(12)'`（API 12），但 RNOH 0.84 的 HAR 包元数据声明最低需要 API 17。构建时报错：
```
Error Message: The project's compatibleSdkVersion: 12 cannot be lower than the minimum compatible version 17 required by the dependencies: @react-native-ohos/netinfo.
```
此错误属于 `Specification Limit Violation`，构建直接失败。

### 解决方案
从 RN3rdTemplate 获取 example 模板后，必须手动升级 `example/harmony/build-profile.json5` 中的 `compatibleSdkVersion`：

```json5
// 修改前（模板默认）
"compatibleSdkVersion": "5.0.0(12)"

// 修改后（RNOH 0.84 要求）
"compatibleSdkVersion": "5.0.5(17)"
```

**API 版本对应表**：
| RNOH 版本 | 最低 API 版本 | compatibleSdkVersion |
|-----------|-------------|---------------------|
| 0.77 | 14 | 5.0.2(14) |
| 0.82 | 15 | 5.0.3(15) |
| 0.84 | 17 | 5.0.5(17) |

### 结果
升级 compatibleSdkVersion 后，`devecocli build` 不再报 `Specification Limit Violation` 错误，构建正常通过。此步骤是从模板创建 example 工程后的必做操作。