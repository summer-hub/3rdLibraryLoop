# CameraManager API 参考

## 概述
cameraManager 是相机管理的核心接口，提供相机打开、配置、拍照等功能。

#### cameraManager.getCameraManager()
获取 CameraManager 实例。

```typescript
import { camera } from '@kit.CameraKit';

const cameraManager: camera.CameraManager = camera.getCameraManager();
const cameras: Array<camera.CameraDevice> = cameraManager.getSupportedCameras();
```

#### CameraManager.createCameraSession()
创建相机会话，用于预览和拍照。

```typescript
const session: camera.CameraSession = cameraManager.createCameraSession(cameras[0]);
session.beginConfig();
session.addInput(cameraInput);
session.addOutput(previewOutput);
await session.commitConfig();
await session.start();
```

#### cameraManager.on('cameraStatus')
监听相机状态变化事件。
