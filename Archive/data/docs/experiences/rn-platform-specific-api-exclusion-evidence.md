## RN 平台特有接口排除判定：上游注释仅为线索，鸿蒙侧实现是决定性判据

### 问题现象

RN 三方库鸿蒙化用例覆盖度检视中，对未覆盖列表做平台特有接口排除时存在**过度排除**失真风险：上游 index.d.ts 中标注 `// Android only`、`// iOS only` 的接口，若按注释机械排除，会把鸿蒙侧真实存在的接口移出有效分母，掩盖真实覆盖缺口。

反例（rntpc_cookies 库）：`removeSessionCookies`（上游标注 Android only）与 `clearByName`（上游标注 iOS only）虽被标注为单平台专属，但鸿蒙侧 TurboModule Spec **均有实现**（`clearSessionCookieSync` / 过期 Cookie 覆写删除）——不得排除。过度排除与假阴性方向相反，但同样导致有效覆盖率失真。

### 解决方案

平台特有接口排除的正确证据链（建议三条齐备才排除）：
1. **上游平台限定标注**（`// Android only`、`// iOS only` 等）——仅为线索，不能单独作为排除依据；
2. **鸿蒙 JS 入口的平台门控**——如 `flush` 仅在 `Platform.OS === 'android'` 时调原生，鸿蒙为 no-op；
3. **鸿蒙侧 TurboModule Spec / ArkTS / C++ 转发均无实现**——决定性判据（对应检视 CHECKLIST 平台特有识别特征 4）。

判定优先级：上游 d.ts 平台注释 ≠ 排除依据；以鸿蒙侧是否有 TurboModule/ArkTS 实现为决定性判据。保守判定原则：无法确定是否平台特有时**不排除**（按正常未覆盖处理），只有证据链明确时才排除。

### 结果

rntpc_cookies 实例验证：
- `flush`（上游标注 Android only + 鸿蒙 JS 入口 no-op + 鸿蒙侧无实现）与 `getAll`（上游标注 iOS only + 鸿蒙侧三层均未实现、调用抛 TypeError）证据链齐备，正确排除；
- `removeSessionCookies` / `clearByName` 因鸿蒙侧 TurboModule 有实现而**不排除**，避免了掩盖真实覆盖状态。

可复用结论：平台特有排除判定必须核对鸿蒙侧 TurboModule Spec / ArkTS / C++ 是否有实现，不能信任上游注释；三条证据齐备才排除，防止过度排除（移出真实接口）与遗漏排除（误触归零）两类方向相反的失真。