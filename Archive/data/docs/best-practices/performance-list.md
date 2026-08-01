# 列表性能优化最佳实践

## 概述
长列表是性能优化的重点场景。使用 LazyForEach 替代 ForEach 实现按需加载。

#### 使用 LazyForEach
LazyForEach 只渲染可视区域的列表项，大幅减少内存占用和渲染时间。

```typescript
LazyForEach(this.dataSource, (item: string) => {
  ListItem() {
    Text(item)
  }
}, (item: string) => item)
```

#### 组件复用
使用 @Reusable 装饰器实现组件复用，减少重复创建开销。

#### 避免在 build 中做重计算
build() 方法应保持轻量，复杂计算放到 aboutToAppear 或异步方法中。
