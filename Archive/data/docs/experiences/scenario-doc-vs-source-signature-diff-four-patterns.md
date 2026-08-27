## 三方库 Demo 生成：场景文档与库源码签名差异四类模式与核对策略

### 问题现象

基于 Demo 场景描述文档生成 ArkTS 代码时，场景文档中的接口签名与库源码实际签名存在系统性差异（mp3agic 案例：6 处差异，全部通过"逐接口 read_file 源码核实"拦截，未凭文档字面值编码）。差异可归纳为四类：

1. **容器类型不一致**：文档写 `Array<T>`，源码实为 `JList<T>`（如 setChapters/setChapterTOC/getChapters/getChapterTOC）
2. **参数形态不一致**：文档写数组传参 `arrays: any[]`，源码为 rest 参数 `...arrays`（如 BufferTools.mergeArrayBuffer），调用必须展开为多参数
3. **声明返回类型与实际不符**：源码声明 `number` 实际返回数组（如 unsynchroniseBuffer），源于库 `.ts` 文件带 `@ts-nocheck`，编译器不校验
4. **接口行为与文档预期相反**：方法无条件抛异常（如 ID3v2ObseleteFrame.packFrame 无条件抛 NotSupportedException）或内部缺陷（如 ID3v24Tag.setGenreDescription 缺 `this.` 前缀，运行时抛 ReferenceError）

另有符号约定陷阱：`BufferTools.setBit(0, 7, true)` 返回 Int8 有符号值 -128 而非 128。

### 解决方案

- 生成前对**容器参数类型、rest 参数、返回类型、无条件抛异常方法**四类差异做专项核对（比全量核对更聚焦）
- 每个接口必须 read_file 库源码确认签名，**以源码为准**，禁止按场景文档字面值编码
- **声明返回类型与实际不符的容错展示**：库源码带 @ts-nocheck 时，按声明类型接值（编译通过），用 `String(result)` 展示实际内容并在代码注释说明差异，避免 `as` 二次强转引入新编译错误
- **行为与文档相反的接口演示策略**：无条件抛异常的接口按真实行为 try/catch 捕获展示异常名与消息，验证点注释标注"源码真实行为"，不捏造成功路径
- 按源码参数序精确构造对象，可选参数用 undefined 占位（如 `ID3v2ChapterTOCFrameData(false, undefined, true, true, 'toc01', undefined)` 后再 setChilds）

### 结果

mp3agic Demo 生成中 6 处差异全部在编码前拦截，未产生签名相关编译循环。三方库 `.ts` 源码普遍带 `@ts-nocheck`，场景文档签名不可尽信，专项核对策略可复用于其他三方库 Demo 生成任务。