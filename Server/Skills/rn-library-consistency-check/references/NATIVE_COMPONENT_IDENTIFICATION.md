# RN 原生组件（ViewManager）识别与定位指南

本文档定义 RN 一致性检视中**原生组件（ViewManager）**的识别方法、注册链路定位流程和检视对比规范，确保检视人员能准确区分 TurboModule/NativeModule（方法级桥接）与原生组件（UI 组件桥接），并系统性地定位组件的完整注册链路。

> ⚠️ **核心定位**：RN 库可同时包含两类原生桥接——**TurboModule/NativeModule**（方法级桥接）和**原生组件（ViewManager）**（UI 组件桥接）。两者独立检视、独立扣分，不可混为一谈。

---

## 1. 原生组件 vs TurboModule/NativeModule 区分

### 1.1 两类桥接的本质区别

| 桥接类型 | 本质 | JS 层注册方式 | 代码特征 | 检视维度 |
|----------|------|---------------|----------|----------|
| TurboModule/NativeModule | 方法级桥接（JS 调用原生方法） | `TurboModuleRegistry.getEnforcing<Spec>('XXX')` 或 `NativeModules.XXX` | JS 层导出 `Spec extends TurboModule`，ArkTS 层继承 `TurboModule` | 方法签名、参数类型、返回值、事件 |
| 原生组件（ViewManager） | UI 组件桥接（JS 渲染原生视图） | `codegenNativeComponent<NativeProps>('ComponentName')` 或 `requireNativeComponent<Props>('ComponentName')` | JS 层定义 `NativeProps` + `NativeCommands`，ArkTS 层 `@Component export struct` 或 `@Component struct` | Props、Commands、事件发送、DescriptorWrapper |

### 1.2 判定流程

```
搜索 RN 库 JS 源码中的注册入口（搜索范围：src/ 目录及其所有子目录）：

1. 找到 codegenNativeComponent → ✅ 含 Codegen 原生组件 → 执行本文档 2A 流程
2. 找到 requireNativeComponent → ✅ 含 Legacy 原生组件 → 执行本文档 2B 流程
3. 找到 TurboModuleRegistry → ✅ 含 TurboModule → 仅执行方法级对比（见 FUNCTION_COMPARISON_GUIDE.md）
4. 找到 NativeModules 但无 1/2 → ✅ 仅含 NativeModule（方法级） → 仅执行方法级对比
5. 1+2+3 均找到 → ✅ 同时含原生组件和 TurboModule → 分别执行两类检视
6. 1+3 找到但无 2 → ✅ Codegen 原生组件 + TurboModule → 分别执行两类检视
7. 2+3 找到但无 1 → ✅ Legacy 原生组件 + TurboModule → 分别执行两类检视
8. 均未找到 → ❌ 纯 JS 库 → 无原生桥接检视需求
```

> 💡 **共存示例**：react-native-webview 同时有 `RNCWebView` 原生组件（codegenNativeComponent）和 `RNCWebViewModule` TurboModule（TurboModuleRegistry）。react-native-maps 同时有多个 Legacy 原生组件（requireNativeComponent）和 TurboModule（NativeModules）。

> ⚠️ **重要**：`requireNativeComponent` 是 RN 旧架构的原生组件注册方式，与 `codegenNativeComponent` 功能等价（都是注册 UI 组件），但注册链路追踪方式不同。不可因未找到 `codegenNativeComponent` 就判定库不含原生组件。

---

## 2. 原生组件注册链路定位流程

原生组件存在两种注册架构模式，必须先判定模式再执行对应流程：

| 模式 | JS 层特征 | OHOS Package 特征 | 识别方法 |
|------|-----------|-------------------|----------|
| **模式 A：Codegen 架构** | `codegenNativeComponent` | Package 有 `createDescriptorWrapperFactoryByDescriptorType` 返回组件名 → DescriptorWrapper 映射；存在 `generated/` 目录 | 找到 `codegenNativeComponent` |
| **模式 B：Legacy/Descriptor 架构** | `requireNativeComponent` 或无 JS 层组件注册宏 | Package 仅注册 TurboModule（无 `createDescriptorWrapperFactoryByDescriptorType`）；手动定义 Descriptor 类型；可能有 `ComponentFactory` 脚本路由 | 未找到 `codegenNativeComponent` 但找到 `requireNativeComponent` 或 `@Component struct` |

### 2A. Codegen 架构注册链路定位

此流程适用于 JS 层使用 `codegenNativeComponent` 的库（如 react-native-webview、react-native-video、react-native-screens、react-native-keyboard-controller 等）。

#### 2A.1 步骤 5a：定位 JS 层组件注册

| 项目 | 说明 |
|------|------|
| 搜索位置 | RN 库 `src/` 目录及其子目录（常见子目录：`src/specs/`、`src/`根目录） |
| 搜索关键词 | `codegenNativeComponent` |
| 文件名模式 | `*NativeComponent.ts`、`*NativeComponent.js` |
| 目的 | 定位 JS 层原生组件注册，提取组件名和 NativeProps 类型定义 |

**代码模式**：

```typescript
// Codegen 注册模式（典型）
export const RNCWebView = codegenNativeComponent<NativeProps>(
  'RNCWebView'
) as HostComponent<NativeProps>;

// 多组件库中每个组件独立注册
export default codegenNativeComponent<NativeProps>('RNSScreen', {});
export default codegenNativeComponent<NativeProps>('RNSScreenStack', {});
```

**NativeProps 类型定义模式**：

```typescript
// NativeProps 通常在同一文件或单独的 Types 文件中
export interface NativeProps extends ViewProps {
  javaScriptEnabled?: WithDefault<boolean, true>;
  source?: string | Object;
  cacheMode?: WithDefault<CacheModeEnum, 'DEFAULT>;
}

// NativeCommands 定义（可选）
export interface NativeCommands {
  goBack(viewRef: ReactElementRef<HostComponent<NativeProps>>): void;
  goForward(viewRef: ReactElementRef<HostComponent<NativeProps>>): void;
}
```

**提取要求**：
- 组件名（`codegenNativeComponent` 的字符串参数，如 `'RNCWebView'`、`'RNCVideo'`）
- **多组件库需提取所有组件名**（如 react-native-screens 有 11 个 `codegenNativeComponent`）
- NativeProps 接口文件路径和行号
- Props 完整列表（名称 + 类型）
- Commands 完整列表（名称 + 签名），若无 Commands 标注"⚠️ 无 Commands 定义"

#### 2A.2 步骤 5b：定位 OHOS Harmony 目录

| 项目 | 说明 |
|------|------|
| 搜索位置 | RN 库根目录下 |
| 关键标记 | `harmony/` 目录 |
| 目的 | 定位 OHOS 鸿蒙化代码的根目录 |

**Harmony 目录发现策略**：

```
1. 查找根目录下的 harmony/ 目录 → 大多数库的通用模式
2. 若根目录无 harmony/，查找子包目录（如 react-native-harmony-screens/harmony/）
3. 若仍无 harmony/ 目录 → ⛔ 该库可能未鸿蒙化，需进一步验证

harmony/ 目录内部结构：
  harmony/<module_name>/           ← 模块名各异（rn_webview, rn_video, maps, svg, picker, screens, keyboard_controller 等）
    <module_name>.har              ← 预编译产物
    src/main/ets/                  ← ArkTS 源码目录
    src/main/cpp/                  ← C++ 源码目录
    src/main/ets/generated/        ← Codegen 生成目录（模式 A 特征）
      components/                  ← 原生组件的 DescriptorWrapper 定义
      turboModules/                ← TurboModule 的类型定义
      index.ets
      ts.ts
```

> ⚠️ **模块名不固定**：不同库的 harmony 子目录命名各异。`<module_name>` 不可按库名硬推，需通过目录探索确定。常见映射：webview→rn_webview, video→rn_video, maps→maps, svg→svg, picker→picker, screens→screens。

#### 2A.3 步骤 5c：定位 Package 注册类

| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/ets/` 目录 |
| 搜索关键词 | `Package`（文件名 `*Package.ets` 或 `*Package.ts`） |
| 目的 | 定位 Package 注册类，提取原生组件名和 TurboModule 名 |

**两种 Package 基类的 API 区别**：

```typescript
// RNOHPackage（较新模式，如 react-native-webview）
export class RNCWebViewPackage extends RNOHPackage {
  createDescriptorWrapperFactoryByDescriptorType(ctx): DescriptorWrapperFactoryByDescriptorType {
    return {
      "RNCWebView": (ctx) => new RNC.RNCWebView.DescriptorWrapper(ctx.descriptor)
    }
  }
  createAnyThreadTurboModuleFactory(ctx): AnyThreadTurboModuleFactory {
    return new WebViewTurboModulesFactory(ctx);
  }
}

// RNPackage（常见模式，如 react-native-video）
export class RNCVideoPackage extends RNPackage {
  createDescriptorWrapperFactoryByDescriptorType(ctx): DescriptorWrapperFactoryByDescriptorType {
    return {
      [RNC.RNCVideo.NAME]: (ctx) => new RNC.RNCVideo.DescriptorWrapper(ctx.descriptor),
    };
  }
  createTurboModulesFactory(ctx: TurboModuleContext): TurboModulesFactory {
    return new RNCVideoTurboModulesFactory(ctx);
  }
}
```

> ⚠️ **Package 基类区别**：`RNOHPackage` 使用 `createAnyThreadTurboModuleFactory()` + `AnyThreadTurboModuleFactory`；`RNPackage` 使用 `createTurboModulesFactory()` + `TurboModulesFactory`。两者注册组件的方式相同（`createDescriptorWrapperFactoryByDescriptorType`），但 TurboModule 注册 API 不同。

> ⚠️ **文件扩展名**：Package 注册文件可以是 `.ets` 或 `.ts`，搜索时需同时覆盖两种扩展名。

**提取要求**：
- Package 类名和继承关系（`extends RNOHPackage` 或 `extends RNPackage`）
- `createDescriptorWrapperFactoryByDescriptorType` 返回值中所有组件名 → DescriptorWrapper 映射
- TurboModule 注册中所有 TurboModule 名
- Package 文件路径和行号

#### 2A.4 步骤 5d：定位 DescriptorWrapper 和 generated 类型

| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/ets/generated/components/` 目录 |
| 搜索关键词 | 组件名（如 `RNCWebView.ts`、`RNCVideo.ts`） |
| 目的 | 提取 Codegen 生成的完整类型定义 |

