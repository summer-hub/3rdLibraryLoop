# 鸿蒙化适配检查清单

## 按变更类型的适配要点

### 一、TurboModule spec 变更（`*Native*.ts`）

#### 新增方法

1. 更新 `package.json` 中源库版本，运行 `npm install`，spec 文件随源库 npm 包更新到 `node_modules/` 中
2. 运行 `npm run codegen`，检查生成的 C++ 头文件中是否包含新方法声明
3. 在鸿蒙侧 TurboModule 实现类（`*TurboModule.ets` 或 `*TurboModule.cpp`）中新增方法实现
4. 如果方法有返回值，确保返回类型与 spec 一致
5. 如果方法有 Promise/Callback 参数，确保异步处理逻辑正确

#### 删除/重命名方法

1. 更新 `package.json` 中源库版本，运行 `npm install`
2. 运行 `npm run codegen`
3. 删除鸿蒙侧对应的旧方法实现
4. 检查是否有其他代码引用了旧方法名，全部更新

#### 修改方法签名

1. 更新 `package.json` 中源库版本，运行 `npm install`
2. 运行 `npm run codegen`
3. 更新鸿蒙侧方法实现，匹配新的参数类型和返回类型
4. 检查调用方代码是否需要同步修改

### 二、Fabric 组件变更

#### 新增组件

1. 在 harmony 侧新增 `XxxComponentInstance.ets`（ArkTS 组件实例）
2. 新增 `XxxComponentDescriptor.cpp`（C++ 组件描述符）
3. 新增 `XxxPackage.ets` 和 `XxxPackage.cpp`（Package 注册）
4. 在 `RNPackagesFactory.ets` 中注册 Package
5. 在 `Index.ets` 中导出组件类型（`ARKTS_COMPONENT_xxx`）
6. 在 `PackageProvider.cpp` 中注册 C++ Package
7. 在 `CMakeLists.txt` 中添加编译目标

#### 新增组件 Props

1. 更新 `package.json` 中源库版本，运行 `npm install`，spec 文件自动更新到 `node_modules/` 中
2. 运行 `npm run codegen`，检查生成的 `XxxComponentProps.h` 是否包含新字段
3. 在 C++ ComponentInstance 的 `setProps` 方法中新增 props 处理逻辑
4. 在 ArkTS 侧同步传递新 props 到底层 ArkUI 组件
5. 如果新 props 需要特殊类型转换，在 C++ 侧添加类型转换代码

#### 修改组件事件

1. 更新 `package.json` 中源库版本，运行 `npm install`
2. 运行 `npm run codegen`
3. 在 C++ ComponentInstance 的事件发射器中新增/修改事件
4. 在 ArkTS 侧确保事件回调正确传递到 JS 层

### 三、JS 层变更

鸿蒙化三方库**不含 JS 代码**，JS 层由 `package.json` 中依赖的源库提供。JS 层变更无需手动同步文件。

#### 版本更新

1. 在鸿蒙化工程的 `package.json` 中将源库依赖版本更新到目标版本
2. 运行 `npm install` 安装新版本，`node_modules/` 中的 JS 代码自动更新
3. 运行 `npm run codegen`，codegen 会从 `node_modules/` 中读取最新的 spec 文件重新生成 C++/ArkTS 代码

#### 平台条件代码

部分鸿蒙化库可能通过 `package.json` 的 `harmony.autolinking` 或 codegen 配置引入鸿蒙专属逻辑，无需在 JS 层手动维护平台条件代码。

#### Codegen 与 Autolinking 的关系

| 维度 | Codegen | Autolinking |
|------|---------|-------------|
| **作用** | 从 JS spec 生成 C++/ArkTS 类型代码（Props.h、ShadowNodes.h 等） | 将已生成的 Package 注册到工程（修改 RNPackagesFactory.ets、PackageProvider.cpp 等） |
| **可替代性** | ❌ 不可省略 — 没有 codegen 产物 C++ 编译会失败 | ✅ 可用 `auto-integrate.sh` 脚本替代手动注册 |
| **执行时机** | 库开发阶段（`codegen-lib-harmony`）+ 应用构建阶段（`codegen-harmony`） | 库集成阶段 |

