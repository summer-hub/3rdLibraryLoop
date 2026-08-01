# 状态管理详解

## 概述
ArkUI 提供多种状态管理装饰器：@State、@Prop、@Link、@Provide/@Consume。

#### @State：组件内部状态
@State 修饰的变量变化时，组件 build() 重新执行，UI 自动刷新。

#### @Prop：父到子单向同步
父组件 @State 变化时，自动同步到子组件 @Prop。
注意 @Builder 的参数不会随 @State 变化更新，需要用子组件替代。

#### @Link：双向同步
父子组件共享同一个数据源，任一方修改都会同步。

#### @Provide/@Consume：跨层级传递
祖先组件 @Provide 提供数据，后代组件 @Consume 消费数据。
适合深层嵌套组件间的数据共享。

#### AppStorage：应用级状态
AppStorage 是应用全局状态存储，配合 @StorageLink/@StorageProp 使用。