**generated/components/ComponentName.ts 的关键结构**：

```typescript
export namespace ComponentName {
  export const NAME = "ComponentName" as const     // 组件名常量

  export interface DirectRawProps {                  // 所有 Prop 定义（含类型）
    propA?: boolean;
    propB?: string;
    // ...
  }

  export interface Props extends ViewBaseProps {}    // 基础 Props
  export interface State {}                          // State 定义
  export interface RawProps extends ViewRawProps, DirectRawProps {}  // 完整 RawProps

  export class PropsSelector extends ViewPropsSelector<Props, RawProps> {
    get propA() { return this.rawProps.propA ?? false }  // 每个 Prop 的默认值
    get propB() { return this.rawProps.propB }            // 无默认值的 Prop
  }

  export type Descriptor = ComponentDescriptor<typeof NAME, Props, State, RawProps>

  export class DescriptorWrapper extends ViewDescriptorWrapperBase<...> {
    protected createPropsSelector() {
      return new PropsSelector(this.descriptor.props, this.descriptor.rawProps)
    }
  }

  export interface EventPayloadByName {              // 所有事件名 + Payload 类型
    "onLoad": {url: string, ...}
    "onError": {code: number, ...}
  }

  export class EventEmitter {
    emit<TEventName>(eventName: TEventName, payload: EventPayloadByName[TEventName]) {
      this.rnInstance.emitComponentEvent(this.tag, eventName, payload)
    }
  }

  export interface CommandArgvByName {               // 所有 Command 名 + 参数类型
    "goBack": []
    "injectJavaScript": [string]
  }

  export class CommandReceiver {
    subscribe<TCommandName>(commandName: TCommandName, listener: (argv: CommandArgvByName[TCommandName]) => void) {
      // ...
    }
  }
}
```

**提取要求**：
- `NAME` 常量值
- `DirectRawProps` 中所有 Prop 名 + 类型 + 默认值（从 `PropsSelector` 中提取）
- `EventPayloadByName` 中所有事件名 + Payload 类型
- `CommandArgvByName` 中所有 Command 名 + 参数类型
- 若 `CommandArgvByName` 为空接口 `{}`，标注"⚠️ 无 Commands 定义"
- 若 `generated/components/ts.ts` 仅导出空对象 `export {}`，标注"⚠️ 该组件未在 generated 中注册"

#### 2A.5 步骤 5e：定位 ArkTS 组件实现

| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/ets/` 目录（排除 generated 子目录） |
| 搜索关键词 | `@Component` + 组件名 |
| 目的 | 定位组件的实际 ArkTS 实现 |

**Codegen 架构的 ArkTS 组件实现模式**：

```typescript
// 典型 Codegen 架构实现（如 RNCWebView）
@Component
export struct RNCWebView {
  public static readonly NAME = RNC.RNCWebView.NAME
  ctx!: RNComponentContext
  tag: number = 0

  // Props 读取方式 1：通过 DescriptorWrapper.rawProps（常见于较早版本）
  aboutToAppear() {
    const javaScriptEnabled = this.descriptorWrapper.rawProps.javaScriptEnabled
  }

  // Props 读取方式 2：通过 ctx.descriptorRegistry（较新版本）
  aboutToAppear() {
    this.descriptor = this.ctx.descriptorRegistry.getDescriptor<Descriptor>(this.tag)
    this.descriptor.rawProps.javaScriptEnabled
  }

  // Commands 注册方式 1：通过 CommandReceiver.subscribe（Codegen generated 方式）
  aboutToAppear() {
    const commandReceiver = new RNC.RNCWebView.CommandReceiver(
      this.ctx.componentCommandReceiver, this.tag
    )
    commandReceiver.subscribe("goBack", (argv) => { this.goBack() })
  }

  // Commands 注册方式 2：通过 ctx.componentCommandReceiver（直接注册）
  aboutToAppear() {
    this.ctx.componentCommandReceiver.registerCommandCallback(this.tag, (command, args) => {
      if (command === 'goBack') { this.goBack() }
    })
  }

  // 事件发送方式 1：通过 generated EventEmitter
  private emitter = new RNC.RNCWebView.EventEmitter(this.ctx.rnInstance, this.tag)
  onNavigationStateChange(event) {
    this.emitter.emit("onNavigationStateChange", {url: event.url, ...})
  }

  // 事件发送方式 2：通过 ctx.rnInstance.emitComponentEvent
  this.ctx.rnInstance.emitComponentEvent(this.tag, "onNavigationStateChange", {url: ...})

  build() {
    Web({ src: this.source, controller: this.controller })
      .javaScriptAccess(this.javaScriptEnabled)
  }
}
```

**提取要求**：
- `@Component export struct` 或 `@Component struct` 组件名
- Props 读取方式和读取的 Prop 名列表
- Command 注册方式和注册的 Command 名列表
- 事件发送方式和发送的事件名列表
- 组件文件路径和关键行号

#### 2A.6 步骤 5f：定位 C++ Package 注册层

| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/cpp/` 目录 |
| 搜索关键词 | `*Package.h`、`*Package.cpp`、`generated/RNOH/` |
| 目的 | 定位 C++ 层的组件注册和 TurboModule 注册，提取 JSIBinder 和 NapiBinder 映射 |

**C++ Package 的两种模式**：

```cpp
// 模式 1：Thin Wrapper（如 react-native-webview、react-native-video、react-native-screens 等）
// 仅继承 generated BaseReactNative*Package，不重写任何方法
class WebViewPackage : public BaseReactNativeWebViewPackage {
    using Super = BaseReactNativeWebViewPackage;
    // 所有注册逻辑由 generated BaseReactNativeWebViewPackage 提供
};

// 模式 2：Hand-Written Package（如 react-native-maps、react-native-svg 等）
// 手动实现所有注册方法，不依赖 generated
class MapsPackage : public Package {
    MapsPackage(Package::Context ctx) : Package(ctx) {}

    std::vector<react::ComponentDescriptorProvider> createComponentDescriptorProviders() {
        return {
            // 手动列出每个组件的 DescriptorProvider
            facebook::react::AIRMapComponentDescriptorProvider(),
            facebook::react::AIRMapMarkerComponentDescriptorProvider(),
        };
    }

    ComponentJSIBinderByString createComponentJSIBinderByName() {
        return {
            // 手动列出每个组件名 → JSIBinder 映射
            {"AIRMap", std::make_shared<AIRMapJSIBinder>()},
            {"AIRMapMarker", std::make_shared<AIRMapMarkerJSIBinder>()},
        };
    }

    ComponentNapiBinderByString createComponentNapiBinderByName() {
        return {
            // 手动列出每个组件名 → NapiBinder 映射
            {"AIRMap", std::make_shared<AIRMapNapiBinder>()},
        };
    }

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() {
        return std::make_unique<MapsTurboModuleFactoryDelegate>();
    }
};
```

> ⚠️ **关键区别**：Thin Wrapper 模式的所有注册逻辑在 `generated/RNOH/generated/BaseReactNative*Package.h` 中自动生成，组件名、JSIBinder、NapiBinder、EventEmitRequestHandler 等均由 codegen 产出，不需要手动维护。Hand-Written 模式需手动实现所有注册方法。

**generated C++ 目录结构（Codegen 架构专属）**：

```
harmony/<module_name>/src/main/cpp/generated/RNOH/generated/
  BaseReactNative<LibName>Package.h    ← 自动生成的 Package 基类
    # 包含：
    #   BaseReactNative*PackageTurboModuleFactoryDelegate   ← TurboModule 工厂
    #   BaseReactNative*PackageEventEmitRequestHandler      ← 事件处理器
    #   BaseReactNative*Package                             ← Package 基类
    #     createComponentDescriptorProviders()                ← 自动生成的组件列表
    #     createComponentJSIBinderByName()                   ← 自动生成的 JSIBinder 映射
    #     createComponentNapiBinderByName()                  ← 自动生成的 NapiBinder 映射
    #     createTurboModuleFactoryDelegate()                 ← 自动生成的 TurboModule 工厂

  components/
    ComponentNameJSIBinder.h              ← 自动生成的 JSIBinder（含 Props 序列化）
    ComponentNameNapiBinder.h             ← 自动生成的 NapiBinder（含 ArkTS ↔ C++ 属性绑定）

  turboModules/
    TurboModuleNameJSIBinder.h            ← 自动生成的 TurboModule JSIBinder
```

**C++ JSIBinder 的关键结构（Props 序列化）**：

```cpp
// generated/components/RNCWebViewJSIBinder.h（Codegen 自动生成）
class RNCWebViewJSIBinder : public ViewComponentJSIBinder {
    facebook::jsi::Object createJSIBinder(facebook::jsi::Runtime &rt) override {
        auto obj = ViewComponentJSIBinder::createJSIBinder(rt);
        // 每个 Prop 的序列化：propName → runtime 中写入
        obj.setProperty(rt, "allowFileAccess", createValue(rt, allowFileAccess_));
        obj.setProperty(rt, "javaScriptEnabled", createValue(rt, javaScriptEnabled_));
        obj.setProperty(rt, "cacheMode", createValue(rt, cacheMode_));
        // ... 所有 Props 逐一序列化
        return obj;
    }

    // Props 值存储（通常为默认值或从 rawProps 读取）
    bool allowFileAccess_ = false;
    bool javaScriptEnabled_ = true;
    std::string cacheMode_ = "LOAD_DEFAULT";
};

// Hand-Written JSIBinder（如 react-native-maps）
class AIRMapJSIBinder : public ViewComponentJSIBinder {
    facebook::jsi::Object createJSIBinder(facebook::jsi::Runtime &rt) override {
        auto obj = ViewComponentJSIBinder::createJSIBinder(rt);
        obj.setProperty(rt, "provider", createValue(rt, provider_));
        obj.setProperty(rt, "mapType", createValue(rt, mapType_));
        obj.setProperty(rt, "zoomEnabled", createValue(rt, zoomEnabled_));
        // ... 手动列出所有 Props
        return obj;
    }
    std::string provider_;
    std::string mapType_;
    bool zoomEnabled_;
};
```

