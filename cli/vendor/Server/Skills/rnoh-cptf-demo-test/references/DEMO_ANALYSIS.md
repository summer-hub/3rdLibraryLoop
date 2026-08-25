# Demo 源码勘察指南

> Phase 1 的详细操作手册。目标是产出一份"逐字符精确"的用例清单，作为测试文件生成的唯一事实来源。

## 1. 定位用例文件

```bash
# testerino 用例通常集中在单个 tsx 文件
grep -rl 'TestCase\|TestSuite' {demoPath}/src/ --include='*.tsx'
```

典型结构（react-native-get-random-values 实例）：

```tsx
<Tester>
  <TestSuite name="getRandomValues">
    <TestCase itShould="..." tags={['C_API', '...']} arrange={({setState}) => {...}} assert={...} />
    ...
  </TestSuite>
</Tester>
```

## 2. 三要素提取方法

### 2.1 按钮 title 提取

```bash
grep -n 'title=' {demoPath}/src/**/*.tsx
```

输出示例（记录完整 title，含中文括号/空格）：

```
63:  title="点击获取随机数(Int8Array)(范围:-128到127)"
264: title="测试普通数组应抛出 TypeMismatchError"
615: title="multiple calls should generate different values"
```

**注意**：
- title 可能很长，`textContains` 只需唯一子串即可（如 `点击获取随机数(Int8Array)`），但必须验证该子串在所有按钮中唯一
- 长数字串（如 `-2147483648到2147483647`）在终端显示可能换行，以文件读取为准

### 2.2 结果文本提取

```bash
grep -n '<Text>' {demoPath}/src/**/*.tsx
```

对每条 `<Text>` 记录：
- **前缀字面量**（含冒号——全角 `：` 或半角 `:`，原样保留）
- **动态部分**（state 变量名 → 推断点击后的可能取值）

实战实例对照表：

| 源码 Text | 冒号 | waitForText 参数 | 点击后动态值 |
|-----------|------|------------------|--------------|
| `<Text>错误信息：{errorInfo}</Text>` | **全角** | `'错误信息'`（不带冒号更稳） | error.toString() |
| `<Text>数组长度：{length}</Text>` | **全角** | `'数组长度：'` | 数字 |
| `<Text>视图长度：{length}</Text>` | **全角** | `'视图长度：'` | 数字 |
| `<Text>当前值:{item} 是否大于等于0:{String(...)}</Text>` | 半角 | `'是否大于等于0:true'` | true/false |
| `<Text>两次生成数据是否一致:{isSameState ? '' : 'false'}</Text>` | 半角 | `'两次生成数据是否一致'` | 空串或 'false' |
| `<Text>空数组result:{result}</Text>` | 半角 | `'空数组result:'` | JSON 字符串 |

**安全策略**：断言搜索串可省略冒号（如 `'错误信息'`），同时兼容两种冒号；但解析结果值时仍需按源码格式。

### 2.3 testID 检查

```bash
grep -c 'testID' {demoPath}/src/**/*.tsx
```

- 有 testID → 优先 `findElement({ testID })` 定位（最稳定）
- 无 testID（testerino demo 常见）→ 全部走 `textContains` 文本定位 + `type: 'Button'` 过滤

## 3. 结构特征识别

### 3.1 单页 vs 多页

| 特征 | 判断方法 | 导航策略 |
|------|----------|----------|
| 单页 ScrollView | 所有 TestSuite 直接渲染，无 Router/Navigation | 注册 `single-page` 自定义策略 |
| 有 deep link | demo 的 module.json5 有 scheme 配置 | 框架默认策略 |
| 有模块首页列表 | 首页是可点击的模块列表 | 默认点击导航 |

### 3.2 testerino 面板就绪标志

单页策略的 `navigateToTestScene` 等待锚点文本：

- `TOTAL`（testerino 统计面板的用例总数标签）——最通用
- 备选：第一个 TestSuite 的 name

### 3.3 结果渲染位置（决定断言策略）

| 渲染方式 | 实例 | 断言策略 |
|----------|------|----------|
| 固定前缀文本 | `错误信息：{...}` | `waitForText(前缀)` + 值校验 |
| map 渲染多行 | `{arr.map(item => <Text>当前值:{item}...</Text>)}` | waitForText 固定标志片段 |
| **裸值无前缀** | `{arr.map(item => <Text>{item}</Text>)}` | **快照差集**：点击前后全量文本差 |
| 无渲染仅 assert | 结果只在内部 state | 无法 UI 断言，跳过或降级为仅点击验证 |

## 4. 已知 demo bug 识别

点击按钮后若 demo 本身抛 RN 渲染错误（截图/日志出现 `"Text strings must be rendered within a <Text> component"`），说明该 TestCase 的 arrange 存在 bug（如 setState 传了非字符串对象直接渲染）。

处理原则：
1. **不改 demo**（测试对象是三方库行为，不是 demo 质量）
2. 断言放宽为"错误输出已触发"（错误文本非空 或 匹配渲染错误特征）
3. 测试代码注释注明：`// 注: demo 已知渲染 bug，此处仅验证错误场景触发`

## 5. 勘察产出物

Phase 1 结束时必须产出下表（测试文件生成的输入）：

```markdown
| # | 按钮 title（定位子串） | 结果文本前缀（精确含冒号） | 预期断言 | 备注 |
|---|------------------------|---------------------------|----------|------|
| 1 | 点击获取随机数(Int8Array) | 无前缀（裸数字×4） | 快照差集+值域 | |
| 2 | 测试普通数组应抛出 | 错误信息：（全角） | 含 Error 即通过 | demo 渲染 bug |
| ... |
```
