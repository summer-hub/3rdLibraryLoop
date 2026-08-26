# KI-006 react-native-SmartRefreshLayout：bad_weak_ptr 崩溃

- **元数据**: `rule: R-07` · `verified: diff` · `source: dtse` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-SmartRefreshLayout/pull/32（merged，6 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-SmartRefreshLayout-32.md](../pr-info/rntpc_react-native-SmartRefreshLayout-32.md)

## 现象

红圈云应用闪退，bad_weak_ptr 崩溃。

## 根因

多线程下 shared_ptr 并发访问未加锁——getPullToRefreshConfigurator() 无锁保护，直接 CHECK 断言非空；析构函数中 reset refreshConfigurator 也无锁，多线程并发访问时触发 bad_weak_ptr。

## 错误代码（修复前）

```cpp
// PullToRefreshNode.h — getter 无锁，断言失败直接 abort
std::shared_ptr<PullToRefreshConfigurator> getPullToRefreshConfigurator() {
    CHECK(refreshConfigurator != nullptr)  // ← 断言失败直接 abort，无锁保护
        << "[PullToRefreshNode] refreshConfigurator is null!";
    return refreshConfigurator;
}

// PullToRefreshNode.cpp — 析构函数无锁 reset
PullToRefreshNode::~PullToRefreshNode() {
    refreshConfigurator = nullptr;  // ← 无锁，多线程并发访问
}
```

## 正确代码（修复后）

```cpp
// PullToRefreshNode.h — ① 添加 shared_mutex 成员
std::shared_mutex config_mutex_;

// ② getter 使用 shared_lock 保护读取，判空记录日志而非 abort
std::shared_ptr<PullToRefreshConfigurator> getPullToRefreshConfigurator() {
    std::shared_lock<std::shared_mutex> lock(config_mutex_);
    if (!refreshConfigurator) {
        LOG(ERROR)<<"[PullToRefreshNode] getPullToRefreshConfigurator refreshConfigurator is null!";
    }
    return refreshConfigurator;
}

// PullToRefreshNode.cpp — ③ 析构函数加 unique_lock 后 reset
PullToRefreshNode::~PullToRefreshNode() {
    std::unique_lock<std::shared_mutex> lock(config_mutex_);
    refreshConfigurator = nullptr;
}
```

## 修复方式

shared_ptr 成员添加 shared_mutex 保护：getter 使用 shared_lock 读取（允许多读），析构函数使用 unique_lock 后 reset（独占写）；getter 将 CHECK 断言改为判空 + LOG 日志，避免断言失败直接 abort。