# 接口规格说明文档模板

本模板定义 RNLibraryInterfaceAnalyzer 最终输出的 `接口规格说明.md` 文档结构。

> 脚本 `rn-render-spec-doc.cjs` 生成基础接口规格部分（第 1~4 节），AI 在此基础上补充第 5 节（鸿蒙化接口差异）。

---

## 文档结构

```markdown
# {libraryName} 接口规格说明

## 1. 概述
- 上游原库地址：{upstreamRepoUrl}
- 鸿蒙化仓库地址：{ohosRepoUrl}
- 库功能描述：（从 README 提取）

## 2. 入口文件与分析范围

**上游原库入口文件：** `index.js`（或实际路径，由脚本自动检测）

**分析涉及的源文件：**
- `src/index.ts`
- `android/src/main/java/.../MyModule.java`
- `ios/MyModule.m`
- ...（脚本输出的 sources 列表）

**鸿蒙化仓库入口文件：** `Index.ets`（或实际路径）

## 3. JS/TS 层导出接口

> 以下由 `rn-render-spec-doc.cjs` 自动生成，按类/模块分组

### 3.1 类 (Classes)

#### ClassName

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | ClassName | constructor(param1: type1) | 构造函数 |
| 2    |           | methodName(param: type): returnType | 方法描述 |
| 3    |           | static staticMethod(): returnType | 静态方法 |
| 4    |           | propertyName: type | 公开属性 |

### 3.2 接口/类型 (Interfaces/Types)

#### InterfaceName

| 序号 | 字段名 | 类型 | 必填 | 描述 |
|------|--------|------|------|------|
| 1    | field1 | string | 是 | 字段描述 |
| 2    | field2? | number | 否 | 可选字段 |

### 3.3 枚举 (Enums)

#### EnumName

| 序号 | 成员名 | 值 | 描述 |
|------|--------|-----|------|
| 1    | MEMBER_A | 'A' | 描述 |

### 3.4 函数 (Functions)

| 序号 | 函数名 | 参数 | 返回值 | 描述 |
|------|--------|------|--------|------|
| 1    | funcName | (param: type) | returnType | 函数描述 |

### 3.5 变量/常量 (Variables)

| 序号 | 变量名 | 类型 | 描述 |
|------|--------|------|------|
| 1    | CONST_NAME | type | 常量描述 |

### 3.6 TurboModule Spec

> 如果库使用 TurboModule 架构，脚本会自动提取 Native*.ts 中的 Spec 接口

#### ModuleName

| 序号 | 方法名 | 参数 | 返回值 | 事件 | 说明 |
|------|--------|------|--------|------|------|
| 1    | nativeMethod | (param: type) | Promise<void> | 否 | 方法描述 |

## 4. 原生模块导出接口（AI 补充）

> 脚本仅提取 JS/TS 层和 TurboModule Spec。如果库包含旧式原生模块（iOS RCT_EXPORT_MODULE / Android ReactPackage），AI 需手动补充此节。

### 4.1 iOS 原生模块

#### ModuleName

| 序号 | 方法名 | 参数 | 返回值 | 描述 |
|------|--------|------|--------|------|
| 1    | nativeMethod | (param: type) | Promise<void> | 方法描述 |

### 4.2 Android 原生模块（与 iOS 差异）

> 以下仅列出与 iOS 端差异的接口

| 序号 | 方法名 | iOS 签名 | Android 签名 | 差异说明 |
|------|--------|----------|--------------|----------|
| 1    | methodName | (param: String) | (param: String, extra: String) | Android 端多一个参数 |

## 5. 鸿蒙化接口差异（AI 补充）

> 鸿蒙化库接口默认与原库一致，以下仅列出差异项
>
> **文档来源说明**：{说明文档来源}

### 5.1 缺失接口 ❌

| 序号 | 接口名 | 原库位置 | 文档是否标注 | 说明 |
|------|--------|----------|--------------|------|
| 1    | methodName | ClassName.methodName | ✅ 已标注 | 鸿蒙化版本未实现，文档标注为 No |

### 5.2 新增接口 🆕

| 序号 | 接口名 | 鸿蒙化位置 | 文档是否标注 | 说明 |
|------|--------|------------|--------------|------|
| 1    | ohosMethod | Index.ets | ✅ 已标注 | 鸿蒙平台特有 API |

### 5.3 签名变更 ⚠️

| 序号 | 接口名 | 原库签名 | 鸿蒙化签名 | 文档是否标注 | 变更说明 |
|------|--------|----------|------------|--------------|----------|
| 1    | methodName | (param: string): void | (param: number): void | ⚠️ 部分标注 | 参数类型变更 |

> 💡 **文档是否标注列取值**：
> - ✅ 已标注：文档已列出该接口，HarmonyOS Support 列为 `No`/`partially`
> - ⚠️ 部分标注：文档列出接口但未说明差异
> - ❌ 未标注：文档中完全未提及该接口
> - — 不适用：该库无使用文档文件

（若无差异，注明"鸿蒙化版本接口与上游原库完全一致"）
```

## 文档生成流程

```
rn-extract-interfaces.cjs → interface-spec.json
                                      ↓
rn-render-spec-doc.cjs  → 接口规格说明_基础.md（第 1~3 节）
                                      ↓
AI 补充第 4 节（原生模块，如需） + 第 5 节（鸿蒙化差异）
                                      ↓
                          接口规格说明.md（最终文档）
```
