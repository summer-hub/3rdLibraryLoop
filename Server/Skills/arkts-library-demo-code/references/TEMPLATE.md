# Demo 代码模板

本文档提供 `arkts-library-demo-code` 技能生成 Demo 代码时使用的标准模板，包含 Demo 页面模板、主导航页面模板、原始 Demo 入口保留模板、路由配置模板和 module.json5 权限段模板。

---

## 一、Demo 页面模板（无权限版）

适用场景：Demo 不需要任何用户授权权限，仅使用库接口或系统自动授权功能。

```typescript
/**
 * Demo {SEQ}: {ENGLISH_TITLE}
 *
 * 功能说明：{DESCRIPTION}
 * 对应接口：{INTERFACES}
 *
 * @author {AUTHOR}
 */

import hilog from '@ohos.hilog';
import { {ImportedSymbols} } from '{LIBRARY_PACKAGE}';

// ─── 日志常量 ──────────────────────────────────────────────────────────────
const DOMAIN: number = 0xD001;
const TAG: string = '{LIBRARY_TAG}_{PAGE_NAME}';

// ─── 类型定义（根据接口需要填写） ──────────────────────────────────────────
interface {ModelName} {
  // 根据接口返回值类型定义
}

/**
 * {ComponentName} - {中文功能说明}
 *
 * 展示 {LIBRARY_NAME} 的 {核心功能} 使用方法。
 */
@Entry
@Component
struct {ComponentName} {
  // ─── 状态变量 ────────────────────────────────────────────────────────────
  @State private resultText: string = '';
  @State private isLoading: boolean = false;
  @State private isError: boolean = false;

  // ─── 非响应式成员（库实例、Timer 等） ─────────────────────────────────────
  // private instance: {LibraryClass} | null = null;

  // ─── 生命周期 ──────────────────────────────────────────────────────────────

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, '{ComponentName} appeared');
  }

  aboutToDisappear(): void {
    hilog.info(DOMAIN, TAG, '{ComponentName} disappeared');
    // TODO: 释放持有的资源（库实例、订阅、Timer 等）
  }

  // ─── 核心功能方法 ─────────────────────────────────────────────────────────

  /**
   * {方法功能说明}
   */
  private async {actionMethod}(): Promise<void> {
    hilog.debug(DOMAIN, TAG, '{actionMethod} called');
    this.isLoading = true;
    this.isError = false;
    try {
      // TODO: 调用鸿蒙原生库接口
      // const result = await {libraryCall};
      // this.resultText = `成功：${String(result)}`;
      hilog.info(DOMAIN, TAG, '{actionMethod} succeeded');
    } catch (err) {
      const msg: string = (err as Error).message ?? String(err);
      hilog.error(DOMAIN, TAG, '{actionMethod} failed: %{public}s', msg);
      this.resultText = `错误：${msg}`;
      this.isError = true;
    } finally {
      this.isLoading = false;
    }
  }

  // ─── UI 构建 ──────────────────────────────────────────────────────────────

  build() {
    Scroll() {
      Column({ space: 16 }) {
        // 页面标题（通过 $r() 引用国际化字符串，禁止硬编码）
        Text($r('app.string.demo_{seq}_title'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 16 })

        Divider()

        // TODO: 根据 Demo 步骤描述填写操作控件（输入框、按钮、选择器等）

        // 执行按钮（按钮文本必须通过 $r() 引用）
        Button($r('app.string.demo_{seq}_{action}_btn'))
          .width('100%')
          .enabled(!this.isLoading)
          .onClick(() => this.{actionMethod}())

        // 加载指示器
        if (this.isLoading) {
          LoadingProgress().width(40).height(40)
        }

        // 结果/错误展示区域
        if (this.resultText.length > 0) {
          Text(this.resultText)
            .fontSize(14)
            .width('100%')
            .padding(12)
            .backgroundColor(this.isError ? '#FFEBEE' : '#F5F5F5')
            .fontColor(this.isError ? '#C62828' : '#212121')
            .borderRadius(8)
        }
      }
      .width('100%')
      .padding(16)
    }
    .width('100%')
    .height('100%')
  }
}
```

---

## 二、Demo 页面模板（含动态权限申请版）

适用场景：Demo 需要申请用户授权权限（如相机、媒体文件访问、位置等）。

