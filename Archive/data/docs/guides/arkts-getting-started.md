# ArkTS 开发入门

## 概述
ArkTS 是鸿蒙应用开发的核心语言，基于 TypeScript 扩展，提供了声明式 UI 范式。

#### 基本结构
ArkTS 应用由 AbilityStage 和 UIAbility 组成。UIAbility 负责生命周期管理，
AbilityStage 是应用主入口。

```typescript
import { AbilityStage } from '@ohos.app.ability.AbilityStage';

export default class MyAbilityStage extends AbilityStage {
  onCreate() {
    console.log('AbilityStage created');
  }
}
```

#### UI 组件开发
使用 @Component 装饰器定义组件，@State 管理组件内部状态。
build() 方法描述 UI 结构。

```typescript
@Entry
@Component
struct Index {
  @State count: number = 0;

  build() {
    Column() {
      Text(`点击次数: ${this.count}`)
      Button('加一').onClick(() => this.count++)
    }
  }
}
```

#### 路由导航
使用 Navigation 和 NavDestination 实现页面路由。
Navigation 组件作为根容器，管理页面栈。