> ⚠️ **JSIBinder 是 C++ 层 Props 定义的关键文件**：`createJSIBinder()` 方法中的 `obj.setProperty(rt, "propName", ...)` 列出了该组件在 C++ 层注册的所有 Prop 名和默认值。这与 OHOS ArkTS `DirectRawProps`/`PropsSelector` 应完全一致。

**C++ NapiBinder 的关键结构（ArkTS ↔ C++ 属性桥接）**：

```cpp
class RNCWebViewNapiBinder : public ViewComponentNapiBinder {
    napi_value createNapiBinder(napi_env env, napi_value thisObj) override {
        // 将 ArkTS @Component struct 的属性绑定到 C++ 实例
        NapiBinder::setProperty(env, thisObj, "javaScriptEnabled", javaScriptEnabled_);
        NapiBinder::setProperty(env, thisObj, "cacheMode", cacheMode_);
        // ... 所有从 ArkTS 读取的 Props
        return thisObj;
    }
};
```

**C++ EventEmitRequestHandler（事件发送桥接）**：

```cpp
// generated 中自动生成
class BaseReactNativeWebViewPackageEventEmitRequestHandler : public EventEmitRequestHandler {
    void handleEvent(ConcurrentMessageQueue &mq, std::string eventName, napi_value eventPayload) override {
        // 事件名 → JS 层事件映射
        if (eventName == "onNavigationStateChange") { /* 处理 */ }
        if (eventName == "onMessage") { /* 处理 */ }
        // ...
    }
};
```

**C++ TurboModuleFactoryDelegate（TurboModule 注册）**：

```cpp
// generated 中自动生成
class BaseReactNativeWebViewPackageTurboModuleFactoryDelegate : public TurboModuleFactoryDelegate {
    std::unique_ptr<TurboModule> createTurboModule(std::string turboModuleName, TurboModule::Context ctx) override {
        if (turboModuleName == "RNCWebViewModule") {
            return std::make_unique<RNCWebViewModule>(ctx);
        }
        return nullptr;
    }
};

// Hand-Written TurboModuleFactoryDelegate（如 react-native-maps）
class MapsTurboModuleFactoryDelegate : public TurboModuleFactoryDelegate {
    std::unique_ptr<TurboModule> createTurboModule(std::string turboModuleName, TurboModule::Context ctx) override {
        if (turboModuleName == "AIRMapManager") {
            return std::make_unique<AIRMapManagerTurboModule>(ctx);
        }
        if (turboModuleName == "AIRMapMarkerManager") {
            return std::make_shared<AIRMapMarkerManagerTurboModule>(ctx);
        }
        return nullptr;
    }
};
```

**C++ ComponentInstanceFactoryDelegate（组件实例创建）**：

```cpp
// 如 react-native-svg 的 C++ Package
class SVGPackageComponentInstanceFactoryDelegate : public ComponentInstanceFactoryDelegate {
    ComponentInstance::Shared createComponentInstance(const ComponentInstance::Context &ctx) override {
        // 根据组件名创建对应的 C++ 组件实例
        if (ctx.componentName == "RNSVGSvgView") {
            return std::make_shared<RNSVGSvgViewComponentInstance>(ctx);
        }
        if (ctx.componentName == "RNSVGCircle") {
            return std::make_shared<RNSVGCircleComponentInstance>(ctx);
        }
        // ...
    }
};
```

> ⚠️ **ComponentInstanceFactoryDelegate 仅在需要 C++ 原生视图的组件中出现**。大多数 Codegen 架构的组件不使用此模式（视图完全由 ArkTS 渲染），但像 react-native-svg 这种复杂组件需要 C++ 层创建原生视图实例。

**CMakeLists.txt 分析**：

```cmake
# CMakeLists.txt 列出了所有编译的 C++ 源文件
add_library(rnoh_webview SHARED
    WebViewPackage.cpp               # 手写的 Package 实现
    generated/RNOH/generated/RNCWebViewJSIBinder.cpp
    generated/RNOH/generated/RNCWebViewNapiBinder.cpp
    # ... 其他 generated 源文件
)
target_link_libraries(rnoh_webview PUBLIC rnoh_core)
```

**提取要求**：
- C++ Package 类名和继承模式（Thin Wrapper vs Hand-Written）
- 若为 Thin Wrapper，定位 `generated/RNOH/generated/BaseReactNative*Package.h` 并提取：
  - `createComponentDescriptorProviders()` 中所有组件名
  - `createComponentJSIBinderByName()` 中所有组件名 → JSIBinder 映射
  - `createComponentNapiBinderByName()` 中所有组件名 → NapiBinder 映射
  - `BaseReactNative*PackageEventEmitRequestHandler` 中所有事件名
  - `BaseReactNative*PackageTurboModuleFactoryDelegate` 中所有 TurboModule 名
- 若为 Hand-Written，从 Package.h/cpp 中直接提取上述信息
- 从每个组件的 JSIBinder 中提取所有 Prop 名 + 默认值（`obj.setProperty(rt, "propName", ...)` 模式）
- 从每个组件的 NapiBinder 中提取 ArkTS → C++ 属性桥接的 Prop 名
- 从 TurboModuleFactoryDelegate 中提取所有 TurboModule 名
- 从 ComponentInstanceFactoryDelegate 中提取所有组件实例名（如有）
- CMakeLists.txt 中编译的源文件列表
- 若 C++ 层无组件注册，标注"⚠️ C++ 层无组件注册"

---

### 2B. Legacy/Descriptor 架构注册链路定位

此流程适用于 JS 层使用 `requireNativeComponent` 的库，或 JS 层无组件注册宏但 OHOS 层有 `@Component struct` 实现的库（如 react-native-maps、react-native-svg 等）。

#### 2B.1 步骤 5a：定位 JS 层组件注册

| 项目 | 说明 |
|------|------|
| 搜索位置 | RN 库 `src/` 目录及其子目录 |
| 搜索关键词 | `requireNativeComponent` |
| 目的 | 定位 Legacy 原生组件注册，提取组件名 |

**代码模式**：

```typescript
// requireNativeComponent 直接注册
const RNCWebView = requireNativeComponent<NativeProps>('RNCWebView');

// react-native-maps 的封装模式
function getNativeComponentName(provider, componentName) {
  return provider === 'google'
    ? `AIRGoogle${componentName}`
    : `AIR${componentName}`;
}
components[key] = requireNativeComponent(nativeComponentName);

// 典型 requireNativeComponent 注册
export default requireNativeComponent<NativeProps>('AIRMap');
```

> ⚠️ **动态组件名**：`requireNativeComponent` 的组件名参数可能是动态拼接的（如 react-native-maps 的 `AIRMap` vs `AIRGoogleMap`），需追踪完整的命名逻辑。

**无 JS 层组件注册的特殊情况**：

```typescript
// react-native-svg 在 JS 层不使用 requireNativeComponent 或 codegenNativeComponent
// 其原生组件通过纯 ArkTS/C++ 层注册，JS 层仅使用 SVG XML 渲染
// 此时需跳过 JS 层搜索，直接从 OHOS 层开始定位
```

**提取要求**：
- 所有 `requireNativeComponent` 注册的组件名（含动态拼接逻辑）
- 组件对应的 Props 类型定义文件路径
- 若 JS 层无组件注册宏，标注"⚠️ JS 层无原生组件注册宏，从 OHOS 层直接定位"

#### 2B.2 步骤 5b：定位 OHOS Harmony 目录

同 2A.2，此处不再重复。

#### 2B.3 步骤 5c：定位 Package 注册类和 ComponentFactory

| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/ets/` 目录 |
| 搜索关键词 | `Package`、`ComponentFactory` |
| 目的 | 定位 Package 注册类和组件路由机制 |

**Legacy 架构的 Package 模式**：

```typescript
// 仅注册 TurboModule 的 Package（如 react-native-maps）
export class MapsPackage extends RNPackage {
  createTurboModulesFactory(ctx: TurboModuleContext): TurboModulesFactory {
    return new MapsTurboModulesFactory(ctx);  // 仅 TurboModule，无 createDescriptorWrapperFactoryByDescriptorType
  }
}

// 仅注册 TurboModule 的 Package（如 react-native-svg）
export class SvgPackage extends RNPackage {
  createTurboModulesFactory(ctx: TurboModuleContext): TurboModulesFactory {
    return new SvgTurboModulesFactory(ctx);  // 仅 TurboModule，无组件注册
  }
}
```

> ⚠️ **关键区别**：Legacy 架构的 Package 可能**不包含** `createDescriptorWrapperFactoryByDescriptorType` 方法。原生组件的注册通过其他机制实现（C++ Package、ComponentFactory、descriptorRegistry），而非 ArkTS Package。

**ComponentFactory 路由模式**：

```typescript
// 多组件库的 ComponentFactory 路由（如 react-native-maps）
@Component
export struct MapsComponentFactory {
  public ctx!: RNComponentContext;
  public tag: number = 0;
  @State private componentName: string = '';

  setDescriptor(newDescriptor: Descriptor) {
    this.componentName = newDescriptor.type;  // 从 descriptor 提取组件名
  }

  build() {
    if (this.componentName === AIR_MAP_MARKER_TYPE) {
      AIRMapMarker({ ctx: this.ctx, tag: this.tag })
    } else if (this.componentName === AIR_MAP_POLYLINE_TYPE) {
      AIRMapPolyline({ ctx: this.ctx, tag: this.tag })
    } else if (this.componentName === AIR_MAP_CIRCLE_TYPE) {
      AIRMapCircle({ ctx: this.ctx, tag: this.tag })
    }
    // ... 更多组件路由
  }
}
```

**提取要求**：
- Package 类名和继承关系
- Package 中是否有 `createDescriptorWrapperFactoryByDescriptorType`（若无则标注"⚠️ Package 无组件注册方法，组件通过其他机制注册"）
- TurboModule 名列表
- 若有 ComponentFactory，提取所有路由的组件名列表
- C++ Package 中注册的组件名（如有 `*Package.h`/`*Package.cpp`）

#### 2B.4 步骤 5d：定位手动定义的 Descriptor 类型

| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/ets/` 目录 |
| 搜索关键词 | `Descriptor<`、`RawProps extends ViewRawProps` |
| 目的 | 定位手动定义的组件 Descriptor 类型（替代 generated/ 目录） |

