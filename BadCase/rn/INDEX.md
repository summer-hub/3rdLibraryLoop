# RN 三方库鸿蒙化已知问题知识库 — 一级索引

> **分级结构**：本文件为一级索引（分类 + 索引），具体知识在二级文件中。
> **维护方式**：由 rn-library-issue-generalizer SKILL 产出草稿，人工审核后合入。
> **消费方式**：rn-library-known-issue-check SKILL 先读本索引预筛适用规则，再按需读取规则/案例文件。

```
BadCase/rn/
├── INDEX.md    ← 一级：分类 + 索引（本文件）
├── rules/      ← 二级：规则知识（检查的执行单元）
├── cases/      ← 二级：案例知识（few-shot 参考 + 修复指引）
└── pr-info/    ← 案例原始 PR diff 证据材料
```

**使用流程**（检视 Agent）：
1. 读本索引 → 按"预筛特征"筛选与当前库相关的规则
2. 读 `rules/R-XX-*.md` → 获取检查点、错误/正确特征、案例索引
3. 需要代码级 few-shot 参考时 → 读 `cases/KI-XXX-*.md`

---

## 一、规则分类索引

### 媒体与窗口类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-01 | 全屏/窗口状态管理完整性类 | high | 1 | [rules/R-01-全屏窗口状态管理完整性.md](rules/R-01-全屏窗口状态管理完整性.md) |
| R-09 | 横竖屏/多形态布局适配类 | medium | 1 | [rules/R-09-横竖屏多形态布局适配.md](rules/R-09-横竖屏多形态布局适配.md) |
| R-10 | 深色模式/主题颜色适配类 | medium | 1 | [rules/R-10-深色模式主题颜色适配.md](rules/R-10-深色模式主题颜色适配.md) |

### 资源加载类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-02 | 资源 URI 形态分支覆盖类 | high | 2 | [rules/R-02-资源URI形态分支覆盖.md](rules/R-02-资源URI形态分支覆盖.md) |
| R-13 | 文件/数据编码与格式兼容类 | high | 2 | [rules/R-13-文件数据编码与格式兼容.md](rules/R-13-文件数据编码与格式兼容.md) |
| R-17 | 媒体资源生命周期与错误处理类 | high | 1 | [rules/R-17-媒体资源生命周期与错误处理.md](rules/R-17-媒体资源生命周期与错误处理.md) |

### 流程健壮性类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-03 | 附属操作失败阻断主流程类 | high | 1 | [rules/R-03-附属操作失败阻断主流程.md](rules/R-03-附属操作失败阻断主流程.md) |
| R-15 | 状态持久化与重启逻辑一致性类 | high | 1 | [rules/R-15-状态持久化与重启逻辑一致性.md](rules/R-15-状态持久化与重启逻辑一致性.md) |

### 异步与回调类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-04 | 异步回调注册时序类 | high | 1 | [rules/R-04-异步回调注册时序.md](rules/R-04-异步回调注册时序.md) |
| R-11 | 接口/回调实现完整性类 | high | 1 | [rules/R-11-接口回调实现完整性.md](rules/R-11-接口回调实现完整性.md) |

### 工程规范类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-05 | 模块导入路径规范类 | low | 1 | [rules/R-05-模块导入路径规范.md](rules/R-05-模块导入路径规范.md) |
| R-16 | 敏感信息日志泄露类 | high | 1 | [rules/R-16-敏感信息日志泄露.md](rules/R-16-敏感信息日志泄露.md) |
| R-18 | 能力枚举/配置完整性类 | medium | 1 | [rules/R-18-能力枚举配置完整性.md](rules/R-18-能力枚举配置完整性.md) |

### 手势与交互类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-08 | 手势/事件注册与冲突处理类 | high | 3 | [rules/R-08-手势事件注册与冲突处理.md](rules/R-08-手势事件注册与冲突处理.md) |

### 动画与渲染类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-14 | 动画初始化时序与状态同步类 | medium | 1 | [rules/R-14-动画初始化时序与状态同步.md](rules/R-14-动画初始化时序与状态同步.md) |
| R-19 | 图形渲染属性继承与重置类 | medium | 1 | [rules/R-19-图形渲染属性继承与重置.md](rules/R-19-图形渲染属性继承与重置.md) |

### C++ 内存与生命周期类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-07 | C++ 智能指针生命周期管理类 | high | 1 | [rules/R-07-智能指针生命周期管理.md](rules/R-07-智能指针生命周期管理.md) |
| R-12 | 原生运行时资源析构时序类 | high | 1 | [rules/R-12-原生运行时资源析构时序.md](rules/R-12-原生运行时资源析构时序.md) |

### 隐私合规类

| 编号 | 规则名 | 严重级别 | 案例数 | 规则文件 |
|------|--------|----------|--------|----------|
| R-06 | 传感器/硬件权限按需获取类 | high | 2 | [rules/R-06-传感器硬件权限按需获取.md](rules/R-06-传感器硬件权限按需获取.md) |

---

## 二、案例索引