RNOH 没有运行时自动发现机制。`auto-integrate.sh` 脚本只是自动化修改注册文件，仍需单独运行 codegen。

### 四、依赖变更

#### 新增依赖

1. 在鸿蒙化工程的 package.json 中添加新依赖
2. 如果新依赖有原生代码（C++/ArkTS），需要额外集成：
   - 检查该依赖是否有 `@react-native-ohos/` 鸿蒙化版本
   - 如果有，使用鸿蒙化版本
   - 如果没有，评估是否可以纯 JS 使用，或需要自行鸿蒙化
3. 运行 `npm install`

#### 删除依赖

1. 从 package.json 中移除依赖
2. 清理代码中的 import 引用
3. 清理原生集成配置（RNPackagesFactory.ets、PackageProvider.cpp、CMakeLists.txt）
4. 运行 `npm install` 更新 lock 文件

---

## ArkTS 编译规则约束

在修改鸿蒙侧 ArkTS/C++ 代码时，必须遵守 ArkTS 编译规则。以下是适配过程中常见的问题和修复方法。

### 1. 对象字面量不能赋值给 Map

```
错误: const m: Map<string, string> = { 'key': 'value' }
修复: const m = new Map<string, string>(); m.set('key', 'value')
```

### 2. JSON.parse() 返回 any

```
错误: const data = JSON.parse(str); data.field  // any
修复: 定义 class/interface + as 断言
      interface Data { field: string }
      const data = JSON.parse(str) as Data
```

### 3. @Builder 参数不更新

```
问题: @Builder 方法的参数在首次渲染后被捕获，即使 @State 变化也不更新
修复: 用 @Component + @Prop 替代 @Builder

@Component
struct MySection {
  @Prop title: string = ''
  build() { Text(this.title) }
}
// 父组件: MySection({ title: this.myTitle })
```

### 4. 索引签名被禁止

```
错误: interface Foo { [key: string]: string }  // arkts-no-indexed-signatures
修复: 使用 Map<string, string> 或命名 interface
```

### 5. 循环类型别名被禁止

```
错误: type JsonValue = string | number | Array<JsonValue>
修复: type JsonValue = string | number | object  // 用 object 替代递归引用
```

### 6. 泛型参数不能推断

```
错误: mapper.getMapper(typeName)  // arkts-no-inferred-generic-params
修复: mapper.getMapper<JsonValue>(typeName)
```

### 7. unknown 类型被禁止

```
错误: JsonMapper<unknown>  // arkts-no-any-unknown
修复: 定义具体类型替代 unknown
```

### 8. 无类型对象字面量被禁止

```
错误: const result = {}  // arkts-no-untyped-obj-literals
修复: const result = {} as Record<string, string>
      或使用 new Map<string, string>()
```

---

## C++ 侧适配注意事项

### NAPI 引用管理

- 使用 `napi_ref` 管理 JS 对象生命周期，确保跨线程访问安全
- 在析构函数中释放所有 `napi_ref`
- 使用 `napi_threadsafe_function` 进行跨线程回调

### TurboModule 实现模式

```cpp
// 典型的 TurboModule 方法实现
napi_value MyTurboModule::getValue(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    // 参数提取
    std::string key;
    napi_get_value_string_utf8(env, args[0], ...);

    // 业务逻辑
    std::string value = doSomething(key);

    // 返回结果
    napi_value result;
    napi_create_string_utf8(env, value.c_str(), NAPI_AUTO_LENGTH, &result);
    return result;
}
```

### Fabric 组件 Props 处理

```cpp
void MyComponentInstance::setProps(folly::dynamic const& props) {
    // 逐个处理 props 字段
    if (props.count("propA")) {
        auto propA = props["propA"].asString();
        // 更新 ArkUI 组件属性
    }
    // 新增的 prop 需要在这里添加处理
    if (props.count("propY")) {
        auto propY = props["propY"].asInt();
        // 处理新增属性
    }
}
```

### CMakeLists.txt 更新

新增 C++ 源文件时，在 `CMakeLists.txt` 中添加：

```cmake
target_sources(rnoh_my_lib PRIVATE
    src/main/cpp/MyNewComponent.cpp
    src/main/cpp/MyNewComponentInstance.cpp
)
```