**手动 Descriptor 定义模式**：

```typescript
// react-native-maps 的手动 Descriptor 定义
export interface AIRMapRawProps extends ViewRawProps {
  cacheEnabled?: boolean;
  camera?: Camera;
  region?: Region;
  mapType?: MapType;
  zoomEnabled: boolean;
  scrollEnabled: boolean;
  showsUserLocation: boolean;
  // ...
}
export type AIRMapDescriptor = Descriptor<"AIRMap", ViewBaseProps, AIRMapState, AIRMapRawProps>
```

> ⚠️ **区别**：Codegen 架构的 Descriptor 从 `generated/` 自动生成，Legacy 架构的 Descriptor 是**手动定义**的。手动定义的 RawProps 接口直接 `extends ViewRawProps`，类型为 `Descriptor<...>` 而非通过 `DescriptorWrapper`。

**提取要求**：
- 所有 `*RawProps` 接口中定义的 Prop 名 + 类型
- 所有 `*Descriptor` 类型定义（组件名 + 泛型参数）
- Descriptor 定义文件路径和行号

#### 2B.5 步骤 5e：定位 ArkTS 组件实现

| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/ets/` 目录（及子目录如 `AIRMaps/`） |
| 搜索关键词 | `@Component` |
| 目的 | 定位所有 `@Component struct` 实现 |

**Legacy 架构的 ArkTS 组件实现模式**：

```typescript
// 典型 Legacy 架构实现（如 AIRMap）
@Component
export struct AIRMap {
  ctx!: RNComponentContext
  tag: number = 0
  @State descriptor: AIRMapDescriptor = {} as AIRMapDescriptor

  aboutToAppear() {
    // Props 读取：通过 descriptorRegistry + 手动 Descriptor
    this.descriptor = this.ctx.descriptorRegistry.getDescriptor<AIRMapDescriptor>(this.tag)
    this.descriptor.rawProps.javaScriptEnabled
    this.descriptor.rawProps.scrollEnabled
  }

  // 动态 Props 更新：订阅 descriptor 变化
  aboutToAppear() {
    this.cleanUpCallbacks.push(this.ctx.descriptorRegistry.subscribeToDescriptorChanges(
      this.tag, (newDescriptor) => {
        this.descriptor = newDescriptor as AIRMapDescriptor
        this.mapController?.setZoomGesturesEnabled(this.descriptor.rawProps.zoomEnabled)
      }
    ));
  }

  // Commands 注册：通过 ctx.componentCommandReceiver
  aboutToAppear() {
    this.ctx.componentCommandReceiver.registerCommandCallback(
      this.tag,
      (command, args) => {
        // switch/if 分发命令
      }
    )
  }

  // 事件发送：通过 ctx.rnInstance.emitComponentEvent 或 TurboModule
  this.ctx.rnInstance.emitComponentEvent(this.tag, "onRegionChange", {region: ...})
}
```

**提取要求**：
- 所有 `@Component struct` 组件名列表（多组件库可能有 10+ 个组件）
- 每个组件的 Props 读取方式和 Prop 名列表
- 每个组件的 Command 注册方式和 Command 名列表
- 每个组件的事件发送方式和事件名列表
- 组件文件路径和关键行号

#### 2B.6 步骤 5f：定位 C++ Package 注册层
| 项目 | 说明 |
|------|------|
| 搜索位置 | `harmony/<module_name>/src/main/cpp/` 目录 |
| 搜索关键词 | `*Package.h`、`*Package.cpp`、`*JSIBinder.h`、`*NapiBinder.h`、`ComponentDescriptorProvider` |
| 目的 | 定位 C++ 层的组件注册、Props 序列化、TurboModule 注册（Legacy 架构的组件主要通过 C++ 注册） |

> ⚠️ **Legacy 架构的 C++ Package 是组件注册的核心层**：由于 ArkTS Package 中无 `createDescriptorWrapperFactoryByDescriptorType`，组件的注册完全依赖 C++ Package。C++ Package 的 `createComponentJSIBinderByName()` 和 `createComponentNapiBinderByName()` 定义了组件名 → 绑定器的映射，而 JSIBinder 中列出了每个组件的所有 Props。

**Legacy 架构 C++ Package 的 Hand-Written 模式**：

```cpp
// react-native-maps 的 C++ Package（完全手写）
class MapsPackage : public Package {
    MapsPackage(Package::Context ctx) : Package(ctx) {}

    std::vector<react::ComponentDescriptorProvider> createComponentDescriptorProviders() override {
        return {
            facebook::react::AIRMapComponentDescriptorProvider(),
            facebook::react::AIRMapMarkerComponentDescriptorProvider(),
            facebook::react::AIRMapPolylineComponentDescriptorProvider(),
            facebook::react::AIRMapPolygonComponentDescriptorProvider(),
            facebook::react::AIRMapCircleComponentDescriptorProvider(),
            // ... 所有组件
        };
    }

    ComponentJSIBinderByString createComponentJSIBinderByName() override {
        return {
            {"AIRMap", std::make_shared<AIRMapJSIBinder>()},
            {"AIRMapMarker", std::make_shared<AIRMapMarkerJSIBinder>()},
            {"AIRMapPolyline", std::make_shared<AIRMapPolylineJSIBinder>()},
            // ... 组件名 → JSIBinder 映射
        };
    }

    ComponentNapiBinderByString createComponentNapiBinderByName() override {
        return {
            {"AIRMap", std::make_shared<AIRMapNapiBinder>()},
            // ... 组件名 → NapiBinder 映射
        };
    }

    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override {
        return std::make_unique<MapsTurboModuleFactoryDelegate>();
    }
};

// react-native-svg 的 C++ Package（大量子组件 + ComponentInstanceFactoryDelegate）
class SVGPackage : public Package {
    // createComponentDescriptorProviders(): 27+ SVG 子组件
    // createComponentJSIBinderByName(): 27+ 组件名 → JSIBinder
    // createComponentNapiBinderByName(): 返回空 {} (不使用 NapiBinder)

    // 特殊：使用 ComponentInstanceFactoryDelegate 创建 C++ 原生视图实例
    std::shared_ptr<ComponentInstanceFactoryDelegate> createComponentInstanceFactoryDelegate() override {
        return std::make_shared<SVGPackageComponentInstanceFactoryDelegate>();
    }
};

class SVGPackageComponentInstanceFactoryDelegate : public ComponentInstanceFactoryDelegate {
    ComponentInstance::Shared createComponentInstance(const ComponentInstance::Context &ctx) override {
        if (ctx.componentName == "RNSVGSvgView") {
            return std::make_shared<RNSVGSvgViewComponentInstance>(ctx);
        }
        if (ctx.componentName == "RNSVGCircle") {
            return std::make_shared<RNSVGCircleComponentInstance>(ctx);
        }
        // ... 每个组件创建对应的 C++ 实例
    }
};
```

**Legacy 架构的 JSIBinder 结构（Props 序列化）**：

```cpp
// AIRMapJSIBinder.h
class AIRMapJSIBinder : public ViewComponentJSIBinder {
    facebook::jsi::Object createJSIBinder(facebook::jsi::Runtime &rt) override {
        auto obj = ViewComponentJSIBinder::createJSIBinder(rt);
        obj.setProperty(rt, "provider", createValue(rt, provider_));
        obj.setProperty(rt, "mapType", createValue(rt, mapType_));
        obj.setProperty(rt, "zoomEnabled", createValue(rt, zoomEnabled_));
        obj.setProperty(rt, "scrollEnabled", createValue(rt, scrollEnabled_));
        obj.setProperty(rt, "showsUserLocation", createValue(rt, showsUserLocation_));
        // ... 手动列出所有 Props
        return obj;
    }

    // Props 默认值
    std::string provider_ = "google";
    std::string mapType_ = "standard";
    bool zoomEnabled_ = true;
    bool scrollEnabled_ = true;
    bool showsUserLocation_ = false;
};

