/**
 * demo.js — 文档检索引擎功能演示
 *
 * 演示内容：
 *   1. 初始化引擎
 *   2. 添加多个 Markdown 文档（不同 catalog）
 *   3. 关键词搜索（中文 + API 符号）
 *   4. 同义词扩展搜索
 *   5. 获取文档记录
 *   6. 删除文档
 *   7. 全量重建索引
 *   8. 引擎状态查看
 *
 * 运行方式：
 *   cd Archive && node demo.js
 *
 * 前置条件：
 *   npm install jieba-wasm
 *   （未安装时分词回退到简易模式，SQLite 使用 node:sqlite 内置模块）
 *
 * 数据安全：
 *   数据目录默认为 Archive/data（见 src/constants.js DEFAULT_DATA_DIR）。
 *   重复执行不会覆盖已有数据库——已存在的文档自动跳过，
 *   删除/重建步骤仅在首次运行（数据库为空）时执行。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DocSearchEngine } from './src/index.js';
import { DEFAULT_DATA_DIR } from './src/constants.js';

// ─── 辅助：格式化输出 ─────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function section(title) {
  console.log(`\n${CYAN}${BOLD}━━━ ${title} ━━━${RESET}`);
}

function ok(msg) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg) {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

function info(msg) {
  console.log(`  ${DIM}${msg}${RESET}`);
}

function printResults(results) {
  if (results.length === 0) {
    info('（无结果）');
    return;
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(
      `  ${YELLOW}${i + 1}.${RESET} [${r.catalog}] ${BOLD}${r.title}${RESET}` +
        (r.sectionTitle ? ` › ${DIM}${r.sectionTitle}${RESET}` : '')
    );
    console.log(`     score: ${r.score.toFixed(2)}  docId: ${r.documentId}`);
    if (r.snippet) {
      console.log(`     snippet: ${r.snippet.replace(/\n/g, ' ').slice(0, 120)}...`);
    }
  }
}

// ─── 准备临时数据目录 ──────────────────────────────────────────────

// 数据目录：默认使用 src/constants.js 中的 DEFAULT_DATA_DIR（Archive/data）
// 也可通过环境变量覆盖：DATA_DIR=xxx node demo.js
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;

// ─── 测试文档 ──────────────────────────────────────────────────────

/** @type {Array<{documentId:string, catalog:string, content:string}>} */
const SAMPLE_DOCS = [
  {
    documentId: 'guides/arkts-getting-started',
    catalog: 'guides',
    content: `# ArkTS 开发入门

## 概述
ArkTS 是鸿蒙应用开发的核心语言，基于 TypeScript 扩展，提供了声明式 UI 范式。

#### 基本结构
ArkTS 应用由 AbilityStage 和 UIAbility 组成。UIAbility 负责生命周期管理，
AbilityStage 是应用主入口。

\`\`\`typescript
import { AbilityStage } from '@ohos.app.ability.AbilityStage';

export default class MyAbilityStage extends AbilityStage {
  onCreate() {
    console.log('AbilityStage created');
  }
}
\`\`\`

#### UI 组件开发
使用 @Component 装饰器定义组件，@State 管理组件内部状态。
build() 方法描述 UI 结构。

\`\`\`typescript
@Entry
@Component
struct Index {
  @State count: number = 0;

  build() {
    Column() {
      Text(\`点击次数: \${this.count}\`)
      Button('加一').onClick(() => this.count++)
    }
  }
}
\`\`\`

#### 路由导航
使用 Navigation 和 NavDestination 实现页面路由。
Navigation 组件作为根容器，管理页面栈。
`,
  },
  {
    documentId: 'guides/state-management',
    catalog: 'guides',
    content: `# 状态管理详解

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
`,
  },
  {
    documentId: 'references/camera-manager-api',
    catalog: 'references',
    content: `# CameraManager API 参考

## 概述
cameraManager 是相机管理的核心接口，提供相机打开、配置、拍照等功能。

#### cameraManager.getCameraManager()
获取 CameraManager 实例。

\`\`\`typescript
import { camera } from '@kit.CameraKit';

const cameraManager: camera.CameraManager = camera.getCameraManager();
const cameras: Array<camera.CameraDevice> = cameraManager.getSupportedCameras();
\`\`\`

#### CameraManager.createCameraSession()
创建相机会话，用于预览和拍照。

\`\`\`typescript
const session: camera.CameraSession = cameraManager.createCameraSession(cameras[0]);
session.beginConfig();
session.addInput(cameraInput);
session.addOutput(previewOutput);
await session.commitConfig();
await session.start();
\`\`\`

#### cameraManager.on('cameraStatus')
监听相机状态变化事件。
`,
  },
  {
    documentId: 'best-practices/performance-list',
    catalog: 'best-practices',
    content: `# 列表性能优化最佳实践

## 概述
长列表是性能优化的重点场景。使用 LazyForEach 替代 ForEach 实现按需加载。

#### 使用 LazyForEach
LazyForEach 只渲染可视区域的列表项，大幅减少内存占用和渲染时间。

\`\`\`typescript
LazyForEach(this.dataSource, (item: string) => {
  ListItem() {
    Text(item)
  }
}, (item: string) => item)
\`\`\`

#### 组件复用
使用 @Reusable 装饰器实现组件复用，减少重复创建开销。

#### 避免在 build 中做重计算
build() 方法应保持轻量，复杂计算放到 aboutToAppear 或异步方法中。
`,
  },
  {
    documentId: 'faqs/webview-crash',
    catalog: 'faqs',
    content: `# WebView 崩溃问题排查

## 问题描述
应用中使用 WebView 加载网页时偶现崩溃，日志显示 SIGSEGV 空指针异常。

#### 原因分析
WebView 组件在页面销毁时未正确释放资源，导致空指针访问。
常见于快速切换页面场景。

#### 解决方案
1. 在 aboutToDisappear 中调用 webviewController 销毁方法
2. 避免在 WebView 销毁后继续访问相关对象
3. 使用 try-catch 包裹 WebView 操作

\`\`\`typescript
aboutToDisappear() {
  try {
    this.controller.destroy();
  } catch (e) {
    console.error('WebView destroy failed: ' + e);
  }
}
\`\`\`

#### 预防措施
- 使用 Navigation 管理页面生命周期
- WebView 页面设置独立路由，避免嵌套
`,
  },
  {
    documentId: 'releases/api12-changes',
    catalog: 'releases',
    content: `# API 12 变更说明

## 新增特性
#### Navigation 组件增强
Navigation 组件新增 NavPathStack 路由栈管理，支持编程式导航。

#### 新增 cameraManager 接口
cameraManager 新增 getSupportedCameras() 和 createCameraSession() 方法。

#### 废弃接口
- @ohos.camera 模块标记为废弃，迁移至 @kit.CameraKit
- router.push 推荐替换为 Navigation + NavDestination

## 破坏性变更
#### @State 初始化要求
@State 变量必须在声明时初始化，不支持延迟初始化。
`,
  },
];