```typescript
/**
 * Demo {SEQ}: {ENGLISH_TITLE}
 *
 * 功能说明：{DESCRIPTION}
 * 对应接口：{INTERFACES}
 * 所需权限：{PERMISSIONS}
 *
 * @author {AUTHOR}
 */

import hilog from '@ohos.hilog';
import abilityAccessCtrl, { Permissions } from '@ohos.abilityAccessCtrl';
import common from '@ohos.app.ability.common';
import { {ImportedSymbols} } from '{LIBRARY_PACKAGE}';

// ─── 日志常量 ──────────────────────────────────────────────────────────────
const DOMAIN: number = 0xD001;
const TAG: string = '{LIBRARY_TAG}_{PAGE_NAME}';

// ─── 权限列表（填写此 Demo 实际需要的权限） ────────────────────────────────
const REQUIRED_PERMISSIONS: Permissions[] = [
  'ohos.permission.{PERMISSION_NAME}' as Permissions,
];

@Entry
@Component
struct {ComponentName} {
  @State private resultText: string = '';
  @State private isLoading: boolean = false;
  @State private isError: boolean = false;
  @State private hasPermission: boolean = false;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, '{ComponentName} appeared');
    // 页面加载时主动申请权限
    this.requestNeededPermissions();
  }

  aboutToDisappear(): void {
    hilog.info(DOMAIN, TAG, '{ComponentName} disappeared');
    // 释放持有资源
  }

  // ─── 权限申请 ─────────────────────────────────────────────────────────────

  /**
   * 申请 Demo 所需的运行时权限。
   * 须在使用权限保护接口前调用。
   */
  private async requestNeededPermissions(): Promise<void> {
    hilog.debug(DOMAIN, TAG, 'requestNeededPermissions called');
    const context = getContext(this) as common.UIAbilityContext;
    const atManager = abilityAccessCtrl.createAtManager();
    try {
      const result = await atManager.requestPermissionsFromUser(context, REQUIRED_PERMISSIONS);
      this.hasPermission = result.authResults.every((r: number) => r === 0);
      hilog.info(DOMAIN, TAG, 'Permission result: %{public}s',
                 this.hasPermission ? 'granted' : 'denied');
      if (!this.hasPermission) {
        this.resultText = '提示：需要授予权限才能运行此 Demo';
        this.isError = true;
      }
    } catch (err) {
      const msg: string = (err as Error).message ?? String(err);
      hilog.error(DOMAIN, TAG, 'requestNeededPermissions failed: %{public}s', msg);
      this.resultText = `权限申请失败：${msg}`;
      this.isError = true;
    }
  }

  // ─── 核心功能方法 ─────────────────────────────────────────────────────────

  private async {actionMethod}(): Promise<void> {
    if (!this.hasPermission) {
      hilog.warn(DOMAIN, TAG, '{actionMethod} skipped: permission not granted');
      this.resultText = '请先授予所需权限';
      return;
    }
    hilog.debug(DOMAIN, TAG, '{actionMethod} called');
    this.isLoading = true;
    this.isError = false;
    try {
      // TODO: 调用需要权限的接口
      hilog.info(DOMAIN, TAG, '{actionMethod} succeeded');
    } catch (err) {
      const msg: string = (err as Error).message ?? String(err);
      hilog.error(DOMAIN, TAG, '{actionMethod} failed: %{public}s', msg);
      this.resultText = `错误：${msg}`;
      this.isError = true;
    } finally {
      this.isLoading = false;
    }
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text($r('app.string.demo_{seq}_title'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ top: 16 })

        Divider()

        // 权限状态提示
        if (!this.hasPermission) {
          Text('⚠️ 权限未授予，部分功能不可用')
            .fontSize(13)
            .fontColor('#E65100')
            .width('100%')
            .padding(8)
            .backgroundColor('#FFF3E0')
            .borderRadius(6)
        }

        // TODO: 操作控件

        Button($r('app.string.demo_{seq}_{action}_btn'))
          .width('100%')
          .enabled(!this.isLoading && this.hasPermission)
          .onClick(() => this.{actionMethod}())

        if (this.isLoading) {
          LoadingProgress().width(40).height(40)
        }

        if (this.resultText.length > 0) {
          Text(this.resultText)
            .fontSize(14)
            .width('100%')
            .padding(12)
            .backgroundColor(this.isError ? '#FFEBEE' : '#F5F5F5')
            .fontColor(this.isError ? '#C62828' : '#212121')
            .borderRadius(8)
        }
      }
      .width('100%')
      .padding(16)
    }
    .width('100%')
    .height('100%')
  }
}
```