// SVG 子组件的 JSIBinder（继承 ViewComponentJSIBinder）
class RNSVGSvgViewJSIBinder : public ViewComponentJSIBinder {
    facebook::jsi::Object createJSIBinder(facebook::jsi::Runtime &rt) override {
        auto obj = ViewComponentJSIBinder::createJSIBinder(rt);
        obj.setProperty(rt, "bbWidth", createValue(rt, bbWidth_));
        obj.setProperty(rt, "bbHeight", createValue(rt, bbHeight_));
        // ...
        return obj;
    }
};
```

**Legacy 架构的 TurboModuleFactoryDelegate**：

```cpp
class MapsTurboModuleFactoryDelegate : public TurboModuleFactoryDelegate {
    std::unique_ptr<TurboModule> createTurboModule(std::string turboModuleName, TurboModule::Context ctx) override {
        if (turboModuleName == "AIRMapManager") {
            return std::make_unique<AIRMapManagerTurboModule>(ctx);
        }
        if (turboModuleName == "AIRMapMarkerManager") {
            return std::make_unique<AIRMapMarkerManagerTurboModule>(ctx);
        }
        return nullptr;
    }
};
```

**提取要求**：
- C++ Package 类名和继承模式（全部 Hand-Written）
- `createComponentDescriptorProviders()` 中注册的所有组件名
- `createComponentJSIBinderByName()` 中所有组件名 → JSIBinder 映射
- `createComponentNapiBinderByName()` 中所有组件名 → NapiBinder 映射
- 每个 JSIBinder 中 `obj.setProperty(rt, "propName", ...)` 列出的所有 Prop 名 + 默认值
- `createTurboModuleFactoryDelegate()` 或直接 `TurboModuleFactoryDelegate` 中所有 TurboModule 名
- `createComponentInstanceFactoryDelegate()` 中所有组件实例名（如有，如 react-native-svg）
- CMakeLists.txt 中编译的源文件列表
- 若 C++ 层无组件注册，标注"⚠️ C++ 层无组件注册"

---

## 3. 搜索结果记录模板

完成定位流程后，必须将结果整理为以下格式。根据架构模式选择对应模板。

### 3.1 Codegen 架构注册链路表

```markdown
| 原生组件名 | JS 层注册文件:行号 | NativeProps 类型文件 | generated 类型文件 | Package 注册文件:行号 | C++ Package 模式 | C++ JSIBinder 文件 | ArkTS 实现文件:行号 |
|------------|-------------------|--------------------|--------------------|---------------------|----------------|-------------------|---------------------|
| RNCWebView | RNCWebViewNativeComponent.ts:355 | RNCWebViewNativeComponent.ts:151 | generated/components/RNCWebView.ts:19 | RNCWebViewPackage.ets:16 | Thin Wrapper (BaseReactNativeWebViewPackage) | generated/RNOH/generated/components/RNCWebViewJSIBinder.h | RNCWebView.ets:51 |
| RNCVideo | VideoNativeComponent.ts:409 | VideoNativeComponent.ts:22 | generated/components/RNCVideo.ts:19 | RNCVideoPackage.ts:54 | Thin Wrapper (BaseReactNativeVideoPackage) | generated/RNOH/generated/components/RNCVideoJSIBinder.h | RNCVideo.ets:108 |
```

### 3.2 Legacy 架构注册链路表

```markdown
| 原生组件名 | JS 层注册方式 | JS 注册文件:行号 | Descriptor 类型文件 | ComponentFactory 文件 | Package 注册文件:行号 | C++ Package 模式 | C++ JSIBinder 文件 | ArkTS 实现文件:行号 |
|------------|-------------|-----------------|--------------------|----------------------|---------------------|----------------|-------------------|---------------------|
| AIRMap | requireNativeComponent | MapViewNativeComponent.ts:1226 | AIRMapDescriptorTypes.ts:69 | MapsComponentFactory.ets:48 | MapsPackage.ts:48 | Hand-Written (MapsPackage) | AIRMapJSIBinder.h | AIRMaps/AIRMap.ets:47 |
| AIRMapMarker | requireNativeComponent | MapMarkerNativeComponent.ts | AIRMapDescriptorTypes.ts:86 | MapsComponentFactory.ets:76 | MapsPackage.ts:48 | Hand-Written (MapsPackage) | AIRMapMarkerJSIBinder.h | AIRMaps/AIRMapMarker.ets:31 |
```

### 3.3 完整搜索记录示例

**Codegen 架构示例（react-native-webview）**：

```
模式判定: Codegen 架构（codegenNativeComponent）

5a: src/RNCWebViewNativeComponent.ts
    → codegenNativeComponent<NativeProps>('RNCWebView') as HostComponent<NativeProps>
    → 组件名: "RNCWebView"
    → NativeProps 接口: 35+ Props + 11 Commands

5b: harmony/rn_webview/
    → 模块名: rn_webview

5c: harmony/rn_webview/src/main/ets/RNCWebViewPackage.ets
    → class RNCWebViewPackage extends RNOHPackage
    → createDescriptorWrapperFactoryByDescriptorType: { "RNCWebView": RNC.RNCWebView.DescriptorWrapper }
    → createAnyThreadTurboModuleFactory: WebViewTurboModulesFactory
    → TurboModule: RNCWebViewModule.NAME

5d: harmony/rn_webview/src/main/ets/generated/components/RNCWebView.ts
    → NAME = "RNCWebView"
    → DirectRawProps: 50+ Props with types
    → PropsSelector: default values for each prop
    → EventPayloadByName: 14 events
    → CommandArgvByName: 11 commands

5e: harmony/rn_webview/src/main/ets/RNCWebView.ets
    → @Component export struct RNCWebView
    → 包含 Props 处理、事件发送、命令回调注册

5f: harmony/rn_webview/src/main/cpp/WebViewPackage.h
    → C++ Package 模式: Thin Wrapper (继承 BaseReactNativeWebViewPackage)
    → generated/RNOH/generated/BaseReactNativeWebViewPackage.h:
        → createComponentDescriptorProviders: [RNCWebView]
        → createComponentJSIBinderByName: {"RNCWebView" → RNCWebViewJSIBinder}
        → createComponentNapiBinderByName: {"RNCWebView" → RNCWebViewNapiBinder}
        → EventEmitRequestHandler: 14 events (onNavigationStateChange, onMessage, etc.)
        → TurboModuleFactoryDelegate: RNCWebViewModule
    → JSIBinder Props: 50+ props (obj.setProperty(rt, "javaScriptEnabled", ...), etc.)
    → NapiBinder Props: 桥接 ArkTS 属性到 C++
```

**Legacy 架构示例（react-native-maps）**：

```
模式判定: Legacy 架构（requireNativeComponent）

5a: src/MapView.tsx + src/decorateMapComponent.ts
    → requireNativeComponent('AIRMap') + requireNativeComponent('AIRGoogleMap')
    → 组件名: AIRMap, AIRMapMarker, AIRMapPolyline, AIRMapPolygon, AIRMapCircle, AIRMapCallout, etc.
    → NativeModules: AirMapModule, AIRMapManager

5b: harmony/maps/
    → 模块名: maps

5c: harmony/maps/src/main/ets/MapsPackage.ts
    → class MapsPackage extends RNPackage
    → ⚠️ 无 createDescriptorWrapperFactoryByDescriptorType（仅 TurboModule 注册）
    → TurboModules: AIRMapManager, AIRMapMarkerManager
    → ComponentFactory: MapsComponentFactory.ets（路由 11 个子组件）

5d: harmony/maps/src/main/ets/AIRMaps/AIRMapDescriptorTypes.ts
    → 手动定义: AIRMapRawProps (20+ Props), AIRMapMarkerRawProps, etc.
    → 手动 Descriptor 类型: AIRMapDescriptor, AIRMapMarkerDescriptor, etc.

5e: harmony/maps/src/main/ets/AIRMaps/AIRMap.ets + 11 个子组件
    → @Component export struct AIRMap { ctx.descriptorRegistry.getDescriptor }
    → @Component export struct AIRMapMarker { ... }
    → ...

5f: harmony/maps/src/main/cpp/MapsPackage.h
    → C++ Package 模式: Hand-Written (直接继承 Package)
    → createComponentDescriptorProviders: AIRMap, AIRMapMarker, AIRMapPolyline, AIRMapPolygon, AIRMapCircle, etc.
    → createComponentJSIBinderByName: {"AIRMap" → AIRMapJSIBinder, "AIRMapMarker" → AIRMapMarkerJSIBinder, ...}
    → createComponentNapiBinderByName: {"AIRMap" → AIRMapNapiBinder, ...}
    → TurboModuleFactoryDelegate: AIRMapManager, AIRMapMarkerManager
    → AIRMapJSIBinder Props: provider, mapType, zoomEnabled, scrollEnabled, showsUserLocation, etc.
