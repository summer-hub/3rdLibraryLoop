# RNOH 手写/codegen 双轨 TurboModule 接线验证方法

### 问题现象

RN 鸿蒙化库中经常同时存在手写 C++ TurboModule 类（如 `RTNCookiesTurboModule`）与 codegen 生成的同名 TurboModule（`generated/RNOH/generated/turbo_modules/RTNCookies.cpp`），两套实现方法数还不一致。仅看文件是否存在无法判断哪个真正生效，会把未接线的手写死代码当作实际实现来分析，得出错误结论。

### 解决方案

判断 C++ TurboModule 哪个真正生效，**不要看文件是否存在，而要看 Package 工厂链路中实际创建的类名**：

1. 打开库的 Package 头文件（如 `BaseReactNativeCookiesPackage.h`，通常由 codegen 生成）
2. 查看 `createTurboModule()` / 工厂方法中 `std::make_shared<XXX>` 实际实例化的类名
3. `std::make_shared` 指向 codegen 生成类 → 手写类为未接线死代码；指向手写类 → codegen 类仅是接口壳

若手写类未接线：它是死代码，运行期零分配零调用，内存上无泄露影响。此类发现应在检视报告中记为"观察项（0 分）"，注明无内存影响、建议归属编码质量/一致性检视阶段处理，不应计入内存扣分。

### 结果

rntpc_cookies 实测：`BaseReactNativeCookiesPackage.h:15-21` 只实例化 codegen 生成的 `RTNCookies`（5 方法），手写 `RTNCookiesTurboModule`（7 方法）为未接线死代码，按观察项（0 分）记录，未影响内存评分（95/100）。该方法适用于所有 RNOH 鸿蒙化库的 C++ 层分析。