## mp3agic 鸿蒙移植库源码行为缺陷与签名实测清单

### 问题现象

mp3agic 鸿蒙移植库（`.ts` 源码带 `@ts-nocheck`）存在多处与场景文档/预期不符的实际行为，按文档字面调用会运行时出错或展示错误结果。

### 解决方案（实测行为清单）

| 接口 | 实际行为（以源码为准） | Demo 处理方式 |
|------|----------------------|--------------|
| `ID3v24Tag.setGenreDescription` | 内部引用缺 `this.` 前缀（@ts-nocheck 掩盖的库缺陷），运行时抛 ReferenceError | try/catch 捕获展示 |
| `ID3v2ObseleteFrame.packFrame` | 无条件抛 `NotSupportedException` | try/catch 捕获展示异常名与消息，验证点标注"源码真实行为" |
| `unsynchroniseBuffer` | 声明返回 `number`，实际返回数组 | 按声明类型接值，`String(result)` 展示实际内容 |
| `BufferTools.setBit(0, 7, true)` | 返回 Int8 有符号值 `-128` 而非 `128` | 按有符号值展示 |
| `setChapters` / `setChapterTOC` / `getChapters` / `getChapterTOC` | 容器类型为 `JList<T>` 而非文档所写 `Array<T>` | 按 JList 构造/接值 |
| `BufferTools.mergeArrayBuffer` | rest 参数 `...arrays` 而非文档所写数组参数 | 调用时展开为多参数 |
| `ID3v2ChapterTOCFrameData` 构造函数 | 签名 `(unsynchronisation, bytes?, isRoot?, isOrdered?, id?, children?)` | 按参数序精确构造，可选参用 undefined 占位后再 setChilds |

### 结果

mp3agic Demo 生成中全部差异按源码实测行为处理，编译与功能验证通过。再次使用该库时直接对照本清单，无需重新逐接口核实。