```

### 3.4 无原生组件时的记录

若库不含原生组件（仅 TurboModule），记录为：

```markdown
| 原生组件名 | JS 层注册文件:行号 | ... | ArkTS 实现文件:行号 |
|------------|-------------------|-----|---------------------|
| ⚠️ 无原生组件 | — | ... | — |
```

---

## 4. 原生组件架构一致性检视对比规范

定位到注册链路后，需对比 Android/iOS 上游实现与 OHOS 实现的架构一致性。

### 4.1 检视项与扣分规则

| # | 检视项 | 对比对象 | 扣分规则 | 致命度 |
|---|--------|----------|----------|--------|
| 1 | 组件名注册 | Android ViewManager `getName()` / iOS `RCT_EXPORT_MODULE()` vs OHOS `NAME` 常量 / DescriptorWrapper / Descriptor 组件名 vs C++ `createComponentDescriptorProviders` 组件名 | 不一致扣 5 分 | 中等 |
| 2 | Props 类型定义 | RN 上游 NativeProps vs OHOS DirectRawProps/手动 RawProps vs C++ JSIBinder `obj.setProperty` 列出的 Prop 名 | 缺失 Prop 扣 3 分/个，类型不一致扣 5 分/个 | 严重 |
| 3 | Commands 注册 | RN 上游 Commands 列表 vs OHOS CommandArgvByName/registerCommandCallback 列表 vs C++ CommandDescriptor | 缺失 Command 扣 8 分/个 | 致命 |
| 4 | Props 传递机制 | Android `@ReactProp` / iOS `RCT_EXPORT_VIEW_PROPERTY` vs OHOS `rawProps.xxx` 读取 vs C++ JSIBinder `obj.setProperty` + NapiBinder 桥接 | 关键 Prop 未传递扣 8 分/个 | 致命 |
| 5 | Commands 实现 | Android `receiveCommand()` / iOS `RCT_EXPORT_METHOD` vs OHOS Command 回调实现 vs C++ Command 处理逻辑 | Command 逻辑缺失或不一致扣 8 分/个 | 致命 |
| 6 | 事件发送机制 | Android `RCTEventEmitter.receiveEvent()` / iOS `RCTDirectEventBlock` vs OHOS `EventEmitter.emit()` / `rnInstance.emitComponentEvent()` vs C++ `EventEmitRequestHandler` | 事件发送机制不一致扣 5 分/个 | 中等 |
| 7 | DescriptorWrapper 映射 | OHOS DescriptorWrapper 是否正确映射 rawProps 到 ArkTS 组件 Props（Codegen 模式） | 映射缺失扣 5 分/个 | 中等 |
| 8 | Descriptor 类型映射 | OHOS 手动 Descriptor 是否完整包含所有 Props（Legacy 模式） | 类型缺失扣 5 分/个 | 中等 |
| 9 | C++ JSIBinder ↔ OHOS Props 映射 | C++ JSIBinder 中 `obj.setProperty(rt, "propName", ...)` 列出的 Prop 名 vs OHOS `DirectRawProps`/`RawProps` 中定义的 Prop 名 | JSIBinder 有但 OHOS 无→C++→ArkTS断桥扣 8 分/个；OHOS 有但 JSIBinder 无→JS→C++断桥扣 8 分/个 | 致命 |
| 10 | C++ NapiBinder ↔ ArkTS 属性桥接 | C++ NapiBinder 中桥接的 Prop 名 vs ArkTS `@Component struct` 中实际使用的 Prop 名 | NapiBinder 缺失导致 ArkTS 无法获取 C++ 侧 Prop 值，扣 5 分/个 | 中等 |
| 11 | C++ EventEmitRequestHandler ↔ OHOS 事件 | C++ `handleEvent` 中注册的事件名 vs OHOS `EventEmitter.emit` / `rnInstance.emitComponentEvent` 发送的事件名 | 事件名不一致扣 5 分/个 | 中等 |
| 12 | C++ TurboModule 注册 vs JS 层 | C++ `TurboModuleFactoryDelegate.createTurboModule` 中注册的 TurboModule 名 vs JS 层 `TurboModuleRegistry.get` 注册名 | 不一致扣 3 分/个 | 中等 |

### 4.2 Props 函数级对比格式

每个 Prop 必须逐项对比，而非笼统描述"Props 大致一致"：

```markdown
| # | Prop 名 | RN 上游 NativeProps 类型 | C++ JSIBinder 默认值 | OHOS 类型定义 | OHOS ArkTS rawProps 使用 | OHOS 文件:行号 | 状态 | 扣分 |
|---|---------|------------------------|---------------------|-------------|-------------------------|---------------|------|------|
| 1 | `javaScriptEnabled` | `WithDefault<boolean, true>` | `true` | `boolean?` (DirectRawProps) + `?? true` (PropsSelector) | `this.descriptor.rawProps.javaScriptEnabled` | `RNCWebView.ets:67` | ✅ 一致 | 0 |
| 2 | `cacheMode` | `WithDefault<CacheModeEnum, 'DEFAULT'>` | `"LOAD_DEFAULT"` | `'LOAD_DEFAULT' | ...'` (DirectRawProps) + `?? 'LOAD_DEFAULT'` (PropsSelector) | `this.descriptor.rawProps.cacheMode as CACHE_MODE` | `RNCWebView.ets:738` | ⚠️ 映射需验证 | -3 |
| 3 | `injectedJavaScript` | `string?` | 无默认值 | `string?` (DirectRawProps) | ⛔ 未在 rawProps 中读取 | — | ❌ 缺失 | -8 |
| 4 | `customMapStyle` | `object?` | ⛔ JSIBinder 中无此 Prop | `MapStyleElement[]?` (AIRMapRawProps) | `this.descriptor.rawProps.customMapStyle` | `AIRMap.ets:92` | ❌ JS→C++断桥 | -8 |
```

**Codegen vs Legacy 模式对比差异**：

| 对比维度 | Codegen 模式 | Legacy 模式 |
|---------|-------------|------------|
| Props 类型来源 | `generated/components/ComponentName.ts` 的 `DirectRawProps` + `PropsSelector` | 手动 `*DescriptorTypes.ts` 的 `*RawProps extends ViewRawProps` |
| 默认值 | `PropsSelector` 中 `?? defaultValue` | `*RawProps` 接口中可选 `?` 表示有默认值，但默认值可能未定义 |
| Props 读取方式 | `descriptorWrapper.rawProps.xxx` 或 `descriptor.rawProps.xxx` | `descriptor.rawProps.xxx`（通过 `ctx.descriptorRegistry.getDescriptor`） |

**常见问题模式**：

| 问题 | 识别方式 | 扣分 |
|------|----------|------|
| Prop 未从 rawProps 读取 | ArkTS 实现中无 `rawProps.xxx` 读取 | 关键 Prop -8/个，次要 Prop -3/个 |
| Prop 类型映射错误 | rawProps 读取后有错误的 `as` 类型转换（如 `as string` 而非 `as boolean`） | -5/个 |
| Prop 默认值不一致 | OHOS `PropsSelector` 或 `RawProps` 的默认值与上游不同 | -3/个 |
| Prop 只读未使用 | rawProps 读取后未在 `build()` 中传递给原生组件 | 关键 Prop -5/个 |
| 手动 RawProps 缺失 Prop（Legacy 模式） | 手动定义的 `*RawProps` 接口中缺少上游存在的 Prop | -5/个 |
| C++ JSIBinder 缺失 Prop | C++ JSIBinder 的 `obj.setProperty(rt, "propName", ...)` 中缺少 JS 上游存在的 Prop → JS→C++ 断桥，JS 传入值无法到达 C++/ArkTS | 致命 Prop -8/个，次要 Prop -3/个 |
| C++ NapiBinder 缺失 Prop | C++ NapiBinder 的 `setProperty(env, thisObj, "propName", ...)` 中缺少 Prop → C++→ArkTS 断桥，C++ 侧值无法传递给 ArkTS | -5/个 |
| OHOS RawProps 缺失 JSIBinder 中存在的 Prop | C++ JSIBinder 有此 Prop 但 OHOS `DirectRawProps`/`RawProps` 中未定义 → ArkTS 无法接收 | -5/个 |

### 4.3 Commands 函数级对比格式

每个 Command 必须逐项对比：

```markdown
| # | Command 名 | RN 上游签名 | C++ Command 处理 | OHOS 注册方式 | OHOS ArkTS 实现文件:行号 | 状态 | 扣分 |
|---|-----------|-------------|------------------|--------------|-------------------------|------|------|
| 1 | `goBack` | `goBack(viewRef): void` | ✅ C++ CommandDescriptor | CommandReceiver.subscribe("goBack", handler) → `controller.backward()` | `WebViewBaseOperate.ets:361` | ✅ 一致 | 0 |
| 2 | `clearFormData` | `clearFormData(viewRef): void` | ⛔ 无 C++ CommandDescriptor | ⛔ 不在 CommandArgvByName | — | ⚠️ 缺失（已文档化） | -8 |
| 3 | `reload` | `reload(viewRef): void` | ✅ C++ CommandDescriptor | CommandReceiver.subscribe("reload", handler) → 空实现 `// TODO` | `WebViewBaseOperate.ets:402` | ❌ Stub | -8 |
| 4 | `animateToRegion` | `animateToRegion(viewRef, region, duration): void` | ✅ C++ TurboModule 方法 | ctx.componentCommandReceiver → 注释掉 | `AIRMap.ets:97` | ❌ 注释/空实现 | -8 |
```

**Codegen vs Legacy 模式 Command 对比差异**：

| 对比维度 | Codegen 模式 | Legacy 模式 |
|---------|-------------|------------|
| Command 定义来源 | `generated/` 的 `CommandArgvByName` 接口 | JS 层 `NativeCommands` 或 `requireNativeComponent` 伴随的命令定义 |
| Command 注册方式 | `CommandReceiver.subscribe(commandName, handler)` | `ctx.componentCommandReceiver.registerCommandCallback(tag, (command, args) => { if (command === ...) })` |
| Command 分发方式 | 每个 Command 独立订阅回调 | switch/if-else 分发 |

**常见问题模式**：

| 问题 | 识别方式 | 扣分 |
|------|----------|------|
| Command 未注册 | Codegen: `CommandArgvByName` 中缺失；Legacy: `registerCommandCallback` 中无对应分支；C++: 无 CommandDescriptor 或 TurboModule 方法 | -8/个 |
| Command 回调为空实现 | `// TODO`、注释代码、空方法体 | -8/个 |
| Command 逻辑与上游不一致 | Android `receiveCommand` 的实际操作与 OHOS 回调操作不同 | -8/个 |
| C++ Command 未实现 | C++ 层无对应 CommandDescriptor 或 TurboModule 方法 → Command 无法从 JS 传递到 ArkTS | -8/个 |

### 4.4 事件发送对比格式

```markdown
| # | 事件名 | Android/iOS 触发方式 | C++ EventEmitRequestHandler | OHOS 触发方式 | OHOS 文件:行号 | 数据格式一致 | 状态 | 扣分 |
|---|--------|---------------------|----------------------------|-------------|---------------|-------------|------|------|
| 1 | `onNavigationStateChange` | `RCTEventEmitter.receiveEvent` | ✅ handled in EventEmitRequestHandler | `EventEmitter.emit("onNavigationStateChange", payload)` | `RNCWebView.ets:156` | ✅ | ✅ 一致 | 0 |
| 2 | `onMessage` | iOS: `RCTDirectEventBlock onMessage` | ⛔ 未在 handler 中注册 | ⛔ 未在 emit 中注册 | — | — | ❌ C++ 层未注册 | -5 |
| 3 | `onRegionChange` | Android: `onRegionChange` event | ✅ handled | `ctx.rnInstance.emitComponentEvent(tag, "onRegionChange", {region})` | `AIRMap.ets:xxx` | ⚠️ | ⚠️ Payload 不一致 | -5 |
```

**Codegen vs Legacy 模式事件对比差异**：

| 对比维度 | Codegen 模式 | Legacy 模式 |
|---------|-------------|------------|
| 事件类型来源 | `generated/` 的 `EventPayloadByName` 接口 | JS 层组件 Props 中的 `onXxx?: DirectEventHandler<...>` 或手动定义 |
| 事件发送方式 | `EventEmitter.emit(eventName, payload)` | `ctx.rnInstance.emitComponentEvent(tag, eventName, payload)` 或通过 TurboModule 间接发送 |
| 事件 Payload 格式 | `EventPayloadByName` 中定义的精确类型 | 手动构造的 Object |

---

## 5. 各平台原生组件实现特征对比

### 5.1 Android ViewManager 实现特征

| 特征 | 代码模式 | 说明 |
|------|----------|------|
| 组件名注册 | `getName() → "RNCWebView"` | ViewManager 暴露给 JS 的组件名 |
| Props 注册 | `@ReactProp(name = "javaScriptEnabled", defaultBoolean = true)` | 每个 Prop 单独注解 |
| Commands 注册 | `@ReactProp(name = COMMAND_GOBACK)` 常量 + `receiveCommand(view, commandId, args)` | Commands 通过常量映射 + switch 分发 |
| 事件发送 | `getReactApplicationContext().getJSModule(RCTEventEmitter.class).receiveEvent(id, "onNavigationStateChange", event)` | 通过 RCTEventEmitter 发送 |
| 视图创建 | `createViewInstance(reactContext) → WebView(context)` | 返回原生视图实例 |

### 5.2 iOS ViewManager 实现特征

