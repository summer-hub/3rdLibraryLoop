# CPTF 测试工程搭建指南

> Phase 2 的详细操作手册。核心解决两个问题：模块解析（link 依赖）与设备/应用配置。

## 1. 前置检查

```bash
# 1. CPTF 框架源码位置（全局 pnpm link 安装）
ls -la ~/Library/pnpm/global/5/node_modules/@cptf/framework   # 应为 symlink → 框架源码

# 2. hdc 工具与设备
hdc list targets    # 应输出设备 SN（如 026PMV25CH125405）

# 3. demo hap 构建产物
ls {demoPath}/harmony/entry/build/default/outputs/default/entry-default-signed.hap

# 4. demo bundleId
cat {demoPath}/AppScope/app.json5 | grep bundleName
```

## 2. cptf.config.json 完整配置

```json
{
  "bundleId": "com.example.xxx",
  "reportDir": "test-reports",
  "reportFormat": "html",
  "casesDir": "tests/cases",
  "enableAlerts": true,
  "platforms": {
    "harmony": {
      "toolPath": "hdc",
      "bundleId": "com.example.xxx",
      "appPath": "<demoPath 绝对路径>/harmony/entry/build/default/outputs/default/entry-default-signed.hap",
      "devices": [
        {
          "id": "<设备SN>",
          "screenWidth": 1280,
          "screenHeight": 2832
        }
      ]
    }
  }
}
```

**字段说明**：
- `appPath` 必须是**绝对路径**（signed hap）
- `screenWidth/screenHeight` 影响滚动与坐标计算，从 `hdc shell hidumper -s RenderService` 或设备规格获取
- `casesDir` 相对 workspace 根；测试文件放 `tests/cases/functional/` 下自动被发现

## 3. link 依赖建立（关键步骤）

### 3.1 为什么不能用全局安装直接跑

cptf CLI shim（`~/.pnpm/global/5/.bin/cptf`）通过 NODE_PATH 注入模块路径，其中包含 `.pnpm/node_modules` 等目录——**pnpm link 全局安装后这些目录可能不存在**。测试文件（位于独立 workspace）的 `require('@cptf/framework')` 解析失败，报：

```
Error: Cannot find module '@cptf/framework'
```

### 3.2 正确做法：workspace 本地 link

`{workspaceDir}/package.json`：

```json
{
  "name": "cptf-workspace",
  "version": "1.0.0",
  "private": true,
  "description": "CPTF 测试工程: <libName> RNOH 功能测试",
  "dependencies": {
    "@cptf/framework": "link:<frameworkPath 绝对路径>",
    "reflect-metadata": "link:<frameworkPath>/node_modules/reflect-metadata"
  }
}
```

> `reflect-metadata` 是 `@Step`/`@Test` 装饰器的运行时依赖，必须与框架内版本一致，故同样 link 框架 node_modules 内的副本。

```bash
cd {workspaceDir}
pnpm install
# 验证
node -e "console.log(require.resolve('@cptf/framework'))"
# 应输出 {workspaceDir}/node_modules/@cptf/framework/...
```

### 3.3 TS 支持

框架 CLI 内置 `registerTsNode()`（ts-node transpileOnly，module: commonjs，target: ES2020，esModuleInterop），测试文件直接写 `.ts`，无需本地配置 tsconfig。

## 4. 用例发现机制

- CLI 扫描 `{casesDir}` 下所有 `.ts` 文件
- 文件必须 `export const testCaseExecutor = new XxxTest()`（实例化 FunctionalTest 子类）
- `@Test({ id: '...' })` 的 id 用于 `-t` 过滤：`cptf run -p harmony -t <id>`

## 5. 常见搭建故障

| 现象 | 原因 | 修复 |
|------|------|------|
| `Cannot find module '@cptf/framework'` | shim NODE_PATH 失效 | 按 3.2 本地 link |
| `Cannot find module 'reflect-metadata'` | 漏配 reflect-metadata link | 补 package.json 第二个 link 依赖 |
| 装饰器不生效（@Step 未注册） | 未 import 'reflect-metadata'（文件首行） | 测试文件第一行加 import |
| 设备连接失败 | hdc 未授权/未插 | `hdc list targets` 检查，重新授权 |
| hap 安装失败 | appPath 非绝对路径/未签名 | 核对 entry-default-signed.hap |
