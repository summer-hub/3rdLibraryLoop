# API 12 变更说明

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