// ─── 主流程 ────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}${GREEN}
╔══════════════════════════════════════════════════════╗
║          文档检索引擎 Demo                            ║
║  FTS5 全文检索 + Rerank 重排序 + jieba 分词           ║
╚══════════════════════════════════════════════════════╝${RESET}
`);
  info(`数据目录: ${DATA_DIR}`);

  const engine = new DocSearchEngine();

  try {
    // ── 1. 初始化 ──────────────────────────────────────────────
    section('1. 初始化引擎');
    try {
      // 不传 dataDir 时，engine 自动使用 DEFAULT_DATA_DIR（Archive/data）
      await engine.init({ dataDir: DATA_DIR });
      ok('引擎初始化成功');
      info(`docs 目录: ${path.join(DATA_DIR, 'docs')}`);
      info(`index 目录: ${path.join(DATA_DIR, '.index')}`);
    } catch (e) {
      fail(`初始化失败: ${e.message}`);
      warn('请确认已安装依赖: npm install jieba-wasm');
      return;
    }

    // 检查数据库是否已有数据
    let existingStatus = await engine.getStatus();
    const isFirstRun = existingStatus.documentCount === 0;
    if (isFirstRun) {
      info('数据库为空，首次运行——将添加测试文档');
    } else {
      info(`数据库已有 ${existingStatus.documentCount} 个文档，跳过添加（保护已有数据）`);
    }

    // ── 2. 添加文档（仅首次运行时添加，已存在则跳过） ─────────
    section('2. 添加测试文档');
    if (isFirstRun) {
      for (const doc of SAMPLE_DOCS) {
        await engine.addDocument(doc);
        ok(`已添加: ${doc.documentId}`);
      }
    } else {
      // 非首次运行：检查是否有缺失的文档，仅补充缺失的
      let added = 0;
      for (const doc of SAMPLE_DOCS) {
        const exists = await engine.hasDocument(doc.documentId);
        if (!exists) {
          await engine.addDocument(doc);
          ok(`已补充: ${doc.documentId}`);
          added++;
        }
      }
      if (added === 0) {
        info('所有测试文档已存在，无需添加');
      }
    }

    const status = await engine.getStatus();
    info(`文档数: ${status.documentCount} | 段数: ${status.segmentCount} | DB: ${(status.dbSizeBytes / 1024).toFixed(1)}KB`);

    // ── 3. 中文关键词搜索 ──────────────────────────────────────
    section('3. 中文关键词搜索: "状态管理"');
    let results = await engine.search({ query: '状态管理', limit: 5 });
    printResults(results);

    // ── 4. API 符号搜索 ────────────────────────────────────────
    section('4. API 符号搜索: "cameraManager"');
    results = await engine.search({ query: 'cameraManager', limit: 5 });
    printResults(results);

    // ── 5. 多词组合搜索 ────────────────────────────────────────
    section('5. 多词组合搜索: "Navigation 路由 导航"');
    results = await engine.search({ query: 'Navigation 路由 导航', limit: 5 });
    printResults(results);

    // ── 6. 同义词扩展搜索 ──────────────────────────────────────
    section('6. 同义词扩展搜索: "弹窗" (同义词: dialog/popup)');
    results = await engine.search({ query: '弹窗', limit: 5 });
    printResults(results);
    info('（内置 synonyms.json 中 "弹窗" 与 "dialog/popup" 互为同义词）');

    // ── 7. 限定目录搜索 ────────────────────────────────────────
    section('7. 限定目录搜索: "生命周期" (catalog=guides)');
    results = await engine.search({ query: '生命周期', limit: 5, catalog: 'guides' });
    printResults(results);

    // ── 8. 模糊搜索 ────────────────────────────────────────────
    section('8. 模糊搜索: "列表性能优化"');
    results = await engine.search({ query: '列表性能优化', limit: 3 });
    printResults(results);

    // ── 9. 获取文档记录 ────────────────────────────────────────
    section('9. 获取文档记录: references/camera-manager-api');
    const record = await engine.getDocumentRecord('references/camera-manager-api');
    if (record) {
      ok(`标题: ${record.title}`);
      ok(`目录: ${record.catalog}`);
      ok(`段数: ${record.segmentCount}`);
      ok(`内容长度: ${record.content.length} 字符`);
      ok(`创建时间: ${new Date(record.createdAt).toLocaleString()}`);
    } else {
      fail('文档记录未找到');
    }

    // ── 10. 获取文档原文 ───────────────────────────────────────
    section('10. 获取文档原文: guides/arkts-getting-started');
    const content = await engine.getDocument('guides/arkts-getting-started');
    if (content) {
      ok(`获取成功，前 80 字符: ${content.slice(0, 80).replace(/\n/g, ' ')}...`);
    } else {
      fail('文档原文未找到');
    }

    // ── 11. 删除文档（仅首次运行演示，不破坏已有数据） ────────
    section('11. 删除文档: faqs/webview-crash');
    if (isFirstRun) {
      await engine.removeDocument('faqs/webview-crash');
      ok('文档已删除');
    } else {
      // 非首次运行：检查文档是否存在，存在才删除演示
      const exists = await engine.hasDocument('faqs/webview-crash');
      if (exists) {
        await engine.removeDocument('faqs/webview-crash');
        ok('文档已删除');
      } else {
        info('文档 faqs/webview-crash 不存在（可能之前已删除），跳过');
      }
    }
    const afterDel = await engine.getStatus();
    info(`删除后文档数: ${afterDel.documentCount}`);

    // 验证搜索不再返回已删除文档
    results = await engine.search({ query: 'WebView 崩溃', limit: 5 });
    const stillExists = results.some((r) => r.documentId === 'faqs/webview-crash');
    if (!stillExists) {
      ok('已删除文档不再出现在搜索结果中');
    } else {
      warn('已删除文档仍出现在搜索结果中（可能索引缓存未失效）');
    }

    // ── 12. 全量重建索引 ───────────────────────────────────────
    section('12. 全量重建索引');
    await engine.rebuildIndex();
    ok('索引重建完成（基于现有文档，不丢失数据）');
    const rebuilt = await engine.getStatus();
    info(`重建后 — 文档数: ${rebuilt.documentCount} | 段数: ${rebuilt.segmentCount} | DB: ${(rebuilt.dbSizeBytes / 1024).toFixed(1)}KB`);
    info(`最后构建时间: ${rebuilt.lastBuiltAt ? new Date(rebuilt.lastBuiltAt).toLocaleString() : 'N/A'}`);

    // ── 13. 重建后搜索验证 ─────────────────────────────────────
    section('13. 重建后搜索验证: "cameraManager createCameraSession"');
    results = await engine.search({ query: 'cameraManager createCameraSession', limit: 3 });
    printResults(results);

    // ── 14. 最终状态 ───────────────────────────────────────────
    section('14. 最终引擎状态');
    const finalStatus = await engine.getStatus();
    console.log(`  ${DIM}{${RESET}`);
    console.log(`    ${DIM}ready:${RESET}         ${finalStatus.ready}`);
    console.log(`    ${DIM}documentCount:${RESET} ${finalStatus.documentCount}`);
    console.log(`    ${DIM}segmentCount:${RESET}  ${finalStatus.segmentCount}`);
    console.log(`    ${DIM}dbSizeBytes:${RESET}   ${finalStatus.dbSizeBytes} (${(finalStatus.dbSizeBytes / 1024).toFixed(1)} KB)`);
    console.log(`    ${DIM}indexVersion:${RESET}  ${finalStatus.indexVersion}`);
    console.log(`    ${DIM}lastBuiltAt:${RESET}   ${finalStatus.lastBuiltAt ? new Date(finalStatus.lastBuiltAt).toISOString() : 'null'}`);
    console.log(`  ${DIM}}${RESET}`);

    // ── 15. 文件结构 ───────────────────────────────────────────
    section('15. 数据目录文件结构');
    printFileTree(DATA_DIR, '  ');

    console.log(`\n${GREEN}${BOLD}━━━ Demo 完成 ━━━${RESET}\n`);
  } catch (error) {
    fail(`运行出错: ${error.message}`);
    console.error(error.stack);
  } finally {
    await engine.close();
    info('引擎已关闭');
  }
}

/**
 * 递归打印目录树。
 * @param {string} dir
 * @param {string} prefix
 */
function printFileTree(dir, prefix = '') {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      console.log(`${prefix}${BOLD}${entry.name}/${RESET}`);
      printFileTree(fullPath, prefix + '  ');
    } else {
      const stat = fs.statSync(fullPath);
      const sizeStr = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
      console.log(`${prefix}${entry.name} ${DIM}(${sizeStr})${RESET}`);
    }
  }
}

// ─── 启动 ──────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(`${RED}未捕获错误:${RESET}`, err);
  process.exit(1);
});
