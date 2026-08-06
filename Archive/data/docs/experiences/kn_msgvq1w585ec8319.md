# 鸿蒙自动化测试框架关系与文档搜索经验

## 一、arkXtest 框架命名混淆

### 问题现象
编写鸿蒙测试文档时，容易将 arkXtest 当作独立框架来描述，误以为存在独立的 arkXtest 包或 API，导致文档中框架名称使用混乱。

### 解决方案
明确 arkXtest 是框架统称而非独立框架。arkXtest = JsUnit + UITest + PerfTest 三者的统称，不存在独立的 arkXtest 包或 API。文档中需区分"统称"与"具体框架"。

### 结果
文档中正确区分框架统称与具体框架，消除 arkXtest 与 JsUnit/UITest 的命名混淆。

---

## 二、JsUnit 与 UITest 关系误判

### 问题现象
不清楚 JsUnit 与 UITest 之间的关系，容易将两者描述为平级框架，误导读者理解测试代码结构。

### 解决方案
理解两者的上下层依赖关系：UITest 脚本必须基于 JsUnit 的 describe/it 定义，在 it 回调中调用 UITest 接口。所有 UITest 测试用例本质上也是 JsUnit 测试用例。文档中使用"底座+上层"模式描述 JsUnit 与 UITest 的关系。

### 结果
文档准确表达 JsUnit（底座）与 UITest（上层）的依赖关系，避免平级错觉。

---

## 三、Hypium(Python) 与 arkXtest 关系不清

### 问题现象
不清楚 Hypium(Python) 与 arkXtest 体系的关系，难以判断 CI/CD 场景下应选用的测试框架。

### 解决方案
理解两者的完全独立性：Hypium(Python) 运行在 PC 端，通过 hdc 连接设备，不依赖设备端的 JsUnit/UITest 框架。与 arkXtest（设备端框架）完全独立。CI/CD 场景下 Hypium 更适合流水线集成。

### 结果
能根据场景正确选择测试框架：设备端测试用 arkXtest 体系（JsUnit/UITest），流水线集成用 Hypium(Python)。

---

## 四、API 版本标注遗漏

### 问题现象
标注 UITest API 版本时只标注了一套版本号，导致读者不清楚功能的实际可用范围。

### 解决方案
同时标注两套版本体系：OS API 版本（如 API 8/9/18/20/22）和 @ohos/hypium 包版本（如 1.0.1/1.0.25）。示例：Mock 能力从 @ohos/hypium 1.0.1 开始支持，运行在 API 8+ 设备上。两者缺一不可。

### 结果
版本信息完整，读者可准确判断功能的设备兼容性和包依赖。

---

## 五、devecocli docs search 中文关键词搜索失败

### 问题现象
使用纯中文关键词搜索 devecocli docs 时返回 SEARCH_FAILED。例如搜索"JsUnit 单元测试"失败。

### 解决方案
改用中英文混合关键词或更通用的关键词。例如搜索"arkXtest 测试框架"和"UiTest UI测试"均成功。

### 结果
搜索成功，获取到所需的鸿蒙测试框架文档。

---

## 六、devecocli docs search 结果只有摘要

### 问题现象
devecocli docs search 返回的结果只包含摘要，无法获取完整文档内容。

### 解决方案
搜索结果中提取文档 ID，再执行 `devecocli docs read <documentId>` 获取完整文档内容。

### 结果
成功获取完整的文档内容用于分析。