| 编号 | 库 | 现象简述 | 所属规则 | 验证方式 | 案例文件 |
|------|-----|----------|----------|----------|----------|
| KI-001 | react-native-webview | 视频无法横屏 | R-01 | diff | [cases/KI-001-webview视频无法横屏.md](cases/KI-001-webview视频无法横屏.md) |
| KI-002 | react-native-fast-image | 热更新图片加载失败 | R-02 | diff | [cases/KI-002-fastImage热更新图片失败.md](cases/KI-002-fastImage热更新图片失败.md) |
| KI-003 | react-native-wechat-lib | 缩略图不支持本地图片 | R-02, R-03 | diff | [cases/KI-003-wechat缩略图本地图片.md](cases/KI-003-wechat缩略图本地图片.md) |
| KI-004 | react-native-wechat-lib | shareWebpage 回调时序问题 | R-04 | diff | [cases/KI-004-wechat回调时序.md](cases/KI-004-wechat回调时序.md) |
| KI-005 | react-native-geolocation | 3.1.1 接入报错（IDE 爆红） | R-05 | diff | [cases/KI-005-geolocation导入路径后缀.md](cases/KI-005-geolocation导入路径后缀.md) |
| KI-006 | react-native-SmartRefreshLayout | bad_weak_ptr 崩溃 | R-07 | diff | [cases/KI-006-SmartRefreshLayout智能指针崩溃.md](cases/KI-006-SmartRefreshLayout智能指针崩溃.md) |
| KI-007 | react-native-orientation-locker | 加速度传感器初始化即打开 | R-06 | diff | [cases/KI-007-orientation-locker传感器初始化.md](cases/KI-007-orientation-locker传感器初始化.md) |
| KI-008 | react-native-orientation-locker | 传感器频繁 open/close 优化 | R-06 | diff | [cases/KI-008-orientation-locker传感器引用计数.md](cases/KI-008-orientation-locker传感器引用计数.md) |
| KI-009 | react-native-pager-view | 嵌套滑动父子组件无法联动 | R-08 | diff | [cases/KI-009-pager-view嵌套滑动.md](cases/KI-009-pager-view嵌套滑动.md) |
| KI-010 | react-native-screens | 手势冲突与默认值错误 | R-08 | diff | [cases/KI-010-screens手势冲突.md](cases/KI-010-screens手势冲突.md) |
| KI-011 | react-native-spring-scrollview | 手势重复绑定崩溃 | R-08 | diff | [cases/KI-011-spring-scrollview手势重复绑定.md](cases/KI-011-spring-scrollview手势重复绑定.md) |
| KI-012 | react-native-qr-decode-image-camera | Pura X Max 横屏展示不正确 | R-09 | diff | [cases/KI-012-qr-camera横屏适配.md](cases/KI-012-qr-camera横屏适配.md) |
| KI-013 | react-native-webview | 深色模式先闪白再变黑 | R-10 | diff | [cases/KI-013-webview深色模式背景色.md](cases/KI-013-webview深色模式背景色.md) |
| KI-014 | react-native-amap-geolocation | onLocationError 未实现 | R-11 | diff | [cases/KI-014-amap-geolocation回调缺失.md](cases/KI-014-amap-geolocation回调缺失.md) |
| KI-015 | react-native-reanimated | 动画 crash（滴滴线上 0.01%） | R-12 | diff | [cases/KI-015-reanimated运行时析构崩溃.md](cases/KI-015-reanimated运行时析构崩溃.md) |
| KI-016 | react-native-fs | read 接口无法读取非文本文件 | R-13 | diff | [cases/KI-016-fs文件读取编码.md](cases/KI-016-fs文件读取编码.md) |
| KI-017 | react-native-blob-util | 字符串参数被错误转为文件流 | R-13 | diff | [cases/KI-017-blob-util参数编码错误.md](cases/KI-017-blob-util参数编码错误.md) |
| KI-018 | react-native-modal | 弹窗先闪一下 | R-14 | diff | [cases/KI-018-modal弹窗闪烁.md](cases/KI-018-modal弹窗闪烁.md) |
| KI-019 | react-native-code-push | restartApp 在 ON_NEXT_RESTART 模式下失效 | R-15 | diff | [cases/KI-019-code-push重启逻辑失效.md](cases/KI-019-code-push重启逻辑失效.md) |
| KI-020 | react-native-netinfo | 打印 MAC 地址和 IP 地址 | R-16 | diff | [cases/KI-020-netinfo敏感信息泄露.md](cases/KI-020-netinfo敏感信息泄露.md) |
| KI-021 | react-native-video | 播放本地视频异常 | R-17 | diff | [cases/KI-021-video本地视频播放异常.md](cases/KI-021-video本地视频播放异常.md) |
| KI-022 | react-native-audio-recorder-player | AAC 格式无法录制 | R-18 | diff | [cases/KI-022-audio-recorder-player枚举缺失.md](cases/KI-022-audio-recorder-player枚举缺失.md) |
| KI-023 | react-native-svg | Text 组件渐变色失效 | R-19 | diff | [cases/KI-023-svg渐变继承失效.md](cases/KI-023-svg渐变继承失效.md) |

> `验证方式`：diff = 基于实际 PR patch 验证（含错误/正确代码对照）；description-only = 仅基于问题描述。

---

## 三、变更记录

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-08-24 | 初始创建 | 4 案例 → 5 规则（KI-003 复合问题拆 3 规则）；由单文件结构整改为分级结构 |
| 2026-08-24 | 批量泛化（19 新案例） | 18 新案例 → 14 新规则（R-06~R-19）；新增手势与交互类、动画与渲染类、C++ 内存与生命周期类、隐私合规类四大分类 |
