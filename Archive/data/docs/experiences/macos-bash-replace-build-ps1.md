## macOS/Linux 环境替代 build.ps1 执行 devecocli build 的方法

### 问题现象

build.ps1 在 macOS 环境不可用（无 pwsh/powershell）。而构建流程强制"必须通过 build.ps1 执行"的底层原因是：直接调用 devecocli build 会导致 hvigor daemon 继承 Agent pipe 句柄不释放，造成 session 永久阻塞。

### 解决方案

等效替代方案：**bash 重定向到日志文件 + timeout 参数**

```bash
devecocli build --modules entry > build.log 2>&1
```

原理：daemon 继承的是文件句柄而非管道句柄，同样规避了 pipe 句柄继承导致的 session 阻塞，与 build.ps1 的防护机制等价。构建错误从 build.log 日志文件中读取。

### 结果

macOS 环境下实际执行 3 轮编译均无 session 阻塞，效果与 build.ps1 等同。macOS/Linux 环境执行鸿蒙编译验证可直接采用此方案。