| 特征 | 代码模式 | 说明 |
|------|----------|------|
| 组件名注册 | `RCT_EXPORT_MODULE(RNCWebView)` | 宏导出组件名 |
| Props 注册 | `RCT_EXPORT_VIEW_PROPERTY(javaScriptEnabled, BOOL)` | 每个 Prop 单独宏 |
| Commands 注册 | `RCT_EXPORT_METHOD(goBack:(RCTComponentTag *)reactTag)` | 每个 Command 单独宏 |
| 事件发送 | `self.onNavigationStateChange(@{@"url": url, ...})` | Block 回调 |
| 视图创建 | `view() → WKWebView()` | 返回原生视图实例 |

### 5.3 OHOS ArkTS + C++ 组件实现特征（Codegen 架构）

| 层级 | 特征 | 代码模式 | 说明 |
|------|------|----------|------|
| ArkTS | 组件名注册 | Package `createDescriptorWrapperFactoryByDescriptorType` 中 `"RNCWebView": DescriptorWrapper` | 通过 Package 注册组件名 |
| ArkTS | Props 类型 | `generated/` 中 `DirectRawProps` + `PropsSelector`（含默认值） | Codegen 自动生成 |
| ArkTS | Props 读取 | `descriptorWrapper.rawProps.xxx` 或 `descriptor.rawProps.xxx` | 从 rawProps 读取所有 Prop |
| ArkTS | Commands 注册 | `CommandReceiver.subscribe(commandName, handler)` | 通过 CommandReceiver 订阅 |
| ArkTS | 事件发送 | `EventEmitter.emit(eventName, payload)` | 通过 generated EventEmitter 发送 |
| ArkTS | 视图渲染 | `build() { Web({src: ...}).javaScriptAccess(...) }` | ArkUI 声明式渲染 |
| C++ | Package 模式 | Thin Wrapper `class XxxPackage extends BaseReactNativeXxxPackage` | 仅继承 generated 基类，不重写方法 |
| C++ | 组件注册 | `BaseReactNative*Package.h` 中 `createComponentDescriptorProviders()` 自动列出 | Codegen 自动生成组件列表 |
| C++ | Props 序列化 | `*JSIBinder.h` 中 `obj.setProperty(rt, "propName", value)` | 每个 Prop 从 JS 序列化到 C++ |
| C++ | Props 桥接 | `*NapiBinder.h` 中 `setProperty(env, thisObj, "propName", value)` | C++ 侧 Prop 桥接到 ArkTS |
| C++ | 事件处理 | `BaseReactNative*PackageEventEmitRequestHandler` 中 `handleEvent` | 自动生成事件分发 |
| C++ | TurboModule | `BaseReactNative*PackageTurboModuleFactoryDelegate` 中 `createTurboModule` | 自动生成 TurboModule 工厂 |

### 5.4 OHOS ArkTS + C++ 组件实现特征（Legacy 架构）

| 层级 | 特征 | 代码模式 | 说明 |
|------|------|----------|------|
| ArkTS | 组件名注册 | 手动 `Descriptor<"ComponentName", ...>` 类型 + C++ `ComponentDescriptorProvider` 或 ComponentFactory 路由 | 通过手动 Descriptor 或 C++ 注册 |
| ArkTS | Props 类型 | 手动 `*RawProps extends ViewRawProps` 接口 | 手动定义，无自动默认值 |
| ArkTS | Props 读取 | `ctx.descriptorRegistry.getDescriptor<Tag>(this.tag).rawProps.xxx` | 通过 descriptorRegistry 获取 |
| ArkTS | Commands 注册 | `ctx.componentCommandReceiver.registerCommandCallback(tag, (command, args) => { if/switch })` | 直接注册 + 分发 |
| ArkTS | 事件发送 | `ctx.rnInstance.emitComponentEvent(tag, eventName, payload)` | 直接调用 rnInstance |
| ArkTS | 多组件路由 | `ComponentFactory.ets` 的 `build()` 中 if-else 分发 | 多组件库使用工厂模式路由 |
| ArkTS | 视图渲染 | `build() { MapComponent(...).xxx(...) }` | ArkUI 声明式渲染 |
| C++ | Package 模式 | Hand-Written `class XxxPackage : public Package` | 手动实现所有注册方法 |
| C++ | 组件注册 | `createComponentDescriptorProviders()` 手动列出每个组件 | 手动维护组件列表 |
| C++ | Props 序列化 | 每个 `*JSIBinder.h` 中 `obj.setProperty(rt, "propName", value)` 手动列出 | 手动定义 Props 序列化 |
| C++ | Props 桥接 | 每个 `*NapiBinder.h` 中 `setProperty(env, thisObj, "propName", value)` 手动列出 | 手动定义 C++→ArkTS 桥接 |
| C++ | TurboModule | `TurboModuleFactoryDelegate` 中 `createTurboModule` 手动列出 | 手动定义 TurboModule 工厂 |
| C++ | 组件实例 | `ComponentInstanceFactoryDelegate::createComponentInstance` 中 if-else 分发（如 react-native-svg） | 需 C++ 原生视图的组件 |

---

## 6. 特殊场景与注意事项

### 6.1 多组件库

若库包含多个原生组件（如 react-native-maps 有 AIRMap + AIRMapMarker + AIRMapPolyline + AIRMapPolygon + AIRMapCircle 等；react-native-screens 有 11 个组件），需对每个组件独立执行定位流程，并在 4.2-4.4 中分别对比。

### 6.2 仅 Props 无 Commands 的组件

部分组件仅定义 Props 而无 Commands（如简单的进度条组件、react-native-video 的 RNCVideo `CommandArgvByName` 为空接口 `{}`）。此时 Commands 对比表标注"⚠️ 无 Commands 定义"即可，不扣分。

### 6.3 Codegen 生成的类型文件

OHOS 鸿蒙化代码中 `generated/` 目录存放 Codegen 自动生成的类型定义文件。关键结构：

```
generated/
  components/
    ComponentName.ts      ← 原生组件的完整类型（NAME, RawProps, PropsSelector, DescriptorWrapper, EventEmitter, CommandReceiver）
    ts.ts                 ← 组件命名空间导出汇总
  turboModules/
    TurboModuleName.ts    ← TurboModule 的类型定义
    ts.ts                 ← TurboModule 导出汇总
  index.ets               ← 全量导出
  ts.ts                   ← RNC + TM 命名空间导出
```

这些文件中的 DirectRawProps、PropsSelector、EventPayloadByName、CommandArgvByName 定义应与上游 RN 保持一致；若不一致，说明鸿蒙化方手动修改了 Codegen 产出，需重点关注差异。

若 `generated/components/ts.ts` 仅导出空对象（`export {}`），说明该库的组件未通过 Codegen generated 机制注册，需检查是否通过 Legacy/Descriptor 模式或其他方式注册。

### 6.4 Fragment 组件

部分组件（如 ReactFragment）不以 `@Component export struct` 形式实现，而是以普通 ArkTS class 实现。搜索 5e 时需同时搜索 `export class 组件名` 模式。

### 6.5 库含原生组件但 OHOS 未实现

若 5a 找到 `codegenNativeComponent` 或 `requireNativeComponent` 但 5c/5e 未找到对应 OHOS Package 注册和组件实现，说明原生组件未鸿蒙化。判定为"⛔ 原生组件缺失"，每个缺失组件扣 15 分（致命）。

### 6.6 Package 基类选择

| 基类 | TurboModule Factory 方法 | 适用场景 | 典型库 |
|------|--------------------------|---------|--------|
| `RNOHPackage` | `createAnyThreadTurboModuleFactory()` → `AnyThreadTurboModuleFactory` | 较新的鸿蒙化实现 | react-native-webview |
| `RNPackage` | `createTurboModulesFactory()` → `TurboModulesFactory` | 常见的鸿蒙化实现 | react-native-video, react-native-maps, react-native-svg, react-native-picker |

两者在组件注册方式上相同（都通过 `createDescriptorWrapperFactoryByDescriptorType`），仅在 TurboModule 注册 API 上有区别。检视时不因基类不同而扣分，但需正确识别以提取 TurboModule 名。

### 6.7 JS 层无组件注册宏的库

部分库（如 react-native-svg）在 JS 层不使用 `codegenNativeComponent` 或 `requireNativeComponent`，但 OHOS 层有大量 `@Component struct` 实现。此时判定流程需调整：

```
1. JS 层无 codegenNativeComponent 或 requireNativeComponent
2. 但 harmony/ 目录中存在 @Component struct 实现
3. → 判定为 Legacy 架构，从 OHOS 层直接开始定位
```

### 6.8 requireNativeComponent 的动态组件名

`requireNativeComponent` 的组件名可能是动态拼接的（如 react-native-maps 的 `AIRMap` vs `AIRGoogleMap`，根据 provider 属性决定）。检视时需追踪完整的命名逻辑，提取所有可能的组件名变体。

### 6.9 Harmony 目录位置不固定

| 库 | harmony 目录位置 | 模块子目录名 |
|----|-----------------|-------------|
| react-native-webview | `harmony/rn_webview/` | rn_webview |
| react-native-video | `harmony/rn_video/` | rn_video |
| react-native-maps | `harmony/maps/` | maps |
| react-native-svg | `harmony/svg/` | svg |
| react-native-picker | `harmony/picker/` | picker |
| react-native-screens | `react-native-harmony-screens/harmony/screens/` | screens |
| react-native-linear-gradient | `harmony/linear_gradient/`（待确认） | linear_gradient |

> ⚠️ 模块子目录名不可按库名硬推。必须通过实际目录探索确定。

### 6.10 TurboModule 充当 ViewManager 的特殊情况

某些库（如 react-native-picker）在 JS 层使用 `TurboModuleRegistry.get("RNCPickerView")` 注册，但在 OHOS 层的 Package 中将其实现为 TurboModule。如果该 TurboModule 负责创建/管理 UI 视图（而非仅提供方法调用），则应同时按 TurboModule 和原生组件两个维度检视。

---

## 7. C++ ↔ OHOS 特征提取与跨层验证方法

C++ Package 层是 RN 原生桥接的核心层——它将 JS 层的 Props/Commands/Events 定义序列化为 C++ 数据结构，再通过 NapiBinder 桥接到 ArkTS 组件。检视时必须验证 C++ ↔ ArkTS 层的特征一致性。