---

## 三、主导航页面模板（DemoIndex.ets）

> ⚠️ `DemoEntry.title/description` 必须声明为 `Resource` 类型并由 `$r()` 赋值（禁止硬编码字符串）；路由为 `pages/{序号}_{PascalCaseName}Page`（**无子目录**）。

```typescript
/**
 * {LIBRARY_NAME} Demo 主导航页面
 *
 * 提供所有 Demo 的入口列表，通过 router 跳转到各 Demo 页面。
 *
 * @author {AUTHOR}
 */

import hilog from '@ohos.hilog';

const DOMAIN: number = 0xD001;
const TAG: string = '{LIBRARY_TAG}_DemoIndex';

// Demo 条目数据结构（title/description 使用 Resource 类型，支持国际化）
interface DemoEntry {
  id: string;          // Demo 编号，如 "001"
  title: Resource;     // Demo 名称，通过 $r('app.string.demo_NNN_title') 引用
  description: Resource; // Demo 简要描述，通过 $r('app.string.demo_NNN_index_desc') 引用
  route: string;       // 路由路径（无子目录，如 'pages/001_XxxPage'）
}

// Demo 列表配置（按序号排列；title/description 必须用 $r() 引用，禁止硬编码字符串）
const DEMO_LIST: DemoEntry[] = [
  {
    id: '001',
    title: $r('app.string.demo_001_title'),
    description: $r('app.string.demo_001_index_desc'),
    route: 'pages/001_{PascalCaseName}Page'
  },
  // ... 其他 Demo（数量必须与场景文档一致）
];

@Entry
@Component
struct DemoIndex {
  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'DemoIndex appeared, total demos: %{public}d', DEMO_LIST.length);
  }

  build() {
    Column() {
      // 页面标题（$r() 引用）
      Text($r('app.string.demo_index_title'))
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .width('100%')
        .textAlign(TextAlign.Center)
        .padding({ top: 24, bottom: 4 })

      // 动态计数文本：运行时数据，无需 $r()
      Text(`共 ${DEMO_LIST.length} 个测试 Demo`)
        .fontSize(13)
        .fontColor('#888888')
        .width('100%')
        .textAlign(TextAlign.Center)
        .margin({ bottom: 16 })

      List({ space: 8 }) {
        ForEach(DEMO_LIST, (demo: DemoEntry) => {
          ListItem() {
            this.DemoCard(demo)
          }
        }, (demo: DemoEntry) => demo.id)
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ left: 16, right: 16, bottom: 16 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F0F2F5')
  }

  // @Builder 传入静态数据对象，属合法用法（不依赖 @State）
  @Builder
  DemoCard(demo: DemoEntry): void {
    Row({ space: 12 }) {
      // 序号徽章（纯动态字符串，直接插入 demo.id 即可）
      Text(demo.id)
        .fontSize(14)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .width(44).height(44)
        .textAlign(TextAlign.Center)
        .backgroundColor('#3478F6')
        .borderRadius(22)

      // 标题 + 描述（Resource 类型，直接传入 Text，不可用模板字符串插入）
      Column({ space: 4 }) {
        Text(demo.title)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .width('100%')
        Text(demo.description)
          .fontSize(11)
          .fontColor('#888888')
          .width('100%')
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      // 箭头
      Text('›')
        .fontSize(20)
        .fontColor('#BBBBBB')
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .backgroundColor(Color.White)
    .onClick(() => {
      hilog.info(DOMAIN, TAG, 'Navigate to demo: %{public}s', demo.id);
      this.getUIContext().getRouter().pushUrl({ url: demo.route })
        .catch((err: Error) => {
          hilog.error(DOMAIN, TAG, 'Navigation failed: %{public}s', err.message);
        });
    })
  }
}
```

---

## 四、main_pages.json 路由配置模板

```json
{
  "src": [
    "pages/DemoIndex",
    "pages/001_{PascalCaseName1}Page",
    "pages/002_{PascalCaseName2}Page"
  ]
}
```

