## RN 上游版本 diff 操作踩坑集（grep 二进制 / CHANGELOG 来源 / patch 噪音 / 平台并行文件）

### 问题现象
对比上游两个 npm tgz 版本生成 patch 与检索 release notes 时的操作性坑：
1. 全量 patch 中 `grep "^diff"` 报 "Binary file matches"
2. CHANGELOG.md 不在 npm tgz 内，无法从源码包获取上游 release notes
3. 脚本生成的 patch 仍包含 android/ios 原生平台代码与 .DS_Store 噪音（280KB 中大部分是原生变更）
4. 上游共享实现（如 `Camera.tsx`）与平台特化文件（`.android.tsx` / `.ios.tsx`）是三份并行文件，只 diff 入口 index.ts 会漏掉平台文件变更（实测：共享版无变更但平台版有 props 默认值注入变更）

### 解决方案
1. patch 含二进制文件（.DS_Store/gradle 等）时用 `grep -a` 强制文本模式
2. release notes 从 GitHub Releases 页面获取（webfetch releases 页可行；raw CHANGELOG.md 可能超时）
3. 两阶段 diff 是必要的：Phase 1 全量 → Phase 2 按相关文件清单筛选精简，不能信任脚本的默认排除已覆盖 patch 本身
4. diff 时显式覆盖共享实现与平台特化文件（`.tsx` / `.android.tsx` / `.ios.tsx` 三份并行），不能只看入口文件

### 结果
Phase 2 精简后 patch 从 280KB 缩至 9.3KB（7 文件），平台文件的 props 默认值注入变更未被遗漏，patch 可直接用于后续适配。