## 创建 RNOH example 壳层时必须预置 RNTesterList.ts 注册入口

### 问题现象

下游技能（rnoh-lib-demo-create / rnoh-cptf-api-test）探查 Demo 注册入口的**第一优先级是 `{projectRoot}/**/RNTesterList.ts`**（模式 A：`{key, category, module: require(...)}` 数组），而 example 模板原生只有 `App.tsx + tests/index.tsx` 模式、不含 RNTesterList——两者存在断层，导致后续 Demo 生成步骤探查不到注册入口。

### 解决方案

创建 example 壳层时在 `src/RNTesterList.ts` **预置模式 A 注册入口**：

- 首项指向 `{exampleDir}/{libName}` 的 index.tsx（结构：`{key: '{libName}', category: '{category}', module: require('./{libName}')}`）
- `App.tsx` 消费该列表渲染 Navigation 页面
- 同时预置 1 个冒烟 Demo（如 sqlite 库的 openDatabase→executeSql→close 全链路）验证注册链路与原生桥通，保证不是空壳

### 结果

后续 Demo 生成步骤只需向 RNTesterList.ts 数组追加 `{key, category, module}` 条目即完成注册，与下游技能（rnoh-lib-demo-create 等）的探查逻辑（RNTesterList.ts 第一优先级）无缝衔接。