**更新规则**：
- 主页面 `DemoIndex` 必须列在第一位
- 其余 Demo 页面按序号顺序排列，路径格式 `pages/{序号}_{PascalCaseName}Page`（**不含子目录**）
- 路径与 Demo 页面文件所在位置一致（不含 `.ets` 后缀）

---

## 五、module.json5 权限声明模板

在 `module.json5` 的 `"module"` 节点下添加 `"requestPermissions"` 字段：

```json5
{
  "module": {
    // ...其他字段...
    "requestPermissions": [
      {
        // 网络权限（系统自动授权，无需 usedScene）
        "name": "ohos.permission.INTERNET"
      },
      {
        // 读取媒体文件（需用户授权）
        "name": "ohos.permission.READ_MEDIA",
        "reason": "$string:permission_read_media_reason",
        "usedScene": {
          "abilities": ["EntryAbility"],
          "when": "inuse"
        }
      },
      {
        // 相机（需用户授权）
        "name": "ohos.permission.CAMERA",
        "reason": "$string:permission_camera_reason",
        "usedScene": {
          "abilities": ["EntryAbility"],
          "when": "inuse"
        }
      }
    ]
  }
}
```

> ⚠️ `reason` 字段必须引用 `$string:xxx` 资源，不得硬编码字符串。需在 `resources/base/element/string.json`（及 zh_CN/en_US）中添加对应字符串资源。

---

## 六、原始库 Demo 入口保留模板（OriginalDemoCard）

若工程中已有原始的鸿蒙原生库功能演示页面（如 `pages/Tab`，通过 `pages/Index` 跳转进入），**必须**在 `DemoIndex.ets` 中以视觉区分的方式保留其跳转入口，确保原有 Demo 不被覆盖。

1. 在 `DemoIndex.ets` 顶层常量区声明原始 Demo 路由：

```typescript
// 原始库 Demo 路由（保留原有演示，不纳入序号列表）
const ORIGINAL_DEMO_ROUTE: string = 'pages/Tab';
```

2. 在 `struct DemoIndex` 中添加 `@Builder OriginalDemoCard()` 方法（静态布局，无 `@State`）：

```typescript
@Builder
OriginalDemoCard(): void {
  Row({ space: 12 }) {
    Text('↗')
      .fontSize(14).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      .width(44).height(44).textAlign(TextAlign.Center)
      .backgroundColor('#FF8C00')  // 橙色，与蓝色序号徽章区分
      .borderRadius(22)

    Column({ space: 4 }) {
      Text($r('app.string.demo_original_title'))
        .fontSize(14).fontWeight(FontWeight.Medium).width('100%')
      Text($r('app.string.demo_original_index_desc'))
        .fontSize(11).fontColor('#888888').width('100%')
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .layoutWeight(1).alignItems(HorizontalAlign.Start)

    Text('›').fontSize(24).fontColor('#BBBBBB')
  }
  .width('100%')
  .padding({ left: 16, right: 16, top: 12, bottom: 12 })
  .backgroundColor('#FFF8EE')
  .borderRadius(8)
  .border({ width: 1, color: '#FFD580', style: BorderStyle.Solid })
  .onClick(() => {
    this.getUIContext().getRouter().pushUrl({ url: ORIGINAL_DEMO_ROUTE })
      .catch((err: Error) => {
        hilog.error(DOMAIN, TAG, 'Original demo navigation failed: %{public}s', err.message);
      });
  })
}
```

3. 在 `build()` 的 Divider 下方、序号 Demo List 上方插入原始 Demo 卡片（用 Column 包裹确保水平边距一致）：

```typescript
Column() {
  this.OriginalDemoCard()
}
.width('100%')
.padding({ left: 16, right: 16 })
```

4. 在 **base / zh_CN / en_US 三个** `string.json` 中添加对应字符串键：

```json
// base 与 zh_CN
{ "name": "demo_original_title", "value": "原始鸿蒙原生库示例" },
{ "name": "demo_original_index_desc", "value": "原有鸿蒙原生库功能演示页面（保留入口）" }

// en_US
{ "name": "demo_original_title", "value": "Original Library Demo" },
{ "name": "demo_original_index_desc", "value": "Original library feature showcase page (preserved entry)" }
```
