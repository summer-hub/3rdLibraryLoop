# ArkTS 测试代码的深层路径 import 风格与识别方法

### 问题现象

分析 ArkTS（鸿蒙）三方库的测试代码（XTS/Demo）时，测试文件的 import 存在两种风格：

```ts
// 风格 A：包名导入
import { EncodedText, ID3v22Tag } from '@ohos/mp3agic'
// 风格 B：深层路径导入（直接指向库内源文件）
import { BufferTools } from '@ohos/mp3agic/src/main/ets/components/mp3agic/BufferTools'
import { MutableInteger } from '@ohos/mp3agic/src/main/ets/components/mp3agic/MutableInteger'
```

基于 import 匹配的静态分析工具若只匹配包名（`fromLib === libName || fromLib.endsWith('/' + libName.split('/').pop())`），风格 B 不满足任何条件，导致 `importedSymbols` 为空、整个测试文件被静默跳过。mp3agic 案例中一个 803 行、覆盖 28 个静态方法的测试文件被整体漏掉，且无任何告警。

### 解决方案

在包名匹配条件基础上增加深层路径前缀识别：

```js
// AST 与正则引擎均需同步修改
if (fromLib !== libName && !fromLib.endsWith('/' + libName.split('/').pop())
    && !fromLib.startsWith(libName + '/')) continue;
```

AST 模式下还需在 `resolveModuleNames` 中将深层路径模块说明符映射到库目录下的真实源文件：`'@ohos/pkg/src/main/ets/...'` → `library/src/main/ets/...`（同时做小写键二次查找以兼容大小写差异）。

### 结果

mp3agic 库 XTS 覆盖率分析结果从 8/271（2.95%）修正为 100/271（36.90%），与人工 grep 全量调用盘点逐类一致。结论：任何扫描 ArkTS 测试/示例代码做调用分析的工具，都必须同时兼容包名导入与深层路径导入两种风格，并在 import 均未被识别时输出告警。该修复已合入 `analyze-xts-coverage.cjs`（arkts-library-xts-coverage SKILL v1.1.0）。