### 7.1 C++ ↔ ArkTS Props 映射验证

**验证链路**：`JS NativeProps → C++ JSIBinder Props → C++ NapiBinder Props → ArkTS DirectRawProps/手动 RawProps → ArkTS rawProps 读取`

```markdown
| # | Prop 名 | JS NativeProps 类型 | C++ JSIBinder 默认值 | C++ NapiBinder 桥接 | OHOS DirectRawProps/RawProps | OHOS PropsSelector 默认值 | ArkTS rawProps 使用 | 状态 | 扣分 |
|---|---------|---------------------|---------------------|---------------------|---------------------------|-------------------------|-------------------------|------|------|
| 1 | `javaScriptEnabled` | `WithDefault<boolean, true>` | `true` (JSIBinder) | ✅ (NapiBinder) | `boolean?` + `?? true` | `?? true` | `this.descriptor.rawProps.javaScriptEnabled` | ✅ 全链路一致 | 0 |
| 2 | `cacheMode` | `WithDefault<CacheModeEnum, 'DEFAULT'>` | `"LOAD_DEFAULT"` (JSIBinder) | ✅ (NapiBinder) | `'LOAD_DEFAULT'|...` + `?? 'LOAD_DEFAULT'` | `?? 'LOAD_DEFAULT'` | `this.descriptor.rawProps.cacheMode as CACHE_MODE` | ⚠️ 类型映射需验证 | -3 |
| 3 | `injectedJavaScript` | `string?` | 无默认值 (JSIBinder) | ⛔ 未桥接 (NapiBinder) | `string?` (DirectRawProps) | — | ⛔ 未读取 | ❌ C++ 层已断桥 | -8 |
```

**跨层断桥的识别方式**：

| 断桥位置 | 识别方式 | 说明 |
|---------|----------|------|
| JS → C++ 断桥 | C++ JSIBinder 中无该 Prop 的 `obj.setProperty` | Prop 未在 C++ 层注册，JS 侧传入的值会被丢弃 |
| C++ → ArkTS 断桥 | C++ NapiBinder 中无该 Prop 的 `setProperty` | C++ 层有该值但未传递给 ArkTS 组件 |
| ArkTS 未使用 | ArkTS 组件中无 `rawProps.xxx` 读取 | Prop 已传入但组件未使用 |

> ⚠️ **关键**：C++ JSIBinder 是 RN 新架构（Fabric）的核心 Props 序列化层。即使 ArkTS `DirectRawProps` 中定义了某个 Prop，如果 C++ JSIBinder 中未包含该 Prop，JS 侧传入的值将无法传递到组件。因此 JSIBinder 是 Props 完整性的最终判定标准。

### 7.2 C++ ↔ ArkTS Commands 映射验证

**验证链路**：`JS NativeCommands → C++ CommandDescriptor（如 Fabric CommandDescriptor）→ ArkTS CommandReceiver/CommandCallback`

```markdown
| # | Command 名 | JS NativeCommands 签名 | C++ Command 处理 | ArkTS CommandReceiver/registerCommandCallback | OHOS 实现文件:行号 | 状态 | 扣分 |
|---|-----------|----------------------|------------------|---------------------------------------------|----------------------|------|------|
| 1 | `goBack` | `goBack(viewRef): void` | ✅ C++ CommandDescriptor | ✅ CommandReceiver.subscribe | `WebViewBaseOperate.ets:361` | ✅ 全链路一致 | 0 |
| 2 | `clearFormData` | `clearFormData(viewRef): void` | ⛔ 无 C++ CommandDescriptor | ⛔ 无 CommandArgvByName | — | ❌ C++ 层未注册 | -8 |
```

> ⚠️ **Codegen 架构的 Commands 在 C++ 中通过 `CommandArgvByName` 接口自动生成**；Legacy 架构的 Commands 通过 C++ TurboModule 方法暴露（如 `AIRMapManager.animateToRegion()`），不走 CommandDescriptor 路径。

### 7.3 C++ ↔ ArkTS Events 映射验证

**验证链路**：`JS onXxx Props → C++ EventEmitRequestHandler → ArkTS EventEmitter.emit / rnInstance.emitComponentEvent`

```markdown
| # | 事件名 | JS onXxx Prop | C++ EventEmitRequestHandler | ArkTS 发送方式 | OHOS 文件:行号 | 状态 | 扣分 |
|---|--------|-------------|----------------------------|---------------|---------------|------|------|
| 1 | `onNavigationStateChange` | `onNavigationStateChange?: DirectEventHandler<...>` | ✅ handled in EventEmitRequestHandler | ✅ EventEmitter.emit | `RNCWebView.ets:156` | ✅ 全链路一致 | 0 |
| 2 | `onMessage` | `onMessage?: DirectEventHandler<...>` | ⛔ 未在 handler 中注册 | ⛔ 未 emit | — | ❌ C++ 层未注册 | -5 |
```

**C++ EventEmitRequestHandler 的两种模式**：

| 模式 | 代码特征 | 适用场景 |
|------|----------|---------|
| Codegen 自动生成 | `BaseReactNative*PackageEventEmitRequestHandler` 中自动列出所有事件 | Codegen 架构 |
| Hand-Written | 手写 `handleEvent()` 方法中 if-else 分发 | Legacy 架构 |

### 7.4 C++ ↔ ArkTS TurboModule 映射验证

**验证链路**：`JS TurboModuleRegistry.get('XXX') → C++ TurboModuleFactoryDelegate → ArkTS TurboModule 实现`

```markdown
| # | TurboModule 名 | JS Spec 定义 | C++ TurboModuleFactoryDelegate | ArkTS TurboModule 实现 | OHOS 文件:行号 | 状态 |
|---|--------------|------------|----------------------------|---------------------|---------------|------|
| 1 | `RNCWebViewModule` | ✅ NativeRNCWebViewModule.ts | ✅ BaseReactNativeWebViewPackageTurboModuleFactoryDelegate | ✅ WebViewTurboModule | `WebViewTurboModule.ets` | ✅ 一致 |
| 2 | `AIRMapManager` | ✅ NativeModules.AIRMapManager | ✅ MapsTurboModuleFactoryDelegate | ✅ AIRMapManager | `AIRMaps/AIRMapManager.ts` | ✅ 一致 |
```

### 7.5 C++ Package 模式判定快速指南

```
1. 检查 harmony/<module>/src/main/cpp/ 目录是否存在
   → 不存在 → ⚠️ 无 C++ 层（组件注册完全在 ArkTS 层）
   → 存在 → 继续判定

2. 检查 *Package.h 文件内容
   → 类继承 BaseReactNative*Package → Thin Wrapper 模式（Codegen）
     → 所有注册信息在 generated/RNOH/generated/BaseReactNative*Package.h 中
     → 需读取该 generated 文件提取组件名、JSIBinder 映射、事件名、TurboModule 名
   → 类直接继承 Package → Hand-Written 模式（Legacy）
     → 所有注册信息在 *Package.h/cpp 中直接定义
     → 需逐方法读取提取

3. 检查 generated/RNOH/generated/ 目录
   → 存在 → Codegen 架构确认
   → 不存在 → Legacy 架构确认

4. 检查 *JSIBinder.h 文件
   → 在 generated/components/ → 自动生成的 JSIBinder（Codegen）
   → 在 cpp/ 根目录或子目录 → 手写的 JSIBinder（Legacy）

5. 检查 ComponentInstanceFactoryDelegate
   → 存在 → 该库有 C++ 原生视图实例创建（如 react-native-svg）
   → 不存在 → 该库的视图完全由 ArkTS 渲染
```

### 7.6 C++ 层特征提取操作指令

**提取 JSIBinder Props 的操作流程**：

```
1. 定位 JSIBinder 文件：
   - Codegen: harmony/<module>/src/main/cpp/generated/RNOH/generated/components/ComponentNameJSIBinder.h
   - Legacy: harmony/<module>/src/main/cpp/*JSIBinder.h

2. 在 JSIBinder 文件中搜索 createJSIBinder 方法
3. 提取所有 obj.setProperty(rt, "propName", createValue(rt, propName_)) 行
4. 提取所有 propName_ 成员变量的默认值
5. 对比 propName 列表与 JS NativeProps 接口中的 Prop 名列表
6. 对比 propName 列表与 OHOS DirectRawProps/RawProps 接口中的 Prop 名列表
7. 标注任何 JS 中存在但 C++ JSIBinder 中缺失的 Prop（→ JS→C++ 断桥）
8. 标注任何 C++ JSIBinder 中存在但 OHOS RawProps 中缺失的 Prop（→ C++→ArkTS 断桥）
```

**提取 TurboModule 名的操作流程**：

```
1. 定位 TurboModuleFactoryDelegate 文件：
   - Codegen: harmony/<module>/src/main/cpp/generated/RNOH/generated/BaseReactNative*Package.h
   - Legacy: harmony/<module>/src/main/cpp/*Package.h 或 *TurboModuleFactoryDelegate.h

2. 在 TurboModuleFactoryDelegate 的 createTurboModule 方法中提取所有 turboModuleName 条件
3. 对比提取的 TurboModule 名与 JS 层 TurboModuleRegistry/NativeModules 注册名
4. 对比提取的 TurboModule 名与 ArkTS TurboModule 实现类名
```

**提取 EventEmitRequestHandler 事件名的操作流程**：

```
1. 定位 EventEmitRequestHandler 文件：
   - Codegen: harmony/<module>/src/main/cpp/generated/RNOH/generated/BaseReactNative*Package.h
   - Legacy: 在 *Package.h/cpp 中搜索 EventEmitRequestHandler

2. 在 handleEvent 方法中提取所有 eventName 条件
3. 对比提取的事件名与 JS 层 onXxx Props 列表
4. 对比提取的事件名与 OHOS EventEmitter/emitComponentEvent 发送的事件名
```

**提取 ComponentInstanceFactoryDelegate 组件名的操作流程**：

```
1. 在 *Package.h 中搜索 ComponentInstanceFactoryDelegate
2. 在 createComponentInstance 方法中提取所有 ctx.componentName 条件
3. 这些组件名即为需要 C++ 原生视图实例的组件
4. 对比这些组件名与 ArkTS @Component struct 组件名列表
```
